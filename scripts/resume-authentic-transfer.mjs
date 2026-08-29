import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourcePath, outputDir] = process.argv.slice(2);
assert.ok(sourcePath, "frozen source-room.json path is required");
assert.ok(outputDir, "frozen output directory is required");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceBytes = await readFile(sourcePath);
assert.equal(sha256(sourceBytes), "ed0b9eb7b30a35146148478cfddd3985783d121bde1c841963232209f8885ca0");
const databasePath = path.join(outputDir, "canonical-local.db");
const database = new DatabaseSync(databasePath);

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
workerUrl.searchParams.set("authentic-candidate-reuse-resume", `${process.pid}-${Date.now()}`);
const worker = (await import(workerUrl.href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = {
  DB,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  CAMPUS_ATLAS_ACTION_KEY: "local-proof-action-key",
  CAMPUS_ATLAS_OWNER_USER_ID: "local-proof-owner",
  CAMPUS_ATLAS_DEPLOYMENT_VERSION: "local-authentic-candidate-reuse-repair",
  CAMPUS_ATLAS_SOURCE_COMMIT: "working-tree-authentic-candidate-reuse-repair",
};
const ownerHeaders = { "oai-authenticated-user-id": "local-proof-owner" };
async function request(route, { method = "GET", idempotencyKey } = {}) {
  const response = await worker.fetch(new Request(`http://localhost${route}`, {
    method,
    headers: {
      ...ownerHeaders,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
  }), env, ctx);
  return { status: response.status, value: await response.json() };
}

const projectId = "campus-atlas-v18-authentic";
const transferId = "transfer-room:c480dbbf1d71dd9b1195e03d3ef32547";
const transfer = await request(
  `/api/v1/projects/${projectId}/transfers/${encodeURIComponent(transferId)}/resume`,
  { method: "POST", idempotencyKey: "authentic-full-transfer-run-001-candidate-reuse-repair-resume" },
);
const checkpoint = transfer.value?.conversationId && transfer.value?.caseId
  ? await request(`/api/v1/projects/${projectId}/checkpoints/latest?conversationId=${encodeURIComponent(transfer.value.conversationId)}&caseId=${encodeURIComponent(transfer.value.caseId)}`)
  : null;
const counts = Object.fromEntries([
  "conversations", "conversation_imports", "messages", "events", "cases", "case_event_attachments",
  "checkpoints", "checkpoint_reasoning_nodes", "findings", "finding_versions", "mechanisms",
  "mechanism_versions", "governance_events", "packets", "packet_items", "receipts", "transfer_runs",
].map((table) => [table, Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
const evidence = {
  schemaVersion: 1,
  runId: "authentic-full-transfer-run-001",
  phase: "pre_governance_after_mature_room_candidate_reuse_repair",
  sourceSha256: sha256(sourceBytes),
  transfer,
  checkpoint,
  canonicalCounts: counts,
  productionChanged: false,
};
const evidencePath = path.join(outputDir, "transfer-result-after-candidate-reuse-repair.json");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  runId: evidence.runId,
  phase: evidence.phase,
  sourceSha256: evidence.sourceSha256,
  transferStatus: transfer.status,
  transferStage: transfer.value?.stage,
  actualCounts: transfer.value?.actualCounts,
  checkpointId: checkpoint?.value?.result?.checkpoint?.id,
  evidencePath,
  productionChanged: false,
}, null, 2)}\n`);
