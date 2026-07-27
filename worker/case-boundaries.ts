import { canonicalId } from "./canonical-records";

type Row = Record<string, unknown>;

const RECORD_ID_PATTERN = /^[a-z0-9][^\u0000-\u001f\u007f]{2,127}$/i;
const BOUNDARY_OPERATIONS = new Set(["attach", "move", "split", "merge", "unassign", "chat_only"]);

function assertId(value: unknown, label: string) {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be an array of IDs.`);
  return [...new Set(value.map((item) => assertId(item, label)))];
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

function now() {
  return new Date().toISOString();
}

async function first<T extends Row>(statement: D1PreparedStatement) {
  return statement.first<T>();
}

async function all<T extends Row>(statement: D1PreparedStatement) {
  const result = await statement.all<T>();
  return result.results ?? [];
}

async function requireConversation(db: D1Database, projectId: string, conversationId: string) {
  const conversation = await first<Row>(db.prepare(
    "SELECT * FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(conversationId, projectId));
  if (!conversation) throw new Error("Conversation not found.");
  return conversation;
}

async function requireCase(db: D1Database, projectId: string, caseId: string) {
  const record = await first<Row>(db.prepare("SELECT * FROM cases WHERE id = ? AND project_id = ? LIMIT 1").bind(caseId, projectId));
  if (!record) throw new Error("Case not found.");
  return record;
}

async function requireEvent(db: D1Database, projectId: string, conversationId: string, eventId: string) {
  const record = await first<Row>(db.prepare(
    "SELECT * FROM events WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
  ).bind(eventId, projectId, conversationId));
  if (!record) throw new Error("Event not found.");
  return record;
}

export async function createBoundaryProposal(db: D1Database, projectId: string, body: Row) {
  const conversationId = assertId(body.conversationId, "conversation ID");
  await requireConversation(db, projectId, conversationId);
  const operationType = requiredString(body.operationType, "Boundary operation").toLowerCase();
  if (!BOUNDARY_OPERATIONS.has(operationType)) throw new Error("Unsupported boundary operation.");
  let eventIds = stringArray(body.eventIds ?? [], "event IDs");
  const sourceCaseIds = stringArray(body.sourceCaseIds ?? [], "source case IDs");
  const targetCaseId = body.targetCaseId ? assertId(body.targetCaseId, "target case ID") : null;
  for (const caseId of sourceCaseIds) await requireCase(db, projectId, caseId);
  if (targetCaseId) await requireCase(db, projectId, targetCaseId);
  if (["attach", "move", "split", "merge"].includes(operationType) && !targetCaseId) {
    throw new Error("Target case is required for this boundary operation.");
  }
  if (operationType === "split" && sourceCaseIds.length !== 1) throw new Error("Split requires exactly one source case.");
  if (operationType === "merge" && !sourceCaseIds.length) throw new Error("Merge requires at least one source case.");
  if (operationType === "merge" && targetCaseId && sourceCaseIds.includes(targetCaseId)) {
    throw new Error("Merge target cannot also be a source case.");
  }
  if (operationType === "merge" && !eventIds.length) {
    const placeholders = sourceCaseIds.map(() => "?").join(", ");
    const rows = await all<Row>(db.prepare(
      `SELECT id FROM events WHERE project_id = ? AND conversation_id = ? AND case_id IN (${placeholders})`,
    ).bind(projectId, conversationId, ...sourceCaseIds));
    eventIds = rows.map((row) => String(row.id));
  }
  if (!eventIds.length) throw new Error("Boundary proposal requires at least one event.");
  for (const eventId of eventIds) await requireEvent(db, projectId, conversationId, eventId);
  const id = body.id ? assertId(body.id, "proposal ID") : canonicalId("boundary-proposal");
  const createdAt = now();
  await db.prepare(
    `INSERT INTO case_boundary_proposals (
      id, project_id, conversation_id, operation_type, source_case_ids,
      target_case_id, event_ids, proposal_state, proposed_by, proposal_reason,
      metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    conversationId,
    operationType,
    json(sourceCaseIds),
    targetCaseId,
    json(eventIds),
    optionalString(body.actorId) || "cody",
    requiredString(body.reason, "Proposal reason"),
    json(body.metadata),
    createdAt,
  ).run();
  return {
    id,
    projectId,
    conversationId,
    operationType,
    sourceCaseIds,
    targetCaseId,
    eventIds,
    state: "proposed",
    createdAt,
    changed: false,
  };
}

export async function applyBoundaryProposal(db: D1Database, projectId: string, proposalId: string, body: Row) {
  const proposal = await first<Row>(db.prepare(
    "SELECT * FROM case_boundary_proposals WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(proposalId, projectId));
  if (!proposal) throw new Error("Boundary proposal not found.");
  if (proposal.proposal_state !== "proposed") throw new Error("Boundary proposal is no longer pending.");
  const conversationId = String(proposal.conversation_id);
  const operationType = String(proposal.operation_type);
  const eventIds = parseJson<string[]>(proposal.event_ids, []);
  const sourceCaseIds = parseJson<string[]>(proposal.source_case_ids, []);
  const targetCaseId = proposal.target_case_id ? String(proposal.target_case_id) : null;
  const eventRows: Row[] = [];
  const activeAttachments: Row[] = [];
  for (const eventId of eventIds) {
    eventRows.push(await requireEvent(db, projectId, conversationId, eventId));
    const attachment = await first<Row>(db.prepare(
      "SELECT * FROM case_event_attachments WHERE project_id = ? AND event_id = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1",
    ).bind(projectId, eventId));
    if (attachment) activeAttachments.push(attachment);
  }
  const caseRows: Row[] = [];
  for (const caseId of sourceCaseIds) caseRows.push(await requireCase(db, projectId, caseId));
  if (targetCaseId && !caseRows.some((row) => row.id === targetCaseId)) caseRows.push(await requireCase(db, projectId, targetCaseId));

  const appliedAt = now();
  const operationId = canonicalId("boundary-operation");
  const assignmentState = operationType === "chat_only"
    ? "chat_only"
    : operationType === "unassign"
      ? "unassigned"
      : "assigned";
  const destinationCaseId = assignmentState === "assigned" ? targetCaseId : null;
  const createdAttachmentIds: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const attachment of activeAttachments) {
    statements.push(db.prepare(
      "UPDATE case_event_attachments SET ended_at = ? WHERE id = ? AND project_id = ? AND ended_at IS NULL",
    ).bind(appliedAt, attachment.id, projectId));
  }
  for (const eventRow of eventRows) {
    statements.push(db.prepare(
      "UPDATE events SET case_id = ?, assignment_state = ? WHERE id = ? AND project_id = ? AND conversation_id = ?",
    ).bind(destinationCaseId, assignmentState, eventRow.id, projectId, conversationId));
    if (destinationCaseId) {
      const prior = activeAttachments.find((attachment) => attachment.event_id === eventRow.id);
      const attachmentId = canonicalId("case-event");
      createdAttachmentIds.push(attachmentId);
      statements.push(db.prepare(
        `INSERT INTO case_event_attachments (
          id, project_id, case_id, event_id, attachment_state, attached_by,
          attachment_reason, created_at, supersedes_attachment_id
        ) VALUES (?, ?, ?, ?, 'attached', ?, ?, ?, ?)`,
      ).bind(
        attachmentId,
        projectId,
        destinationCaseId,
        eventRow.id,
        optionalString(body.actorId) || "cody",
        optionalString(body.reason) || String(proposal.proposal_reason),
        appliedAt,
        prior?.id ?? null,
      ));
    }
  }
  if (operationType === "merge") {
    for (const sourceCaseId of sourceCaseIds) {
      statements.push(db.prepare(
        "UPDATE cases SET status = 'merged', closed_at = ?, updated_at = ? WHERE id = ? AND project_id = ?",
      ).bind(appliedAt, appliedAt, sourceCaseId, projectId));
    }
  }
  const payload = {
    proposalId,
    beforeEvents: eventRows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      assignmentState: row.assignment_state,
      activeAttachmentId: activeAttachments.find((attachment) => attachment.event_id === row.id)?.id ?? null,
    })),
    beforeCases: caseRows.map((row) => ({ id: row.id, status: row.status, closedAt: row.closed_at })),
    after: { caseId: destinationCaseId, assignmentState },
    endedAttachmentIds: activeAttachments.map((row) => row.id),
    createdAttachmentIds,
  };
  statements.push(db.prepare(
    `INSERT INTO case_boundary_operations (
      id, project_id, conversation_id, proposal_id, operation_type,
      operation_payload, applied_by, operation_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    operationId,
    projectId,
    conversationId,
    proposalId,
    operationType,
    json(payload),
    optionalString(body.actorId) || "cody",
    optionalString(body.reason) || String(proposal.proposal_reason),
    appliedAt,
  ));
  statements.push(db.prepare(
    "UPDATE case_boundary_proposals SET proposal_state = 'applied', applied_operation_id = ?, resolved_at = ? WHERE id = ? AND project_id = ?",
  ).bind(operationId, appliedAt, proposalId, projectId));
  await db.batch(statements);
  return {
    id: operationId,
    projectId,
    conversationId,
    proposalId,
    operationType,
    payload,
    appliedAt,
    changed: true,
    reversible: true,
  };
}

export async function reverseBoundaryOperation(db: D1Database, projectId: string, operationId: string, body: Row) {
  const operation = await first<Row>(db.prepare(
    "SELECT * FROM case_boundary_operations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(operationId, projectId));
  if (!operation) throw new Error("Boundary operation not found.");
  if (operation.reversed_by_operation_id) throw new Error("Boundary operation was already reversed.");
  if (operation.reverse_of_operation_id) throw new Error("A reversal operation cannot be reversed through this endpoint.");
  const payload = parseJson<{
    beforeEvents: Array<{ id: string; caseId: string | null; assignmentState: string; activeAttachmentId: string | null }>;
    beforeCases: Array<{ id: string; status: string; closedAt: string | null }>;
  }>(operation.operation_payload, { beforeEvents: [], beforeCases: [] });
  const reversedAt = now();
  const reverseId = canonicalId("boundary-operation");
  const statements: D1PreparedStatement[] = [];
  const restoredAttachmentIds: string[] = [];
  for (const before of payload.beforeEvents) {
    const currentAttachment = await first<Row>(db.prepare(
      "SELECT * FROM case_event_attachments WHERE project_id = ? AND event_id = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1",
    ).bind(projectId, before.id));
    if (currentAttachment) {
      statements.push(db.prepare(
        "UPDATE case_event_attachments SET ended_at = ? WHERE id = ? AND project_id = ? AND ended_at IS NULL",
      ).bind(reversedAt, currentAttachment.id, projectId));
    }
    statements.push(db.prepare(
      "UPDATE events SET case_id = ?, assignment_state = ? WHERE id = ? AND project_id = ? AND conversation_id = ?",
    ).bind(before.caseId, before.assignmentState, before.id, projectId, operation.conversation_id));
    if (before.caseId && before.assignmentState === "assigned") {
      const attachmentId = canonicalId("case-event");
      restoredAttachmentIds.push(attachmentId);
      statements.push(db.prepare(
        `INSERT INTO case_event_attachments (
          id, project_id, case_id, event_id, attachment_state, attached_by,
          attachment_reason, created_at, supersedes_attachment_id
        ) VALUES (?, ?, ?, ?, 'restored', ?, ?, ?, ?)`,
      ).bind(
        attachmentId,
        projectId,
        before.caseId,
        before.id,
        optionalString(body.actorId) || "cody",
        requiredString(body.reason, "Reversal reason"),
        reversedAt,
        currentAttachment?.id ?? null,
      ));
    }
  }
  for (const before of payload.beforeCases) {
    statements.push(db.prepare(
      "UPDATE cases SET status = ?, closed_at = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(before.status, before.closedAt, reversedAt, before.id, projectId));
  }
  const reversePayload = { reverses: operationId, restoredAttachmentIds, restoredEvents: payload.beforeEvents };
  statements.push(db.prepare(
    `INSERT INTO case_boundary_operations (
      id, project_id, conversation_id, proposal_id, operation_type,
      operation_payload, applied_by, operation_reason, reverse_of_operation_id,
      created_at
    ) VALUES (?, ?, ?, ?, 'reverse', ?, ?, ?, ?, ?)`,
  ).bind(
    reverseId,
    projectId,
    operation.conversation_id,
    operation.proposal_id,
    json(reversePayload),
    optionalString(body.actorId) || "cody",
    requiredString(body.reason, "Reversal reason"),
    operationId,
    reversedAt,
  ));
  statements.push(db.prepare(
    "UPDATE case_boundary_operations SET reversed_by_operation_id = ? WHERE id = ? AND project_id = ?",
  ).bind(reverseId, operationId, projectId));
  if (operation.proposal_id) {
    statements.push(db.prepare(
      "UPDATE case_boundary_proposals SET proposal_state = 'reversed', resolved_at = ? WHERE id = ? AND project_id = ?",
    ).bind(reversedAt, operation.proposal_id, projectId));
  }
  await db.batch(statements);
  return {
    id: reverseId,
    projectId,
    conversationId: operation.conversation_id,
    reverses: operationId,
    payload: reversePayload,
    reversedAt,
    changed: true,
  };
}
