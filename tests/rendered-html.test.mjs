Warning: truncated output (original token count: 60824)
Total output lines: 5354

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

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

async function seedSlice3Case(worker, DB, suffix, eventTypes, eventContents = []) {
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: `Slice 3 ${suffix}` },
  });
  assert.equal(conversation.response.status, 201);
  const conversationId = conversation.value.conversation.id;
  const caseResult = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: `Govern the ${suffix} reasoning pathway`,
      conversationId,
      makeActive: true,
      actorId: "cody",
    },
  });
  assert.equal(caseResult.response.status, 201);
  const events = [];
  for (let index = 0; index < eventTypes.length; index += 1) {
    const content = eventContents[index] || `${suffix} exact source ${index}: ${eventTypes[index]}`;
    const message = await slice2Request(
      worker,
      DB,
      `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        idempotencyKey: `${suffix}-message-${index}`,
        body: { actorType: index % 2 ? "assistant" : "user", content },
      },
    );
    assert.equal(message.response.status, 201);
    const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
      method: "POST",
      body: {
        conversationId,
        caseId: caseResult.value.case.id,
        type: eventTypes[index],
        assignmentState: "assigned",
        exactSourceSpan: content,
        sourceSpans: [{ messageId: message.value.message.id, start: 0, end: content.length }],
      },
    });
    assert.equal(event.response.status, 201);
    events.push(event.value.event);
  }
  return { conversationId, caseId: caseResult.value.case.id, events };
}

function seedSlice4Mechanism(DB, {
  id,
  projectId = "sports",
  statement,
  authority = "approved_project_wide",
  status = "active",
  supportingCaseIds = [],
  supportingNodeIds = [],
  counterevidenceIds = [],
  realityContact = null,
  createdAt = "2026-07-01T12:00:00.000Z",
}) {
  const versionId = `${id}:version:1`;
  DB.database.prepare(
    `INSERT INTO mechanisms (
      id, project_id, source_finding_id, current_governing_version_id,
      status, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
  ).run(id, projectId, versionId, status, createdAt, createdAt);
  DB.database.prepare(
    `INSERT INTO mechanism_versions (
      id, project_id, mechanism_id, statement, scope_conditions, exclusions,
      supporting_case_ids, supporting_node_ids, counterevidence_ids,
      reality_contact, authority_state, intended_retrieval_effect,
      created_by, created_at, supersedes_version_id
    ) VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?,
              'eligible_when_roadway_scope_and_freshness_match', 'fixture', ?, NULL)`,
  ).run(
    versionId,
    projectId,
    id,
    statement,
    JSON.stringify(supportingCaseIds),
    JSON.stringify(supportingNodeIds),
    JSON.stringify(counterevidenceIds),
    realityContact,
    authority,
    createdAt,
  );
  return { id, versionId };
}

async function createSlice4Packet(worker, DB, body, idempotencyKey) {
  return slice2Request(worker, DB, `/api/v1/projects/${body.projectId || "sports"}/packets`, {
    method: "POST",
    idempotencyKey,
    body: {
      task: body.task,
      caseId: body.caseId,
      tokenBudget: body.tokenBudget ?? 800,
      roadwayOverride: body.roadwayOverride,
    },
  });
}

async function createLiveState(worker, DB, projectId, category, suffix, overrides = {}) {
  return slice2Request(worker, DB, `/api/v1/projects/${projectId}/live-state`, {
    method: "POST",
    idempotencyKey: `slice4-live-${projectId}-${category}-${suffix}`,
    body: {
      provider: "calibration-provider",
      sourceIdentity: `fixture://${projectId}/${category}/${suffix}`,
      category,
      entity: overrides.entity || "Milwaukee Brewers",
      rawValue: overrides.rawValue || `${category} available`,
      normalizedValue: { fixture: true },
      observedAt: overrides.observedAt || new Date().toISOString(),
      freshnessWindowSeconds: overrides.freshnessWindowSeconds || 3600,
      caseId: overrides.caseId,
    },
  });
}

async function createSlice5Handoff(
  worker,
  DB,
  projectId,
  body,
  idempotencyKey,
  extraEnv = {},
) {
  const response = await worker.fetch(new Request(
    `http://localhost/api/v1/projects/${encodeURIComponent(projectId)}/handoffs`,
    {
      method: "POST",
      headers: {
        ...slice2Headers,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
  ), {
    DB,
    ASSETS: assets,
    CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key",
    ...extraEnv,
  }, ctx);
  return { response, value: await response.json() };
}

test("renders the Campus Atlas root without starter preview metadata", async () => {
  const worker = await builtWorker("render");
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets }, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Campus Atlas/);
  assert.doesNotMatch(html, /codex-preview/);
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

test("Slice 6A shell reads canonical health, projects, session, and isolated active Work", async () => {
  const worker = await builtWorker("slice6a-shell-reads");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");

  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Native Slice 6A proof" },
  });
  const conversationId = conversation.value.conversation.id;
  const caseRecord = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: "Preserve exact native continuity",
      conversationId,
      makeActive: true,
      actorId: "cody",
    },
  });
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "slice6a-native-message",
      body: {
        actorType: "user",
        actorId: "cody",
        content: "A current challenge should remain visible in Reasoning Health.",
      },
    },
  );
  await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: caseRecord.value.case.id,
      type: "challenge",
      assignmentState: "assigned",
      exactSourceSpan: "current challenge",
      sourceSpans: [{
        messageId: message.value.message.id,
        start: 2,
        end: 19,
      }],
    },
  });

  const env = { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key" };
  const health = await worker.fetch(new Request("http://localhost/api/v1/health"), env, ctx);
  assert.equal(health.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries(await health.json()).filter(([key]) =>
      ["canonicalState", "persistence", "fixtureMode", "seededFallback"].includes(key),
    )),
    {
      canonicalState: "available",
      persistence: "canonical_d1",
      fixtureMode: false,
      seededFallback: false,
    },
  );

  const projectsResponse = await worker.fetch(new Request("http://localhost/api/v1/projects"), env, ctx);
  assert.equal(projectsResponse.status, 200);
  const projects = await projectsResponse.json();
  assert.equal(projects.projects.length, 2);
  assert.equal(projects.fixtureMode, false);
  assert.equal(projects.source, "canonical_d1");

  const readOnly = await (await worker.fetch(new Request("http://localhost/api/v1/session"), env, ctx)).json();
  assert.equal(readOnly.session.readOnly, true);
  assert.equal(readOnly.session.writeAuthorization.storage, "memory_only");
  assert.doesNotMatch(JSON.stringify(readOnly), /slice-2-test-key/);
  const authorized = await (await worker.fetch(new Request("http://localhost/api/v1/session", {
    headers: { authorization: "Bearer slice-2-test-key" },
  }), env, ctx)).json();
  assert.equal(authorized.session.writeAuthorization.authorized, true);
  assert.doesNotMatch(JSON.stringify(authorized), /slice-2-test-key/);

  const workResponse = await worker.fetch(new Request("http://localhost/api/v1/projects/sports/work"), env, ctx);
  assert.equal(workResponse.status, 200);
  const work = await workResponse.json();
  assert.equal(work.activeConversationId, conversationId);
  assert.equal(work.conversations.length, 1);
  assert.equal(work.conversations[0].reasoningHealth.state, "Conflict");
  assert.equal(work.conversations[0].reasoningHealth.cause.type, "event");
  assert.equal(work.fixtureMode, false);
  assert.equal(work.source, "canonical_d1");

  const isolated = await (await worker.fetch(new Request("http://localhost/api/v1/projects/hockey/work"), env, ctx)).json();
  assert.equal(isolated.project.id, "hockey");
  assert.equal(isolated.conversations.length, 0);

  const unauthorizedWrite = await worker.fetch(new Request("http://localhost/api/v1/projects/sports/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Must not persist" }),
  }), env, ctx);
  assert.equal(unauthorizedWrite.status, 401);

  const unavailable = await worker.fetch(new Request("http://localhost/api/v1/health"), {
    DB: { prepare() { throw new Error("D1 unavailable"); } },
    ASSETS: assets,
  }, ctx);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "D1 unavailable",
    canonicalState: "unavailable",
    fixtureMode: false,
    seededFallback: false,
  });
});

test("Slice 3 migrations add checkpoints and append-only governance metadata", async () => {
  const checkpointMigration = await readFile(new URL("../drizzle/0004_odd_patriot.sql", import.meta.url), "utf8");
  const governanceMigration = await readFile(new URL("../drizzle/0005_amusing_turbo.sql", import.meta.url), "utf8");
  const parityMigration = await readFile(new URL("../drizzle/0006_opposite_roland_deschain.sql", import.meta.url), "utf8");
  assert.match(checkpointMigration, /CREATE TABLE `checkpoints`/);
  assert.match(checkpointMigration, /CREATE TABLE `checkpoint_reasoning_nodes`/);
  assert.match(checkpointMigration, /proposal_hash/);
  assert.match(governanceMigration, /prior_status/);
  assert.match(governanceMigration, /rollback_of_event_id/);
  assert.match(governanceMigration, /source_finding_id/);
  assert.match(governanceMigration, /finding_versions_immutable_update/);
  assert.match(governanceMigration, /mechanism_versions_immutable_delete/);
  assert.match(governanceMigration, /governance_events_immutable_update/);
  assert.match(parityMigration, /authority_state/);
  assert.match(parityMigration, /prior_return_condition/);
  assert.match(parityMigration, /new_expires_at/);
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
  const invariantMigration = await readFile(new URL("../drizzle/0003_small_bromley.sql", import.meta.url), "utf8");
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
  assert.match(invariantMigration, /conversation_case_links_one_active/);
  assert.match(invariantMigration, /"relationship_state" = 'active'/);
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
  assert.equal(
    imported.value.import.provenance.historicalRawTranscriptStatus,
    "unavailable_cannot_truthfully_reconstruct",
  );
  assert.equal(imported.value.import.provenance.acceptanceStatus, "deferred_historical_fixture_gap");
  assert.equal(imported.value.import.provenance.futureReceiptDisclosureRequired, true);
  assert.equal(fixtureContract.replacementProofPlan.exactSourceFixture, "A future native Atlas conversation.");
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

test.skip("DEFERRED historical Brewers fixture gap: verbatim raw transcript is unavailable");
test.skip("DEFERRED historical Brewers fixture gap: original user and assistant sequence is unavailable");
test.skip("DEFERRED historical Brewers fixture gap: original source-span lineage is unavailable");
test.skip("DEFERRED historical Brewers fixture gap: independent reconstruction from missing raw source is impossible");
test.skip("DEFERRED historical Brewers fixture gap: raw-derived Atlas comparison cannot be performed");

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
  assert.equal(unassigned.value.event.sourceLinks[0].href, `#${encodeURIComponent(`message-${messageId}`)}`);

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
  assert.equal(event.value.event.sourceLinks[0].href, `#${encodeURIComponent(`message-${messageId}`)}`);
  assert.equal(event.value.event.sourceLinks[0].span.id, sourceSpanId);
  assert.equal(DB.database.prepare("SELECT id FROM messages WHERE id = ?").get(messageId).id, messageId);
  assert.equal(DB.database.prepare("SELECT id FROM events WHERE id = ?").get(eventId).id, eventId);
  assert.equal(
    JSON.parse(DB.database.prepare("SELECT metadata FROM events WHERE id = ?").get(eventId).metadata).sourceSpans[0].id,
    sourceSpanId,
  );
});

test("Slice 2 enforces one active case and conversation-scoped case assignments", async () => {
  const worker = await builtWorker("slice2-case-association-invariants");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Case association invariants" },
  });
  const conversationId = conversation.value.conversation.id;
  const firstCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "First active case", conversationId, makeActive: true },
  });
  const secondCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Second active case", conversationId, makeActive: true },
  });
  assert.equal(firstCase.response.status, 201);
  assert.equal(secondCase.response.status, 201);
  const links = DB.database.prepare(
    "SELECT case_id, relationship_state FROM conversation_case_links WHERE conversation_id = ? AND ended_at IS NULL",
  ).all(conversationId);
  assert.equal(links.filter((link) => link.relationship_state === "active").length, 1);
  assert.equal(links.find((link) => link.relationship_state === "active").case_id, secondCase.value.case.id);
  const refreshed = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(refreshed.value.conversation.activeCaseId, secondCase.value.case.id);
  assert.deepEqual(
    new Set(refreshed.value.cases.map((record) => record.id)),
    new Set([firstCase.value.case.id, secondCase.value.case.id]),
  );

  const unrelatedCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: { objective: "Not associated with this conversation" },
  });
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "case-association-source",
      body: { actorType: "user", content: "Keep assignments inside the conversation boundary." },
    },
  );
  const invalidAssignment = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: unrelatedCase.value.case.id,
      type: "context",
      assignmentState: "assigned",
      exactSourceSpan: "conversation boundary",
      sourceSpans: [{
        messageId: message.value.message.id,
        start: "Keep assignments inside the ".length,
        end: "Keep assignments inside the conversation boundary".length,
      }],
    },
  });
  assert.equal(invalidAssignment.response.status, 400);

  const unassigned = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      type: "context",
      assignmentState: "unassigned",
      exactSourceSpan: "conversation boundary",
      sourceSpans: [{
        messageId: message.value.message.id,
        start: "Keep assignments inside the ".length,
        end: "Keep assignments inside the conversation boundary".length,
      }],
    },
  });
  const invalidBoundaryTarget = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
    method: "POST",
    body: {
      conversationId,
      operationType: "attach",
      sourceCaseIds: [],
      targetCaseId: unrelatedCase.value.case.id,
      eventIds: [unassigned.value.event.id],
      reason: "This target was never associated with the conversation.",
    },
  });
  assert.equal(invalidBoundaryTarget.response.status, 400);
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

test("Slice 2 requires newer boundary operations to reverse before older history", async () => {
  const worker = await builtWorker("slice2-boundary-reversal-order");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Boundary reversal order" },
  });
  const conversationId = conversation.value.conversation.id;
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "reversal-order-source",
      body: { actorType: "user", content: "Move this event through reviewed case boundaries." },
    },
  );
  const cases = [];
  for (const objective of ["Original case", "Second case", "Third case"]) {
    const created = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
      method: "POST",
      body: { objective, conversationId, makeActive: objective === "Original case" },
    });
    cases.push(created.value.case);
  }
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: cases[0].id,
      type: "context",
      assignmentState: "assigned",
      exactSourceSpan: "Move this event",
      sourceSpans: [{ messageId: message.value.message.id, start: 0, end: "Move this event".length }],
    },
  });
  const move = async (sourceCaseId, targetCaseId, reason) => {
    const proposal = await slice2Request(worker, DB, "/api/v1/projects/sports/case-boundaries/proposals", {
      method: "POST",
      body: {
        conversationId,
        operationType: "move",
        sourceCaseIds: [sourceCaseId],
        targetCaseId,
        eventIds: [event.value.event.id],
        reason,
      },
    });
    return slice2Request(
      worker,
      DB,
      `/api/v1/projects/sports/case-boundaries/proposals/${encodeURIComponent(proposal.value.proposal.id)}/apply`,
      { method: "POST", body: { reason: `Apply: ${reason}` } },
    );
  };
  const firstMove = await move(cases[0].id, cases[1].id, "Move to the second reviewed case.");
  const secondMove = await move(cases[1].id, cases[2].id, "Move to the third reviewed case.");
  const staleReverse = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/case-boundaries/operations/${encodeURIComponent(firstMove.value.operation.id)}/reverse`,
    { method: "POST", body: { reason: "Attempt to reverse stale history." } },
  );
  assert.equal(staleReverse.response.status, 400);

  const reverseSecond = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/case-boundaries/operations/${encodeURIComponent(secondMove.value.operation.id)}/reverse`,
    { method: "POST", body: { reason: "Reverse the newest operation first." } },
  );
  assert.equal(reverseSecond.response.status, 200);
  const reverseFirst = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/case-boundaries/operations/${encodeURIComponent(firstMove.value.operation.id)}/reverse`,
    { method: "POST", body: { reason: "Now reverse the older operation." } },
  );
  assert.equal(reverseFirst.response.status, 200);
  const detail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(detail.value.events[0].caseId, cases[0].id);
  assert.equal(detail.value.boundaryHistory.length, 4);
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
  let detail = await slice2Request(worker, DB,…30824 tokens truncated…== mechanismId));
  for (const ancestor of correctionLineage) {
    const packetItem = packet.value.items.find((item) => item.sourceId === ancestor.sourceId);
    assert.ok(packetItem);
    assert.equal(packetItem.treatment, "Exclude");
    assert.equal(packetItem.packetEligibleProtected, false);
    assert.equal(packetItem.metadata.lineageOnly, true);
    assert.equal(packet.value.packet.compiledContent.includes(ancestor.statement), false);
  }
  assert.equal(packet.value.packet.compiledContent.includes("retained for lineage and audit"), false);
  assert.match(packet.value.packet.compiledContent, /A genuine counterexample shows that early territory/i);

  const handoff = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
    },
    "dogfood-lineage-protected-boundary-handoff",
    {
      ATLAS_TEST_RECEIVING_MODEL_ADAPTER: {
        fixtureType: "slice5_test_only",
        async execute() {
          return {
            providerResponseId: "response:dogfood-lineage-boundary",
            model: "atlas-test-receiver-v1",
            answerText: "Test-only lineage boundary answer.",
            completedAt: "2026-08-03T23:00:00.000Z",
            additionalLiveRetrieval: {
              performed: false,
              requested: false,
              retrievedAt: null,
              tools: [],
              reliedOnNewerStateThanPacket: false,
            },
            metadata: { fixture: true },
          };
        },
      },
    },
  );
  assert.equal(handoff.response.status, 201, JSON.stringify(handoff.value));
  assert.equal(handoff.value.receipt.corrections.length, 0);
  assert.ok(handoff.value.receipt.strongestChallenges.some(
    (item) => item.sourceId === seeded.events[2].id,
  ));
  const handoffExcluded = handoff.value.receipt.treatmentSummary.Exclude.filter(
    (item) => correctionLineage.some((ancestor) => ancestor.sourceId === item.sourceId),
  );
  assert.equal(handoffExcluded.length, 2);
  assert.ok(handoffExcluded.every((item) => item.metadata.lineageOnly === true));
});

test("Slice 6C lists immutable packet and honest handoff history within project scope", async () => {
  const worker = await builtWorker("slice6c-history");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice6c-history",
    statement: "Separate winning from covering by checking the one-score path.",
  });
  const packet = await createSlice4Packet(worker, DB, {
    task: "Can this favorite win by two, or is the one-score cover path too large?",
    tokenBudget: 800,
  }, "slice6c-history-packet");
  assert.equal(packet.response.status, 201, JSON.stringify(packet.value));
  assert.equal(packet.value.packet.status, "compiled");

  const failed = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "openai",
      model: "gpt-5.6",
      actorId: "cody",
    },
    "slice6c-history-handoff",
  );
  assert.equal(failed.response.status, 503, JSON.stringify(failed.value));
  assert.equal(failed.value.handoff.status, "failed");
  assert.equal(failed.value.handoff.failureCategory, "missing_configuration");

  const packets = await slice2Request(worker, DB, "/api/v1/projects/sports/packets");
  assert.equal(packets.response.status, 200);
  assert.deepEqual(packets.value.packets.map((item) => item.id), [packet.value.packet.id]);
  assert.equal(packets.value.packets[0].tokenBudget, 800);
  assert.equal(packets.value.packets[0].status, "compiled");

  const handoffs = await slice2Request(worker, DB, "/api/v1/projects/sports/handoffs");
  assert.equal(handoffs.response.status, 200);
  assert.equal(handoffs.value.handoffs.length, 1);
  assert.equal(handoffs.value.handoffs[0].id, failed.value.handoff.id);
  assert.equal(handoffs.value.handoffs[0].status, "failed");
  assert.equal(handoffs.value.handoffs[0].providerResponseId, null);
  assert.ok(handoffs.value.handoffs[0].receiptId);

  const otherPackets = await slice2Request(worker, DB, "/api/v1/projects/hockey/packets");
  const otherHandoffs = await slice2Request(worker, DB, "/api/v1/projects/hockey/handoffs");
  assert.equal(otherPackets.value.packets.length, 0);
  assert.equal(otherHandoffs.value.handoffs.length, 0);
});

test("Slice 6C final Ask is staged, project-resetting, mobile-capable, and free of production fixtures", async () => {
  const [
    workspace,
    candidates,
    packet,
    handoff,
    history,
    page,
    styles,
    shell,
  ] = await Promise.all([
    readFile(new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/candidate-treatment-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/packet-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/handoff-presentation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/ask-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/ask.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/project-shell.tsx", import.meta.url), "utf8"),
  ]);
  const combined = [workspace, candidates, packet, handoff, history, page].join("\n");
  for (const stage of ["Interpret", "Treat candidates", "Compile packet", "Handoff and receipt"]) {
    assert.match(combined, new RegExp(stage));
  }
  for (const surface of ["Your request", "Atlas reconstruction", "Model answer", "Receipt"]) {
    assert.match(handoff, new RegExp(surface));
  }
  assert.match(workspace, /model\.production === true/);
  assert.match(workspace, /reconstruction\/candidates/);
  assert.match(workspace, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(workspace, /query\.get\("packet"\)/);
  assert.match(workspace, /query\.get\("handoff"\)/);
  assert.match(history, /never recompiles a packet or retries a handoff/i);
  assert.match(packet, /same immutable packet response/i);
  assert.match(candidates, /browser cannot promote authority/i);
  assert.match(shell, /<ProjectShellInner key=\{projectId\}/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /bottom: calc\(68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(combined, /atlas-test-receiver-v1|England|Ghana|makeSeedState|seeded answer/i);
});

test("Slice 6B reasoning-node correction is versioned, idempotent, project-scoped, and non-authoritative", async () => {
  const worker = await builtWorker("slice6b-node-correction");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  const seeded = await seedSlice3Case(worker, DB, "slice6b correction", ["correction", "challenge"]);
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice6b-correction-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
      source: "slice6b_contract",
      findingCandidates: [],
    },
  });
  assert.equal(checkpoint.response.status, 201, JSON.stringify(checkpoint.value));
  const node = checkpoint.value.selectedNodes[0];
  const correctedStatement = `${node.statement} Cody corrected this wording without promoting authority.`;
  const correction = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/reasoning-nodes/${encodeURIComponent(node.id)}/corrections`,
    {
      method: "POST",
      idempotencyKey: "slice6b-node-correction",
      body: {
        sourceVersionId: node.currentVersionId,
        reviewedStatement: correctedStatement,
        actorId: "cody",
        reason: "The selected wording needed a narrower and explicit representation.",
      },
    },
  );
  assert.equal(correction.response.status, 201, JSON.stringify(correction.value));
  assert.equal(correction.value.version.statement, correctedStatement);
  assert.equal(correction.value.version.representation_type, "Reconstructed");
  assert.equal(correction.value.retrievalEffect, "wording_corrected_no_authority_promotion");
  assert.equal(correction.value.governanceEvent.prior_authority, correction.value.governanceEvent.new_authority);
  assert.equal(correction.value.governanceEvent.source_version_id, node.currentVersionId);
  assert.equal(correction.value.version.supersedes_version_id, node.currentVersionId);

  const replay = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/reasoning-nodes/${encodeURIComponent(node.id)}/corrections`,
    {
      method: "POST",
      idempotencyKey: "slice6b-node-correction",
      body: {
        sourceVersionId: node.currentVersionId,
        reviewedStatement: correctedStatement,
        actorId: "cody",
        reason: "The selected wording needed a narrower and explicit representation.",
      },
    },
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.version.id, correction.value.version.id);

  const conflict = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/reasoning-nodes/${encodeURIComponent(node.id)}/corrections`,
    {
      method: "POST",
      idempotencyKey: "slice6b-node-correction",
      body: {
        sourceVersionId: node.currentVersionId,
        reviewedStatement: "Conflicting correction content.",
        actorId: "cody",
        reason: "Different request.",
      },
    },
  );
  assert.equal(conflict.response.status, 409);
  assert.match(conflict.value.error, /idempotency key conflicts/i);

  const detail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/inspect/reasoning/${encodeURIComponent(node.id)}`,
  );
  assert.equal(detail.response.status, 200);
  assert.equal(detail.value.node.currentVersionId, correction.value.version.id);
  assert.equal(detail.value.versions.length, 2);
  assert.equal(detail.value.versions[0].id, node.currentVersionId);
  assert.equal(detail.value.correctionHistory.at(-1).id, correction.value.governanceEvent.id);
  const generic = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/records/reasoning_nodes/${encodeURIComponent(node.id)}`,
  );
  assert.equal(generic.value.value.current_version_id, correction.value.version.id);
  const crossProject = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/inspect/reasoning/${encodeURIComponent(node.id)}`,
  );
  assert.equal(crossProject.response.status, 404);
});

test("Slice 6B Contextual Add maps to canonical records with receipts, isolation, and no authority promotion", async () => {
  const worker = await builtWorker("slice6b-contextual-add");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  const seeded = await seedSlice3Case(worker, DB, "slice6b contextual", ["observation"]);

  const addedCase = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-case",
    body: {
      type: "case",
      objective: "A bounded case created through Contextual Add",
      conversationId: seeded.conversationId,
      actorId: "cody",
      sourceReference: "user_supplied_contextual_capture",
    },
  });
  assert.equal(addedCase.response.status, 201, JSON.stringify(addedCase.value));
  assert.equal(addedCase.value.receipt.recordType, "case");
  assert.equal(addedCase.value.receipt.retrievalChanged, false);
  assert.equal(addedCase.value.receipt.authority, "observed");

  const observationBody = {
    type: "observation",
    content: "A directly supplied observation stays observed until a separate governance action.",
    conversationId: seeded.conversationId,
    caseId: seeded.caseId,
    representation: "Reconstructed",
    actorId: "cody",
    sourceReference: "manual://slice6b-observation",
    reason: "Preserve local context without promoting it.",
  };
  const observation = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-observation",
    body: observationBody,
  });
  assert.equal(observation.response.status, 201, JSON.stringify(observation.value));
  assert.equal(observation.value.record.authority_state, "observed");
  assert.equal(observation.value.receipt.representation, "Reconstructed");
  assert.equal(observation.value.receipt.retrievalChanged, false);
  assert.match(observation.value.receipt.retrievalReason, /no consequential meaning was approved/i);

  const exactContent = "Exact Contextual Add source is preserved from this canonical message.";
  const exactMessage = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(seeded.conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "slice6b-contextual-exact-message",
      body: { actorType: "user", actorId: "cody", content: exactContent },
    },
  );
  const exactCapture = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-exact",
    body: {
      type: "research_evidence",
      content: exactContent,
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      representation: "Exact",
      sourceMessageId: exactMessage.value.message.id,
      sourceStart: 0,
      sourceEnd: exactContent.length,
      actorId: "cody",
      reason: "Preserve exact native evidence.",
    },
  });
  assert.equal(exactCapture.response.status, 201, JSON.stringify(exactCapture.value));
  assert.equal(exactCapture.value.receipt.representation, "Exact");
  assert.deepEqual(JSON.parse(exactCapture.value.record.source_message_ids), [exactMessage.value.message.id]);
  const unsupportedExact = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-invalid-exact",
    body: {
      type: "observation",
      content: "This has no canonical message span.",
      conversationId: seeded.conversationId,
      representation: "Exact",
      actorId: "cody",
      reason: "This should fail honestly.",
    },
  });
  assert.equal(unsupportedExact.response.status, 400);
  assert.match(unsupportedExact.value.error, /Exact representation requires a canonical source-message span/i);

  const replay = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-observation",
    body: observationBody,
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.record.id, observation.value.record.id);

  const outcome = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-outcome",
    body: {
      type: "outcome",
      content: "The observed outcome is recorded without automatically creating a mechanism.",
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      representation: "Reconstructed",
      actorId: "cody",
      reason: "Record reality contact.",
    },
  });
  assert.equal(outcome.response.status, 201, JSON.stringify(outcome.value));
  const caseRead = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/cases/${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(caseRead.value.case.outcomeState, "recorded");
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get("sports").count,
    0,
  );

  const proposedConnection = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "slice6b-contextual-connection",
    body: {
      type: "proposed_connection",
      content: "This relationship is proposed and remains non-authoritative.",
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      targetType: "case",
      targetId: addedCase.value.record.id,
      actorId: "cody",
      reason: "Suggest a relationship for later review.",
    },
  });
  assert.equal(proposedConnection.response.status, 201);
  assert.equal(proposedConnection.value.receipt.authority, "proposed");
  assert.equal(proposedConnection.value.receipt.retrievalChanged, false);

  const crossProject = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/records/events/${encodeURIComponent(observation.value.record.id)}`,
  );
  assert.equal(crossProject.response.status, 404);
  const unauthorized = await worker.fetch(new Request(
    "http://localhost/api/v1/projects/sports/contextual-add",
    {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "slice6b-unauthorized" },
      body: JSON.stringify(observationBody),
    },
  ), { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key" }, ctx);
  assert.equal(unauthorized.status, 401);
});

test("Dogfood Exact Contextual Add UI contract preserves canonical message spans and isolation", async () => {
  const worker = await builtWorker("dogfood-exact-contextual-add");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");

  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Native exact-source dogfood contract" },
  });
  const otherConversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Another Sports Engine conversation" },
  });
  const hockeyConversation = await slice2Request(worker, DB, "/api/v1/projects/hockey/conversations", {
    method: "POST",
    body: { title: "Hockey isolation source" },
  });
  const conversationId = conversation.value.conversation.id;
  const exactContent = "First exact clause. Second exact clause / with reserved: characters?";
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "dogfood-exact-source-message",
      body: {
        actorType: "user",
        actorId: "cody",
        content: exactContent,
        originalTimestamp: "2026-07-31T14:00:00-05:00",
      },
    },
  );
  const hockeyMessage = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/conversations/${encodeURIComponent(hockeyConversation.value.conversation.id)}/messages`,
    {
      method: "POST",
      idempotencyKey: "dogfood-cross-project-source-message",
      body: { actorType: "user", actorId: "cody", content: "Project-isolated hockey source." },
    },
  );
  const caseResult = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: "Verify exact native event capture through Contextual Add",
      conversationId,
      makeActive: true,
      actorId: "cody",
    },
  });
  const shared = {
    type: "observation",
    conversationId,
    caseId: caseResult.value.case.id,
    representation: "Exact",
    sourceMessageId: message.value.message.id,
    actorId: "cody",
    reason: "Dogfood exact-source UI contract.",
  };

  const fullMessage = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-full-message",
    body: {
      ...shared,
      content: exactContent,
      sourceStart: 0,
      sourceEnd: exactContent.length,
    },
  });
  assert.equal(fullMessage.response.status, 201, JSON.stringify(fullMessage.value));
  assert.equal(fullMessage.value.record.exact_source_span, exactContent);
  assert.equal(fullMessage.value.record.authority_state, "observed");
  assert.equal(fullMessage.value.receipt.representation, "Exact");
  assert.equal(fullMessage.value.receipt.authority, "observed");
  assert.equal(fullMessage.value.receipt.source, "Canonical message span");
  assert.deepEqual(fullMessage.value.receipt.sourceLineage, {
    messageId: message.value.message.id,
    start: 0,
    end: exactContent.length,
    href: `/projects/sports/conversations/${encodeURIComponent(conversationId)}#${encodeURIComponent(`message-${message.value.message.id}`)}`,
  });

  const substring = "Second exact clause / with reserved: characters?";
  const substringStart = exactContent.indexOf(substring);
  const substringCapture = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-substring",
    body: {
      ...shared,
      type: "research_evidence",
      content: substring,
      sourceStart: substringStart,
      sourceEnd: substringStart + substring.length,
    },
  });
  assert.equal(substringCapture.response.status, 201, JSON.stringify(substringCapture.value));
  assert.equal(substringCapture.value.record.exact_source_span, substring);
  assert.deepEqual(
    JSON.parse(substringCapture.value.record.metadata).sourceSpans[0],
    {
      id: JSON.parse(substringCapture.value.record.metadata).sourceSpans[0].id,
      messageId: message.value.message.id,
      start: substringStart,
      end: substringStart + substring.length,
    },
  );

  const mismatch = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-mismatch",
    body: { ...shared, content: "Rewritten instead of exact.", sourceStart: 0, sourceEnd: exactContent.length },
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.value.error, /does not match the exact source span/i);

  const missingMessage = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-missing-message",
    body: {
      type: "observation",
      conversationId,
      representation: "Exact",
      content: exactContent,
      actorId: "cody",
    },
  });
  assert.equal(missingMessage.response.status, 400);
  assert.match(missingMessage.value.error, /canonical source-message span/i);

  const crossProjectMessage = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-cross-project-message",
    body: {
      ...shared,
      sourceMessageId: hockeyMessage.value.message.id,
      content: "Project-isolated hockey source.",
      sourceStart: 0,
      sourceEnd: "Project-isolated hockey source.".length,
    },
  });
  assert.equal(crossProjectMessage.response.status, 404);
  assert.match(crossProjectMessage.value.error, /source message not found/i);

  const wrongConversation = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-wrong-conversation",
    body: {
      ...shared,
      caseId: undefined,
      conversationId: otherConversation.value.conversation.id,
      content: exactContent,
      sourceStart: 0,
      sourceEnd: exactContent.length,
    },
  });
  assert.equal(wrongConversation.response.status, 404);
  assert.match(wrongConversation.value.error, /source message not found/i);

  const noConversation = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-exact-no-conversation",
    body: {
      ...shared,
      conversationId: undefined,
      content: exactContent,
      sourceStart: 0,
      sourceEnd: exactContent.length,
    },
  });
  assert.equal(noConversation.response.status, 400);
  assert.match(noConversation.value.error, /selected canonical conversation/i);

  const reconstructedContent = "Reconstructed capture remains available and does not require a source span.";
  const reconstructed = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "dogfood-reconstructed-regression",
    body: {
      type: "observation",
      conversationId,
      caseId: caseResult.value.case.id,
      representation: "Reconstructed",
      content: reconstructedContent,
      actorId: "cody",
      reason: "Preserve existing reconstructed behavior.",
    },
  });
  assert.equal(reconstructed.response.status, 201, JSON.stringify(reconstructed.value));
  assert.equal(reconstructed.value.receipt.representation, "Reconstructed");
  assert.equal(reconstructed.value.receipt.sourceLineage, null);

  const refreshed = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.value.messages[0].exactContent, exactContent);
  assert.equal(refreshed.value.messages[0].contentHash, message.value.message.contentHash);
  const refreshedFull = refreshed.value.events.find((record) => record.id === fullMessage.value.record.id);
  assert.equal(refreshedFull.exactSourceSpan, exactContent);
  assert.equal(refreshedFull.metadata.representationType, "Exact");
  assert.equal(refreshedFull.authority, "observed");
  assert.equal(refreshedFull.sourceLinks[0].messageId, message.value.message.id);
  assert.equal(refreshedFull.sourceLinks[0].span.start, 0);
  assert.equal(refreshedFull.sourceLinks[0].span.end, exactContent.length);
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get("sports").count,
    0,
  );
  assert.equal(
    DB.database.prepare("SELECT exact_content FROM messages WHERE id = ?").get(message.value.message.id).exact_content,
    exactContent,
  );

  const contextualAddSource = await readFile(
    new URL("../app/components/contextual-add.tsx", import.meta.url),
    "utf8",
  );
  for (const requiredUiContract of [
    '<option value="Exact">Exact</option>',
    "sourceMessageId",
    "sourceStart",
    "sourceEnd",
    "Exact selected text",
    "What happened must match the exact selected source span",
    "Exact source lineage",
  ]) {
    assert.match(contextualAddSource, new RegExp(requiredUiContract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Exact Contextual Add preserves boundary and internal whitespace byte-for-byte", async () => {
  const worker = await builtWorker("dogfood-exact-whitespace");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");

  const conversation = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Exact whitespace preservation" },
  });
  const conversationId = conversation.value.conversation.id;
  const caseResult = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: "Preserve exact whitespace without promoting authority",
      conversationId,
      makeActive: true,
      actorId: "cody",
    },
  });
  const caseId = caseResult.value.case.id;

  async function preserveExact(label, content) {
    const message = await slice2Request(
      worker,
      DB,
      `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        idempotencyKey: `exact-whitespace-message-${label}`,
        body: { actorType: "user", actorId: "cody", content },
      },
    );
    assert.equal(message.response.status, 201, JSON.stringify(message.value));
    assert.equal(message.value.message.exactContent, content);

    const capture = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
      method: "POST",
      idempotencyKey: `exact-whitespace-event-${label}`,
      body: {
        type: "observation",
        conversationId,
        caseId,
        representation: "Exact",
        sourceMessageId: message.value.message.id,
        sourceStart: 0,
        sourceEnd: content.length,
        content,
        actorId: "cody",
        reason: "Exact whitespace preservation contract.",
      },
    });
    assert.equal(capture.response.status, 201, JSON.stringify(capture.value));
    assert.equal(capture.value.record.exact_source_span, content);
    assert.equal(capture.value.record.authority_state, "observed");
    assert.equal(capture.value.receipt.representation, "Exact");
    assert.equal(capture.value.receipt.authority, "observed");
    assert.equal(capture.value.receipt.retrievalChanged, false);
    assert.deepEqual(capture.value.receipt.sourceLineage, {
      messageId: message.value.message.id,
      start: 0,
      end: content.length,
      href: `/projects/sports/conversations/${encodeURIComponent(conversationId)}#${encodeURIComponent(`message-${message.value.message.id}`)}`,
    });
    assert.equal(
      DB.database.prepare("SELECT exact_source_span FROM events WHERE id = ?").get(capture.value.record.id).exact_source_span,
      content,
    );
    return { message, capture };
  }

  const exactCases = [
    ["ending-newline", "Full message ending with a newline\n"],
    ["beginning-whitespace", " \tFull message beginning with whitespace"],
    ["boundary-spaces", "  Leading and trailing spaces  "],
    ["tabs", "Tabs\tremain\tunchanged\t"],
    ["multi-line", "First line\nSecond line\nThird line\n"],
    ["repeated-internal", "Repeated   internal\t\twhitespace stays"],
    ["unicode", "Unicode — punctuation, café, 中文, and 🙂 remain exact\n"],
  ];
  for (const [label, content] of exactCases) await preserveExact(label, content);

  const substringMessageContent = "prefix|\t selected exact substring \n|suffix";
  const substringMessage = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "exact-whitespace-substring-message",
      body: { actorType: "user", actorId: "cody", content: substringMessageContent },
    },
  );
  const substring = "\t selected exact substring \n";
  const substringStart = substringMessageContent.indexOf(substring);
  const substringCapture = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "exact-whitespace-substring-event",
    body: {
      type: "correction",
      conversationId,
      caseId,
      representation: "Exact",
      sourceMessageId: substringMessage.value.message.id,
      sourceStart: substringStart,
      sourceEnd: substringStart + substring.length,
      content: substring,
      actorId: "cody",
    },
  });
  assert.equal(substringCapture.response.status, 201, JSON.stringify(substringCapture.value));
  assert.equal(substringCapture.value.record.exact_source_span, substring);
  assert.equal(substringCapture.value.receipt.retrievalChanged, false);

  const mismatchSource = "One-character mismatch ";
  const mismatchMessage = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      idempotencyKey: "exact-whitespace-mismatch-message",
      body: { actorType: "user", actorId: "cody", content: mismatchSource },
    },
  );
  const mismatch = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
    method: "POST",
    idempotencyKey: "exact-whitespace-mismatch-event",
    body: {
      type: "correction",
      conversationId,
      caseId,
      representation: "Exact",
      sourceMessageId: mismatchMessage.value.message.id,
      sourceStart: 0,
      sourceEnd: mismatchSource.length,
      content: `${mismatchSource.slice(0, -1)}!`,
      actorId: "cody",
    },
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.value.error, /does not match the exact source span/i);

  for (const representation of ["Reconstructed", "Compressed"]) {
    const freeText = await slice2Request(worker, DB, "/api/v1/projects/sports/contextual-add", {
      method: "POST",
      idempotencyKey: `exact-whitespace-${representation.toLowerCase()}-regression`,
      body: {
        type: "observation",
        conversationId,
        caseId,
        representation,
        content: `  ${representation} free text remains trimmed where appropriate. \n`,
        actorId: "cody",
      },
    });
    assert.equal(freeText.response.status, 201, JSON.stringify(freeText.value));
    assert.equal(freeText.value.record.exact_source_span, `${representation} free text remains trimmed where appropriate.`);
    assert.equal(freeText.value.receipt.representation, representation);
    assert.equal(freeText.value.receipt.retrievalChanged, false);
  }

  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get("sports").count,
    0,
  );
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM governance_events WHERE project_id = ?").get("sports").count,
    0,
  );
});

test("Slice 6B Inspect and Structure return the same project-scoped canonical snapshots as direct APIs", async () => {
  const worker = await builtWorker("slice6b-inspect-parity");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  const seeded = await seedSlice3Case(worker, DB, "slice6b inspect", ["evidence", "challenge", "outcome"]);
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice6b-inspect-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
      source: "slice6b_contract",
      findingCandidates: [],
    },
  });
  assert.equal(checkpoint.response.status, 201);

  const overview = await slice2Request(worker, DB, "/api/v1/projects/sports/inspect");
  assert.equal(overview.response.status, 200, JSON.stringify(overview.value));
  assert.ok(overview.value.cases.some((record) => record.id === seeded.caseId));
  assert.equal(
    overview.value.cases.find((record) => record.id === seeded.caseId).reasoningHealth.state,
    "Conflict",
  );
  assert.ok(overview.value.reasoning.some((record) => record.id === checkpoint.value.selectedNodes[0].id));
  assert.deepEqual(overview.value.principles, []);
  assert.match(overview.value.principlesNote, /No stable canonical principle record/i);
  assert.ok(Array.isArray(overview.value.advanced.relationships));

  const caseDetail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/inspect/cases/${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(caseDetail.response.status, 200, JSON.stringify(caseDetail.value));
  assert.equal(caseDetail.value.case.id, seeded.caseId);
  assert.equal(caseDetail.value.events.length, seeded.events.length);
  assert.equal(caseDetail.value.reasoning.length, checkpoint.value.selectedNodes.length);
  assert.ok(caseDetail.value.conversations.some((record) => record.id === seeded.conversationId));

  const structure = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(seeded.conversationId)}/structure`,
  );
  assert.equal(structure.response.status, 200, JSON.stringify(structure.value));
  assert.equal(structure.value.conversation.id, seeded.conversationId);
  assert.equal(structure.value.cases[0].case.id, seeded.caseId);
  assert.deepEqual(
    structure.value.cases[0].events.map((record) => record.id),
    caseDetail.value.events.map((record) => record.id),
  );

  const crossProjectCase = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/inspect/cases/${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(crossProjectCase.response.status, 404);
  const crossProjectStructure = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/conversations/${encodeURIComponent(seeded.conversationId)}/structure`,
  );
  assert.equal(crossProjectStructure.response.status, 404);
});

test("Slice 6B interface remains canonical and explicit beneath the Slice 6C Ask completion", async () => {
  const [
    queue,
    review,
    inspect,
    structure,
    contextualAdd,
    shell,
    ask,
    service,
  ] = await Promise.all([
    readFile(new URL("../app/projects/[projectId]/findings/finding-queue.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/findings/[findingId]/finding-review.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/inspect/inspect-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/conversations/[conversationId]/structure/structure-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/contextual-add.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/project-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/stewardship-mutations.ts", import.meta.url), "utf8"),
  ]);
  for (const label of ["Needs review", "Deferred", "Awaiting outcome", "Conflict-related", "Recently resolved"]) {
    assert.match(queue, new RegExp(label));
  }
  for (const text of [
    "Atlas’s original proposal",
    "Cody’s current reviewed wording",
    "Exact wording difference",
    "Reject this proposal and suppress unchanged resurfacing",
    "Deferral has no authoritative retrieval effect",
    "Roll back this governance event while preserving history",
  ]) {
    assert.match(review, new RegExp(text.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")));
  }
  for (const tab of ["Cases", "Reasoning", "Mechanisms", "Principles", "Blueprint", "Packets", "Advanced"]) {
    assert.match(inspect, new RegExp(`"${tab}"`));
  }
  for (const action of ["Mark event chat-only", "Leave event unassigned", "Propose split", "Propose merge"]) {
    assert.match(structure, new RegExp(action));
  }
  for (const type of ["Case", "Research or evidence", "Outcome", "Correction", "Challenge", "Observation", "Proposed connection"]) {
    assert.match(contextualAdd, new RegExp(type));
  }
  assert.match(shell, /ContextualAdd/);
  assert.match(service, /wording_corrected_no_authority_promotion/);
  assert.match(service, /No consequential meaning was approved by this capture/);
  assert.doesNotMatch(`${queue}\n${review}\n${inspect}\n${structure}\n${contextualAdd}`, /England|Ghana|makeSeedState/i);
  assert.doesNotMatch(ask, /England|Ghana|seeded answer|makeSeedState/i);
});

test("Exact-source navigation uses one reserved-character-safe message anchor with delayed scroll and highlighting", async () => {
  const [
    anchorContract,
    conversationWorkspace,
    conversationStyles,
    contextualAdd,
    conversationService,
    checkpointService,
    stewardshipService,
    inspectService,
  ] = await Promise.all([
    readFile(new URL("../shared/message-anchors.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/conversations/[conversationId]/workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/conversations/conversation.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/contextual-add.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/conversation-cases.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/checkpoint-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/stewardship-mutations.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/inspect-service.ts", import.meta.url), "utf8"),
  ]);

  const canonicalMessageId = "message:source / v1?part=1#exact&raw=true";
  const domId = `message-${canonicalMessageId}`;
  const fragment = `#${encodeURIComponent(domId)}`;
  assert.equal(decodeURIComponent(fragment.slice(1)), domId);
  assert.equal(canonicalMessageId, domId.slice("message-".length));

  assert.match(anchorContract, /MESSAGE_ANCHOR_PREFIX = "message-"/);
  assert.match(anchorContract, /encodeURIComponent\(messageAnchorId\(messageId\)\)/);
  assert.match(anchorContract, /decodeURIComponent\(hash\.slice\(1\)\)/);
  assert.match(conversationWorkspace, /id=\{messageAnchorId\(message\.id\)\}/);
  assert.doesNotMatch(conversationWorkspace, /id=\{`message-\$\{encodeURIComponent\(message\.id\)\}`\}/);
  assert.match(conversationWorkspace, /requestAnimationFrame\(revealExactMessage\)/);
  assert.ok(
    conversationWorkspace.indexOf("document.getElementById(messageAnchorId(messageId))")
      < conversationWorkspace.indexOf("target.scrollIntoView"),
    "scroll must occur only after the canonical message element exists",
  );
  assert.match(conversationWorkspace, /addEventListener\("hashchange", revealExactMessage\)/);
  assert.match(conversationWorkspace, /removeEventListener\("hashchange", revealExactMessage\)/);
  assert.match(conversationWorkspace, /target\.dataset\.sourceTarget = "true"/);
  assert.match(conversationStyles, /\.message:target/);
  assert.match(conversationStyles, /\.message\[data-source-target="true"\]/);

  assert.match(contextualAdd, /href=\{receipt\.sourceLineage\.href\}/);
  assert.match(conversationWorkspace, /href=\{link\.href\}/);
  for (const source of [conversationService, checkpointService, stewardshipService, inspectService]) {
    assert.match(source, /messageAnchor(?:Fragment|Href)/);
    assert.doesNotMatch(source, /#message-\$\{encodeURIComponent/);
  }
});

async function initializeRoadways(worker, DB, projectId) {
  const result = await slice2Request(worker, DB, `/api/v1/projects/${projectId}/roadways`);
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  assert.equal(result.value.roadways.length, 3);
  return result.value.roadways;
}

async function continuityRequest(worker, DB, projectId, body) {
  const response = await worker.fetch(new Request(
    `http://localhost/api/v1/projects/${encodeURIComponent(projectId)}/continuity/check`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ), {
    DB,
    ASSETS: assets,
    CAMPUS_ATLAS_ACTION_KEY: "configured-but-not-supplied-for-read",
  }, ctx);
  return { response, value: await response.json() };
}

function canonicalMutationCounts(DB) {
  const tables = [
    "projects",
    "conversations",
    "conversation_imports",
    "messages",
    "events",
    "cases",
    "case_event_attachments",
    "reasoning_nodes",
    "reasoning_node_versions",
    "checkpoints",
    "checkpoint_reasoning_nodes",
    "findings",
    "finding_versions",
    "mechanisms",
    "mechanism_versions",
    "governance_events",
    "roadways",
    "roadway_versions",
    "live_state_snapshots",
    "packets",
    "packet_items",
    "receipts",
    "handoffs",
    "handoff_lifecycle_events",
    "handoff_answers",
    "handoff_receipts",
  ];
  return Object.fromEntries(tables.map((table) => [
    table,
    DB.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

async function createContinuityCase(worker, DB, projectId, suffix, objective) {
  const conversation = await slice2Request(worker, DB, `/api/v1/projects/${projectId}/conversations`, {
    method: "POST",
    body: { title: `Continuity ${suffix}` },
  });
  assert.equal(conversation.response.status, 201, JSON.stringify(conversation.value));
  const caseResult = await slice2Request(worker, DB, `/api/v1/projects/${projectId}/cases`, {
    method: "POST",
    body: {
      objective,
      conversationId: conversation.value.conversation.id,
      makeActive: true,
      actorId: "cody",
    },
  });
  assert.equal(caseResult.response.status, 201, JSON.stringify(caseResult.value));
  return {
    conversationId: conversation.value.conversation.id,
    caseId: caseResult.value.case.id,
  };
}

test("V1.7.1 continuity/check exposes the additive OpenAPI contract without relabeling V4.6", async () => {
  const worker = await builtWorker("v171-continuity-openapi");
  const DB = memoryD1();
  const response = await worker.fetch(
    new Request("http://localhost/.well-known/openapi.json"),
    { DB, ASSETS: assets },
    ctx,
  );
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.info.version, "4.6.0");
  const operation = spec.paths["/api/v1/projects/{projectId}/continuity/check"].post;
  assert.equal(operation.operationId, "checkCanonicalContinuity");
  assert.equal(
    operation.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/ContinuityCheckRequest",
  );
  assert.deepEqual(
    spec.components.schemas.ContinuityCheckRequest.properties.tokenBudget.enum,
    [400, 800, 1600],
  );
  assert.deepEqual(
    spec.components.schemas.ContinuityCheckResponse.properties.need.properties.level.enum,
    ["none", "light", "full"],
  );
  assert.equal(
    spec.components.schemas.ContinuityCheckResponse.properties.effects.properties.packetCreated.const,
    false,
  );
});

test("V1.7.1 continuity/check records deterministic outcomes for all five architecture stress cases", async () => {
  const expected = {
    broadBestBet: {
      need: "full",
      roadway: "Broad Lock-Finding",
      status: "missing_required_state",
      requiredChecks: 5,
    },
    upperAB: {
      need: "full",
      roadway: "Broad Lock-Finding",
      governingMechanisms: 1,
      gateState: ["current_schedule", "soreness_severity", "injury_status", "recent_load", "available_equipment"],
    },
    mobileCodex: {
      need: "light",
      candidatePreviewInvoked: false,
      exactSourcesOpened: 0,
    },
    brewers: {
      need: "full",
      roadway: "Outcome / Postmortem",
      representation: "Reconstructed",
      historicalRawTranscriptStatus: "unavailable_cannot_truthfully_reconstruct",
    },
    soccer: {
      need: "full",
      roadway: "Broad Lock-Finding",
      governingMechanisms: 1,
      gateState: ["current_price", "game_state", "territory_signal", "chance_creation", "transition_risk"],
    },
  };

  {
    const worker = await builtWorker("v171-stress-broad-best-bet");
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const before = canonicalMutationCounts(DB);
    const result = await continuityRequest(worker, DB, "sports", { task: "Any best bets today?" });
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.need.level, expected.broadBestBet.need);
    assert.equal(result.value.roadway.primary.name, expected.broadBestBet.roadway);
    assert.equal(result.value.status, expected.broadBestBet.status);
    assert.equal(result.value.continuity.requiredChecks, expected.broadBestBet.requiredChecks);
    assert.deepEqual(result.value.freshness.missing.sort(), ["current_price", "market_availability", "participant_status"].sort());
    assert.equal(result.value.effects.canonicalMutationPerformed, false);
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const worker = await builtWorker("v171-stress-upper-ab");
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "training", "Training Engine");
    await initializeRoadways(worker, DB, "training");
    const boundedCase = await createContinuityCase(
      worker,
      DB,
      "training",
      "upper-ab",
      "Compare today's Upper A and Upper B training options while preserving their distinct purpose.",
    );
    seedSlice4Mechanism(DB, {
      id: "mechanism:upper-ab-purpose",
      projectId: "training",
      statement: "Compare training options while preserving the distinct purpose of Upper A and Upper B; sore traps constrain today's selection without rewriting the program.",
      authority: "approved_local",
      supportingCaseIds: [boundedCase.caseId],
    });
    const before = canonicalMutationCounts(DB);
    const result = await continuityRequest(worker, DB, "training", {
      task: "What's training today? My traps are sore.",
      caseId: boundedCase.caseId,
      roadwayOverride: "broad-lock-finding",
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.need.level, expected.upperAB.need);
    assert.equal(result.value.roadway.primary.name, expected.upperAB.roadway);
    assert.equal(result.value.continuity.governingMechanisms, expected.upperAB.governingMechanisms);
    for (const category of expected.upperAB.gateState) assert.ok(result.value.freshness.gateRequired.includes(category));
    assert.equal(result.value.interpretation.literalRequest, "What's training today? My traps are sore.");
    assert.equal(result.value.interpretation.caseObjective, "Compare today's Upper A and Upper B training options while preserving their distinct purpose.");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const worker = await builtWorker("v171-stress-mobile-codex");
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "workflow", "Workflow Engine");
    await initializeRoadways(worker, DB, "workflow");
    const preference = "When Cody requests a Codex-ready transfer from mobile, use concise plain text that can be copied directly; this does not suppress visual teaching in other contexts.";
    seedSlice4Mechanism(DB, {
      id: "mechanism:mobile-codex-transfer",
      projectId: "workflow",
      statement: preference,
    });
    const before = canonicalMutationCounts(DB);
    const result = await continuityRequest(worker, DB, "workflow", {
      task: "Prepare a Codex-ready transfer from mobile.",
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.need.level, expected.mobileCodex.need);
    assert.equal(result.value.compactCapsule.statement, preference);
    assert.equal(result.value.diagnostics.candidatePreviewInvoked, expected.mobileCodex.candidatePreviewInvoked);
    assert.equal(result.value.diagnostics.exactSourcesOpened, expected.mobileCodex.exactSourcesOpened);
    assert.equal(result.value.effects.packetCreated, false);
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const worker = await builtWorker("v171-stress-brewers-contradiction");
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const artifactText = "The Brewers reconstruction preserves the late workload contradiction and the insufficient rerank lesson. It does not establish a simplistic strong-team-versus-weak-team rule.";
    const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
      method: "POST",
      idempotencyKey: "v171-brewers-reconstruction",
      body: {
        format: "text",
        title: "Brewers workload contradiction and insufficient rerank lesson",
        sourceName: "V1.7 stress reconstruction",
        sourceType: "user_supplied_case_reconstruction",
        representationType: "Reconstructed",
        authorityState: "observed",
        importId: "v171-brewers-stress-reconstruction",
        transcript: artifactText,
        provenance: {
          historicalRawTranscriptStatus: "unavailable_cannot_truthfully_reconstruct",
          originalRawTranscriptAvailable: false,
          notExactTranscript: true,
        },
      },
    });
    assert.equal(imported.response.status, 201, JSON.stringify(imported.value));
    seedSlice4Mechanism(DB, {
      id: "mechanism:brewers-workload-rerank",
      statement: "A late workload contradiction affecting a pitcher prop should trigger a genuine rerank or pass rather than a cosmetic confidence change.",
    });
    seedSlice4Mechanism(DB, {
      id: "mechanism:simplistic-strong-team",
      statement: "A strong team against a weak team is sufficient reason to prefer every related market.",
    });
    const before = canonicalMutationCounts(DB);
    const body = { task: "Use the Brewers lesson for this pitcher prop." };
    const result = await continuityRequest(worker, DB, "sports", body);
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.need.level, expected.brewers.need);
    assert.equal(result.value.roadway.primary.name, expected.brewers.roadway);
    assert.ok(result.value.freshness.required.includes("final_outcome"));
    const direct = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/candidates", {
      method: "POST",
      body,
    });
    assert.equal(direct.response.status, 200, JSON.stringify(direct.value));
    const artifact = Object.values(direct.value.treatmentSummary).flat().find((item) => item.sourceType === "SourceArtifact");
    assert.equal(artifact.representation, expected.brewers.representation);
    assert.equal(artifact.metadata.historicalSourceLimitation, expected.brewers.historicalRawTranscriptStatus);
    const simplistic = direct.value.treatmentSummary.Exclude.find((item) => item.sourceId === "mechanism:simplistic-strong-team");
    assert.ok(simplistic);
    assert.match(simplistic.reason, /does not match the selected task mechanism/i);
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const worker = await builtWorker("v171-stress-soccer-live-entry");
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const boundedCase = await createContinuityCase(
      worker,
      DB,
      "sports",
      "soccer-live-entry",
      "Develop a repeatable rule for deciding when to enter live on a soccer favorite by balancing early control signals against the risk of the price getting worse.",
    );
    const statement = "Before entering live on a soccer favorite, require sustained territory, credible chance creation, and controlled transition risk. If the price exceeds a preset maximum before those signals appear, pass rather than chase. The confirmation rule remains provisional until it is determined whether it should be time-based, game-state-based, or both.";
    seedSlice4Mechanism(DB, {
      id: "mechanism:soccer-live-entry",
      statement,
      authority: "approved_local",
      supportingCaseIds: [boundedCase.caseId],
    });
    const before = canonicalMutationCounts(DB);
    const body = {
      task: "Should I enter this favorite now or wait?",
      caseId: boundedCase.caseId,
      roadwayOverride: "broad-lock-finding",
    };
    const result = await continuityRequest(worker, DB, "sports", body);
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.need.level, expected.soccer.need);
    assert.equal(result.value.roadway.primary.name, expected.soccer.roadway);
    assert.equal(result.value.continuity.governingMechanisms, expected.soccer.governingMechanisms);
    for (const category of expected.soccer.gateState) assert.ok(result.value.freshness.gateRequired.includes(category));
    assert.equal(result.value.status, "missing_required_state");
    const direct = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/candidates", {
      method: "POST",
      body,
    });
    assert.equal(direct.response.status, 200, JSON.stringify(direct.value));
    assert.equal(result.value.roadway.primary.id, direct.value.interpretation.primaryRoadway.id);
    assert.equal(result.value.interpretation.scope, direct.value.interpretation.scope);
    assert.equal(result.value.roadway.materialAmbiguity, direct.value.interpretation.materialAmbiguity);
    assert.deepEqual(result.value.treatmentCounts, {
      Use: direct.value.treatmentSummary.Use.length,
      Consider: direct.value.treatmentSummary.Consider.length,
      Exclude: direct.value.treatmentSummary.Exclude.length,
    });
    assert.deepEqual(result.value.freshness.engineMissing, direct.value.freshness.missing);
    assert.equal(direct.value.treatmentSummary.Use[0].statement, statement);
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }
});

test("V1.7.1 continuity/check keeps none/light/full read-only, isolated, and server-owned", async () => {
  const worker = await builtWorker("v171-continuity-contracts");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  await initializeRoadways(worker, DB, "sports");
  await initializeRoadways(worker, DB, "hockey");
  const boundedCase = await createContinuityCase(
    worker,
    DB,
    "sports",
    "isolation",
    "Compare soccer live-entry options within Sports Engine.",
  );
  seedSlice4Mechanism(DB, {
    id: "mechanism:sports-only-continuity",
    statement: "Compare soccer live-entry options by price, chance creation, and transition risk.",
    authority: "approved_local",
    supportingCaseIds: [boundedCase.caseId],
  });
  const before = canonicalMutationCounts(DB);

  const none = await continuityRequest(worker, DB, "sports", {
    task: "Convert four inches to centimeters.",
  });
  assert.equal(none.response.status, 200);
  assert.equal(none.value.need.level, "none");
  assert.equal(none.value.diagnostics.candidatePreviewInvoked, false);
  assert.equal(none.value.diagnostics.exactSourcesOpened, 0);
  assert.equal(none.value.next.action, "proceed_without_atlas");

  const injected = await continuityRequest(worker, DB, "sports", {
    task: "Compare soccer live-entry options.",
    caseId: boundedCase.caseId,
    caseObjective: "Client-authored baseball objective",
  });
  assert.equal(injected.response.status, 400);
  assert.match(injected.value.error, /unsupported client-authored continuity field/i);

  const crossProject = await continuityRequest(worker, DB, "hockey", {
    task: "Compare soccer live-entry options.",
    caseId: boundedCase.caseId,
    roadwayOverride: "broad-lock-finding",
  });
  assert.equal(crossProject.response.status, 404);
  assert.match(crossProject.value.error, /case not found/i);

  assert.deepEqual(canonicalMutationCounts(DB), before);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM packets").get().count, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
});

test("V1.7.1 continuity/check never initializes missing canonical roadways during a read", async () => {
  const worker = await builtWorker("v171-continuity-read-only-roadways");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const before = canonicalMutationCounts(DB);
  const result = await continuityRequest(worker, DB, "sports", { task: "Any best bets today?" });
  assert.equal(result.response.status, 500);
  assert.match(result.value.error, /roadway registry is unavailable/i);
  assert.deepEqual(canonicalMutationCounts(DB), before);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM roadways").get().count, 0);
});
