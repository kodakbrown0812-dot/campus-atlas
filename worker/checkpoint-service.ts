import { canonicalId } from "./canonical-records";
import { sha256 } from "./transcript-import";
import { messageAnchorHref } from "../shared/message-anchors";
import { hasUnresolvedConflict } from "./reasoning-semantics";
import {
  ensureExactImportSourceEvents,
  SourceEventPreparation,
} from "./source-event-materialization";
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
const MAX_MATURE_SELECTED_NODES = 21;
const MAX_MATURE_FINDINGS = 12;
export const CHECKPOINT_EXTRACTION_VERSION = "slice3-mature-coverage-v1";
export const CHECKPOINT_CANDIDATE_VERSION = "slice3-continuation-closure-v3";
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
  const metadata = parseJson<Record<string, unknown>>(checkpoint.metadata, {});
  const candidateFindingLinks = Array.isArray(metadata.candidateFindingLinks)
    ? metadata.candidateFindingLinks.filter((value): value is Row => Boolean(value) && typeof value === "object")
    : [];
  const attachedFindingIds = [...new Set(candidateFindingLinks.flatMap((link) =>
    typeof link.findingId === "string" ? [link.findingId] : [],
  ))];
  const findingFilter = attachedFindingIds.length
    ? `f.checkpoint_id = ? OR f.id IN (${attachedFindingIds.map(() => "?").join(", ")})`
    : "f.checkpoint_id = ?";
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
       WHERE f.project_id = ? AND (${findingFilter})
       ORDER BY f.created_at ASC`,
    ).bind(projectId, checkpointId, ...attachedFindingIds)),
  ]);
  const selectedNodes = nodes.map(nodeView);
  const selectedNodeIds = selectedNodes.map((node) => String(node.id));
  const attachmentByFindingId = new Map<string, Row & { index: number }>(
    candidateFindingLinks.map((link, index) => [String(link.findingId), { ...link, index }]),
  );
  const checkpointFindings = findings
    .sort((left, right) =>
      (attachmentByFindingId.get(String(left.id))?.index ?? Number.MAX_SAFE_INTEGER)
      - (attachmentByFindingId.get(String(right.id))?.index ?? Number.MAX_SAFE_INTEGER)
      || String(left.created_at).localeCompare(String(right.created_at)),
    )
    .map((row) => {
      const attachment = attachmentByFindingId.get(String(row.id));
      return {
        ...findingView(row),
        checkpointId,
        canonicalOriginCheckpointId: row.checkpoint_id,
        checkpointDisposition: attachment?.disposition || "created",
        checkpointSourceEventIds: Array.isArray(attachment?.sourceEventIds) ? attachment.sourceEventIds : parseJson(row.source_event_ids, []),
        selectedNodeIds,
      };
    });
  return {
    checkpoint: checkpointView(checkpoint),
    selectedNodes,
    findings: checkpointFindings,
    suppressedFindingCount: Number(metadata.suppressedFindingCount || 0),
    reusedFindingCount: Number(metadata.reusedFindingCount || 0),
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

function eventMetadata(event: Row) {
  return parseJson<Record<string, unknown>>(event.metadata, {});
}

function sourceMessageMetadata(event: Row) {
  const metadata = eventMetadata(event);
  return metadata.sourceMessage && typeof metadata.sourceMessage === "object"
    ? metadata.sourceMessage as Row
    : null;
}

function sourceSequence(event: Row) {
  const sequence = Number(sourceMessageMetadata(event)?.sequence);
  if (Number.isInteger(sequence) && sequence > 0) return sequence;
  const encoded = String(event.id || "").match(/^event:exact-message:(\d+):/u)?.[1];
  return encoded ? Number(encoded) : null;
}

function sourceActorType(event: Row) {
  return String(sourceMessageMetadata(event)?.actorType || "unknown").toLowerCase();
}

function eventTypePriority(event: Row) {
  const priority: Record<string, number> = {
    correction: 0,
    challenge: 1,
    outcome: 2,
    decision: 3,
    constraint: 4,
    unknown: 5,
    source_message: 6,
  };
  return priority[String(event.event_type).toLowerCase()] ?? 7;
}

function chronologicalEventOrder(left: Row, right: Row) {
  const typeDifference = eventTypePriority(left) - eventTypePriority(right);
  if (typeDifference) return typeDifference;
  const leftSequence = sourceSequence(left);
  const rightSequence = sourceSequence(right);
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  const leftObserved = Date.parse(String(left.observed_at || left.ingested_at || ""));
  const rightObserved = Date.parse(String(right.observed_at || right.ingested_at || ""));
  if (Number.isFinite(leftObserved) && Number.isFinite(rightObserved) && leftObserved !== rightObserved) {
    return leftObserved - rightObserved;
  }
  return String(left.id).localeCompare(String(right.id));
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
  events.sort(chronologicalEventOrder);
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
  return /\b(?:require|requires|required|should|must|has to|have to|when|whenever|if|pass|avoid|rerank|check|selected|will|current|preferred|reject|reserve|decide|unresolved)\b/i.test(value);
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

type ContinuitySignal =
  | "correction"
  | "supersession"
  | "constraint"
  | "current_direction"
  | "next_action"
  | "uncertainty"
  | "shared_term"
  | "connection";

const CONTINUITY_SIGNAL_ORDER: ContinuitySignal[] = [
  "correction",
  "supersession",
  "current_direction",
  "next_action",
  "constraint",
  "uncertainty",
  "shared_term",
  "connection",
];

function continuitySignals(value: string): ContinuitySignal[] {
  const signals: ContinuitySignal[] = [];
  if (/\b(?:correction|corrected|incorrect|misunderstood|mistaken|wrong|not the right|no longer applies|no longer (?:the )?plan|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale)\b/i.test(value)) {
    signals.push("correction");
  }
  if (/\b(?:supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|previously (?:planned|decided|current|governing)|earlier (?:plan|decision|direction)|historical rather than current|no longer (?:current|governing|the plan)|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale|instead)\b/i.test(value)) {
    signals.push("supersession");
  }
  if (/\b(?:must(?: not)?|has to|have to|needs? to|do not|does not|don't|never|avoid|preserve|required|requires|under\s+\$?\d|no more than|at most|ceiling|limit|prohibits?|not (?:supplied|provided|allowed)|bring (?:their|your|our|his|her|its) own|until|unless|only if|only after|before|after|stop|defer|frozen|remain frozen)\b/i.test(value)) {
    signals.push("constraint");
  }
  if (/\b(?:current (?:direction|plan|work|state|objective|phase|surface|choice|decision|site|timing|gear|transportation|food|(?:important )?packing requirements)|working choice|preferred (?:choice|option|site|direction)|remains? (?:preferred|current|the plan)|is now|are now|begins now|prioriti[sz]e|proceed with|the next task is|make .{1,80} (?:current|preferred)|responsib(?:le|ility)|will bring)\b/i.test(value)) {
    signals.push("current_direction");
  }
  if (/\b(?:next (?:actual )?action|next (?:actual )?step|next task|do next|build next|before anything else|continue (?:now|with)|begin (?:now|with)|start (?:now|with)|immediate(?:ly)? after|choose and (?:freeze|continue|begin|start)|reserve .{0,100} next|check .{0,100} then (?:reserve|book|continue))\b/i.test(value)) {
    signals.push("next_action");
  }
  if (/\b(?:uncertain|unresolved|undecided|open question|open loop|open work|proof question|unknown|missing state|not yet|not confirmed|not established|provisional|pending evidence|remains to be|stay on hold|deferred until)\b/i.test(value)
    || /^(?:could|whether|will)\b[^?]{12,}\?$/i.test(value.trim())) {
    signals.push("uncertainty");
  }
  if (/^[A-Z][A-Za-z0-9 /+_-]{2,48}\s+(?:means|refers to|answers|is defined as)\b/m.test(value)
    || /\b(?:Plan|Route|Option|Version|Mode|Tier)\s+[A-Z0-9][A-Za-z0-9_-]*\s+means\b/i.test(value)
    || /\b(?:we call this|call .{1,60}(?:plan|option|route|version)|the term .{1,48} means|local meaning|shared term)\b/i.test(value)) {
    signals.push("shared_term");
  }
  if (/\b(?:because|therefore|so that|\bso\b|means|depends on|affects|changes how|materially alters|in order to|the reason|required rationale|rationale|caused|before widening|proof[^.]{0,100}first)\b/i.test(value)) {
    signals.push("connection");
  }
  return signals;
}

// Mature evidence discovery is a frozen, deterministic boundary. Candidate
// construction may refine its semantic classifiers without changing which
// Exact events the accepted discovery version selects.
function discoveryContinuitySignals(value: string): ContinuitySignal[] {
  const signals: ContinuitySignal[] = [];
  if (/\b(?:correction|corrected|incorrect|misunderstood|instead|rather than|not the right|no longer applies)\b/i.test(value)) {
    signals.push("correction");
  }
  if (/\b(?:supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|previously|earlier (?:plan|decision|direction)|historical rather than current|no longer (?:current|governing))\b/i.test(value)) {
    signals.push("supersession");
  }
  if (/\b(?:must(?: not)?|do not|don't|never|avoid|preserve|required|requires|until|unless|only if|only after|before|after|stop|defer|frozen|remain frozen)\b/i.test(value)) {
    signals.push("constraint");
  }
  if (/\b(?:current (?:direction|plan|work|state|objective|phase|surface)|is now|are now|begins now|prioriti[sz]e|proceed with|the next task is)\b/i.test(value)) {
    signals.push("current_direction");
  }
  if (/\b(?:next action|next step|next task|do next|build next|continue (?:now|with)|begin (?:now|with)|start (?:now|with)|immediate(?:ly)? after|choose and (?:freeze|continue|begin|start))\b/i.test(value)) {
    signals.push("next_action");
  }
  if (/\b(?:uncertain|uncertainty|unresolved|open question|open loop|unknown|missing state|not yet|provisional|pending evidence|remains to be)\b/i.test(value)
    || /^(?:can|could|whether|will)\b[^?]{12,}\?$/i.test(value.trim())) {
    signals.push("uncertainty");
  }
  if (/^[A-Z][A-Za-z0-9 /+_-]{2,48}\s+(?:means|refers to|answers|is defined as)\b/m.test(value)
    || /\b(?:we call this|the term .{1,48} means|local meaning|shared term)\b/i.test(value)) {
    signals.push("shared_term");
  }
  if (/\b(?:because|therefore|so that|depends on|affects|changes how|materially alters|in order to|the reason)\b/i.test(value)) {
    signals.push("connection");
  }
  return signals;
}

function cleanAtomicUnit(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^(?:[-*+] |\d+[.)] )/u, "")
    .trim();
}

function atomicUnits(event: Row) {
  const raw = eventStatement(event).replace(/\r\n?/gu, "\n");
  const paragraphs = raw.split(/\n\s*\n/gu).map((value) => value.trim()).filter(Boolean);
  const grouped: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    let value = paragraphs[index];
    const heading = value.length <= 160 && /:\s*$/u.test(value) && !/[.!?]\s*$/u.test(value);
    if (heading && index + 1 < paragraphs.length) {
      const dependentBody = paragraphs[index + 1];
      const bodyIsAnotherHeading = dependentBody.length <= 160
        && /:\s*$/u.test(dependentBody)
        && !/[.!?]\s*$/u.test(dependentBody);
      if (!bodyIsAnotherHeading && `${value}\n${dependentBody}`.length <= 700) {
        index += 1;
        value = `${value}\n${dependentBody}`;
      }
      while (index + 1 < paragraphs.length
        && /^(?:[-*+] |\d+[.)] )/u.test(paragraphs[index + 1])
        && `${value}\n${paragraphs[index + 1]}`.length <= 700) {
        index += 1;
        value = `${value}\n${paragraphs[index]}`;
      }
    }
    grouped.push(value);
  }

  const units: string[] = [];
  for (const block of grouped) {
    const cleanedBlock = cleanAtomicUnit(block);
    if (cleanedBlock.length <= 700) {
      units.push(cleanedBlock);
      continue;
    }
    const lines = block.split(/\n+/gu).map(cleanAtomicUnit).filter(Boolean);
    for (const line of lines) {
      if (line.length <= 700) {
        units.push(line);
        continue;
      }
      units.push(...line.split(/(?<=[.!?])\s+/gu).map(cleanAtomicUnit).filter(Boolean));
    }
  }
  return units.filter((value) => value.length >= 24 && value.length <= 700);
}

function discoveryAtomicUnits(event: Row) {
  const raw = eventStatement(event).replace(/\r\n?/gu, "\n");
  const paragraphs = raw.split(/\n\s*\n/gu).map((value) => value.trim()).filter(Boolean);
  const grouped: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    let value = paragraphs[index];
    if (value.endsWith(":")) {
      while (index + 1 < paragraphs.length
        && /^(?:[-*+] |\d+[.)] )/u.test(paragraphs[index + 1])
        && `${value}\n${paragraphs[index + 1]}`.length <= 700) {
        index += 1;
        value = `${value}\n${paragraphs[index]}`;
      }
    }
    grouped.push(value);
  }

  const units: string[] = [];
  for (const block of grouped) {
    const cleanedBlock = cleanAtomicUnit(block);
    if (cleanedBlock.length <= 700) {
      units.push(cleanedBlock);
      continue;
    }
    const lines = block.split(/\n+/gu).map(cleanAtomicUnit).filter(Boolean);
    for (const line of lines) {
      if (line.length <= 700) {
        units.push(line);
        continue;
      }
      units.push(...line.split(/(?<=[.!?])\s+/gu).map(cleanAtomicUnit).filter(Boolean));
    }
  }
  return units.filter((value) => value.length >= 24 && value.length <= 700);
}

type MatureUnit = {
  event: Row;
  evidenceEvents: Row[];
  statement: string;
  sequence: number;
  signals: ContinuitySignal[];
  score: number;
  clusterKind: "atomic" | "supersession_cluster" | "causal_state_cluster";
};

type StateValidity = "current" | "still_governing_historical" | "completed" | "superseded" | "expired" | "unresolved" | "historical_source_only";

type CandidateRole =
  | "current_direction"
  | "next_action"
  | "constraint"
  | "correction_guard"
  | "rationale"
  | "uncertainty"
  | "shared_term"
  | "connection";

type CandidateSeed = {
  unit: MatureUnit;
  roles: CandidateRole[];
};

type CandidateConstruction = {
  candidates: FindingCandidate[];
  metadata: Record<string, unknown>;
};

function matureUnitScore(event: Row, statement: string, signals: ContinuitySignal[], maximumSequence: number) {
  const weights: Record<ContinuitySignal, number> = {
    correction: 13,
    supersession: 13,
    constraint: 9,
    current_direction: 11,
    next_action: 11,
    uncertainty: 7,
    shared_term: 6,
    connection: 4,
  };
  const sequence = sourceSequence(event) || 0;
  const recency = maximumSequence > 0 ? Math.floor((sequence / maximumSequence) * 8) : 0;
  const actor = sourceActorType(event) === "user" ? 5 : sourceActorType(event) === "assistant" ? 1 : 0;
  const transientPenalty = /\b(?:coffee|airport|wifi|screenshot|scheduling|styling|naming idea|i(?:’|')m (?:checking|running|waiting|capturing))\b/i.test(statement) ? 9 : 0;
  return signals.reduce((total, signal) => total + weights[signal], 0) + recency + actor - transientPenalty;
}

function historicalDirectionQuality(value: string) {
  return Number(/\bearly accepted direction\b/iu.test(value)) * 8
    + Number(/\b(?:earlier|previous|historical|original)\b[\s\S]{0,120}\b(?:direction|plan|decision|state)\b/iu.test(value)) * 4
    + Number(/\b(?:build|prioriti[sz]e|run|begin|continue|use|ship|launch)\b[\s\S]{0,100}\bnext\b/iu.test(value)) * 3;
}

function replacementDirectionQuality(value: string) {
  return Number(/\bexplicit correction\b/iu.test(value)) * 8
    + Number(/\bdo not\b[\s\S]{0,220}\b(?:prioriti[sz]e|instead|supersed|replace|changed to)\b/iu.test(value)) * 5
    + Number(/\b(?:replaced by|superseded by|changed to)\b/iu.test(value)) * 4;
}

function causalRationaleQuality(value: string) {
  return Number(/\brequired rationale\b/iu.test(value)) * 8
    + Number(/\b(?:too complex|too complicated|difficult to understand)\b/iu.test(value)) * 7
    + Number(/\b(?:continuity primitive|prove continuity|proof[^.]{0,100}before|before widening)\b/iu.test(value)) * 6
    + Number(/\b(?:because|therefore|the reason|rationale)\b/iu.test(value)) * 3;
}

function completeCausalSupersession(value: string) {
  return historicalDirectionQuality(value) >= 7
    && replacementDirectionQuality(value) >= 5
    && /\b(?:supersed|replac|changed to|do not)\b/iu.test(value);
}

function currentOrientationQuality(unit: MatureUnit) {
  return Number(/\bcurrent direction\b/iu.test(unit.statement)) * 10
    + Number(unit.signals.includes("current_direction")) * 6
    + Number(unit.signals.includes("next_action")) * 3
    + Number(/\b(?:begins now|continue now|start now|the next (?:task|action|step) is)\b/iu.test(unit.statement)) * 4;
}

function matureUnits(events: Row[]) {
  const maximumSequence = Math.max(0, ...events.map((event) => sourceSequence(event) || 0));
  const completedEvents = completionRelationships(events);
  const baseUnits = events.flatMap((event) => {
    const statements = atomicUnits(event);
    const atomic: MatureUnit[] = statements.flatMap((statement) => {
      const signals = continuitySignals(statement);
      if (!signals.length) return [];
      return [{
        event,
        evidenceEvents: [event],
        statement,
        sequence: sourceSequence(event) || 0,
        signals,
        score: matureUnitScore(event, statement, signals, maximumSequence),
        clusterKind: "atomic" as const,
      } satisfies MatureUnit];
    });
    const best = (quality: (value: string) => number) => statements
      .map((statement) => ({ statement, quality: quality(statement) }))
      .filter(({ quality }) => quality > 0)
      .sort((left, right) => right.quality - left.quality || left.statement.localeCompare(right.statement))[0]?.statement;
    const historical = best(historicalDirectionQuality);
    const replacement = best(replacementDirectionQuality);
    const rationale = best(causalRationaleQuality);
    const clusterParts = [historical, replacement, rationale]
      .filter((statement, index, values): statement is string => Boolean(statement) && values.indexOf(statement) === index);
    const clusterStatement = historical && replacement
      ? clusterParts.join("\n")
      : null;
    if (clusterStatement && clusterStatement.length <= 1400 && completeCausalSupersession(clusterStatement)) {
      const signals = [...new Set([...continuitySignals(clusterStatement), "correction", "supersession"])] as ContinuitySignal[];
      atomic.push({
        event,
        evidenceEvents: [event],
        statement: clusterStatement,
        sequence: sourceSequence(event) || 0,
        signals,
        score: matureUnitScore(event, clusterStatement, signals, maximumSequence) + 8,
        clusterKind: "supersession_cluster",
      });
    }
    return atomic;
  });
  const expanded = baseUnits
    .filter((unit) => unit.clusterKind === "supersession_cluster" && causalRationaleQuality(unit.statement) > 0)
    .flatMap((unit): MatureUnit[] => {
      const latestCurrent = baseUnits
        .filter((candidate) => candidate.clusterKind === "atomic"
          && candidate.sequence > unit.sequence
          && !completedEvents.has(String(candidate.event.id))
          && sourceActorType(candidate.event) === "user"
          && explicitCurrentOrientation(candidate)
          && termOverlap(unit.statement, candidate.statement).count >= 2)
        .sort((left, right) => currentOrientationQuality(right) - currentOrientationQuality(left)
          || termOverlap(unit.statement, right.statement).count - termOverlap(unit.statement, left.statement).count
          || right.sequence - left.sequence
          || compareMatureUnits(left, right))[0];
      if (!latestCurrent) return [];
      const statement = `${unit.statement}\n${latestCurrent.statement}`;
      if (statement.length > 1800) return [];
      const signals = [...new Set([...unit.signals, ...latestCurrent.signals, "correction", "supersession", "connection"])] as ContinuitySignal[];
      return [{
        event: latestCurrent.event,
        evidenceEvents: [...new Map([...unit.evidenceEvents, ...latestCurrent.evidenceEvents].map((event) => [String(event.id), event])).values()],
        statement,
        sequence: latestCurrent.sequence,
        signals,
        score: matureUnitScore(latestCurrent.event, statement, signals, maximumSequence) + 16 + causalRationaleQuality(unit.statement),
        clusterKind: "causal_state_cluster" as const,
      } satisfies MatureUnit];
    });
  return [...baseUnits, ...expanded];
}

function discoveryMatureUnits(events: Row[]) {
  const maximumSequence = Math.max(0, ...events.map((event) => sourceSequence(event) || 0));
  return events.flatMap((event) => discoveryAtomicUnits(event).flatMap((statement) => {
    const signals = discoveryContinuitySignals(statement);
    if (!signals.length) return [];
    return [{
      event,
      evidenceEvents: [event],
      statement,
      sequence: sourceSequence(event) || 0,
      signals,
      score: matureUnitScore(event, statement, signals, maximumSequence),
      clusterKind: "atomic" as const,
    } satisfies MatureUnit];
  }));
}

function compareMatureUnits(left: MatureUnit, right: MatureUnit) {
  return right.score - left.score
    || right.signals.length - left.signals.length
    || right.sequence - left.sequence
    || left.statement.localeCompare(right.statement)
    || String(left.event.id).localeCompare(String(right.event.id));
}

function candidateRoles(unit: MatureUnit): CandidateRole[] {
  const roles: CandidateRole[] = [];
  if (unit.signals.includes("current_direction")) roles.push("current_direction");
  if (unit.signals.includes("next_action")) roles.push("next_action");
  if (unit.signals.includes("constraint")) roles.push("constraint");
  if (unit.signals.includes("correction") || unit.signals.includes("supersession")) roles.push("correction_guard");
  if (unit.signals.includes("connection")) roles.push("rationale", "connection");
  if (unit.signals.includes("uncertainty")) roles.push("uncertainty");
  if (unit.signals.includes("shared_term")) roles.push("shared_term");
  return roles;
}

function explicitCurrentOrientation(unit: MatureUnit) {
  return /\b(?:begins now|current (?:direction|plan|work|state|objective|phase|surface)|the next (?:task|action|step) is|prioriti[sz]e|proceed with|continue now|start now)\b/i.test(unit.statement);
}

function specificCurrentOrientation(unit: MatureUnit) {
  return /\bcurrent\s+(?!direction\b)[a-z][a-z-]{1,30}(?:\s+[a-z][a-z-]{1,30})?\s+(?:decision|plan|choice|state|rule|requirements|is|are)\b/iu.test(unit.statement)
    || /\b(?:is now|are now|remains?|stays?)\s+(?:the )?(?:governing|preferred|current)\b/iu.test(unit.statement);
}

function orientationSubject(unit: MatureUnit) {
  return unit.statement.match(/\bcurrent\s+([a-z][a-z-]{1,30})\b/iu)?.[1]?.toLowerCase() || null;
}

function sameOrientationCluster(left: MatureUnit, right: MatureUnit) {
  const leftSubject = orientationSubject(left);
  const rightSubject = orientationSubject(right);
  if (leftSubject && rightSubject) return leftSubject === rightSubject;
  if (leftSubject) return new RegExp(`\\b${leftSubject}\\b`, "iu").test(right.statement);
  if (rightSubject) return new RegExp(`\\b${rightSubject}\\b`, "iu").test(left.statement);
  return candidateClusterOverlap(left.statement, right.statement) >= 3;
}

function currentBoundarySequence(units: MatureUnit[]) {
  const explicitUserDirections = units.filter((unit) =>
    sourceActorType(unit.event) === "user"
    && unit.signals.includes("current_direction")
    && explicitCurrentOrientation(unit),
  );
  if (explicitUserDirections.length) return Math.max(...explicitUserDirections.map((unit) => unit.sequence));
  const explicitUserActions = units.filter((unit) =>
    sourceActorType(unit.event) === "user"
    && unit.signals.includes("next_action")
    && explicitCurrentOrientation(unit),
  );
  return explicitUserActions.length
    ? Math.max(...explicitUserActions.map((unit) => unit.sequence))
    : Math.max(0, ...units.filter((unit) => sourceActorType(unit.event) === "user").map((unit) => unit.sequence));
}

function termOverlap(left: string, right: string) {
  const leftTerms = normalizedTerms(left);
  const rightTerms = normalizedTerms(right);
  const smaller = Math.min(leftTerms.size, rightTerms.size);
  if (!smaller) return { count: 0, ratio: 0 };
  let overlap = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) overlap += 1;
  return { count: overlap, ratio: overlap / smaller };
}

function candidateClusterOverlap(left: string, right: string) {
  const terms = (value: string) => new Set([
    ...normalizedTerms(value),
    ...(value.match(/\b[A-Z]\b/g) || []).map((term) => `identity:${term}`),
  ]);
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  let count = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) count += 1;
  return count;
}

function functionallyRedundant(left: CandidateSeed, right: CandidateSeed) {
  for (const protectedRole of ["correction_guard", "uncertainty", "shared_term"] satisfies CandidateRole[]) {
    if (left.roles.includes(protectedRole) && !right.roles.includes(protectedRole)) return false;
  }
  const sharedRoles = left.roles.filter((role) => right.roles.includes(role));
  const roleRatio = sharedRoles.length / Math.max(1, new Set([...left.roles, ...right.roles]).size);
  const overlap = termOverlap(left.unit.statement, right.unit.statement);
  const adjacentParaphrase = Math.abs(left.unit.sequence - right.unit.sequence) <= 1
    && overlap.count >= 2
    && overlap.ratio >= 0.4
    && roleRatio >= 0.5;
  const sameContinuationSeed = (
    left.roles.includes("current_direction")
    && right.roles.includes("current_direction")
    && sameOrientationCluster(left.unit, right.unit)
  ) || (
    left.roles.includes("next_action")
    && right.roles.includes("next_action")
    && ((overlap.count >= 2 && overlap.ratio >= 0.35)
      || candidateClusterOverlap(left.unit.statement, right.unit.statement) >= 3)
  );
  const sameSharedTerm = left.roles.includes("shared_term")
    && right.roles.includes("shared_term")
    && candidateClusterOverlap(left.unit.statement, right.unit.statement) >= 2;
  const timeMarkers = (value: string) => new Set(value.toUpperCase().match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/g) || []);
  const leftTimes = timeMarkers(left.unit.statement);
  const rightTimes = timeMarkers(right.unit.statement);
  const sameTemporalDependency = left.roles.includes("constraint")
    && right.roles.includes("constraint")
    && (left.roles.includes("current_direction") || right.roles.includes("current_direction"))
    && [...leftTimes].some((marker) => rightTimes.has(marker));
  return sameSharedTerm || sameContinuationSeed || sameTemporalDependency || (sharedRoles.length > 0
    && roleRatio >= 0.5
    && ((overlap.count >= 3 && overlap.ratio >= 0.55) || adjacentParaphrase));
}

function assistantRestatementOfUser(unit: MatureUnit, candidates: MatureUnit[]) {
  if (sourceActorType(unit.event) !== "assistant") return false;
  return candidates.some((candidate) => {
    if (sourceActorType(candidate.event) !== "user") return false;
    const overlap = termOverlap(unit.statement, candidate.statement);
    const adjacent = Math.abs(unit.sequence - candidate.sequence) <= 2;
    return overlap.count >= 3 && overlap.ratio >= 0.3
      || adjacent && overlap.count >= 1
      || candidateRoles(unit).includes("current_direction")
        && candidateRoles(candidate).includes("current_direction")
        && sameOrientationCluster(unit, candidate);
  });
}

function compareForRole(left: MatureUnit, right: MatureUnit, role: CandidateRole, boundary: number) {
  const currentRole = ["current_direction", "next_action", "constraint", "rationale"].includes(role);
  const currentTier = (unit: MatureUnit) => currentRole
    ? Number(unit.sequence >= boundary) * 3 + Number(explicitCurrentOrientation(unit)) * 2
    : 0;
  const correctionGuardQuality = (unit: MatureUnit) => role === "correction_guard"
    ? Number(unit.signals.includes("correction"))
      + Number(unit.signals.includes("supersession"))
      + Number(/^correction\b/i.test(unit.statement.trim()))
    : 0;
  return currentTier(right) - currentTier(left)
    || correctionGuardQuality(right) - correctionGuardQuality(left)
    || Number(sourceActorType(right.event) === "user") - Number(sourceActorType(left.event) === "user")
    || right.sequence - left.sequence
    || compareMatureUnits(left, right);
}

function nakedStructuralFragment(value: string) {
  const trimmed = value.trim();
  return /(?:→|↓|->|=>)\s*(?:superseded|corrected|replaced)?\s*$/iu.test(trimmed)
    || /:\s*$/u.test(trimmed)
    || /\b(?:because|before|after|until|unless|only if|only after|if|when)\s*$/iu.test(trimmed)
    || /^(?:current|previous|previously|why|rationale|stopping rule|next action|context delivery answers|state truth answers)\s*$/iu.test(trimmed);
}

function completeSupersession(unit: MatureUnit) {
  if (unit.clusterKind === "supersession_cluster" || unit.clusterKind === "causal_state_cluster") {
    return completeCausalSupersession(unit.statement);
  }
  const closesPriorState = /\b(?:correction|corrected|wrong|mistaken|supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|no longer|cannot work|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale|instead)\b/iu.test(unit.statement);
  const statesResult = /\b(?:current|now|remains?|use|take|leave|bring|reserve|keep|decide|defer|out|scratch|rejected|dropped|obsolete|stale|cannot|do not|don't|not (?:provided|supplied|allowed))\b/iu.test(unit.statement);
  return closesPriorState && statesResult && unit.signals.includes("supersession");
}

function completeConstraint(value: string) {
  const directive = value.match(/\b(?:must(?: not)?|do not|don't|never|avoid|preserve|required|requires|until|unless|only if|only after|before|after|stop|defer|frozen|remain frozen)\b/iu);
  if (!directive) return true;
  const remainder = value.slice((directive.index || 0) + directive[0].length).match(/[A-Za-z0-9][A-Za-z0-9_-]*/gu) || [];
  const relationalBoundary = /^(?:until|unless|only if|only after|before|after)$/iu.test(directive[0]);
  return remainder.length >= (relationalBoundary ? 1 : 3) && !nakedStructuralFragment(value);
}

function completeProposition(unit: MatureUnit) {
  if (nakedStructuralFragment(unit.statement)) return false;
  if (unit.statement.trim().length < 32) return false;
  if (/\bnext action is not\b/iu.test(unit.statement)
    && !/\b(?:instead|rather|next action is to|next action remains|then (?:update|check|confirm|reserve|book|prepare|send|build|run))\b/iu.test(unit.statement)) return false;
  if (unit.signals.length === 1
    && unit.signals[0] === "constraint"
    && !/\b(?:must|has to|have to|do not|don't|never|only if|only after|unless|required|fixed|limit|ceiling|stop|defer|frozen)\b/iu.test(unit.statement)) return false;
  const roles = candidateRoles(unit);
  if (roles.includes("correction_guard") && !completeSupersession(unit)) return false;
  if (roles.includes("constraint") && !completeConstraint(unit.statement)) return false;
  if (roles.includes("shared_term") && !/[\n:][\s\S]{12,}/u.test(unit.statement)
    && !/\b(?:means|refers to|is defined as)\b[\s\S]{12,}/iu.test(unit.statement)) return false;
  return true;
}

function completionEvidence(event: Row) {
  return /\b(?:is complete|are complete|has completed|have completed|completed|committed|accepted|passed|now verified|successfully simplified|successfully completed|ready for|is now frozen|are now frozen|now frozen)\b/iu.test(eventStatement(event));
}

function assistantWorkflowStatus(unit: MatureUnit) {
  return sourceActorType(unit.event) === "assistant"
    && /\b(?:i(?:’|')m|i am|i(?:’|')ll|i will|we(?:’|')re|we are|we(?:’|')ll|we will)\b/iu.test(unit.statement)
    && /\b(?:using|starting|running|checking|mapping|capturing|rendering|testing|verifying|workflow|slice|build|deploy)\b/iu.test(unit.statement);
}

function explicitlyNonGoverningUnit(unit: MatureUnit) {
  return /\b(?:not yet a change to (?:the )?(?:plan|decision|state)|does not affect (?:the )?(?:trip|project|work).{0,40}(?:current|working) state|can wait and does not govern)\b/iu.test(unit.statement);
}

function phaseBoundInstruction(event: Row) {
  return /\b(?:this slice|this proof|this run|part\s+\d+[a-z]?|acceptance (?:gate|criteria)|rubric|checklist)\b/iu.test(eventStatement(event));
}

function relationshipTerms(value: string) {
  const generic = new Set([
    "atlas", "campus", "context", "continue", "current", "exact", "project", "proof",
    "room", "source", "state", "transfer", "user", "work",
  ]);
  return new Set([...normalizedTerms(value)].filter((term) => !generic.has(term)));
}

function relationshipAnchors(value: string) {
  return new Set((value.toLowerCase().match(/\b(?:part|slice)\s+\d+[a-z]?\b/gu) || [])
    .map((anchor) => anchor.replace(/\s+/gu, " ")));
}

function explicitReferentialClosure(event: Row, completion: Row) {
  const source = eventStatement(event);
  const later = eventStatement(completion);
  for (const noun of ["checklist", "criteria", "rubric", "slice", "proof", "test", "audit", "trim"]) {
    if (new RegExp(`\\b${noun}\\b`, "iu").test(source)
      && new RegExp(`\\b(?:this|that|the|those|these)\\b[^.!?]{0,60}\\b${noun}\\b`, "iu").test(later)) return true;
  }
  return false;
}

function completionRelationships(events: Row[]) {
  const completed = new Map<string, Row[]>();
  const completions = events.filter(completionEvidence);
  for (const event of events) {
    const eventSequence = sourceSequence(event) || 0;
    if (!phaseBoundInstruction(event)) continue;
    const terms = relationshipTerms(eventStatement(event));
    const anchors = relationshipAnchors(eventStatement(event));
    const matches: { completion: Row; score: number; distance: number }[] = [];
    for (const completion of completions) {
      const completionSequence = sourceSequence(completion) || 0;
      if (completionSequence <= eventSequence) continue;
      let overlap = 0;
      for (const term of relationshipTerms(eventStatement(completion))) if (terms.has(term)) overlap += 1;
      const completionAnchors = relationshipAnchors(eventStatement(completion));
      const sharedAnchor = [...anchors].some((anchor) => completionAnchors.has(anchor));
      const referential = explicitReferentialClosure(event, completion);
      if (!sharedAnchor && overlap < 3 && !referential) continue;
      matches.push({
        completion,
        score: Number(sharedAnchor) * 12 + Number(referential) * 8 + Math.min(overlap, 8),
        distance: completionSequence - eventSequence,
      });
    }
    const best = matches.sort((left, right) => right.score - left.score || left.distance - right.distance
      || String(left.completion.id).localeCompare(String(right.completion.id)))[0];
    if (best) {
      completed.set(String(event.id), [best.completion]);
    }
  }
  return completed;
}

function expirationRelationships(events: Row[]) {
  const expired = new Map<string, Row[]>();
  const resolutions = events.filter((event) => /\b(?:resolved|unblocked|no longer (?:blocked|pending|waiting)|not a current blocker|is not current)\b/iu.test(eventStatement(event)));
  for (const event of events) {
    if (!/\b(?:blocked|waiting|pending|temporary|temporarily|failing)\b/iu.test(eventStatement(event))) continue;
    const terms = normalizedTerms(eventStatement(event));
    for (const resolution of resolutions) {
      if ((sourceSequence(resolution) || 0) <= (sourceSequence(event) || 0)) continue;
      let overlap = 0;
      for (const term of normalizedTerms(eventStatement(resolution))) if (terms.has(term)) overlap += 1;
      if (overlap >= 2) expired.set(String(event.id), [...(expired.get(String(event.id)) || []), resolution]);
    }
  }
  return expired;
}

function criticalConstraint(unit: MatureUnit) {
  return unit.signals.includes("constraint")
    && /\b(?:stopping rule|stop at|do not repair|only after|only if|until|unless|must|has to|have to|under\s+\$?\d|no more than|at most|ceiling|not (?:provided|supplied|allowed))\b/iu.test(unit.statement);
}

function explicitSupersessionOf(unit: MatureUnit, possibleReplacement: MatureUnit) {
  if (possibleReplacement.sequence <= unit.sequence) return false;
  // Close an older direction when a later event rejects or replaces it. A later
  // paraphrase of an already-rejected option is corroborating evidence, not a
  // supersession of the source-grounded rejection and its rationale.
  if (!unit.signals.includes("current_direction")
    || unit.signals.includes("correction")
    || unit.signals.includes("supersession")) return false;
  if (!possibleReplacement.signals.includes("correction")
    && !possibleReplacement.signals.includes("supersession")) return false;
  if (/\b(?:do not|don't|must not)\s+(?:replace|supersede|drop|reject)\b/iu.test(possibleReplacement.statement)
    || /\b(?:remains?|stays?)\s+(?:preferred|current|the plan)\b/iu.test(possibleReplacement.statement)) return false;
  const closesPriorState = /\b(?:no longer|cannot work|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale|superseded by|replaced by)\b/iu.test(possibleReplacement.statement);
  return closesPriorState && candidateClusterOverlap(unit.statement, possibleReplacement.statement) >= 2;
}

function shortRoomClosureUnits(events: Row[]) {
  const completedEvents = completionRelationships(events);
  const expiredEvents = expirationRelationships(events);
  const supportedUnits = matureUnits(events)
    .filter((unit) => completeProposition(unit) && !assistantWorkflowStatus(unit))
    .filter((unit) => !completedEvents.has(String(unit.event.id)) && !expiredEvents.has(String(unit.event.id)))
    .filter((unit, _index, allUnits) => !allUnits.some((later) => explicitSupersessionOf(unit, later)));
  const boundary = currentBoundarySequence(supportedUnits);
  const units = supportedUnits
    .filter((unit) => !(unit.sequence < boundary
      && unit.signals.includes("current_direction")
      && !unit.signals.includes("correction")
      && !unit.signals.includes("supersession")
      && !unit.signals.includes("constraint")
      && !specificCurrentOrientation(unit)))
    .sort(compareMatureUnits);
  const seeds = units.filter((unit) => (
    unit.signals.includes("next_action")
    || unit.signals.includes("current_direction")
    || unit.signals.includes("uncertainty")
  )).sort((left, right) => {
    const priority = (unit: MatureUnit) => Number(unit.signals.includes("next_action")) * 3
      + Number(unit.signals.includes("current_direction")) * 2
      + Number(unit.signals.includes("uncertainty"));
    return priority(right) - priority(left) || right.sequence - left.sequence || compareMatureUnits(left, right);
  });
  if (!seeds.length) return [];

  const selected: MatureUnit[] = [];
  const add = (unit: MatureUnit | undefined) => {
    if (!unit || selected.includes(unit)) return;
    const redundant = selected.some((chosen) => functionallyRedundant(
      { unit, roles: candidateRoles(unit) },
      { unit: chosen, roles: candidateRoles(chosen) },
    ));
    if (!redundant) selected.push(unit);
  };
  add(seeds[0]);
  for (const role of [
    "current_direction",
    "correction_guard",
    "constraint",
    "next_action",
    "rationale",
    "uncertainty",
    "shared_term",
  ] satisfies CandidateRole[]) {
    const candidates = units
      .filter((unit) => candidateRoles(unit).includes(role))
      .sort((left, right) => Number(sourceActorType(right.event) === "user") - Number(sourceActorType(left.event) === "user")
        || Number(right.signals.includes("connection")) - Number(left.signals.includes("connection"))
        || compareMatureUnits(left, right));
    const maximum = role === "constraint" ? 4 : role === "uncertainty" ? 2 : 1;
    let added = 0;
    for (const candidate of candidates) {
      if (added >= maximum) break;
      const connected = selected.some((chosen) => {
        const relationship = termOverlap(candidate.statement, chosen.statement);
        return relationship.count >= 1
          || (Math.abs(candidate.sequence - chosen.sequence) <= 2
            && ["correction_guard", "rationale", "uncertainty"].includes(role));
      });
      const before = selected.length;
      if (connected) add(candidate);
      if (selected.length > before) added += 1;
    }
  }
  return selected.sort((left, right) => left.sequence - right.sequence || compareMatureUnits(left, right));
}

async function shortRoomFindingCandidates(events: Row[]): Promise<CandidateConstruction | null> {
  const units = shortRoomClosureUnits(events);
  if (!units.length) return null;
  const statements = [...new Set(units.map((unit) => unit.statement.trim()))];
  const statement = statements.join(" ");
  if (statement.length > 1800) return null;
  const sourceEventIds = [...new Set(units.flatMap((unit) => unit.evidenceEvents.map((event) => String(event.id))))]
    .sort((left, right) => {
      const leftEvent = events.find((event) => String(event.id) === left);
      const rightEvent = events.find((event) => String(event.id) === right);
      return leftEvent && rightEvent ? chronologicalEventOrder(leftEvent, rightEvent) : left.localeCompare(right);
    });
  const signals = [...new Set(units.flatMap((unit) => unit.signals))] as ContinuitySignal[];
  const candidate = {
    findingType: matureFindingType(signals),
    sourceEventIds,
    proposalStatement: statement,
    proposedScope: "local",
    conditions: [] as string[],
    exclusions: [] as string[],
    supportingEvidence: sourceEventIds.slice(0, -1),
    counterevidence: [] as string[],
    uncertainty: signals.includes("uncertainty")
      ? "The Exact source explicitly leaves part of this continuation closure unresolved."
      : null,
    reasonForSurfacing: "Several semantically cohesive Exact facts form one minimum complete continuation proposition.",
    expectedRetrievalEffect: "No retrieval change unless Cody governs this source-grounded continuation closure.",
  };
  return {
    candidates: [{ ...candidate, proposalHash: await sha256(JSON.stringify(candidate)) }],
    metadata: {
      version: CHECKPOINT_CANDIDATE_VERSION,
      strategy: "small_room_semantic_continuation_closure_v1",
      budget: 1,
      candidateCount: 1,
      rolesRepresented: [...new Set(units.flatMap(candidateRoles))],
      exactSourceEventIds: sourceEventIds,
      synthesisInventedClauses: false,
    },
  };
}

type EventSelection = {
  events: Row[];
  mature: boolean;
  metadata: Record<string, unknown>;
};

function selectEventsForAnalysis(events: Row[]): EventSelection {
  const sourceEvents = events.filter((event) => String(event.event_type).toLowerCase() === "source_message" && sourceSequence(event) !== null);
  if (sourceEvents.length <= MAX_SELECTED_NODES) {
    const selected = events.slice(0, MAX_SELECTED_NODES);
    return {
      events: selected,
      mature: false,
      metadata: {
        strategy: "small_room_sparse_v1",
        totalEvents: events.length,
        selectedSourceSequences: selected.flatMap((event) => sourceSequence(event) ?? []),
        omittedCount: Math.max(0, events.length - selected.length),
        selectionStoppedBecause: `The small-room bound of ${MAX_SELECTED_NODES} reasoning nodes was reached or all events were selected.`,
      },
    };
  }

  const units = discoveryMatureUnits(sourceEvents);
  const eventUnits = new Map<string, MatureUnit[]>();
  for (const unit of units) {
    const id = String(unit.event.id);
    eventUnits.set(id, [...(eventUnits.get(id) || []), unit]);
  }
  const rankedEvents = sourceEvents.map((event) => {
    const values = eventUnits.get(String(event.id)) || [];
    return {
      event,
      sequence: sourceSequence(event) || 0,
      score: values.length ? Math.max(...values.map((value) => value.score)) : -1,
      signals: new Set(values.flatMap((value) => value.signals)),
    };
  }).sort((left, right) => right.score - left.score
    || right.signals.size - left.signals.size
    || right.sequence - left.sequence
    || String(left.event.id).localeCompare(String(right.event.id)));

  const selected = new Map<string, Row>();
  const include = (event: Row | undefined) => {
    if (event) selected.set(String(event.id), event);
  };
  const maximumSequence = Math.max(...rankedEvents.map(({ sequence }) => sequence));
  for (const [start, end] of [[1, Math.ceil(maximumSequence / 3)], [Math.ceil(maximumSequence / 3) + 1, Math.ceil(maximumSequence * 2 / 3)], [Math.ceil(maximumSequence * 2 / 3) + 1, maximumSequence]]) {
    include(rankedEvents.find(({ sequence }) => sequence >= start && sequence <= end)?.event);
  }
  for (const entry of [...rankedEvents].sort((left, right) => right.sequence - left.sequence).slice(0, 3)) include(entry.event);
  for (const signal of CONTINUITY_SIGNAL_ORDER) {
    include(rankedEvents.find(({ signals }) => signals.has(signal))?.event);
  }
  for (const entry of rankedEvents) {
    if (selected.size >= MAX_MATURE_SELECTED_NODES) break;
    if (entry.score >= 0) include(entry.event);
  }
  for (const event of events.filter((candidate) => String(candidate.event_type).toLowerCase() !== "source_message")) {
    if (selected.size >= MAX_MATURE_SELECTED_NODES) break;
    include(event);
  }

  const bounded = [...selected.values()]
    .sort(chronologicalEventOrder)
    .slice(0, MAX_MATURE_SELECTED_NODES);
  const selectedSequences = bounded.flatMap((event) => sourceSequence(event) ?? []);
  const categories = [...new Set(bounded.flatMap((event) =>
    (eventUnits.get(String(event.id)) || []).flatMap((unit) => unit.signals),
  ))].sort((left, right) => CONTINUITY_SIGNAL_ORDER.indexOf(left) - CONTINUITY_SIGNAL_ORDER.indexOf(right));
  return {
    events: bounded,
    mature: true,
    metadata: {
      strategy: "mature_room_chronology_signal_coverage_v1",
      classifierVersion: "mature_room_discovery_signals_v1",
      totalEvents: events.length,
      totalSourceMessageEvents: sourceEvents.length,
      selectedSourceSequences: selectedSequences,
      chronologySpan: selectedSequences.length ? { first: Math.min(...selectedSequences), last: Math.max(...selectedSequences) } : null,
      signalCategoriesRepresented: categories,
      omittedCount: Math.max(0, events.length - bounded.length),
      selectionStoppedBecause: `The deterministic mature-room bound of ${MAX_MATURE_SELECTED_NODES} reasoning nodes was reached after chronology thirds, current tail, continuity-signal categories, and ranked fill were covered.`,
    },
  };
}

function matureFindingType(signals: ContinuitySignal[]) {
  if (signals.includes("supersession")) return "supersession";
  if (signals.includes("correction")) return "correction";
  if (signals.includes("constraint")) return "scope_revision";
  return "mechanism_recognition";
}

async function matureFindingCandidates(selectedEvents: Row[]): Promise<CandidateConstruction> {
  const discoveredUnits = matureUnits(selectedEvents).sort(compareMatureUnits);
  const boundary = currentBoundarySequence(discoveredUnits);
  const completedEvents = completionRelationships(selectedEvents);
  const expiredEvents = expirationRelationships(selectedEvents);
  const incompleteUnits = new Set(discoveredUnits.filter((unit) => !completeProposition(unit)));
  const structurallyCompleteUnits = discoveredUnits.filter((unit) => !incompleteUnits.has(unit));
  const currentTerms = new Set(structurallyCompleteUnits
    .filter((unit) => unit.sequence >= boundary)
    .flatMap((unit) => [...normalizedTerms(unit.statement)]));
  const relationshipCount = (unit: MatureUnit) => {
    let count = 0;
    for (const term of normalizedTerms(unit.statement)) if (currentTerms.has(term)) count += 1;
    return count;
  };
  const causalEvidenceEventIds = new Set(structurallyCompleteUnits
    .filter((unit) => unit.clusterKind !== "atomic" && completeCausalSupersession(unit.statement))
    .flatMap((unit) => unit.evidenceEvents.map((event) => String(event.id))));
  const stateValidity = (unit: MatureUnit): StateValidity => {
    if (explicitlyNonGoverningUnit(unit)) return "historical_source_only";
    if (unit.clusterKind === "causal_state_cluster") return "current";
    if (unit.clusterKind === "supersession_cluster" && completeCausalSupersession(unit.statement)) {
      return "still_governing_historical";
    }
    const eventId = String(unit.event.id);
    if (expiredEvents.has(eventId)) return "expired";
    if (completedEvents.has(eventId) || assistantWorkflowStatus(unit)) {
      return unit.signals.includes("shared_term") ? "still_governing_historical" : "completed";
    }
    if (structurallyCompleteUnits.some((later) => explicitSupersessionOf(unit, later))) return "superseded";
    if (unit.clusterKind === "atomic"
      && causalEvidenceEventIds.has(eventId)
      && historicalDirectionQuality(unit.statement) >= 4
      && replacementDirectionQuality(unit.statement) === 0) return "superseded";
    if (unit.sequence < boundary
      && unit.signals.includes("current_direction")
      && !unit.signals.includes("correction")
      && !unit.signals.includes("supersession")
      && !unit.signals.includes("constraint")
      && !unit.signals.includes("shared_term")
      && !specificCurrentOrientation(unit)) return "superseded";
    if (unit.signals.includes("uncertainty")) return "unresolved";
    if (explicitCurrentOrientation(unit)
      || (sourceActorType(unit.event) === "user"
        && (unit.signals.includes("current_direction") || unit.signals.includes("next_action")))) return "current";
    if (unit.sequence >= boundary) return "current";
    if (unit.signals.includes("shared_term")
      || criticalConstraint(unit)
      || unit.signals.includes("correction")
      || unit.signals.includes("supersession")
      || (unit.signals.includes("constraint") && sourceActorType(unit.event) === "user")
      || relationshipCount(unit) >= 2) {
      return "still_governing_historical";
    }
    return "historical_source_only";
  };
  const validityByUnit = new Map(structurallyCompleteUnits.map((unit) => [unit, stateValidity(unit)]));
  const staleUnits = new Set(structurallyCompleteUnits.filter((unit) =>
    ["completed", "superseded", "expired"].includes(validityByUnit.get(unit) || ""),
  ));
  const completeUnits = structurallyCompleteUnits.filter((unit) => !staleUnits.has(unit));
  const directlyRelevant = (unit: MatureUnit) => ["current", "still_governing_historical", "unresolved"].includes(validityByUnit.get(unit) || "");
  const relevantUnits = completeUnits.filter(directlyRelevant);
  const units = relevantUnits.filter((unit) => !assistantRestatementOfUser(unit, relevantUnits));
  const selected: CandidateSeed[] = [];
  const redundantUnits = new Set<MatureUnit>();
  const add = (unit: MatureUnit | undefined) => {
    if (!unit || selected.length >= MAX_MATURE_FINDINGS) return false;
    const seed = { unit, roles: candidateRoles(unit) };
    if (!seed.roles.length) return false;
    const duplicate = selected.find((candidate) => functionallyRedundant(seed, candidate));
    if (duplicate) {
      if (seed.roles.includes("current_direction") && !duplicate.roles.includes("current_direction")) {
        const duplicateIndex = selected.indexOf(duplicate);
        redundantUnits.add(duplicate.unit);
        selected.splice(duplicateIndex, 1, seed);
        return true;
      }
      if (criticalConstraint(unit) && !criticalConstraint(duplicate.unit)) {
        if (duplicate.roles.includes("current_direction") && !seed.roles.includes("current_direction")) {
          redundantUnits.add(unit);
          return false;
        }
        const duplicateIndex = selected.indexOf(duplicate);
        redundantUnits.add(duplicate.unit);
        selected.splice(duplicateIndex, 1, seed);
        return true;
      }
      redundantUnits.add(unit);
      return false;
    }
    selected.push(seed);
    return true;
  };
  const rankedForRole = (role: CandidateRole) => units
    .filter((unit) => candidateRoles(unit).includes(role))
    .sort((left, right) => {
      const dependencyRole = ["correction_guard", "rationale", "connection", "constraint"].includes(role);
      const statePriorities: Partial<Record<StateValidity, number>> = {
        current: 4,
        unresolved: 3,
        still_governing_historical: 2,
      };
      const statePriority = (unit: MatureUnit) => statePriorities[validityByUnit.get(unit) || "historical_source_only"] || 0;
      return statePriority(right) - statePriority(left)
        || (role === "constraint" ? Number(criticalConstraint(right)) - Number(criticalConstraint(left)) : 0)
        || (dependencyRole ? causalRationaleQuality(right.statement) - causalRationaleQuality(left.statement) : 0)
        || (dependencyRole ? relationshipCount(right) - relationshipCount(left) : 0)
        || (role === "constraint" ? right.statement.length - left.statement.length : 0)
        || compareForRole(left, right, role, boundary);
    });

  // Reserve compact global orientation across distinct current subjects before
  // local dependency roles can consume the bounded candidate set.
  let orientationClusters = 0;
  for (const unit of rankedForRole("current_direction")) {
    if (orientationClusters >= 6 || selected.length >= MAX_MATURE_FINDINGS) break;
    if (!specificCurrentOrientation(unit)) continue;
    if (selected.some((candidate) => (
      candidate.roles.includes("current_direction")
      && sameOrientationCluster(candidate.unit, unit)
    ))) continue;
    const before = selected.length;
    if (add(unit) && selected.length > before) orientationClusters += 1;
  }
  let unresolvedClusters = 0;
  for (const unit of rankedForRole("uncertainty")) {
    if (unresolvedClusters >= 2 || selected.length >= MAX_MATURE_FINDINGS) break;
    if (selected.some((candidate) => (
      candidate.roles.includes("uncertainty")
      && candidateClusterOverlap(candidate.unit.statement, unit.statement) >= 2
    ))) continue;
    const before = selected.length;
    if (add(unit) && selected.length > before) unresolvedClusters += 1;
  }

  for (const role of [
    "next_action",
    "current_direction",
    "constraint",
    "correction_guard",
    "rationale",
    "uncertainty",
    "shared_term",
  ] satisfies CandidateRole[]) add(rankedForRole(role)[0]);

  for (const role of ["next_action", "current_direction"] satisfies CandidateRole[]) {
    let roleCount = 0;
    for (const unit of rankedForRole(role)) {
      if (roleCount >= (role === "next_action" ? 2 : 5) || selected.length >= MAX_MATURE_FINDINGS) break;
      if (role === "current_direction" && selected.some((candidate) => (
        candidate.roles.includes("current_direction")
        && sameOrientationCluster(candidate.unit, unit)
      ))) continue;
      if (add(unit)) roleCount += 1;
    }
  }

  let currentConstraints = 0;
  for (const unit of rankedForRole("constraint")) {
    if (currentConstraints >= 6 || selected.length >= MAX_MATURE_FINDINGS) break;
    if (["current", "still_governing_historical"].includes(validityByUnit.get(unit) || "") && add(unit)) currentConstraints += 1;
  }

  for (const role of ["correction_guard", "rationale", "uncertainty"] satisfies CandidateRole[]) {
    let roleCount = 0;
    for (const unit of rankedForRole(role)) {
      if (roleCount >= 3 || selected.length >= MAX_MATURE_FINDINGS) break;
      if (add(unit)) roleCount += 1;
    }
  }

  let sharedTerms = 0;
  for (const unit of rankedForRole("shared_term")) {
    if (sharedTerms >= 2 || selected.length >= MAX_MATURE_FINDINGS) break;
    if (add(unit)) sharedTerms += 1;
  }

  let persistentEarlierConstraints = 0;
  for (const unit of rankedForRole("constraint")) {
    if (persistentEarlierConstraints >= 3 || selected.length >= MAX_MATURE_FINDINGS) break;
    if (validityByUnit.get(unit) !== "still_governing_historical"
      || unit.signals.includes("correction")
      || unit.signals.includes("supersession")
      || (relationshipCount(unit) < 3 && !criticalConstraint(unit))) continue;
    if (add(unit)) persistentEarlierConstraints += 1;
  }

  // A single current subject may need both its governing statement and one
  // open/conditional guard, but further paraphrases must not crowd unrelated
  // current subjects out of the bounded reconstruction set.
  for (const seed of [...selected]) {
    if (!seed.roles.includes("current_direction")) continue;
    const cluster = selected.filter((candidate) => (
      candidate.roles.includes("current_direction")
      && sameOrientationCluster(candidate.unit, seed.unit)
    ));
    if (cluster.length <= 2) continue;
    const rankedCluster = [...cluster].sort((left, right) => {
      const protectedCount = (candidate: CandidateSeed) => ["uncertainty", "shared_term", "correction_guard"]
        .filter((role) => candidate.roles.includes(role as CandidateRole)).length;
      return protectedCount(right) - protectedCount(left)
        || right.roles.length - left.roles.length
        || compareMatureUnits(left.unit, right.unit);
    });
    for (const redundant of rankedCluster.slice(2)) {
      const index = selected.indexOf(redundant);
      if (index >= 0) selected.splice(index, 1);
      redundantUnits.add(redundant.unit);
    }
  }
  for (const unit of rankedForRole("current_direction")) {
    if (selected.length >= MAX_MATURE_FINDINGS) break;
    if (!specificCurrentOrientation(unit) || selected.some((candidate) => candidate.unit === unit)) continue;
    if (selected.some((candidate) => functionallyRedundant(
      { unit, roles: candidateRoles(unit) },
      candidate,
    ))) continue;
    add(unit);
  }
  for (const unit of rankedForRole("constraint")) {
    if (selected.length >= MAX_MATURE_FINDINGS) break;
    if (!criticalConstraint(unit) || selected.some((candidate) => candidate.unit === unit)) continue;
    add(unit);
  }

  for (const unit of units) {
    if (selected.some((seed) => seed.unit === unit)) continue;
    if (selected.some((seed) => functionallyRedundant({ unit, roles: candidateRoles(unit) }, seed))) {
      redundantUnits.add(unit);
    }
  }

  const selectedByEvent = new Map<string, CandidateSeed[]>();
  for (const seed of selected) {
    const id = String(seed.unit.event.id);
    selectedByEvent.set(id, [...(selectedByEvent.get(id) || []), seed]);
  }
  const supportingByCandidate = new Map<CandidateSeed, MatureUnit[]>();
  for (const seed of selected) {
    const supporting = completeUnits
      .filter((unit) => unit.event !== seed.unit.event && functionallyRedundant(
        { unit, roles: candidateRoles(unit) },
        seed,
      ))
      .sort(compareMatureUnits)
      .slice(0, 3);
    supportingByCandidate.set(seed, supporting);
    for (const unit of supporting) redundantUnits.add(unit);
  }

  const candidates = await Promise.all(selected.map(async (seed) => {
    const primaryId = String(seed.unit.event.id);
    const dependencyEventIds = seed.unit.evidenceEvents
      .map((event) => String(event.id))
      .filter((eventId) => eventId !== primaryId);
    const supportingEventIds = [...new Set((supportingByCandidate.get(seed) || [])
      .flatMap((unit) => unit.evidenceEvents.map((event) => String(event.id))))];
    const sourceEventIds = [...new Set([...dependencyEventIds, ...supportingEventIds, primaryId])].sort((left, right) => {
      const leftEvent = selectedEvents.find((event) => String(event.id) === left);
      const rightEvent = selectedEvents.find((event) => String(event.id) === right);
      return leftEvent && rightEvent ? chronologicalEventOrder(leftEvent, rightEvent) : left.localeCompare(right);
    });
    const candidate = {
      findingType: matureFindingType(seed.unit.signals),
      sourceEventIds,
      proposalStatement: seed.unit.statement,
      proposedScope: "local",
      conditions: [],
      exclusions: [],
      supportingEvidence: supportingEventIds,
      counterevidence: [],
      uncertainty: seed.roles.includes("uncertainty")
        ? "The Exact source explicitly marks this project state as unresolved or uncertain."
        : null,
      reasonForSurfacing: `Exact source sequence ${seed.unit.sequence} was selected to cover the mature-room ${seed.roles.join(", ").replaceAll("_", " ")} State Truth role${seed.roles.length === 1 ? "" : "s"}.`,
      expectedRetrievalEffect: "No retrieval change unless Cody governs this atomic project-state proposal.",
    };
    return { ...candidate, proposalHash: await sha256(JSON.stringify(candidate)) };
  }));

  const maximumSequence = Math.max(0, ...selectedEvents.map((event) => sourceSequence(event) || 0));
  const finalThirdStart = Math.floor((maximumSequence * 2) / 3) + 1;
  const candidateEventIds = new Set(selected.map((seed) => String(seed.unit.event.id)));
  const supportingEventIds = new Set([
    ...selected.flatMap((seed) => seed.unit.evidenceEvents.map((event) => String(event.id)).filter((id) => id !== String(seed.unit.event.id))),
    ...[...supportingByCandidate.values()].flat().flatMap((unit) => unit.evidenceEvents.map((event) => String(event.id))),
  ]);
  const redundantEventIds = new Set([...redundantUnits].map((unit) => String(unit.event.id)));
  const unitsByEvent = new Map<string, MatureUnit[]>();
  for (const unit of discoveredUnits) {
    const id = String(unit.event.id);
    unitsByEvent.set(id, [...(unitsByEvent.get(id) || []), unit]);
  }
  const selectedTailEvidenceDisposition = selectedEvents
    .filter((event) => (sourceSequence(event) || 0) >= finalThirdStart)
    .map((event) => {
      const eventId = String(event.id);
      const eventUnits = unitsByEvent.get(eventId) || [];
      let disposition = "could_not_be_safely_interpreted";
      if (candidateEventIds.has(eventId)) disposition = "produced_candidate";
      else if (supportingEventIds.has(eventId)) disposition = "supported_another_candidate";
      else if (redundantEventIds.has(eventId)) disposition = "redundant_with_stronger_candidate";
      else if (!eventUnits.length) disposition = "source_only_non_durable";
      else if (eventUnits.every((unit) => incompleteUnits.has(unit))) disposition = "insufficiently_complete";
      else if (eventUnits.some((unit) => staleUnits.has(unit))) disposition = "stale_or_completed";
      else if ((sourceSequence(event) || 0) < boundary) disposition = "excluded_as_optional";
      return {
        eventId,
        sourceSequence: sourceSequence(event),
        disposition,
        candidateRoles: [...new Set((selectedByEvent.get(eventId) || []).flatMap((seed) => seed.roles))],
      };
    });
  return {
    candidates,
    metadata: {
      version: CHECKPOINT_CANDIDATE_VERSION,
      strategy: "mature_room_complete_current_propositions_v2",
      budget: MAX_MATURE_FINDINGS,
      candidateCount: candidates.length,
      currentBoundarySequence: boundary || null,
      rolesRepresented: [...new Set(selected.flatMap((seed) => seed.roles))],
      historicalDuplicateUnitsCollapsed: redundantUnits.size,
      incompleteUnitsRejected: incompleteUnits.size,
      incompleteUnitDiagnostics: [...incompleteUnits].map((unit) => ({
        sourceSequence: unit.sequence,
        clusterKind: unit.clusterKind,
        roles: candidateRoles(unit),
        statementHashInputLength: unit.statement.length,
      })),
      correctionUnitDiagnostics: discoveredUnits
        .filter((unit) => candidateRoles(unit).includes("correction_guard"))
        .map((unit) => ({
          sourceSequence: unit.sequence,
          clusterKind: unit.clusterKind,
          complete: !incompleteUnits.has(unit),
          staleOrCompleted: staleUnits.has(unit),
          directlyRelevant: directlyRelevant(unit),
          statementHashInputLength: unit.statement.length,
        })),
      staleOrCompletedUnitsRejected: staleUnits.size,
      assistantRestatementsCollapsed: relevantUnits.length - units.length,
      staleOrCompletedUnitDiagnostics: [...staleUnits].map((unit) => ({
        sourceSequence: unit.sequence,
        statement: unit.statement,
        state: validityByUnit.get(unit),
      })),
      completedSourceEventIds: [...completedEvents.keys()].sort(),
      completionRelationships: [...completedEvents.entries()].map(([eventId, closureEvents]) => ({
        eventId,
        closureEventIds: [...new Set(closureEvents.map((event) => String(event.id)))].sort(),
      })),
      expirationRelationships: [...expiredEvents.entries()].map(([eventId, resolutionEvents]) => ({
        eventId,
        resolutionEventIds: [...new Set(resolutionEvents.map((event) => String(event.id)))].sort(),
      })),
      candidateStateValidity: selected.map((seed, index) => ({
        proposalHash: candidates[index].proposalHash,
        state: validityByUnit.get(seed.unit),
        clusterKind: seed.unit.clusterKind,
        sourceSequences: [...new Set(seed.unit.evidenceEvents.map((event) => sourceSequence(event)).filter((value): value is number => value !== null))].sort((left, right) => left - right),
      })),
      orientationCandidateDiagnostics: rankedForRole("current_direction").map((unit) => ({
        sourceSequence: unit.sequence,
        statement: unit.statement,
        state: validityByUnit.get(unit),
        specificCurrentOrientation: specificCurrentOrientation(unit),
        selected: selected.some((seed) => seed.unit === unit),
      })),
      selectedFinalThirdStartSequence: finalThirdStart,
      selectedTailEvidenceDisposition,
      constructionStoppedBecause: selected.length >= MAX_MATURE_FINDINGS
        ? `The deterministic candidate bound of ${MAX_MATURE_FINDINGS} was reached after current-state role coverage and redundancy collapse.`
        : "Every supported current-state role and distinct current-boundary unit was covered before the candidate bound.",
    },
  };
}

async function serverFindingCandidates(selectedEvents: Row[], mature: boolean): Promise<CandidateConstruction> {
  const sourceEvents = selectedEvents.filter((event) => String(event.event_type).toLowerCase() === "source_message");
  if (sourceEvents.length <= 10) {
    const closure = await shortRoomFindingCandidates(selectedEvents);
    if (closure) return closure;
  }
  if (mature) return matureFindingCandidates(selectedEvents);
  const primary = selectedEvents.find((event) => {
    const type = String(event.event_type).toLowerCase();
    const statement = eventStatement(event);
    return ["correction", "mechanism_candidate", "principle_candidate", "constraint_change", "source_message"].includes(type)
      && mechanismLanguage(statement)
      && atomicEnough(statement);
  });
  if (!primary) return {
    candidates: [],
    metadata: {
      version: CHECKPOINT_CANDIDATE_VERSION,
      strategy: "small_room_sparse_candidate_v1",
      budget: 1,
      candidateCount: 0,
    },
  };

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
  return {
    candidates: [{
      ...candidate,
      proposalHash: await sha256(JSON.stringify(candidate)),
    }],
    metadata: {
      version: CHECKPOINT_CANDIDATE_VERSION,
      strategy: "small_room_sparse_candidate_v1",
      budget: 1,
      candidateCount: 1,
    },
  };
}

async function preparationStoppedCheckpoint(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId: string,
  trigger: string,
  source: string,
  idempotencyKey: string,
  status: "blocked" | "failed",
  preparation: SourceEventPreparation,
) {
  const checkpointId = canonicalId("checkpoint");
  const startedAt = now();
  const completedAt = now();
  const error = preparation.requirement
    || (status === "failed"
      ? "Source-event preparation failed. Retry Analyze; existing source records remain unchanged."
      : "Source-event preparation is blocked by missing eligible source state.");
  await db.prepare(
    `INSERT INTO checkpoints (
      id, project_id, case_id, conversation_id, trigger, source, started_at,
      completed_at, status, extraction_version, candidate_count, selected_count,
      omitted_count, health_before, health_after, missing_state, ambiguity,
      error, idempotency_key, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'forming', 'forming', ?, NULL, ?, ?, ?)`,
  ).bind(
    checkpointId,
    projectId,
    caseId,
    conversationId,
    trigger,
    source,
    startedAt,
    completedAt,
    status,
    CHECKPOINT_EXTRACTION_VERSION,
    json(["source_events"]),
    error,
    idempotencyKey,
    json({
      sourceEventPreparation: preparation,
      findingCandidatesReceived: 0,
      findingCandidatesGenerated: 0,
      findingCandidateOrigin: source === SERVER_FINDING_SOURCE ? "server" : "explicit_analyzer",
      findingCount: 0,
      suppressedFindingCount: 0,
      selectedNodeIds: [],
      authorityCreated: false,
    }),
  ).run();
  return {
    ...(await checkpointDetail(db, projectId, checkpointId)),
    idempotentReplay: false,
  };
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
  if (source === SERVER_FINDING_SOURCE && body.findingCandidates !== undefined) {
    throw new Error("Native finding candidates are server-owned; client-supplied finding wording cannot be accepted.");
  }
  if (source !== SERVER_FINDING_SOURCE && !ANALYZER_CANDIDATE_SOURCES.has(source)) {
    throw new Error("Unsupported checkpoint source.");
  }
  let sourceEventPreparation: SourceEventPreparation;
  try {
    sourceEventPreparation = await ensureExactImportSourceEvents(db, projectId, conversationId, caseId);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown source-event preparation error.";
    sourceEventPreparation = {
      eligible: true,
      status: "failed",
      expectedMessageCount: 0,
      materializedEventCount: 0,
      createdEventCount: 0,
      attachedEventCount: 0,
      eventIds: [],
      missingMessageIds: [],
      requirement: `Source-event preparation failed: ${message}`,
    };
    return preparationStoppedCheckpoint(
      db,
      projectId,
      conversationId,
      caseId,
      trigger,
      source,
      idempotencyKey,
      "failed",
      sourceEventPreparation,
    );
  }
  if (sourceEventPreparation.status === "blocked") {
    return preparationStoppedCheckpoint(
      db,
      projectId,
      conversationId,
      caseId,
      trigger,
      source,
      idempotencyKey,
      "blocked",
      sourceEventPreparation,
    );
  }
  const requestedEventIds = stringArray(body.candidateEventIds, "Candidate event IDs").map((id) => assertId(id, "event ID"));
  const availableEvents = await caseEvents(db, projectId, conversationId, caseId, []);
  if (sourceEventPreparation.eligible) {
    const availableEventIds = new Set(availableEvents.map((event) => String(event.id)));
    const missingEventIds = sourceEventPreparation.eventIds.filter((eventId) => !availableEventIds.has(eventId));
    if (missingEventIds.length) {
      return preparationStoppedCheckpoint(
        db,
        projectId,
        conversationId,
        caseId,
        trigger,
        source,
        idempotencyKey,
        "blocked",
        {
          ...sourceEventPreparation,
          status: "blocked",
          requirement: `Prepared source events are not eligible for the active case: ${missingEventIds.join(", ")}.`,
        },
      );
    }
  }
  let events = availableEvents;
  if (requestedEventIds.length > 0) {
    const requested = new Set(requestedEventIds);
    events = availableEvents.filter((event) => requested.has(String(event.id)));
    if (events.length !== requested.size) {
      throw new Error("A candidate event is outside the active conversation and case.");
    }
  }
  const allowedEventIds = new Set(events.map((event) => String(event.id)));
  const startedAt = now();
  const checkpointId = canonicalId("checkpoint");
  const selection = selectEventsForAnalysis(events);
  const selectedEvents = selection.events;
  const rawFindings = source === SERVER_FINDING_SOURCE
    ? null
    : body.findingCandidates === undefined ? [] : body.findingCandidates;
  if (rawFindings !== null && !Array.isArray(rawFindings)) throw new Error("Finding candidates must be an array.");
  const candidateConstruction = rawFindings === null
    ? await serverFindingCandidates(events, selection.mature)
    : {
      candidates: await Promise.all(rawFindings.map((candidate) => validateFindingCandidate(candidate, allowedEventIds))),
      metadata: {
        version: CHECKPOINT_CANDIDATE_VERSION,
        strategy: "explicit_analyzer_candidates",
        candidateCount: rawFindings.length,
      },
    };
  const findingCandidates = candidateConstruction.candidates;
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
  let reusedFindingCount = 0;
  let createdFindingCount = 0;
  const candidateFindingLinks: Array<Record<string, unknown>> = [];
  for (const candidate of findingCandidates) {
    const existingEquivalent = await first<Row>(db.prepare(
      `SELECT f.id, f.status, f.checkpoint_id
       FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.case_id = ? AND v.proposal_hash = ?
       LIMIT 1`,
    ).bind(projectId, caseId, candidate.proposalHash));
    if (existingEquivalent) {
      const reusable = ["proposed", "under_review", "deferred", "challenged", "approved"].includes(String(existingEquivalent.status));
      if (reusable) {
        reusedFindingCount += 1;
        candidateFindingLinks.push({
          findingId: String(existingEquivalent.id),
          disposition: "reused_equivalent",
          canonicalOriginCheckpointId: String(existingEquivalent.checkpoint_id),
          sourceEventIds: candidate.sourceEventIds,
          proposalHash: candidate.proposalHash,
        });
      } else {
        suppressedFindingCount += 1;
      }
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
    candidateFindingLinks.push({
      findingId,
      disposition: "created",
      canonicalOriginCheckpointId: checkpointId,
      sourceEventIds: candidate.sourceEventIds,
      proposalHash: candidate.proposalHash,
    });
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
    CHECKPOINT_EXTRACTION_VERSION,
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
      reusedFindingCount,
      candidateFindingLinks,
      selectedNodeIds,
      eventSelection: selection.metadata,
      candidateConstruction: candidateConstruction.metadata,
      authorityCreated: false,
      sourceEventPreparation,
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
