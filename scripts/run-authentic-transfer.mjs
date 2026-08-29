import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourcePath, outputDir] = process.argv.slice(2);
assert.ok(sourcePath, "frozen source-room.json path is required");
assert.ok(outputDir, "existing frozen output directory is required");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceBytes = await readFile(sourcePath);
assert.equal(
  sha256(sourceBytes),
  "ed0b9eb7b30a35146148478cfddd3985783d121bde1c841963232209f8885ca0",
  "authentic source changed after the prospective freeze",
);

const databasePath = path.join(outputDir, "canonical-local.db");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");
for (const name of [
  "0000_gray_lady_vermin.sql",
  "0001_bored_sage.sql",
  "0002_remarkable_the_executioner.sql",
  "0003_small_bromley.sql",
  "0004_odd_patriot.sql",
  "0005_amusing_turbo.sql",
  "0006_opposite_roland_deschain.sql",
  "0007_harsh_makkari.sql",
  "0008_complete_timeslip.sql",
  "0010_misty_wasp.sql",
]) {
  const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    database.exec(statement);
  }
}

function prepare(sql) {
  let values = [];
  const statement = database.prepare(sql);
  return {
    bind(...next) { values = next; return this; },
    async first() { return statement.get(...values) ?? null; },
    async all() { return { results: statement.all(...values) }; },
    async run() {
      const result = statement.run(...values);
      return { success: true, changes: Number(result.changes), meta: result };
    },
  };
}
const DB = {
  prepare,
  async batch(statements) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
};

const workerUrl = pathToFileURL(path.resolve("dist/server/index.js"));
workerUrl.searchParams.set("authentic-proof", `${process.pid}-${Date.now()}`);
const worker = (await import(workerUrl.href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = {
  DB,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  CAMPUS_ATLAS_ACTION_KEY: "local-proof-action-key",
  CAMPUS_ATLAS_OWNER_USER_ID: "local-proof-owner",
  CAMPUS_ATLAS_DEPLOYMENT_VERSION: "local-authentic-run-001",
  CAMPUS_ATLAS_SOURCE_COMMIT: "638627f",
};
const ownerHeaders = { "oai-authenticated-user-id": "local-proof-owner" };

async function request(route, { method = "GET", body, idempotencyKey } = {}) {
  const response = await worker.fetch(new Request(`http://localhost${route}`, {
    method,
    headers: {
      ...ownerHeaders,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, ctx);
  return { status: response.status, value: await response.json() };
}

const projectId = "campus-atlas-v18-authentic";
const project = await request(`/api/v1/projects/${projectId}/records/projects`, {
  method: "POST",
  body: {
    id: projectId,
    workspace_id: "local-authentic-proof",
    name: "Campus Atlas V1.8 Authentic Proof",
    owner_actor_id: "cody",
  },
});
assert.equal(project.status, 201, JSON.stringify(project.value));
const roadways = await request(`/api/v1/projects/${projectId}/roadways`);
assert.equal(roadways.status, 200, JSON.stringify(roadways.value));

const transferRequest = {
  title: "Continue Campus Atlas — authentic mature room cutoff 2026-08-29",
  format: "json",
  transcript: sourceBytes.toString("utf8"),
};
const transfer = await request(`/api/v1/projects/${projectId}/transfers`, {
  method: "POST",
  idempotencyKey: "authentic-full-transfer-run-001-source-import",
  body: transferRequest,
});

const tables = [
  "projects", "conversations", "conversation_imports", "messages", "events", "cases",
  "case_event_attachments", "reasoning_nodes", "reasoning_node_versions", "checkpoints",
  "checkpoint_reasoning_nodes", "findings", "finding_versions", "mechanisms",
  "mechanism_versions", "governance_events", "roadways", "roadway_versions", "packets",
  "packet_items", "receipts", "transfer_runs", "transfer_run_events",
];
const canonicalCounts = Object.fromEntries(tables.map((table) => [
  table,
  Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
]));
const evidence = {
  schemaVersion: 1,
  runId: "authentic-full-transfer-run-001",
  phase: "transfer_room_before_governance_or_steward",
  acceptedSourceCommit: "2764bed97db4e02e8684c05b36b103620f0bb042",
  protocolFreezeCommit: "638627f",
  source: {
    structuredImportSha256: sha256(sourceBytes),
    requestBodySha256: sha256(JSON.stringify(transferRequest)),
  },
  project: { status: project.status, value: project.value },
  roadways: { status: roadways.status, count: roadways.value.roadways?.length ?? null },
  transfer: { status: transfer.status, value: transfer.value },
  canonicalCounts,
  productionChanged: false,
};
await writeFile(path.join(outputDir, "transfer-result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
