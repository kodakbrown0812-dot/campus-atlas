Warning: truncated output (original token count: 43959)
Total output lines: 3871

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

async function seedSlice3Case(worker, DB, suffix, eventTypes) {
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
    const content = `${suffix} exact source ${index}: ${eventTypes[index]}`;
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
  let detail = await slice2Request(worker, DB, `/api/v1/projects/sports/conversations/${conversation…13959 tokens truncated…n = ?, compressed_representation = ? WHERE id = ?",
  ).run(
    "Strong counterexample: outright opponent win remains a plausible margin script.",
    "Strong counterexample: preserve the outright-opponent and one-score paths.",
    challenge.id,
  );
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ?, authority_state = 'inferred' WHERE id = ?",
  ).run(
    "Newer repeated model inference says team quality alone predicts the run-line cover.",
    "Newer model inference repeats that team quality predicts covering.",
    inference.id,
  );

  const primary = seedSlice4Mechanism(DB, {
    id: "mechanism:margin-primary",
    statement: "Separate outright win probability from cover probability using margin distribution, one-score paths, and offered price.",
    supportingCaseIds: [active.caseId],
    counterevidenceIds: [challenge.id],
    realityContact: "Supported by completed margin outcomes.",
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:same-topic-wrong-mechanism",
    statement: "Milwaukee Brewers uniform colors are blue and gold.",
    realityContact: "Same team, unrelated mechanism.",
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:approved-local-elsewhere",
    statement: "For this case only, treat one-score cover risk as decisive for run-line value.",
    authority: "approved_local",
    supportingCaseIds: [outside.caseId],
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:conflict-include",
    statement: "Always include recent favorite cover form when assessing margin value.",
    counterevidenceIds: ["mechanism:conflict-exclude"],
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:conflict-exclude",
    statement: "Never include recent favorite cover form when assessing margin value.",
    counterevidenceIds: ["mechanism:conflict-include"],
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:margin-duplicate-a",
    statement: "Evaluate run-line cover through margin distribution and one-score paths.",
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:margin-duplicate-b",
    statement: "Evaluate run-line cover through margin distribution and one-score paths.",
  });

  const rejectedFindingId = "finding:slice4-rejected";
  const rejectedVersionId = "finding-version:slice4-rejected";
  DB.database.prepare(
    `INSERT INTO findings (
      id, project_id, case_id, checkpoint_id, finding_type, source_event_ids,
      current_version_id, status, authority_state, review_required, created_at, resolved_at
    ) VALUES (?, 'sports', ?, NULL, 'mechanism_recognition', ?, ?, 'rejected', 'rejected', 0, ?, ?)`,
  ).run(
    rejectedFindingId,
    active.caseId,
    JSON.stringify([inference.id]),
    rejectedVersionId,
    "2026-07-20T00:00:00.000Z",
    "2026-07-20T00:00:00.000Z",
  );
  DB.database.prepare(
    `INSERT INTO finding_versions (
      id, project_id, finding_id, proposal_statement, proposed_scope,
      conditions, exclusions, supporting_evidence, counterevidence,
      uncertainty, reason_for_surfacing, expected_retrieval_effect,
      proposal_hash, created_by, created_at, supersedes_version_id
    ) VALUES (?, 'sports', ?, ?, 'project_wide', '[]', '[]', ?, '[]',
              NULL, 'Calibration rejected finding.', 'No retrieval effect.',
              'slice4-rejected-hash', 'atlas', ?, NULL)`,
  ).run(
    rejectedVersionId,
    rejectedFindingId,
    "Repeated team quality should automatically govern run-line cover.",
    JSON.stringify([inference.id]),
    "2026-07-20T00:00:00.000Z",
  );

  const stale = await createLiveState(worker, DB, "sports", "current_price", "superseded", {
    observedAt: "2025-01-01T00:00:00.000Z",
    freshnessWindowSeconds: 60,
    caseId: active.caseId,
  });
  assert.equal(stale.response.status, 201);
  DB.database.prepare(
    "UPDATE live_state_snapshots SET status = 'superseded', superseded_at = ? WHERE id = ?",
  ).run("2025-01-02T00:00:00.000Z", stale.value.snapshot.id);

  const narrow = await createSlice4Packet(worker, DB, {
    task: "Can this favorite win by two, or does the one-score path make the run line too expensive?",
    caseId: active.caseId,
    tokenBudget: 1600,
  }, "slice4-calibration-narrow");
  assert.equal(narrow.response.status, 201, JSON.stringify(narrow.value));
  assert.equal(narrow.value.packet.status, "compiled");
  assert.equal(narrow.value.packet.interpretation.primaryRoadway.name, expectations.different_vocabulary_same_mechanism.expectedRoadway);
  const allTreatments = Object.values(narrow.value.receipt.treatmentSummary).flat();
  const byId = new Map(allTreatments.map((item) => [item.sourceId, item]));
  assert.equal(byId.get(primary.id).treatment, expectations.different_vocabulary_same_mechanism.expectedTreatment);
  assert.equal(
    byId.get("mechanism:same-topic-wrong-mechanism").treatment,
    expectations.same_topic_wrong_mechanism.expectedTreatment,
  );
  assert.equal(
    byId.get("mechanism:approved-local-elsewhere").treatment,
    expectations.approved_local_outside_scope.expectedTreatment,
  );
  assert.equal(byId.get(challenge.id).treatment, expectations.strong_counterexample.expectedTreatment);
  assert.match(byId.get(challenge.id).reason, /counterevidence|challenge/i);
  for (const id of ["mechanism:conflict-include", "mechanism:conflict-exclude"]) {
    assert.equal(byId.get(id).treatment, expectations.conflicting_approved_mechanisms.expectedTreatment);
    assert.equal(byId.get(id).representation, expectations.conflicting_approved_mechanisms.expectedRepresentation);
  }
  assert.equal(byId.get(stale.value.snapshot.id).treatment, expectations.superseded_live_snapshot.expectedTreatment);
  assert.equal(byId.get(rejectedFindingId).treatment, expectations.rejected_resurfacing.expectedTreatment);
  assert.ok(
    ["mechanism:margin-duplicate-a", "mechanism:margin-duplicate-b"]
      .some((id) => byId.get(id).treatment === expectations.redundant_approved_mechanisms.expectedTreatment),
  );
  const considerationOrder = narrow.value.receipt.treatmentSummary.Consider.map((item) => item.sourceId);
  assert.ok(considerationOrder.indexOf(outcome.id) < considerationOrder.indexOf(inference.id));
  assert.ok(considerationOrder.indexOf(correction.id) < considerationOrder.indexOf(inference.id));
  assert.match(narrow.value.packet.compiledContent, /Strong counterexample/i);
  assert.match(
    narrow.value.packet.compiledContent,
    /\[EXCLUDE\] Milwaukee Brewers uniform colors are blue and gold/i,
  );

  const broad = await createSlice4Packet(worker, DB, {
    task: "Compare all available options and rank the strongest candidate on the slate.",
    caseId: active.caseId,
    tokenBudget: 800,
  }, "slice4-calibration-broad");
  assert.equal(broad.response.status, 201);
  assert.equal(broad.value.packet.interpretation.primaryRoadway.name, expectations.broad_then_narrow.expectedBroadRoadway);
  assert.equal(narrow.value.packet.interpretation.primaryRoadway.name, expectations.broad_then_narrow.expectedNarrowRoadway);

  const isolated = await createSlice4Packet(worker, DB, {
    projectId: "hockey",
    task: "Can this favorite win by two, or is the one-score path too large?",
    tokenBudget: 800,
  }, "slice4-project-isolation");
  assert.equal(isolated.response.status, 201);
  const isolatedIds = Object.values(isolated.value.receipt.treatmentSummary).flat().map((item) => item.sourceId);
  assert.equal(isolatedIds.includes(primary.id), false);
});

test("Slice 4 enforces 400, 800, and 1600 budgets, honest failures, idempotency, and immutability", async () => {
  const worker = await builtWorker("slice4-budgets-immutability");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "missing", "Missing State Project");
  await seedCanonicalProject(worker, DB, "overflow", "Minimum Safe Overflow");
  seedSlice4Mechanism(DB, {
    id: "mechanism:budget-margin",
    statement: "Separate outright winning from run-line covering by checking price, margin distribution, and the strongest one-score challenge.",
  });
  for (const category of ["market_availability", "current_price", "participant_status"]) {
    const live = await createLiveState(worker, DB, "sports", category, "budget");
    assert.equal(live.response.status, 201);
  }

  const packetIds = [];
  for (const budget of [400, 800, 1600]) {
    const result = await createSlice4Packet(worker, DB, {
      task: "At the current price tonight, can this favorite cover the -1.5 run line?",
      tokenBudget: budget,
    }, `slice4-budget-${budget}`);
    assert.equal(result.response.status, 201, JSON.stringify(result.value));
    assert.equal(result.value.packet.status, "compiled", JSON.stringify(result.value.packet));
    assert.equal(result.value.packet.tokenBudget, budget);
    assert.ok(result.value.packet.finalTokenCount <= budget);
    assert.equal(result.value.receipt.freshness.safeToCompile, true);
    assert.deepEqual(result.value.receipt.freshness.missing, []);
    packetIds.push(result.value.packet.id);
  }

  const replay = await createSlice4Packet(worker, DB, {
    task: "At the current price tonight, can this favorite cover the -1.5 run line?",
    tokenBudget: 800,
  }, "slice4-budget-800");
  assert.equal(replay.response.status, 200);
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.packet.id, packetIds[1]);

  const invalidBudget = await createSlice4Packet(worker, DB, {
    task: "Can this favorite cover the run line?",
    tokenBudget: 500,
  }, "slice4-budget-invalid");
  assert.equal(invalidBudget.response.status, 400);

  const missing = await createSlice4Packet(worker, DB, {
    projectId: "missing",
    task: "At the current price tonight, can this favorite cover the -1.5 run line?",
    tokenBudget: 800,
  }, "slice4-required-state-missing");
  assert.equal(missing.response.status, 201);
  assert.equal(missing.value.packet.status, "failed");
  assert.match(missing.value.packet.compilationError, /^required_live_state_missing:/);
  assert.equal(missing.value.receipt.freshness.safeToCompile, false);
  assert.ok(missing.value.receipt.freshness.missing.length > 0);
  assert.match(missing.value.packet.compiledContent, /Compilation stopped/);

  const longClause = " while preserving price, distribution, one-score paths, outright-loss scripts, corrections, and counterevidence";
  for (let index = 0; index < 8; index += 1) {
    const id = `mechanism:overflow-${index}`;
    const other = `mechanism:overflow-${index % 2 === 0 ? index + 1 : index - 1}`;
    seedSlice4Mechanism(DB, {
      id,
      projectId: "overflow",
      statement: `${index % 2 === 0 ? "Always include" : "Never include"} margin-cover evidence ${index}${longClause.repeat(3)}.`,
      counterevidenceIds: [other],
    });
  }
  const overflow = await createSlice4Packet(worker, DB, {
    projectId: "overflow",
    task: "Can the favorite win by two, or is the one-score margin path too large?",
    tokenBudget: 400,
  }, "slice4-minimum-safe-overflow");
  assert.equal(overflow.response.status, 201);
  assert.equal(overflow.value.packet.status, "failed");
  assert.match(overflow.value.packet.compilationError, /^minimum_safe_packet_exceeds_budget:/);
  assert.ok(overflow.value.receipt.unresolvedConflicts.length >= 2);

  const immutableId = packetIds[1];
  assert.throws(
    () => DB.database.prepare("UPDATE packets SET task = 'mutated' WHERE id = ?").run(immutableId),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("DELETE FROM packet_items WHERE packet_id = ?").run(immutableId),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("UPDATE receipts SET selected_roadway_reason = 'mutated' WHERE packet_id = ?").run(immutableId),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("DELETE FROM roadway_versions WHERE project_id = 'sports'").run(),
    /immutable/i,
  );
});

test("Slice 4 preserves Brewers Reconstructed limitations beside an Exact native source", async () => {
  const worker = await builtWorker("slice4-brewers-representation");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const fixture = await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.txt", import.meta.url),
    "utf8",
  );
  const contract = JSON.parse(await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.json", import.meta.url),
    "utf8",
  ));
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "slice4-brewers-reconstruction-import",
    body: {
      format: "text",
      title: contract.caseObjective,
      sourceName: contract.sourceName,
      sourceType: contract.sourceType,
      representationType: contract.representationType,
      authorityState: contract.authorityState,
      importId: contract.importId,
      transcript: fixture,
      provenance: contract.provenance,
    },
  });
  assert.equal(imported.response.status, 201);
  const reconstructedCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: contract.caseObjective,
      conversationId: imported.value.conversation.id,
      makeActive: true,
      actorId: "cody",
    },
  });
  assert.equal(reconstructedCase.response.status, 201);

  const native = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Exact native outcome fixture", provenance: { source: "campus_atlas_native" } },
  });
  const nativeCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: "Review the exact native outcome",
      conversationId: native.value.conversation.id,
      makeActive: true,
      actorId: "cody",
    },
  });
  const exactContent = "Exact native source: Colorado won 5–2; review what the result contradicted.";
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(native.value.conversation.id)}/messages`,
    {
      method: "POST",
      idempotencyKey: "slice4-exact-native-message",
      body: { actorType: "user", actorId: "cody", content: exactContent },
    },
  );
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId: native.value.conversation.id,
      caseId: nativeCase.value.case.id,
      type: "outcome",
      assignmentState: "assigned",
      exactSourceSpan: exactContent,
      sourceSpans: [{ messageId: message.value.message.id, start: 0, end: exactContent.length }],
    },
  });
  assert.equal(event.response.status, 201);

  const packet = await createSlice4Packet(worker, DB, {
    task: "Explain the completed Rockies–Brewers result and postmortem lessons without rewriting the source.",
    caseId: nativeCase.value.case.id,
    tokenBudget: 1600,
  }, "slice4-brewers-representation-packet");
  assert.equal(packet.response.status, 201, JSON.stringify(packet.value));
  assert.equal(packet.value.packet.status, "compiled");
  const items = Object.values(packet.value.receipt.treatmentSummary).flat();
  const reconstructed = items.find(
    (item) => item.sourceType === "SourceArtifact" && item.sourceId === imported.value.import.id,
  );
  assert.ok(reconstructed);
  assert.equal(reconstructed.representation, "Reconstructed");
  assert.equal(reconstructed.treatment, "Consider");
  assert.match(reconstructed.reason, /historical raw transcript.*unavailable_cannot_truthfully_reconstruct/i);
  const exact = items.find((item) => item.sourceId === event.value.event.id);
  assert.ok(exact);
  assert.equal(exact.representation, "Exact");
  assert.match(packet.value.packet.compiledContent, /historical raw transcript unavailable; not Exact/i);
  assert.equal(
    items.some((item) => item.sourceId === imported.value.import.id && item.treatment === "Use"),
    false,
  );
});

test("Slice 4 minimal interface exposes interpretation, treatments, budgets, packet, receipt, and no handoff", async () => {
  const worker = await builtWorker("slice4-minimal-interface");
  const response = await worker.fetch(
    new Request("http://localhost/projects/sports/ask", { headers: { accept: "text/html" } }),
    { ASSETS: assets },
    ctx,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ["Ask with Atlas", "immutable receipt"]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const interfaceSource = await readFile(
    new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "Interpret current task",
    "Compile packet",
    "400",
    "800",
    "1600",
    "Frozen registry",
    "Interpreted intent",
    "Immutable packet",
    "Causal receipt",
  ]) {
    assert.match(interfaceSource, new RegExp(text));
  }
  const slice4Source = await Promise.all([
    "roadway-service.ts",
    "candidate-ranking.ts",
    "packet-service.ts",
    "slice4-api.ts",
  ].map((name) => readFile(new URL(`../worker/${name}`, import.meta.url), "utf8")));
  const combined = slice4Source.join("\n");
  assert.doesNotMatch(combined, /INSERT INTO handoffs|receivingModel|model handoff/i);
  assert.doesNotMatch(combined, /England|Ghana/);
  assert.doesNotMatch(combined, /fake success|seeded success/i);
});

test("Slice 4 domain records reject generic writes that could bypass authority and immutability", async () => {
  const worker = await builtWorker("slice4-generic-write-boundary");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  for (const table of ["roadways", "roadway_versions", "live_state_snapshots", "packets", "packet_items", "receipts"]) {
    const result = await slice2Request(worker, DB, `/api/v1/projects/sports/records/${table}`, {
      method: "POST",
      body: { id: `${table}:bypass`, project_id: "sports" },
    });
    assert.equal(result.response.status, 409, table);
    assert.match(result.value.error, /owned by a canonical domain service/i);
  }
});

test("Slice 5 keeps the exact original request, saved packet, provider input, answer, and receipt separate", async () => {
  const worker = await builtWorker("slice5-input-separation");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice5-separation",
    statement: "Separate outright winning from margin coverage by checking the one-score path and offered number.",
  });
  const task = "Can this favorite win by two, or is the one-score cover path too large?";
  const packet = await createSlice4Packet(worker, DB, {
    task,
    tokenBudget: 800,
  }, "slice5-separation-packet");
  assert.equal(packet.response.status, 201, JSON.stringify(packet.value));
  assert.equal(packet.value.packet.status, "compiled");
  const savedContent = packet.value.packet.compiledContent;
  const adapterCalls = [];
  const testAdapter = {
    fixtureType: "slice5_test_only",
    async execute(input) {
      adapterCalls.push(input);
      return {
        providerResponseId: "response:slice5-success",
        model: "atlas-test-receiver-v1",
        answerText: "Test-only receiving answer kept separate from the request and packet.",
        completedAt: "2026-07-28T12:00:00.000Z",
        additionalLiveRetrieval: {
          performed: false,
          requested: false,
          retrievedAt: null,
          tools: [],
          reliedOnNewerStateThanPacket: false,
        },
        metadata: { fixture: "slice5_test_only", productionSuccess: false },
      };
    },
  };
  const created = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
      originalTask: task,
    },
    "slice5-handoff-separation",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: testAdapter },
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.handoff.status, "completed");
  assert.equal(created.value.handoff.originalTask, task);
  assert.equal(created.value.packet.compiledContent, savedContent);
  assert.equal(
    created.value.handoff.packetSnapshotHash,
    createHash("sha256").update(savedContent).digest("hex"),
  );
  assert.equal(created.value.answer.answerText, "Test-only receiving answer kept separate from the request and packet.");
  assert.equal(created.value.answer.providerResponseId, "response:slice5-success");
  assert.deepEqual(created.value.lifecycle.map((event) => event.status), ["pending", "sent", "completed"]);
  assert.equal(created.value.handoff.additionalLiveRetrieval.performed, false);
  assert.equal(created.value.receipt.finalAnswerReference.handoffId, created.value.handoff.id);
  assert.equal(created.value.receipt.receivingProvider, "test");
  assert.equal(created.value.receipt.receivingModel, "atlas-test-receiver-v1");
  assert.equal(created.value.receipt.handoffStatus, "completed");
  assert.equal(created.value.receipt.originalTask, task);
  assert.match(created.value.receipt.honestyStatement, /does not establish outcome correctness/i);
  assert.doesNotMatch(created.value.receipt.honestyStatement, /caused the model to make the correct/i);

  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].originalRequest, task);
  assert.equal(adapterCalls[0].atlasContextPacket, savedContent);
  assert.deepEqual(adapterCalls[0].providerInput.map((item) => item.role), ["developer", "user"]);
  assert.equal(adapterCalls[0].providerInput[0].content[1].text, savedContent);
  assert.equal(adapterCalls[0].providerInput[1].content.length, 1);
  assert.equal(adapterCalls[0].providerInput[1].content[0].text, task);
  assert.doesNotMatch(adapterCalls[0].providerInput[1].content[0].text, /Atlas reconstruction packet/);
  assert.match(adapterCalls[0].boundedInstructions, /not a new user instruction/i);
  assert.match(adapterCalls[0].boundedInstructions, /cannot override/i);

  const replay = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
    },
    "slice5-handoff-separation",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: testAdapter },
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.handoff.id, created.value.handoff.id);
  assert.equal(adapterCalls.length, 1);

  const conflict = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "different-actor",
    },
    "slice5-handoff-separation",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: testAdapter },
  );
  assert.equal(conflict.response.status, 409);

  const read = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/handoffs/${encodeURIComponent(created.value.handoff.id)}`,
  );
  assert.equal(read.response.status, 200);
  const { idempotentReplay: createdReplay, ...createdSnapshot } = created.value;
  assert.equal(createdReplay, false);
  assert.deepEqual(read.value, createdSnapshot);
  const history = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/handoffs/${encodeURIComponent(created.value.handoff.id)}/history`,
  );
  assert.deepEqual(history.value.lifecycle, created.value.lifecycle);
  const answer = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/handoffs/${encodeURIComponent(created.value.handoff.id)}/answer`,
  );
  assert.deepEqual(answer.value.answer, created.value.answer);
  const receipt = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/handoffs/${encodeURIComponent(created.value.handoff.id)}/receipt`,
  );
  assert.deepEqual(receipt.value.receipt, created.value.receipt);

  const crossProjectRead = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/handoffs/${encodeURIComponent(created.value.handoff.id)}`,
  );
  assert.equal(crossProjectRead.response.status, 404);
  const crossProjectWrite = await createSlice5Handoff(
    worker,
    DB,
    "hockey",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
    },
    "slice5-cross-project-write",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: testAdapter },
  );
  assert.equal(crossProjectWrite.response.status, 404);

  assert.equal(
    DB.database.prepare("SELECT compiled_content FROM packets WHERE id = ?").get(packet.value.packet.id).compiled_content,
    savedContent,
  );
  assert.throws(
    () => DB.database.prepare("UPDATE handoffs SET original_task = 'mutated' WHERE id = ?").run(created.value.handoff.id),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("UPDATE handoff_answers SET answer_text = 'mutated' WHERE handoff_id = ?").run(created.value.handoff.id),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("DELETE FROM handoff_receipts WHERE handoff_id = ?").run(created.value.handoff.id),
    /immutable/i,
  );
});

test("Slice 5 records missing configuration and provider failure honestly without seeded success", async () => {
  const worker = await builtWorker("slice5-honest-failure");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "missing", "Missing State Project");
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice5-failure",
    statement: "Separate outright winning from margin coverage and preserve the strongest one-score challenge.",
  });
  const packet = await createSlice4Packet(worker, DB, {
    task: "Can this favorite win by two, or is the one-score run-line path too large?",
  }, "slice5-failure-packet");
  assert.equal(packet.value.packet.status, "compiled");

  const unauthorized = await worker.fetch(new Request(
    "http://localhost/api/v1/projects/sports/handoffs",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "slice5-unauthorized",
      },
      body: JSON.stringify({
        packetId: packet.value.packet.id,
        provider: "openai",
        model: "gpt-5.6",
        actorId: "cody",
      }),
    },
  ), {
    DB,
    ASSETS: assets,
    CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key",
  }, ctx);
  assert.equal(unauthorized.status, 401);

  const missingKey = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "openai",
      model: "gpt-5.6",
      actorId: "cody",
    },
    "slice5-missing-api-key",
  );
  assert.equal(missingKey.response.status, 503);
  assert.equal(missingKey.value.handoff.status, "failed");
  assert.equal(missingKey.value.handoff.failureCategory, "missing_configuration");
  assert.deepEqual(missingKey.value.lifecycle.map((event) => event.status), ["pending", "failed"]);
  assert.equal(missingKey.value.answer, null);
  assert.ok(missingKey.value.receipt);
  assert.equal(missingKey.value.handoff.additionalLiveRetrieval.performed, false);
  assert.doesNotMatch(JSON.stringify(missingKey.value), /England|Ghana|seeded answer/i);

  const failingAdapter = {
    fixtureType: "slice5_test_only",
    async execute() {
      throw new Error("Injected provider outage");
    },
  };
  const providerFailure = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
    },
    "slice5-provider-failure",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: failingAdapter },
  );
  assert.equal(providerFailure.response.status, 502);
  assert.equal(providerFailure.value.handoff.status, "failed");
  assert.deepEqual(providerFailure.value.lifecycle.map((event) => event.status), ["pending", "sent", "failed"]);
  assert.equal(providerFailure.value.answer, null);
  assert.match(providerFailure.value.handoff.failureReason, /Injected provider outage/);

  const missingStatePacket = await createSlice4Packet(worker, DB, {
    projectId: "missing",
    task: "At the current price tonight, can this favorite cover the -1.5 run line?",
  }, "slice5-failed-packet");
  assert.equal(missingStatePacket.value.packet.status, "failed");
  const failedPacketAttempt = await createSlice5Handoff(
    worker,
    DB,
    "missing",
    {
      packetId: missingStatePacket.value.packet.id,
      provider: "openai",
      model: "gpt-5.6",
      actorId: "cody",
    },
    "slice5-failed-packet-handoff",
  );
  assert.equal(failedPacketAttempt.response.status, 400);
  assert.match(failedPacketAttempt.value.error, /failed or incomplete/i);
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM handoffs WHERE project_id = 'missing'").get().count,
    0,
  );

  const unsupported = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "openai",
      model: "unsupported-model",
      actorId: "cody",
    },
    "slice5-unsupported-model",
  );
  assert.equal(unsupported.response.status, 400);
  const alteredTask = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: packet.value.packet.id,
      provider: "openai",
      model: "gpt-5.6",
      actorId: "cody",
      originalTask: "A silently broadened task",
    },
    "slice5-altered-task",
  );
  assert.equal(alteredTask.response.status, 400);
  assert.match(alteredTask.value.error, /cannot alter/i);
});

test("Slice 5 causal receipt connects a comparable packet diff to the exact governance event", async () => {
  const worker = await builtWorker("slice5-causal-packet-diff");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(worker, DB, "slice5-causal-proof", ["challenge", "correction"]);
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ? WHERE id = ?",
  ).run(
    "Strongest challenge: the one-score result still defeats a run-line cover.",
    "Strongest challenge: preserve the one-score non-cover path.",
    seeded.events[0].id,
  );
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ?, actor_id = 'cody' WHERE id = ?",
  ).run(
    "Cody correction: winning and covering are separate theses.",
    "Cody corrected the scope: winning is not covering.",
    seeded.events[1].id,
  );
  const task = "Can this favorite win by two, or does the one-score cover path make the number too expensive?";
  const before = await createSlice4Packet(worker, DB, {
    task,
    caseId: seeded.caseId,
    tokenBudget: 1600,
  }, "slice5-causal-before");
  assert.equal(before.value.packet.status, "compiled");

  const mechanism = seedSlice4Mechanism(DB, {
    id: "mechanism:slice5-governed-margin",
    statement: "Separate outright win probability from cover probability using margin distribution, one-score paths, and offered price.",
    supportingCaseIds: [seeded.caseId],
    counterevidenceIds: [seeded.events[0].id],
    realityContact: "Cody-reviewed margin mechanism with an explicit challenge.",
  });
  const governanceEventId = "governance-event:slice5-approval";
  DB.database.prepare(
    `INSERT INTO governance_events (
      id, project_id, actor_id, action, target_type, target_id,
      source_version_id, resulting_version_id, prior_authority, new_authority,
      prior_scope, new_scope, affected_mechanism_id, reason,
      retrieval_effect, created_at, idempotency_key
    ) VALUES (?, 'sports', 'cody', 'approve', 'mechanism', ?, ?, ?,
              'under_review', 'approved_project_wide', 'local', 'project_wide',
              ?, 'Cody approved the reviewed wording and scope.',
              'eligible_when_roadway_scope_and_freshness_match', ?, ?)`,
  ).run(
    governanceEventId,
    mechanism.id,
    mechanism.versionId,
    mechanism.versionId,
    mechanism.id,
    "2026-07-28T11:00:00.000Z",
    "slice5-causal-approval",
  );
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice5-conflict-a",
    statement: "Always prioritize recent favorite cover form when evaluating the run-line margin.",
    counterevidenceIds: ["mechanism:slice5-conflict-b"],
  });
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice5-conflict-b",
    statement: "Never prioritize recent favorite cover form when evaluating the run-line margin.",
    counterevidenceIds: ["mechanism:slice5-conflict-a"],
  });
  const after = await createSlice4Packet(worker, DB, {
    task,
    caseId: seeded.caseId,
    tokenBudget: 1600,
  }, "slice5-causal-after");
  assert.equal(after.value.packet.status, "compiled");
  assert.equal(after.value.packet.priorComparablePacketId, before.value.packet.id);
  assert.ok(after.value.receipt.governanceCauses.some((cause) => cause.governanceEventId === governanceEventId));
  assert.ok(after.value.receipt.exactPacketDifference.some((change) => change.sourceId === mechanism.id));

  const adapter = {
    fixtureType: "slice5_test_only",
    async execute(input) {
      return {
        providerResponseId: "response:slice5-causal-proof",
        model: "atlas-test-receiver-v1",
        answerText: "Test-only answer for causal receipt verification.",
        completedAt: "2026-07-28T12:30:00.000Z",
        additionalLiveRetrieval: {
          performed: true,
          requested: true,
          retrievedAt: "2026-07-28T12:29:00.000Z",
          tools: [{ type: "test_live_lookup", identity: "fixture://slice5/live" }],
          reliedOnNewerStateThanPacket: true,
        },
        metadata: { fixture: true, packetHashVerifiedByAdapter: Boolean(input.atlasContextPacket) },
      };
    },
  };
  const handoff = await createSlice5Handoff(
    worker,
    DB,
    "sports",
    {
      packetId: after.value.packet.id,
      provider: "test",
      model: "atlas-test-receiver-v1",
      actorId: "cody",
    },
    "slice5-causal-handoff",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: adapter },
  );
  assert.equal(handoff.response.status, 201, JSON.stringify(handoff.value));
  assert.equal(handoff.value.receipt.priorComparablePacketId, before.value.packet.id);
  const mechanismChange = handoff.value.receipt.causalPacketDifference.find(
    (change) => change.sourceId === mechanism.id,
  );
  assert.ok(mechanismChange);
  assert.equal(mechanismChange.cause.governanceEventId, governanceEventId);
  assert.ok(handoff.value.receipt.strongestChallenges.some((item) => item.sourceId === seeded.events[0].id));
  assert.ok(handoff.value.receipt.corrections.some((item) => item.sourceId === seeded.events[1].id));
  assert.ok(handoff.value.receipt.unresolvedConflicts.length >= 2);
  assert.equal(handoff.value.handoff.additionalLiveRetrieval.performed, true);
  assert.equal(handoff.value.receipt.additionalLiveRetrieval.tools[0].identity, "fixture://slice5/live");
  assert.equal(handoff.value.receipt.additionalLiveRetrieval.reliedOnNewerStateThanPacket, true);
  assert.doesNotMatch(JSON.stringify(handoff.value.receipt), /caused the (?:model|final decision).*correct/i);

  const comparison = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/handoffs/${encodeURIComponent(handoff.value.handoff.id)}/comparison`,
  );
  assert.equal(comparison.response.status, 200);
  assert.deepEqual(comparison.value.causalPacketDifference, handoff.value.receipt.causalPacketDifference);
  assert.ok(comparison.value.governanceCauses.some((cause) => cause.governanceEventId === governanceEventId));
});

test("Slice 5 preserves Brewers as Reconstructed beside Exact native source through handoff", async () => {
  const worker = await builtWorker("slice5-brewers-handoff");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const fixture = await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.txt", import.meta.url),
    "utf8",
  );
  const contract = JSON.parse(await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.json", import.meta.url),
    "utf8",
  ));
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "slice5-brewers-import",
    body: {
      format: "text",
      title: contract.caseObjective,
      sourceName: contract.sourceName,
      sourceType: contract.sourceType,
      representationType: contract.representationType,
      authorityState: contract.authorityState,
      importId: "slice5-brewers-reconstruction",
      transcript: fixture,
      provenance: contract.provenance,
    },
  });
  const native = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations", {
    method: "POST",
    body: { title: "Slice 5 exact native outcome", provenance: { source: "campus_atlas_native" } },
  });
  const nativeCase = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
    method: "POST",
    body: {
      objective: "Review the exact native Rockies–Brewers outcome",
      conversationId: native.value.conversation.id,
      makeActive: true,
      actorId: "cody",
    },
  });
  const exactContent = "Exact native source: Colorado won 5–2; current postmortem records what reality contradicted.";
  const message = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(native.value.conversation.id)}/messages`,
    {
      method: "POST",
      idempotencyKey: "slice5-native-exact-message",
      body: { actorType: "user", actorId: "cody", content: exactContent },
    },
  );
  const event = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId: native.value.conversation.id,
      caseId: nativeCase.value.case.id,
      type: "outcome",
      assignmentState: "assigned",
      exactSourceSpan: exactContent,
      sourceSpans: [{ messageId: message.value.message.id, start: 0, end: exactContent.length }],
    },
  });
  const packet = await createSlice4Packet(worker, DB, {
    task: "Explain the completed Rockies–Brewers outcome and postmortem without rewriting the source.",
    caseId: nativeCase.value.case.id,
    tokenBudget: 1600,
  }, "slice5-brewers-packet");
  assert.equal(packet.value.packet.status, "compiled");

  const adapter = {
    fixtureType: "slice5_test_only",
    async execute() {
      return {
        providerResponseId: "response:slice5-brewers",
        model: "atlas-test-receiver-v1",
        answerText: "Test-only Brewers handoff answer.",
        completedAt: "2026-07-28T13:00:00.000Z",
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
  };
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
    "slice5-brewers-handoff",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: adapter },
  );
  assert.equal(handoff.response.status, 201, JSON.stringify(handoff.value));
  assert.ok(
    handoff.value.receipt.historicalLimitations.some(
      (item) => item.sourceId === imported.value.import.id
        && item.representation === "Reconstructed"
        && item.automaticAuthorityPromotion === false,
    ),
  );
  const allItems = Object.values(handoff.value.receipt.treatmentSummary).flat();
  const reconstructed = allItems.find((item) => item.sourceId === imported.value.import.id);
  assert.equal(reconstructed.representation, "Reconstructed");
  assert.notEqual(reconstructed.treatment, "Use");
  const exact = allItems.find((item) => item.sourceId === event.value.event.id);
  assert.equal(exact.representation, "Exact");
  assert.match(handoff.value.packet.compiledContent, /historical raw transcript unavailable; not Exact/i);
  assert.doesNotMatch(JSON.stringify(handoff.value), /authentic raw transcript.*passed/i);
});

test("Slice 5 migration, API, and minimal Ask interface expose immutable auditable handoff without Slice 6 redesign", async () => {
  const migration = await readFile(
    new URL("../drizzle/0008_complete_timeslip.sql", import.meta.url),
    "utf8",
  );
  for (const table of ["handoff_lifecycle_events", "handoff_answers", "handoff_receipts"]) {
    assert.match(migration, new RegExp(`CREATE TABLE .${table}.`));
  }
  for (const trigger of [
    "handoffs_immutable_update",
    "handoff_lifecycle_events_immutable_update",
    "handoff_answers_immutable_update",
    "handoff_receipts_immutable_update",
  ]) {
    assert.match(migration, new RegExp(trigger));
  }
  const [service, adapter, api, interfaceSource, pageSource] = await Promise.all([
    readFile(new URL("../worker/handoff-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/receiving-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/slice5-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const text of [
    "Your request",
    "Atlas reconstruction",
    "Send saved packet to receiving model",
    "Model answer",
    "Handoff receipt",
    "Additional live retrieval",
    "Final-answer reference",
  ]) {
    assert.match(interfaceSource, new RegExp(text));
  }
  assert.match(pageSource, /Slice 5 verification/);
  assert.match(adapter, /not a new user instruction/i);
  assert.match(adapter, /role: "user"/);
  assert.match(service, /packetRecompiled: false/);
  assert.match(service, /Supplying context does not establish outcome correctness/i);
  assert.match(api, /parts\[1\] === "comparison"/);
  assert.doesNotMatch(`${service}\n${adapter}\n${api}`, /England|Ghana|seeded answer/i);
  assert.doesNotMatch(`${interfaceSource}\n${pageSource}`, /Work\s*Atlas Found\s*Ask\s*Inspect/);
});

test("Slice 5 handoff records reject generic canonical writes", async () => {
  const worker = await builtWorker("slice5-generic-write-boundary");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  for (const table of ["handoffs", "handoff_lifecycle_events", "handoff_answers", "handoff_receipts"]) {
    const result = await slice2Request(worker, DB, `/api/v1/projects/sports/records/${table}`, {
      method: "POST",
      body: { id: `${table}:bypass`, project_id: "sports" },
    });
    assert.equal(result.response.status, 409, table);
    assert.match(result.value.error, /owned by a canonical domain service/i);
  }
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

test("Slice 6B interface is canonical, explicit, mobile-capable, and leaves Slice 6C untouched", async () => {
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
  assert.doesNotMatch(ask, /Slice 6C|dogfood runbook|hosted release/i);
});
