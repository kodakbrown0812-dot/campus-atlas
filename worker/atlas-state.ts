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

export async function handleAtlasState(request: Request, db: D1Database) {
  try {
    await ensureAtlasStateTable(db);

    if (request.method === "GET") {
      const row = await db.prepare("SELECT payload, updated_at FROM atlas_state WHERE id = ? LIMIT 1").bind(WORKSPACE_ID).first<{ payload: string; updated_at: string }>();
      return Response.json({ state: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at ?? null });
    }

    if (request.method === "POST") {
      const state = await request.json();
      const payload = JSON.stringify(state);
      if (payload.length > 900_000) return Response.json({ error: "Campus state is too large." }, { status: 413 });
      await db.prepare(`
        INSERT INTO atlas_state (id, payload, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
      `).bind(WORKSPACE_ID, payload).run();
      return Response.json({ saved: true });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  } catch {
    return Response.json({ error: "Campus state is temporarily unavailable." }, { status: 500 });
  }
}
