import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourcePath, inputDatabasePath, outputDir] = process.argv.slice(2);
assert.ok(sourcePath, "frozen source-room.json path is required");
assert.ok(inputDatabasePath, "frozen atomic-comparison database path is required");
assert.ok(outputDir, "new private output directory is required");

const FROZEN_SELECTED_SOURCE_SEQUENCES = [
  32, 35, 42, 49, 61, 78, 83, 88, 89, 93, 97, 102, 103, 104, 105, 109, 110, 113, 115, 116, 117,
];
const FROZEN_CANDIDATE_ROLES = [
  "current_direction",
  "next_action",
  "constraint",
  "correction_guard",
  "rationale",
  "connection",
  "uncertainty",
  "shared_term",
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceBytes = await readFile(sourcePath);
assert.equal(
  sha256(sourceBytes),
  "ed0b9eb7b30a35146148478cfddd3985783d121bde1c841963232209f8885ca0",
  "authentic source changed after the prospective freeze",
);
const inputDatabaseBytes = await readFile(inputDatabasePath);
assert.equal(
  sha256(inputDatabaseBytes),
  "94ef0989df659acdd2620639ce12324dcbc5a8f1cf2f3f4e9c4d42907322c852",
  "frozen atomic-comparison database changed",
);
await mkdir(outputDir, { recursive: true });
const databasePath = path.join(outputDir, "canonical-local-semantic-identity.db");
await copyFile(inputDatabasePath, databasePath, fsConstants.COPYFILE_EXCL);
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");

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
workerUrl.searchParams.set("authentic-semantic-identity", `${process.pid}-${Date.now()}`);
const worker = (await import(workerUrl.href)).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = {
  DB,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  CAMPUS_ATLAS_ACTION_KEY: "local-proof-action-key",
  CAMPUS_ATLAS_OWNER_USER_ID: "local-proof-owner",
  CAMPUS_ATLAS_DEPLOYMENT_VERSION: "local-authentic-semantic-identity-repair",
  CAMPUS_ATLAS_SOURCE_COMMIT: "working-tree-authentic-semantic-identity-repair",
};

const projectId = "campus-atlas-v18-authentic";
const requestBody = {
  task: "Continue Campus Atlas V1.8 from the accepted state. What exact work should happen now, why is it next, what project truth and constraints must govern it, what remains intentionally deferred, and what evidence should make us stop rather than continue?",
  requestedOutput: "Prepare a full room transfer for a genuinely fresh destination. Preserve the current State Truth, causal rationale, corrections, supersession, constraints, open work, uncertainty, local terms, and governing connections needed for the literal task. Do not rely on source-room access or lucky reconstruction of omitted private project truth.",
  caseId: "case:transfer:e492a415a31f8cb63fd6fb5b2f36",
  tokenBudget: 800,
};
const response = await worker.fetch(new Request(
  `http://localhost/api/v1/projects/${projectId}/reconstruction/run`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-proof-action-key",
      "idempotency-key": "authentic-full-transfer-run-001-semantic-identity-repair",
    },
    body: JSON.stringify(requestBody),
  },
), env, ctx);
const value = await response.json();
assert.equal(response.status, 201, JSON.stringify(value));

const checkpoint = database.prepare(
  "SELECT id, extraction_version, metadata FROM checkpoints WHERE project_id = ? ORDER BY rowid DESC LIMIT 1",
).get(projectId);
const checkpointMetadata = JSON.parse(checkpoint.metadata);
const allTreatments = Object.values(value.receipt.treatmentSummary).flat();
const semanticIdentityItems = allTreatments.filter((item) => item.metadata?.semanticIdentityDependency);
const packetItems = database.prepare(
  "SELECT source_type, source_id, source_version_id, treatment FROM packet_items WHERE project_id = ? AND packet_id = ? ORDER BY sequence_order",
).all(projectId, value.packet.id);

const mechanismLineage = [];
for (const item of packetItems.filter((candidate) => candidate.source_type === "Mechanism" && candidate.treatment === "Use")) {
  const mechanism = database.prepare(
    "SELECT source_finding_id, current_governing_version_id FROM mechanisms WHERE project_id = ? AND id = ?",
  ).get(projectId, item.source_id);
  const finding = database.prepare(
    "SELECT current_version_id, source_event_ids FROM findings WHERE project_id = ? AND id = ?",
  ).get(projectId, mechanism.source_finding_id);
  const exactSources = JSON.parse(finding.source_event_ids).map((eventId) => {
    const event = database.prepare(
      "SELECT exact_source_span, source_message_ids FROM events WHERE project_id = ? AND id = ?",
    ).get(projectId, eventId);
    const messageId = JSON.parse(event.source_message_ids)[0];
    const message = database.prepare(
      "SELECT sequence_number, exact_content, content_hash FROM messages WHERE project_id = ? AND id = ?",
    ).get(projectId, messageId);
    return {
      eventId,
      messageId,
      sequence: message.sequence_number,
      contentHash: message.content_hash,
      exactBytesMatch: Buffer.from(event.exact_source_span).equals(Buffer.from(message.exact_content)),
    };
  });
  mechanismLineage.push({
    mechanismId: item.source_id,
    mechanismVersionId: mechanism.current_governing_version_id,
    findingId: mechanism.source_finding_id,
    findingVersionId: finding.current_version_id,
    exactSources,
    complete: exactSources.length > 0 && exactSources.every((source) => source.exactBytesMatch),
  });
}

const exactIdentityEvidence = semanticIdentityItems
  .filter((item) => item.sourceType === "Event" && item.treatment === "Use")
  .map((item) => {
    const event = database.prepare(
      "SELECT exact_source_span, source_message_ids FROM events WHERE project_id = ? AND id = ?",
    ).get(projectId, item.sourceId);
    const messageId = JSON.parse(event.source_message_ids)[0];
    const message = database.prepare(
      "SELECT sequence_number, exact_content, content_hash FROM messages WHERE project_id = ? AND id = ?",
    ).get(projectId, messageId);
    return {
      eventId: item.sourceId,
      messageId,
      sequence: message.sequence_number,
      contentHash: message.content_hash,
      exactBytesMatch: Buffer.from(event.exact_source_span).equals(Buffer.from(message.exact_content)),
      identity: item.metadata.semanticIdentityDependency,
    };
  });

assert.equal(value.packet.status, "compiled");
assert.equal(value.packet.finalTokenCount, 791);
assert.equal(value.need.level, "full");
assert.equal(value.roadway.id, null);
assert.deepEqual(checkpointMetadata.eventSelection.selectedSourceSequences, FROZEN_SELECTED_SOURCE_SEQUENCES);
assert.equal(checkpoint.extraction_version, "slice3-mature-coverage-v1");
assert.equal(checkpointMetadata.candidateConstruction.version, "slice3-mature-relationships-v4");
assert.equal(checkpointMetadata.candidateConstruction.candidateCount, 8);
assert.deepEqual(checkpointMetadata.candidateConstruction.rolesRepresented, FROZEN_CANDIDATE_ROLES);
assert.equal(
  sha256(JSON.stringify(checkpointMetadata.candidateConstruction.candidateStateValidity)),
  "881a10cd2572b053703c674dfd46296cb523cee4b236f38bf3430abb6ebe26a2",
  "candidate state-validity behavior changed",
);
assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get(projectId).count), 8);
assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM governance_events WHERE project_id = ?").get(projectId).count), 8);
assert.deepEqual(value.receipt.treatmentCounts, { Use: 9, Consider: 70, Exclude: 119 });
assert.equal(value.receipt.unresolvedConflicts.length, 1);
assert.match(value.receipt.unresolvedConflicts[0].statement, /2764bed97db4e02e8684c05b36b103620f0bb042/u);
assert.match(value.receipt.unresolvedConflicts[0].statement, /2764bed97db4e02e8684c05b36b103620f0bb942/u);
assert.equal(mechanismLineage.length, 8);
assert.ok(mechanismLineage.every((item) => item.complete));
assert.equal(exactIdentityEvidence.length, 1);
assert.equal(exactIdentityEvidence[0].sequence, 116);
assert.equal(exactIdentityEvidence[0].exactBytesMatch, true);

const evidence = {
  schemaVersion: 1,
  runId: "authentic-full-transfer-run-001",
  phase: "semantic_identity_dependency_pipeline_rerun",
  frozenInputs: {
    sourceSha256: sha256(sourceBytes),
    inputDatabaseSha256: sha256(inputDatabaseBytes),
    requestBodySha256: sha256(JSON.stringify(requestBody)),
  },
  checkpoint: {
    id: checkpoint.id,
    extractionVersion: checkpoint.extraction_version,
    selectedSourceSequences: checkpointMetadata.eventSelection.selectedSourceSequences,
    candidateConstruction: {
      version: checkpointMetadata.candidateConstruction.version,
      candidateCount: checkpointMetadata.candidateConstruction.candidateCount,
      rolesRepresented: checkpointMetadata.candidateConstruction.rolesRepresented,
      candidateStateValidity: checkpointMetadata.candidateConstruction.candidateStateValidity,
    },
  },
  canonicalState: {
    governedMechanisms: Number(database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get(projectId).count),
    governanceEvents: Number(database.prepare("SELECT COUNT(*) AS count FROM governance_events WHERE project_id = ?").get(projectId).count),
  },
  result: {
    status: value.status,
    need: value.need,
    roadway: value.roadway,
    packet: value.packet,
    summary: value.summary,
    treatmentCounts: value.receipt.treatmentCounts,
    unresolvedConflicts: value.receipt.unresolvedConflicts,
    semanticIdentityItems,
    packetItems,
    mechanismLineage,
    exactIdentityEvidence,
  },
  hashes: {
    compiledContentSha256: sha256(value.packet.compiledContent),
    packetJsonSha256: sha256(JSON.stringify(value.packet)),
    receiptJsonSha256: sha256(JSON.stringify(value.receipt)),
  },
  destinationRerun: false,
  productionChanged: false,
};

await writeFile(
  path.join(outputDir, "steward-result-after-semantic-identity-repair.json"),
  `${JSON.stringify({ schemaVersion: 1, request: requestBody, response: { status: response.status, value } }, null, 2)}\n`,
);
await writeFile(
  path.join(outputDir, "semantic-identity-pipeline-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
database.close();
process.stdout.write(`${JSON.stringify({
  phase: evidence.phase,
  packetStatus: value.packet.status,
  packetEstimatedTokens: value.packet.finalTokenCount,
  compiledContentSha256: evidence.hashes.compiledContentSha256,
  selectedSourceSequences: evidence.checkpoint.selectedSourceSequences,
  governedMechanisms: evidence.canonicalState.governedMechanisms,
  applicableRoadways: value.roadway.id ? 1 : 0,
  unresolvedConflicts: value.receipt.unresolvedConflicts,
  semanticIdentityItems: semanticIdentityItems.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    treatment: item.treatment,
    representation: item.representation,
    semanticIdentityDependency: item.metadata.semanticIdentityDependency,
  })),
  mechanismLineageComplete: mechanismLineage.filter((item) => item.complete).length,
  mechanismLineageTotal: mechanismLineage.length,
  exactIdentityEvidence,
  outputDir,
  destinationRerun: false,
  productionChanged: false,
}, null, 2)}\n`);
