import { previewPacketCandidates } from "./packet-service";
import { interpretTask } from "./roadway-service";
import {
  all,
  assertId,
  first,
  requireProject,
  Row,
} from "./slice3-support";

export type AtlasNeedLevel = "none" | "light" | "full";

type ContinuityCheckInput = Row & {
  task?: unknown;
  requestedOutput?: unknown;
  caseId?: unknown;
  roadwayOverride?: unknown;
  tokenBudget?: unknown;
};

type CompactMechanism = {
  id: string;
  versionId: string;
  statement: string;
  authority: string;
  scope: string;
  caseIds: string[];
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
  correctionOrConflictIndicators: number;
  recordsScanned: number;
};

const ALLOWED_FIELDS = new Set([
  "task",
  "requestedOutput",
  "caseId",
  "roadwayOverride",
  "tokenBudget",
]);

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "before",
  "but", "can", "current", "for", "from", "have", "how", "into", "its",
  "now", "one", "only", "our", "should", "that", "the", "their", "then",
  "this", "today", "use", "what", "when", "which", "with", "would", "your",
]);

const FULL_TASK_PATTERN = /\b(best bets?|best option|compare|decision rule|strongest|training|pitcher prop|postmortem|lesson|audit|rerank|enter|wait|choose|plan)\b/i;
const PRESENTATION_PATTERN = /\b(mobile|codex|transfer|copy[- ]ready|plain[- ]text|presentation|format)\b/i;

function exactTask(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Task is required.");
  return value;
}

function optionalExactString(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validateInput(input: ContinuityCheckInput) {
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unsupported.length) {
    throw new Error(`Unsupported client-authored continuity field: ${unsupported.sort().join(", ")}.`);
  }
}

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
    `SELECT m.id, m.current_governing_version_id, v.statement,
            v.authority_state, v.supporting_case_ids
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
    correctionOrConflictIndicators: Number(indicator?.count || 0),
    recordsScanned: 1 + (caseRecord ? 1 : 0) + mechanisms.length + Number(indicator?.count || 0),
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

function needDecision(task: string, context: CompactContext, caseId: string | null) {
  const presentation = PRESENTATION_PATTERN.test(task);
  if (presentation && context.matchingMechanisms.length) {
    return {
      level: "light" as const,
      reasonCodes: ["conditional_presentation_context", "compact_governed_signal"],
      explanation: "A bounded governed presentation preference applies, but full reconstruction is not justified.",
    };
  }
  const caseObjectiveMatch = Boolean(
    caseId && context.caseRecord && overlap(task, context.caseRecord.objective) >= 2,
  );
  if (FULL_TASK_PATTERN.test(task) || context.matchingMechanisms.length || caseObjectiveMatch) {
    return {
      level: "full" as const,
      reasonCodes: [
        ...(FULL_TASK_PATTERN.test(task) ? ["reasoning_or_decision_task"] : []),
        ...(caseObjectiveMatch ? ["active_case_context_match"] : []),
        ...(context.matchingMechanisms.length ? ["approved_mechanism_match"] : []),
      ],
      explanation: "Governed continuity can materially affect the reasoning, scope, constraints, or requested output.",
    };
  }
  if (caseId || context.correctionOrConflictIndicators > 0) {
    return {
      level: "light" as const,
      reasonCodes: [
        ...(caseId ? ["bounded_case_metadata"] : []),
        ...(context.correctionOrConflictIndicators ? ["correction_or_conflict_indicator"] : []),
      ],
      explanation: "Bounded metadata or a correction/conflict warning may matter, but full reconstruction is not yet justified.",
    };
  }
  return {
    level: "none" as const,
    reasonCodes: ["no_material_continuity_dependency"],
    explanation: "No governed continuity dependency was found that is likely to materially change this task.",
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

function nextAction(status: string, level: AtlasNeedLevel) {
  if (level === "none") return "proceed_without_atlas";
  if (level === "light") return "review_compact_continuity";
  if (status === "clarification_required") return "clarify_or_select_a_current_run_roadway";
  if (status === "missing_required_state") return "supply_or_refresh_required_state";
  if (status === "unsafe_under_selected_budget") return "increase_budget_or_narrow_scope";
  return "review_then_request_reconstruction_run";
}

function compactMechanismView(mechanism: CompactMechanism | undefined) {
  if (!mechanism) return null;
  return {
    sourceType: "Mechanism",
    sourceId: mechanism.id,
    sourceVersionId: mechanism.versionId,
    statement: mechanism.statement,
    representation: "Compressed",
    authority: mechanism.authority,
    scope: mechanism.scope,
    reason: "Compact governed continuity matched the current presentation context.",
  };
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
  input: ContinuityCheckInput,
) {
  validateInput(input);
  const literalTask = exactTask(input.task);
  const caseId = optionalExactString(input.caseId, "Case ID");
  const requestedOutput = optionalExactString(input.requestedOutput, "Requested output");
  const preflightStarted = Date.now();
  const context = await compactContext(db, projectId, caseId, literalTask);
  const preflightLatency = Date.now() - preflightStarted;
  const need = needDecision(literalTask, context, caseId);
  const budget = input.tokenBudget === undefined ? 800 : Number(input.tokenBudget);

  const common = {
    apiVersion: "v1.7.1",
    projectId,
    caseId,
    literalTask,
    need,
    effects: baseEffects(),
  };

  if (need.level !== "full") {
    const status = need.level === "none" ? "not_needed" : "light_context_available";
    return {
      ...common,
      status,
      interpretation: null,
      roadway: {
        primary: null,
        candidates: [],
        materialAmbiguity: false,
      },
      compactCapsule: need.level === "light"
        ? compactMechanismView(context.matchingMechanisms[0])
        : null,
      continuity: {
        governingMechanisms: need.level === "light" && context.matchingMechanisms.length ? 1 : 0,
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
          compactApprovedMatch: context.matchingMechanisms.length,
          candidateRanking: 0,
          exactSourceExpansion: 0,
        },
        exactSourcesOpened: 0,
        latencyMs: { preflight: preflightLatency, interpretation: 0, candidatePreview: 0 },
        stoppingReason: need.level === "none" ? "need_none" : "light_capsule_sufficient",
        wideningCount: 0,
        candidatePreviewInvoked: false,
      },
      next: {
        action: nextAction(status, need.level),
        reconstructionRunAvailable: false,
      },
    };
  }

  const normalizedInput: Row = {
    task: literalTask,
    ...(requestedOutput ? { requestedDecisionOrOutput: requestedOutput } : {}),
    ...(caseId ? { caseId } : {}),
    ...(input.roadwayOverride !== undefined ? { roadwayOverride: input.roadwayOverride } : {}),
    tokenBudget: budget,
  };
  const interpretationStarted = Date.now();
  const interpretation = await interpretTask(db, projectId, normalizedInput, {
    registryMode: "read_only",
  });
  const interpretationLatency = Date.now() - interpretationStarted;
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
      materialAmbiguity: interpretation.materialAmbiguity,
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
