export const AUTHORITY_STATES = [
  "observed", "inferred", "proposed", "under_review", "approved_local",
  "approved_project_wide", "approved_cross_project", "challenged",
  "superseded", "retired", "rejected",
] as const;

export const CANONICAL_RECORD_TYPES = [
  "projects", "conversations", "messages", "events", "cases",
  "case_event_attachments", "reasoning_nodes", "reasoning_node_versions",
  "findings", "finding_versions", "mechanisms", "mechanism_versions",
  "governance_events", "roadways", "roadway_versions", "packets",
  "packet_items", "receipts", "handoffs",
] as const;

export type CanonicalRecordType = typeof CANONICAL_RECORD_TYPES[number];
type CanonicalRow = Record<string, unknown> & { id: string; project_id?: string };

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,95}$/i;
const RECORD_ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{2,127}$/i;
const tableNames = new Set<string>(CANONICAL_RECORD_TYPES);

function assertTable(table: string): asserts table is CanonicalRecordType {
  if (!tableNames.has(table)) throw new Error("Unsupported canonical record type.");
}

function assertId(value: unknown, label: string, pattern = RECORD_ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function canonicalId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export async function readCanonicalRecord(db: D1Database, table: string, projectId: string, id: string) {
  assertTable(table);
  assertId(projectId, "project ID", PROJECT_ID_PATTERN);
  assertId(id, "record ID");
  const scope = table === "projects" ? "id = ? AND id = ?" : "id = ? AND project_id = ?";
  return db.prepare(`SELECT * FROM ${table} WHERE ${scope} LIMIT 1`).bind(id, projectId).first<CanonicalRow>();
}

export async function listCanonicalRecords(db: D1Database, table: string, projectId: string, limit = 100) {
  assertTable(table);
  assertId(projectId, "project ID", PROJECT_ID_PATTERN);
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const scope = table === "projects" ? "id = ?" : "project_id = ?";
  const result = await db.prepare(`SELECT * FROM ${table} WHERE ${scope} ORDER BY created_at DESC LIMIT ?`).bind(projectId, safeLimit).all<CanonicalRow>();
  return result.results ?? [];
}

export async function createCanonicalRecord(
  db: D1Database,
  table: string,
  projectId: string,
  input: CanonicalRow,
) {
  assertTable(table);
  assertId(projectId, "project ID", PROJECT_ID_PATTERN);
  assertId(input.id, "record ID");
  if (table !== "projects" && input.project_id !== projectId) throw new Error("Record project scope does not match the request.");
  if (table === "projects" && input.id !== projectId) throw new Error("Project ID does not match the request scope.");

  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => key);
  if (columns.some((key) => !/^[a-z][a-z0-9_]*$/.test(key))) throw new Error("Invalid canonical column.");
  const placeholders = columns.map(() => "?").join(", ");
  await db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .bind(...entries.map(([, value]) => typeof value === "object" && value !== null ? JSON.stringify(value) : value))
    .run();
  return readCanonicalRecord(db, table, projectId, input.id);
}

export async function createIdempotentCanonicalRecord(
  db: D1Database,
  table: "governance_events" | "handoffs",
  projectId: string,
  idempotencyKey: string,
  input: CanonicalRow,
) {
  if (!idempotencyKey.trim()) throw new Error("Idempotency key is required.");
  const existing = await db.prepare(`SELECT * FROM ${table} WHERE project_id = ? AND idempotency_key = ? LIMIT 1`)
    .bind(projectId, idempotencyKey).first<CanonicalRow>();
  if (existing) return { record: existing, idempotentReplay: true };
  return { record: await createCanonicalRecord(db, table, projectId, { ...input, idempotency_key: idempotencyKey }), idempotentReplay: false };
}

export async function handleCanonicalRecords(request: Request, db: D1Database, actionKey?: string) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/records\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return Response.json({ error: "Canonical route not found." }, { status: 404 });
    const projectId = decodeURIComponent(match[1]);
    const table = decodeURIComponent(match[2]);
    const recordId = match[3] ? decodeURIComponent(match[3]) : null;

    if (request.method === "GET") {
      const value = recordId
        ? await readCanonicalRecord(db, table, projectId, recordId)
        : await listCanonicalRecords(db, table, projectId, Number(url.searchParams.get("limit") || 100));
      if (recordId && !value) return Response.json({ error: "Canonical record not found." }, { status: 404 });
      return Response.json({ projectId, recordType: table, value }, { headers: { "cache-control": "no-store" } });
    }

    if (request.method === "POST" && !recordId) {
      if (!actionKey || request.headers.get("authorization") !== `Bearer ${actionKey}`) {
        return Response.json({ error: "Write authorization required." }, { status: 401 });
      }
      const body = await request.json() as CanonicalRow;
      const idempotencyKey = request.headers.get("idempotency-key")?.trim();
      const value = (table === "governance_events" || table === "handoffs")
        ? await createIdempotentCanonicalRecord(db, table, projectId, idempotencyKey || "", body)
        : { record: await createCanonicalRecord(db, table, projectId, body), idempotentReplay: false };
      return Response.json({ projectId, recordType: table, ...value }, { status: 201 });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canonical record request failed.";
    const status = /Invalid|Unsupported|scope|Idempotency|required/.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
