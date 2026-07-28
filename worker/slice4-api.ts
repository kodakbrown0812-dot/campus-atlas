import { compilePacket, createLiveStateSnapshot, getPacket, listPackets } from "./packet-service";
import { ensureRoadwayRegistry, interpretTask } from "./roadway-service";
import {
  assertId,
  assertProjectId,
  authorizeWrite,
  requireIdempotencyKey,
  responseError,
  Row,
} from "./slice3-support";

export async function handleSlice4(
  request: Request,
  db: D1Database,
  actionKey?: string,
) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/(.+)$/);
    if (!match) return Response.json({ error: "Slice 4 route not found." }, { status: 404 });
    const projectId = assertProjectId(decodeURIComponent(match[1]));
    const parts = match[2].split("/").map(decodeURIComponent);

    if (parts[0] === "roadways" && parts.length === 1 && request.method === "GET") {
      return Response.json({
        projectId,
        roadways: await ensureRoadwayRegistry(db, projectId),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (parts[0] === "reconstruction" && parts[1] === "interpret" && parts.length === 2 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const body = await request.json() as Row;
      return Response.json({
        projectId,
        interpretation: await interpretTask(db, projectId, body),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (parts[0] === "packets" && parts.length === 1 && request.method === "GET") {
      return Response.json({
        projectId,
        packets: await listPackets(db, projectId),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (parts[0] === "packets" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const body = await request.json() as Row;
      const result = await compilePacket(db, projectId, body, requireIdempotencyKey(request));
      if ("status" in result && result.status === "clarification_required") {
        return Response.json(result, { status: 409, headers: { "cache-control": "no-store" } });
      }
      return Response.json(result, {
        status: result.idempotentReplay ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts[0] === "packets" && parts.length >= 2 && request.method === "GET") {
      const packetId = assertId(parts[1], "packet ID");
      const detail = await getPacket(db, projectId, packetId);
      if (parts.length === 2) {
        return Response.json(detail, { headers: { "cache-control": "no-store" } });
      }
      if (parts.length === 3 && parts[2] === "receipt") {
        return Response.json({
          projectId,
          packetId,
          receipt: detail.receipt,
        }, { headers: { "cache-control": "no-store" } });
      }
      if (parts.length === 3 && parts[2] === "comparison") {
        return Response.json({
          projectId,
          packetId,
          priorComparablePacketId: detail.packet.priorComparablePacketId,
          exactPacketDifference: detail.receipt.exactPacketDifference,
          governanceCauses: detail.receipt.governanceCauses,
        }, { headers: { "cache-control": "no-store" } });
      }
    }

    if (parts[0] === "live-state" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const body = await request.json() as Row;
      const result = await createLiveStateSnapshot(
        db,
        projectId,
        body,
        requireIdempotencyKey(request),
      );
      return Response.json(result, {
        status: result.idempotentReplay ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }

    return Response.json({ error: "Slice 4 route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error, "Slice 4 request failed.");
  }
}
