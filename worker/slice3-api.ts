import { findingDetail, getCheckpoint, latestCheckpoint, listFindings, runCheckpoint } from "./checkpoint-service";
import { eligibleMechanisms, governFinding, rollbackGovernance } from "./governance-service";
import {
  assertId,
  assertProjectId,
  authorizeWrite,
  requireIdempotencyKey,
  responseError,
  Row,
} from "./slice3-support";

export async function handleSlice3(
  request: Request,
  db: D1Database,
  actionKey?: string,
) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/(.+)$/);
    if (!match) return Response.json({ error: "Slice 3 route not found." }, { status: 404 });
    const projectId = assertProjectId(decodeURIComponent(match[1]));
    const parts = match[2].split("/").map(decodeURIComponent);

    if (parts[0] === "checkpoints" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const idempotencyKey = requireIdempotencyKey(request);
      const body = await request.json() as Row;
      const result = await runCheckpoint(db, projectId, body, idempotencyKey);
      return Response.json(result, {
        status: result.idempotentReplay ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts[0] === "checkpoints" && parts[1] === "latest" && parts.length === 2 && request.method === "GET") {
      const conversationId = assertId(url.searchParams.get("conversationId"), "conversation ID");
      const caseId = url.searchParams.get("caseId");
      return Response.json({
        projectId,
        conversationId,
        result: await latestCheckpoint(db, projectId, conversationId, caseId),
      }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts[0] === "checkpoints" && parts.length === 2 && request.method === "GET") {
      const checkpointId = assertId(parts[1], "checkpoint ID");
      return Response.json(await getCheckpoint(db, projectId, checkpointId), {
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts[0] === "findings" && parts.length === 1 && request.method === "GET") {
      return Response.json({ projectId, findings: await listFindings(db, projectId, {
        status: url.searchParams.get("status"),
        type: url.searchParams.get("type"),
        caseId: url.searchParams.get("caseId"),
        scope: url.searchParams.get("scope"),
        since: url.searchParams.get("since"),
      }) }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (parts[0] === "findings" && parts.length === 2 && request.method === "GET") {
      const findingId = assertId(parts[1], "finding ID");
      return Response.json(await findingDetail(db, projectId, findingId), {
        headers: { "cache-control": "no-store" },
      });
    }

    if (
      parts[0] === "findings"
      && parts.length === 3
      && parts[2] === "governance"
      && request.method === "POST"
    ) {
      authorizeWrite(request, actionKey);
      const idempotencyKey = requireIdempotencyKey(request);
      const findingId = assertId(parts[1], "finding ID");
      const body = await request.json() as Row;
      return Response.json(await governFinding(db, projectId, findingId, body, idempotencyKey), {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    }

    if (
      parts[0] === "governance-events"
      && parts.length === 3
      && parts[2] === "rollback"
      && request.method === "POST"
    ) {
      authorizeWrite(request, actionKey);
      const idempotencyKey = requireIdempotencyKey(request);
      const eventId = assertId(parts[1], "governance event ID");
      const body = await request.json() as Row;
      return Response.json(await rollbackGovernance(db, projectId, eventId, body, idempotencyKey), {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    }

    if (
      parts[0] === "mechanisms"
      && parts.length === 2
      && parts[1] === "eligible"
      && request.method === "GET"
    ) {
      const caseId = url.searchParams.get("caseId");
      return Response.json({ projectId, mechanisms: await eligibleMechanisms(db, projectId, caseId) }, {
        headers: { "cache-control": "no-store" },
      });
    }

    return Response.json({ error: "Slice 3 route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}
