import {
  conversationStructure,
  inspectCase,
  inspectMechanism,
  inspectOverview,
  inspectReasoningNode,
} from "./inspect-service";
import {
  assertId,
  assertProjectId,
  authorizeWrite,
  requireIdempotencyKey,
  responseError,
  Row,
} from "./slice3-support";
import { contextualAdd, correctReasoningNode } from "./stewardship-mutations";

export async function handleSlice6B(
  request: Request,
  db: D1Database,
  actionKey?: string,
) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/(.+)$/);
    if (!match) return Response.json({ error: "Slice 6B route not found." }, { status: 404 });
    const projectId = assertProjectId(decodeURIComponent(match[1]));
    const parts = match[2].split("/").map(decodeURIComponent);

    if (parts[0] === "inspect" && parts.length === 1 && request.method === "GET") {
      return Response.json(await inspectOverview(db, projectId), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts[0] === "inspect" && parts.length === 3 && request.method === "GET") {
      const recordId = assertId(parts[2], `${parts[1]} ID`);
      if (parts[1] === "cases") {
        return Response.json(await inspectCase(db, projectId, recordId), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (parts[1] === "reasoning") {
        return Response.json(await inspectReasoningNode(db, projectId, recordId), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (parts[1] === "mechanisms") {
        return Response.json(await inspectMechanism(db, projectId, recordId), {
          headers: { "cache-control": "no-store" },
        });
      }
    }
    if (
      parts[0] === "conversations"
      && parts.length === 3
      && parts[2] === "structure"
      && request.method === "GET"
    ) {
      return Response.json(
        await conversationStructure(db, projectId, assertId(parts[1], "conversation ID")),
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (
      parts[0] === "reasoning-nodes"
      && parts.length === 3
      && parts[2] === "corrections"
      && request.method === "POST"
    ) {
      authorizeWrite(request, actionKey);
      const result = await correctReasoningNode(
        db,
        projectId,
        assertId(parts[1], "reasoning node ID"),
        await request.json() as Row,
        requireIdempotencyKey(request),
      );
      return Response.json(result, {
        status: result.idempotentReplay ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }
    if (parts[0] === "contextual-add" && parts.length === 1 && request.method === "POST") {
      authorizeWrite(request, actionKey);
      const result = await contextualAdd(
        db,
        projectId,
        await request.json() as Row,
        requireIdempotencyKey(request),
      );
      return Response.json(result, {
        status: result.idempotentReplay ? 200 : 201,
        headers: { "cache-control": "no-store" },
      });
    }

    return Response.json({ error: "Slice 6B route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error, "Slice 6B request failed.");
  }
}
