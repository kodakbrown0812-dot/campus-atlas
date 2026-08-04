import { canonicalId } from "./canonical-records";
import { getPacket } from "./packet-service";
import { isPacketEligibleProtectedItem } from "./packet-eligibility";
import {
  AdditionalLiveRetrieval,
  buildReceivingModelInput,
  executeReceivingModel,
  OPENAI_RECEIVING_MODEL,
  ReceivingModelFailure,
  supportedReceivingModels,
  TestReceivingModelAdapter,
} from "./receiving-model";
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

export const HANDOFF_RECEIPT_HONESTY = "Atlas records what governed context it supplied. Supplying context does not establish outcome correctness or prove that the receiving model followed every packet item.";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{7,199}$/;
const NO_LIVE_RETRIEVAL: AdditionalLiveRetrieval = {
  performed: false,
  requested: false,
  retrievedAt: null,
  tools: [],
  reliedOnNewerStateThanPacket: false,
};

type HandoffOptions = {
  openAiApiKey?: string;
  testAdapter?: TestReceivingModelAdapter;
};

function idempotencyKey(value: string) {
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new Error("Idempotency key is invalid; use 8–200 stable visible characters.");
  }
  return value;
}

function normalizeProvider(value: unknown) {
  return optionalString(value) || "openai";
}

function normalizeModel(value: unknown) {
  return optionalString(value) || OPENAI_RECEIVING_MODEL;
}

function currentStatus(events: Row[]) {
  return events.length ? String(events[events.length - 1].status) : "pending";
}

function mapLifecycle(row: Row) {
  return {
    id: row.id,
    status: row.status,
    providerResponseId: row.provider_response_id,
    failureCategory: row.failure_category,
    failureReason: row.failure_reason,
    additionalLiveRetrieval: parseJson(row.additional_live_retrieval, NO_LIVE_RETRIEVAL),
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
  };
}

function mapAnswer(row: Row | null) {
  if (!row) return null;
  return {
    id: row.id,
    handoffId: row.handoff_id,
    packetId: row.packet_id,
    providerResponseId: row.provider_response_id,
    provider: row.receiving_provider,
    model: row.receiving_model,
    answerText: row.answer_text,
    answerTimestamp: row.answer_timestamp,
    canonicalMessageReference: row.canonical_message_reference,
    metadata: parseJson(row.metadata, {}),
  };
}

function receiptSnapshot(
  row: Row | null,
  packet: Awaited<ReturnType<typeof getPacket>> | null,
  root: Row,
  events: Row[],
) {
  if (!row) return null;
  const treatmentSummary = parseJson<Record<string, Array<Record<string, unknown>>>>(
    row.treatment_summary,
    {},
  );
  const treatmentItems = Object.values(treatmentSummary).flat();
  const packetDifference = parseJson<{
    exact?: Array<Record<string, unknown>>;
    causal?: Array<Record<string, unknown>>;
  }>(row.packet_difference, {});
  return {
    id: row.id,
    handoffId: row.handoff_id,
    packetId: row.packet_id,
    packetVersion: packet?.packet.version ?? 1,
    packetReceiptId: row.packet_receipt_id,
    originalTask: packet?.packet.task ?? null,
    selectedRoadway: packet ? {
      id: packet.packet.primaryRoadwayId,
      versionId: packet.packet.primaryRoadwayVersionId,
      supportingModules: packet.packet.supportingModules,
    } : null,
    receivingProvider: root.receiving_provider,
    receivingModel: root.receiving_model,
    handoffTimestamp: root.handoff_at,
    handoffStatus: currentStatus(events),
    lineage: parseJson(row.lineage, []),
    treatmentSummary,
    strongestChallenges: treatmentItems.filter((item) => (
      item.protectedRole === "challenge" && isPacketEligibleProtectedItem(item)
    )),
    corrections: treatmentItems.filter((item) => (
      item.protectedRole === "correction" && isPacketEligibleProtectedItem(item)
    )),
    authorityAndScope: parseJson(row.authority_and_scope, {}),
    freshness: parseJson(row.freshness_summary, {}),
    inferenceDisclosure: row.inference_disclosure,
    unresolvedConflicts: parseJson(row.unresolved_conflicts, []),
    governanceCauses: parseJson(row.governance_causes, []),
    exactPacketDifference: packetDifference.exact || [],
    causalPacketDifference: packetDifference.causal || [],
    priorComparablePacketId: packet?.packet.priorComparablePacketId ?? null,
    additionalLiveRetrieval: parseJson(row.additional_live_retrieval, NO_LIVE_RETRIEVAL),
    finalAnswerReference: parseJson(row.final_answer_reference, null),
    historicalLimitations: parseJson(row.historical_limitations, []),
    honestyStatement: row.honesty_statement,
    createdAt: row.created_at,
  };
}

async function packetSource(db: D1Database, projectId: string, packetId: string) {
  const packet = await first<Row>(db.prepare(
    `SELECT p.*, r.id AS packet_receipt_id,
            r.candidate_treatment_summary, r.governance_causes,
            r.freshness_summary, r.inference_disclosure,
            r.unresolved_conflicts, r.diff_summary
     FROM packets p
     JOIN receipts r ON r.packet_id = p.id AND r.project_id = p.project_id
     WHERE p.id = ? AND p.project_id = ?
     LIMIT 1`,
  ).bind(packetId, projectId));
  if (!packet) throw new Error("Compiled packet not found.");
  if (packet.status !== "compiled" || packet.compilation_error) {
    throw new Error("Failed or incomplete packets cannot be handed off.");
  }
  const interpretation = parseJson<Record<string, unknown>>(packet.interpretation, {});
  if (
    interpretation.clarificationRequired === true
    || interpretation.materialAmbiguity === true
    || !packet.primary_roadway_id
    || !packet.primary_roadway_version_id
  ) {
    throw new Error("Ambiguous reconstruction requests cannot be handed off.");
  }
  const freshness = parseJson<{ safeToCompile?: boolean; missing?: string[] }>(
    packet.freshness_summary,
    {},
  );
  if (freshness.safeToCompile !== true || (freshness.missing?.length ?? 0) > 0) {
    throw new Error("Required live-state gates did not pass at packet compilation.");
  }
  return packet;
}

function causalDifference(packet: Row) {
  const exact = parseJson<Array<Record<string, unknown>>>(packet.diff_summary, []);
  const causes = parseJson<Array<Record<string, unknown>>>(packet.governance_causes, []);
  return {
    exact,
    causal: exact.map((change) => {
      const cause = causes.find((item) => item.sourceId === change.sourceId);
      return {
        ...change,
        cause: cause || {
          type: "roadway_scope_evidence_or_freshness",
          canonicalCauseId: null,
          correctnessClaim: false,
        },
      };
    }),
  };
}

function historicalLimitations(packet: Row) {
  const summary = parseJson<Record<string, Array<Record<string, unknown>>>>(
    packet.candidate_treatment_summary,
    {},
  );
  return Object.values(summary).flat()
    .filter((item) => item.representation === "Reconstructed")
    .map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      representation: "Reconstructed",
      limitation: "Historical raw transcript unavailable; source is not Exact.",
      automaticAuthorityPromotion: false,
    }));
}

function lineage(
  packet: Row,
  handoffId: string,
  provider: string,
  model: string,
  status: "completed" | "failed",
) {
  const causes = parseJson<Array<Record<string, unknown>>>(packet.governance_causes, []);
  const difference = parseJson<Array<Record<string, unknown>>>(packet.diff_summary, []);
  return [
    {
      step: "Observed in",
      references: Object.values(
        parseJson<Record<string, Array<Record<string, unknown>>>>(
          packet.candidate_treatment_summary,
          {},
        ),
      ).flat().map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId })),
    },
    {
      step: "Atlas proposed",
      references: causes.map((cause) => ({ sourceId: cause.sourceId })),
    },
    {
      step: "You decided",
      references: causes.map((cause) => ({ governanceEventId: cause.governanceEventId })),
    },
    {
      step: "Atlas used it for",
      references: [{ packetId: packet.id }],
    },
    {
      step: "Packet changed",
      references: difference,
    },
    {
      step: "Receiving model received it",
      references: [{
        handoffId,
        provider,
        model,
        received: status === "completed",
      }],
    },
  ];
}

async function insertLifecycle(
  db: D1Database,
  projectId: string,
  handoffId: string,
  status: "pending" | "sent",
  metadata: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO handoff_lifecycle_events (
      id, project_id, handoff_id, status, provider_response_id,
      failure_category, failure_reason, additional_live_retrieval,
      metadata, created_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
  ).bind(
    canonicalId("handoff-event"),
    projectId,
    handoffId,
    status,
    json(NO_LIVE_RETRIEVAL),
    json(metadata),
    now(),
  ).run();
}

async function readHandoffRows(db: D1Database, projectId: string, handoffId: string) {
  const root = await first<Row>(db.prepare(
    "SELECT * FROM handoffs WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(handoffId, projectId));
  if (!root) throw new Error("Handoff not found.");
  const [events, answer, receipt, packet] = await Promise.all([
    all<Row>(db.prepare(
      `SELECT * FROM handoff_lifecycle_events
       WHERE handoff_id = ? AND project_id = ?
       ORDER BY rowid ASC`,
    ).bind(handoffId, projectId)),
    first<Row>(db.prepare(
      "SELECT * FROM handoff_answers WHERE handoff_id = ? AND project_id = ? LIMIT 1",
    ).bind(handoffId, projectId)),
    first<Row>(db.prepare(
      "SELECT * FROM handoff_receipts WHERE handoff_id = ? AND project_id = ? LIMIT 1",
    ).bind(handoffId, projectId)),
    getPacket(db, projectId, String(root.packet_id)),
  ]);
  return { root, events, answer, receipt, packet };
}

export async function getHandoff(db: D1Database, projectId: string, handoffId: string) {
  assertId(handoffId, "handoff ID");
  const { root, events, answer, receipt, packet } = await readHandoffRows(
    db,
    projectId,
    handoffId,
  );
  const lifecycle = events.map(mapLifecycle);
  const status = currentStatus(events);
  const terminal = events.findLast((event) => (
    event.status === "completed" || event.status === "failed"
  )) || null;
  return {
    handoff: {
      id: root.id,
      projectId: root.project_id,
      packetId: root.packet_id,
      originalTask: root.original_task,
      packetSnapshotHash: root.packet_snapshot_hash,
      primaryRoadwayId: root.primary_roadway_id,
      primaryRoadwayVersionId: root.primary_roadway_version_id,
      provider: root.receiving_provider,
      model: root.receiving_model,
      actorId: root.actor_id,
      status,
      createdAt: root.handoff_at,
      terminalAt: terminal?.created_at ?? null,
      failureCategory: terminal?.failure_category ?? null,
      failureReason: terminal?.failure_reason ?? null,
      additionalLiveRetrieval: terminal
        ? parseJson(terminal.additional_live_retrieval, NO_LIVE_RETRIEVAL)
        : NO_LIVE_RETRIEVAL,
      idempotencyKey: root.idempotency_key,
      metadata: parseJson(root.metadata, {}),
    },
    lifecycle,
    packet: packet.packet,
    packetItems: packet.items,
    packetReceipt: packet.receipt,
    answer: mapAnswer(answer),
    receipt: receiptSnapshot(receipt, packet, root, events),
  };
}

async function saveFailure(
  db: D1Database,
  projectId: string,
  packet: Row,
  handoffId: string,
  provider: string,
  model: string,
  error: ReceivingModelFailure,
) {
  const failedAt = now();
  const receiptId = canonicalId("handoff-receipt");
  await db.batch([
    db.prepare(
      `INSERT INTO handoff_lifecycle_events (
        id, project_id, handoff_id, status, provider_response_id,
        failure_category, failure_reason, additional_live_retrieval,
        metadata, created_at
      ) VALUES (?, ?, ?, 'failed', NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      canonicalId("handoff-event"),
      projectId,
      handoffId,
      error.category,
      error.message,
      json(NO_LIVE_RETRIEVAL),
      json({ productionSuccess: false, seededAnswer: false }),
      failedAt,
    ),
    db.prepare(
      `INSERT INTO handoff_receipts (
        id, project_id, handoff_id, packet_id, packet_receipt_id,
        lineage, treatment_summary, authority_and_scope, freshness_summary,
        inference_disclosure, unresolved_conflicts, governance_causes,
        packet_difference, additional_live_retrieval, final_answer_reference,
        historical_limitations, honesty_statement, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(
      receiptId,
      projectId,
      handoffId,
      packet.id,
      packet.packet_receipt_id,
      json(lineage(packet, handoffId, provider, model, "failed")),
      packet.candidate_treatment_summary,
      json({ projectId, caseId: packet.case_id, serverEnforced: true }),
      packet.freshness_summary,
      packet.inference_disclosure,
      packet.unresolved_conflicts,
      packet.governance_causes,
      json(causalDifference(packet)),
      json(NO_LIVE_RETRIEVAL),
      json(historicalLimitations(packet)),
      HANDOFF_RECEIPT_HONESTY,
      failedAt,
    ),
  ]);
}

async function saveSuccess(
  db: D1Database,
  projectId: string,
  packet: Row,
  handoffId: string,
  provider: string,
  result: Awaited<ReturnType<typeof executeReceivingModel>>,
) {
  const answerId = canonicalId("handoff-answer");
  const receiptId = canonicalId("handoff-receipt");
  const finalAnswerReference = {
    id: answerId,
    providerResponseId: result.providerResponseId,
    provider,
    model: result.model,
    answerTimestamp: result.completedAt,
    handoffId,
    packetId: packet.id,
  };
  await db.batch([
    db.prepare(
      `INSERT INTO handoff_lifecycle_events (
        id, project_id, handoff_id, status, provider_response_id,
        failure_category, failure_reason, additional_live_retrieval,
        metadata, created_at
      ) VALUES (?, ?, ?, 'completed', ?, NULL, NULL, ?, ?, ?)`,
    ).bind(
      canonicalId("handoff-event"),
      projectId,
      handoffId,
      result.providerResponseId,
      json(result.additionalLiveRetrieval),
      json(result.metadata),
      result.completedAt,
    ),
    db.prepare(
      `INSERT INTO handoff_answers (
        id, project_id, handoff_id, packet_id, provider_response_id,
        receiving_provider, receiving_model, answer_text, answer_timestamp,
        canonical_message_reference, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(
      answerId,
      projectId,
      handoffId,
      packet.id,
      result.providerResponseId,
      provider,
      result.model,
      result.answerText,
      result.completedAt,
      json({
        distinctFromOriginalTask: true,
        distinctFromAtlasPacket: true,
        providerOwnedReasoning: true,
      }),
    ),
    db.prepare(
      `INSERT INTO handoff_receipts (
        id, project_id, handoff_id, packet_id, packet_receipt_id,
        lineage, treatment_summary, authority_and_scope, freshness_summary,
        inference_disclosure, unresolved_conflicts, governance_causes,
        packet_difference, additional_live_retrieval, final_answer_reference,
        historical_limitations, honesty_statement, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      receiptId,
      projectId,
      handoffId,
      packet.id,
      packet.packet_receipt_id,
      json(lineage(packet, handoffId, provider, result.model, "completed")),
      packet.candidate_treatment_summary,
      json({ projectId, caseId: packet.case_id, serverEnforced: true }),
      packet.freshness_summary,
      packet.inference_disclosure,
      packet.unresolved_conflicts,
      packet.governance_causes,
      json(causalDifference(packet)),
      json(result.additionalLiveRetrieval),
      json(finalAnswerReference),
      json(historicalLimitations(packet)),
      HANDOFF_RECEIPT_HONESTY,
      result.completedAt,
    ),
  ]);
}

export async function executeHandoff(
  db: D1Database,
  projectId: string,
  body: Row,
  rawIdempotencyKey: string,
  options: HandoffOptions,
) {
  const key = idempotencyKey(rawIdempotencyKey);
  const packetId = assertId(body.packetId, "packet ID");
  const provider = normalizeProvider(body.provider);
  const model = normalizeModel(body.model);
  const actorId = requiredString(body.actorId, "Actor");
  const supported = supportedReceivingModels(options.testAdapter).some((entry) => (
    entry.provider === provider && entry.model === model
  ));
  if (!supported) throw new Error("Unsupported receiving provider or model.");

  const existing = await first<Row>(db.prepare(
    "SELECT * FROM handoffs WHERE project_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(projectId, key));
  if (existing) {
    if (
      existing.packet_id !== packetId
      || existing.receiving_provider !== provider
      || existing.receiving_model !== model
      || existing.actor_id !== actorId
    ) {
      throw new Error("Idempotency key conflicts with a different packet, task, actor, provider, or model.");
    }
    return { ...(await getHandoff(db, projectId, String(existing.id))), idempotentReplay: true };
  }

  const packet = await packetSource(db, projectId, packetId);
  const originalTask = String(packet.task);
  if (
    Object.hasOwn(body, "originalTask")
    && body.originalTask !== originalTask
  ) {
    throw new Error("The receiving-model context cannot alter the packet's exact original task.");
  }
  const snapshotHash = await sha256(String(packet.compiled_content));
  const fingerprint = await sha256(json({
    projectId,
    packetId,
    originalTask,
    snapshotHash,
    provider,
    model,
    actorId,
  }));
  const handoffId = canonicalId("handoff");
  const createdAt = now();
  await db.batch([
    db.prepare(
      `INSERT INTO handoffs (
        id, project_id, packet_id, original_task, packet_snapshot_hash,
        primary_roadway_id, primary_roadway_version_id, receiving_provider,
        receiving_model, actor_id, handoff_at, additional_live_retrieval,
        final_answer_reference, handoff_status, failure_reason,
        idempotency_key, request_fingerprint, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?, ?)`,
    ).bind(
      handoffId,
      projectId,
      packetId,
      originalTask,
      snapshotHash,
      packet.primary_roadway_id,
      packet.primary_roadway_version_id,
      provider,
      model,
      actorId,
      createdAt,
      json(NO_LIVE_RETRIEVAL),
      key,
      fingerprint,
      json({
        packetVersion: 1,
        packetReceiptId: packet.packet_receipt_id,
        packetRecompiled: false,
        originalRequestRole: "user",
        atlasContextRole: "developer_reference_block",
        atlasContextIsUserAuthored: false,
      }),
    ),
    db.prepare(
      `INSERT INTO handoff_lifecycle_events (
        id, project_id, handoff_id, status, provider_response_id,
        failure_category, failure_reason, additional_live_retrieval,
        metadata, created_at
      ) VALUES (?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?, ?)`,
    ).bind(
      canonicalId("handoff-event"),
      projectId,
      handoffId,
      json(NO_LIVE_RETRIEVAL),
      json({ canonicalWriteAuthorized: true }),
      createdAt,
    ),
  ]);

  const input = buildReceivingModelInput(
    provider as "openai" | "test",
    model,
    originalTask,
    String(packet.compiled_content),
  );
  const dispatchConfigured = provider === "test" || Boolean(options.openAiApiKey);
  try {
    if (dispatchConfigured) {
      await insertLifecycle(db, projectId, handoffId, "sent", {
        provider,
        model,
        originalRequestRole: "user",
        atlasContextRole: "developer_reference_block",
        packetSnapshotHash: snapshotHash,
      });
    }
    const result = await executeReceivingModel(input, options);
    await saveSuccess(db, projectId, packet, handoffId, provider, result);
  } catch (error) {
    const failure = error instanceof ReceivingModelFailure
      ? error
      : new ReceivingModelFailure(
        error instanceof Error ? error.message : "Receiving-model handoff failed.",
        "provider_unavailable",
      );
    await saveFailure(db, projectId, packet, handoffId, provider, model, failure);
  }
  return { ...(await getHandoff(db, projectId, handoffId)), idempotentReplay: false };
}

export async function getHandoffHistory(
  db: D1Database,
  projectId: string,
  handoffId: string,
) {
  const detail = await getHandoff(db, projectId, handoffId);
  return {
    projectId,
    handoffId,
    status: detail.handoff.status,
    lifecycle: detail.lifecycle,
  };
}

export async function listHandoffs(db: D1Database, projectId: string) {
  const rows = await all<Row>(db.prepare(
    `SELECT h.*,
            (
              SELECT e.status FROM handoff_lifecycle_events e
              WHERE e.project_id = h.project_id AND e.handoff_id = h.id
              ORDER BY e.rowid DESC LIMIT 1
            ) AS current_status,
            (
              SELECT e.failure_category FROM handoff_lifecycle_events e
              WHERE e.project_id = h.project_id AND e.handoff_id = h.id
              ORDER BY e.rowid DESC LIMIT 1
            ) AS current_failure_category,
            (
              SELECT e.failure_reason FROM handoff_lifecycle_events e
              WHERE e.project_id = h.project_id AND e.handoff_id = h.id
              ORDER BY e.rowid DESC LIMIT 1
            ) AS current_failure_reason,
            a.id AS answer_id,
            a.provider_response_id,
            a.answer_timestamp,
            r.id AS receipt_id
     FROM handoffs h
     LEFT JOIN handoff_answers a
       ON a.project_id = h.project_id AND a.handoff_id = h.id
     LEFT JOIN handoff_receipts r
       ON r.project_id = h.project_id AND r.handoff_id = h.id
     WHERE h.project_id = ?
     ORDER BY h.handoff_at DESC, h.rowid DESC`,
  ).bind(projectId));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    packetId: row.packet_id,
    originalTask: row.original_task,
    provider: row.receiving_provider,
    model: row.receiving_model,
    status: row.current_status || row.handoff_status,
    failureCategory: row.current_failure_category || null,
    failureReason: row.current_failure_reason || row.failure_reason || null,
    createdAt: row.handoff_at,
    answerId: row.answer_id || null,
    providerResponseId: row.provider_response_id || null,
    answerTimestamp: row.answer_timestamp || null,
    receiptId: row.receipt_id || null,
  }));
}

export { supportedReceivingModels };
