import {
  previewPacketCandidates,
  type ContinuationClosureDiagnostics,
  type GovernedDeliveryItem,
} from "./packet-service";
import {
  canonicalContinuityInput,
  ContinuityRequestInput,
  validateContinuityRequest,
} from "./continuity-request-contract";
import { interpretTask, TaskInterpretation } from "./roadway-service";
import {
  all,
  assertId,
  first,
  requireProject,
  Row,
} from "./slice3-support";

export type AtlasNeedLevel = "light" | "medium" | "full";

type CompactMechanism = {
  id: string;
  versionId: string;
  statement: string;
  authority: string;
  scope: string;
  caseIds: string[];
  counterevidenceIds: string[];
  scopeConditions: string[];
  exclusions: string[];
  createdAt: string;
};

type CompactContext = {
  caseRecord: {
    id: string;
    objective: string;
    status: string;
    scope: string;
  } | null;
  mechanisms: CompactMechanism[];
  matchingMechanisms: CompactMechanism[];
  caseMechanisms: CompactMechanism[];
  correctionOrConflictIndicators: number;
  recordsScanned: number;
};

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "before",
  "but", "can", "current", "for", "from", "have", "how", "into", "its",
  "now", "one", "only", "our", "should", "that", "the", "their", "then",
  "this", "today", "use", "what", "when", "which", "with", "would", "your",
]);

const FULL_TASK_PATTERN = /\b(best bets?|best option|compare|decision rule|strongest|training|pitcher prop|postmortem|lesson|audit|rerank|enter|wait|choose|plan)\b/i;
const PRESENTATION_PATTERN = /\b(mobile|codex|transfer|copy[- ]ready|plain[- ]text|presentation|format)\b/i;
const CONTINUATION_TASK_PATTERN = /\b(?:pick (?:this|it) back up|continue|continuation|resume|carry (?:this|it) forward|what (?:should|do) we do next|what(?:'s| is) next|next action|next step)\b/i;
const BROAD_CONTINUATION_PATTERN = /\b(?:where (?:are|do) we (?:stand|at)|current (?:project )?state|status and next|recap and continue|everything (?:current|governing)|full room transfer)\b/i;

function words(value: string) {
  return [...new Set(
    (value.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [])
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  )];
}

function overlap(left: string, right: string) {
  const leftWords = new Set(words(left));
  const rightWords = new Set(words(right));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return shared;
}

function mechanismMatchesTask(task: string, mechanism: CompactMechanism, caseId: string | null) {
  const shared = overlap(task, mechanism.statement);
  const scopeFits = mechanism.scope !== "local" || Boolean(caseId && mechanism.caseIds.includes(caseId));
  return scopeFits && shared >= 2;
}

function stringList(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hasProtectedSensitivity(mechanism: CompactMechanism) {
  return /\b(password|passcode|secret|credential|api key|access token|social security|medical|diagnosis|bank account|credit card|sensitive|confidential|private)\b/i.test([
    mechanism.statement,
    ...mechanism.scopeConditions,
    ...mechanism.exclusions,
  ].join(" "));
}

type ContinuationRole = "direction" | "next_action" | "constraint" | "correction" | "rationale" | "conditional" | "unresolved" | "shared_term" | "semantic_identity";

function continuationRoles(value: string): ContinuationRole[] {
  const roles: ContinuationRole[] = [];
  if (/\b(?:current|governing|working choice|preferred (?:choice|option|route|site|direction)|remains? (?:preferred|current|the plan)|is now|are now|decision|objective|responsib(?:le|ility)|will bring)\b/i.test(value)) roles.push("direction");
  if (/\b(?:next (?:action|step|task)|before anything else|begin with|reserve .{0,100} next|then (?:reserve|book|continue))\b/i.test(value)) roles.push("next_action");
  if (/\b(?:must(?: not)?|has to|have to|needs? to|do not|don't|never|avoid|required|requires|under\s+\$?\d|no more than|at most|ceiling|limit|prohibits?|not (?:provided|supplied|allowed)|until|unless|only if|only after|before|after|defer)\b/i.test(value)) roles.push("constraint");
  if (/\b(?:correction|corrected|wrong|mistaken|supersed(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|no longer|is out|are out|scratch|reject(?:ed)?|drop(?:ped)?|obsolete|stale)\b/i.test(value)) roles.push("correction");
  if (/\b(?:because|therefore|\bso\b|caused|the reason|rationale|depends on|in order to)\b/i.test(value)) roles.push("rationale");
  if (/\b(?:if|unless|only if|only after|until|subject to|otherwise)\b/i.test(value)) roles.push("conditional");
  if (/\b(?:unresolved|undecided|open (?:question|item|work)|not (?:yet )?(?:confirmed|established|settled)|pending|deferred|stay on hold|remains to be)\b/i.test(value)) roles.push("unresolved");
  if (/\b(?:local term|we call this|call .{0,60}(?:plan|option|route|version)|means|refers to|is defined as)\b/i.test(value)) roles.push("shared_term");
  if (/\b(?:commit|version|release|deployment|packet|receipt|run|artifact)\b[^\n]{0,80}\b(?:[a-f0-9]{7,64}|v\d+(?:\.\d+){0,3})\b/i.test(value)) roles.push("semantic_identity");
  return [...new Set(roles)];
}

function continuationTaskScope(task: string, requestedOutput: string | null) {
  const context = `${task} ${requestedOutput || ""}`;
  if (BROAD_CONTINUATION_PATTERN.test(context)) return {
    scope: "broad" as const,
    reason: "The task requests project-wide current state or a broad catch-up before continuing.",
  };
  if (CONTINUATION_TASK_PATTERN.test(context)) return {
    scope: "continuation" as const,
    reason: "The task asks to resume or choose the next action without narrowing to one isolated operation.",
  };
  return {
    scope: "narrow" as const,
    reason: "The task names a bounded output or operation and does not request broad project orientation.",
  };
}

function semanticTerms(value: string) {
  return new Set([
    ...words(value),
    ...(value.match(/\b[A-Z]\b/g) || []).map((term) => `identity:${term}`),
    ...(value.match(/\b(?:[a-f0-9]{7,64}|v\d+(?:\.\d+){0,3})\b/gi) || []).map((term) => `identity:${term.toLowerCase()}`),
  ]);
}

function semanticOverlap(left: string, right: string) {
  const leftTerms = semanticTerms(left);
  const rightTerms = semanticTerms(right);
  let count = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) count += 1;
  return count;
}

function semanticSignatures(value: string) {
  const signatures: string[] = [];
  if (/\b(?:no|not|never|cannot|can't|don't|do not|without)\b/i.test(value)) signatures.push("negation");
  if (/\b(?:if|unless|only if|only after|until|otherwise|subject to)\b/i.test(value)) signatures.push("condition");
  if (/\b(?:before|after|requires?|required|prerequisite|depends on)\b/i.test(value)) signatures.push("prerequisite");
  if (/\b(?:at least as|no worse than|no less than|better than|worse than|versus|compared? (?:with|to)|baseline)\b/i.test(value)) signatures.push("comparison");
  if (/\b(?:replac(?:e|ed|es)|supersed(?:e|ed|es)|instead|is out|are out|reject(?:ed)?|obsolete|scratch|no longer)\b/i.test(value)) signatures.push("supersession");
  if (/\b(?:because|therefore|\bso\b|caused|the reason|rationale|in order to)\b/i.test(value)) signatures.push("rationale");
  if (/\b(?:unresolved|undecided|open|pending|not (?:yet )?(?:confirmed|established|settled)|deferred)\b/i.test(value)) signatures.push("unresolved");
  if (/\b(?:next action|next step|before anything else|begin with)\b/i.test(value)) signatures.push("next_action");
  if (continuationRoles(value).includes("semantic_identity")) signatures.push("semantic_identity");
  return [...new Set(signatures)];
}

function mechanismSimilarity(left: CompactMechanism, right: CompactMechanism) {
  const leftWords = new Set(words(left.statement));
  const rightWords = new Set(words(right.statement));
  const smaller = Math.min(leftWords.size, rightWords.size);
  if (!smaller) return { count: 0, ratio: 0 };
  let count = 0;
  for (const word of leftWords) if (rightWords.has(word)) count += 1;
  return { count, ratio: count / smaller };
}

function explicitlyNonGoverning(value: string) {
  return /\b(?:does not need to|doesn't need to|need not|can wait|no need to)\b/i.test(value);
}

function collapseRepeatedMechanisms(mechanisms: CompactMechanism[]) {
  const selected: CompactMechanism[] = [];
  const ordered = [...mechanisms].sort((left, right) => (
    relationshipDensity(right) - relationshipDensity(left)
    || semanticSignatures(right.statement).length - semanticSignatures(left.statement).length
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id)
  ));
  for (const mechanism of ordered) {
    const roles = continuationRoles(mechanism.statement);
    const duplicate = selected.some((existing) => {
      const existingRoles = continuationRoles(existing.statement);
      const sharedRole = roles.some((role) => existingRoles.includes(role));
      const protectedRoleMismatch = ["next_action", "unresolved", "conditional", "correction", "semantic_identity"]
        .some((role) => roles.includes(role as ContinuationRole) && !existingRoles.includes(role as ContinuationRole));
      if (protectedRoleMismatch) return false;
      const similarity = mechanismSimilarity(mechanism, existing);
      return sharedRole && (
        (similarity.count >= 3 && similarity.ratio >= 0.5)
        || (similarity.count >= 4 && similarity.ratio >= 0.38)
        || (roles.includes("next_action") && existingRoles.includes("next_action") && similarity.count >= 3)
        || (semanticOverlap(mechanism.statement, existing.statement) >= 4
          && roles.includes("constraint") && existingRoles.includes("constraint"))
      );
    });
    if (!duplicate) selected.push(mechanism);
  }
  return selected;
}

type ClosureNode = {
  mechanism: CompactMechanism;
  roles: ContinuationRole[];
  relationshipTypes: string[];
  required: boolean;
  materialityReason: string;
  depth: number;
  clusterId: string;
};

function relationshipDensity(mechanism: CompactMechanism) {
  return new Set([
    ...continuationRoles(mechanism.statement),
    ...(mechanism.counterevidenceIds.length ? ["counterevidence"] : []),
    ...(mechanism.scopeConditions.length ? ["scope_condition"] : []),
    ...(mechanism.exclusions.length ? ["exclusion"] : []),
  ]).size;
}

function explicitCurrentScore(mechanism: CompactMechanism) {
  return Number(/\b(?:current|governing|preferred|remains?|is now|are now|for now|working choice|objective)\b/i.test(mechanism.statement));
}

function compareSeedCandidates(task: string, role: ContinuationRole) {
  return (left: CompactMechanism, right: CompactMechanism) => (
    explicitCurrentScore(right) - explicitCurrentScore(left)
    || Number(continuationRoles(right.statement).includes(role)) - Number(continuationRoles(left.statement).includes(role))
    || relationshipDensity(right) - relationshipDensity(left)
    || overlap(task, right.statement) - overlap(task, left.statement)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id)
  );
}

function continuationClosure(
  context: CompactContext,
  task: string,
  requestedOutput: string | null,
) {
  const classification = continuationTaskScope(task, requestedOutput);
  const scope = classification.scope;
  const lexical = context.matchingMechanisms.length
    ? context.matchingMechanisms
    : context.caseMechanisms;
  const source = scope === "narrow"
    ? lexical
    : context.caseMechanisms.length ? context.caseMechanisms : lexical;
  const newerCorrections = (mechanism: CompactMechanism) => source.some((candidate) => (
    candidate.createdAt > mechanism.createdAt
    && continuationRoles(candidate.statement).includes("correction")
    && semanticOverlap(candidate.statement, mechanism.statement) >= 1
  ));
  const stateValid = source.filter((mechanism) => !(
    continuationRoles(mechanism.statement).includes("direction")
    && !continuationRoles(mechanism.statement).includes("correction")
    && !explicitCurrentScore(mechanism)
    && newerCorrections(mechanism)
  ));
  const duplicatesCollapsed = collapseRepeatedMechanisms(stateValid);
  const pruned: Array<{ id: string; reason: string }> = stateValid
    .filter((item) => !duplicatesCollapsed.some((selected) => selected.id === item.id))
    .map((item) => ({ id: item.id, reason: "Redundant with a stronger proposition carrying the same semantic role." }));
  const exclusions: Array<{ id: string; reason: string }> = source
    .filter((item) => !stateValid.some((selected) => selected.id === item.id))
    .map((item) => ({ id: item.id, reason: "A newer governed correction supersedes this direction; the correction guard remains eligible." }));

  const orientationCandidates = duplicatesCollapsed
    .filter((item) => continuationRoles(item.statement).includes("direction"))
    .sort(compareSeedCandidates(task, "direction"));
  const actionCandidates = duplicatesCollapsed
    .filter((item) => continuationRoles(item.statement).includes("next_action"))
    .sort(compareSeedCandidates(task, "next_action"));
  const orientationSeed = scope === "narrow" ? null : orientationCandidates[0] || null;
  const localActionSeed = actionCandidates[0]
    || [...duplicatesCollapsed].sort(compareSeedCandidates(task, "direction"))[0]
    || null;
  const seedIds = new Set([orientationSeed?.id, localActionSeed?.id].filter((id): id is string => Boolean(id)));
  const seedStatements = [orientationSeed, localActionSeed].filter((item): item is CompactMechanism => Boolean(item));
  const directlyConnected = (mechanism: CompactMechanism) => seedStatements.some((seed) => (
    seed.id === mechanism.id || semanticOverlap(seed.statement, mechanism.statement) >= 1
  ));
  const strongRoles = new Set<ContinuationRole>(["constraint", "conditional", "unresolved", "semantic_identity"]);
  const material = duplicatesCollapsed.filter((mechanism) => {
    const roles = continuationRoles(mechanism.statement);
    if (explicitlyNonGoverning(mechanism.statement)) return false;
    if (scope === "narrow") return mechanismMatchesTask(task, mechanism, context.caseRecord?.id || null) || seedIds.has(mechanism.id);
    if (seedIds.has(mechanism.id)) return true;
    if (roles.some((role) => strongRoles.has(role))) return true;
    if (roles.includes("correction") && (roles.includes("rationale") || directlyConnected(mechanism))) return true;
    if (roles.includes("direction") && roles.includes("correction")) return true;
    if (roles.includes("rationale") && directlyConnected(mechanism)) return true;
    if (roles.includes("shared_term") && directlyConnected(mechanism)) return true;
    if (scope === "broad" && roles.includes("direction")) return true;
    return overlap(task, mechanism.statement) >= 2 && roles.length > 0;
  });
  const selected = new Map<string, { depth: number; reason: string }>();
  for (const seed of seedStatements) selected.set(seed.id, {
    depth: 0,
    reason: seed.id === orientationSeed?.id
      ? "Reserved as the compact global orientation seed before local ranking."
      : "Selected as the materially current local continuation seed.",
  });
  for (const mechanism of material) {
    if (selected.has(mechanism.id)) continue;
    const roles = continuationRoles(mechanism.statement);
    const connected = directlyConnected(mechanism);
    selected.set(mechanism.id, {
      depth: connected ? 1 : 2,
      reason: roles.some((role) => strongRoles.has(role))
        ? `Omission could permit invalid continuation because this proposition carries ${roles.filter((role) => strongRoles.has(role)).join(", ")}.`
        : roles.includes("correction")
          ? "Omission could plausibly revive superseded project state."
          : roles.includes("rationale")
            ? "The rationale is materially connected to a selected current decision and prevents reversal or misinterpretation."
            : "The proposition is directly task-relevant and connected to selected governed state.",
    });
  }
  // One bounded second-order pass: a dependency of a required node may itself carry
  // a strong guard even when it did not overlap the original seed.
  const firstOrder = duplicatesCollapsed.filter((item) => selected.has(item.id));
  for (const mechanism of duplicatesCollapsed) {
    if (selected.has(mechanism.id)) continue;
    if (explicitlyNonGoverning(mechanism.statement)) continue;
    const roles = continuationRoles(mechanism.statement);
    const connection = firstOrder.some((item) => semanticOverlap(item.statement, mechanism.statement) >= 1);
    const dependencyRole = roles.some((role) => strongRoles.has(role))
      || roles.includes("direction")
      || roles.includes("rationale");
    if (connection && dependencyRole) {
      selected.set(mechanism.id, {
        depth: 2,
        reason: "A closure-required first-order dependency is materially constrained by this second-order guard.",
      });
    }
  }
  const selectedMechanisms = duplicatesCollapsed.filter((item) => selected.has(item.id)).slice(0, 24);
  const optional = duplicatesCollapsed.filter((item) => !selected.has(item.id) && overlap(task, item.statement) >= 2);
  for (const item of duplicatesCollapsed) {
    if (!selected.has(item.id) && !optional.some((candidate) => candidate.id === item.id)) {
      exclusions.push({ id: item.id, reason: "Weak, stale, redundant, or unrelated to the bounded continuation closure." });
    }
  }
  const componentById = new Map<string, string>();
  let component = 0;
  for (const mechanism of selectedMechanisms) {
    const linked = selectedMechanisms.find((candidate) => (
      candidate.id !== mechanism.id
      && componentById.has(candidate.id)
      && semanticOverlap(candidate.statement, mechanism.statement) >= 2
    ));
    componentById.set(mechanism.id, linked ? componentById.get(linked.id)! : `cluster-${++component}`);
  }
  const rolePriority: ContinuationRole[] = ["direction", "next_action", "constraint", "conditional", "correction", "rationale", "unresolved", "semantic_identity", "shared_term"];
  const nodes: ClosureNode[] = selectedMechanisms.map((mechanism) => {
    const roles = continuationRoles(mechanism.statement);
    const selection = selected.get(mechanism.id)!;
    return {
      mechanism,
      roles,
      relationshipTypes: [...new Set(roles.map((role) => role === "direction" ? "current_orientation" : role))],
      required: true,
      materialityReason: selection.reason,
      depth: selection.depth,
      clusterId: componentById.get(mechanism.id) || "cluster-1",
    };
  }).sort((left, right) => {
    const leftPriority = Math.min(...left.roles.map((role) => rolePriority.indexOf(role)).filter((value) => value >= 0), rolePriority.length);
    const rightPriority = Math.min(...right.roles.map((role) => rolePriority.indexOf(role)).filter((value) => value >= 0), rolePriority.length);
    return leftPriority - rightPriority || left.depth - right.depth || right.mechanism.createdAt.localeCompare(left.mechanism.createdAt) || left.mechanism.id.localeCompare(right.mechanism.id);
  });
  const mechanisms = nodes.map((node) => node.mechanism);
  const roles = [...new Set(nodes.flatMap((node) => node.roles))];
  const missing: string[] = [];
  if (scope !== "narrow" && orientationCandidates.length && !orientationSeed) missing.push("current_orientation");
  if (actionCandidates.length && !nodes.some((node) => node.roles.includes("next_action"))) missing.push("next_action");
  const diagnostics: ContinuationClosureDiagnostics = {
    scope,
    scopeReason: classification.reason,
    seeds: {
      orientation: orientationSeed ? [orientationSeed.id] : [],
      localAction: localActionSeed ? [localActionSeed.id] : [],
    },
    requiredDependencyAdditions: nodes.filter((node) => node.depth > 0).map((node) => ({
      id: node.mechanism.id,
      roles: node.roles,
      reason: node.materialityReason,
      depth: node.depth,
    })),
    optionalDependencies: optional.map((item) => item.id),
    exclusions,
    unresolved: nodes.filter((node) => node.roles.includes("unresolved")).map((node) => node.mechanism.id),
    semanticIdentities: nodes.filter((node) => node.roles.includes("semantic_identity")).map((node) => node.mechanism.id),
    sourceLineage: nodes.map((node) => ({ id: node.mechanism.id, versionId: node.mechanism.versionId })),
    completeness: { complete: missing.length === 0, missing },
    closureSizeBeforeCompaction: nodes.length,
    packetSize: null,
    relationshipTypes: [...new Set(nodes.flatMap((node) => node.relationshipTypes))],
    traversalDepth: Math.max(0, ...nodes.map((node) => node.depth)),
    clusterCount: new Set(nodes.map((node) => node.clusterId)).size,
    pruned,
    semanticRecoveryActions: [],
    stopReason: nodes.length >= 24
      ? "bounded_candidate_limit_reached"
      : "no_omitted_fact_can_plausibly_change_continuation",
  };
  return {
    scope,
    scopeReason: classification.reason,
    mechanisms,
    nodes,
    roles,
    sourceCount: source.length,
    materialCount: material.length,
    repeatedCount: pruned.length,
    complete: diagnostics.completeness.complete,
    diagnostics,
  };
}

async function compactContext(
  db: D1Database,
  projectId: string,
  caseId: string | null,
  task: string,
): Promise<CompactContext> {
  await requireProject(db, projectId);
  let caseRecord: CompactContext["caseRecord"] = null;
  if (caseId) {
    assertId(caseId, "case ID");
    const row = await first<Row>(db.prepare(
      "SELECT id, objective, status, scope FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(caseId, projectId));
    if (!row) throw new Error("Case not found.");
    caseRecord = {
      id: String(row.id),
      objective: String(row.objective),
      status: String(row.status),
      scope: String(row.scope),
    };
  }

  const mechanismRows = await all<Row>(db.prepare(
    `SELECT m.id, m.current_governing_version_id, v.statement, v.created_at,
            v.authority_state, v.supporting_case_ids, v.counterevidence_ids,
            v.scope_conditions, v.exclusions
     FROM mechanisms m
     JOIN mechanism_versions v
       ON v.id = m.current_governing_version_id
      AND v.project_id = m.project_id
     WHERE m.project_id = ?
       AND m.status = 'active'
       AND v.authority_state IN (
         'approved_local', 'approved_project_wide', 'approved_cross_project'
       )
     ORDER BY v.created_at DESC, m.id ASC`,
  ).bind(projectId));
  const mechanisms = mechanismRows.map((row): CompactMechanism => {
    const caseIds = stringList(row.supporting_case_ids);
    const authority = String(row.authority_state);
    return {
      id: String(row.id),
      versionId: String(row.current_governing_version_id),
      statement: String(row.statement),
      authority,
      scope: authority === "approved_local" ? "local" : "project_wide",
      caseIds,
      counterevidenceIds: stringList(row.counterevidence_ids),
      scopeConditions: stringList(row.scope_conditions),
      exclusions: stringList(row.exclusions),
      createdAt: String(row.created_at),
    };
  });

  const indicator = await first<Row>(db.prepare(
    `SELECT COUNT(*) AS count
     FROM reasoning_nodes
     WHERE project_id = ?
       AND (? IS NULL OR case_id = ?)
       AND status NOT IN ('rejected', 'retired', 'superseded')
       AND (
         LOWER(node_type) IN ('correction', 'challenge')
         OR authority_state = 'challenged'
       )`,
  ).bind(projectId, caseId, caseId));

  return {
    caseRecord,
    mechanisms,
    matchingMechanisms: mechanisms.filter((mechanism) => mechanismMatchesTask(task, mechanism, caseId)),
    caseMechanisms: caseId
      ? mechanisms.filter((mechanism) => mechanism.caseIds.includes(caseId))
      : [],
    correctionOrConflictIndicators: Number(indicator?.count || 0),
    recordsScanned: 1 + (caseRecord ? 1 : 0) + mechanisms.length + Number(indicator?.count || 0),
  };
}

type RoadwayConvergence = {
  converged: boolean;
  rawInterpretiveAmbiguity: boolean;
  plausibleRoadwayIds: string[];
  mechanismIds: string[];
  reason: string;
};

function stableList(values: string[]) {
  return [...new Set(values)].sort();
}

async function assessRoadwayConvergence(
  db: D1Database,
  projectId: string,
  request: ReturnType<typeof validateContinuityRequest>,
  context: CompactContext,
  interpretation: TaskInterpretation,
): Promise<RoadwayConvergence> {
  const plausibleRoadwayIds = stableList(
    interpretation.candidateInterpretations.map((candidate) => candidate.roadwayId),
  );
  const mechanism = context.matchingMechanisms[0];
  const unsafeReason = context.matchingMechanisms.length !== 1
    ? "Outcome equivalence requires exactly one applicable governed mechanism."
    : context.correctionOrConflictIndicators > 0
      ? "A correction or conflict requires full governed treatment."
      : mechanism.counterevidenceIds.length > 0
        ? "Linked counterevidence requires full governed treatment."
        : hasProtectedSensitivity(mechanism)
          ? "Protected sensitivity requirements prevent compact delivery."
          : plausibleRoadwayIds.length === 1
            ? "There is one applicable roadway, so outcome-equivalence collapse is unnecessary."
            : null;
  if (unsafeReason) {
    return {
      converged: false,
      rawInterpretiveAmbiguity: interpretation.materialAmbiguity,
      plausibleRoadwayIds,
      mechanismIds: context.matchingMechanisms.map((item) => item.id),
      reason: unsafeReason,
    };
  }

  const normalizedInput = canonicalContinuityInput(request);
  const outcomes = await Promise.all(plausibleRoadwayIds.map(async (roadwayId) => {
    const plausible = interpretation.candidateInterpretations.find(
      (candidate) => candidate.roadwayId === roadwayId,
    );
    const candidate = await interpretTask(db, projectId, {
      ...normalizedInput,
      roadwayOverride: roadwayId,
    }, { registryMode: "read_only" });
    const taskActivatedRoadwayRequirements = plausible?.reason.startsWith("Matched direct task signals:") === true;
    return JSON.stringify({
      mechanismId: mechanism.id,
      mechanismVersionId: mechanism.versionId,
      authority: mechanism.authority,
      scope: mechanism.scope,
      scopeConditions: stableList(mechanism.scopeConditions),
      exclusions: stableList(mechanism.exclusions),
      treatment: "Use",
      counterevidenceIds: stableList(mechanism.counterevidenceIds),
      requiredLiveState: taskActivatedRoadwayRequirements
        ? stableList(candidate.requiredLiveState)
        : [],
      compiledContent: compactMechanismView([mechanism], request.literalTask)?.compiledContent,
    });
  }));
  const converged = outcomes.every((outcome) => outcome === outcomes[0]);
  return {
    converged,
    rawInterpretiveAmbiguity: interpretation.materialAmbiguity,
    plausibleRoadwayIds,
    mechanismIds: [mechanism.id],
    reason: converged
      ? plausibleRoadwayIds.length === 0
        ? "No positively applicable roadway changes the single safe governed mechanism or compact delivery."
        : "Every safe plausible roadway produces the same single governed Use mechanism and equivalent compact delivery."
      : "Plausible roadways materially change governed constraints or compact delivery.",
  };
}

function gateRequiredState(task: string) {
  const lower = task.toLowerCase();
  if (/\b(training|traps? sore|workout|upper a|upper b)\b/.test(lower)) {
    return ["current_schedule", "soreness_severity", "injury_status", "recent_load", "available_equipment"];
  }
  if (/\b(pitcher prop|strikeouts?|innings|pitch count|brewers lesson)\b/.test(lower)) {
    return ["current_pitcher_health", "recent_workload", "pitch_leash", "prop_line_and_price"];
  }
  if (/\b(enter|wait|live-entry|live entry)\b/.test(lower) && /\bfavorite\b/.test(lower)) {
    return ["current_price", "game_state", "territory_signal", "chance_creation", "transition_risk"];
  }
  return [];
}

function needDecision(
  task: string,
  requestedOutput: string | null,
  context: CompactContext,
  caseId: string | null,
  closure: ReturnType<typeof continuationClosure>,
) {
  const fullTransferRequested = /\bfull room transfer\b/i.test(requestedOutput || "");
  if (fullTransferRequested) {
    return {
      level: "full" as const,
      reasonCodes: ["explicit_full_room_transfer"],
      explanation: "A full governed project-state packet was explicitly requested for room transfer.",
    };
  }
  const selected = closure.mechanisms;
  if (closure.scope !== "narrow" && selected.length) {
    const scopedConflict = selected.some((left, index) => selected.slice(index + 1).some((right) => (
      left.scope !== right.scope && overlap(left.statement, right.statement) >= 2
    )));
    const protectedDepth = context.correctionOrConflictIndicators > 0
      || scopedConflict
      || selected.some((mechanism) => mechanism.counterevidenceIds.length || hasProtectedSensitivity(mechanism));
    if (closure.scope === "broad" || protectedDepth || selected.length >= 8) {
      return {
        level: "full" as const,
        reasonCodes: [
          "project_continuation_closure",
          "closure_completeness_verified",
          ...(closure.scope === "broad" ? ["broad_continuation_scope"] : []),
          ...(selected.length >= 8 ? ["multiple_governing_clusters"] : []),
          ...(protectedDepth ? ["protected_dependency_depth"] : []),
        ],
        explanation: "The fresh room needs multiple current governed clusters and their material dependencies, not only the immediate next instruction.",
      };
    }
    if (selected.length >= 2) {
      return {
        level: "medium" as const,
        reasonCodes: ["project_continuation_closure", "closure_completeness_verified", "bounded_dependency_cluster"],
        explanation: "Several related current facts form the smallest complete continuation closure without requiring broad project reconstruction.",
      };
    }
    return {
      level: "light" as const,
      reasonCodes: ["project_continuation_closure", "closure_completeness_verified", "single_coherent_state_truth"],
      explanation: "One cohesive governed proposition contains the complete bounded continuation state.",
    };
  }
  const presentation = PRESENTATION_PATTERN.test(task);
  const compactPresentationIsSafe = presentation
    && selected.length === 1
    && context.correctionOrConflictIndicators === 0
    && selected[0].counterevidenceIds.length === 0;
  if (compactPresentationIsSafe) {
    return {
      level: "light" as const,
      reasonCodes: ["conditional_presentation_context", "compact_governed_signal"],
      explanation: "A bounded governed presentation preference applies, but full reconstruction is not justified.",
    };
  }
  const scopedConflict = selected.some((left, index) => selected.slice(index + 1).some((right) => (
    left.scope !== right.scope && overlap(left.statement, right.statement) >= 2
  )));
  const protectedDepth = context.correctionOrConflictIndicators > 0
    || scopedConflict
    || selected.some((mechanism) => mechanism.counterevidenceIds.length || hasProtectedSensitivity(mechanism));
  if (selected.length && (protectedDepth || selected.length >= 4)) {
    return {
      level: "full" as const,
      reasonCodes: [
        "broad_dependency_reconstruction",
        ...(selected.length >= 4 ? ["multiple_governing_clusters"] : []),
        ...(selected.some((mechanism) => mechanism.counterevidenceIds.length)
          ? ["linked_counterevidence_requires_full_governance"]
          : []),
        ...(context.correctionOrConflictIndicators ? ["correction_or_conflict_requires_full_governance"] : []),
        ...(scopedConflict ? ["scope_specific_state_conflict_requires_full_governance"] : []),
        ...(selected.some(hasProtectedSensitivity) ? ["protected_sensitivity_requires_full_governance"] : []),
      ],
      explanation: "Broad governed reconstruction is required so connected state, corrections, counterevidence, or protected constraints are not silently omitted.",
    };
  }
  if (selected.length >= 2) {
    return {
      level: "medium" as const,
      reasonCodes: ["multiple_related_state_truth_items", "bounded_dependency_cluster"],
      explanation: "Several related pieces of governed State Truth are needed, but broad project reconstruction is unnecessary.",
    };
  }
  if (selected.length === 1 && (!FULL_TASK_PATTERN.test(task) || presentation)) {
    return {
      level: "light" as const,
      reasonCodes: ["single_governed_orientation", "bounded_dependency_cluster"],
      explanation: "One source-grounded governing statement is sufficient to orient the fresh room.",
    };
  }
  const caseObjectiveMatch = Boolean(
    caseId && context.caseRecord && overlap(task, context.caseRecord.objective) >= 2,
  );
  if (FULL_TASK_PATTERN.test(task) || selected.length || caseObjectiveMatch) {
    return {
      level: "full" as const,
      reasonCodes: [
        ...(FULL_TASK_PATTERN.test(task) ? ["reasoning_or_decision_task"] : []),
        ...(caseObjectiveMatch ? ["active_case_context_match"] : []),
        ...(selected.length ? ["approved_mechanism_match"] : []),
      ],
      explanation: "Governed continuity can materially affect the reasoning, scope, constraints, or requested output.",
    };
  }
  return {
    level: null,
    reasonCodes: [
      "insufficient_source_grounded_state",
      ...(caseId ? ["bounded_case_did_not_match_task"] : []),
      ...(context.correctionOrConflictIndicators ? ["non_applicable_correction_or_conflict_only"] : []),
    ],
    explanation: "Atlas cannot establish enough source-grounded current state to prepare a truthful handoff. Clarify what the fresh room should continue or review the transferred room first.",
  };
}

function union(left: string[], right: string[]) {
  return [...new Set([...left, ...right])];
}

function baseEffects() {
  return {
    packetCreated: false,
    receiptCreated: false,
    handoffCreated: false,
    answerCreated: false,
    providerCallPerformed: false,
    authorityChanged: false,
    retrievalEligibilityChanged: false,
    canonicalMutationPerformed: false,
  };
}

function nextAction(status: string, level: AtlasNeedLevel | null) {
  if (level === null || status === "clarification_required") return "clarify_continuation_task_or_review_room";
  if (level === "light" || level === "medium") return "compile_immutable_transfer_packet";
  if (status === "clarification_required") return "clarify_or_select_a_current_run_roadway";
  if (status === "missing_required_state") return "supply_or_refresh_required_state";
  if (status === "unsafe_under_selected_budget") return "increase_budget_or_narrow_scope";
  return "review_then_request_reconstruction_run";
}

function compactMechanismView(
  mechanisms: CompactMechanism[],
  literalTask: string,
  level: AtlasNeedLevel = "light",
) {
  if (!mechanisms.length) return null;
  const compiledContent = [
    "# Atlas transfer packet preview",
    `Delivery: ${level.toUpperCase()}`,
    `Continue: ${literalTask}`,
    "",
    "## Current working state",
    ...mechanisms.map((mechanism) => `- ${mechanism.statement.replace(/\s+/g, " ").trim()}`),
  ].join("\n");
  const mechanism = mechanisms[0];
  return {
    sourceType: "Mechanism",
    sourceId: mechanism.id,
    sourceVersionId: mechanism.versionId,
    statement: mechanism.statement,
    representation: "Compressed",
    authority: mechanism.authority,
    scope: mechanism.scope,
    treatment: "Use" as const,
    role: "governing_context" as const,
    reason: `${level === "light" ? "One" : level === "medium" ? "Several related" : "Multiple governing clusters of"} governed State Truth item${mechanisms.length === 1 ? "" : "s"} matched the continuation task.`,
    compiledContent,
    includedItems: mechanisms.length,
    estimatedTokens: Math.ceil(compiledContent.length / 4),
    items: mechanisms.map((item): GovernedDeliveryItem => ({
      id: item.id,
      versionId: item.versionId,
      statement: item.statement,
      authority: item.authority,
      scope: item.scope,
    })),
  };
}

function closureDeliveryItems(closure: ReturnType<typeof continuationClosure>): GovernedDeliveryItem[] {
  return closure.nodes.map((node) => ({
    id: node.mechanism.id,
    versionId: node.mechanism.versionId,
    statement: node.mechanism.statement,
    authority: node.mechanism.authority,
    scope: node.mechanism.scope,
    roles: node.roles,
    required: node.required,
    materialityReason: node.materialityReason,
    dependencyDepth: node.depth,
    clusterId: node.clusterId,
    semanticSignatures: semanticSignatures(node.mechanism.statement),
  }));
}

function candidateItems(preview: Awaited<ReturnType<typeof previewPacketCandidates>>) {
  return [
    ...preview.treatmentSummary.Use,
    ...preview.treatmentSummary.Consider,
    ...preview.treatmentSummary.Exclude,
  ];
}

export async function checkContinuity(
  db: D1Database,
  projectId: string,
  input: ContinuityRequestInput,
) {
  const request = validateContinuityRequest(input);
  const literalTask = request.literalTask;
  const caseId = request.caseId;
  const preflightStarted = Date.now();
  const context = await compactContext(db, projectId, caseId, literalTask);
  const preflightLatency = Date.now() - preflightStarted;
  const closure = continuationClosure(context, literalTask, request.requestedOutput);
  const need = needDecision(literalTask, request.requestedOutput, context, caseId, closure);
  const selectedDeliveryMechanisms = closure.mechanisms;
  const budget = request.tokenBudget;

  const common = {
    apiVersion: "v1.7.1",
    projectId,
    caseId,
    literalTask,
    need,
    effects: baseEffects(),
  };

  if (need.level !== "full" || need.reasonCodes.includes("project_continuation_closure")) {
    const status = need.level === null ? "clarification_required" : `${need.level}_context_available`;
    return {
      ...common,
      status,
      interpretation: null,
      roadway: {
        primary: null,
        candidates: [],
        interpretiveAmbiguity: false,
        materialAmbiguity: false,
        outcomeEquivalent: false,
        convergedMechanismIds: [],
        convergenceReason: null,
      },
      compactCapsule: need.level === "light" || need.level === "medium"
        ? compactMechanismView(selectedDeliveryMechanisms, literalTask, need.level)
        : null,
      deliveryItems: closureDeliveryItems(closure),
      continuity: {
        governingMechanisms: need.level ? selectedDeliveryMechanisms.length : 0,
        requiredChecks: 0,
        considerItems: 0,
        auditOnlyProvenance: 0,
        correctionOrConflictIndicators: context.correctionOrConflictIndicators,
        protectedCorrections: 0,
        protectedConflicts: 0,
        strongestChallengePreserved: false,
      },
      freshness: {
        required: [],
        missing: [],
        safe: true,
      },
      budget: {
        selected: budget,
        estimatedMinimumSafe: null,
        estimatedFinal: null,
        safe: true,
      },
      diagnostics: {
        recordsScanned: context.recordsScanned,
        recordsSurvivingEachGate: {
          projectBoundary: context.recordsScanned,
          caseBoundary: context.caseRecord ? 1 : 0,
          compactApprovedMatch: selectedDeliveryMechanisms.length,
          candidateRanking: 0,
          exactSourceExpansion: 0,
        },
        exactSourcesOpened: 0,
        latencyMs: { preflight: preflightLatency, interpretation: 0, candidatePreview: 0 },
        stoppingReason: need.level === null ? "clarification_required" : `${need.level}_delivery_sufficient`,
        wideningCount: 0,
        candidatePreviewInvoked: false,
        continuationClosure: {
          ...closure.diagnostics,
          roles: closure.roles,
          sourceCount: closure.sourceCount,
          materialCount: closure.materialCount,
          repeatedCount: closure.repeatedCount,
        },
      },
      next: {
        action: nextAction(status, need.level),
        reconstructionRunAvailable: need.level !== null,
      },
    };
  }

  const normalizedInput = canonicalContinuityInput(request);
  const interpretationStarted = Date.now();
  const interpretation = await interpretTask(db, projectId, normalizedInput, {
    registryMode: "read_only",
  });
  const interpretationLatency = Date.now() - interpretationStarted;
  const convergence = (interpretation.materialAmbiguity || !interpretation.primaryRoadway)
    && !need.reasonCodes.includes("explicit_full_room_transfer")
    ? await assessRoadwayConvergence(db, projectId, request, context, interpretation)
    : null;
  if (convergence?.converged) {
    const collapsedNeed = {
      level: "light" as const,
      reasonCodes: [
        "single_governed_mechanism",
        ...(convergence.plausibleRoadwayIds.length ? ["roadway_outcomes_equivalent"] : ["no_applicable_roadway"]),
      ],
      explanation: convergence.plausibleRoadwayIds.length
        ? "Every safe task interpretation converges on one governed mechanism, so a compact context aid is sufficient."
        : "No Roadway is applicable, and one safe governed mechanism is sufficient for compact delivery.",
    };
    const status = "light_context_available";
    return {
      ...common,
      need: collapsedNeed,
      status,
      interpretation: {
        ...interpretation,
        rawInterpretiveAmbiguity: convergence.rawInterpretiveAmbiguity,
        materialAmbiguity: false,
        clarificationRequired: false,
        ambiguityReason: null,
        outcomeEquivalence: convergence,
      },
      roadway: {
        primary: null,
        candidates: interpretation.candidateInterpretations,
        interpretiveAmbiguity: convergence.rawInterpretiveAmbiguity,
        materialAmbiguity: false,
        outcomeEquivalent: true,
        convergedMechanismIds: convergence.mechanismIds,
        convergenceReason: convergence.reason,
      },
      compactCapsule: compactMechanismView([context.matchingMechanisms[0]], literalTask),
      deliveryItems: [context.matchingMechanisms[0]].map((item): GovernedDeliveryItem => ({
        id: item.id,
        versionId: item.versionId,
        statement: item.statement,
        authority: item.authority,
        scope: item.scope,
      })),
      continuity: {
        governingMechanisms: 1,
        requiredChecks: 0,
        considerItems: 0,
        auditOnlyProvenance: 0,
        correctionOrConflictIndicators: 0,
        protectedCorrections: 0,
        protectedConflicts: 0,
        strongestChallengePreserved: false,
      },
      freshness: {
        required: [],
        missing: [],
        safe: true,
      },
      budget: {
        selected: budget,
        estimatedMinimumSafe: null,
        estimatedFinal: null,
        safe: true,
      },
      diagnostics: {
        recordsScanned: context.recordsScanned,
        recordsSurvivingEachGate: {
          projectBoundary: context.recordsScanned,
          caseBoundary: context.caseRecord ? 1 : 0,
          compactApprovedMatch: 1,
          candidateRanking: 0,
          exactSourceExpansion: 0,
        },
        exactSourcesOpened: 0,
        latencyMs: {
          preflight: preflightLatency,
          interpretation: interpretationLatency,
          candidatePreview: 0,
        },
        stoppingReason: "light_capsule_sufficient_after_roadway_convergence",
        wideningCount: 0,
        candidatePreviewInvoked: false,
        roadwayOutcomesEvaluated: convergence.plausibleRoadwayIds.length,
      },
      next: {
        action: nextAction(status, collapsedNeed.level),
        reconstructionRunAvailable: false,
      },
    };
  }
  const previewStarted = Date.now();
  const preview = await previewPacketCandidates(db, projectId, normalizedInput, {
    interpretation,
  });
  const previewLatency = Date.now() - previewStarted;
  const items = candidateItems(preview);
  const gateState = gateRequiredState(literalTask);
  const freshCategories = new Set(items.filter((item) => (
    item.sourceType === "LiveStateSnapshot"
      && item.treatment === "Use"
      && item.freshness === "fresh"
      && typeof item.metadata?.category === "string"
  )).map((item) => String(item.metadata?.category)));
  const gateMissing = gateState.filter((category) => !freshCategories.has(category));
  const requiredState = union(preview.freshness.required, gateState);
  const missingState = union(preview.freshness.missing, gateMissing);
  const status = preview.status === "clarification_required"
    ? "clarification_required"
    : missingState.length
      ? "missing_required_state"
      : preview.status;
  const exactSourcesOpened = items.filter((item) => (
    item.representation === "Exact"
      && ["Event", "SourceArtifact", "LiveStateSnapshot"].includes(item.sourceType)
  )).length;
  const wrongScopeOrTerminal = preview.treatmentSummary.Exclude.filter((item) => (
    /outside the active case|canonical state is|stale/i.test(item.reason)
  )).length;

  return {
    ...common,
    status,
    interpretation,
    roadway: {
      primary: interpretation.primaryRoadway
        ? {
          id: interpretation.primaryRoadway.id,
          versionId: interpretation.primaryRoadway.versionId,
          name: interpretation.primaryRoadway.name,
        }
        : null,
      candidates: interpretation.candidateInterpretations,
      interpretiveAmbiguity: interpretation.materialAmbiguity,
      materialAmbiguity: interpretation.materialAmbiguity,
      outcomeEquivalent: convergence?.converged ?? false,
      convergedMechanismIds: convergence?.mechanismIds ?? [],
      convergenceReason: convergence?.reason ?? null,
    },
    compactCapsule: null,
    continuity: {
      governingMechanisms: preview.treatmentSummary.Use.filter((item) => item.sourceType === "Mechanism").length,
      requiredChecks: preview.requiredChecks.length,
      considerItems: preview.treatmentSummary.Consider.length,
      auditOnlyProvenance: preview.treatmentSummary.Exclude.filter((item) => item.metadata?.lineageOnly === true).length,
      correctionOrConflictIndicators: context.correctionOrConflictIndicators,
      protectedCorrections: preview.protectedCorrections.length,
      protectedConflicts: preview.protectedConflicts.length,
      strongestChallengePreserved: preview.candidateSummary.strongestChallengeRetained,
    },
    freshness: {
      required: requiredState,
      missing: missingState,
      engineRequired: preview.freshness.required,
      engineMissing: preview.freshness.missing,
      gateRequired: gateState,
      safe: missingState.length === 0,
    },
    budget: {
      selected: preview.tokenBudget,
      estimatedMinimumSafe: preview.estimatedSafeMinimum,
      estimatedFinal: preview.estimatedFinalSize,
      safe: status !== "unsafe_under_selected_budget",
    },
    treatmentCounts: {
      Use: preview.treatmentSummary.Use.length,
      Consider: preview.treatmentSummary.Consider.length,
      Exclude: preview.treatmentSummary.Exclude.length,
    },
    diagnostics: {
      recordsScanned: context.recordsScanned + preview.candidateSummary.discovered,
      recordsSurvivingEachGate: {
        projectBoundary: preview.candidateSummary.discovered,
        caseBoundary: Math.max(0, preview.candidateSummary.discovered - wrongScopeOrTerminal),
        authorityStatusFreshness: Math.max(0, preview.candidateSummary.discovered - wrongScopeOrTerminal),
        candidateRanking: preview.treatmentSummary.Use.length + preview.treatmentSummary.Consider.length,
        exactSourceExpansion: exactSourcesOpened,
      },
      exactSourcesOpened,
      latencyMs: {
        preflight: preflightLatency,
        interpretation: interpretationLatency,
        candidatePreview: previewLatency,
      },
      stoppingReason: status === "ready" ? "full_preview_ready" : status,
      wideningCount: 0,
      candidatePreviewInvoked: true,
    },
    next: {
      action: nextAction(status, need.level),
      reconstructionRunAvailable: status === "ready",
    },
  };
}
