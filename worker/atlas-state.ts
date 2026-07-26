const PRIVATE_WORKSPACE_ID = "primary-campus";
const DEMO_WORKSPACE_COOKIE = "campus_atlas_demo_workspace";
const DEMO_WORKSPACE_PATTERN = /^demo-[a-z0-9]{20,40}$/;

export function normalizeDemoWorkspaceId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DEMO_WORKSPACE_PATTERN.test(candidate) ? candidate : null;
}

export function demoWorkspaceIdFromRequest(request: Request) {
  const header = normalizeDemoWorkspaceId(request.headers.get("x-atlas-workspace"));
  if (header) return header;
  const query = normalizeDemoWorkspaceId(new URL(request.url).searchParams.get("workspaceId"));
  if (query) return query;
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEMO_WORKSPACE_COOKIE) return normalizeDemoWorkspaceId(rest.join("="));
  }
  return null;
}

export function createDemoWorkspaceId() {
  return `demo-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function demoWorkspaceCookie(workspaceId: string) {
  return `${DEMO_WORKSPACE_COOKIE}=${workspaceId}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`;
}

function mergeRecordArray(current: unknown, incoming: unknown, idKey: string) {
  if (!Array.isArray(incoming)) return current;
  const existing = Array.isArray(current) ? current : [];
  const incomingIds = new Set(incoming.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>)[idKey] || "") : ""));
  return [...incoming, ...existing.filter((item) => {
    const id = item && typeof item === "object" ? String((item as Record<string, unknown>)[idKey] || "") : "";
    return id && !incomingIds.has(id);
  })];
}

function mergeAtlasState(current: unknown, incoming: unknown) {
  if (!current || typeof current !== "object" || !incoming || typeof incoming !== "object") return incoming;
  const before = current as Record<string, unknown>;
  const next = incoming as Record<string, unknown>;
  return {
    ...before,
    ...next,
    nodes: mergeRecordArray(before.nodes, next.nodes, "id"),
    reviews: mergeRecordArray(before.reviews, next.reviews, "id"),
    connections: mergeRecordArray(before.connections, next.connections, "id"),
    externalReceipts: mergeRecordArray(before.externalReceipts, next.externalReceipts, "id"),
    contextPackets: mergeRecordArray(before.contextPackets, next.contextPackets, "packetId"),
  };
}

async function ensureAtlasStateTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS atlas_state (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function loadAtlasState(db: D1Database, workspaceId = PRIVATE_WORKSPACE_ID) {
  await ensureAtlasStateTable(db);
  const row = await db.prepare("SELECT payload, updated_at FROM atlas_state WHERE id = ? LIMIT 1").bind(workspaceId).first<{ payload: string; updated_at: string }>();
  return { state: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at ?? null };
}

export async function saveAtlasState(db: D1Database, state: unknown, workspaceId = PRIVATE_WORKSPACE_ID) {
  await ensureAtlasStateTable(db);
  const payload = JSON.stringify(state);
  if (payload.length > 900_000) throw new Error("Campus state is too large.");
  await db.prepare(`
    INSERT INTO atlas_state (id, payload, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
  `).bind(workspaceId, payload).run();
}

export async function handleAtlasState(request: Request, db: D1Database, publicDemo = false) {
  try {
    if (publicDemo) {
      const existingWorkspaceId = demoWorkspaceIdFromRequest(request);
      if (request.method === "GET") {
        const workspaceId = existingWorkspaceId || createDemoWorkspaceId();
        const loaded = await loadAtlasState(db, workspaceId);
        return Response.json({ ...loaded, workspaceId, mode: "public_demo", persistence: "session_scoped_d1", privateWorkspaceExposed: false }, {
          headers: {
            "cache-control": "no-store",
            ...(existingWorkspaceId ? {} : { "set-cookie": demoWorkspaceCookie(workspaceId) }),
          },
        });
      }
      if (request.method === "POST") {
        const state = await request.json() as Record<string, unknown>;
        const workspaceId = existingWorkspaceId || normalizeDemoWorkspaceId(state.workspaceId) || createDemoWorkspaceId();
        if (JSON.stringify(state).length > 900_000) return Response.json({ error: "Campus state is too large." }, { status: 413 });
        const current = await loadAtlasState(db, workspaceId);
        const replace = new URL(request.url).searchParams.get("replace") === "true";
        await saveAtlasState(db, replace ? state : mergeAtlasState(current.state, state), workspaceId);
        return Response.json({ saved: true, workspaceId, mode: "public_demo", persistence: "session_scoped_d1" }, {
          headers: {
            "cache-control": "no-store",
            ...(existingWorkspaceId ? {} : { "set-cookie": demoWorkspaceCookie(workspaceId) }),
          },
        });
      }
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
    }

    await ensureAtlasStateTable(db);

    if (request.method === "GET") {
      return Response.json({ ...(await loadAtlasState(db)), mode: "private_workspace", persistence: "hosted" });
    }

    if (request.method === "POST") {
      const state = await request.json();
      if (JSON.stringify(state).length > 900_000) return Response.json({ error: "Campus state is too large." }, { status: 413 });
      const current = await loadAtlasState(db);
      const replace = new URL(request.url).searchParams.get("replace") === "true";
      const merged = replace ? state : mergeAtlasState(current.state, state);
      await saveAtlasState(db, merged);
      return Response.json({ saved: true });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  } catch {
    return Response.json({ error: "Campus state is temporarily unavailable." }, { status: 500 });
  }
}
