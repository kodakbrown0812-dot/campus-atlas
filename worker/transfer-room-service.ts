import {
  CHECKPOINT_CANDIDATE_VERSION,
  CHECKPOINT_EXTRACTION_VERSION,
  runCheckpoint,
} from "./checkpoint-service";
import { ingestRoomSource } from "./canonical-conversation-intake";
import { governFinding, materializeApprovedStateTruthMechanisms } from "./governance-service";
import { ensureExactImportSourceEvents } from "./source-event-materialization";
import { sha256 } from "./transcript-import";
import { all, first, json, now, parseJson, Row } from "./slice3-support";

export const TRANSFER_STAGES = [
  "received",
  "source_preserved",
  "events_materialized",
  "analyzed",
  "reconciled",
  "awaiting_review",
  "ready_for_steward",
  "blocked",
  "failed",
] as const;

type TransferStage = typeof TRANSFER_STAGES[number];

type TransferOrigin = {
  deploymentVersion?: string;
  sourceCommit?: string;
};

type ReconciliationItem = {
  findingId: string;
  findingVersionId: string;
  statement: string;
  candidateType: string;
  authority: string;
  scope: string;
  freshness: string;
  uncertainty: string | null;
  sensitivity: "standard" | "potentially_sensitive";
  relationship: "new_candidate" | "supporting_evidence" | "uncertain" | "transient_source_only";
  relatedMechanismId: string | null;
  proposedTreatment: "Use" | "Consider" | "Exclude";
  reviewRequired: boolean;
  reason: string;
  sourceEventIds: string[];
  exactSources: Array<{
    eventId: string;
    messageIds: string[];
    exactContent: string;
    actorType: string;
    sequence: number | null;
  }>;
  status: string;
  mechanismId: string | null;
  sourceAuthorship: "user" | "assistant" | "mixed" | "unknown";
  hasCounterevidence: boolean;
  checkpointDisposition: string;
  canonicalOriginCheckpointId: string;
};

function transferId(projectId: string, fingerprint: string) {
  return sha256(`transfer-room-v01\n${projectId}\n${fingerprint}`)
    .then((digest) => `transfer-room:${digest.slice(0, 32)}`);
}

function transferEventId(runId: string, attempt: number, stage: string, outcome: string) {
  return sha256(`${runId}\n${attempt}\n${stage}\n${outcome}`)
    .then((digest) => `transfer-event:${digest.slice(0, 32)}`);
}

function normalized(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function potentiallySensitive(value: string) {
  return /\b(password|passcode|secret|credential|api key|access token|social security|medical|diagnosis|bank account|credit card)\b/i.test(value);
}

function likelyTransient(value: string) {
  return /\b(?:not yet a change to (?:the )?(?:plan|decision|state)|does not affect (?:the )?(?:trip|project|work).{0,40}(?:current|working) state)\b/i.test(value)
    || (/\b(logo|branding|color palette|small talk|off topic)\b/i.test(value)
      && !/\b(decision|constraint|required|approved|selected|will)\b/i.test(value));
}

function stageTimestamps(row: Row) {
  return parseJson<Record<string, string>>(row.stage_timestamps, {});
}

async function recordStage(
  db: D1Database,
  row: Row,
  stage: TransferStage,
  outcome: "completed" | "blocked" | "failed" | "resumed",
  details: Record<string, unknown> = {},
) {
  const changedAt = now();
  const timestamps = stageTimestamps(row);
  if (outcome === "completed" && !timestamps[stage]) timestamps[stage] = changedAt;
  const attempt = Number(row.attempt_count || 1);
  const id = await transferEventId(String(row.id), attempt, stage, outcome);
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO transfer_run_events (
        id, project_id, transfer_run_id, attempt_number, stage, outcome, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, row.project_id, row.id, attempt, stage, outcome, json(details), changedAt),
    db.prepare(
      `UPDATE transfer_runs
       SET stage = ?, stage_timestamps = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(stage, json(timestamps), changedAt, row.id, row.project_id),
  ]);
  row.stage = stage;
  row.stage_timestamps = json(timestamps);
  row.updated_at = changedAt;
}

async function transferRow(db: D1Database, projectId: string, id: string) {
  const row = await first<Row>(db.prepare(
    "SELECT * FROM transfer_runs WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(id, projectId));
  if (!row) throw new Error("Transfer not found.");
  return row;
}

async function transferImport(db: D1Database, projectId: string, conversationId: string) {
  const record = await first<Row>(db.prepare(
    `SELECT i.*, c.title
     FROM conversation_imports i
     JOIN conversations c ON c.id = i.conversation_id AND c.project_id = i.project_id
     WHERE i.project_id = ? AND i.conversation_id = ? AND i.representation_type = 'Exact'
     ORDER BY i.imported_at ASC LIMIT 1`,
  ).bind(projectId, conversationId));
  if (!record) throw new Error("Transfer requires an existing Exact imported conversation.");
  return record;
}

async function ensureRun(
  db: D1Database,
  projectId: string,
  conversationId: string,
  origin: TransferOrigin,
) {
  const imported = await transferImport(db, projectId, conversationId);
  const fingerprint = String(imported.content_hash);
  const id = await transferId(projectId, fingerprint);
  const createdAt = now();
  await db.prepare(
    `INSERT OR IGNORE INTO transfer_runs (
      id, project_id, conversation_id, source_import_id, source_fingerprint,
      status, stage, stage_timestamps, expected_counts, actual_counts,
      generated_record_ids, reconciliation, attempt_count,
      origin_deployment_version, origin_source_commit, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', 'received', ?, ?, '{}', '{}', '[]', 1, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    conversationId,
    imported.id,
    fingerprint,
    json({ received: createdAt }),
    json({ messages: Number(imported.message_count) }),
    origin.deploymentVersion || null,
    origin.sourceCommit || null,
    createdAt,
    createdAt,
  ).run();
  const row = await transferRow(db, projectId, id);
  return { row, imported };
}

async function ensureCase(db: D1Database, row: Row, title: string) {
  const existingConversation = await first<Row>(db.prepare(
    "SELECT active_case_id FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(row.conversation_id, row.project_id));
  if (!existingConversation) throw new Error("Transfer conversation not found.");
  if (existingConversation.active_case_id) {
    const linked = await first<Row>(db.prepare(
      `SELECT id FROM conversation_case_links
       WHERE project_id = ? AND conversation_id = ? AND case_id = ?
         AND ended_at IS NULL LIMIT 1`,
    ).bind(row.project_id, row.conversation_id, existingConversation.active_case_id));
    if (!linked) throw new Error("The conversation's active case is not linked to the transfer source.");
    return String(existingConversation.active_case_id);
  }

  const digest = await sha256(`${row.project_id}\n${row.id}\ncase`);
  const caseId = `case:transfer:${digest.slice(0, 28)}`;
  const linkId = `conversation-case:transfer:${digest.slice(0, 24)}`;
  const createdAt = now();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO cases (
        id, project_id, objective, status, scope, active_constraints,
        case_core, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 'local', '[]', '{}', ?, ?, ?)`,
    ).bind(
      caseId,
      row.project_id,
      `Steward durable project state from ${title}.`,
      json({ createdBy: "transfer_room_v01", transferId: row.id }),
      createdAt,
      createdAt,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO conversation_case_links (
        id, project_id, conversation_id, case_id, relationship_state,
        linked_by, link_reason, created_at
      ) VALUES (?, ?, ?, ?, 'active', 'atlas_transfer', ?, ?)`,
    ).bind(
      linkId,
      row.project_id,
      row.conversation_id,
      caseId,
      "Automatically bounded for the room-transfer workflow.",
      createdAt,
    ),
    db.prepare(
      "UPDATE conversations SET active_case_id = ?, updated_at = ? WHERE id = ? AND project_id = ?",
    ).bind(caseId, createdAt, row.conversation_id, row.project_id),
  ]);
  return caseId;
}

function preparationVerified(value: Row, expected: number) {
  const metadata = parseJson<Record<string, unknown>>(value.metadata, {});
  const preparation = metadata.sourceEventPreparation && typeof metadata.sourceEventPreparation === "object"
    ? metadata.sourceEventPreparation as Row
    : null;
  return value.status === "complete"
    && preparation?.eligible === true
    && Number(preparation.expectedMessageCount) === expected
    && Number(preparation.materializedEventCount) === expected
    && Array.isArray(preparation.missingMessageIds)
    && preparation.missingMessageIds.length === 0;
}

async function reusableCheckpoint(db: D1Database, row: Row, expected: number) {
  const checkpoint = await first<Row>(db.prepare(
    `SELECT * FROM checkpoints
     WHERE project_id = ? AND conversation_id = ? AND case_id = ?
     ORDER BY started_at DESC, rowid DESC LIMIT 1`,
  ).bind(row.project_id, row.conversation_id, row.case_id));
  const metadata = parseJson<Record<string, unknown>>(checkpoint?.metadata, {});
  const candidateConstruction = metadata.candidateConstruction && typeof metadata.candidateConstruction === "object"
    ? metadata.candidateConstruction as Row
    : null;
  return checkpoint
    && checkpoint.extraction_version === CHECKPOINT_EXTRACTION_VERSION
    && candidateConstruction?.version === CHECKPOINT_CANDIDATE_VERSION
    && preparationVerified(checkpoint, expected)
    ? checkpoint
    : null;
}

async function exactSources(db: D1Database, projectId: string, eventIds: string[]) {
  const sources: ReconciliationItem["exactSources"] = [];
  for (const eventId of eventIds) {
    const event = await first<Row>(db.prepare(
      "SELECT * FROM events WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(eventId, projectId));
    if (!event) continue;
    const metadata = parseJson<Record<string, unknown>>(event.metadata, {});
    const sourceMessage = metadata.sourceMessage && typeof metadata.sourceMessage === "object"
      ? metadata.sourceMessage as Row
      : null;
    const sequence = Number(sourceMessage?.sequence);
    sources.push({
      eventId,
      messageIds: parseJson<string[]>(event.source_message_ids, []),
      exactContent: String(event.exact_source_span),
      actorType: String(sourceMessage?.actorType || "unknown").toLowerCase(),
      sequence: Number.isInteger(sequence) && sequence > 0 ? sequence : null,
    });
  }
  return sources;
}

function primarySource(statement: string, reason: string, sources: ReconciliationItem["exactSources"]) {
  const selectedSequence = reason.match(/Exact source sequence (\d+)/iu)?.[1];
  if (selectedSequence) {
    const source = sources.find((candidate) => candidate.sequence === Number(selectedSequence));
    if (source) return source;
  }
  const normalizedStatement = normalized(statement);
  const exactMatch = sources.find((source) => {
    const content = normalized(source.exactContent);
    return content.includes(normalizedStatement) || normalizedStatement.includes(content);
  });
  return exactMatch || null;
}

function sourceAuthorship(
  statement: string,
  reason: string,
  sources: ReconciliationItem["exactSources"],
): ReconciliationItem["sourceAuthorship"] {
  const primary = primarySource(statement, reason, sources);
  if (primary?.actorType === "user" || primary?.actorType === "assistant") return primary.actorType;
  const actors = new Set(sources.map((source) => source.actorType).filter((actor) => actor !== "unknown"));
  if (actors.size === 1) {
    const actor = [...actors][0];
    if (actor === "user" || actor === "assistant") return actor;
  }
  return actors.size ? "mixed" : "unknown";
}

async function reconcile(db: D1Database, row: Row) {
  const checkpoint = await first<Row>(db.prepare(
    "SELECT metadata FROM checkpoints WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(row.checkpoint_id, row.project_id));
  const metadata = parseJson<Record<string, unknown>>(checkpoint?.metadata, {});
  const candidateFindingLinks = Array.isArray(metadata.candidateFindingLinks)
    ? metadata.candidateFindingLinks.filter((value): value is Row => Boolean(value) && typeof value === "object")
    : [];
  const attachedFindingIds = [...new Set(candidateFindingLinks.flatMap((link) =>
    typeof link.findingId === "string" ? [link.findingId] : [],
  ))];
  const findingFilter = attachedFindingIds.length
    ? `f.checkpoint_id = ? OR f.id IN (${attachedFindingIds.map(() => "?").join(", ")})`
    : "f.checkpoint_id = ?";
  const findings = await all<Row>(db.prepare(
    `SELECT f.*, v.proposal_statement, v.proposed_scope, v.uncertainty, v.counterevidence,
            v.reason_for_surfacing, v.created_at AS version_created_at
     FROM findings f
     JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
     WHERE f.project_id = ? AND (${findingFilter})
     ORDER BY f.created_at ASC, f.id ASC`,
  ).bind(row.project_id, row.checkpoint_id, ...attachedFindingIds));
  const attachmentByFindingId = new Map<string, Row & { index: number }>(
    candidateFindingLinks.map((link, index) => [String(link.findingId), { ...link, index }]),
  );
  findings.sort((left, right) =>
    (attachmentByFindingId.get(String(left.id))?.index ?? Number.MAX_SAFE_INTEGER)
    - (attachmentByFindingId.get(String(right.id))?.index ?? Number.MAX_SAFE_INTEGER)
    || String(left.created_at).localeCompare(String(right.created_at)),
  );
  const mechanisms = await all<Row>(db.prepare(
    `SELECT m.id, m.source_finding_id, m.status, v.statement, v.authority_state
     FROM mechanisms m
     JOIN mechanism_versions v
       ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
     WHERE m.project_id = ? AND m.status = 'active'
       AND v.authority_state IN ('approved_local', 'approved_project_wide')`,
  ).bind(row.project_id));

  const result: ReconciliationItem[] = [];
  for (const finding of findings) {
    const attachment = attachmentByFindingId.get(String(finding.id));
    const statement = String(finding.proposal_statement);
    const direct = mechanisms.find((mechanism) => normalized(mechanism.statement) === normalized(statement));
    const governed = mechanisms.find((mechanism) => mechanism.source_finding_id === finding.id);
    const transient = likelyTransient(statement);
    const sensitive = potentiallySensitive(statement);
    const uncertain = Boolean(finding.uncertainty);
    const relationship: ReconciliationItem["relationship"] = direct
      ? "supporting_evidence"
      : transient
        ? "transient_source_only"
        : uncertain
          ? "uncertain"
          : "new_candidate";
    const rejected = String(finding.status) === "rejected";
    const proposedTreatment: ReconciliationItem["proposedTreatment"] = transient || rejected
      ? "Exclude"
      : sensitive
        ? "Consider"
        : "Use";
    const eventIds = parseJson<string[]>(finding.source_event_ids, []);
    const sources = await exactSources(db, String(row.project_id), eventIds);
    const reasonForSurfacing = String(finding.reason_for_surfacing);
    result.push({
      findingId: String(finding.id),
      findingVersionId: String(finding.current_version_id),
      statement,
      candidateType: String(finding.finding_type),
      authority: String(finding.authority_state),
      scope: String(finding.proposed_scope),
      freshness: String(finding.version_created_at),
      uncertainty: finding.uncertainty ? String(finding.uncertainty) : null,
      sensitivity: sensitive ? "potentially_sensitive" : "standard",
      relationship: rejected ? "transient_source_only" : relationship,
      relatedMechanismId: direct ? String(direct.id) : null,
      proposedTreatment,
      reviewRequired: !direct && !transient && !["approved", "rejected", "deferred"].includes(String(finding.status)),
      reason: rejected
        ? "The Exact source remains inspectable, but this candidate does not create separate working authority."
        : direct
        ? "The candidate confirms an unchanged governed statement; no new semantic authority is required."
        : transient
          ? "The source remains exact and inspectable, but this material does not govern future project action."
          : reasonForSurfacing,
      sourceEventIds: eventIds,
      exactSources: sources,
      status: String(finding.status),
      mechanismId: governed ? String(governed.id) : direct ? String(direct.id) : null,
      sourceAuthorship: sourceAuthorship(statement, reasonForSurfacing, sources),
      hasCounterevidence: parseJson<string[]>(finding.counterevidence, []).length > 0,
      checkpointDisposition: String(attachment?.disposition || "created"),
      canonicalOriginCheckpointId: String(attachment?.canonicalOriginCheckpointId || finding.checkpoint_id),
    });
  }
  return result;
}

async function governUnambiguousUserState(db: D1Database, row: Row, items: ReconciliationItem[]) {
  const checkpoint = await first<Row>(db.prepare(
    "SELECT ambiguity FROM checkpoints WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(row.checkpoint_id, row.project_id));
  if (checkpoint?.ambiguity) return [];
  const hasExplicitResolutionPath = (item: ReconciliationItem) => /\b(?:until|before|after|unless|only if|must confirm|needs? to (?:confirm|verify|check)|pending (?:confirmation|verification)|blocked on|waiting for|if .{1,100} then)\b/iu.test(item.statement);
  const eligible = items.filter((item) => item.reviewRequired
    && item.status === "proposed"
    && item.sourceAuthorship === "user"
    && item.sensitivity === "standard"
    && item.scope === "local"
    && item.proposedTreatment === "Use"
    && (!item.uncertainty || hasExplicitResolutionPath(item))
    && !item.hasCounterevidence);
  for (const item of eligible) {
    await governFinding(
      db,
      String(row.project_id),
      item.findingId,
      {
        action: "keep_local",
        actorId: "atlas-transfer-source-governor",
        sourceVersionId: item.findingVersionId,
        reviewedStatement: item.statement,
        scope: "local",
        reason: "Atlas preserved a complete, non-sensitive, unambiguous user-authored statement as room-local continuity.",
      },
      `transfer-room:${row.id}:source-governance:${item.findingId}:keep-local`,
    );
  }
  return eligible.map((item) => item.findingId);
}

async function saveRunState(
  db: D1Database,
  row: Row,
  values: {
    status?: string;
    caseId?: string;
    checkpointId?: string;
    expectedCounts?: Record<string, number>;
    actualCounts?: Record<string, number>;
    generatedRecordIds?: Record<string, unknown>;
    reconciliation?: ReconciliationItem[];
    blockedReason?: string | null;
    failureReason?: string | null;
    completedAt?: string | null;
  },
) {
  const changedAt = now();
  await db.prepare(
    `UPDATE transfer_runs SET
      status = COALESCE(?, status), case_id = COALESCE(?, case_id),
      checkpoint_id = COALESCE(?, checkpoint_id),
      expected_counts = COALESCE(?, expected_counts),
      actual_counts = COALESCE(?, actual_counts),
      generated_record_ids = COALESCE(?, generated_record_ids),
      reconciliation = COALESCE(?, reconciliation),
      blocked_reason = ?, failure_reason = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  ).bind(
    values.status || null,
    values.caseId || null,
    values.checkpointId || null,
    values.expectedCounts ? json(values.expectedCounts) : null,
    values.actualCounts ? json(values.actualCounts) : null,
    values.generatedRecordIds ? json(values.generatedRecordIds) : null,
    values.reconciliation ? json(values.reconciliation) : null,
    values.blockedReason ?? null,
    values.failureReason ?? null,
    values.completedAt ?? null,
    changedAt,
    row.id,
    row.project_id,
  ).run();
  Object.assign(row, {
    status: values.status || row.status,
    case_id: values.caseId || row.case_id,
    checkpoint_id: values.checkpointId || row.checkpoint_id,
    expected_counts: values.expectedCounts ? json(values.expectedCounts) : row.expected_counts,
    actual_counts: values.actualCounts ? json(values.actualCounts) : row.actual_counts,
    generated_record_ids: values.generatedRecordIds ? json(values.generatedRecordIds) : row.generated_record_ids,
    reconciliation: values.reconciliation ? json(values.reconciliation) : row.reconciliation,
    blocked_reason: values.blockedReason ?? null,
    failure_reason: values.failureReason ?? null,
    completed_at: values.completedAt ?? null,
    updated_at: changedAt,
  });
}

async function blockRun(db: D1Database, row: Row, reason: string) {
  await saveRunState(db, row, { status: "blocked", blockedReason: reason, failureReason: null });
  await recordStage(db, row, "blocked", "blocked", { reason, retrySafe: true });
}

async function failRun(db: D1Database, row: Row, reason: string) {
  await saveRunState(db, row, { status: "failed", blockedReason: null, failureReason: reason });
  await recordStage(db, row, "failed", "failed", { reason, retrySafe: true });
}

function reconstructedRoomState(items: ReconciliationItem[]) {
  const current = items.filter((item) => (
    item.status === "approved" && item.mechanismId && item.proposedTreatment === "Use"
  ) || (
    item.relationship === "supporting_evidence" && item.relatedMechanismId
  ));
  const statements = [...new Set(current.map((item) => item.statement))];
  const constraints = statements.filter((statement) => (
    /\b(must|must not|do not|never|only|unless|until|before|after|required?|constraint)\b/i.test(statement)
  ));
  const changed = current
    .filter((item) => /correction|supersed|replacement|revision/i.test(`${item.candidateType} ${item.relationship}`))
    .map((item) => item.statement);
  const nextAction = statements.find((statement) => (
    /\b(next action|next step|proceed|continue by|will now|should now|begin)\b/i.test(statement)
  )) || null;
  return {
    status: statements.length ? "ready" : items.some((item) => item.reviewRequired) ? "needs_review" : "insufficient",
    currentDirection: statements[0] || null,
    nextAction,
    importantConstraints: constraints.slice(0, 3),
    changedOrReplaced: changed.slice(0, 3),
    governedStatementCount: statements.length,
    stateTruthPrecedesTaskSelection: true,
  };
}

async function view(db: D1Database, projectId: string, row: Row) {
  const [conversation, imported, history] = await Promise.all([
    first<Row>(db.prepare(
      "SELECT id, title, source_type, status FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(row.conversation_id, projectId)),
    first<Row>(db.prepare(
      `SELECT id, message_count, representation_type, content_hash
       FROM conversation_imports WHERE id = ? AND project_id = ? LIMIT 1`,
    ).bind(row.source_import_id, projectId)),
    all<Row>(db.prepare(
      `SELECT * FROM transfer_run_events
       WHERE project_id = ? AND transfer_run_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).bind(projectId, row.id)),
  ]);
  const reconciliation = parseJson<ReconciliationItem[]>(row.reconciliation, []);
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    caseId: row.case_id,
    conversationTitle: conversation?.title || "Transferred room",
    conversationStatus: conversation?.status || "active",
    sourceImportId: row.source_import_id,
    sourceFingerprint: row.source_fingerprint,
    representationType: imported?.representation_type || "Exact",
    status: row.status,
    stage: row.stage,
    stageTimestamps: stageTimestamps(row),
    expectedCounts: parseJson(row.expected_counts, {}),
    actualCounts: parseJson(row.actual_counts, {}),
    generatedRecordIds: parseJson(row.generated_record_ids, {}),
    reconciliation,
    reconstructedState: reconstructedRoomState(reconciliation),
    blockedReason: row.blocked_reason,
    failureReason: row.failure_reason,
    retrySafe: ["blocked", "failed"].includes(String(row.status)),
    attemptCount: Number(row.attempt_count),
    origin: {
      deploymentVersion: row.origin_deployment_version,
      sourceCommit: row.origin_source_commit,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    history: history.map((event) => ({
      id: event.id,
      attempt: event.attempt_number,
      stage: event.stage,
      outcome: event.outcome,
      details: parseJson(event.details, {}),
      createdAt: event.created_at,
    })),
  };
}

async function orchestrate(db: D1Database, row: Row, imported: Row) {
  try {
    if (["blocked", "failed"].includes(String(row.status))) {
      const attempt = Number(row.attempt_count || 1) + 1;
      await db.prepare(
        `UPDATE transfer_runs
         SET status = 'active', blocked_reason = NULL, failure_reason = NULL,
             attempt_count = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).bind(attempt, now(), row.id, row.project_id).run();
      row.attempt_count = attempt;
      row.status = "active";
      await recordStage(db, row, String(row.stage) as TransferStage, "resumed", { retrySafe: true });
    }

    const expectedMessages = Number(imported.message_count);
    const actualMessages = await first<Row>(db.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE project_id = ? AND conversation_id = ?",
    ).bind(row.project_id, row.conversation_id));
    if (Number(actualMessages?.count || 0) !== expectedMessages) {
      await blockRun(db, row, `Expected ${expectedMessages} immutable messages, but ${Number(actualMessages?.count || 0)} are available.`);
      return;
    }
    await recordStage(db, row, "source_preserved", "completed", { messages: expectedMessages });

    const caseId = await ensureCase(db, row, String(imported.title || "the transferred room"));
    row.case_id = caseId;
    const preparation = await ensureExactImportSourceEvents(
      db,
      String(row.project_id),
      String(row.conversation_id),
      caseId,
    );
    if (preparation.status === "blocked" || preparation.status === "failed") {
      await saveRunState(db, row, {
        caseId,
        expectedCounts: { messages: expectedMessages, sourceEvents: expectedMessages },
        actualCounts: { messages: expectedMessages, sourceEvents: preparation.materializedEventCount },
      });
      await blockRun(db, row, preparation.requirement || "Exact source events could not be verified.");
      return;
    }
    if (preparation.materializedEventCount !== expectedMessages) {
      await blockRun(db, row, "Materialized source-event count does not match the preserved message count.");
      return;
    }
    await saveRunState(db, row, {
      caseId,
      expectedCounts: { messages: expectedMessages, sourceEvents: expectedMessages },
      actualCounts: { messages: expectedMessages, sourceEvents: preparation.materializedEventCount },
      generatedRecordIds: { sourceEventIds: preparation.eventIds },
    });
    await recordStage(db, row, "events_materialized", "completed", {
      count: preparation.materializedEventCount,
      outcome: preparation.status,
    });

    let checkpoint = await reusableCheckpoint(db, row, expectedMessages);
    if (!checkpoint) {
      const result = await runCheckpoint(db, String(row.project_id), {
        conversationId: row.conversation_id,
        caseId,
        trigger: "import_completed",
        source: "canonical_case_events",
      }, `transfer-room:${row.id}:checkpoint:${CHECKPOINT_EXTRACTION_VERSION}:${CHECKPOINT_CANDIDATE_VERSION}`);
      const checkpointView = result.checkpoint as Row;
      if (!checkpointView || checkpointView.status !== "complete") {
        await blockRun(db, row, String(checkpointView?.error || "Analysis did not complete safely."));
        return;
      }
      checkpoint = await first<Row>(db.prepare(
        "SELECT * FROM checkpoints WHERE id = ? AND project_id = ? LIMIT 1",
      ).bind(checkpointView.id, row.project_id));
      if (!checkpoint) {
        await blockRun(db, row, "The completed analysis checkpoint could not be verified canonically.");
        return;
      }
    }
    row.checkpoint_id = checkpoint.id;
    await saveRunState(db, row, {
      checkpointId: String(checkpoint.id),
      actualCounts: {
        messages: expectedMessages,
        sourceEvents: preparation.materializedEventCount,
        considered: Number(checkpoint.candidate_count || 0),
        selected: Number(checkpoint.selected_count || 0),
      },
      generatedRecordIds: {
        sourceEventIds: preparation.eventIds,
        checkpointId: checkpoint.id,
      },
    });
    await recordStage(db, row, "analyzed", "completed", {
      checkpointId: checkpoint.id,
      considered: checkpoint.candidate_count,
      selected: checkpoint.selected_count,
    });

    let reconciliation = await reconcile(db, row);
    const sourceGovernedFindingIds = await governUnambiguousUserState(db, row, reconciliation);
    if (sourceGovernedFindingIds.length) reconciliation = await reconcile(db, row);
    const materializedStateTruth = await materializeApprovedStateTruthMechanisms(
      db,
      String(row.project_id),
      reconciliation
        .filter((item) => item.status === "approved" && !item.mechanismId)
        .map((item) => item.findingId),
    );
    if (materializedStateTruth.length) reconciliation = await reconcile(db, row);
    const findingIds = reconciliation.map((item) => item.findingId);
    const mechanismIds = reconciliation.flatMap((item) => item.mechanismId ? [item.mechanismId] : []);
    await saveRunState(db, row, {
      reconciliation,
      actualCounts: {
        messages: expectedMessages,
        sourceEvents: preparation.materializedEventCount,
        considered: Number(checkpoint.candidate_count || 0),
        selected: Number(checkpoint.selected_count || 0),
        durableCandidates: reconciliation.length,
        reviewItems: reconciliation.filter((item) => item.reviewRequired).length,
      },
      generatedRecordIds: {
        sourceEventIds: preparation.eventIds,
        checkpointId: checkpoint.id,
        findingIds,
        mechanismIds,
      },
    });
    await recordStage(db, row, "reconciled", "completed", {
      candidates: reconciliation.length,
      materializedStateTruth,
      sourceGovernedFindingIds,
      relationships: reconciliation.map((item) => ({
        findingId: item.findingId,
        relationship: item.relationship,
        proposedTreatment: item.proposedTreatment,
      })),
    });

    const reviewItems = reconciliation.filter((item) => item.reviewRequired);
    if (reviewItems.length) {
      await saveRunState(db, row, { status: "awaiting_review", completedAt: null });
      await recordStage(db, row, "awaiting_review", "completed", { reviewItems: reviewItems.length });
      return;
    }

    const governedUse = reconciliation.filter((item) =>
      item.status === "approved" && item.mechanismId && item.proposedTreatment === "Use"
      || item.relationship === "supporting_evidence" && item.relatedMechanismId,
    );
    if (!governedUse.length) {
      await blockRun(db, row, "No governed Use state is available for Steward after review.");
      return;
    }
    const completedAt = now();
    await saveRunState(db, row, {
      status: "complete",
      reconciliation,
      generatedRecordIds: {
        sourceEventIds: preparation.eventIds,
        checkpointId: checkpoint.id,
        findingIds,
        mechanismIds: governedUse.flatMap((item) => item.mechanismId || item.relatedMechanismId || []),
      },
      completedAt,
    });
    await recordStage(db, row, "ready_for_steward", "completed", { governedUse: governedUse.length });
  } catch (caught) {
    await failRun(db, row, caught instanceof Error ? caught.message : "Transfer failed at an unknown boundary.");
  }
}

export async function beginTransfer(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
  origin: TransferOrigin = {},
) {
  let conversationId: string;
  if (typeof body.conversationId === "string" && body.conversationId.trim()) {
    conversationId = body.conversationId.trim();
  } else {
    const result = await ingestRoomSource(
      db,
      projectId,
      body,
      `transfer-import:${idempotencyKey}`,
    );
    conversationId = String(result.conversation.id);
  }
  const { row, imported } = await ensureRun(db, projectId, conversationId, origin);
  await orchestrate(db, row, imported);
  return getTransfer(db, projectId, String(row.id));
}

export async function resumeTransfer(db: D1Database, projectId: string, id: string) {
  const row = await transferRow(db, projectId, id);
  const imported = await transferImport(db, projectId, String(row.conversation_id));
  await orchestrate(db, row, imported);
  return getTransfer(db, projectId, id);
}

export async function getTransfer(db: D1Database, projectId: string, id: string) {
  return view(db, projectId, await transferRow(db, projectId, id));
}

export async function listTransfers(db: D1Database, projectId: string, includeArchived = false) {
  const rows = await all<Row>(db.prepare(
    `SELECT tr.* FROM transfer_runs tr
     INNER JOIN conversations c ON c.id = tr.conversation_id AND c.project_id = tr.project_id
     WHERE tr.project_id = ? ${includeArchived ? "" : "AND c.status != 'archived'"}
     ORDER BY tr.updated_at DESC, tr.created_at DESC`,
  ).bind(projectId));
  return Promise.all(rows.map((row) => view(db, projectId, row)));
}
