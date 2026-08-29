import { sha256 } from "./transcript-import";
import {
  all,
  assertId,
  first,
  json,
  now,
  optionalString,
  requiredString,
  Row,
} from "./slice3-support";

export const ROADWAY_REGISTRY_VERSION = 1;

export type RoadwaySlug = "broad-lock-finding" | "margin-run-line-value" | "outcome-postmortem";

type RoadwayDefinition = {
  slug: RoadwaySlug;
  name: string;
  purpose: string;
  applicableTaskPatterns: string[];
  nonApplicableTaskPatterns: string[];
  requiredChecks: string[];
  supportingMechanismModules: string[];
  requiredCounterevidence: string[];
  requiredLiveState: string[];
  wideningRules: string[];
  narrowingRules: string[];
  stopConditions: string[];
  packetContract: Record<string, unknown>;
};

export const ROADWAY_DEFINITIONS: readonly RoadwayDefinition[] = [
  {
    slug: "broad-lock-finding",
    name: "Broad Lock-Finding",
    purpose: "Compare a broad candidate set and identify the most resilient decision pathway without presupposing a conclusion.",
    applicableTaskPatterns: [
      "compare the available options",
      "find the strongest or most resilient position",
      "evaluate a slate or broad market set",
    ],
    nonApplicableTaskPatterns: [
      "audit one named margin or run-line thesis",
      "explain a completed outcome or postmortem",
    ],
    requiredChecks: [
      "Define the requested decision and candidate universe.",
      "Separate offered price, probability, mechanism, and uncertainty.",
      "Compare viable alternatives under the same evidence standard.",
      "Carry the strongest challenge to the leading pathway.",
      "Name missing live state that could change the ranking.",
    ],
    supportingMechanismModules: [
      "candidate-comparison",
      "market-reality",
      "counter-script",
      "uncertainty",
    ],
    requiredCounterevidence: [
      "Strongest credible case against the leading pathway.",
      "A viable alternative with a different failure mechanism.",
    ],
    requiredLiveState: ["market_availability", "current_price", "participant_status"],
    wideningRules: [
      "Widen when the initial option lacks a defensible advantage over alternatives.",
      "Widen when a central assumption is contradicted.",
    ],
    narrowingRules: [
      "Narrow after mechanisms, prices, and key uncertainty are comparable.",
      "Prefer the shortest representation that preserves decisive differences.",
    ],
    stopConditions: [
      "Stop when required current state is missing or stale.",
      "Stop when no candidate clears the stated decision threshold.",
      "Stop when minimum safe context cannot fit the selected budget.",
    ],
    packetContract: {
      requiredSections: ["task", "intent", "checks", "currentState", "candidates", "challenges", "unknowns", "exclusions", "lineage"],
      conclusionPolicy: "roadway supplies checks and context, never a predetermined answer",
    },
  },
  {
    slug: "margin-run-line-value",
    name: "Margin / Run-Line Value",
    purpose: "Evaluate whether a position has margin or spread value by separating outright strength from cover mechanics and price.",
    applicableTaskPatterns: [
      "evaluate a run line, spread, handicap, or winning-margin thesis",
      "distinguish winning from covering",
      "compare margin distribution with the offered price",
    ],
    nonApplicableTaskPatterns: [
      "choose broadly across unrelated market mechanisms",
      "perform only an outcome postmortem",
    ],
    requiredChecks: [
      "Separate outright-win probability from margin-cover probability.",
      "Evaluate price against the probability required to break even.",
      "Test scoring or margin distribution and plausible one-score scripts.",
      "Inspect starting context, late separation, and opponent cover pathways.",
      "Carry the strongest applicable counterexample and contradiction.",
    ],
    supportingMechanismModules: [
      "margin-distribution",
      "price-threshold",
      "starter-bullpen-context",
      "counter-script",
    ],
    requiredCounterevidence: [
      "Strongest one-score or outright-opponent pathway.",
      "Most relevant outcome-backed challenge to the margin thesis.",
    ],
    requiredLiveState: ["market_availability", "current_price", "participant_status"],
    wideningRules: [
      "Widen to moneyline, total, or narrower mechanisms when margin value is not distinct.",
      "Widen the counter-script when outright loss remains material.",
    ],
    narrowingRules: [
      "Narrow to the mechanism that differentiates margin from outright strength.",
      "Retain price, conditions, and strongest challenge while removing redundant team-quality evidence.",
    ],
    stopConditions: [
      "Stop when the offered market or price is unavailable.",
      "Stop when current participant state is required but unavailable.",
      "Stop when minimum safe context cannot fit the selected budget.",
    ],
    packetContract: {
      requiredSections: ["task", "intent", "checks", "price", "marginMechanisms", "challenges", "unknowns", "exclusions", "lineage"],
      conclusionPolicy: "roadway tests margin value and does not encode a favorite, underdog, or market preference",
    },
  },
  {
    slug: "outcome-postmortem",
    name: "Outcome / Postmortem",
    purpose: "Reconstruct a completed reasoning pathway, compare it with reality, and preserve corrections without hindsight rewriting.",
    applicableTaskPatterns: [
      "explain why a completed decision succeeded or failed",
      "audit an outcome against prior assumptions",
      "identify postmortem corrections for later work",
    ],
    nonApplicableTaskPatterns: [
      "select a current broad option without an outcome",
      "price a current margin thesis without postmortem intent",
    ],
    requiredChecks: [
      "Preserve the original thesis, evidence, uncertainty, and recommendation.",
      "Separate what reality confirmed from what it contradicted.",
      "Identify which mechanism or assumption failed.",
      "Preserve user corrections and unresolved alternative explanations.",
      "Bound any lesson to supported scope and authority.",
    ],
    supportingMechanismModules: [
      "reasoning-path-reconstruction",
      "reality-contact",
      "contradiction",
      "correction",
    ],
    requiredCounterevidence: [
      "Strongest alternative explanation for the outcome.",
      "Evidence that the result may not generalize beyond the case.",
    ],
    requiredLiveState: ["final_outcome"],
    wideningRules: [
      "Widen to the full decision path when the final recommendation alone hides the causal error.",
      "Widen to competing explanations when the outcome is underdetermined.",
    ],
    narrowingRules: [
      "Narrow to consequences supported by the observed outcome.",
      "Do not convert one case into a universal mechanism.",
    ],
    stopConditions: [
      "Stop when the claimed outcome is missing or unsupported.",
      "Stop when source chronology cannot be distinguished from later reconstruction.",
      "Stop when minimum safe context cannot fit the selected budget.",
    ],
    packetContract: {
      requiredSections: ["task", "intent", "checks", "priorReasoning", "outcome", "contradictions", "corrections", "challenges", "lineage"],
      conclusionPolicy: "roadway supports an audit and does not predetermine the lesson",
    },
  },
] as const;

export type RoadwayRecord = RoadwayDefinition & {
  id: string;
  projectId: string;
  versionId: string;
  version: number;
  authorityState: string;
  status: string;
  createdAt: string;
};

async function stableRoadwayIds(projectId: string, slug: RoadwaySlug) {
  const digest = (await sha256(`${projectId}\n${slug}`)).slice(0, 32);
  return {
    roadwayId: `roadway:${digest}`,
    versionId: `roadway-version:${digest}:v${ROADWAY_REGISTRY_VERSION}`,
  };
}

function roadwayView(row: Row): RoadwayRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    versionId: String(row.current_version_id),
    version: ROADWAY_REGISTRY_VERSION,
    slug: String(row.slug) as RoadwaySlug,
    name: String(row.name),
    status: String(row.status),
    purpose: String(row.purpose),
    applicableTaskPatterns: JSON.parse(String(row.intent_patterns)),
    nonApplicableTaskPatterns: JSON.parse(String(row.non_applicable_patterns)),
    requiredChecks: JSON.parse(String(row.required_checks)),
    supportingMechanismModules: JSON.parse(String(row.supporting_mechanism_modules)),
    requiredCounterevidence: JSON.parse(String(row.expected_challenges)),
    requiredLiveState: JSON.parse(String(row.required_live_state)),
    wideningRules: JSON.parse(String(row.widening_rules)),
    narrowingRules: JSON.parse(String(row.narrowing_rules)),
    stopConditions: JSON.parse(String(row.stop_conditions)),
    packetContract: JSON.parse(String(row.packet_contract)),
    authorityState: String(row.authority_state),
    createdAt: String(row.created_at),
  };
}

async function registryRows(db: D1Database, projectId: string) {
  return all<Row>(db.prepare(
    `SELECT r.*, v.purpose, v.intent_patterns, v.non_applicable_patterns,
            v.required_checks, v.supporting_mechanism_modules,
            v.required_live_state, v.expected_challenges, v.widening_rules,
            v.narrowing_rules, v.stop_conditions, v.packet_contract,
            v.authority_state,
            CASE r.name
              WHEN 'Broad Lock-Finding' THEN 'broad-lock-finding'
              WHEN 'Margin / Run-Line Value' THEN 'margin-run-line-value'
              WHEN 'Outcome / Postmortem' THEN 'outcome-postmortem'
            END AS slug
     FROM roadways r
     JOIN roadway_versions v
       ON v.id = r.current_version_id AND v.project_id = r.project_id
     WHERE r.project_id = ?
     ORDER BY r.name ASC`,
  ).bind(projectId));
}

export async function readRoadwayRegistry(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(projectId));
  if (!project) throw new Error("Project not found.");
  return (await registryRows(db, projectId)).map(roadwayView);
}

export async function ensureRoadwayRegistry(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(projectId));
  if (!project) throw new Error("Project not found.");
  const existing = await registryRows(db, projectId);
  const existingNames = new Set(existing.map((row) => String(row.name)));
  const statements: D1PreparedStatement[] = [];
  const createdAt = now();
  for (const definition of ROADWAY_DEFINITIONS) {
    if (existingNames.has(definition.name)) continue;
    const { roadwayId, versionId } = await stableRoadwayIds(projectId, definition.slug);
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO roadways (
          id, project_id, name, current_version_id, status, legacy_reference, created_at
        ) VALUES (?, ?, ?, NULL, 'active', 'blueprint:v1.7:sections-9-and-29', ?)`,
      ).bind(roadwayId, projectId, definition.name, createdAt),
      db.prepare(
        `INSERT OR IGNORE INTO roadway_versions (
          id, project_id, roadway_id, purpose, intent_patterns,
          non_applicable_patterns, required_checks, supporting_mechanism_modules,
          required_live_state, expected_challenges, widening_rules,
          narrowing_rules, stop_conditions, packet_contract, authority_state,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved_project_wide', ?)`,
      ).bind(
        versionId,
        projectId,
        roadwayId,
        definition.purpose,
        json(definition.applicableTaskPatterns),
        json(definition.nonApplicableTaskPatterns),
        json(definition.requiredChecks),
        json(definition.supportingMechanismModules),
        json(definition.requiredLiveState),
        json(definition.requiredCounterevidence),
        json(definition.wideningRules),
        json(definition.narrowingRules),
        json(definition.stopConditions),
        json(definition.packetContract),
        createdAt,
      ),
      db.prepare(
        "UPDATE roadways SET current_version_id = ? WHERE id = ? AND project_id = ?",
      ).bind(versionId, roadwayId, projectId),
    );
  }
  if (statements.length) await db.batch(statements);
  return (await registryRows(db, projectId)).map(roadwayView);
}

type InterpretationInput = Row & {
  task?: unknown;
  caseId?: unknown;
  roadwayOverride?: unknown;
};

export type InterpretTaskOptions = {
  registryMode?: "ensure" | "read_only";
};

export type TaskInterpretation = {
  literalRequest: string;
  requestedDecisionOrOutput: string;
  activeProjectId: string;
  caseId: string | null;
  caseObjective: string | null;
  caseContextUsedForMatching: boolean;
  domain: string;
  taskOrMarketType: string;
  timeSensitivity: "current" | "historical" | "not_time_sensitive";
  scope: "broad" | "narrow";
  requiredReasoningMechanism: string;
  relevantSharedMeanings: string[];
  materialAmbiguity: boolean;
  clarificationRequired: boolean;
  ambiguityReason: string | null;
  primaryRoadway: RoadwayRecord | null;
  candidateInterpretations: Array<{ roadwayId: string; versionId: string; name: string; reason: string }>;
  supportingModules: string[];
  requiredLiveState: string[];
  selectionReason: string;
  userSelectedOverride: boolean;
  applicability: {
    applicableRoadwayIds: string[];
    excludedRoadways: Array<{ roadwayId: string; versionId: string; name: string; reason: string }>;
    governedRelationshipEvidenceUsed: boolean;
  };
};

const MARGIN_TERMS = [
  "run line", "run-line", "spread", "handicap", "cover", "covering",
  "winning margin", "margin value", "-1.5", "+1.5", "win by two", "multi-run",
];
const OUTCOME_TERMS = [
  "postmortem", "post-mortem", "why did", "why it failed", "why it lost",
  "why it won", "outcome", "result", "what went wrong", "lesson", "after the game",
];
const BROAD_TERMS = [
  "best bet", "best option", "strongest option", "compare markets", "compare options",
  "slate", "lock", "broad audit", "rank the", "which market", "find value",
];
const CURRENT_TERMS = ["today", "tonight", "current", "latest", "right now", "offered", "price", "available"];

function matches(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term));
}

const CASE_CONTEXT_STOP_WORDS = new Set([
  "and", "are", "for", "from", "into", "that", "the", "this", "when", "with",
  "compare", "develop", "find", "identify", "option", "options", "rule", "strongest",
]);

function boundedCaseContextApplies(task: string, objective: string | null) {
  if (!objective) return false;
  const terms = (value: string) => new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((term) => term.length >= 4 && !CASE_CONTEXT_STOP_WORDS.has(term)),
  );
  const taskTerms = terms(task);
  const objectiveTerms = terms(objective);
  let shared = 0;
  for (const term of taskTerms) {
    if (objectiveTerms.has(term)) shared += 1;
  }
  return shared >= 2;
}

function requestedOutput(task: string) {
  if (/\b(explain|why|postmortem|post-mortem|audit)\b/i.test(task)) return "explanation or audit";
  if (/\b(compare|rank|best|strongest|which)\b/i.test(task)) return "comparison and selection";
  if (/\b(price|value|cover|margin|spread|run[- ]line)\b/i.test(task)) return "value assessment";
  return "reasoning-context reconstruction";
}

function interpretationScores(task: string) {
  const text = task.toLowerCase();
  const margin = matches(text, MARGIN_TERMS);
  const outcome = matches(text, OUTCOME_TERMS);
  const broad = matches(text, BROAD_TERMS);
  return {
    "margin-run-line-value": { score: margin.length * 3, matched: margin },
    "outcome-postmortem": { score: outcome.length * 3, matched: outcome },
    "broad-lock-finding": { score: broad.length * 3, matched: broad },
  } satisfies Record<RoadwaySlug, { score: number; matched: string[] }>;
}

function patternTerms(value: string) {
  return new Set((value.toLowerCase().match(/[a-z0-9]+/gu) || [])
    .filter((term) => term.length >= 4 && !CASE_CONTEXT_STOP_WORDS.has(term))
    .map((term) => term.length > 6 && term.endsWith("s") ? term.slice(0, -1) : term));
}

function materiallyMatchesPattern(text: string, pattern: string) {
  const textTerms = patternTerms(text);
  const expected = patternTerms(pattern);
  if (expected.size < 2) return false;
  let overlap = 0;
  for (const term of expected) if (textTerms.has(term)) overlap += 1;
  return overlap >= 2 && overlap / expected.size >= 0.8;
}

function supportsApplicablePattern(text: string, patterns: string[]) {
  const textTerms = patternTerms(text);
  const supportedByOnePattern = patterns.some((pattern) => {
    const expected = patternTerms(pattern);
    if (expected.size < 2) return false;
    let overlap = 0;
    for (const term of expected) if (textTerms.has(term)) overlap += 1;
    return overlap >= 2 && overlap / expected.size >= 0.35;
  });
  if (supportedByOnePattern) return true;
  const allExpectedTerms = new Set(patterns.flatMap((pattern) => [...patternTerms(pattern)]));
  let aggregateOverlap = 0;
  for (const term of allExpectedTerms) if (textTerms.has(term)) aggregateOverlap += 1;
  return aggregateOverlap >= 2;
}

function hasPositiveApplicabilitySignal(text: string, matched: string[], roadway: RoadwayRecord) {
  return matched.length >= 2
    || matched.some((signal) => /[\s+./-]/u.test(signal) || signal.length >= 9)
    || matched.includes("lesson")
    || (matched.length > 0 && supportsApplicablePattern(text, roadway.applicableTaskPatterns));
}

async function governedRelationshipContext(
  db: D1Database,
  projectId: string,
  task: string,
  caseId: string | null,
  caseContextUsedForMatching: boolean,
) {
  const rows = await all<Row>(db.prepare(
    `SELECT mv.statement, mv.supporting_case_ids
     FROM mechanisms m
     JOIN mechanism_versions mv
       ON mv.id = m.current_governing_version_id AND mv.project_id = m.project_id
     WHERE m.project_id = ?
       AND m.status = 'active'
       AND mv.authority_state IN ('approved_project_wide', 'approved_local')
     ORDER BY m.id ASC`,
  ).bind(projectId));
  return rows.flatMap((row) => {
    const statement = String(row.statement);
    const supportingCaseIds = JSON.parse(String(row.supporting_case_ids || "[]")) as string[];
    const caseLinked = Boolean(caseId && caseContextUsedForMatching && supportingCaseIds.includes(caseId));
    return caseLinked || boundedCaseContextApplies(task, statement) ? [statement] : [];
  });
}

export async function interpretTask(
  db: D1Database,
  projectId: string,
  input: InterpretationInput,
  options: InterpretTaskOptions = {},
): Promise<TaskInterpretation> {
  const task = requiredString(input.task, "Task");
  const caseId = optionalString(input.caseId);
  let caseObjective: string | null = null;
  if (caseId) {
    assertId(caseId, "case ID");
    const record = await first<Row>(db.prepare(
      "SELECT id, objective FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(caseId, projectId));
    if (!record) throw new Error("Case not found.");
    caseObjective = String(record.objective);
  }
  const registry = options.registryMode === "read_only"
    ? await readRoadwayRegistry(db, projectId)
    : await ensureRoadwayRegistry(db, projectId);
  if (options.registryMode === "read_only" && registry.length < ROADWAY_DEFINITIONS.length) {
    throw new Error("Canonical roadway registry is unavailable for a read-only continuity check.");
  }
  const bySlug = new Map(registry.map((roadway) => [roadway.slug, roadway]));
  const caseContextUsedForMatching = boundedCaseContextApplies(task, caseObjective);
  const relatedGovernedStatements = await governedRelationshipContext(
    db,
    projectId,
    task,
    caseId,
    caseContextUsedForMatching,
  );
  const directScores = interpretationScores(task);
  const relationshipScores = interpretationScores(relatedGovernedStatements.join("\n"));
  const scores = Object.fromEntries((Object.keys(directScores) as RoadwaySlug[]).map((slug) => {
    const roadway = bySlug.get(slug)!;
    const nonApplicable = roadway.nonApplicableTaskPatterns.some((pattern) => materiallyMatchesPattern(task, pattern));
    const direct = directScores[slug];
    const relationship = relationshipScores[slug];
    const directApplies = hasPositiveApplicabilitySignal(task, direct.matched, roadway);
    const relationshipText = relatedGovernedStatements.join("\n");
    const relationshipApplies = hasPositiveApplicabilitySignal(relationshipText, relationship.matched, roadway);
    const applicableScore = (directApplies ? direct.score : 0) + (relationshipApplies ? relationship.score : 0);
    return [slug, {
      score: nonApplicable ? 0 : applicableScore,
      matched: [...new Set([
        ...(directApplies ? direct.matched : []),
        ...(relationshipApplies ? relationship.matched : []),
      ])],
      directMatched: directApplies ? direct.matched : [],
      relationshipMatched: relationshipApplies ? relationship.matched : [],
      excludedReason: nonApplicable
        ? "A declared non-applicable task pattern matched the current request."
        : applicableScore === 0
          ? "No positive task, scope, domain, semantic, or governed-relationship evidence established applicability."
          : null,
    }];
  })) as Record<RoadwaySlug, {
    score: number;
    matched: string[];
    directMatched: string[];
    relationshipMatched: string[];
    excludedReason: string | null;
  }>;
  const explicitOverride = optionalString(input.roadwayOverride);
  let primary: RoadwayRecord | null = null;
  let override = false;
  if (explicitOverride) {
    primary = registry.find((roadway) => roadway.id === explicitOverride || roadway.slug === explicitOverride) || null;
    if (!primary) throw new Error("Roadway override is invalid for this project.");
    override = true;
  }

  const ranked = (Object.entries(scores) as Array<[RoadwaySlug, typeof scores[RoadwaySlug]]>)
    .sort((left, right) => right[1].score - left[1].score);
  const positive = ranked.filter(([, value]) => value.score > 0);
  const competing = positive.filter(([, value]) => value.score === positive[0]?.[1].score);
  const materialAmbiguity = !override && (
    competing.length > 1
    || (
      positive.length > 1
      && positive[0][1].score - positive[1][1].score <= 3
      && positive[0][0] !== "broad-lock-finding"
    )
  );
  if (!primary && !materialAmbiguity && positive.length) primary = bySlug.get(positive[0][0]) || null;

  const candidates = (materialAmbiguity ? positive : positive.filter(([slug]) => slug !== primary?.slug))
    .slice(0, materialAmbiguity ? 3 : 2)
    .map(([slug, value]) => {
      const roadway = bySlug.get(slug)!;
      return {
        roadwayId: roadway.id,
        versionId: roadway.versionId,
        name: roadway.name,
        reason: value.directMatched.length
          ? `Matched direct task signals: ${value.directMatched.join(", ")}.`
          : `Matched governed relationship signals: ${value.relationshipMatched.join(", ")}.`,
      };
    });

  const text = task.toLowerCase();
  const current = matches(text, CURRENT_TERMS).length > 0;
  const historical = matches(text, OUTCOME_TERMS).length > 0;
  const scope = matches(text, BROAD_TERMS).length > 0 ? "broad" : "narrow";
  const selectedSignals = primary ? scores[primary.slug].matched : [];
  const requiredLiveState = primary && (current || primary.slug === "outcome-postmortem")
    ? primary.requiredLiveState
    : [];
  const domain = optionalString(input.domain)
    || (/\b(baseball|mlb|brewers|rockies|run[- ]line|pitcher)\b/i.test(task) ? "sports/baseball" : "project");
  const taskOrMarketType = primary?.slug === "margin-run-line-value"
    ? "margin_or_run_line"
    : primary?.slug === "outcome-postmortem"
      ? "outcome_postmortem"
      : primary?.slug === "broad-lock-finding"
        ? "broad_candidate_comparison"
        : "no_applicable_roadway";
  const requiredReasoningMechanism = primary?.slug === "margin-run-line-value"
    ? "separate outright strength, cover mechanics, distribution, and price"
    : primary?.slug === "outcome-postmortem"
      ? "reconstruct the reasoning path against observed reality"
      : primary?.slug === "broad-lock-finding"
        ? "compare candidate mechanisms under a common evidence standard"
        : materialAmbiguity ? "requires user clarification" : "task-specific governed continuity";
  const relevantSharedMeanings = [
    ...(text.includes("cover") ? ["coverage means meeting the margin, not merely winning"] : []),
    ...(text.includes("lock") ? ["lock means a requested high-confidence comparison, not guaranteed truth"] : []),
    ...(historical ? ["outcome evidence and durable interpretation remain distinct"] : []),
  ];
  const selectionReason = override
    ? "The user selected this roadway for the current run; the permanent registry was not changed."
    : primary
      ? `Selected from explicit intent and mechanism signals: ${selectedSignals.join(", ")}.`
      : materialAmbiguity
        ? "Materially different positively applicable roadway interpretations remain; compilation requires clarification or an explicit current-run override."
        : "No Roadway had positive task, scope, domain, semantic, or governed-relationship applicability evidence; unrelated Roadways were pruned.";
  const excludedRoadways = ranked
    .filter(([slug, value]) => value.score === 0 && slug !== primary?.slug)
    .map(([slug, value]) => {
      const roadway = bySlug.get(slug)!;
      return {
        roadwayId: roadway.id,
        versionId: roadway.versionId,
        name: roadway.name,
        reason: value.excludedReason || "No positive applicability evidence was established.",
      };
    });

  return {
    literalRequest: task,
    requestedDecisionOrOutput: optionalString(input.requestedDecisionOrOutput) || requestedOutput(task),
    activeProjectId: projectId,
    caseId,
    caseObjective,
    caseContextUsedForMatching,
    domain,
    taskOrMarketType,
    timeSensitivity: current ? "current" : historical ? "historical" : "not_time_sensitive",
    scope,
    requiredReasoningMechanism,
    relevantSharedMeanings,
    materialAmbiguity,
    clarificationRequired: materialAmbiguity,
    ambiguityReason: materialAmbiguity
      ? "Two or more positively applicable roadway interpretations could materially change the packet."
      : null,
    primaryRoadway: primary,
    candidateInterpretations: candidates,
    supportingModules: primary?.supportingMechanismModules || [],
    requiredLiveState,
    selectionReason,
    userSelectedOverride: override,
    applicability: {
      applicableRoadwayIds: [...new Set([
        ...positive.map(([slug]) => bySlug.get(slug)!.id),
        ...(override && primary ? [primary.id] : []),
      ])],
      excludedRoadways,
      governedRelationshipEvidenceUsed: Boolean(primary && scores[primary.slug].relationshipMatched.length),
    },
  };
}
