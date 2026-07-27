import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const developmentPreviewMeta = /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

function memoryD1() {
  const rows = new Map();
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return /SELECT payload/i.test(sql) ? rows.get(values[0]) ?? null : null; },
        async run() { if (/INSERT INTO atlas_state/i.test(sql)) rows.set(values[0], { payload: values[1], updated_at: new Date().toISOString() }); return { success: true }; },
      };
    },
  };
}

function canonicalMemoryD1() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() {
          const name = sql.match(/FROM\s+([a-z_]+)/i)?.[1];
          if (!name) return null;
          if (/idempotency_key\s*=\s*\?/i.test(sql)) {
            return table(name).find((row) => row.project_id === values[0] && row.idempotency_key === values[1]) ?? null;
          }
          return table(name).find((row) => row.id === values[0] && (name === "projects" ? row.id : row.project_id) === values[1]) ?? null;
        },
        async all() {
          const name = sql.match(/FROM\s+([a-z_]+)/i)?.[1];
          return { results: name ? table(name).filter((row) => (name === "projects" ? row.id : row.project_id) === values[0]).slice(0, values[1]) : [] };
        },
        async run() {
          const name = sql.match(/INSERT INTO\s+([a-z_]+)/i)?.[1];
          const columns = sql.match(/\(([^)]+)\)\s+VALUES/i)?.[1].split(",").map((value) => value.trim());
          if (name && columns) table(name).push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
          return { success: true };
        },
      };
    },
  };
}

async function sqliteD1() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of ["0000_gray_lady_vermin.sql", "0001_bored_sage.sql", "0002_remarkable_the_executioner.sql"]) {
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
  return {
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
    database,
  };
}

async function builtWorker(suffix) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(suffix, `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const ctx = { waitUntil() {}, passThroughOnException() {} };
const assets = { fetch: async () => new Response("Not found", { status: 404 }) };

function seedState({ approvedSignal = false, blueprintSignal = false, transferApproved = false } = {}) {
  const signalStatus = approvedSignal ? "approved" : "pending";
  return {
    schemaVersion: 46,
    nodes: [
      { id: "case-england-ghana", project: "sports", type: "decision", title: "England vs Ghana", summary: "England were a heavy favorite but finished 0-0 against a defensive wall.", status: "challenged", level: "Observation", sources: ["Exact result"], sourceFidelity: 99, reconstructionValue: 94, lineage: ["Thesis", "0-0 outcome", "Audit"], metadata: { Sport: "Soccer", "Market type": "Handicap + total", Mechanism: "Defensive-wall signal separation" } },
      { id: "knowledge-signal-separation", project: "sports", type: "principle", title: "Separate dominance signals from market coverage", summary: "Favorite strength, territorial control, scoring probability, and handicap coverage can diverge.", status: signalStatus, level: "Validated Principle", sources: ["England-Ghana audit"], sourceFidelity: 91, reconstructionValue: 98, lineage: ["England-Ghana", "Outcome", "Audit", approvedSignal ? "Human approval" : "Pending"], metadata: { Sport: "Soccer", "Market type": "Handicap + total", Mechanism: "Defensive-wall signal separation" } },
      { id: "knowledge-workload", project: "sports", type: "principle", title: "Workload stability gates strikeout overs", summary: "Verify pitcher workload before pricing strikeouts.", status: "approved", level: "Validated Principle", sources: ["MLB cases"], sourceFidelity: 88, reconstructionValue: 90, lineage: ["Pitcher cases", "Human approval"], metadata: { Sport: "Baseball", "Market type": "Player prop", Mechanism: "Workload constraint" } },
      { id: "knowledge-market", project: "sports", type: "correction", title: "Verify the offered market", summary: "Confirm available markets before pricing value.", status: "approved", level: "Observation", sources: ["User correction"], sourceFidelity: 99, reconstructionValue: 82, lineage: ["Correction", "Approval"], metadata: { "Market type": "Availability", Mechanism: "Reality correction" } },
      { id: "case-hockey", project: "hockey", type: "decision", title: "Overexerting on unwinnable pucks", summary: "Maximum effort did not always create control or a useful next action.", status: "approved", level: "Observation", sources: ["Game reflection"], sourceFidelity: 90, reconstructionValue: 91, lineage: ["Game", "Reflection"], metadata: { Sport: "Hockey", Mechanism: "Effort-control-outcome separation" } },
      ...(transferApproved ? [{ id: "knowledge-hockey-effort-control", project: "hockey", type: "principle", title: "Separate effort, control, and expected outcome", summary: "Pressure when effort can create control or a useful next action.", status: "approved", level: "Validated Principle", sources: ["Approved adaptation"], sourceFidelity: 82, reconstructionValue: 93, lineage: ["Sports mechanism", "Hockey evidence", "Human adaptation"], metadata: { Sport: "Hockey", Mechanism: "Effort-control-outcome separation", Origin: "Approved cross-project adaptation" } }] : []),
    ],
    blueprintRules: [
      { id: "bp-base", project: "sports", status: "Active", version: "V4.6", content: "Classify facts, estimates, assumptions, and unknowns before assigning confidence." },
      { id: "bp-market", project: "sports", status: "Active", version: "V4.6", content: "Verify the currently offered market before calculating value." },
      { id: "bp-signal", project: "sports", status: blueprintSignal ? "Active" : "Proposed", version: blueprintSignal ? "V4.6.1" : "V4.6.1 proposed", content: "Separate favorite strength, territorial control, scoring probability, and handicap coverage." },
      { id: "bp-hockey", project: "hockey", status: "Active", version: "V2.2", content: "Prioritize game-transfer value under pressure." },
    ],
    connections: [
      { id: "path-effort", project: "campus", sourceId: "knowledge-signal-separation", targetId: "case-hockey", type: "Proposed for transfer", sharedMechanism: "Separate effort or strength from control and expected outcome", evidenceIds: ["england-audit", "hockey-reflection"], approvalState: transferApproved ? "Approved" : "Pending", domainLimitations: "Sports prediction and hockey performance are different domains." },
      { id: "path-keyword", project: "campus", sourceId: "knowledge-market", targetId: "case-hockey", type: "Proposed for transfer", sharedMechanism: "None established", evidenceIds: [], approvalState: "Rejected", domainLimitations: "Market coverage and defensive coverage are unrelated meanings." },
    ],
    reviews: [], cases: [], evidence: [], knowledge: [], activities: [], contextPackets: [], proofBaseline: null,
  };
}

async function saveState(worker, DB, state, workspaceId = "") {
  return worker.fetch(new Request(`http://localhost/api/state?replace=true${workspaceId ? `&workspaceId=${workspaceId}` : ""}`, { method: "POST", headers: { "content-type": "application/json", ...(workspaceId ? { "x-atlas-workspace": workspaceId } : {}) }, body: JSON.stringify({ ...state, workspaceId }) }), { DB, ASSETS: assets }, ctx);
}

async function context(worker, DB, body, extraEnv = {}) {
  const response = await worker.fetch(new Request("http://localhost/api/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { DB, ASSETS: assets, ...extraEnv }, ctx);
  assert.equal(response.status, 200);
  return response.json();
}

const slice2Headers = {
  "content-type": "application/json",
  authorization: "Bearer slice-2-test-key",
};

async function slice2Request(worker, DB, path, { method = "GET", body, idempotencyKey } = {}) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : slice2Headers),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key" }, ctx);
  const value = await response.json();
  return { response, value };
}

async function seedCanonicalProject(worker, DB, id, name) {
  const result = await slice2Request(worker, DB, `/api/v1/projects/${id}/records/projects`, {
    method: "POST",
    body: { id, workspace_id: "primary-campus", name, owner_actor_id: "cody" },
  });
  assert.equal(result.response.status, 201);
}

test("renders the development preview", async () => {
  const worker = await builtWorker("render");
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets }, ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), developmentPreviewMeta);
});

test("Slice 1 canonical API enforces project scope and idempotent writes", async () => {
  const worker = await builtWorker("canonical-records");
  const DB = canonicalMemoryD1();
  const env = { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "slice-1-test-key" };
  const writeHeaders = { "content-type": "application/json", authorization: "Bearer slice-1-test-key" };

  const createProject = await worker.fetch(new Request("http://localhost/api/v1/projects/sports/records/projects", {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({ id: "sports", workspace_id: "primary-campus", name: "Sports Engine", owner_actor_id: "cody" }),
  }), env, ctx);
  assert.equal(createProject.status, 201);

  const project = await worker.fetch(new Request("http://localhost/api/v1/projects/sports/records/projects/sports"), env, ctx);
  assert.equal(project.status, 200);
  assert.equal((await project.json()).value.name, "Sports Engine");

  const otherProject = await worker.fetch(new Request("http://localhost/api/v1/projects/hockey/records/projects/sports"), env, ctx);
  assert.equal(otherProject.status, 404);

  const governanceBody = {
    id: "gov:approval-1",
    project_id: "sports",
    actor_id: "cody",
    action: "approve",
    target_type: "mechanism",
    target_id: "mechanism:margin",
    retrieval_effect: "eligible_project_wide",
  };
  const governanceRequest = () => new Request("http://localhost/api/v1/projects/sports/records/governance_events", {
    method: "POST",
    headers: { ...writeHeaders, "idempotency-key": "approve-margin-v1" },
    body: JSON.stringify(governanceBody),
  });
  assert.equal((await worker.fetch(governanceRequest(), env, ctx)).status, 201);
  const replay = await worker.fetch(governanceRequest(), env, ctx);
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).idempotentReplay, true);

  const crossProject = await worker.fetch(new Request("http://localhost/api/v1/projects/hockey/records/governance_events", {
    method: "POST",
    headers: { ...writeHeaders, "idempotency-key": "bad-scope" },
    body: JSON.stringify(governanceBody),
  }), env, ctx);
  assert.equal(crossProject.status, 400);
});

test("Slice 1 migration contains normalized records without replacing atlas_state", async () => {
  const migration = await readFile(new URL("../drizzle/0001_bored_sage.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const classification = await readFile(new URL("../worker/legacy-classification.ts", import.meta.url), "utf8");
  for (const name of [
    "projects", "conversations", "messages", "events", "cases", "case_event_attachments",
    "reasoning_nodes", "reasoning_node_versions", "findings", "finding_versions",
    "mechanisms", "mechanism_versions", "governance_events", "roadways",
    "roadway_versions", "packets", "packet_items", "receipts", "handoffs",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE .${name}.`));
  }
  assert.match(schema, /export const atlasState/);
  assert.match(classification, /verified_canonical_history/);
  assert.match(classification, /unverified_proposal/);
});

test("Slice 2 native and imported conversations share one immutable source model", async () => {
  const worker = await builtWorker("slice2-conversation-model");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");

  const native = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Native margin discussion", provenance: { source: "campus_atlas_native" } },
  });
  assert.equal(native.response.status, 201);
  assert.equal(native.value.conversation.sourceType, "native");
  const nativeId = native.value.conversation.id;
  const appended = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${nativeId}/messages`, {
    method: "POST",
    idempotencyKey: "native-message-1",
    body: {
      actorType: "user",
      actorId: "cody",
      content: "Do not trim this message.  \nThe spacing is source.",
      originalTimestamp: "2026-07-01T12:00:00-05:00",
    },
  });
  assert.equal(appended.response.status, 201);
  const appendReplay = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${nativeId}/messages`, {
    method: "POST",
    idempotencyKey: "native-message-1",
    body: { actorType: "user", content: "ignored replay content" },
  });
  assert.equal(appendReplay.response.status, 200);
  assert.equal(appendReplay.value.idempotentReplay, true);
  const repeatedContent = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${nativeId}/messages`, {
    method: "POST",
    idempotencyKey: "native-message-2",
    body: {
      actorType: "user",
      actorId: "cody",
      content: "Do not trim this message.  \nThe spacing is source.",
    },
  });
  assert.equal(repeatedContent.response.status, 201);
  assert.equal(repeatedContent.value.message.sequence, 2);

  const rawStructured = JSON.stringify({
    messages: [
      { id: "m-1", role: "user", content: "Brewers?  I’m not cleaning this typo...\nfirst-five or -1.5?", timestamp: "2026-07-02T09:01:00-05:00" },
      { id: "m-2", role: "assistant", content: "Price matters.\n\nKeep the uncertainty.", timestamp: "2026-07-02T09:02:00-05:00" },
    ],
  }, null, 2);
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "structured-import-1",
    body: {
      format: "json",
      title: "Imported source",
      sourceName: "explicit-user-export.json",
      transcript: rawStructured,
      provenance: { suppliedBy: "cody" },
    },
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.value.conversation.sourceType, "imported");
  assert.equal(imported.value.import.messageCount, 2);
  assert.equal(imported.value.import.diagnostics.exactEnvelopePreserved, true);
  const importedId = imported.value.conversation.id;

  const duplicate = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "different-key-same-source",
    body: { format: "json", title: "Duplicate", transcript: rawStructured },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.value.idempotentReplay, true);
  assert.equal(duplicate.value.duplicateReason, "exact_source_hash");
  assert.equal(duplicate.value.conversation.id, importedId);

  const refreshedNative = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${nativeId}`);
  assert.equal(refreshedNative.value.messages.length, 2);
  assert.equal(refreshedNative.value.messages[0].exactContent, "Do not trim this message.  \nThe spacing is source.");
  assert.equal(refreshedNative.value.messages[0].originalTimestamp, "2026-07-01T12:00:00-05:00");
  const refreshedImport = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${importedId}`);
  assert.equal(refreshedImport.value.messages[0].exactContent, "Brewers?  I’m not cleaning this typo...\nfirst-five or -1.5?");
  const source = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${importedId}/source`);
  assert.equal(source.value.imports[0].rawSource, rawStructured);
  const genericRead = await slice2Request(worker, DB, "/api/v1/projects/sports/records/messages");
  assert.equal(genericRead.response.status, 200);
  assert.equal(genericRead.value.value.length, 4);
  const genericWrite = await slice2Request(worker, DB, "/api/v1/projects/sports/records/messages", {
    method: "POST",
    body: {
      id: "message:generic-bypass",
      project_id: "sports",
      conversation_id: importedId,
      sequence_number: 99,
      actor_type: "unknown",
      exact_content: "bypass",
      content_hash: "not-canonical",
    },
  });
  assert.equal(genericWrite.response.status, 409);

  assert.throws(
    () => DB.database.prepare("UPDATE messages SET exact_content = 'mutated' WHERE conversation_id = ?").run(importedId),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("DELETE FROM conversation_imports WHERE conversation_id = ?").run(importedId),
    /immutable/i,
  );
});

test("Slice 2 migration is additive and enforces immutable source records", async () => {
  const migration = await readFile(new URL("../drizzle/0002_remarkable_the_executioner.sql", import.meta.url), "utf8");
  for (const name of [
    "conversation_imports",
    "conversation_case_links",
    "case_boundary_proposals",
    "case_boundary_operations",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE .${name}.`));
  }
  assert.match(migration, /ADD `assignment_state`/);
  assert.match(migration, /messages_immutable_update/);
  assert.match(migration, /messages_immutable_delete/);
  assert.match(migration, /conversation_imports_immutable_update/);
  assert.match(migration, /WHERE "conversation_case_links"\."ended_at" IS NULL/);
  assert.doesNotMatch(migration, /DROP TABLE `atlas_state`/);
});

test("Slice 2 text imports preserve the raw envelope and diagnose their parser", async () => {
  const worker = await builtWorker("slice2-text-import");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const raw = "Cody: broad slate first\nstill broad  \nAmy: compare first-five and −1.5\nDo not normalize − or whitespace.";
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "text-import-1",
    body: { format: "text", title: "Text envelope", transcript: raw },
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.value.import.messageCount, 2);
  assert.equal(imported.value.import.diagnostics.parser, "slice2-text-v1");
  const source = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${imported.value.conversation.id}/source`);
  assert.equal(source.value.imports[0].rawSource, raw);
});

test("Slice 2 preserves the Brewers reconstruction as one honest, project-scoped source artifact", async () => {
  const worker = await builtWorker("slice2-brewers-reconstruction");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");
  const fixture = await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.txt", import.meta.url),
    "utf8",
  );
  const fixtureContract = JSON.parse(await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.json", import.meta.url),
    "utf8",
  ));
  const calculatedHash = createHash("sha256").update(fixture, "utf8").digest("hex");
  assert.equal(calculatedHash, fixtureContract.sha256);
  assert.equal(Buffer.byteLength(fixture, "utf8"), fixtureContract.byteLength);
  assert.equal(fixtureContract.rawTranscriptAvailable, false);

  const importBody = {
    format: "text",
    title: fixtureContract.caseObjective,
    sourceName: fixtureContract.sourceName,
    sourceType: fixtureContract.sourceType,
    representationType: fixtureContract.representationType,
    authorityState: fixtureContract.authorityState,
    importId: fixtureContract.importId,
    transcript: fixture,
    provenance: {
      ...fixtureContract.provenance,
      authorityDescription: fixtureContract.authorityDescription,
      fixtureId: fixtureContract.fixtureId,
    },
    metadata: {
      sourceLayer: "governed_structured_reconstruction",
      rawSourceLayerAvailable: false,
    },
  };
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: fixtureContract.idempotencyKey,
    body: importBody,
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.value.conversation.projectId, fixtureContract.project.id);
  assert.equal(imported.value.conversation.sourceType, fixtureContract.sourceType);
  assert.equal(imported.value.import.importId, fixtureContract.importId);
  assert.equal(imported.value.import.sourceType, fixtureContract.sourceType);
  assert.equal(imported.value.import.representationType, fixtureContract.representationType);
  assert.equal(imported.value.import.authorityState, fixtureContract.authorityState);
  assert.equal(imported.value.import.contentHash, fixtureContract.sha256);
  assert.equal(imported.value.import.messageCount, fixtureContract.expectedMessageCount);
  assert.equal(imported.value.import.provenance.originalRawTranscriptAvailable, false);
  assert.equal(imported.value.import.provenance.notExactTranscript, true);
  const conversationId = imported.value.conversation.id;

  const associatedCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: fixtureContract.caseObjective,
      conversationId,
      makeActive: true,
      actorId: "cody",
      caseCore: {
        sourceLayer: "governed_structured_reconstruction",
        rawSourceLayerAvailable: false,
      },
    },
  });
  assert.equal(associatedCase.response.status, 201);
  const refreshed = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.value.messages.length, 1);
  assert.equal(refreshed.value.messages[0].exactContent, fixture);
  assert.equal(refreshed.value.messages[0].actorType, "unknown");
  assert.equal(refreshed.value.messages[0].metadata.representationType, fixtureContract.representationType);
  assert.equal(refreshed.value.conversation.activeCaseId, associatedCase.value.case.id);
  assert.deepEqual(refreshed.value.cases.map((record) => record.id), [associatedCase.value.case.id]);

  const source = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/source`,
  );
  assert.equal(source.response.status, 200);
  assert.equal(source.value.imports.length, 1);
  assert.equal(source.value.imports[0].rawSource, fixture);
  assert.equal(source.value.imports[0].contentHash, fixtureContract.sha256);
  assert.equal(source.value.imports[0].sourceType, fixtureContract.sourceType);
  assert.equal(source.value.imports[0].representationType, fixtureContract.representationType);
  assert.equal(source.value.imports[0].authorityState, fixtureContract.authorityState);
  assert.equal(source.value.imports[0].provenance.suppliedBy, "Cody");
  assert.match(source.value.imports[0].importedAt, /^\d{4}-\d{2}-\d{2}T/);

  const duplicate = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "brewers-user-reconstruction-same-bytes-v2",
    body: importBody,
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.value.idempotentReplay, true);
  assert.equal(duplicate.value.duplicateReason, "exact_source_hash");
  assert.equal(duplicate.value.conversation.id, conversationId);
  assert.equal(DB.database.prepare(
    "SELECT COUNT(*) AS count FROM messages WHERE project_id = ? AND conversation_id = ?",
  ).get("sports", conversationId).count, 1);
  assert.equal(DB.database.prepare(
    "SELECT COUNT(*) AS count FROM conversation_imports WHERE project_id = ? AND conversation_id = ?",
  ).get("sports", conversationId).count, 1);

  const crossProject = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(crossProject.response.status, 404);
  for (const table of ["events", "reasoning_nodes", "findings", "mechanisms", "governance_events"]) {
    assert.equal(
      DB.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get("sports").count,
      0,
      `${table} must not be inferred or promoted from the reconstruction fixture`,
    );
  }
  const attemptedPromotion = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "brewers-unreviewed-authority-attempt",
    body: {
      format: "text",
      title: "Unreviewed authority attempt",
      transcript: "A supplied artifact cannot approve itself.",
      authorityState: "approved_project_wide",
    },
  });
  assert.equal(attemptedPromotion.response.status, 400);
  assert.throws(
    () => DB.database.prepare("UPDATE conversation_imports SET raw_source = 'rewritten' WHERE conversation_id = ?").run(conversationId),
    /immutable/i,
  );
});

test.skip("PENDING raw Brewers: exact raw transcript import");
test.skip("PENDING raw Brewers: exact user and assistant message sequence preservation");
test.skip("PENDING raw Brewers: exact source-span links into the original conversation");
test.skip("PENDING raw Brewers: reconstruction generated independently from the raw conversation");
test.skip("PENDING raw Brewers: Atlas reconstruction compared with Cody's canonical reconstruction");

test("Slice 2 events can remain unassigned or chat-only and resolve exact message spans", async () => {
  const worker = await builtWorker("slice2-event-source");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Exact source test" },
  });
  const conversationId = conversation.value.conversation.id;
  const content = "Raw team quality is not the same as run-line value.";
  const message = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}/messages`, {
    method: "POST",
    idempotencyKey: "source-message",
    body: { actorType: "user", actorId: "cody", content },
  });
  const messageId = message.value.message.id;
  const start = content.indexOf("run-line");
  const exactSourceSpan = content.slice(start, start + "run-line value".length);
  const unassigned = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      type: "thesis",
      assignmentState: "unassigned",
      exactSourceSpan,
      sourceSpans: [{ messageId, start, end: start + exactSourceSpan.length }],
    },
  });
  assert.equal(unassigned.response.status, 201);
  assert.equal(unassigned.value.event.caseId, null);
  assert.equal(unassigned.value.event.assignmentState, "unassigned");
  assert.equal(unassigned.value.event.sourceLinks[0].href, `#message-${encodeURIComponent(messageId)}`);

  const chatOnly = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      type: "context",
      assignmentState: "chat_only",
      exactSourceSpan: "Raw team quality",
      sourceSpans: [{ messageId, start: 0, end: "Raw team quality".length }],
    },
  });
  assert.equal(chatOnly.response.status, 201);
  assert.equal(chatOnly.value.event.assignmentState, "chat_only");

  const invalidSpan = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      type: "correction",
      assignmentState: "unassigned",
      exactSourceSpan: "fabricated source",
      sourceSpans: [{ messageId, start: 0, end: 4 }],
    },
  });
  assert.equal(invalidSpan.response.status, 400);

  const crossProject = await slice2Request(worker, DB, `/api/v1/projects/hockey/conversations/${conversationId}`);
  assert.equal(crossProject.response.status, 404);
});

test("Slice 2 preserves canonical IDs while encoding route and fragment boundaries", async () => {
  const worker = await builtWorker("slice2-reserved-id-links");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversationId = "conversation:source / v1?mode=exact#anchor&scope=case";
  const messageId = "message:source / v1?part=1#exact&raw=true";
  const caseId = "case:margin / v1?draft=yes#case&owner=Cody";
  const eventId = "event:source / v1?kind=context#exact&state=raw";
  const sourceSpanId = "source-span:message / v1?chars=:/?#[]@!$&'()*+,;=";
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { id: conversationId, title: "Reserved ID contract" },
  });
  assert.equal(conversation.value.conversation.id, conversationId);
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "reserved-message",
      body: { id: messageId, actorType: "user", content: "exact source" },
    },
  );
  assert.equal(message.value.message.id, messageId);
  const createdCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { id: caseId, objective: "Reserved route ID", conversationId },
  });
  assert.equal(createdCase.value.case.id, caseId);

  const fetchedConversation = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(fetchedConversation.response.status, 200);
  assert.equal(fetchedConversation.value.conversation.id, conversationId);
  assert.equal(fetchedConversation.value.messages[0].id, messageId);
  const fetchedCase = await slice2Request(worker, DB, `/api/v1/projects/sports/cases/${encodeURIComponent(caseId)}`);
  assert.equal(fetchedCase.response.status, 200);
  assert.equal(fetchedCase.value.case.id, caseId);

  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      id: eventId,
      conversationId,
      type: "context",
      assignmentState: "unassigned",
      exactSourceSpan: "exact source",
      sourceSpans: [{ id: sourceSpanId, messageId, start: 0, end: "exact source".length }],
    },
  });
  assert.equal(event.response.status, 201);
  assert.equal(event.value.event.id, eventId);
  assert.equal(event.value.event.sourceLinks[0].messageId, messageId);
  assert.equal(event.value.event.sourceLinks[0].href, `#message-${encodeURIComponent(messageId)}`);
  assert.equal(event.value.event.sourceLinks[0].span.id, sourceSpanId);
  assert.equal(DB.database.prepare("SELECT id FROM messages WHERE id = ?").get(messageId).id, messageId);
  assert.equal(DB.database.prepare("SELECT id FROM events WHERE id = ?").get(eventId).id, eventId);
  assert.equal(
    JSON.parse(DB.database.prepare("SELECT metadata FROM events WHERE id = ?").get(eventId).metadata).sourceSpans[0].id,
    sourceSpanId,
  );
});

test("Slice 2 case moves preserve attachment lineage and reverse without rewriting history", async () => {
  const worker = await builtWorker("slice2-boundary-history");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Boundary history" },
  });
  const conversationId = conversation.value.conversation.id;
  const message = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}/messages`, {
    method: "POST",
    idempotencyKey: "boundary-source",
    body: { actorType: "user", content: "Move this exact event only after a proposal." },
  });
  const messageId = message.value.message.id;
  const caseA = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Original margin case", conversationId, makeActive: true, actorId: "cody" },
  });
  const caseB = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Narrow comparison case", conversationId, actorId: "cody" },
  });
  const selected = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/active-case`,
    {
      method: "POST",
      body: { caseId: caseB.value.case.id, actorId: "cody", reason: "Continue in the narrower case." },
    },
  );
  assert.equal(selected.response.status, 200);
  assert.equal(selected.value.activeCaseId, caseB.value.case.id);
  const continuity = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(continuity.value.conversation.activeCaseId, caseB.value.case.id);
  assert.deepEqual(new Set(continuity.value.cases.map((record) => record.id)), new Set([caseA.value.case.id, caseB.value.case.id]));
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: caseA.value.case.id,
      type: "decision",
      assignmentState: "assigned",
      exactSourceSpan: "Move this exact event",
      sourceSpans: [{ messageId, start: 0, end: "Move this exact event".length }],
    },
  });
  const eventId = event.value.event.id;
  const proposal = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
    method: "POST",
    body: {
      conversationId,
      operationType: "move",
      sourceCaseIds: [caseA.value.case.id],
      targetCaseId: caseB.value.case.id,
      eventIds: [eventId],
      actorId: "cody",
      reason: "This event belongs to the narrower comparison case.",
    },
  });
  assert.equal(proposal.response.status, 201);
  assert.equal(proposal.value.proposal.changed, false);
  let detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].caseId, caseA.value.case.id);

  const applied = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/proposals/${proposal.value.proposal.id}/apply`, {
    method: "POST",
    body: { actorId: "cody", reason: "Apply reviewed move." },
  });
  assert.equal(applied.response.status, 200);
  detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].caseId, caseB.value.case.id);
  let attachments = DB.database.prepare(
    "SELECT case_id, attachment_state, ended_at FROM case_event_attachments WHERE event_id = ? ORDER BY created_at",
  ).all(eventId);
  assert.equal(attachments.length, 2);
  assert.ok(attachments[0].ended_at);
  assert.equal(attachments[1].case_id, caseB.value.case.id);
  assert.equal(attachments[1].ended_at, null);

  const reversed = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/operations/${applied.value.operation.id}/reverse`, {
    method: "POST",
    body: { actorId: "cody", reason: "The original case boundary was correct." },
  });
  assert.equal(reversed.response.status, 200);
  detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].caseId, caseA.value.case.id);
  assert.equal(detail.value.boundaryHistory.length, 2);
  attachments = DB.database.prepare(
    "SELECT case_id, attachment_state, ended_at FROM case_event_attachments WHERE event_id = ? ORDER BY created_at",
  ).all(eventId);
  assert.equal(attachments.length, 3);
  assert.equal(attachments[2].case_id, caseA.value.case.id);
  assert.equal(attachments[2].attachment_state, "restored");
  assert.equal(attachments[2].ended_at, null);
});

test("Slice 2 attach, unassign, and chat-only proposals remain explicit and reversible", async () => {
  const worker = await builtWorker("slice2-assignment-proposals");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Assignment proposals" },
  });
  const conversationId = conversation.value.conversation.id;
  const message = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}/messages`, {
    method: "POST",
    idempotencyKey: "assignment-source",
    body: { actorType: "user", content: "Keep this item unassigned until the case boundary is reviewed." },
  });
  const caseRecord = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Reviewed assignment target", conversationId, makeActive: true },
  });
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      type: "context",
      assignmentState: "unassigned",
      exactSourceSpan: "Keep this item unassigned",
      sourceSpans: [{ messageId: message.value.message.id, start: 0, end: "Keep this item unassigned".length }],
    },
  });
  const proposeAndApply = async (operationType, sourceCaseIds, targetCaseId) => {
    const proposal = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
      method: "POST",
      body: {
        conversationId,
        operationType,
        sourceCaseIds,
        targetCaseId,
        eventIds: [event.value.event.id],
        reason: `Review ${operationType} assignment.`,
      },
    });
    assert.equal(proposal.response.status, 201);
    const before = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
    const applied = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/proposals/${proposal.value.proposal.id}/apply`, {
      method: "POST",
      body: { reason: `Apply ${operationType} after review.` },
    });
    assert.equal(applied.response.status, 200);
    return { before: before.value.events[0], operation: applied.value.operation };
  };

  const attached = await proposeAndApply("attach", [], caseRecord.value.case.id);
  assert.equal(attached.before.assignmentState, "unassigned");
  let detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].assignmentState, "assigned");
  assert.equal(detail.value.events[0].caseId, caseRecord.value.case.id);

  const unassigned = await proposeAndApply("unassign", [caseRecord.value.case.id], null);
  detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].assignmentState, "unassigned");
  assert.equal(detail.value.events[0].caseId, null);

  const chatOnly = await proposeAndApply("chat_only", [], null);
  detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].assignmentState, "chat_only");
  const reversed = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/operations/${chatOnly.operation.id}/reverse`, {
    method: "POST",
    body: { reason: "Return the event to unassigned state." },
  });
  assert.equal(reversed.response.status, 200);
  detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].assignmentState, "unassigned");
  assert.equal(detail.value.boundaryHistory.length, 4);
  assert.equal(unassigned.before.assignmentState, "assigned");
});

test("Slice 2 split and merge remain proposals until explicitly applied", async () => {
  const worker = await builtWorker("slice2-split-merge");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Split and merge boundaries" },
  });
  const conversationId = conversation.value.conversation.id;
  const message = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}/messages`, {
    method: "POST",
    idempotencyKey: "split-source",
    body: { actorType: "user", content: "first-five question and later full-game margin question" },
  });
  const messageId = message.value.message.id;
  const sourceCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Broad Brewers slate", conversationId, makeActive: true },
  });
  const splitCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "First-five subcase", conversationId },
  });
  const mergeTarget = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Margin decision", conversationId },
  });
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: sourceCase.value.case.id,
      type: "objective",
      assignmentState: "assigned",
      exactSourceSpan: "first-five question",
      sourceSpans: [{ messageId, start: 0, end: "first-five question".length }],
    },
  });
  const split = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
    method: "POST",
    body: {
      conversationId,
      operationType: "split",
      sourceCaseIds: [sourceCase.value.case.id],
      targetCaseId: splitCase.value.case.id,
      eventIds: [event.value.event.id],
      reason: "Propose a narrower first-five case.",
    },
  });
  assert.equal(split.value.proposal.state, "proposed");
  let detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversationId}`);
  assert.equal(detail.value.events[0].caseId, sourceCase.value.case.id);
  const appliedSplit = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/proposals/${split.value.proposal.id}/apply`, {
    method: "POST",
    body: { reason: "Apply reviewed split." },
  });
  assert.equal(appliedSplit.response.status, 200);

  const merge = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
    method: "POST",
    body: {
      conversationId,
      operationType: "merge",
      sourceCaseIds: [splitCase.value.case.id],
      targetCaseId: mergeTarget.value.case.id,
      eventIds: [],
      reason: "Propose merging the resolved subcase into the margin decision.",
    },
  });
  assert.equal(merge.value.proposal.state, "proposed");
  const beforeMerge = await slice2Request(worker, DB, `/api/v1/projects/sports/cases/${splitCase.value.case.id}`);
  assert.equal(beforeMerge.value.case.status, "active");
  const appliedMerge = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/proposals/${merge.value.proposal.id}/apply`, {
    method: "POST",
    body: { reason: "Apply reviewed merge." },
  });
  assert.equal(appliedMerge.response.status, 200);
  const afterMerge = await slice2Request(worker, DB, `/api/v1/projects/sports/cases/${splitCase.value.case.id}`);
  assert.equal(afterMerge.value.case.status, "merged");
  const reversedMerge = await slice2Request(worker, DB, `/api/v1/projects/sports/case-boundaries/operations/${appliedMerge.value.operation.id}/reverse`, {
    method: "POST",
    body: { reason: "Restore the split case." },
  });
  assert.equal(reversedMerge.response.status, 200);
  const restoredCase = await slice2Request(worker, DB, `/api/v1/projects/sports/cases/${splitCase.value.case.id}`);
  assert.equal(restoredCase.value.case.status, "active");
});

test("V4.6 global and project navigation is quiet and project scoped", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const destination of ["Home", "Projects", "Review", "Atlas"]) assert.match(page, new RegExp(`label: "${destination}"`));
  assert.doesNotMatch(page, /label: "Capture"/);
  assert.match(page, /type ProjectTab = "work" \| "evidence" \| "blueprint" \| "activity"/);
  assert.match(page, /state\.cases\.filter\(\(item\) => item\.project === activeProject\)/);
  assert.match(page, /state\.evidence\.filter\(\(item\) => item\.project === activeProject\)/);
  assert.match(page, /Ask Atlas will not silently change this scope/);
  assert.match(page, /Headquarters.*Governance function/s);
});

test("Work opens one unified case with the complete governed lifecycle", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const section of ["What happened", "Research audit", "Evidence", "Outcome", "Post-mortem", "Proposed learning", "Connections", "Downstream effect"]) assert.match(page, new RegExp(section));
  for (const stage of ["Captured", "Outcome recorded", "Audited", "Lesson proposed", "Awaiting review", "Approved", "Retrieval eligible"]) assert.match(page, new RegExp(stage));
  assert.match(page, /Origin and reasoning/);
  assert.match(page, /Facts/);
  assert.match(page, /Estimates/);
  assert.match(page, /Assumptions/);
  assert.match(page, /Unknowns/);
  assert.match(page, /Counterarguments/);
});

test("Capture is short, writes canonical records, and always produces a transition receipt", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const type of ["New case or experience", "Research", "Evidence", "Outcome", "Correction", "Challenge", "Observation", "Proposed connection"]) assert.match(page, new RegExp(type));
  assert.match(page, /Retrieval did not change because no knowledge was approved/);
  assert.match(page, /Where it went/);
  assert.match(page, /Previous state/);
  assert.match(page, /New state/);
  assert.match(page, /Recommended next step/);
  assert.match(page, /API-visible state/);
});

test("Evidence Ledger uses quiet project schemas without treating labels as knowledge", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../app/v46-data.ts", import.meta.url), "utf8");
  assert.match(page, /Evidence Ledger/);
  assert.match(page, /Ranked highly because it matches/);
  assert.match(page, /Labels support ranking and reconstruction\. They are not knowledge claims or feed events/);
  assert.match(page, /Routine label edits stay in record history/);
  for (const label of ["Skill dial", "Game situation", "Sport", "League", "Market type", "Shared mechanism", "Fragility"]) assert.match(data, new RegExp(label));
});

test("Review exposes evidence and operational governance controls", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const control of ["Approve", "Edit and approve", "Challenge", "Reject", "Connect", "Merge", "Defer", "Supersede", "Retire"]) assert.match(page, new RegExp(control));
  assert.match(page, /Supporting evidence/);
  assert.match(page, /Challenging evidence/);
  assert.match(page, /Possible Blueprint effect/);
  assert.match(page, /Expected retrieval effect/);
  assert.match(page, /Cross-project consequence/);
  assert.match(page, /Approve the underlying knowledge before authorizing a Blueprint revision/);
});

test("Ask Atlas provides a direct answer before progressive inspection", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const layer of ["Atlas response", "Inspect context", "Exclusions", "Context packet", "Retrieval receipt", "Before-and-after diff", "Raw JSON"]) assert.match(page, new RegExp(layer));
  for (const scope of ["Current project only", "Current project + approved transfers", "Entire Campus exploration"]) assert.ok(page.includes(scope));
  assert.match(page, /Token budget/);
  assert.match(page, /Temporary local context/);
});

test("project graph modes show different relationship subsets and inspect edges", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const mode of ["connections", "lineage", "challenges", "cross", "transfer"]) assert.match(page, new RegExp(`"${mode}"`));
  for (const detail of ["Supporting evidence", "Confidence", "Creator", "Downstream consequence", "Reconstruction value", "Domain limitations"]) assert.match(page, new RegExp(detail));
  assert.match(page, /Selecting a connection|Select a connection/);
});

test("mobile preserves Home, Projects, Review, Atlas, Ask, Capture, Work, Evidence, and Blueprint", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /aria-label="Campus Atlas mobile workspace"/);
  assert.match(page, /mobile-capture/);
  assert.match(page, /onAsk/);
  assert.match(css, /\.mobile-nav/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /\.project-tabs\{grid-template-columns:repeat\(3,120px\)/);
});

test("pre-approval knowledge is excluded and absent from the active Blueprint", async () => {
  const worker = await builtWorker("before-approval");
  const DB = memoryD1();
  await saveState(worker, DB, seedState());
  const packet = await context(worker, DB, { task: "How should Sports Engine evaluate an England heavy favorite against a defensive wall?", project: "Sports Engine", tokenBudget: 700, retrievalScope: "project" });
  assert.equal(packet.approvedPrinciples.some((item) => item.id === "knowledge-signal-separation"), false);
  assert.ok(packet.excluded.some((item) => item.id === "knowledge-signal-separation" && /Not approved/.test(item.whyExcluded)));
  assert.equal(packet.blueprint.version, "V4.6");
  assert.equal(packet.blueprint.rules.some((rule) => /territorial control/.test(rule)), false);
  assert.ok(packet.receipt.checks.includes("Only approved knowledge received retrieval authority"));
});

test("human approval changes the same packet without automatically changing Blueprint authority", async () => {
  const worker = await builtWorker("approval-diff");
  const DB = memoryD1();
  const task = "How should Sports Engine evaluate an England heavy favorite against a defensive wall and handicap?";
  await saveState(worker, DB, seedState());
  const before = await context(worker, DB, { task, project: "Sports Engine", tokenBudget: 700, retrievalScope: "project" });
  await saveState(worker, DB, seedState({ approvedSignal: true }));
  const after = await context(worker, DB, { task, project: "Sports Engine", tokenBudget: 700, retrievalScope: "project" });
  assert.equal(before.durableKnowledge.some((item) => item.id === "knowledge-signal-separation"), false);
  assert.equal(after.durableKnowledge.some((item) => item.id === "knowledge-signal-separation"), true);
  assert.equal(after.blueprint.version, "V4.6");
  assert.equal(after.blueprint.rules.some((rule) => /territorial control/.test(rule)), false);
});

test("a separate Blueprint approval advances the version and active rule", async () => {
  const worker = await builtWorker("blueprint-approval");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true, blueprintSignal: true }));
  const packet = await context(worker, DB, { task: "Evaluate an England heavy favorite against a defensive wall", project: "Sports Engine" });
  assert.equal(packet.blueprint.version, "V4.6.1");
  assert.ok(packet.blueprint.rules.some((rule) => /territorial control/.test(rule)));
});

test("retrieval rejects irrelevant same-project baseball evidence for a soccer question", async () => {
  const worker = await builtWorker("sport-boundary");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true }));
  const packet = await context(worker, DB, { task: "Evaluate an England soccer favorite against Ghana and a defensive wall", project: "Sports Engine" });
  assert.equal(packet.durableKnowledge.some((item) => item.id === "knowledge-workload"), false);
  assert.ok(packet.excluded.some((item) => item.id === "knowledge-workload" && /Wrong sport or domain/.test(item.whyExcluded)));
  assert.ok(packet.receipt.labelsApplied.some((label) => /Sport: Soccer/.test(label)));
});

test("tokenBudget changes the packet limit and remains visible in the receipt", async () => {
  const worker = await builtWorker("budget");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true }));
  const small = await context(worker, DB, { task: "Evaluate a soccer favorite and offered handicap market", project: "Sports Engine", tokenBudget: 250 });
  const large = await context(worker, DB, { task: "Evaluate a soccer favorite and offered handicap market", project: "Sports Engine", tokenBudget: 1200 });
  assert.equal(small.budget.requestedTokens, 250);
  assert.equal(large.budget.requestedTokens, 1200);
  assert.ok(small.budget.limit < large.budget.limit);
});

test("pending cross-project pathway is exploratory only and never target authority", async () => {
  const worker = await builtWorker("exploration");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true }));
  const projectOnly = await context(worker, DB, { task: "When should I pressure an unwinnable hockey puck versus recover into support?", project: "Hockey Development", retrievalScope: "project" });
  const campus = await context(worker, DB, { task: "When should I separate effort from control on an unwinnable hockey puck?", project: "Hockey Development", retrievalScope: "campus" });
  assert.equal(projectOnly.reconstructionPathways.some((path) => path.id === "path-effort" && path.selected), false);
  assert.ok(campus.reconstructionPathways.some((path) => path.id === "path-effort" && path.selected && path.authority === "Exploratory connection"));
  assert.equal(campus.approvedPrinciples.some((item) => item.id === "knowledge-signal-separation"), false);
  assert.ok(campus.compiledPrompt.includes("Project conclusions remain separate") || campus.compiledPrompt.includes("different domains"));
});

test("approved transfer creates adapted target knowledge while leaving source scoped", async () => {
  const worker = await builtWorker("transfer-approved");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true, transferApproved: true }));
  const packet = await context(worker, DB, { task: "How should hockey effort create control and a useful outcome on an unwinnable puck?", project: "Hockey Development", retrievalScope: "transfers" });
  assert.ok(packet.approvedPrinciples.some((item) => item.id === "knowledge-hockey-effort-control"));
  assert.equal(packet.approvedPrinciples.some((item) => item.id === "knowledge-signal-separation"), false);
  assert.ok(packet.reconstructionPathways.some((path) => path.id === "path-effort" && path.authority === "Approved transfer"));
});

test("keyword similarity alone cannot activate a reconstruction pathway", async () => {
  const worker = await builtWorker("weak-path");
  const DB = memoryD1();
  await saveState(worker, DB, seedState({ approvedSignal: true }));
  const packet = await context(worker, DB, { task: "Explain defensive coverage in hockey", project: "Hockey Development", retrievalScope: "campus" });
  assert.ok(packet.reconstructionPathways.some((path) => path.id === "path-keyword" && !path.selected && /keyword similarity/.test(path.reason)));
});

test("temporary local context is returned but never promoted", async () => {
  const worker = await builtWorker("local-context");
  const DB = memoryD1();
  await saveState(worker, DB, seedState());
  const packet = await context(worker, DB, { task: "Research an England favorite", project: "Sports Engine", localContext: "Lineups are not final; expire this after the task." });
  assert.equal(packet.localContext.retention, "Temporary");
  assert.equal(packet.localContext.captureRequiredForDurability, true);
  assert.match(packet.compiledPrompt, /expire this after the task/);
});

test("OpenAPI 4.6 advertises project scope, token budget, and governed writes", async () => {
  const worker = await builtWorker("openapi");
  const DB = memoryD1();
  const response = await worker.fetch(new Request("http://localhost/.well-known/openapi.json"), { DB, ASSETS: assets }, ctx);
  const spec = await response.json();
  assert.equal(spec.info.version, "4.6.0");
  const schema = spec.paths["/api/context"].post.requestBody.content["application/json"].schema;
  assert.ok(schema.properties.tokenBudget);
  assert.deepEqual(schema.properties.retrievalScope.enum, ["project", "transfers", "campus"]);
  assert.ok(spec.paths["/api/events"]);
});

test("MCP initialization and seven tool calls remain real and testable", async () => {
  const worker = await builtWorker("mcp");
  const DB = memoryD1();
  const rpc = async (method, params = {}) => (await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), { DB, ASSETS: assets }, ctx)).json();
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(initialized.result.serverInfo.version, "4.6.0");
  const listed = await rpc("tools/list");
  assert.equal(listed.result.tools.length, 7);
  const call = await rpc("tools/call", { name: "atlas_build_context_packet", arguments: { task: "Evaluate an England favorite", project: "Sports Engine", tokenBudget: 600 } });
  assert.equal(call.result.isError, undefined);
  assert.equal(call.result.structuredContent.blueprint.version, "V4.6");
});

test("authorized API case capture updates canonical cases, evidence, activity, and node state", async () => {
  const worker = await builtWorker("api-canonical-write");
  const DB = memoryD1();
  await saveState(worker, DB, seedState());
  const response = await worker.fetch(new Request("http://localhost/api/candidates", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer key" }, body: JSON.stringify({ title: "New soccer case", summary: "A user-created API case with inspectable evidence.", source: "ChatGPT", project: "Sports Engine", objectType: "case", confidence: 74, idempotencyKey: "v46-case-1" }) }), { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "key" }, ctx);
  assert.equal(response.status, 201);
  const created = await response.json();
  const stored = await (await worker.fetch(new Request("http://localhost/api/state"), { DB, ASSETS: assets }, ctx)).json();
  assert.ok(stored.state.cases.some((item) => item.title === "New soccer case" && item.origin === "API-created"));
  assert.ok(stored.state.evidence.some((item) => item.content.includes("inspectable evidence")));
  assert.ok(stored.state.activities.some((item) => item.action === "Case captured"));
  assert.ok(stored.state.nodes.some((item) => item.title === "New soccer case"));
  const receipt = await worker.fetch(new Request(`http://localhost/api/receipts?id=${created.receipt.id}`), { DB, ASSETS: assets }, ctx);
  assert.equal(receipt.status, 200);
  assert.equal((await receipt.json()).idempotencyKey, "v46-case-1");
});

test("public demo workspace state is persisted and isolated by opaque workspace key", async () => {
  const worker = await builtWorker("workspace-isolation");
  const DB = memoryD1();
  const workspaceA = "demo-aaaaaaaaaaaaaaaaaaaa";
  const workspaceB = "demo-bbbbbbbbbbbbbbbbbbbb";
  const stateA = { ...seedState(), marker: "workspace-a" };
  const stateB = { ...seedState(), marker: "workspace-b", nodes: seedState().nodes.filter((item) => item.project !== "sports") };
  for (const [workspaceId, state] of [[workspaceA, stateA], [workspaceB, stateB]]) {
    const saved = await worker.fetch(new Request("http://localhost/api/state?replace=true", {
      method: "POST",
      headers: { "content-type": "application/json", "x-atlas-workspace": workspaceId },
      body: JSON.stringify({ ...state, workspaceId }),
    }), { DB, ASSETS: assets, CAMPUS_ATLAS_PUBLIC_DEMO: "true" }, ctx);
    assert.equal(saved.status, 200);
  }
  const read = async (workspaceId) => (await (await worker.fetch(new Request("http://localhost/api/state", {
    headers: { "x-atlas-workspace": workspaceId },
  }), { DB, ASSETS: assets, CAMPUS_ATLAS_PUBLIC_DEMO: "true" }, ctx)).json()).state;
  assert.equal((await read(workspaceA)).marker, "workspace-a");
  assert.equal((await read(workspaceB)).marker, "workspace-b");
  assert.ok((await read(workspaceA)).nodes.some((item) => item.project === "sports"));
  assert.equal((await read(workspaceB)).nodes.some((item) => item.project === "sports"), false);
});

test("writes fail closed and never expose the configured secret", async () => {
  const worker = await builtWorker("security");
  const DB = memoryD1();
  const denied = await worker.fetch(new Request("http://localhost/api/candidates", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { DB, ASSETS: assets }, ctx);
  assert.equal(denied.status, 401);
  const status = await (await worker.fetch(new Request("http://localhost/api/security"), { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "never-return-this" }, ctx)).json();
  assert.equal(status.externalWrites, "bearer_required");
  assert.ok(status.protectedRoutes.includes("/api/events"));
  assert.doesNotMatch(JSON.stringify(status), /never-return-this/);
});

test("demo reset restores every V4.6 proof subsystem without deleting unrelated workspaces", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../app/v46-data.ts", import.meta.url), "utf8");
  assert.match(page, /Reset Amy Campus demo/);
  assert.match(page, /cases, evidence, Review, approved Knowledge, Blueprint versions, graph connections, transfer proposals, reconstruction pathways, packet history, and activity/);
  assert.match(page, /applies only to the current Amy Campus demo session/);
  assert.match(page, /makeSeedState\(state\.workspaceId\)/);
  assert.match(data, /proofBaseline: null/);
});
