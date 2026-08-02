import { canonicalId } from "./canonical-records";
import { applyBoundaryProposal, createBoundaryProposal, reverseBoundaryOperation } from "./case-boundaries";
import { normalizeActor, parseImport, sha256, timestampValue } from "./transcript-import";
import { reasoningHealthForConversation } from "./reasoning-health";
import { messageAnchorFragment } from "../shared/message-anchors";

type Row = Record<string, unknown>;

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,95}$/i;
const RECORD_ID_PATTERN = /^[a-z0-9][^\u0000-\u001f\u007f]{2,127}$/i;
const ASSIGNMENT_STATES = new Set(["assigned", "unassigned", "chat_only"]);
const IMPORT_REPRESENTATIONS = new Set(["Exact", "Reconstructed"]);

function assertId(value: unknown, label: string, pattern = RECORD_ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function requiredString(value: unknown, label: string, preserveWhitespace = false) {
  if (typeof value !== "string" || (preserveWhitespace ? value.length === 0 : value.trim().length === 0)) {
    throw new Error(`${label} is required.`);
  }
  return preserveWhitespace ? value : value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

async function requireProject(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare("SELECT * FROM projects WHERE id = ? LIMIT 1").bind(projectId));
  if (!project) throw new Error("Project not found.");
  return project;
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

async function requireConversationCaseLink(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId: string,
) {
  const link = await first<Row>(db.prepare(
    `SELECT * FROM conversation_case_links
     WHERE project_id = ? AND conversation_id = ? AND case_id = ? AND ended_at IS NULL
     LIMIT 1`,
  ).bind(projectId, conversationId, caseId));
  if (!link) throw new Error("Case must be associated with this conversation.");
  return link;
}

async function requireEvent(db: D1Database, projectId: string, conversationId: string, eventId: string) {
  const record = await first<Row>(db.prepare(
    "SELECT * FROM events WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
  ).bind(eventId, projectId, conversationId));
  if (!record) throw new Error("Event not found.");
  return record;
}

function authorizeWrite(request: Request, actionKey?: string) {
  if (!actionKey || request.headers.get("authorization") !== `Bearer ${actionKey}`) {
    throw new Error("Write authorization required.");
  }
}

function conversationView(row: Row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    title: row.title,
    provenance: parseJson(row.provenance, {}),
    importId: row.import_id,
    activeCaseId: row.active_case_id,
    status: row.status,
    originalStartedAt: row.original_started_at,
    originalEndedAt: row.original_ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseJson(row.metadata, {}),
  };
}

function messageView(row: Row) {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    sequence: row.sequence_number,
    actorType: row.actor_type,
    actorId: row.actor_id,
    exactContent: row.exact_content,
    originalTimestamp: row.original_timestamp,
    ingestedAt: row.ingested_at,
    sourceReference: row.source_reference,
    contentHash: row.content_hash,
    metadata: parseJson(row.metadata, {}),
  };
}

function caseView(row: Row) {
  return {
    id: row.id,
    projectId: row.project_id,
    objective: row.objective,
    thesis: row.current_thesis,
    decision: row.current_decision,
    status: row.status,
    timeHorizon: row.time_horizon,
    scope: row.scope,
    constraints: parseJson(row.active_constraints, []),
    caseCore: parseJson(row.case_core, {}),
    outcomeState: row.outcome_state,
    outcomeSummary: row.outcome_summary,
    postmortemState: row.postmortem_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventView(row: Row) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  const sourceMessageIds = parseJson<string[]>(row.source_message_ids, []);
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    caseId: row.case_id,
    type: row.event_type,
    assignmentState: row.assignment_state,
    exactSourceSpan: row.exact_source_span,
    compressedRepresentation: row.compressed_representation,
    sourceMessageIds,
    sourceLinks: sourceMessageIds.map((messageId) => ({
      messageId,
      href: messageAnchorFragment(messageId),
      span: Array.isArray(metadata.sourceSpans)
        ? metadata.sourceSpans.find((span) => span && typeof span === "object" && (span as Row).messageId === messageId) ?? null
        : null,
    })),
    observedAt: row.observed_at,
    ingestedAt: row.ingested_at,
    extractionMethod: row.extraction_method,
    extractionVersion: row.extraction_version,
    authority: row.authority_state,
    metadata,
  };
}

async function listConversations(db: D1Database, projectId: string) {
  await requireProject(db, projectId);
  const rows = await all<Row>(db.prepare(
    "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC",
  ).bind(projectId));
  return rows.map(conversationView);
}

async function conversationDetail(db: D1Database, projectId: string, conversationId: string) {
  const conversation = await requireConversation(db, projectId, conversationId);
  const [messages, events, links, imports, proposals, operations] = await Promise.all([
    all<Row>(db.prepare(
      "SELECT * FROM messages WHERE project_id = ? AND conversation_id = ? ORDER BY sequence_number ASC",
    ).bind(projectId, conversationId)),
    all<Row>(db.prepare(
      "SELECT * FROM events WHERE project_id = ? AND conversation_id = ? ORDER BY ingested_at ASC, id ASC",
    ).bind(projectId, conversationId)),
    all<Row>(db.prepare(
      `SELECT c.*, l.relationship_state, l.created_at AS linked_at, l.ended_at AS link_ended_at
       FROM conversation_case_links l
       JOIN cases c ON c.id = l.case_id AND c.project_id = l.project_id
       WHERE l.project_id = ? AND l.conversation_id = ? AND l.ended_at IS NULL
       ORDER BY l.created_at ASC`,
    ).bind(projectId, conversationId)),
    all<Row>(db.prepare(
      `SELECT id, import_id, source_type, representation_type, authority_state,
              provenance, source_format, source_name, content_hash, message_count,
              duplicate_count, diagnostics, imported_at
       FROM conversation_imports
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY imported_at ASC`,
    ).bind(projectId, conversationId)),
    all<Row>(db.prepare(
      "SELECT * FROM case_boundary_proposals WHERE project_id = ? AND conversation_id = ? ORDER BY created_at DESC",
    ).bind(projectId, conversationId)),
    all<Row>(db.prepare(
      "SELECT * FROM case_boundary_operations WHERE project_id = ? AND conversation_id = ? ORDER BY created_at DESC",
    ).bind(projectId, conversationId)),
  ]);
  return {
    conversation: conversationView(conversation),
    reasoningHealth: await reasoningHealthForConversation(
      db,
      projectId,
      conversationId,
      conversation.active_case_id ? String(conversation.active_case_id) : null,
    ),
    messages: messages.map(messageView),
    events: events.map(eventView),
    cases: links.map(caseView),
    imports: imports.map((row) => ({
      id: row.id,
      importId: row.import_id,
      sourceType: row.source_type,
      representationType: row.representation_type,
      authorityState: row.authority_state,
      provenance: parseJson(row.provenance, {}),
      format: row.source_format,
      sourceName: row.source_name,
      contentHash: row.content_hash,
      messageCount: row.message_count,
      duplicateCount: row.duplicate_count,
      diagnostics: parseJson(row.diagnostics, {}),
      importedAt: row.imported_at,
    })),
    boundaryProposals: proposals.map((row) => ({
      ...row,
      source_case_ids: parseJson(row.source_case_ids, []),
      event_ids: parseJson(row.event_ids, []),
      metadata: parseJson(row.metadata, {}),
    })),
    boundaryHistory: operations.map((row) => ({ ...row, operation_payload: parseJson(row.operation_payload, {}) })),
  };
}

async function conversationSource(db: D1Database, projectId: string, conversationId: string) {
  const conversation = await requireConversation(db, projectId, conversationId);
  const imports = await all<Row>(db.prepare(
    `SELECT id, import_id, source_type, representation_type, authority_state,
            provenance, source_format, source_name, raw_source, content_hash,
            message_count, duplicate_count, diagnostics, imported_at
     FROM conversation_imports
     WHERE project_id = ? AND conversation_id = ?
     ORDER BY imported_at ASC`,
  ).bind(projectId, conversationId));
  return {
    conversation: conversationView(conversation),
    imports: imports.map((row) => ({
      id: row.id,
      importId: row.import_id,
      sourceType: row.source_type,
      representationType: row.representation_type,
      authorityState: row.authority_state,
      provenance: parseJson(row.provenance, {}),
      format: row.source_format,
      sourceName: row.source_name,
      rawSource: row.raw_source,
      contentHash: row.content_hash,
      messageCount: row.message_count,
      duplicateCount: row.duplicate_count,
      diagnostics: parseJson(row.diagnostics, {}),
      importedAt: row.imported_at,
    })),
  };
}

async function createConversation(db: D1Database, projectId: string, body: Row) {
  await requireProject(db, projectId);
  const id = body.id ? assertId(body.id, "conversation ID") : canonicalId("conversation");
  const createdAt = now();
  const title = requiredString(body.title, "Conversation title");
  await db.prepare(
    `INSERT INTO conversations (
      id, project_id, source_type, title, provenance, import_id, active_case_id, status,
      original_started_at, original_ended_at, metadata, created_at, updated_at
    ) VALUES (?, ?, 'native', ?, ?, NULL, NULL, 'active', ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    title,
    json(body.provenance ?? { source: "campus_atlas_native" }),
    optionalString(body.originalStartedAt),
    optionalString(body.originalEndedAt),
    json(body.metadata),
    createdAt,
    createdAt,
  ).run();
  return conversationView((await requireConversation(db, projectId, id)));
}

async function importConversation(db: D1Database, projectId: string, body: Row, idempotencyKey: string) {
  await requireProject(db, projectId);
  requiredString(idempotencyKey, "Idempotency key");
  const format = requiredString(body.format, "Import format").toLowerCase();
  const parsed = parseImport(format, body.transcript);
  const contentHash = await sha256(parsed.rawSource);
  const existing = await first<Row>(db.prepare(
    `SELECT * FROM conversation_imports
     WHERE project_id = ? AND (idempotency_key = ? OR content_hash = ?)
     ORDER BY imported_at ASC LIMIT 1`,
  ).bind(projectId, idempotencyKey, contentHash));
  if (existing) {
    return {
      conversation: conversationView(await requireConversation(db, projectId, String(existing.conversation_id))),
      import: {
        id: existing.id,
        importId: existing.import_id,
        sourceType: existing.source_type,
        representationType: existing.representation_type,
        authorityState: existing.authority_state,
        provenance: parseJson(existing.provenance, {}),
        format: existing.source_format,
        contentHash: existing.content_hash,
        messageCount: existing.message_count,
        diagnostics: parseJson(existing.diagnostics, {}),
      },
      idempotentReplay: true,
      duplicateDetected: true,
      duplicateReason: existing.idempotency_key === idempotencyKey ? "idempotency_key" : "exact_source_hash",
    };
  }

  const conversationId = body.conversationId
    ? assertId(body.conversationId, "conversation ID")
    : canonicalId("conversation");
  const importId = body.importId ? assertId(body.importId, "import ID") : `import:${contentHash.slice(0, 24)}`;
  const importRecordId = canonicalId("conversation-import");
  const createdAt = now();
  const sourceName = optionalString(body.sourceName);
  const sourceType = optionalString(body.sourceType) || "explicit_transcript_import";
  const representationType = optionalString(body.representationType) || "Exact";
  if (!IMPORT_REPRESENTATIONS.has(representationType)) {
    throw new Error("Import representation must be Exact or Reconstructed.");
  }
  const requestedAuthority = optionalString(body.authorityState);
  if (requestedAuthority && requestedAuthority !== "observed") {
    throw new Error("Import authority must remain observed in Slice 2.");
  }
  const authorityState = "observed";
  const provenance = {
    ...(body.provenance && typeof body.provenance === "object" ? body.provenance : {}),
    source: sourceName || sourceType,
    format,
    supplied: true,
    exactEnvelopePreserved: parsed.exactEnvelopePreserved,
    sourceType,
    representationType,
    authorityState,
  };
  const title = requiredString(body.title ?? sourceName ?? "Imported conversation", "Conversation title");
  const startedAt = parsed.messages.find((message) => message.originalTimestamp)?.originalTimestamp ?? optionalString(body.originalStartedAt);
  const endedAt = [...parsed.messages].reverse().find((message) => message.originalTimestamp)?.originalTimestamp ?? optionalString(body.originalEndedAt);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO conversations (
        id, project_id, source_type, title, provenance, import_id, active_case_id, status,
        original_started_at, original_ended_at, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      conversationId,
      projectId,
      sourceType === "explicit_transcript_import" ? "imported" : sourceType,
      title,
      json(provenance),
      importId,
      startedAt,
      endedAt,
      json(body.metadata),
      createdAt,
      createdAt,
    ),
  ];

  for (let index = 0; index < parsed.messages.length; index += 1) {
    const message = parsed.messages[index];
    statements.push(db.prepare(
      `INSERT INTO messages (
        id, project_id, conversation_id, sequence_number, actor_type, actor_id,
        exact_content, original_timestamp, ingested_at, source_reference,
        source_message_key, content_hash, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      canonicalId("message"),
      projectId,
      conversationId,
      index + 1,
      message.actorType,
      message.actorId,
      message.exactContent,
      message.originalTimestamp,
      createdAt,
      message.sourceReference || `${importId}:message:${index + 1}`,
      message.sourceMessageKey || `${importId}:${index + 1}`,
      await sha256(message.exactContent),
      json({
        ...message.metadata,
        importId,
        sourceType,
        representationType,
        authorityState,
      }),
    ));
  }

  const diagnostics = {
    exactEnvelopePreserved: parsed.exactEnvelopePreserved,
    emptyMessagesOmitted: 0,
    duplicateMessagesOmitted: 0,
    parser: format === "json" ? "slice2-structured-v1" : "slice2-text-v1",
  };
  statements.push(db.prepare(
    `INSERT INTO conversation_imports (
      id, project_id, conversation_id, import_id, idempotency_key, source_type,
      representation_type, authority_state, provenance, source_format, source_name,
      raw_source, content_hash, message_count, duplicate_count, diagnostics, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(
    importRecordId,
    projectId,
    conversationId,
    importId,
    idempotencyKey,
    sourceType,
    representationType,
    authorityState,
    json(provenance),
    format,
    sourceName,
    parsed.rawSource,
    contentHash,
    parsed.messages.length,
    json(diagnostics),
    createdAt,
  ));
  await db.batch(statements);

  return {
    conversation: conversationView(await requireConversation(db, projectId, conversationId)),
    import: {
      id: importRecordId,
      importId,
      sourceType,
      representationType,
      authorityState,
      provenance,
      format,
      contentHash,
      messageCount: parsed.messages.length,
      diagnostics,
    },
    idempotentReplay: false,
    duplicateDetected: false,
  };
}

async function appendMessage(
  db: D1Database,
  projectId: string,
  conversationId: string,
  body: Row,
  idempotencyKey: string,
) {
  await requireConversation(db, projectId, conversationId);
  requiredString(idempotencyKey, "Idempotency key");
  const sourceMessageKey = `native:${idempotencyKey}`;
  const existing = await first<Row>(db.prepare(
    "SELECT * FROM messages WHERE project_id = ? AND conversation_id = ? AND source_message_key = ? LIMIT 1",
  ).bind(projectId, conversationId, sourceMessageKey));
  if (existing) return { message: messageView(existing), idempotentReplay: true };

  const exactContent = requiredString(body.content, "Message content", true);
  const sequence = await first<{ next_sequence: number } & Row>(db.prepare(
    "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_sequence FROM messages WHERE project_id = ? AND conversation_id = ?",
  ).bind(projectId, conversationId));
  const id = body.id ? assertId(body.id, "message ID") : canonicalId("message");
  const ingestedAt = now();
  await db.batch([
    db.prepare(
      `INSERT INTO messages (
        id, project_id, conversation_id, sequence_number, actor_type, actor_id,
        exact_content, original_timestamp, ingested_at, source_reference,
        source_message_key, content_hash, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      projectId,
      conversationId,
      Number(sequence?.next_sequence || 1),
      normalizeActor(body.actorType),
      optionalString(body.actorId),
      exactContent,
      timestampValue(body.originalTimestamp),
      ingestedAt,
      optionalString(body.sourceReference) || `native:${id}`,
      sourceMessageKey,
      await sha256(exactContent),
      json(body.metadata),
    ),
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND project_id = ?").bind(ingestedAt, conversationId, projectId),
  ]);
  return {
    message: messageView((await first<Row>(db.prepare(
      "SELECT * FROM messages WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
    ).bind(id, projectId, conversationId)))!),
    idempotentReplay: false,
  };
}

async function createCase(db: D1Database, projectId: string, body: Row) {
  await requireProject(db, projectId);
  const id = body.id ? assertId(body.id, "case ID") : canonicalId("case");
  const createdAt = now();
  const conversationId = body.conversationId ? assertId(body.conversationId, "conversation ID") : null;
  if (conversationId) await requireConversation(db, projectId, conversationId);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO cases (
        id, project_id, objective, current_thesis, current_decision, status,
        time_horizon, scope, active_constraints, case_core, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      projectId,
      requiredString(body.objective, "Case objective"),
      optionalString(body.thesis),
      optionalString(body.decision),
      optionalString(body.timeHorizon),
      optionalString(body.scope) || "local",
      json(Array.isArray(body.constraints) ? body.constraints : []),
      json(body.caseCore),
      json(body.metadata),
      createdAt,
      createdAt,
    ),
  ];
  if (conversationId) {
    if (body.makeActive === true) {
      statements.push(db.prepare(
        `UPDATE conversation_case_links
         SET relationship_state = 'associated'
         WHERE project_id = ? AND conversation_id = ? AND ended_at IS NULL AND relationship_state = 'active'`,
      ).bind(projectId, conversationId));
    }
    statements.push(db.prepare(
      `INSERT INTO conversation_case_links (
        id, project_id, conversation_id, case_id, relationship_state,
        linked_by, link_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      canonicalId("conversation-case"),
      projectId,
      conversationId,
      id,
      body.makeActive === true ? "active" : "associated",
      optionalString(body.actorId) || "cody",
      optionalString(body.reason) || "Case associated at creation.",
      createdAt,
    ));
    if (body.makeActive === true) {
      statements.push(db.prepare(
        "UPDATE conversations SET active_case_id = ?, updated_at = ? WHERE id = ? AND project_id = ?",
      ).bind(id, createdAt, conversationId, projectId));
    }
  }
  await db.batch(statements);
  return caseView((await requireCase(db, projectId, id)));
}

async function listCases(db: D1Database, projectId: string) {
  await requireProject(db, projectId);
  return (await all<Row>(db.prepare("SELECT * FROM cases WHERE project_id = ? ORDER BY updated_at DESC").bind(projectId))).map(caseView);
}

async function selectActiveCase(
  db: D1Database,
  projectId: string,
  conversationId: string,
  body: Row,
) {
  const conversation = await requireConversation(db, projectId, conversationId);
  const caseId = assertId(body.caseId, "case ID");
  await requireCase(db, projectId, caseId);
  const changedAt = now();
  const activeLink = await first<Row>(db.prepare(
    "SELECT * FROM conversation_case_links WHERE project_id = ? AND conversation_id = ? AND case_id = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).bind(projectId, conversationId, caseId));
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE conversation_case_links
       SET relationship_state = 'associated'
       WHERE project_id = ? AND conversation_id = ? AND ended_at IS NULL AND relationship_state = 'active'`,
    ).bind(projectId, conversationId),
    db.prepare("UPDATE conversations SET active_case_id = ?, updated_at = ? WHERE id = ? AND project_id = ?")
      .bind(caseId, changedAt, conversationId, projectId),
  ];
  if (!activeLink) {
    statements.push(db.prepare(
      `INSERT INTO conversation_case_links (
        id, project_id, conversation_id, case_id, relationship_state,
        linked_by, link_reason, created_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      canonicalId("conversation-case"),
      projectId,
      conversationId,
      caseId,
      optionalString(body.actorId) || "cody",
      optionalString(body.reason) || "Selected as active case.",
      changedAt,
    ));
  } else {
    statements.push(db.prepare(
      `UPDATE conversation_case_links
       SET relationship_state = 'active'
       WHERE id = ? AND project_id = ? AND conversation_id = ?`,
    ).bind(activeLink.id, projectId, conversationId));
  }
  await db.batch(statements);
  return {
    conversationId,
    priorActiveCaseId: conversation.active_case_id,
    activeCaseId: caseId,
    case: caseView(await requireCase(db, projectId, caseId)),
    changedAt,
  };
}

async function validateSourceSpans(
  db: D1Database,
  projectId: string,
  conversationId: string,
  exactSourceSpan: string,
  value: unknown,
) {
  if (!Array.isArray(value) || !value.length) throw new Error("At least one exact source span is required.");
  const spans: Array<{ id: string; messageId: string; start: number; end: number }> = [];
  let reconstructed = "";
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Source span is invalid.");
    const record = item as Row;
    const id = record.id ? assertId(record.id, "source span ID") : canonicalId("source-span");
    const messageId = assertId(record.messageId, "source message ID");
    const message = await first<Row>(db.prepare(
      "SELECT * FROM messages WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
    ).bind(messageId, projectId, conversationId));
    if (!message) throw new Error("Source message not found.");
    const start = Number(record.start);
    const end = Number(record.end);
    const content = String(message.exact_content);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) {
      throw new Error("Source span offsets are invalid.");
    }
    reconstructed += content.slice(start, end);
    spans.push({ id, messageId, start, end });
  }
  if (reconstructed !== exactSourceSpan) throw new Error("Exact source span does not match the immutable message content.");
  return spans;
}

async function createEvent(db: D1Database, projectId: string, body: Row) {
  const conversationId = assertId(body.conversationId, "conversation ID");
  await requireConversation(db, projectId, conversationId);
  const exactSourceSpan = requiredString(body.exactSourceSpan, "Exact source span", true);
  const spans = await validateSourceSpans(db, projectId, conversationId, exactSourceSpan, body.sourceSpans);
  const assignmentState = optionalString(body.assignmentState) || "unassigned";
  if (!ASSIGNMENT_STATES.has(assignmentState)) throw new Error("Invalid event assignment state.");
  const caseId = assignmentState === "assigned" ? assertId(body.caseId, "case ID") : null;
  if (caseId) {
    await requireCase(db, projectId, caseId);
    await requireConversationCaseLink(db, projectId, conversationId, caseId);
  }
  const id = body.id ? assertId(body.id, "event ID") : canonicalId("event");
  const createdAt = now();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO events (
        id, project_id, conversation_id, case_id, event_type, exact_source_span,
        compressed_representation, source_message_ids, actor_id, observed_at,
        ingested_at, extraction_method, extraction_version, confidence,
        authority_state, assignment_state, version, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', ?, 1, ?)`,
    ).bind(
      id,
      projectId,
      conversationId,
      caseId,
      requiredString(body.type, "Event type"),
      exactSourceSpan,
      optionalString(body.compressedRepresentation),
      json(spans.map((span) => span.messageId)),
      optionalString(body.actorId),
      timestampValue(body.observedAt),
      createdAt,
      optionalString(body.extractionMethod) || "manual_source_mark",
      optionalString(body.extractionVersion) || "slice2-v1",
      typeof body.confidence === "number" ? Math.max(0, Math.min(100, Math.round(body.confidence))) : null,
      assignmentState,
      json({ ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}), sourceSpans: spans }),
    ),
  ];
  if (caseId) {
    statements.push(db.prepare(
      `INSERT INTO case_event_attachments (
        id, project_id, case_id, event_id, attachment_state, attached_by,
        attachment_reason, created_at
      ) VALUES (?, ?, ?, ?, 'attached', ?, ?, ?)`,
    ).bind(
      canonicalId("case-event"),
      projectId,
      caseId,
      id,
      optionalString(body.actorId) || "cody",
      optionalString(body.attachmentReason) || "Assigned when event was created.",
      createdAt,
    ));
  }
  await db.batch(statements);
  return eventView((await requireEvent(db, projectId, conversationId, id)));
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Conversation service request failed.";
  if (/authorization/i.test(message)) return Response.json({ error: message }, { status: 401 });
  if (/not found/i.test(message)) return Response.json({ error: message }, { status: 404 });
  if (/required|invalid|unsupported|must|does not match|already|no longer|cannot/i.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ error: message }, { status: 500 });
}

export async function handleConversationCases(request: Request, db: D1Database, actionKey?: string) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/(.+)$/);
    if (!match) return Response.json({ error: "Conversation route not found." }, { status: 404 });
    const projectId = decodeURIComponent(match[1]);
    assertId(projectId, "project ID", PROJECT_ID_PATTERN);
    const parts = match[2].split("/").map(decodeURIComponent);

    if (parts[0] === "conversations" && parts.length === 1 && request.method === "GET") {
      return Response.json({ projectId, conversations: await listConversations(db, projectId) }, { headers: { "cache-control": "no-store" } });
    }
    if (parts[0] === "conversations" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const conversation = await createConversation(db, projectId, await request.json() as Row);
      return Response.json({ projectId, conversation, idempotentReplay: false }, { status: 201 });
    }
    if (parts[0] === "conversations" && parts[1] === "import" && parts.length === 2 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const result = await importConversation(
        db,
        projectId,
        await request.json() as Row,
        request.headers.get("idempotency-key")?.trim() || "",
      );
      return Response.json({ projectId, ...result }, { status: result.idempotentReplay ? 200 : 201 });
    }
    if (parts[0] === "conversations" && parts[2] === "source" && parts.length === 3 && request.method === "GET") {
      return Response.json(await conversationSource(db, projectId, assertId(parts[1], "conversation ID")), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts[0] === "conversations" && parts.length === 2 && request.method === "GET") {
      return Response.json(await conversationDetail(db, projectId, assertId(parts[1], "conversation ID")), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts[0] === "conversations" && parts[2] === "messages" && parts.length === 3 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const result = await appendMessage(
        db,
        projectId,
        assertId(parts[1], "conversation ID"),
        await request.json() as Row,
        request.headers.get("idempotency-key")?.trim() || "",
      );
      return Response.json({ projectId, ...result }, { status: result.idempotentReplay ? 200 : 201 });
    }
    if (parts[0] === "conversations" && parts[2] === "active-case" && parts.length === 3 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const result = await selectActiveCase(db, projectId, assertId(parts[1], "conversation ID"), await request.json() as Row);
      return Response.json({ projectId, ...result });
    }
    if (parts[0] === "cases" && parts.length === 1 && request.method === "GET") {
      return Response.json({ projectId, cases: await listCases(db, projectId) }, { headers: { "cache-control": "no-store" } });
    }
    if (parts[0] === "cases" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      return Response.json({ projectId, case: await createCase(db, projectId, await request.json() as Row) }, { status: 201 });
    }
    if (parts[0] === "cases" && parts.length === 2 && request.method === "GET") {
      return Response.json({ projectId, case: caseView(await requireCase(db, projectId, assertId(parts[1], "case ID"))) }, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts[0] === "events" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      return Response.json({ projectId, event: await createEvent(db, projectId, await request.json() as Row) }, { status: 201 });
    }
    if (parts[0] === "case-boundaries" && parts[1] === "proposals" && parts.length === 2 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      return Response.json({ projectId, proposal: await createBoundaryProposal(db, projectId, await request.json() as Row) }, { status: 201 });
    }
    if (parts[0] === "case-boundaries" && parts[1] === "proposals" && parts[3] === "apply" && parts.length === 4 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      return Response.json({
        projectId,
        operation: await applyBoundaryProposal(db, projectId, assertId(parts[2], "proposal ID"), await request.json() as Row),
      });
    }
    if (parts[0] === "case-boundaries" && parts[1] === "operations" && parts[3] === "reverse" && parts.length === 4 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      return Response.json({
        projectId,
        operation: await reverseBoundaryOperation(db, projectId, assertId(parts[2], "operation ID"), await request.json() as Row),
      });
    }

    return Response.json({ error: "Conversation route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}
