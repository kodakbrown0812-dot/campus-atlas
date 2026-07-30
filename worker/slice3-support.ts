export type Row = Record<string, unknown>;

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,95}$/i;
const RECORD_ID_PATTERN = /^[a-z0-9][^\u0000-\u001f\u007f]{2,127}$/i;

export function assertId(value: unknown, label: string, pattern = RECORD_ID_PATTERN) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function assertProjectId(value: unknown) {
  return assertId(value, "project ID", PROJECT_ID_PATTERN);
}

export function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function stringArray(value: unknown, label: string, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  if (required && value.length === 0) throw new Error(`${label} requires at least one item.`);
  return value.map((item) => item.trim());
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function json(value: unknown) {
  return JSON.stringify(value ?? {});
}

export function now() {
  return new Date().toISOString();
}

export async function first<T extends Row>(statement: D1PreparedStatement) {
  return statement.first<T>();
}

export async function all<T extends Row>(statement: D1PreparedStatement) {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function requireProject(db: D1Database, projectId: string) {
  const project = await first<Row>(db.prepare("SELECT * FROM projects WHERE id = ? LIMIT 1").bind(projectId));
  if (!project) throw new Error("Project not found.");
  return project;
}

export async function requireConversation(db: D1Database, projectId: string, conversationId: string) {
  const conversation = await first<Row>(db.prepare(
    "SELECT * FROM conversations WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(conversationId, projectId));
  if (!conversation) throw new Error("Conversation not found.");
  return conversation;
}

export async function requireCase(db: D1Database, projectId: string, caseId: string) {
  const caseRecord = await first<Row>(db.prepare(
    "SELECT * FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(caseId, projectId));
  if (!caseRecord) throw new Error("Case not found.");
  return caseRecord;
}

export async function requireConversationCase(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId: string,
) {
  await requireConversation(db, projectId, conversationId);
  await requireCase(db, projectId, caseId);
  const link = await first<Row>(db.prepare(
    `SELECT id FROM conversation_case_links
     WHERE project_id = ? AND conversation_id = ? AND case_id = ? AND ended_at IS NULL
     LIMIT 1`,
  ).bind(projectId, conversationId, caseId));
  if (!link) throw new Error("Case must be associated with this conversation.");
}

export function authorizeWrite(request: Request, actionKey?: string) {
  if (!actionKey || request.headers.get("authorization") !== `Bearer ${actionKey}`) {
    throw new Error("Write authorization required.");
  }
}

export function requireIdempotencyKey(request: Request) {
  return requiredString(request.headers.get("idempotency-key"), "Idempotency key");
}

export function responseError(error: unknown, fallback = "Slice 3 request failed.") {
  const message = error instanceof Error ? error.message : fallback;
  if (/authorization/i.test(message)) return Response.json({ error: message }, { status: 401 });
  if (/not found/i.test(message)) return Response.json({ error: message }, { status: 404 });
  if (/current version|already governed|conflict/i.test(message)) {
    return Response.json({ error: message }, { status: 409 });
  }
  if (/required|requires|invalid|unsupported|must|cannot|does not|at most|outside|unchanged|one finding/i.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ error: message }, { status: 500 });
}
