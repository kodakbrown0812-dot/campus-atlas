import { canonicalId } from "./canonical-records";
import { discoverAndRankCandidates, RankedCandidate, Treatment } from "./candidate-ranking";
import {
  isLineageOnlyPacketAncestor,
  isPacketEligibleProtectedItem,
} from "./packet-eligibility";
import { interpretTask, TaskInterpretation } from "./roadway-service";
import { sha256 } from "./transcript-import";
import {
  all,
  assertId,
  first,
  json,
  now,
  optionalString,
  parseJson,
  requiredString,
  Row,
} from "./slice3-support";

export const PACKET_VERSION = 1;
export const SUPPORTED_TOKEN_BUDGETS = new Set([400, 800, 1600]);

type PacketItemSnapshot = {
  sourceType: string;
  sourceId: string;
  sourceVersionId: string | null;
  statement: string;
  treatment: Treatment;
  representation: string;
  scope: string;
  authority: string;
  freshness: string;
  status?: string;
  caseId?: string | null;
  reason: string;
  sequenceOrder: number;
  protectedRole: RankedCandidate["protectedRole"] | "required_check";
  governanceEventId: string | null;
  counterevidenceIds: string[];
  discovery?: RankedCandidate["discovery"];
  ranking?: RankedCandidate["ranking"];
  metadata?: Record<string, unknown>;
};

function tokenCount(value: string) {
  // V4.6 used a deterministic character approximation. Slice 4 retains that
  // approach so all three budgets are enforced consistently without pretending
  // a receiving-model tokenizer is available in the Worker.
  return Math.ceil(value.length / 4);
}

function compact(value: string, maximum = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function roadwayChecks(interpretation: TaskInterpretation): PacketItemSnapshot[] {
  const roadway = interpretation.primaryRoadway!;
  return roadway.requiredChecks.map((statement, index) => ({
    sourceType: "RoadwayCheck",
    sourceId: `${roadway.versionId}:check:${index + 1}`,
    sourceVersionId: roadway.versionId,
    statement,
    treatment: "Use",
    representation: "Exact",
    scope: "project_wide",
    authority: roadway.authorityState,
    freshness: "not_applicable",
    reason: "Required by the frozen Blueprint roadway contract.",
    sequenceOrder: index + 1,
    protectedRole: "required_check",
    governanceEventId: null,
    counterevidenceIds: [],
  }));
}

function candidateItem(candidate: RankedCandidate, sequenceOrder: number): PacketItemSnapshot {
  return {
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceVersionId: candidate.sourceVersionId,
    statement: candidate.statement,
    treatment: candidate.treatment,
    representation: candidate.representation,
    scope: candidate.scope,
    authority: candidate.authority,
    freshness: candidate.freshness,
    status: candidate.status,
    caseId: candidate.caseId,
    reason: candidate.reason,
    sequenceOrder,
    protectedRole: candidate.protectedRole,
    governanceEventId: candidate.governanceEventId,
    counterevidenceIds: candidate.counterevidenceIds,
    discovery: candidate.discovery,
    ranking: candidate.ranking,
    metadata: candidate.metadata,
  };
}

function hasFreshCategory(candidates: RankedCandidate[], category: string) {
  if (category === "final_outcome") {
    return candidates.some((candidate) => (
      (candidate.metadata.category === category && candidate.freshness === "fresh")
      || (
        candidate.sourceType === "Event"
        && candidate.metadata
        && candidate.protectedRole !== "challenge"
        && candidate.statement.length > 0
        && candidate.freshness !== "superseded"
        && candidate.metadata.historicalSourceLimitation !== "unavailable_cannot_truthfully_reconstruct"
        && candidate.ranking.realityContact === 4
      )
    ));
  }
  return candidates.some((candidate) => (
    candidate.sourceType === "LiveStateSnapshot"
    && candidate.metadata.category === category
    && candidate.freshness === "fresh"
    && candidate.treatment === "Use"
  ));
}

function renderHeader(
  interpretation: TaskInterpretation,
  budget: number,
  projectId: string,
) {
  return [
    `# Atlas reconstruction packet v${PACKET_VERSION}`,
    `Task: ${compact(interpretation.literalRequest, 260)}`,
    `Intent: ${interpretation.requestedDecisionOrOutput}; ${interpretation.requiredReasoningMechanism}.`,
    `Primary roadway: ${interpretation.primaryRoadway!.name} v${interpretation.primaryRoadway!.version}`,
    `Scope: project ${projectId}${interpretation.caseId ? `; case ${interpretation.caseId}` : ""}; ${interpretation.scope}.`,
    ...(interpretation.relevantSharedMeanings.length
      ? [`Shared meanings: ${interpretation.relevantSharedMeanings.join("; ")}.`]
      : []),
    `Budget: ${budget} tokens (deterministic character approximation).`,
  ].join("\n");
}

function renderItem(item: PacketItemSnapshot) {
  const label = item.treatment === "Use" ? "USE" : item.treatment === "Consider" ? "CONSIDER" : "EXCLUDE";
  if (item.protectedRole === "required_check") {
    return `- [USE][CHECK ${item.sequenceOrder}] ${compact(item.statement, 110)}`;
  }
  if (item.sourceType === "LiveStateSnapshot") {
    return `- [${label}][CURRENT] ${compact(item.statement, 90)} [${item.sourceId}; ${item.freshness}]`;
  }
  const statement = item.protectedRole === "correction"
    ? item.statement
    : compact(item.statement, item.treatment === "Exclude" ? 80 : 140);
  const reason = item.treatment === "Exclude" ? ` — ${compact(item.reason, 70)}` : "";
  const historicalLimitation = item.representation === "Reconstructed"
    ? " — historical raw transcript unavailable; not Exact"
    : "";
  return `- [${label}] ${statement} [${item.sourceType}:${item.sourceId}; ${item.representation}; ${item.authority}]${reason}${historicalLimitation}`;
}

function section(title: string, items: PacketItemSnapshot[]) {
  if (!items.length) return "";
  return `\n\n## ${title}\n${items.map(renderItem).join("\n")}`;
}

function minimumSafeItems(items: PacketItemSnapshot[]) {
  const uses = items
    .filter((item) => (
      item.treatment === "Use"
      && item.sourceType !== "LiveStateSnapshot"
      && item.protectedRole !== "conflict"
    ))
    .slice(0, 1);
  const protectedItems = items.filter(isPacketEligibleProtectedItem);
  const strongestChallenge = items.find((item) => (
    item.protectedRole === "challenge" && isPacketEligibleProtectedItem(item)
  ));
  const map = new Map<string, PacketItemSnapshot>();
  for (const item of [...uses, ...protectedItems, ...(strongestChallenge ? [strongestChallenge] : [])]) {
    map.set(`${item.sourceType}:${item.sourceId}`, item);
  }
  return [...map.values()];
}

function renderPacket(
  interpretation: TaskInterpretation,
  projectId: string,
  budget: number,
  checks: PacketItemSnapshot[],
  candidates: PacketItemSnapshot[],
  missingLiveState: string[],
) {
  const header = renderHeader(interpretation, budget, projectId);
  const useItems = candidates.filter((item) => item.treatment === "Use");
  const considerItems = candidates.filter((item) => item.treatment === "Consider");
  const excludedItems = candidates.filter((item) => item.treatment === "Exclude");
  const protectedCandidates = minimumSafeItems(candidates);
  const mandatory = [
    section("Required Blueprint checks", checks),
    section("Required current state", useItems.filter((item) => item.sourceType === "LiveStateSnapshot")),
    section("Protected mechanisms, corrections, challenges, and conflicts", protectedCandidates),
    missingLiveState.length ? `\n\n## Missing required state\n${missingLiveState.map((value) => `- ${value}`).join("\n")}` : "",
  ].join("");
  const minimumContent = `${header}${mandatory}`;
  const minimumTokens = tokenCount(minimumContent);
  if (missingLiveState.length) {
    const failure = [
      header,
      "",
      "Compilation stopped: safe reasoning requires unavailable or stale current state.",
      `Missing: ${missingLiveState.join(", ")}.`,
    ].join("\n");
    return {
      content: failure,
      finalTokenCount: tokenCount(failure),
      minimumTokenCount: minimumTokens,
      error: `required_live_state_missing:${missingLiveState.join(",")}`,
      candidates,
    };
  }
  if (minimumTokens > budget) {
    const failure = [
      header,
      "",
      `Compilation stopped: minimum safe packet requires approximately ${minimumTokens} tokens and cannot fit ${budget}.`,
    ].join("\n");
    return {
      content: failure,
      finalTokenCount: tokenCount(failure),
      minimumTokenCount: minimumTokens,
      error: `minimum_safe_packet_exceeds_budget:${minimumTokens}>${budget}`,
      candidates,
    };
  }

  let content = minimumContent;
  const alreadyIncluded = new Set(protectedCandidates.map((item) => `${item.sourceType}:${item.sourceId}`));
  const optional = [
    ...useItems,
    ...considerItems,
    ...excludedItems.filter((item) => (
      !isLineageOnlyPacketAncestor(item)
      && /rejected|superseded|stale|scope|mechanism/i.test(item.reason)
    )),
  ].filter((item) => !alreadyIncluded.has(`${item.sourceType}:${item.sourceId}`));
  const includedOptional: PacketItemSnapshot[] = [];
  for (const item of optional) {
    const title = item.treatment === "Use" ? "Additional governing context"
      : item.treatment === "Consider" ? "Consider"
        : "Consequential exclusions";
    const candidateSection = section(title, [item]);
    if (tokenCount(`${content}${candidateSection}`) <= budget) {
      content += candidateSection;
      includedOptional.push(item);
      continue;
    }
    if (item.treatment !== "Exclude") {
      item.treatment = "Exclude";
      item.reason = `Excluded by the ${budget}-token budget after required checks, corrections, conflicts, and strongest challenge were preserved.`;
    }
  }
  return {
    content,
    finalTokenCount: tokenCount(content),
    minimumTokenCount: minimumTokens,
    error: null,
    candidates,
    includedOptional,
  };
}

function treatmentSummary(items: PacketItemSnapshot[]) {
  const snapshot = (item: PacketItemSnapshot) => ({
    ...item,
    packetEligibleProtected: isPacketEligibleProtectedItem(item),
  });
  return {
    Use: items.filter((item) => item.treatment === "Use").map(snapshot),
    Consider: items.filter((item) => item.treatment === "Consider").map(snapshot),
    Exclude: items.filter((item) => item.treatment === "Exclude").map(snapshot),
  };
}

function storedTreatmentSummary(value: unknown) {
  const parsed = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const treatment = (name: Treatment) => (
    Array.isArray(parsed[name])
      ? parsed[name]
        .filter((item): item is PacketItemSnapshot => Boolean(item && typeof item === "object"))
        .map((item) => ({
          ...item,
          packetEligibleProtected: isPacketEligibleProtectedItem(item),
        }))
      : []
  );
  return {
    Use: treatment("Use"),
    Consider: treatment("Consider"),
    Exclude: treatment("Exclude"),
  };
}

async function comparisonKey(projectId: string, interpretation: TaskInterpretation) {
  return sha256(json({
    projectId,
    caseId: interpretation.caseId,
    domain: interpretation.domain,
    taskOrMarketType: interpretation.taskOrMarketType,
    scope: interpretation.scope,
    primaryRoadwayVersionId: interpretation.primaryRoadway!.versionId,
  }));
}

async function priorPacket(db: D1Database, projectId: string, key: string) {
  return first<Row>(db.prepare(
    `SELECT id FROM packets
     WHERE project_id = ? AND comparison_key = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).bind(projectId, key));
}

async function priorItems(db: D1Database, projectId: string, packetId: string | null) {
  if (!packetId) return [];
  return all<Row>(db.prepare(
    "SELECT * FROM packet_items WHERE project_id = ? AND packet_id = ? ORDER BY sequence_order ASC",
  ).bind(projectId, packetId));
}

function packetDifference(prior: Row[], current: PacketItemSnapshot[]) {
  const before = new Map(prior.map((item) => [`${item.source_type}:${item.source_id}`, item]));
  const after = new Map(current.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
  const changes: Array<Record<string, unknown>> = [];
  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) {
      changes.push({ type: "added", sourceType: item.sourceType, sourceId: item.sourceId, treatment: item.treatment });
      continue;
    }
    const fields = [
      ["treatment", old.treatment, item.treatment],
      ["representation", old.representation_type, item.representation],
      ["authority", old.authority_state, item.authority],
      ["scope", old.scope, item.scope],
      ["freshness", old.freshness, item.freshness],
    ].filter(([, left, right]) => left !== right);
    if (fields.length) {
      changes.push({
        type: "changed",
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        fields: fields.map(([field, from, to]) => ({ field, from, to })),
      });
    }
  }
  for (const [key, item] of before) {
    if (!after.has(key)) changes.push({ type: "removed", sourceType: item.source_type, sourceId: item.source_id });
  }
  return changes;
}

async function packetDetail(db: D1Database, projectId: string, packetId: string) {
  const packet = await first<Row>(db.prepare(
    "SELECT * FROM packets WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(packetId, projectId));
  if (!packet) throw new Error("Packet not found.");
  const [items, receipt] = await Promise.all([
    all<Row>(db.prepare(
      "SELECT * FROM packet_items WHERE project_id = ? AND packet_id = ? ORDER BY sequence_order ASC",
    ).bind(projectId, packetId)),
    first<Row>(db.prepare(
      "SELECT * FROM receipts WHERE project_id = ? AND packet_id = ? LIMIT 1",
    ).bind(projectId, packetId)),
  ]);
  if (!receipt) throw new Error("Packet receipt not found.");
  const receiptTreatmentSummary = storedTreatmentSummary(
    parseJson(receipt.candidate_treatment_summary, {}),
  );
  const receiptItems = new Map(
    Object.values(receiptTreatmentSummary).flat().map((item) => (
      [`${item.sourceType}:${item.sourceId}`, item]
    )),
  );
  return {
    packet: {
      id: packet.id,
      version: PACKET_VERSION,
      projectId: packet.project_id,
      caseId: packet.case_id,
      task: packet.task,
      inferredIntent: packet.inferred_intent,
      interpretation: parseJson(packet.interpretation, {}),
      primaryRoadwayId: packet.primary_roadway_id,
      primaryRoadwayVersionId: packet.primary_roadway_version_id,
      supportingModules: parseJson(packet.supporting_modules, []),
      tokenBudget: packet.token_budget,
      finalTokenCount: packet.final_token_count,
      compiledContent: packet.compiled_content,
      priorComparablePacketId: packet.prior_comparable_packet_id,
      status: packet.status,
      compilationError: packet.compilation_error,
      createdAt: packet.created_at,
    },
    items: items.map((item) => {
      const receiptItem = receiptItems.get(`${item.source_type}:${item.source_id}`);
      return {
        id: item.id,
        sourceType: item.source_type,
        sourceId: item.source_id,
        sourceVersionId: item.source_version_id,
        treatment: item.treatment,
        representation: item.representation_type,
        scope: item.scope,
        authority: item.authority_state,
        freshness: item.freshness,
        reason: item.inclusion_reason || item.exclusion_reason,
        sequenceOrder: item.sequence_order,
        protectedRole: receiptItem?.protectedRole ?? null,
        packetEligibleProtected: receiptItem?.packetEligibleProtected ?? false,
        metadata: receiptItem?.metadata ?? {},
      };
    }),
    receipt: {
      id: receipt.id,
      packetId: receipt.packet_id,
      literalRequest: packet.task,
      inferredIntent: packet.inferred_intent,
      selectedRoadwayReason: receipt.selected_roadway_reason,
      alternatives: parseJson(receipt.alternative_roadways_considered, []),
      supportingModules: parseJson(packet.supporting_modules, []),
      treatmentSummary: receiptTreatmentSummary,
      governanceCauses: parseJson(receipt.governance_causes, []),
      freshness: parseJson(receipt.freshness_summary, {}),
      inferenceDisclosure: receipt.inference_disclosure,
      unresolvedConflicts: parseJson(receipt.unresolved_conflicts, []),
      exactPacketDifference: parseJson(receipt.diff_summary, []),
      tokenBudget: packet.token_budget,
      finalTokenCount: packet.final_token_count,
      authorityAndScope: {
        projectId: packet.project_id,
        caseId: packet.case_id,
        serverEnforced: true,
      },
      priorComparablePacketId: packet.prior_comparable_packet_id,
      createdAt: receipt.created_at,
    },
  };
}

export async function compilePacket(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  const replay = await first<Row>(db.prepare(
    "SELECT id, task, token_budget FROM packets WHERE project_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(projectId, idempotencyKey));
  if (replay) {
    const requestedBudget = Number(body.tokenBudget ?? 800);
    if (replay.task !== body.task || Number(replay.token_budget) !== requestedBudget) {
      throw new Error("Idempotency key conflicts with a different packet request.");
    }
    return { ...(await packetDetail(db, projectId, String(replay.id))), idempotentReplay: true };
  }
  const budget = Number(body.tokenBudget ?? 800);
  if (!SUPPORTED_TOKEN_BUDGETS.has(budget)) {
    throw new Error("Token budget must be exactly 400, 800, or 1600.");
  }
  const interpretation = await interpretTask(db, projectId, body);
  if (interpretation.clarificationRequired || !interpretation.primaryRoadway) {
    return {
      status: "clarification_required",
      interpretation,
      packet: null,
      receipt: null,
      idempotentReplay: false,
    };
  }
  const candidates = await discoverAndRankCandidates(db, projectId, interpretation);
  const missingLiveState = interpretation.requiredLiveState.filter((category) => !hasFreshCategory(candidates, category));
  const checks = roadwayChecks(interpretation);
  const candidateSnapshots = candidates.map((candidate, index) => candidateItem(candidate, checks.length + index + 1));
  const key = await comparisonKey(projectId, interpretation);
  const prior = await priorPacket(db, projectId, key);
  const priorPacketId = prior ? String(prior.id) : null;
  const rendered = renderPacket(
    interpretation,
    projectId,
    budget,
    checks,
    candidateSnapshots,
    missingLiveState,
  );
  const allItems = [...checks, ...rendered.candidates].map((item, index) => ({ ...item, sequenceOrder: index + 1 }));
  const beforeItems = await priorItems(db, projectId, priorPacketId);
  const difference = packetDifference(beforeItems, allItems);
  const governanceCauses = allItems
    .filter((item) => item.governanceEventId && (
      !priorPacketId
      || difference.some((change) => change.sourceId === item.sourceId)
    ))
    .map((item) => ({
      governanceEventId: item.governanceEventId,
      sourceId: item.sourceId,
      effect: `Cody's governance event made ${item.sourceVersionId} eligible for ${item.treatment} in this packet.`,
      correctnessClaim: false,
    }));
  const conflicts = allItems
    .filter((item) => item.protectedRole === "conflict")
    .map((item) => ({ sourceId: item.sourceId, statement: item.statement, resolution: "unresolved" }));
  const summary = treatmentSummary(allItems);
  const packetId = canonicalId("packet");
  const receiptId = canonicalId("receipt");
  const createdAt = now();
  const status = rendered.error ? "failed" : "compiled";
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO packets (
        id, project_id, case_id, task, inferred_intent, interpretation,
        primary_roadway_id, primary_roadway_version_id, supporting_modules,
        token_budget, final_token_count, compiled_content,
        prior_comparable_packet_id, comparison_key, status, compilation_error,
        idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      packetId,
      projectId,
      interpretation.caseId,
      interpretation.literalRequest,
      interpretation.requiredReasoningMechanism,
      json(interpretation),
      interpretation.primaryRoadway.id,
      interpretation.primaryRoadway.versionId,
      json(interpretation.supportingModules),
      budget,
      rendered.finalTokenCount,
      rendered.content,
      priorPacketId,
      key,
      status,
      rendered.error,
      idempotencyKey,
      createdAt,
    ),
  ];
  for (const item of allItems) {
    statements.push(db.prepare(
      `INSERT INTO packet_items (
        id, project_id, packet_id, source_type, source_id, source_version_id,
        treatment, representation_type, scope, authority_state, freshness,
        inclusion_reason, exclusion_reason, sequence_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      canonicalId("packet-item"),
      projectId,
      packetId,
      item.sourceType,
      item.sourceId,
      item.sourceVersionId,
      item.treatment,
      item.representation,
      item.scope,
      item.authority,
      item.freshness,
      item.treatment === "Exclude" ? null : item.reason,
      item.treatment === "Exclude" ? item.reason : null,
      item.sequenceOrder,
    ));
  }
  statements.push(db.prepare(
    `INSERT INTO receipts (
      id, project_id, packet_id, selected_roadway_reason,
      alternative_roadways_considered, candidate_treatment_summary,
      governance_causes, freshness_summary, inference_disclosure,
      unresolved_conflicts, diff_summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    receiptId,
    projectId,
    packetId,
    interpretation.selectionReason,
    json(interpretation.candidateInterpretations),
    json({
      ...summary,
      treatmentOrder: ["Use", "Consider", "Exclude"],
      rankingOrder: ["taskMechanismMatch", "scopeFit", "authority", "evidenceStrength"],
      tieBreakOrder: ["realityContact", "directMechanismFit", "applicableFreshness", "independentRepetition", "lowerRedundancy", "shorterEquivalentRepresentation"],
      discoverySignals: ["semanticSimilarity", "keywordBm25", "entityMatch", "temporalFit", "relationshipProximity", "projectScope"],
    }),
    json(governanceCauses),
    json({
      required: interpretation.requiredLiveState,
      missing: missingLiveState,
      safeToCompile: missingLiveState.length === 0,
    }),
    "Candidate discovery combines lexical, mechanism-family, entity, temporal, relationship, and project-scope signals. These signals discover candidates only; server-side authority, scope, evidence, freshness, and roadway rules determine treatment.",
    json(conflicts),
    json(difference),
    createdAt,
  ));
  await db.batch(statements);
  return { ...(await packetDetail(db, projectId, packetId)), idempotentReplay: false };
}

export async function previewPacketCandidates(
  db: D1Database,
  projectId: string,
  body: Row,
) {
  const budget = Number(body.tokenBudget ?? 800);
  if (!SUPPORTED_TOKEN_BUDGETS.has(budget)) {
    throw new Error("Token budget must be exactly 400, 800, or 1600.");
  }
  const interpretation = await interpretTask(db, projectId, body);
  if (interpretation.clarificationRequired || !interpretation.primaryRoadway) {
    return {
      status: "clarification_required",
      interpretation,
      treatmentSummary: { Use: [], Consider: [], Exclude: [] },
      candidateSummary: {
        discovered: 0,
        used: 0,
        considered: 0,
        excluded: 0,
        redundantRecordsRemoved: 0,
        lineageRecordsRetained: 0,
        protectedCorrectionsRetained: 0,
        strongestChallengeRetained: false,
      },
      requiredChecks: [],
      protectedCorrections: [],
      protectedConflicts: [],
      strongestChallenge: null,
      importantExclusions: [],
      freshness: {
        required: interpretation.requiredLiveState,
        missing: interpretation.requiredLiveState,
        safeToCompile: false,
      },
      tokenBudget: budget,
      estimatedSafeMinimum: null,
      estimatedFinalSize: null,
      likelyCompression: false,
      packetCreated: false,
    };
  }

  const candidates = await discoverAndRankCandidates(db, projectId, interpretation);
  const missingLiveState = interpretation.requiredLiveState.filter(
    (category) => !hasFreshCategory(candidates, category),
  );
  const checks = roadwayChecks(interpretation);
  const candidateSnapshots = candidates.map(
    (candidate, index) => candidateItem(candidate, checks.length + index + 1),
  );
  const rendered = renderPacket(
    interpretation,
    projectId,
    budget,
    checks,
    candidateSnapshots,
    missingLiveState,
  );
  const summary = treatmentSummary(rendered.candidates);
  const budgetExcluded = rendered.candidates.filter((item) => (
    item.treatment === "Exclude" && item.reason.startsWith("Excluded by the ")
  ));
  const strongestChallenge = rendered.candidates.find((item) => (
    item.protectedRole === "challenge" && isPacketEligibleProtectedItem(item)
  )) || null;
  const protectedCorrections = rendered.candidates.filter((item) => (
    item.protectedRole === "correction" && isPacketEligibleProtectedItem(item)
  ));
  const protectedConflicts = rendered.candidates.filter((item) => (
    item.protectedRole === "conflict" && isPacketEligibleProtectedItem(item)
  ));
  const state = rendered.error?.startsWith("required_live_state_missing:")
    ? "missing_required_state"
    : rendered.error?.startsWith("minimum_safe_packet_exceeds_budget:")
      ? "unsafe_under_selected_budget"
      : "ready";

  return {
    status: state,
    interpretation,
    treatmentSummary: summary,
    candidateSummary: {
      discovered: rendered.candidates.length,
      used: summary.Use.length,
      considered: summary.Consider.length,
      excluded: summary.Exclude.length,
      redundantRecordsRemoved: rendered.candidates.filter(
        (item) => /redundan/i.test(item.reason),
      ).length,
      lineageRecordsRetained: rendered.candidates.filter(
        (item) => item.metadata?.lineageOnly === true,
      ).length,
      protectedCorrectionsRetained: protectedCorrections.length,
      strongestChallengeRetained: Boolean(
        strongestChallenge && strongestChallenge.treatment !== "Exclude",
      ),
    },
    requiredChecks: checks,
    protectedCorrections,
    protectedConflicts,
    strongestChallenge,
    importantExclusions: summary.Exclude.filter((item) => (
      /rejected|retired|superseded|stale|scope|project|mechanism|budget/i.test(item.reason)
    )),
    freshness: {
      required: interpretation.requiredLiveState,
      missing: missingLiveState,
      safeToCompile: missingLiveState.length === 0,
    },
    tokenBudget: budget,
    estimatedSafeMinimum: rendered.minimumTokenCount,
    estimatedFinalSize: rendered.finalTokenCount,
    likelyCompression: budgetExcluded.length > 0,
    packetCreated: false,
  };
}

export async function getPacket(db: D1Database, projectId: string, packetId: string) {
  return packetDetail(db, projectId, packetId);
}

export async function listPackets(db: D1Database, projectId: string) {
  const rows = await all<Row>(db.prepare(
    `SELECT id, task, inferred_intent, primary_roadway_id,
            primary_roadway_version_id, token_budget, final_token_count,
            prior_comparable_packet_id, status, compilation_error, created_at
     FROM packets WHERE project_id = ?
     ORDER BY created_at DESC, rowid DESC`,
  ).bind(projectId));
  return rows.map((row) => ({
    id: row.id,
    task: row.task,
    inferredIntent: row.inferred_intent,
    primaryRoadwayId: row.primary_roadway_id,
    primaryRoadwayVersionId: row.primary_roadway_version_id,
    tokenBudget: row.token_budget,
    finalTokenCount: row.final_token_count,
    priorComparablePacketId: row.prior_comparable_packet_id,
    status: row.status,
    compilationError: row.compilation_error,
    createdAt: row.created_at,
  }));
}

export async function createLiveStateSnapshot(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  const replay = await first<Row>(db.prepare(
    "SELECT * FROM live_state_snapshots WHERE project_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(projectId, idempotencyKey));
  if (replay) return { snapshot: replay, idempotentReplay: true };
  const caseId = optionalString(body.caseId);
  if (caseId) {
    assertId(caseId, "case ID");
    const caseRecord = await first<Row>(db.prepare(
      "SELECT id FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(caseId, projectId));
    if (!caseRecord) throw new Error("Case not found.");
  }
  const observedAt = requiredString(body.observedAt, "Observed timestamp");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("Observed timestamp must be valid.");
  const freshnessWindowSeconds = Number(body.freshnessWindowSeconds);
  if (!Number.isInteger(freshnessWindowSeconds) || freshnessWindowSeconds <= 0) {
    throw new Error("Freshness window must be a positive number of seconds.");
  }
  const id = canonicalId("live-state");
  const createdAt = now();
  await db.prepare(
    `INSERT INTO live_state_snapshots (
      id, project_id, case_id, provider, source_identity, category, entity,
      raw_value, normalized_value, observed_at, valid_from, valid_until,
      superseded_at, freshness_window_seconds, status, conflict_group,
      metadata, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    caseId,
    requiredString(body.provider, "Provider"),
    requiredString(body.sourceIdentity, "Source identity"),
    requiredString(body.category, "Live-state category"),
    requiredString(body.entity, "Live-state entity"),
    requiredString(body.rawValue, "Raw live-state value"),
    json(body.normalizedValue || {}),
    observedAt,
    optionalString(body.validFrom),
    optionalString(body.validUntil),
    freshnessWindowSeconds,
    optionalString(body.conflictGroup),
    json(body.metadata || {}),
    idempotencyKey,
    createdAt,
  ).run();
  return {
    snapshot: await first<Row>(db.prepare(
      "SELECT * FROM live_state_snapshots WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(id, projectId)),
    idempotentReplay: false,
  };
}
