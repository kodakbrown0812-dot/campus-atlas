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

export type TaskInterpretation = {
  literalRequest: string;
  requestedDecisionOrOutput: string;
  activeProjectId: string;
  caseId: string | null;
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

export async function interpretTask(
  db: D1Database,
  projectId: string,
  input: InterpretationInput,
): Promise<TaskInterpretation> {
  const task = requiredString(input.task, "Task");
  const caseId = optionalString(input.caseId);
  if (caseId) {
    assertId(caseId, "case ID");
    const record = await first<Row>(db.prepare(
      "SELECT id FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(caseId, projectId));
    if (!record) throw new Error("Case not found.");
  }
  const registry = await ensureRoadwayRegistry(db, projectId);
  const bySlug = new Map(registry.map((roadway) => [roadway.slug, roadway]));
  const scores = interpretationScores(task);
  const explicitOverride = optionalString(input.roadwayOverride);
  let primary: RoadwayRecord | null = null;
  let override = false;
  if (explicitOverride) {
    primary = registry.find((roadway) => roadway.id === explicitOverride || roadway.slug === explicitOverride) || null;
    if (!primary) throw new Error("Roadway override is invalid for this project.");
    override = true;
  }

  const ranked = (Object.entries(scores) as Array<[RoadwaySlug, { score: number; matched: string[] }]>)
    .sort((left, right) => right[1].score - left[1].score);
  const positive = ranked.filter(([, value]) => value.score > 0);
  const competing = positive.filter(([, value]) => value.score === positive[0]?.[1].score);
  const materialAmbiguity = !override && (
    competing.length > 1
    || positive.length === 0
    || (
      positive.length > 1
      && positive[0][1].score - positive[1][1].score <= 3
      && positive[0][0] !== "broad-lock-finding"
    )
  );
  if (!primary && !materialAmbiguity) primary = bySlug.get(ranked[0][0]) || null;

  const candidates = (materialAmbiguity ? (positive.length ? positive : ranked) : ranked.slice(1))
    .slice(0, materialAmbiguity ? 3 : 2)
    .map(([slug, value]) => {
      const roadway = bySlug.get(slug)!;
      return {
        roadwayId: roadway.id,
        versionId: roadway.versionId,
        name: roadway.name,
        reason: value.matched.length
          ? `Matched task signals: ${value.matched.join(", ")}.`
          : "The request does not contain enough mechanism-specific signals to select this roadway safely.",
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
        : "ambiguous";
  const requiredReasoningMechanism = primary?.slug === "margin-run-line-value"
    ? "separate outright strength, cover mechanics, distribution, and price"
    : primary?.slug === "outcome-postmortem"
      ? "reconstruct the reasoning path against observed reality"
      : primary?.slug === "broad-lock-finding"
        ? "compare candidate mechanisms under a common evidence standard"
        : "requires user clarification";
  const relevantSharedMeanings = [
    ...(text.includes("cover") ? ["coverage means meeting the margin, not merely winning"] : []),
    ...(text.includes("lock") ? ["lock means a requested high-confidence comparison, not guaranteed truth"] : []),
    ...(historical ? ["outcome evidence and durable interpretation remain distinct"] : []),
  ];
  const selectionReason = override
    ? "The user selected this roadway for the current run; the permanent registry was not changed."
    : primary
      ? `Selected from explicit intent and mechanism signals: ${selectedSignals.join(", ")}.`
      : "Materially different roadway interpretations remain; compilation requires clarification or an explicit current-run override.";

  return {
    literalRequest: task,
    requestedDecisionOrOutput: optionalString(input.requestedDecisionOrOutput) || requestedOutput(task),
    activeProjectId: projectId,
    caseId,
    domain,
    taskOrMarketType,
    timeSensitivity: current ? "current" : historical ? "historical" : "not_time_sensitive",
    scope,
    requiredReasoningMechanism,
    relevantSharedMeanings,
    materialAmbiguity,
    clarificationRequired: materialAmbiguity,
    ambiguityReason: materialAmbiguity
      ? "Two or more roadway interpretations could materially change the packet, or the request lacks a mechanism-specific signal."
      : null,
    primaryRoadway: primary,
    candidateInterpretations: candidates,
    supportingModules: primary?.supportingMechanismModules || [],
    requiredLiveState,
    selectionReason,
    userSelectedOverride: override,
  };
}
