import { checkContinuity } from "./continuity-check-service";
import {
  canonicalContinuityInput,
  ContinuityRequestInput,
  ValidatedContinuityRequest,
  validateContinuityRequest,
} from "./continuity-request-contract";
import { compilePacket, getPacket } from "./packet-service";
import {
  first,
  Row,
} from "./slice3-support";

type PacketDetail = Awaited<ReturnType<typeof getPacket>>;

const HONESTY_STATEMENT = "Atlas records what governed context it supplied; it does not establish outcome correctness.";

function stoppedStatus(preflight: Awaited<ReturnType<typeof checkContinuity>>) {
  if (preflight.need.level === "none") return "atlas_not_needed";
  if (preflight.need.level === "light") return "light_continuity_only";
  return preflight.status;
}

function stoppedResult(
  preflight: Awaited<ReturnType<typeof checkContinuity>>,
  status = stoppedStatus(preflight),
) {
  return {
    apiVersion: "v1.7.1",
    status,
    projectId: preflight.projectId,
    caseId: preflight.caseId,
    literalTask: preflight.literalTask,
    need: preflight.need,
    roadway: preflight.roadway,
    preflight: {
      status: preflight.status,
      freshness: preflight.freshness,
      budget: preflight.budget,
      continuity: preflight.continuity,
      next: preflight.next,
    },
    packet: null,
    summary: null,
    receipt: null,
    effects: {
      packetCreated: false,
      receiptCreated: false,
      handoffCreated: false,
      providerCallPerformed: false,
      authorityChanged: false,
    },
    idempotentReplay: false,
    replaySource: null,
    currentPreflightPerformed: true,
    links: null,
  };
}

function roadwayMatchesOverride(
  override: unknown,
  storedInterpretation: Record<string, unknown>,
  primaryRoadwayId: string,
) {
  const selected = storedInterpretation.primaryRoadway;
  const roadway = selected && typeof selected === "object"
    ? selected as Record<string, unknown>
    : {};
  const storedUsedOverride = storedInterpretation.userSelectedOverride === true;
  if (typeof override !== "string" || !override.trim()) return !storedUsedOverride;
  const normalized = override.trim();
  return storedUsedOverride && [primaryRoadwayId, roadway.id, roadway.slug].includes(normalized);
}

function assertReplayRequest(
  request: ValidatedContinuityRequest,
  detail: PacketDetail,
) {
  const stored = detail.packet.interpretation as Record<string, unknown>;
  const requestSnapshot = stored.reconstructionRunRequest && typeof stored.reconstructionRunRequest === "object"
    ? stored.reconstructionRunRequest as Record<string, unknown>
    : {};
  const storedRequestedOutput = Object.prototype.hasOwnProperty.call(requestSnapshot, "requestedOutput")
    ? requestSnapshot.requestedOutput ?? null
    : stored.requestedDecisionOrOutput ?? null;
  const conflict = (
    detail.packet.task !== request.literalTask
    || Number(detail.packet.tokenBudget) !== request.tokenBudget
    || (detail.packet.caseId ?? null) !== request.caseId
    || storedRequestedOutput !== request.requestedOutput
    || !roadwayMatchesOverride(request.roadwayOverride, stored, String(detail.packet.primaryRoadwayId))
  );
  if (conflict) throw new Error("Idempotency key conflicts with a different reconstruction request.");
}

function compactProjection(
  detail: PacketDetail,
  preflight: Awaited<ReturnType<typeof checkContinuity>> | null,
  idempotentReplay: boolean,
) {
  const use = detail.receipt.treatmentSummary.Use;
  const consider = detail.receipt.treatmentSummary.Consider;
  const exclude = detail.receipt.treatmentSummary.Exclude;
  const allItems = [...use, ...consider, ...exclude];
  const packetEligible = (item: (typeof allItems)[number]) => (
    item.packetEligibleProtected === true && item.treatment !== "Exclude"
  );
  const historicalLimitations = allItems
    .filter((item) => typeof item.metadata?.historicalSourceLimitation === "string")
    .map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      representation: item.representation,
      limitation: item.metadata?.historicalSourceLimitation,
    }));
  const strongestChallenge = allItems.find((item) => (
    item.protectedRole === "challenge" && packetEligible(item)
  ));
  const packetPath = `/api/v1/projects/${encodeURIComponent(String(detail.packet.projectId))}/packets/${encodeURIComponent(String(detail.packet.id))}`;

  return {
    apiVersion: "v1.7.1",
    status: "compiled",
    projectId: detail.packet.projectId,
    caseId: detail.packet.caseId,
    literalTask: detail.packet.task,
    need: preflight?.need ?? {
      level: "full",
      reasonCodes: ["idempotent_saved_reconstruction"],
      explanation: "The previously compiled immutable reconstruction is being returned without current-state reevaluation.",
    },
    roadway: {
      id: detail.packet.primaryRoadwayId,
      versionId: detail.packet.primaryRoadwayVersionId,
      name: (detail.packet.interpretation as Record<string, Row>).primaryRoadway?.name ?? null,
    },
    packet: {
      id: detail.packet.id,
      version: detail.packet.version,
      status: detail.packet.status,
      tokenBudget: detail.packet.tokenBudget,
      finalTokenCount: detail.packet.finalTokenCount,
      compiledContent: detail.packet.compiledContent,
      priorComparablePacketId: detail.packet.priorComparablePacketId,
      createdAt: detail.packet.createdAt,
    },
    summary: {
      governingMechanismsSupplied: use.filter((item) => item.sourceType === "Mechanism").length,
      requiredChecksSupplied: use.filter((item) => item.sourceType === "RoadwayCheck").length,
      considerItemsSupplied: consider.length,
      auditOnlyProvenanceRetained: exclude.filter((item) => item.metadata?.lineageOnly === true).length,
      protectedCorrectionsSupplied: allItems.filter((item) => item.protectedRole === "correction" && packetEligible(item)).length,
      protectedConflictsSupplied: allItems.filter((item) => item.protectedRole === "conflict" && packetEligible(item)).length,
      strongestChallenge: strongestChallenge
        ? { sourceType: strongestChallenge.sourceType, sourceId: strongestChallenge.sourceId, state: "preserved" }
        : null,
    },
    receipt: {
      id: detail.receipt.id,
      governanceCauses: detail.receipt.governanceCauses,
      treatmentSummary: detail.receipt.treatmentSummary,
      treatmentCounts: {
        Use: use.length,
        Consider: consider.length,
        Exclude: exclude.length,
      },
      freshness: detail.receipt.freshness,
      inferenceDisclosure: detail.receipt.inferenceDisclosure,
      unresolvedConflicts: detail.receipt.unresolvedConflicts,
      exactPacketDifference: detail.receipt.exactPacketDifference,
      historicalLimitations,
      honestyStatement: HONESTY_STATEMENT,
    },
    effects: {
      packetCreated: !idempotentReplay,
      receiptCreated: !idempotentReplay,
      handoffCreated: false,
      providerCallPerformed: false,
      authorityChanged: false,
    },
    idempotentReplay,
    replaySource: idempotentReplay ? "saved_immutable_packet" : null,
    currentPreflightPerformed: !idempotentReplay,
    links: {
      packet: packetPath,
      receipt: `${packetPath}/receipt`,
      inspect: `/projects/${encodeURIComponent(String(detail.packet.projectId))}/inspect/packets/${encodeURIComponent(String(detail.packet.id))}`,
    },
  };
}

export async function runReconstruction(
  db: D1Database,
  projectId: string,
  input: ContinuityRequestInput,
  idempotencyKey: string,
) {
  const request = validateContinuityRequest(input);
  const replay = await first<Row>(db.prepare(
    "SELECT id FROM packets WHERE project_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(projectId, idempotencyKey));
  if (replay) {
    const detail = await getPacket(db, projectId, String(replay.id));
    assertReplayRequest(request, detail);
    return compactProjection(detail, null, true);
  }

  const preflight = await checkContinuity(db, projectId, input);

  if (preflight.need.level !== "full" || preflight.status !== "ready") {
    return stoppedResult(preflight);
  }

  const compileInput = canonicalContinuityInput(request);
  const compiled = await compilePacket(db, projectId, compileInput, idempotencyKey, {
    stopBeforeFailedWrite: true,
    literalTask: preflight.literalTask,
    reconstructionRequest: {
      requestedOutput: request.requestedOutput,
      roadwayOverride: request.roadwayOverride,
    },
  });
  if (!compiled.packet || !compiled.receipt) {
    return stoppedResult(preflight, String(compiled.status));
  }
  return compactProjection(compiled, preflight, compiled.idempotentReplay);
}
