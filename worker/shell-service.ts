import { reasoningHealthForConversation } from "./reasoning-health";
import { Row, all, first, parseJson } from "./slice3-support";

type ShellOptions = {
  actionKey?: string;
  publicDemo?: boolean;
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

async function requireProject(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare(
    "SELECT * FROM projects WHERE id = ? LIMIT 1",
  ).bind(projectId));
  if (!project) throw new Error("Canonical project not found.");
  return project;
}

async function listProjects(db: D1Database) {
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
     WHERE p.status = 'active'
     ORDER BY last_activity_at DESC, p.name ASC`,
  ));
  return rows.map(projectView);
}

async function workOverview(db: D1Database, projectId: string) {
  const project = await requireProject(db, projectId);
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
    activeConversationId: work.find((item) => item.status === "active")?.id || work[0]?.id || null,
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
  const email = request.headers.get("oai-authenticated-user-email");
  const fullName = optionalFullName(request);
  const supplied = request.headers.get("authorization");
  const writeConfigured = Boolean(options.actionKey);
  const writeAuthorized = Boolean(options.actionKey && supplied === `Bearer ${options.actionKey}`);
  return {
    actor: {
      id: email || "cody",
      displayName: fullName || email || "Cody",
      email,
      authenticatedByPlatform: Boolean(email),
    },
    mode: options.publicDemo ? "public_demo" : "private_workspace",
    fixtureMode: false,
    writeAuthorization: {
      required: true,
      configured: writeConfigured,
      authorized: writeAuthorized,
      storage: "memory_only",
    },
    readOnly: !writeAuthorized,
  };
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Canonical shell request failed.";
  const status = /not found/i.test(message) ? 404 : 503;
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
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET" } });
    }
    if (url.pathname === "/api/v1/health") {
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
        checkedAt: new Date().toISOString(),
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/v1/session") {
      return Response.json({ session: sessionView(request, options) }, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/api/v1/projects") {
      const projects = await listProjects(db);
      return Response.json({
        projects,
        activeProjectId: projects[0]?.id || null,
        fixtureMode: false,
        source: "canonical_d1",
      }, { headers: { "cache-control": "no-store" } });
    }
    const workMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/work$/);
    if (workMatch) {
      return Response.json(await workOverview(db, decodeURIComponent(workMatch[1])), {
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ error: "Canonical shell route not found." }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}
