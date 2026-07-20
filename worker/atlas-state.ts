const WORKSPACE_ID = "primary-campus";

async function ensureAtlasStateTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS atlas_state (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

export async function loadAtlasState(db: D1Database) {
  await ensureAtlasStateTable(db);
  const row = await db.prepare("SELECT payload, updated_at FROM atlas_state WHERE id = ? LIMIT 1").bind(WORKSPACE_ID).first<{ payload: string; updated_at: string }>();
  return { state: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at ?? null };
}

export async function saveAtlasState(db: D1Database, state: unknown) {
  await ensureAtlasStateTable(db);
  const payload = JSON.stringify(state);
  if (payload.length > 900_000) throw new Error("Campus state is too large.");
  await db.prepare(`
    INSERT INTO atlas_state (id, payload, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
  `).bind(WORKSPACE_ID, payload).run();
}

export async function handleAtlasState(request: Request, db: D1Database, publicDemo = false) {
  try {
    if (publicDemo) {
      if (request.method === "GET") return Response.json({ state: null, updatedAt: null, mode: "public_demo", persistence: "device_local", privateWorkspaceExposed: false });
      if (request.method === "POST") return Response.json({ error: "Hosted state writes are disabled in public demo mode.", mode: "public_demo" }, { status: 403 });
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
      const merged = current.state && typeof current.state === "object" && state && typeof state === "object"
        ? { ...current.state, ...state }
        : state;
      await saveAtlasState(db, merged);
      return Response.json({ saved: true });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  } catch {
    return Response.json({ error: "Campus state is temporarily unavailable." }, { status: 500 });
  }
}
