import { canonicalId } from "./canonical-records";
import { sha256 } from "./transcript-import";
import { messageAnchorHref } from "../shared/message-anchors";
import { hasUnresolvedConflict } from "./reasoning-semantics";
import {
  all,
  assertId,
  first,
  json,
  now,
  optionalString,
  parseJson,
  requiredString,
  requireConversationCase,
  Row,
  stringArray,
} from "./slice3-support";

const CHECKPOINT_TRIGGERS = new Set([
  "analyze_now",
  "conversation_pause",
  "case_switch",
  "decision_recorded",
  "outcome_recorded",
  "correction_recorded",
  "import_completed",
]);
const FINDING_TYPES = new Set([
  "case_boundary_change",
  "correction",
  "mechanism_recognition",
  "scope_revision",
  "principle_proposal",
  "supersession",
  "retirement",
  "blueprint_revision",
  "transfer",
  "compression_confirmation",
]);
const SCOPES = new Set(["local", "project_wide", "cross_project"]);
const MAX_SELECTED_NODES = 7;
const EXTRACTION_VERSION = "slice3-sparse-v1";
const SERVER_FINDING_SOURCE = "canonical_case_events";
const ANALYZER_CANDIDATE_SOURCES = new Set([
  "explicit_analyzer_candidates",
  "slice6b_contract",
  "user_supplied_case_reconstruction",
]);
const FINDING_CANDIDATE_FIELDS = new Set([
  "findingType",
  "sourceEventIds",
  "proposalStatement",
  "proposedScope",
  "conditions",
  "exclusions",
  "supportingEvidence",
  "counterevidence",
  "uncertainty",
  "reasonForSurfacing",
  "expectedRetrievalEffect",
]);

function checkpointView(row: Row) {
  return {
    id: row.id,
    projectId: row.project_id,
    caseId: row.case_id,
    conversationId: row.conversation_id,
    trigger: row.trigger,
    source: row.source,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    extractionVersion: row.extraction_version,
    candidateCount: row.candidate_count,
    selectedCount: row.selected_count,
    omittedCount: row.omitted_count,
    healthBefore: row.health_before,
    healthAfter: row.health_after,
    missingState: parseJson(row.missing_state, []),
    ambiguity: row.ambiguity,
    error: row.error,
    metadata: parseJson(row.metadata, {}),
  };
}

function nodeView(row: Row) {
  return {
    id: row.id,
    caseId: row.case_id,
    type: row.node_type,
    scope: row.scope,
    authority: row.authority_state,
    status: row.status,
    currentVersionId: row.current_version_id,
    statement: row.statement,
    representationType: row.representation_type,
    sourceEventIds: parseJson(row.source_event_ids, []),
    uncertainty: row.uncertainty,
    confidence: row.confidence,
    selectionOrder: row.selection_order,
  };
}

function findingView(row: Row) {
  return {
    id: row.id,
    projectId: row.project_id,
    caseId: row.case_id,
    checkpointId: row.checkpoint_id,
    type: row.finding_type,
    sourceEventIds: parseJson(row.source_event_ids, []),
    currentVersionId: row.current_version_id,
    status: row.status,
    authority: row.authority_state,
    reviewRequired: Boolean(row.review_required),
    returnCondition: row.return_condition,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    proposal: row.proposal_statement,
    proposedScope: row.proposed_scope,
    conditions: parseJson(row.conditions, []),
    exclusions: parseJson(row.exclusions, []),
    supportingEvidence: parseJson(row.supporting_evidence, []),
    counterevidence: parseJson(row.counterevidence, []),
    uncertainty: row.uncertainty,
    reasonForSurfacing: row.reason_for_surfacing,
    expectedRetrievalEffect: row.expected_retrieval_effect,
    proposalHash: row.proposal_hash,
    createdBy: row.created_by,
    sourceCase: row.case_objective || null,
  };
}

async function checkpointDetail(db: D1Database, projectId: string, checkpointId: string) {
  const checkpoint = await first<Row>(db.prepare(
    "SELECT * FROM checkpoints WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(checkpointId, projectId));
  if (!checkpoint) throw new Error("Checkpoint not found.");
  const [nodes, findings] = await Promise.all([
    all<Row>(db.prepare(
      `SELECT n.*, v.statement, v.representation_type, v.source_event_ids,
              v.uncertainty, v.confidence, link.selection_order
       FROM checkpoint_reasoning_nodes link
       JOIN reasoning_nodes n ON n.id = link.reasoning_node_id AND n.project_id = link.project_id
       JOIN reasoning_node_versions v ON v.id = n.current_version_id AND v.project_id = n.project_id
       WHERE link.project_id = ? AND link.checkpoint_id = ?
       ORDER BY link.selection_order ASC`,
    ).bind(projectId, checkpointId)),
    all<Row>(db.prepare(
      `SELECT f.*, v.proposal_statement, v.proposed_scope, v.conditions, v.exclusions,
              v.supporting_evidence, v.counterevidence, v.uncertainty,
              v.reason_for_surfacing, v.expected_retrieval_effect, v.proposal_hash, v.created_by
       FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.checkpoint_id = ?
       ORDER BY f.created_at ASC`,
    ).bind(projectId, checkpointId)),
  ]);
  const metadata = parseJson<Record<string, unknown>>(checkpoint.metadata, {});
  const selectedNodes = nodes.map(nodeView);
  const selectedNodeIds = selectedNodes.map((node) => String(node.id));
  const checkpointFindings = findings.map((row) => ({
    ...findingView(row),
    selectedNodeIds,
  }));
  return {
    checkpoint: checkpointView(checkpoint),
    selectedNodes,
    findings: checkpointFindings,
    suppressedFindingCount: Number(metadata.suppressedFindingCount || 0),
    noDurableFindingProposed: checkpointFindings.length === 0,
    retrievalEffect: checkpointFindings.length > 0
      ? "no_change_until_governed"
      : "none",
  };
}

function reasoningNodeType(eventType: unknown) {
  const type = String(eventType).toLowerCase();
  const map: Record<string, string> = {
    evidence: "Fact",
    fact: "Fact",
    assumption: "Assumption",
    estimate: "Estimate",
    unknown: "Unknown",
    method: "Method",
    correction: "Correction",
    challenge: "Challenge",
    decision: "Decision",
    outcome: "Outcome",
    constraint: "Constraint",
    constraint_change: "Constraint",
    mechanism_candidate: "Mechanism candidate",
    principle_candidate: "Principle candidate",
  };
  return map[type] || "Context";
}

function deriveHealth(events: Row[], findingCount: number, existingPendingFindingCount = 0) {
  const types = new Set(events.map((event) => String(event.event_type).toLowerCase()));
  if (hasUnresolvedConflict(events)) return "conflict";
  if (findingCount > 0 || existingPendingFindingCount > 0) return "awaiting_governance";
  if (types.has("decision") && !types.has("outcome")) return "awaiting_outcome";
  if (types.has("unknown")) return "missing_information";
  return "forming";
}

function deriveMissingState(events: Row[]) {
  const types = new Set(events.map((event) => String(event.event_type).toLowerCase()));
  const missing: string[] = [];
  if (events.length === 0) missing.push("source_events");
  if (types.has("decision") && !types.has("outcome")) missing.push("outcome");
  if (types.has("unknown")) missing.push("unresolved_unknowns");
  return missing;
}

async function caseEvents(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId: string,
  requestedEventIds: string[],
) {
  const events = await all<Row>(db.prepare(
    `SELECT DISTINCT e.*
     FROM events e
     LEFT JOIN case_event_attachments a
       ON a.project_id = e.project_id AND a.event_id = e.id
     WHERE e.project_id = ? AND e.conversation_id = ?
       AND (
         (e.case_id = ? AND e.assignment_state = 'assigned')
         OR (a.case_id = ? AND a.ended_at IS NULL)
       )
     ORDER BY
       CASE e.event_type
         WHEN 'correction' THEN 0
         WHEN 'challenge' THEN 1
         WHEN 'outcome' THEN 2
         WHEN 'decision' THEN 3
         WHEN 'unknown' THEN 4
         ELSE 5
       END,
       e.ingested_at DESC,
       e.id ASC`,
  ).bind(projectId, conversationId, caseId, caseId));
  if (requestedEventIds.length === 0) return events;
  const requested = new Set(requestedEventIds);
  const selected = events.filter((event) => requested.has(String(event.id)));
  if (selected.length !== requested.size) throw new Error("A candidate event is outside the active conversation and case.");
  return selected;
}

type FindingCandidate = {
  findingType: string;
  sourceEventIds: string[];
  proposalStatement: string;
  proposedScope: string;
  conditions: string[];
  exclusions: string[];
  supportingEvidence: string[];
  counterevidence: string[];
  uncertainty: string | null;
  reasonForSurfacing: string;
  expectedRetrievalEffect: string;
  proposalHash: string;
};

function eventStatement(event: Row) {
  return event.compressed_representation
    ? String(event.compressed_representation)
    : String(event.exact_source_span || "");
}

function normalizedTerms(value: string) {
  const stop = new Set([
    "about", "after", "again", "against", "before", "being", "could", "current",
    "from", "have", "into", "merely", "should", "than", "that", "their", "there",
    "these", "they", "this", "through", "until", "when", "where", "which", "while",
    "with", "would", "your",
  ]);
  return new Set(
    value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 3 && !stop.has(term)) || [],
  );
}

function mechanismLanguage(value: string) {
  return /\b(?:require|requires|required|should|must|when|whenever|if|pass|avoid|rerank|check)\b/i.test(value);
}

function atomicEnough(value: string) {
  const sentenceCount = value.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim()).length;
  return value.trim().length >= 24 && value.length <= 700 && sentenceCount <= 3;
}

function related(primary: Row, candidate: Row) {
  const primaryTerms = normalizedTerms(eventStatement(primary));
  const candidateTerms = normalizedTerms(eventStatement(candidate));
  let overlap = 0;
  for (const term of primaryTerms) if (candidateTerms.has(term)) overlap += 1;
  return overlap >= 3;
}

async function serverFindingCandidates(selectedEvents: Row[]): Promise<FindingCandidate[]> {
  const primary = selectedEvents.find((event) => {
    const type = String(event.event_type).toLowerCase();
    const statement = eventStatement(event);
    return ["correction", "mechanism_candidate", "principle_candidate", "constraint_change"].includes(type)
      && mechanismLanguage(statement)
      && atomicEnough(statement);
  });
  if (!primary) return [];

  const relatedEvents = selectedEvents.filter((event) => event === primary || related(primary, event));
  const supportingEvents = relatedEvents.filter((event) =>
    ["evidence", "fact", "method", "outcome", "decision", "constraint"].includes(String(event.event_type).toLowerCase()),
  );
  const challengeEvents = relatedEvents.filter((event) => String(event.event_type).toLowerCase() === "challenge");
  const type = String(primary.event_type).toLowerCase();
  const candidate = {
    findingType: type === "principle_candidate"
      ? "principle_proposal"
      : type === "constraint_change"
        ? "scope_revision"
        : "mechanism_recognition",
    sourceEventIds: relatedEvents.map((event) => String(event.id)),
    proposalStatement: eventStatement(primary),
    proposedScope: "local",
    conditions: [] as string[],
    exclusions: [] as string[],
    supportingEvidence: supportingEvents.map((event) => String(event.id)),
    counterevidence: challengeEvents.map((event) => String(event.id)),
    uncertainty: null,
    reasonForSurfacing: "Selected canonical sources express one consequential proposal for Cody to review.",
    expectedRetrievalEffect: "No retrieval change unless Cody governs the final reviewed wording and scope.",
  };
  return [{
    ...candidate,
    proposalHash: await sha256(JSON.stringify(candidate)),
  }];
}

async function validateFindingCandidate(value: unknown, allowedEventIds: Set<string>): Promise<FindingCandidate> {
  if (!value || typeof value !== "object") throw new Error("Each finding candidate must be an object.");
  const record = value as Row;
  const unknownFields = Object.keys(record).filter((key) => !FINDING_CANDIDATE_FIELDS.has(key));
  if (unknownFields.length) {
    throw new Error(`One finding may contain only one consequence; unsupported fields: ${unknownFields.join(", ")}.`);
  }
  const findingType = requiredString(record.findingType, "Finding type").toLowerCase();
  if (!FINDING_TYPES.has(findingType)) throw new Error("Unsupported finding type.");
  const sourceEventIds = stringArray(record.sourceEventIds, "Finding source event IDs", true).map((id) => assertId(id, "source event ID"));
  if (sourceEventIds.some((id) => !allowedEventIds.has(id))) {
    throw new Error("A finding source event is outside this checkpoint.");
  }
  const proposalStatement = requiredString(record.proposalStatement, "Finding proposal");
  const proposedScope = optionalString(record.proposedScope) || "local";
  if (!SCOPES.has(proposedScope)) throw new Error("Invalid finding scope.");
  const candidate = {
    findingType,
    sourceEventIds,
    proposalStatement,
    proposedScope,
    conditions: stringArray(record.conditions, "Finding conditions"),
    exclusions: stringArray(record.exclusions, "Finding exclusions"),
    supportingEvidence: stringArray(record.supportingEvidence, "Supporting evidence"),
    counterevidence: stringArray(record.counterevidence, "Counterevidence"),
    uncertainty: optionalString(record.uncertainty),
    reasonForSurfacing: requiredString(record.reasonForSurfacing, "Reason for surfacing"),
    expectedRetrievalEffect: requiredString(record.expectedRetrievalEffect, "Expected retrieval effect"),
  };
  return {
    ...candidate,
    proposalHash: await sha256(JSON.stringify(candidate)),
  };
}

async function analyzeCheckpoint(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  const existing = await first<Row>(db.prepare(
    "SELECT id FROM checkpoints WHERE project_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(projectId, idempotencyKey));
  if (existing) {
    return { ...(await checkpointDetail(db, projectId, String(existing.id))), idempotentReplay: true };
  }

  const conversationId = assertId(body.conversationId, "conversation ID");
  const caseId = assertId(body.caseId, "case ID");
  await requireConversationCase(db, projectId, conversationId, caseId);
  const trigger = optionalString(body.trigger) || "analyze_now";
  if (!CHECKPOINT_TRIGGERS.has(trigger)) throw new Error("Unsupported checkpoint trigger.");
  const source = optionalString(body.source) || SERVER_FINDING_SOURCE;
  const requestedEventIds = stringArray(body.candidateEventIds, "Candidate event IDs").map((id) => assertId(id, "event ID"));
  const events = await caseEvents(db, projectId, conversationId, caseId, requestedEventIds);
  const allowedEventIds = new Set(events.map((event) => String(event.id)));
  if (source === SERVER_FINDING_SOURCE && body.findingCandidates !== undefined) {
    throw new Error("Native finding candidates are server-owned; client-supplied finding wording cannot be accepted.");
  }
  if (source !== SERVER_FINDING_SOURCE && !ANALYZER_CANDIDATE_SOURCES.has(source)) {
    throw new Error("Unsupported checkpoint source.");
  }
  const startedAt = now();
  const checkpointId = canonicalId("checkpoint");
  const selectedEvents = events.slice(0, MAX_SELECTED_NODES);
  const rawFindings = source === SERVER_FINDING_SOURCE
    ? null
    : body.findingCandidates === undefined ? [] : body.findingCandidates;
  if (rawFindings !== null && !Array.isArray(rawFindings)) throw new Error("Finding candidates must be an array.");
  const findingCandidates = rawFindings === null
    ? await serverFindingCandidates(selectedEvents)
    : await Promise.all(rawFindings.map((candidate) => validateFindingCandidate(candidate, allowedEventIds)));
  const statements: D1PreparedStatement[] = [];
  const selectedNodeIds: string[] = [];

  for (let index = 0; index < selectedEvents.length; index += 1) {
    const event = selectedEvents[index];
    const eventId = String(event.id);
    const nodeId = `reasoning-node:${(await sha256(`${projectId}\n${caseId}\n${eventId}`)).slice(0, 32)}`;
    const statement = optionalString(event.compressed_representation) || String(event.exact_source_span);
    const eventMetadata = parseJson<Record<string, unknown>>(event.metadata, {});
    const sourceRepresentation = optionalString(eventMetadata.representationType);
    const representationType = event.compressed_representation
      ? "Compressed"
      : sourceRepresentation && ["Exact", "Reconstructed", "Inferred"].includes(sourceRepresentation)
        ? sourceRepresentation
        : "Exact";
    const current = await first<Row>(db.prepare(
      `SELECT n.*, v.statement, v.representation_type, v.source_event_ids
       FROM reasoning_nodes n
       LEFT JOIN reasoning_node_versions v ON v.id = n.current_version_id
       WHERE n.id = ? AND n.project_id = ? LIMIT 1`,
    ).bind(nodeId, projectId));
    let versionId = current?.current_version_id ? String(current.current_version_id) : null;
    const sourceEventIds = json([eventId]);
    const changed = !current
      || current.statement !== statement
      || current.representation_type !== representationType
      || current.source_event_ids !== sourceEventIds
      || current.node_type !== reasoningNodeType(event.event_type);
    if (!current) {
      statements.push(db.prepare(
        `INSERT INTO reasoning_nodes (
          id, project_id, case_id, node_type, current_version_id, scope,
          authority_state, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'local', 'inferred', 'active', ?, ?)`,
      ).bind(nodeId, projectId, caseId, reasoningNodeType(event.event_type), startedAt, startedAt));
    }
    if (changed) {
      const nextVersionId = canonicalId("reasoning-node-version");
      statements.push(db.prepare(
        `INSERT INTO reasoning_node_versions (
          id, project_id, reasoning_node_id, statement, representation_type,
          source_event_ids, evidence_links, counterevidence_links, uncertainty,
          confidence, created_by, created_at, supersedes_version_id
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', NULL, ?, 'atlas_checkpoint', ?, ?)`,
      ).bind(
        nextVersionId,
        projectId,
        nodeId,
        statement,
        representationType,
        sourceEventIds,
        event.confidence,
        startedAt,
        versionId,
      ));
      statements.push(db.prepare(
        `UPDATE reasoning_nodes
         SET node_type = ?, current_version_id = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).bind(reasoningNodeType(event.event_type), nextVersionId, startedAt, nodeId, projectId));
      versionId = nextVersionId;
    }
    statements.push(db.prepare(
      `INSERT INTO checkpoint_reasoning_nodes (
        id, project_id, checkpoint_id, reasoning_node_id, selection_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(canonicalId("checkpoint-node"), projectId, checkpointId, nodeId, index + 1, startedAt));
    selectedNodeIds.push(nodeId);
  }

  let suppressedFindingCount = 0;
  let createdFindingCount = 0;
  for (const candidate of findingCandidates) {
    const existingEquivalent = await first<Row>(db.prepare(
      `SELECT f.id
       FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.case_id = ? AND v.proposal_hash = ?
       LIMIT 1`,
    ).bind(projectId, caseId, candidate.proposalHash));
    if (existingEquivalent) {
      suppressedFindingCount += 1;
      continue;
    }
    const findingId = canonicalId("finding");
    const versionId = canonicalId("finding-version");
    statements.push(
      db.prepare(
        `INSERT INTO findings (
          id, project_id, case_id, checkpoint_id, finding_type, source_event_ids,
          current_version_id, status, review_required, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', 1, ?)`,
      ).bind(
        findingId,
        projectId,
        caseId,
        checkpointId,
        candidate.findingType,
        json(candidate.sourceEventIds),
        versionId,
        startedAt,
      ),
      db.prepare(
        `INSERT INTO finding_versions (
          id, project_id, finding_id, proposal_statement, proposed_scope,
          conditions, exclusions, supporting_evidence, counterevidence,
          uncertainty, reason_for_surfacing, expected_retrieval_effect,
          proposal_hash, created_by, created_at, supersedes_version_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'atlas_checkpoint', ?, NULL)`,
      ).bind(
        versionId,
        projectId,
        findingId,
        candidate.proposalStatement,
        candidate.proposedScope,
        json(candidate.conditions),
        json(candidate.exclusions),
        json(candidate.supportingEvidence),
        json(candidate.counterevidence),
        candidate.uncertainty,
        candidate.reasonForSurfacing,
        candidate.expectedRetrievalEffect,
        candidate.proposalHash,
        startedAt,
      ),
    );
    createdFindingCount += 1;
  }

  const pendingFinding = await first<Row>(db.prepare(
    `SELECT COUNT(*) AS count FROM findings
     WHERE project_id = ? AND case_id = ?
       AND status IN ('proposed', 'under_review', 'deferred', 'challenged')`,
  ).bind(projectId, caseId));
  const pendingFindingCount = Number(pendingFinding?.count || 0);
  const healthBefore = deriveHealth(events, 0, pendingFindingCount);
  const healthAfter = deriveHealth(events, createdFindingCount, pendingFindingCount);
  const missingState = deriveMissingState(events);
  const completedAt = now();
  statements.unshift(db.prepare(
    `INSERT INTO checkpoints (
      id, project_id, case_id, conversation_id, trigger, source, started_at,
      completed_at, status, extraction_version, candidate_count, selected_count,
      omitted_count, health_before, health_after, missing_state, ambiguity,
      error, idempotency_key, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).bind(
    checkpointId,
    projectId,
    caseId,
    conversationId,
    trigger,
    source,
    startedAt,
    completedAt,
    EXTRACTION_VERSION,
    events.length,
    selectedEvents.length,
    Math.max(0, events.length - selectedEvents.length),
    healthBefore,
    healthAfter,
    json(missingState),
    optionalString(body.ambiguity),
    idempotencyKey,
    json({
      findingCandidatesReceived: source === SERVER_FINDING_SOURCE ? 0 : findingCandidates.length,
      findingCandidatesGenerated: source === SERVER_FINDING_SOURCE ? findingCandidates.length : 0,
      findingCandidateOrigin: source === SERVER_FINDING_SOURCE ? "server" : "explicit_analyzer",
      findingCount: createdFindingCount,
      suppressedFindingCount,
      selectedNodeIds,
      authorityCreated: false,
    }),
  ));
  await db.batch(statements);
  return {
    ...(await checkpointDetail(db, projectId, checkpointId)),
    idempotentReplay: false,
  };
}

export async function latestCheckpoint(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId?: string | null,
) {
  const conversation = await first<Row>(db.prepare(
    "SELECT id, active_case_id FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(conversationId, projectId));
  if (!conversation) throw new Error("Conversation not found.");
  const scopedCaseId = caseId || (conversation.active_case_id ? String(conversation.active_case_id) : null);
  if (!scopedCaseId) return null;
  await requireConversationCase(db, projectId, conversationId, scopedCaseId);
  const checkpoint = await first<Row>(db.prepare(
    `SELECT id FROM checkpoints
     WHERE project_id = ? AND conversation_id = ? AND case_id = ?
     ORDER BY started_at DESC, id DESC LIMIT 1`,
  ).bind(projectId, conversationId, scopedCaseId));
  return checkpoint ? checkpointDetail(db, projectId, String(checkpoint.id)) : null;
}

export async function listFindings(
  db: D1Database,
  projectId: string,
  filters: {
    status?: string | null;
    type?: string | null;
    caseId?: string | null;
    scope?: string | null;
    since?: string | null;
  } = {},
) {
  const values: unknown[] = [projectId];
  const clauses: string[] = [];
  if (filters.status) {
    clauses.push("f.status = ?");
    values.push(filters.status);
  }
  if (filters.type) {
    clauses.push("f.finding_type = ?");
    values.push(filters.type);
  }
  if (filters.caseId) {
    clauses.push("f.case_id = ?");
    values.push(filters.caseId);
  }
  if (filters.scope) {
    clauses.push("v.proposed_scope = ?");
    values.push(filters.scope);
  }
  if (filters.since) {
    if (!Number.isFinite(Date.parse(filters.since))) throw new Error("Finding date filter is invalid.");
    clauses.push("f.created_at >= ?");
    values.push(filters.since);
  }
  const filterSql = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const rows = await all<Row>(db.prepare(
    `SELECT f.*, v.proposal_statement, v.proposed_scope, v.conditions, v.exclusions,
            v.supporting_evidence, v.counterevidence, v.uncertainty,
            v.reason_for_surfacing, v.expected_retrieval_effect, v.proposal_hash, v.created_by,
            c.objective AS case_objective
     FROM findings f
     JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
     JOIN cases c ON c.id = f.case_id AND c.project_id = f.project_id
     WHERE f.project_id = ?${filterSql}
     ORDER BY f.created_at DESC`,
  ).bind(...values));
  return rows.map(findingView);
}

export async function findingDetail(db: D1Database, projectId: string, findingId: string) {
  const finding = await first<Row>(db.prepare(
    "SELECT * FROM findings WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(findingId, projectId));
  if (!finding) throw new Error("Finding not found.");
  const sourceEventIds = parseJson<string[]>(finding.source_event_ids, []);
  const [versions, governance, sourceEvents] = await Promise.all([
    all<Row>(db.prepare(
      "SELECT * FROM finding_versions WHERE project_id = ? AND finding_id = ? ORDER BY created_at ASC",
    ).bind(projectId, findingId)),
    all<Row>(db.prepare(
      "SELECT * FROM governance_events WHERE project_id = ? AND target_type = 'finding' AND target_id = ? ORDER BY created_at ASC",
    ).bind(projectId, findingId)),
    Promise.all(sourceEventIds.map(async (eventId) => first<Row>(db.prepare(
      "SELECT * FROM events WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(eventId, projectId)))),
  ]);
  return {
    finding: {
      ...finding,
      source_event_ids: sourceEventIds,
    },
    versions: versions.map((version) => ({
      ...version,
      conditions: parseJson(version.conditions, []),
      exclusions: parseJson(version.exclusions, []),
      supporting_evidence: parseJson(version.supporting_evidence, []),
      counterevidence: parseJson(version.counterevidence, []),
    })),
    governance,
    sourceEvents: sourceEvents.filter(Boolean).map((event) => {
      const metadata = parseJson<Record<string, unknown>>(event!.metadata, {});
      const messageIds = parseJson<string[]>(event!.source_message_ids, []);
      return {
        id: event!.id,
        conversationId: event!.conversation_id,
        caseId: event!.case_id,
        type: event!.event_type,
        exactSourceSpan: event!.exact_source_span,
        compressedRepresentation: event!.compressed_representation,
        sourceLinks: messageIds.map((messageId) => ({
          messageId,
          href: messageAnchorHref(projectId, String(event!.conversation_id), messageId),
          span: Array.isArray(metadata.sourceSpans)
            ? metadata.sourceSpans.find((span) => span && typeof span === "object" && (span as Row).messageId === messageId) ?? null
            : null,
        })),
      };
    }),
  };
}

export async function getCheckpoint(db: D1Database, projectId: string, checkpointId: string) {
  return checkpointDetail(db, projectId, checkpointId);
}

export async function runCheckpoint(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  return analyzeCheckpoint(db, projectId, body, idempotencyKey);
}
