import {
  executeHandoff,
  getHandoff,
  getHandoffHistory,
  listHandoffs,
  supportedReceivingModels,
} from "./handoff-service";
import { TestReceivingModelAdapter } from "./receiving-model";
import {
  assertId,
  assertProjectId,
  authorizeWrite,
  requireProject,
  requireIdempotencyKey,
  responseError,
  Row,
} from "./slice3-support";

export async function handleSlice5(
  request: Request,
  db: D1Database,
  options: {
    actionKey?: string;
    openAiApiKey?: string;
    testAdapter?: TestReceivingModelAdapter;
  },
) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/handoffs(?:\/(.*))?$/);
    if (!match) return Response.json({ error: "Slice 5 route not found." }, { status: 404 });
    const projectId = assertProjectId(decodeURIComponent(match[1]));
    const parts = (match[2] || "").split("/").filter(Boolean).map(decodeURIComponent);

    if (parts.length === 1 && parts[0] === "models" && request.method === "GET") {
      await requireProject(db, projectId);
      return Response.json({
        projectId,
        models: supportedReceivingModels(),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (parts.length === 0 && request.method === "POST") {
      authorizeWrite(request, options.actionKey);
      const body = await request.json() as Row;
      const result = await executeHandoff(
        db,
        projectId,
        body,
        requireIdempotencyKey(request),
        {
          openAiApiKey: options.openAiApiKey,
          testAdapter: options.testAdapter,
        },
      );
      if (result.idempotentReplay) {
        return Response.json(result, {
          status: 200,
          headers: { "cache-control": "no-store" },
        });
      }
      const status = result.handoff.status === "completed"
        ? 201
        : result.handoff.failureCategory === "missing_configuration"
          ? 503
          : 502;
      return Response.json(result, {
        status,
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts.length === 0 && request.method === "GET") {
      await requireProject(db, projectId);
      return Response.json({
        projectId,
        handoffs: await listHandoffs(db, projectId),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (parts.length >= 1 && request.method === "GET") {
      const handoffId = assertId(parts[0], "handoff ID");
      if (parts.length === 1) {
        return Response.json(await getHandoff(db, projectId, handoffId), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (parts.length === 2 && parts[1] === "history") {
        return Response.json(await getHandoffHistory(db, projectId, handoffId), {
          headers: { "cache-control": "no-store" },
        });
      }
      const detail = await getHandoff(db, projectId, handoffId);
      if (parts.length === 2 && parts[1] === "receipt") {
        return Response.json({
          projectId,
          handoffId,
          receipt: detail.receipt,
        }, { headers: { "cache-control": "no-store" } });
      }
      if (parts.length === 2 && parts[1] === "answer") {
        return Response.json({
          projectId,
          handoffId,
          answer: detail.answer,
        }, { headers: { "cache-control": "no-store" } });
      }
      if (parts.length === 2 && parts[1] === "comparison") {
        return Response.json({
          projectId,
          handoffId,
          packetId: detail.packet.id,
          priorComparablePacketId: detail.receipt?.priorComparablePacketId ?? null,
          exactPacketDifference: detail.receipt?.exactPacketDifference ?? [],
          causalPacketDifference: detail.receipt?.causalPacketDifference ?? [],
          governanceCauses: detail.receipt?.governanceCauses ?? [],
        }, { headers: { "cache-control": "no-store" } });
      }
    }

    return Response.json({ error: "Slice 5 route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error, "Slice 5 request failed.");
  }
}
