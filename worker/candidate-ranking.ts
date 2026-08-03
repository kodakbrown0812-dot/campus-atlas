import { all, parseJson, Row } from "./slice3-support";
import type { TaskInterpretation } from "./roadway-service";

export type Treatment = "Use" | "Consider" | "Exclude";
export type Representation = "Exact" | "Compressed" | "Reconstructed" | "Inferred" | "Conflicted";

export type DiscoverySignals = {
  semanticSimilarity: number;
  keywordBm25: number;
  entityMatch: number;
  temporalFit: number;
  relationshipProximity: number;
  projectScope: number;
};

export type RankingDimensions = {
  taskMechanismMatch: number;
  scopeFit: number;
  authority: number;
  evidenceStrength: number;
  realityContact: number;
  directMechanismFit: number;
  applicableFreshness: number;
  independentRepetition: number;
  redundancy: number;
  representationLength: number;
};

export type RankedCandidate = {
  sourceType: string;
  sourceId: string;
  sourceVersionId: string | null;
  statement: string;
  treatment: Treatment;
  representation: Representation;
  scope: string;
  authority: string;
  freshness: string;
  status: string;
  caseId: string | null;
  createdAt: string;
  reason: string;
  discovery: DiscoverySignals;
  ranking: RankingDimensions;
  counterevidenceIds: string[];
  governanceEventId: string | null;
  protectedRole: "correction" | "challenge" | "conflict" | "required_state" | null;
  metadata: Record<string, unknown>;
};

type RawCandidate = Omit<RankedCandidate, "treatment" | "reason" | "discovery" | "ranking" | "protectedRole"> & {
  nodeType?: string;
  eventType?: string;
  evidenceCount: number;
  repetitionCount: number;
  isUserCorrection: boolean;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
  "we", "what", "when", "which", "with", "would",
]);

const MECHANISM_ALIASES: Record<string, string[]> = {
  margin: ["run", "line", "spread", "cover", "covering", "margin", "handicap", "distribution", "separation", "one-score", "multi-run"],
  outcome: ["outcome", "result", "postmortem", "post-mortem", "failed", "loss", "won", "reality", "contradiction", "lesson"],
  broad: ["compare", "rank", "slate", "option", "market", "best", "strongest", "candidate", "alternative"],
  price: ["price", "odds", "break-even", "value", "available", "offered"],
  workload: ["workload", "innings", "pitches", "leash", "volume", "health"],
};

function words(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)?.filter((word) => !STOP_WORDS.has(word)) || [];
}

function distinct(values: string[]) {
  return [...new Set(values)];
}

function termFrequency(textWords: string[], queryWords: string[]) {
  if (!queryWords.length || !textWords.length) return 0;
  const counts = new Map<string, number>();
  for (const word of textWords) counts.set(word, (counts.get(word) || 0) + 1);
  const hits = queryWords.reduce((sum, word) => sum + Math.min(2, counts.get(word) || 0), 0);
  return Math.min(100, Math.round((hits / Math.max(1, queryWords.length)) * 100));
}

function semanticFamilies(value: string) {
  const valueWords = new Set(words(value));
  return Object.entries(MECHANISM_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => valueWords.has(alias)))
    .map(([family]) => family);
}

function entityTerms(value: string) {
  return distinct(value.match(/\b[A-Z][A-Za-z0-9–'-]{2,}\b/g) || []).map((term) => term.toLowerCase());
}

function freshnessFor(row: Row, createdAt: string) {
  if (row.superseded_at || row.invalidated_at || row.status === "superseded") return "superseded";
  const validFrom = row.valid_from ? Date.parse(String(row.valid_from)) : Number.NaN;
  const validUntil = row.valid_until ? Date.parse(String(row.valid_until)) : Number.NaN;
  if (Number.isFinite(validFrom) && Date.now() < validFrom) return "stale";
  if (Number.isFinite(validUntil) && Date.now() > validUntil) return "stale";
  if (row.source_type === "live_state") {
    const observed = Date.parse(String(row.observed_at));
    const windowSeconds = Number(row.freshness_window_seconds || 0);
    if (!Number.isFinite(observed) || windowSeconds <= 0) return "unknown";
    return Date.now() <= observed + windowSeconds * 1000 ? "fresh" : "stale";
  }
  return createdAt ? "historical" : "unknown";
}

function normalizedRepresentation(value: unknown, fallback: Representation): Representation {
  return ["Exact", "Compressed", "Reconstructed", "Inferred", "Conflicted"].includes(String(value))
    ? String(value) as Representation
    : fallback;
}

async function mechanismCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'mechanism' AS source_type, m.id, m.project_id, m.source_finding_id,
            m.current_governing_version_id, m.status, v.statement,
            v.scope_conditions, v.exclusions, v.supporting_case_ids,
            v.supporting_node_ids, v.counterevidence_ids, v.reality_contact,
            v.authority_state, v.created_at,
            (
              SELECT g.id FROM governance_events g
              WHERE g.project_id = m.project_id
                AND g.affected_mechanism_id = m.id
              ORDER BY g.created_at DESC, g.rowid DESC LIMIT 1
            ) AS governance_event_id
     FROM mechanisms m
     JOIN mechanism_versions v
       ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
     WHERE m.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => {
    const supportingCases = parseJson<string[]>(row.supporting_case_ids, []);
    const scopeConditions = parseJson<string[]>(row.scope_conditions, []);
    const counterevidenceIds = parseJson<string[]>(row.counterevidence_ids, []);
    const statement = String(row.statement);
    return {
      sourceType: "Mechanism",
      sourceId: String(row.id),
      sourceVersionId: String(row.current_governing_version_id),
      statement,
      representation: "Compressed",
      scope: row.authority_state === "approved_local" ? "local" : "project_wide",
      authority: String(row.authority_state),
      freshness: freshnessFor(row, String(row.created_at)),
      status: String(row.status),
      caseId: supportingCases.length === 1 ? supportingCases[0] : null,
      createdAt: String(row.created_at),
      counterevidenceIds,
      governanceEventId: row.governance_event_id ? String(row.governance_event_id) : null,
      metadata: {
        sourceFindingId: row.source_finding_id,
        scopeConditions,
        exclusions: parseJson(row.exclusions, []),
        supportingCaseIds: supportingCases,
        supportingNodeIds: parseJson(row.supporting_node_ids, []),
        realityContact: row.reality_contact,
      },
      evidenceCount: supportingCases.length + parseJson<string[]>(row.supporting_node_ids, []).length,
      repetitionCount: supportingCases.length,
      isUserCorrection: false,
    };
  });
}

async function reasoningCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'reasoning_node' AS source_type, n.*, v.statement,
            v.representation_type, v.source_event_ids, v.evidence_links,
            v.counterevidence_links, v.uncertainty, v.created_by,
            v.created_at AS version_created_at
     FROM reasoning_nodes n
     JOIN reasoning_node_versions v
       ON v.id = n.current_version_id AND v.project_id = n.project_id
     WHERE n.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => ({
    sourceType: "ReasoningNode",
    sourceId: String(row.id),
    sourceVersionId: String(row.current_version_id),
    statement: String(row.statement),
    representation: normalizedRepresentation(row.representation_type, "Inferred"),
    scope: String(row.scope),
    authority: String(row.authority_state),
    freshness: freshnessFor(row, String(row.version_created_at)),
    status: String(row.status),
    caseId: String(row.case_id),
    createdAt: String(row.version_created_at),
    counterevidenceIds: parseJson(row.counterevidence_links, []),
    governanceEventId: null,
    metadata: {
      sourceEventIds: parseJson(row.source_event_ids, []),
      uncertainty: row.uncertainty,
      createdBy: row.created_by,
    },
    nodeType: String(row.node_type),
    evidenceCount: parseJson<string[]>(row.evidence_links, []).length,
    repetitionCount: 1,
    isUserCorrection: String(row.node_type).toLowerCase() === "correction" && row.created_by === "cody",
  }));
}

async function findingCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'finding' AS source_type, f.*, v.proposal_statement, v.proposed_scope,
            v.supporting_evidence, v.counterevidence, v.created_by,
            v.created_at AS version_created_at
     FROM findings f
     JOIN finding_versions v
       ON v.id = f.current_version_id AND v.project_id = f.project_id
     WHERE f.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => ({
    sourceType: "Finding",
    sourceId: String(row.id),
    sourceVersionId: String(row.current_version_id),
    statement: String(row.proposal_statement),
    representation: "Inferred",
    scope: String(row.proposed_scope),
    authority: String(row.authority_state),
    freshness: freshnessFor(row, String(row.version_created_at)),
    status: String(row.status),
    caseId: String(row.case_id),
    createdAt: String(row.version_created_at),
    counterevidenceIds: parseJson(row.counterevidence, []),
    governanceEventId: null,
    metadata: {
      checkpointId: row.checkpoint_id,
      sourceEventIds: parseJson(row.source_event_ids, []),
      findingType: row.finding_type,
      supportingEvidence: parseJson(row.supporting_evidence, []),
      createdBy: row.created_by,
    },
    evidenceCount: parseJson<string[]>(row.supporting_evidence, []).length,
    repetitionCount: 1,
    isUserCorrection: String(row.finding_type) === "correction" && row.created_by === "cody",
  }));
}

async function eventCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'event' AS source_type, e.*
     FROM events e
     WHERE e.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => {
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    const eventType = String(row.event_type);
    return {
      sourceType: "Event",
      sourceId: String(row.id),
      sourceVersionId: `event-version:${row.version}`,
      statement: row.compressed_representation
        ? String(row.compressed_representation)
        : String(row.exact_source_span),
      representation: normalizedRepresentation(
        row.compressed_representation ? "Compressed" : metadata.representationType,
        row.compressed_representation ? "Compressed" : "Exact",
      ),
      scope: row.case_id ? "local" : "project_wide",
      authority: String(row.authority_state),
      freshness: freshnessFor(row, String(row.ingested_at)),
      status: row.invalidated_at ? "superseded" : "active",
      caseId: row.case_id ? String(row.case_id) : null,
      createdAt: String(row.ingested_at),
      counterevidenceIds: [],
      governanceEventId: null,
      metadata: {
        conversationId: row.conversation_id,
        sourceMessageIds: parseJson(row.source_message_ids, []),
        observedAt: row.observed_at,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        historicalSourceLimitation: metadata.historicalSourceLimitation,
      },
      eventType,
      evidenceCount: parseJson<string[]>(row.source_message_ids, []).length,
      repetitionCount: 1,
      isUserCorrection: eventType === "correction" && row.actor_id === "cody",
    };
  });
}

async function artifactCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'source_artifact' AS source_type, i.*, c.title
     FROM conversation_imports i
     JOIN conversations c
       ON c.id = i.conversation_id AND c.project_id = i.project_id
     WHERE i.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => {
    const provenance = parseJson<Record<string, unknown>>(row.provenance, {});
    return {
      sourceType: "SourceArtifact",
      sourceId: String(row.id),
      sourceVersionId: String(row.content_hash),
      statement: `${row.title}: ${row.source_name || row.source_type}`,
      representation: normalizedRepresentation(row.representation_type, "Exact"),
      scope: "project_wide",
      authority: String(row.authority_state),
      freshness: "historical",
      status: "active",
      caseId: typeof provenance.caseId === "string" ? provenance.caseId : null,
      createdAt: String(row.imported_at),
      counterevidenceIds: [],
      governanceEventId: null,
      metadata: {
        importId: row.import_id,
        sourceType: row.source_type,
        representationType: row.representation_type,
        contentHash: row.content_hash,
        provenance,
        historicalSourceLimitation: provenance.historicalRawTranscriptStatus,
      },
      evidenceCount: Number(row.message_count || 0),
      repetitionCount: 1,
      isUserCorrection: false,
    };
  });
}

async function liveStateCandidates(db: D1Database, projectId: string): Promise<RawCandidate[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT 'live_state' AS source_type, s.*
     FROM live_state_snapshots s
     WHERE s.project_id = ?`,
  ).bind(projectId));
  return rows.map((row) => ({
    sourceType: "LiveStateSnapshot",
    sourceId: String(row.id),
    sourceVersionId: String(row.id),
    statement: `${row.category} for ${row.entity}: ${row.raw_value}`,
    representation: "Exact",
    scope: row.case_id ? "local" : "project_wide",
    authority: "observed",
    freshness: freshnessFor(row, String(row.created_at)),
    status: String(row.status),
    caseId: row.case_id ? String(row.case_id) : null,
    createdAt: String(row.created_at),
    counterevidenceIds: [],
    governanceEventId: null,
    metadata: {
      provider: row.provider,
      sourceIdentity: row.source_identity,
      category: row.category,
      entity: row.entity,
      observedAt: row.observed_at,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      freshnessWindowSeconds: row.freshness_window_seconds,
      normalizedValue: parseJson(row.normalized_value, {}),
    },
    evidenceCount: 1,
    repetitionCount: 1,
    isUserCorrection: false,
  }));
}

function matchingContext(interpretation: TaskInterpretation) {
  const caseContext = interpretation.caseContextUsedForMatching ? interpretation.caseObjective || "" : "";
  return `${interpretation.literalRequest} ${interpretation.requiredReasoningMechanism} ${caseContext}`;
}

function discoverySignals(candidate: RawCandidate, interpretation: TaskInterpretation): DiscoverySignals {
  const context = matchingContext(interpretation);
  const queryWords = distinct(words(context));
  const candidateWords = words(candidate.statement);
  const queryFamilies = semanticFamilies(context);
  const candidateFamilies = semanticFamilies(candidate.statement);
  const sharedFamilies = candidateFamilies.filter((family) => queryFamilies.includes(family)).length;
  const queryEntities = entityTerms(context);
  const candidateEntities = entityTerms(candidate.statement);
  const entityHits = candidateEntities.filter((entity) => queryEntities.includes(entity)).length;
  const temporalFit = interpretation.timeSensitivity === "current"
    ? candidate.freshness === "fresh" ? 100 : candidate.freshness === "stale" ? 0 : 35
    : 75;
  const relationshipProximity = interpretation.caseId && candidate.caseId === interpretation.caseId
    ? 100
    : candidate.caseId ? 45 : 70;
  return {
    semanticSimilarity: queryFamilies.length
      ? Math.round((sharedFamilies / queryFamilies.length) * 100)
      : 0,
    keywordBm25: termFrequency(candidateWords, queryWords),
    entityMatch: queryEntities.length ? Math.round((entityHits / queryEntities.length) * 100) : 0,
    temporalFit,
    relationshipProximity,
    projectScope: 100,
  };
}

function taskMatch(signals: DiscoverySignals, candidate: RawCandidate, interpretation: TaskInterpretation) {
  const directFamily = signals.semanticSimilarity >= 34;
  const lexical = signals.keywordBm25 >= 14;
  const roleMatch = interpretation.primaryRoadway?.slug === "outcome-postmortem"
    ? ["outcome", "postmortem", "correction", "challenge"].includes(candidate.eventType || candidate.nodeType || "")
    : interpretation.primaryRoadway?.slug === "margin-run-line-value"
      ? semanticFamilies(candidate.statement).some((family) => ["margin", "price"].includes(family))
      : semanticFamilies(candidate.statement).some((family) => ["broad", "price", "margin"].includes(family));
  return directFamily && roleMatch ? 4 : directFamily ? 3 : lexical || roleMatch ? 2 : signals.entityMatch > 0 ? 1 : 0;
}

function authorityRank(authority: string, sourceType: string) {
  if (sourceType === "LiveStateSnapshot") return 4;
  if (authority === "approved_project_wide" || authority === "approved_cross_project") return 4;
  if (authority === "approved_local") return 3;
  if (authority === "observed") return 2;
  if (authority === "under_review" || authority === "proposed") return 1;
  return 0;
}

function evidenceRank(candidate: RawCandidate) {
  if (candidate.eventType === "outcome" || candidate.eventType === "postmortem") return 4;
  if (candidate.metadata.realityContact || candidate.evidenceCount > 1) return 3;
  if (candidate.evidenceCount === 1) return 2;
  return 1;
}

function scopeFit(candidate: RawCandidate, interpretation: TaskInterpretation) {
  if (candidate.scope === "project_wide" || candidate.scope === "cross_project") return 4;
  if (candidate.caseId && interpretation.caseId === candidate.caseId) return 4;
  if (!candidate.caseId && candidate.scope === "local") return 2;
  return 0;
}

function isWrongScope(candidate: RawCandidate, interpretation: TaskInterpretation) {
  return candidate.scope === "local"
    && (!interpretation.caseId || candidate.caseId !== interpretation.caseId);
}

function rankCandidate(candidate: RawCandidate, interpretation: TaskInterpretation): RankedCandidate {
  const discovery = discoverySignals(candidate, interpretation);
  const match = taskMatch(discovery, candidate, interpretation);
  const scope = scopeFit(candidate, interpretation);
  const ranking: RankingDimensions = {
    taskMechanismMatch: match,
    scopeFit: scope,
    authority: authorityRank(candidate.authority, candidate.sourceType),
    evidenceStrength: evidenceRank(candidate),
    realityContact: candidate.eventType === "outcome" || candidate.metadata.realityContact ? 4 : 1,
    directMechanismFit: discovery.semanticSimilarity,
    applicableFreshness: discovery.temporalFit,
    independentRepetition: candidate.repetitionCount,
    redundancy: 0,
    representationLength: candidate.statement.length,
  };
  let treatment: Treatment = "Consider";
  let reason = "Relevant candidate is non-governing and remains visibly labeled.";
  const terminal = ["rejected", "retired", "superseded"].includes(candidate.status)
    || ["rejected", "retired", "superseded"].includes(candidate.authority);
  if (terminal) {
    treatment = "Exclude";
    reason = `Cannot govern because the canonical state is ${candidate.status === "active" ? candidate.authority : candidate.status}.`;
  } else if (candidate.freshness === "stale" && interpretation.timeSensitivity === "current") {
    treatment = "Exclude";
    reason = "Current-state use is blocked because this snapshot is stale.";
  } else if (isWrongScope(candidate, interpretation)) {
    treatment = "Exclude";
    reason = "Approved local or case-scoped material is outside the active case.";
  } else if (match === 0) {
    treatment = "Exclude";
    reason = "Same project context does not match the selected task mechanism.";
  } else if (
    candidate.sourceType === "LiveStateSnapshot"
    && candidate.freshness === "fresh"
    && interpretation.requiredLiveState.includes(String(candidate.metadata.category))
  ) {
    treatment = "Use";
    reason = "Fresh provider-attributed live state satisfies a roadway requirement.";
  } else if (candidate.sourceType === "LiveStateSnapshot" && candidate.freshness === "fresh") {
    treatment = "Consider";
    reason = "Fresh provider-attributed state is available but is not required by the selected roadway.";
  } else if (
    candidate.sourceType === "Mechanism"
    && ["approved_local", "approved_project_wide", "approved_cross_project"].includes(candidate.authority)
    && match >= 3
    && scope >= 4
  ) {
    treatment = "Use";
    reason = "Direct mechanism fit, valid scope, approved authority, and adequate historical freshness permit governing use.";
  } else if (candidate.authority === "challenged") {
    treatment = "Consider";
    reason = "Challenged material cannot govern, but its challenge remains relevant.";
  } else if (candidate.authority === "inferred" || candidate.authority === "proposed" || candidate.authority === "under_review") {
    treatment = "Consider";
    reason = "Relevant unapproved material is disclosed as non-governing context.";
  } else if (match < 3) {
    treatment = "Consider";
    reason = "Candidate is related but its mechanism fit is indirect.";
  }
  if (
    candidate.sourceType === "SourceArtifact"
    && candidate.representation === "Reconstructed"
    && treatment !== "Exclude"
  ) {
    treatment = "Consider";
    reason = candidate.metadata.historicalSourceLimitation
      ? `Reconstructed user-supplied artifact; historical raw transcript is ${candidate.metadata.historicalSourceLimitation}. It cannot govern as Exact source.`
      : "Reconstructed source artifact is relevant but cannot govern as Exact source.";
  }
  const role = candidate.isUserCorrection || candidate.eventType === "correction" || candidate.nodeType === "Correction"
    ? "correction"
    : candidate.eventType === "challenge" || candidate.nodeType === "Challenge" || candidate.authority === "challenged"
      ? "challenge"
      : null;
  return {
    ...candidate,
    treatment,
    reason,
    discovery,
    ranking,
    protectedRole: role,
  };
}

function rankingOrder(left: RankedCandidate, right: RankedCandidate) {
  const dimensions: Array<keyof RankingDimensions> = [
    "taskMechanismMatch",
    "scopeFit",
    "authority",
    "evidenceStrength",
    "realityContact",
    "directMechanismFit",
    "applicableFreshness",
    "independentRepetition",
  ];
  for (const dimension of dimensions) {
    const difference = right.ranking[dimension] - left.ranking[dimension];
    if (difference) return difference;
  }
  if (left.ranking.redundancy !== right.ranking.redundancy) {
    return left.ranking.redundancy - right.ranking.redundancy;
  }
  if (left.ranking.representationLength !== right.ranking.representationLength) {
    return left.ranking.representationLength - right.ranking.representationLength;
  }
  return left.sourceId.localeCompare(right.sourceId);
}

function markRedundancy(candidates: RankedCandidate[]) {
  const seen = new Map<string, string>();
  for (const candidate of candidates) {
    const key = distinct(words(candidate.statement)).sort().join(" ");
    if (seen.has(key)) {
      candidate.ranking.redundancy = 1;
      if (candidate.treatment !== "Exclude") {
        candidate.treatment = "Exclude";
        candidate.reason = `Functionally redundant with ${seen.get(key)}; the shorter or earlier equivalent representation is retained.`;
      }
    } else {
      seen.set(key, candidate.sourceId);
    }
  }
}

async function checkpointNodeIds(db: D1Database, projectId: string) {
  const rows = await all<Row>(db.prepare(
    `SELECT checkpoint_id, reasoning_node_id
     FROM checkpoint_reasoning_nodes
     WHERE project_id = ?`,
  ).bind(projectId));
  const byCheckpoint = new Map<string, string[]>();
  for (const row of rows) {
    const checkpointId = String(row.checkpoint_id);
    const ids = byCheckpoint.get(checkpointId) || [];
    ids.push(String(row.reasoning_node_id));
    byCheckpoint.set(checkpointId, ids);
  }
  return byCheckpoint;
}

const LINEAGE_ONLY_REASON = "Represented by the approved governing mechanism; retained for lineage and audit, not counted as independent context.";

function collapseGoverningLineage(
  candidates: RankedCandidate[],
  nodesByCheckpoint: Map<string, string[]>,
) {
  const byId = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]));
  for (const mechanism of candidates.filter((candidate) => (
    candidate.sourceType === "Mechanism" && candidate.treatment === "Use"
  ))) {
    const sourceFindingId = typeof mechanism.metadata.sourceFindingId === "string"
      ? mechanism.metadata.sourceFindingId
      : null;
    if (!sourceFindingId) continue;
    const finding = byId.get(sourceFindingId);
    if (!finding) continue;
    const checkpointId = typeof finding.metadata.checkpointId === "string"
      ? finding.metadata.checkpointId
      : null;
    const explicitSupportingNodeIds = (Array.isArray(mechanism.metadata.supportingNodeIds)
      ? mechanism.metadata.supportingNodeIds
      : []).filter((id): id is string => typeof id === "string");
    const findingSourceEventIds = (Array.isArray(finding.metadata.sourceEventIds)
      ? finding.metadata.sourceEventIds
      : []).filter((id): id is string => typeof id === "string");
    const findingSourceEvents = new Set(findingSourceEventIds);
    const nodeIds = distinct([
      ...explicitSupportingNodeIds,
      ...(checkpointId ? nodesByCheckpoint.get(checkpointId) || [] : []),
    ]).filter((nodeId) => {
      if (explicitSupportingNodeIds.includes(nodeId)) return true;
      const node = byId.get(nodeId);
      const nodeSourceEvents = Array.isArray(node?.metadata.sourceEventIds)
        ? node.metadata.sourceEventIds
        : [];
      return nodeSourceEvents.some((eventId) => (
        typeof eventId === "string" && findingSourceEvents.has(eventId)
      ));
    });
    const sourceEventIds = new Set<string>(findingSourceEventIds);
    for (const nodeId of nodeIds) {
      const node = byId.get(nodeId);
      if (!node) continue;
      for (const eventId of Array.isArray(node.metadata.sourceEventIds) ? node.metadata.sourceEventIds : []) {
        if (typeof eventId === "string") sourceEventIds.add(eventId);
      }
    }
    const ancestorIds = distinct([sourceFindingId, ...nodeIds, ...sourceEventIds]);
    mechanism.metadata = { ...mechanism.metadata, representedAncestorIds: ancestorIds };
    for (const ancestorId of ancestorIds) {
      const ancestor = byId.get(ancestorId);
      if (!ancestor || ancestor.sourceId === mechanism.sourceId) continue;
      if (ancestor.protectedRole === "challenge" || ancestor.protectedRole === "conflict") continue;
      if (mechanism.counterevidenceIds.includes(ancestor.sourceId)) continue;
      ancestor.treatment = "Exclude";
      ancestor.reason = LINEAGE_ONLY_REASON;
      ancestor.ranking.independentRepetition = 0;
      ancestor.ranking.redundancy = 1;
      ancestor.metadata = {
        ...ancestor.metadata,
        lineageOnly: true,
        representedByMechanismId: mechanism.sourceId,
      };
    }
  }
}

function conflictPair(left: RankedCandidate, right: RankedCandidate) {
  if (left.sourceType !== "Mechanism" || right.sourceType !== "Mechanism") return false;
  if (left.treatment !== "Use" || right.treatment !== "Use") return false;
  const leftText = left.statement.toLowerCase();
  const rightText = right.statement.toLowerCase();
  const explicit = left.counterevidenceIds.includes(right.sourceId) || right.counterevidenceIds.includes(left.sourceId);
  const opposite = (
    (/\b(always|prefer|increase|include)\b/.test(leftText) && /\b(never|avoid|decrease|exclude)\b/.test(rightText))
    || (/\b(always|prefer|increase|include)\b/.test(rightText) && /\b(never|avoid|decrease|exclude)\b/.test(leftText))
  );
  return explicit || opposite;
}

function preserveConflicts(candidates: RankedCandidate[]) {
  for (let index = 0; index < candidates.length; index += 1) {
    for (let other = index + 1; other < candidates.length; other += 1) {
      if (!conflictPair(candidates[index], candidates[other])) continue;
      for (const candidate of [candidates[index], candidates[other]]) {
        candidate.representation = "Conflicted";
        candidate.protectedRole = "conflict";
        candidate.reason = `${candidate.reason} It conflicts with another approved mechanism and remains unresolved.`;
      }
    }
  }
}

function preserveReferencedChallenges(candidates: RankedCandidate[]) {
  const byId = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]));
  for (const mechanism of candidates.filter((candidate) => candidate.sourceType === "Mechanism" && candidate.treatment === "Use")) {
    for (const id of mechanism.counterevidenceIds) {
      const challenge = byId.get(id);
      if (!challenge) continue;
      if (
        ["rejected", "retired", "superseded"].includes(challenge.status)
        || ["rejected", "retired", "superseded"].includes(challenge.authority)
      ) {
        challenge.reason = `Referenced counterevidence remains an explicit exclusion because its canonical state is ${challenge.status === "active" ? challenge.authority : challenge.status}.`;
        continue;
      }
      if (challenge.treatment === "Exclude") challenge.treatment = "Consider";
      challenge.protectedRole = "challenge";
      challenge.reason = `Strong counterevidence carried with governing mechanism ${mechanism.sourceId}.`;
    }
  }
}

export async function discoverAndRankCandidates(
  db: D1Database,
  projectId: string,
  interpretation: TaskInterpretation,
) {
  const raw = (await Promise.all([
    mechanismCandidates(db, projectId),
    reasoningCandidates(db, projectId),
    findingCandidates(db, projectId),
    eventCandidates(db, projectId),
    artifactCandidates(db, projectId),
    liveStateCandidates(db, projectId),
  ])).flat();
  const nodesByCheckpoint = await checkpointNodeIds(db, projectId);
  const candidates = raw.map((candidate) => rankCandidate(candidate, interpretation));
  markRedundancy(candidates);
  collapseGoverningLineage(candidates, nodesByCheckpoint);
  preserveReferencedChallenges(candidates);
  preserveConflicts(candidates);
  candidates.sort(rankingOrder);
  return candidates;
}
