export const AUTHORITY_STATES = [
  "observed", "inferred", "proposed", "under_review", "approved_local",
  "approved_project_wide", "approved_cross_project", "challenged",
  "superseded", "retired", "rejected",
] as const;

export const CANONICAL_RECORD_TYPES = [
  "projects", "conversations", "conversation_imports", "messages", "events", "cases",
  "conversation_case_links", "case_event_attachments", "case_boundary_proposals",
  "case_boundary_operations", "reasoning_nodes", "reasoning_node_versions",
  "findings", "finding_versions", "mechanisms", "mechanism_versions",
  "governance_events", "roadways", "roadway_versions", "packets",
  "packet_items", "receipts", "handoffs",
] as const;

export type CanonicalRecordType = typeof CANONICAL_RECORD_TYPES[number];
type CanonicalRow = Record<string, unknown> & { id: string; project_id?: string };

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,95}$/i;
const RECORD_ID_PATTERN = /^[a-z0-9][^\u0000-\u001f\u007f]{2,127}$/i;
const tableNames = new Set<string>(CANONICAL_RECORD_TYPES);
const SLICE_2_DOMAIN_WRITES = new Set<CanonicalRecordType>([
  "conversations",
  "conversation_imports",
  "messages",
  "events",
  "cases",
  "conversation_case_links",
  "case_event_attachments",
  "case_boundary_proposals",
  "case_boundary_operations",
]);
const ORDER_COLUMNS: Record<CanonicalRecordType, string> = {
  projects: "created_at",
  conversations: "created_at",
  conversation_imports: "imported_at",
  messages: "ingested_at",
  events: "ingested_at",
  cases: "created_at",
  conversation_case_links: "created_at",
  case_event_attachments: "created_at",
  case_boundary_proposals: "created_at",
  case_boundary_operations: "created_at",
  reasoning_nodes: "created_at",
  reasoning_node_versions: "created_at",
  findings: "created_at",
  finding_versions: "created_at",
  mechanisms: "created_at",
  mechanism_versions: "created_at",
  governance_events: "created_at",
  roadways: "created_at",
  roadway_versions: "created_at",
  packets: "created_at",
  packet_items: "sequence_order",
  receipts: "created_at",
  handoffs: "handoff_at",
};

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
  const result = await db.prepare(`SELECT * FROM ${table} WHERE ${scope} ORDER BY ${ORDER_COLUMNS[table]} DESC LIMIT ?`).bind(projectId, safeLimit).all<CanonicalRow>();
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
      if (SLICE_2_DOMAIN_WRITES.has(table as CanonicalRecordType)) {
        return Response.json({
          error: "This record type is owned by the Slice 2 conversation and case APIs.",
        }, { status: 409 });
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
