import { beginTransfer, getTransfer, listTransfers, resumeTransfer } from "./transfer-room-service";
import {
  assertId,
  assertProjectId,
  authorizeWrite,
  requireIdempotencyKey,
  responseError,
  Row,
} from "./slice3-support";

export async function handleTransferRoom(
  request: Request,
  db: D1Database,
  options: {
    actionKey?: string;
    deploymentVersion?: string;
    sourceCommit?: string;
  } = {},
) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/transfers(?:\/(.+))?$/);
    if (!match) return Response.json({ error: "Transfer route not found." }, { status: 404 });
    const projectId = assertProjectId(decodeURIComponent(match[1]));
    const parts = match[2] ? match[2].split("/").map(decodeURIComponent) : [];

    if (!parts.length && request.method === "GET") {
      return Response.json({ projectId, transfers: await listTransfers(db, projectId) }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (!parts.length && request.method === "POST") {
      authorizeWrite(request, options.actionKey);
      const result = await beginTransfer(
        db,
        projectId,
        await request.json() as Row,
        requireIdempotencyKey(request),
        {
          deploymentVersion: options.deploymentVersion,
          sourceCommit: options.sourceCommit,
        },
      );
      return Response.json(result, {
        status: result.attemptCount > 1 ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }

    const transferId = assertId(parts[0], "transfer ID");
    if (parts.length === 1 && request.method === "GET") {
      return Response.json(await getTransfer(db, projectId, transferId), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts.length === 2 && parts[1] === "resume" && request.method === "POST") {
      authorizeWrite(request, options.actionKey);
      requireIdempotencyKey(request);
      return Response.json(await resumeTransfer(db, projectId, transferId), {
        headers: { "cache-control": "no-store" },
      });
    }

    return Response.json({ error: "Transfer route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error, "Transfer request failed.");
  }
}
