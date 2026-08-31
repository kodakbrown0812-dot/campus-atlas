import { reasoningHealthForConversation } from "./reasoning-health";
import { Row, all, authorizeWrite, first, parseJson } from "./slice3-support";
import { isVerifiedOwnerRequest, ownerIdentityConfigured } from "./owner-identity";

type ShellOptions = {
  actionKey?: string;
  deploymentVersion?: string;
  ownerUserId?: string;
  ownerEmail?: string;
  publicDemo?: boolean;
  sourceCommit?: string;
};

function projectView(row: Row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    schemaVersion: row.schema_version,
    legacyProjectKey: row.legacy_project_key,
    metadata: parseJson(row.metadata, {}),
    conversationCount: Number(row.conversation_count || 0),
    pendingFindingCount: Number(row.pending_finding_count || 0),
    lastActivityAt: row.last_activity_at || row.updated_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listProjects(db: D1Database, includeArchived = false) {
  const rows = await all<Row>(db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS conversation_count,
      (SELECT COUNT(*) FROM findings f
        WHERE f.project_id = p.id AND f.status IN ('proposed', 'under_review', 'deferred', 'challenged')
      ) AS pending_finding_count,
      MAX(
        p.updated_at,
        COALESCE((SELECT MAX(c.updated_at) FROM conversations c WHERE c.project_id = p.id), p.updated_at),
        COALESCE((SELECT MAX(f.created_at) FROM findings f WHERE f.project_id = p.id), p.updated_at),
        COALESCE((SELECT MAX(pa.created_at) FROM packets pa WHERE pa.project_id = p.id), p.updated_at)
      ) AS last_activity_at
     FROM projects p
     ${includeArchived ? "" : "WHERE p.status = 'active'"}
     ORDER BY last_activity_at DESC, p.name ASC`,
  ));
  return rows.map(projectView);
}

const projectHistoryTables = [
  "conversations",
  "conversation_imports",
  "messages",
  "cases",
  "events",
  "conversation_case_links",
  "case_event_attachments",
  "case_boundary_proposals",
  "case_boundary_operations",
  "checkpoints",
  "reasoning_nodes",
  "reasoning_node_versions",
  "checkpoint_reasoning_nodes",
  "transfer_runs",
  "transfer_run_events",
  "findings",
  "finding_versions",
  "mechanisms",
  "mechanism_versions",
  "governance_events",
  "roadways",
  "roadway_versions",
  "packets",
  "packet_items",
  "receipts",
  "live_state_snapshots",
  "handoffs",
  "handoff_lifecycle_events",
  "handoff_answers",
  "handoff_receipts",
] as const;

const conversationHistoryTables = [
  "conversation_imports",
  "messages",
  "events",
  "conversation_case_links",
  "case_boundary_proposals",
  "case_boundary_operations",
  "checkpoints",
  "transfer_runs",
] as const;

async function referenceCount(
  db: D1Database,
  tables: readonly string[],
  column: "project_id" | "conversation_id",
  id: string,
) {
  const rows = await Promise.all(tables.map((table) => first<{ count: number } & Row>(
    db.prepare("SELECT COUNT(*) AS count FROM " + table + " WHERE " + column + " = ?").bind(id),
  )));
  return rows.reduce((total, row) => total + Number(row?.count || 0), 0);
}

async function requireProject(db: D1Database, projectId: string) {
  const row = await first<Row>(db.prepare(
    "SELECT * FROM projects WHERE id = ? LIMIT 1",
  ).bind(projectId));
  if (!row) throw new Error("Project not found.");
  return row;
}

async function updateProject(db: D1Database, projectId: string, body: Row) {
  const current = await requireProject(db, projectId);
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const name = hasName ? String(body.name || "").trim() : String(current.name);
  const status = hasStatus ? String(body.status || "") : String(current.status);
  if (!hasName && !hasStatus) throw new Error("A project name or lifecycle status is required.");
  if (!name || name.length > 120) throw new Error("Project name must be between 1 and 120 characters.");
  if (!["active", "archived"].includes(status)) throw new Error("Project status must be active or archived.");
  const changed = name !== current.name || status !== current.status;
  if (changed) {
    await db.prepare(
      "UPDATE projects SET name = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(name, status, projectId).run();
  }
  const updated = await requireProject(db, projectId);
  return { project: projectView(updated), changed };
}

async function updateWorkItem(db: D1Database, projectId: string, conversationId: string, body: Row) {
  await requireProject(db, projectId);
  const current = await first<Row>(db.prepare(
    "SELECT * FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(conversationId, projectId));
  if (!current) throw new Error("Work item not found.");
  const status = String(body.status || "");
  if (!["active", "completed", "archived"].includes(status)) {
    throw new Error("Work status must be active, completed, or archived.");
  }
  const changed = status !== current.status;
  if (changed) {
    await db.prepare(
      "UPDATE conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?",
    ).bind(status, conversationId, projectId).run();
  }
  const updated = await first<Row>(db.prepare(
    "SELECT * FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(conversationId, projectId));
  return {
    workItem: {
      id: updated?.id,
      projectId: updated?.project_id,
      title: updated?.title,
      status: updated?.status,
      updatedAt: updated?.updated_at,
    },
    changed,
  };
}

async function workOverview(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM findings f
       WHERE f.project_id = p.id AND f.status IN ('proposed', 'under_review', 'deferred', 'challenged')
      ) AS pending_finding_count
     FROM projects p WHERE p.id = ? LIMIT 1`,
  ).bind(projectId));
  if (!project) throw new Error("Canonical project not found.");
  const conversations = await all<Row>(db.prepare(
    `SELECT c.*, ca.objective AS active_case_objective, ca.status AS active_case_status,
            ca.outcome_state AS active_case_outcome_state, ca.updated_at AS active_case_updated_at
     FROM conversations c
     LEFT JOIN cases ca ON ca.id = c.active_case_id AND ca.project_id = c.project_id
     WHERE c.project_id = ?
     ORDER BY c.updated_at DESC, c.created_at DESC`,
  ).bind(projectId));
  const work = await Promise.all(conversations.map(async (conversation) => {
    const health = await reasoningHealthForConversation(
      db,
      projectId,
      String(conversation.id),
      conversation.active_case_id ? String(conversation.active_case_id) : null,
    );
    return {
      id: conversation.id,
      title: conversation.title,
      sourceType: conversation.source_type,
      status: conversation.status,
      activeCaseId: conversation.active_case_id,
      activeCaseObjective: conversation.active_case_objective,
      activeCaseStatus: conversation.active_case_status,
      outcomeState: conversation.active_case_outcome_state,
      reasoningHealth: health,
      lastMeaningfulChange: conversation.active_case_updated_at || conversation.updated_at,
      nextAction: health.recommendedNextAction,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    };
  }));
  const packets = await all<Row>(db.prepare(
    `SELECT id, task, status, token_budget, final_token_count, created_at
     FROM packets WHERE project_id = ?
     ORDER BY created_at DESC LIMIT 5`,
  ).bind(projectId));
  return {
    project: projectView(project),
    activeConversationId: work.find((item) => (
      item.status === "active"
      && (!item.activeCaseId || item.activeCaseStatus === "active")
    ))?.id || null,
    conversations: work,
    recentlyChangedPackets: packets.map((packet) => ({
      id: packet.id,
      task: packet.task,
      status: packet.status,
      tokenBudget: packet.token_budget,
      finalTokenCount: packet.final_token_count,
      createdAt: packet.created_at,
    })),
    fixtureMode: false,
    source: "canonical_d1",
  };
}

function optionalFullName(request: Request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function sessionView(request: Request, options: ShellOptions) {
  const authenticatedUserId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  const fullName = optionalFullName(request);
  const supplied = request.headers.get("authorization");
  const writeConfigured = Boolean(options.actionKey);
  const ownerAuthorized = Boolean(options.actionKey && isVerifiedOwnerRequest(request, options));
  const writeAuthorized = ownerAuthorized || Boolean(options.actionKey && supplied === `Bearer ${options.actionKey}`);
  return {
    actor: {
      id: authenticatedUserId || email || "cody",
      displayName: fullName || email || "Cody",
      email,
      authenticatedByPlatform: Boolean(authenticatedUserId || email),
    },
    mode: options.publicDemo ? "public_demo" : "private_workspace",
    fixtureMode: false,
    writeAuthorization: {
      required: true,
      configured: writeConfigured,
      authorized: writeAuthorized,
      ownerIdentityConfigured: ownerIdentityConfigured(options),
      storage: ownerAuthorized ? "platform_identity" : "memory_only",
    },
    readOnly: !writeAuthorized,
  };
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Canonical shell request failed.";
  const status = /authorization/i.test(message)
    ? 401
    : /not found/i.test(message)
      ? 404
      : /required|must|between|status/i.test(message)
        ? 400
        : 503;
  return Response.json({
    error: message,
    canonicalState: "unavailable",
    fixtureMode: false,
    seededFallback: false,
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function handleShellService(
  request: Request,
  db: D1Database,
  options: ShellOptions,
) {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/health") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
      }
      const projectCount = await first<{ count: number } & Row>(
        db.prepare("SELECT COUNT(*) AS count FROM projects"),
      );
      return Response.json({
        status: "connected",
        canonicalState: "available",
        persistence: "canonical_d1",
        projectCount: Number(projectCount?.count || 0),
        fixtureMode: false,
        seededFallback: false,
        publicDemo: Boolean(options.publicDemo),
        buildIdentity: {
          deploymentVersion: options.deploymentVersion?.trim() || null,
          sourceCommit: options.sourceCommit?.trim() || null,
        },
        checkedAt: new Date().toISOString(),
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/v1/session") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
      }
      return Response.json({ session: sessionView(request, options) }, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/api/v1/projects") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
      }
      const projects = await listProjects(db, url.searchParams.get("includeArchived") === "true");
      return Response.json({
        projects,
        activeProjectId: projects.find((project) => project.status === "active")?.id || null,
        fixtureMode: false,
        source: "canonical_d1",
      }, { headers: { "cache-control": "no-store" } });
    }
    const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectMatch && request.method === "PATCH") {
      authorizeWrite(request, options.actionKey);
      const projectId = decodeURIComponent(projectMatch[1]);
      return Response.json(await updateProject(db, projectId, await request.json() as Row), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (projectMatch && request.method === "DELETE") {
      authorizeWrite(request, options.actionKey);
      const projectId = decodeURIComponent(projectMatch[1]);
      await requireProject(db, projectId);
      if (await referenceCount(db, projectHistoryTables, "project_id", projectId)) {
        return Response.json({
          error: "This project is part of Atlas history and can be archived but not permanently removed.",
          canArchive: true,
        }, { status: 409, headers: { "cache-control": "no-store" } });
      }
      await db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run();
      return Response.json({ deleted: true, projectId }, {
        headers: { "cache-control": "no-store" },
      });
    }
    const workItemMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/work\/([^/]+)$/);
    if (workItemMatch && request.method === "PATCH") {
      authorizeWrite(request, options.actionKey);
      return Response.json(await updateWorkItem(
        db,
        decodeURIComponent(workItemMatch[1]),
        decodeURIComponent(workItemMatch[2]),
        await request.json() as Row,
      ), { headers: { "cache-control": "no-store" } });
    }
    if (workItemMatch && request.method === "DELETE") {
      authorizeWrite(request, options.actionKey);
      const projectId = decodeURIComponent(workItemMatch[1]);
      const conversationId = decodeURIComponent(workItemMatch[2]);
      const workItem = await first<Row>(db.prepare(
        "SELECT id FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
      ).bind(conversationId, projectId));
      if (!workItem) throw new Error("Work item not found.");
      if (await referenceCount(db, conversationHistoryTables, "conversation_id", conversationId)) {
        return Response.json({
          error: "This work is part of Atlas history and can be archived but not permanently removed.",
          canArchive: true,
        }, { status: 409, headers: { "cache-control": "no-store" } });
      }
      await db.prepare(
        "DELETE FROM conversations WHERE id = ? AND project_id = ?",
      ).bind(conversationId, projectId).run();
      return Response.json({ deleted: true, projectId, workItemId: conversationId }, {
        headers: { "cache-control": "no-store" },
      });
    }
    const workMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/work$/);
    if (workMatch) {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
      }
      return Response.json(await workOverview(db, decodeURIComponent(workMatch[1])), {
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ error: "Canonical shell route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}
