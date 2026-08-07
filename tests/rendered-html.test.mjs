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

test("Slice 6A root restores canonical Work without AtlasState or seeded fallback", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\/api\/v1\/health/);
  assert.match(page, /\/api\/v1\/projects/);
  assert.match(page, /\/work/);
  assert.match(page, /No seeded project card was substituted/);
  assert.doesNotMatch(page, /makeSeedState|\/api\/state|England|Ghana|AtlasState/);
});

test("Slice 6A shell has exactly four primary destinations and mobile parity", async () => {
  const shell = await readFile(new URL("../app/components/project-shell.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/components/shell.module.css", import.meta.url), "utf8");
  for (const destination of ["Work", "Atlas Found", "Ask", "Inspect"]) {
    assert.match(shell, new RegExp(`label: "${destination}"`));
  }
  assert.equal((shell.match(/label: "/g) || []).length, 4);
  assert.match(shell, /aria-label="Campus Atlas primary"/);
  assert.match(shell, /aria-label="Campus Atlas mobile primary"/);
  assert.match(shell, /project-switcher/);
  assert.match(shell, /Switching project and clearing the prior project view/);
  assert.match(shell, /mobileSheet/);
  assert.match(css, /\.mobileNav/);
  assert.match(css, /@media \(max-width: 760px\)/);
});

test("Slice 6A Work and conversation actions use canonical services only", async () => {
  const work = await readFile(new URL("../app/projects/[projectId]/work/work-workspace.tsx", import.meta.url), "utf8");
  const conversation = await readFile(new URL("../app/projects/[projectId]/conversations/[conversationId]/workspace.tsx", import.meta.url), "utf8");
  const session = await readFile(new URL("../app/components/write-session.tsx", import.meta.url), "utf8");
  for (const expected of [
    "/conversations",
    "/conversations/import",
    "Start Atlas conversation",
    "Import conversation",
    "No fixture, decorative project card, or simulated activity was inserted",
  ]) assert.match(work, new RegExp(expected.replaceAll("/", "\\/")));
  for (const expected of [
    "/messages",
    "/active-case",
    "/checkpoints",
    "Reasoning Health",
    "Atlas found no consequence that should change future retrieval",
    "Server confirmed the preserved message",
  ]) assert.match(conversation, new RegExp(expected.replaceAll("/", "\\/")));
  assert.doesNotMatch(`${work}\n${conversation}`, /\/api\/state|makeSeedState|AtlasState/);
  assert.match(session, /storage: "memory_only"/);
  assert.doesNotMatch(session, /localStorage|sessionStorage/);
});

test("Native Analyze keeps finding authorship server-side and restores canonical checkpoint detail", async () => {
  const conversation = await readFile(new URL("../app/projects/[projectId]/conversations/[conversationId]/workspace.tsx", import.meta.url), "utf8");
  const checkpoint = await readFile(new URL("../worker/checkpoint-service.ts", import.meta.url), "utf8");
  const health = await readFile(new URL("../worker/reasoning-health.ts", import.meta.url), "utf8");
  assert.doesNotMatch(conversation, /findingCandidates/);
  assert.match(conversation, /checkpoints\/latest/);
  assert.match(conversation, /Existing canonical checkpoint/);
  assert.match(conversation, /Inspect canonical result/);
  assert.match(conversation, /No authority changed; findings remain proposals until governed/);
  assert.match(checkpoint, /serverFindingCandidates/);
  assert.match(checkpoint, /client-supplied finding wording cannot be accepted/);
  assert.match(checkpoint, /no_change_until_governed/);
  assert.match(health, /unresolvedConflictEvent/);
  assert.doesNotMatch(health, /\["challenge", "correction"\]\.includes/);
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

test("V4.6 seeded proof remains available for compatibility without owning the V1.7 root", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const data = await readFile(new URL("../app/v46-data.ts", import.meta.url), "utf8");
  assert.match(data, /export function makeSeedState/);
  assert.match(data, /seededCases/);
  assert.match(data, /seededEvidence/);
  assert.match(data, /seededKnowledge/);
  assert.match(data, /proofBaseline: null/);
  assert.doesNotMatch(page, /makeSeedState|v46-data|Reset Amy Campus demo/);
  assert.match(page, /No seeded project card was substituted/);
});

test("Slice 3 checkpoints select at most seven exact-source nodes and accept zero findings", async () => {
  const worker = await builtWorker("slice3-sparse-checkpoint");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(
    worker,
    DB,
    "sparse",
    ["context", "evidence", "assumption", "estimate", "unknown", "method", "decision", "challenge", "outcome"],
  );
  const analyzed = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-sparse-checkpoint-1",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
    },
  });
  assert.equal(analyzed.response.status, 201);
  assert.equal(analyzed.value.checkpoint.candidateCount, 9);
  assert.equal(analyzed.value.checkpoint.selectedCount, 7);
  assert.equal(analyzed.value.checkpoint.omittedCount, 2);
  assert.equal(analyzed.value.selectedNodes.length, 7);
  assert.equal(analyzed.value.findings.length, 0);
  assert.equal(analyzed.value.noDurableFindingProposed, true);
  assert.ok(analyzed.value.selectedNodes.every((node) => node.sourceEventIds.length === 1));
  const canonicalEventIds = new Set(seeded.events.map((event) => event.id));
  assert.ok(analyzed.value.selectedNodes.every((node) => canonicalEventIds.has(node.sourceEventIds[0])));
  assert.ok(analyzed.value.selectedNodes.every((node) => ["Exact", "Compressed"].includes(node.representationType)));

  const refreshed = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/checkpoints/${encodeURIComponent(analyzed.value.checkpoint.id)}`,
  );
  assert.equal(refreshed.response.status, 200);
  assert.deepEqual(refreshed.value.checkpoint, analyzed.value.checkpoint);
  assert.deepEqual(refreshed.value.selectedNodes, analyzed.value.selectedNodes);
  assert.deepEqual(refreshed.value.findings, []);
  assert.equal(refreshed.value.noDurableFindingProposed, true);
  assert.equal(refreshed.value.retrievalEffect, "none");

  const replay = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-sparse-checkpoint-1",
    body: { conversationId: seeded.conversationId, caseId: seeded.caseId },
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.value.idempotentReplay, true);

  const unavailableStructure = await worker.fetch(new Request("http://localhost/api/structure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: "Sports Engine",
      input: "This source must not receive a fabricated England–Ghana fallback proposal.",
    }),
  }), { DB, ASSETS: assets }, ctx);
  assert.equal(unavailableStructure.status, 503);
  const unavailableBody = await unavailableStructure.json();
  assert.equal(unavailableBody.proposal, null);
  assert.equal(unavailableBody.findingCreated, false);
});

test("Native Analyze generates one grounded proposed finding server-side and restores its checkpoint read-only", async () => {
  const worker = await builtWorker("native-server-findings");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");

  const evidenceText = "A live-entry rule should require sustained territory, credible chance creation, and control of transition risk—not merely possession. Waiting for confirmation can worsen the price, so the rule also needs a maximum acceptable live price and a clear pass condition.";
  const correctionText = "My current lean is to wait for sustained territory, credible chance creation, and controlled transition risk before entering a soccer favorite. If the price moves beyond a preset maximum before those signals appear, the correct decision should be to pass. ";
  const seeded = await seedSlice3Case(
    worker,
    DB,
    "native-dogfood-contract",
    ["evidence", "correction"],
    [evidenceText, correctionText],
  );

  const injected = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "native-client-injection-rejected",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
      source: "canonical_case_events",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: seeded.events.map((event) => event.id),
        proposalStatement: "The browser must not decide this wording.",
        reasonForSurfacing: "Client injection.",
        expectedRetrievalEffect: "Client injection.",
      }],
    },
  });
  assert.equal(injected.response.status, 400);
  assert.match(injected.value.error, /server-owned/i);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM checkpoints").get().count, 0);

  const analyzed = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "native-server-generated-finding",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
      source: "canonical_case_events",
    },
  });
  assert.equal(analyzed.response.status, 201, JSON.stringify(analyzed.value));
  assert.equal(analyzed.value.checkpoint.candidateCount, 2);
  assert.equal(analyzed.value.checkpoint.selectedCount, 2);
  assert.equal(analyzed.value.checkpoint.omittedCount, 0);
  assert.equal(analyzed.value.checkpoint.healthBefore, "forming");
  assert.equal(analyzed.value.checkpoint.healthAfter, "awaiting_governance");
  assert.equal(analyzed.value.checkpoint.metadata.findingCandidatesReceived, 0);
  assert.equal(analyzed.value.checkpoint.metadata.findingCandidatesGenerated, 1);
  assert.equal(analyzed.value.checkpoint.metadata.findingCandidateOrigin, "server");
  assert.equal(analyzed.value.findings.length, 1);
  assert.equal(analyzed.value.findings[0].type, "mechanism_recognition");
  assert.equal(analyzed.value.findings[0].proposal, correctionText);
  assert.equal(analyzed.value.findings[0].status, "proposed");
  assert.equal(analyzed.value.findings[0].authority, "proposed");
  assert.equal(analyzed.value.findings[0].proposedScope, "local");
  assert.deepEqual(new Set(analyzed.value.findings[0].sourceEventIds), new Set(seeded.events.map((event) => event.id)));
  assert.deepEqual(analyzed.value.findings[0].selectedNodeIds, analyzed.value.selectedNodes.map((node) => node.id));
  assert.equal(analyzed.value.retrievalEffect, "no_change_until_governed");
  assert.equal(analyzed.value.noDurableFindingProposed, false);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms").get().count, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM governance_events").get().count, 0);

  const findingDetail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(analyzed.value.findings[0].id)}`,
  );
  assert.equal(findingDetail.response.status, 200);
  assert.deepEqual(
    new Set(findingDetail.value.sourceEvents.map((event) => event.id)),
    new Set(seeded.events.map((event) => event.id)),
  );
  assert.ok(findingDetail.value.sourceEvents.every((event) => event.sourceLinks.length === 1));

  const beforeReadCounts = {
    checkpoints: DB.database.prepare("SELECT COUNT(*) AS count FROM checkpoints").get().count,
    findings: DB.database.prepare("SELECT COUNT(*) AS count FROM findings").get().count,
  };
  const latest = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/checkpoints/latest?conversationId=${encodeURIComponent(seeded.conversationId)}&caseId=${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(latest.response.status, 200);
  assert.equal(latest.value.result.checkpoint.id, analyzed.value.checkpoint.id);
  assert.deepEqual(latest.value.result.selectedNodes, analyzed.value.selectedNodes);
  assert.deepEqual(latest.value.result.findings, analyzed.value.findings);
  assert.deepEqual({
    checkpoints: DB.database.prepare("SELECT COUNT(*) AS count FROM checkpoints").get().count,
    findings: DB.database.prepare("SELECT COUNT(*) AS count FROM findings").get().count,
  }, beforeReadCounts);

  const isolated = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/checkpoints/latest?conversationId=${encodeURIComponent(seeded.conversationId)}&caseId=${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(isolated.response.status, 404);

  const duplicate = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "native-server-generated-finding-repeat",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      trigger: "analyze_now",
      source: "canonical_case_events",
    },
  });
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.value.findings.length, 0);
  assert.equal(duplicate.value.suppressedFindingCount, 1);
  assert.equal(duplicate.value.checkpoint.healthAfter, "awaiting_governance");
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM findings").get().count, 1);
});

test("Native Reasoning Health distinguishes aligned corrections from real contradictions", async () => {
  const worker = await builtWorker("native-conflict-semantics");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");

  const insufficient = await seedSlice3Case(worker, DB, "insufficient-native", ["evidence"]);
  const zero = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "native-insufficient-zero",
    body: {
      conversationId: insufficient.conversationId,
      caseId: insufficient.caseId,
      source: "canonical_case_events",
    },
  });
  assert.equal(zero.response.status, 201);
  assert.equal(zero.value.findings.length, 0);
  assert.equal(zero.value.noDurableFindingProposed, true);

  const contradiction = await seedSlice3Case(
    worker,
    DB,
    "genuine-conflict",
    ["evidence", "correction"],
    [
      "Use the prior confirmation rule before entering.",
      "The prior confirmation rule is wrong and must not be used.",
    ],
  );
  const conflicted = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "native-genuine-conflict",
    body: {
      conversationId: contradiction.conversationId,
      caseId: contradiction.caseId,
      source: "canonical_case_events",
    },
  });
  assert.equal(conflicted.response.status, 201);
  assert.equal(conflicted.value.checkpoint.healthAfter, "conflict");
  const conversation = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(contradiction.conversationId)}`,
  );
  assert.equal(conversation.value.reasoningHealth.state, "Conflict");
});

test("Slice 3 Cody revision governs, changes eligibility, and rolls back without rewriting history", async () => {
  const worker = await builtWorker("slice3-governance");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(worker, DB, "mechanism", ["correction", "outcome"]);
  const originalProposal = "Late contradictions to a central mechanism require a genuine rerank.";
  const analyzed = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-mechanism-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: seeded.events.map((event) => event.id),
        proposalStatement: originalProposal,
        proposedScope: "local",
        conditions: ["The contradiction affects the wager's central mechanism."],
        exclusions: ["Cosmetic or already-resolved discrepancies."],
        supportingEvidence: [seeded.events[0].id],
        counterevidence: [seeded.events[1].id],
        uncertainty: "Needs Cody to define the rerank threshold.",
        reasonForSurfacing: "The correction and outcome changed the reasoning pathway.",
        expectedRetrievalEffect: "Require an explicit rerank check in later comparable research.",
      }],
    },
  });
  assert.equal(analyzed.response.status, 201);
  assert.equal(analyzed.value.findings.length, 1);
  const finding = analyzed.value.findings[0];

  const combined = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-combined-finding-rejected",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: [seeded.events[0].id],
        proposalStatement: "This candidate attempts to carry multiple consequences.",
        consequences: ["rerank", "change scope"],
        reasonForSurfacing: "Invalid combined proposal.",
        expectedRetrievalEffect: "None.",
      }],
    },
  });
  assert.equal(combined.response.status, 400);

  const revisedStatement = "When late evidence contradicts a central wagering mechanism, rerank the alternatives or pass.";
  const revised = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-revise-mechanism",
      body: {
        action: "revise",
        actorId: "cody",
        sourceVersionId: finding.currentVersionId,
        reviewedStatement: revisedStatement,
        scope: "project_wide",
        reason: "Make the action and scope explicit before approval.",
      },
    },
  );
  assert.equal(revised.response.status, 201);
  assert.equal(revised.value.record.status, "under_review");
  assert.equal(revised.value.newAuthority, "under_review");

  const approved = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-approve-mechanism",
      body: {
        action: "approve",
        actorId: "cody",
        sourceVersionId: revised.value.record.currentVersionId,
        scope: "project_wide",
        reason: "Approve Cody's reviewed wording for Sports Engine retrieval.",
      },
    },
  );
  assert.equal(approved.response.status, 201);
  assert.equal(approved.value.record.status, "approved");
  assert.equal(approved.value.record.authority, "approved_project_wide");
  assert.equal(approved.value.newAuthority, "approved_project_wide");
  assert.equal(approved.value.newScope, "project_wide");
  assert.equal(approved.value.mechanism.statement, revisedStatement);
  assert.equal(approved.value.mechanism.authority_state, "approved_project_wide");

  let eligible = await slice2Request(worker, DB, "/api/v1/projects/sports/mechanisms/eligible");
  assert.equal(eligible.response.status, 200);
  assert.equal(eligible.value.mechanisms.length, 1);
  assert.equal(eligible.value.mechanisms[0].statement, revisedStatement);

  let detail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}`,
  );
  assert.equal(detail.value.versions.length, 3);
  assert.equal(detail.value.versions[0].proposal_statement, originalProposal);
  assert.equal(detail.value.versions[1].proposal_statement, revisedStatement);
  assert.equal(detail.value.versions[2].created_by, "cody");
  assert.equal(detail.value.finding.authority_state, approved.value.record.authority);
  const canonicalApproved = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/records/findings/${encodeURIComponent(finding.id)}`,
  );
  assert.equal(canonicalApproved.value.value.authority_state, approved.value.record.authority);

  const rollback = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/governance-events/${encodeURIComponent(approved.value.governanceEvent.id)}/rollback`,
    {
      method: "POST",
      idempotencyKey: "slice3-rollback-approval",
      body: {
        actorId: "cody",
        reason: "Return the revised wording to review without deleting the approval history.",
      },
    },
  );
  assert.equal(rollback.response.status, 201, JSON.stringify(rollback.value));
  assert.equal(rollback.value.record.status, "under_review");
  assert.equal(rollback.value.record.authority, "under_review");
  assert.equal(rollback.value.governanceEvent.rollback_of_event_id, approved.value.governanceEvent.id);

  eligible = await slice2Request(worker, DB, "/api/v1/projects/sports/mechanisms/eligible");
  assert.equal(eligible.value.mechanisms.length, 0);
  detail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}`,
  );
  assert.equal(detail.value.versions.length, 4);
  assert.equal(detail.value.versions[0].proposal_statement, originalProposal);
  assert.equal(detail.value.governance.length, 3);
  assert.equal(detail.value.finding.authority_state, rollback.value.record.authority);
  assert.throws(
    () => DB.database.prepare("UPDATE finding_versions SET proposal_statement = 'rewritten' WHERE finding_id = ?").run(finding.id),
    /immutable/i,
  );
  assert.throws(
    () => DB.database.prepare("DELETE FROM governance_events WHERE target_id = ?").run(finding.id),
    /immutable/i,
  );
});

test("Slice 3 rejection suppresses unchanged proposals and deferral remains non-authoritative", async () => {
  const worker = await builtWorker("slice3-suppression-deferral");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(worker, DB, "suppression", ["challenge"]);
  const proposal = {
    findingType: "scope_revision",
    sourceEventIds: [seeded.events[0].id],
    proposalStatement: "Limit this interpretation to the active case.",
    proposedScope: "local",
    conditions: [],
    exclusions: [],
    supportingEvidence: [seeded.events[0].id],
    counterevidence: [],
    uncertainty: "The broader project scope is unsupported.",
    reasonForSurfacing: "The challenge narrows applicability.",
    expectedRetrievalEffect: "Keep the interpretation out of project-wide retrieval.",
  };
  const firstCheckpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-rejection-source",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [proposal],
    },
  });
  const finding = firstCheckpoint.value.findings[0];
  const rejected = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-reject-scope",
      body: {
        action: "reject",
        actorId: "cody",
        sourceVersionId: finding.currentVersionId,
        reason: "This consequence is not supported.",
      },
    },
  );
  assert.equal(rejected.response.status, 201);
  assert.equal(rejected.value.record.status, "rejected");
  assert.equal(rejected.value.retrievalEffect, "suppressed_unchanged_proposal");

  const suppressed = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-rejection-recheck",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [proposal],
    },
  });
  assert.equal(suppressed.response.status, 201);
  assert.equal(suppressed.value.findings.length, 0);
  assert.equal(suppressed.value.suppressedFindingCount, 1);
  assert.equal(suppressed.value.noDurableFindingProposed, true);

  const deferredCheckpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-deferral-source",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        ...proposal,
        proposalStatement: "Revisit broader scope after a second independent case.",
        expectedRetrievalEffect: "None until the return condition is met and Cody governs it.",
      }],
    },
  });
  const deferredFinding = deferredCheckpoint.value.findings[0];
  const deferred = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(deferredFinding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-defer-scope",
      body: {
        action: "defer",
        actorId: "cody",
        sourceVersionId: deferredFinding.currentVersionId,
        reason: "Wait for independent repetition.",
        returnCondition: "A second independent case supports the same mechanism.",
      },
    },
  );
  assert.equal(deferred.response.status, 201);
  assert.equal(deferred.value.record.status, "deferred");
  assert.equal(deferred.value.record.authority, "proposed");
  assert.equal(deferred.value.record.returnCondition, "A second independent case supports the same mechanism.");
  assert.equal(deferred.value.retrievalEffect, "no_authoritative_retrieval_effect");
  const redeferred = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(deferredFinding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-redefer-scope",
      body: {
        action: "defer",
        actorId: "cody",
        sourceVersionId: deferred.value.record.currentVersionId,
        reason: "Use a narrower temporary return condition.",
        returnCondition: "A second case is reviewed by Cody.",
      },
    },
  );
  assert.equal(redeferred.response.status, 201);
  assert.equal(redeferred.value.record.returnCondition, "A second case is reviewed by Cody.");
  const rollbackDeferral = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/governance-events/${encodeURIComponent(redeferred.value.governanceEvent.id)}/rollback`,
    {
      method: "POST",
      idempotencyKey: "slice3-rollback-redeferral",
      body: {
        actorId: "cody",
        reason: "Restore the earlier governed deferral state.",
      },
    },
  );
  assert.equal(rollbackDeferral.response.status, 201, JSON.stringify(rollbackDeferral.value));
  assert.equal(rollbackDeferral.value.record.status, "deferred");
  assert.equal(
    rollbackDeferral.value.record.returnCondition,
    "A second independent case supports the same mechanism.",
  );
  assert.equal(rollbackDeferral.value.record.authority, "proposed");

  const eligible = await slice2Request(worker, DB, `/api/v1/projects/sports/mechanisms/eligible?caseId=${encodeURIComponent(seeded.caseId)}`);
  assert.equal(eligible.value.mechanisms.length, 0);
  const crossProject = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/hockey/findings/${encodeURIComponent(deferredFinding.id)}`,
  );
  assert.equal(crossProject.response.status, 404);
});

test("Slice 3 can propose a Brewers mechanism from the byte-preserved reconstruction without promoting it", async () => {
  const worker = await builtWorker("slice3-brewers-mechanism-proposal");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const fixture = await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.txt", import.meta.url),
    "utf8",
  );
  const fixtureContract = JSON.parse(await readFile(
    new URL("../fixtures/brewers/rockies-brewers-user-reconstruction.json", import.meta.url),
    "utf8",
  ));
  const imported = await slice2Request(worker, DB, "/api/v1/projects/sports/conversations/import", {
    method: "POST",
    idempotencyKey: "slice3-brewers-reconstruction-import",
    body: {
      format: "text",
      title: fixtureContract.caseObjective,
      sourceName: fixtureContract.sourceName,
      sourceType: fixtureContract.sourceType,
      representationType: fixtureContract.representationType,
      authorityState: fixtureContract.authorityState,
      transcript: fixture,
      provenance: fixtureContract.provenance,
    },
  });
  assert.equal(imported.response.status, 201);
  const conversationId = imported.value.conversation.id;
  const detail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/conversations/${encodeURIComponent(conversationId)}`,
  );
  const sourceMessage = detail.value.messages[0];
  assert.equal(sourceMessage.exactContent, fixture);
  const caseResult = await slice2Request(worker, DB, "/api/v1/projects/sports/cases", {
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
  const sourceEvent = await slice2Request(worker, DB, "/api/v1/projects/sports/events", {
    method: "POST",
    body: {
      conversationId,
      caseId: caseResult.value.case.id,
      type: "postmortem",
      assignmentState: "assigned",
      exactSourceSpan: fixture,
      sourceSpans: [{ messageId: sourceMessage.id, start: 0, end: fixture.length }],
      extractionMethod: "user_supplied_reconstruction_mark",
      extractionVersion: "slice3-brewers-reconstruction-v1",
      metadata: {
        representationType: "Reconstructed",
        originalRawTranscriptAvailable: false,
      },
    },
  });
  assert.equal(sourceEvent.response.status, 201);

  const analyzed = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-brewers-mechanism-proposal",
    body: {
      conversationId,
      caseId: caseResult.value.case.id,
      trigger: "analyze_now",
      source: "user_supplied_case_reconstruction",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: [sourceEvent.value.event.id],
        proposalStatement: "A late contradiction affecting a central mechanism should trigger a genuine rerank or pass decision.",
        proposedScope: "local",
        conditions: ["The contradiction changes a core assumption behind the preferred option."],
        exclusions: ["Minor discrepancies that do not change the mechanism."],
        supportingEvidence: [sourceEvent.value.event.id],
        counterevidence: [],
        uncertainty: "Only the reconstructed source layer is available; the historical raw transcript is unavailable.",
        reasonForSurfacing: "The reconstruction records a late workload contradiction and an insufficient confidence reduction.",
        expectedRetrievalEffect: "If Cody approves it later, surface a rerank check in comparable pitcher-prop and run-line research.",
      }],
    },
  });
  assert.equal(analyzed.response.status, 201);
  assert.equal(analyzed.value.findings.length, 1);
  assert.equal(analyzed.value.findings[0].status, "proposed");
  assert.equal(analyzed.value.selectedNodes[0].representationType, "Reconstructed");
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get("sports").count,
    0,
  );
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM governance_events WHERE project_id = ?").get("sports").count,
    0,
  );
  const finding = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(analyzed.value.findings[0].id)}`,
  );
  assert.equal(finding.response.status, 200);
  assert.equal(finding.value.sourceEvents[0].exactSourceSpan, fixture);
  assert.equal(finding.value.sourceEvents[0].sourceLinks[0].messageId, sourceMessage.id);
  assert.match(
    finding.value.sourceEvents[0].sourceLinks[0].href,
    new RegExp(`#${encodeURIComponent(`message-${sourceMessage.id}`)}$`),
  );
  assert.equal(fixtureContract.rawTranscriptAvailable, false);
});

test("Slice 3 Keep local and Challenge produce distinct canonical retrieval effects", async () => {
  const worker = await builtWorker("slice3-local-challenge");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(worker, DB, "local-challenge", ["assumption"]);
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice3-local-challenge-source",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [
        {
          findingType: "mechanism_recognition",
          sourceEventIds: [seeded.events[0].id],
          proposalStatement: "Keep this assumption check inside the active case.",
          proposedScope: "local",
          reasonForSurfacing: "The evidence supports only this case.",
          expectedRetrievalEffect: "Eligible only while reconstructing this case.",
        },
        {
          findingType: "correction",
          sourceEventIds: [seeded.events[0].id],
          proposalStatement: "Treat the assumption as a settled project-wide correction.",
          proposedScope: "project_wide",
          reasonForSurfacing: "The same source could be overread.",
          expectedRetrievalEffect: "Would change later project reasoning if approved.",
        },
      ],
    },
  });
  assert.equal(checkpoint.response.status, 201);
  assert.equal(checkpoint.value.findings.length, 2);
  const [localFinding, challengedFinding] = checkpoint.value.findings;
  const keptLocal = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(localFinding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-keep-local",
      body: {
        action: "keep_local",
        actorId: "cody",
        sourceVersionId: localFinding.currentVersionId,
        reason: "The source supports local continuity, not a project-wide rule.",
      },
    },
  );
  assert.equal(keptLocal.response.status, 201);
  assert.equal(keptLocal.value.newAuthority, "approved_local");
  assert.equal(keptLocal.value.retrievalEffect, "eligible_local_case");

  const challenged = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(challengedFinding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice3-challenge",
      body: {
        action: "challenge",
        actorId: "cody",
        sourceVersionId: challengedFinding.currentVersionId,
        reason: "The proposed project-wide consequence exceeds the source.",
      },
    },
  );
  assert.equal(challenged.response.status, 201);
  assert.equal(challenged.value.record.status, "challenged");
  assert.equal(challenged.value.newAuthority, "challenged");
  assert.equal(challenged.value.retrievalEffect, "excluded_from_governing_use");

  const eligibleForCase = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/mechanisms/eligible?caseId=${encodeURIComponent(seeded.caseId)}`,
  );
  assert.equal(eligibleForCase.value.mechanisms.length, 1);
  assert.equal(eligibleForCase.value.mechanisms[0].authority_state, "approved_local");
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM mechanisms WHERE project_id = ?").get("sports").count,
    1,
  );
});

test("Slice 4 migration protects immutable roadways, packets, items, and receipts", async () => {
  const migration = await readFile(new URL("../drizzle/0007_harsh_makkari.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `live_state_snapshots`/);
  assert.match(migration, /packets_project_idempotency/);
  assert.match(migration, /packet_items_sequence/);
  assert.match(migration, /roadway_versions_immutable_update/);
  assert.match(migration, /packets_immutable_delete/);
  assert.match(migration, /packet_items_immutable_update/);
  assert.match(migration, /receipts_immutable_delete/);
});

test("Slice 4 registry contains three conclusion-free versioned roadways and exposes ambiguity", async () => {
  const worker = await builtWorker("slice4-roadway-registry");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");

  const registry = await slice2Request(worker, DB, "/api/v1/projects/sports/roadways");
  assert.equal(registry.response.status, 200);
  assert.equal(registry.value.roadways.length, 3);
  assert.deepEqual(
    new Set(registry.value.roadways.map((roadway) => roadway.name)),
    new Set(["Broad Lock-Finding", "Margin / Run-Line Value", "Outcome / Postmortem"]),
  );
  for (const roadway of registry.value.roadways) {
    assert.equal(roadway.version, 1);
    assert.equal(roadway.status, "active");
    assert.equal(roadway.authorityState, "approved_project_wide");
    assert.ok(roadway.requiredChecks.length > 0);
    assert.ok(roadway.requiredCounterevidence.length > 0);
    assert.ok(roadway.stopConditions.length > 0);
    assert.doesNotMatch(JSON.stringify(roadway), /avoid run lines|bet favorites|prefer first five|brewers mechanism always governs/i);
  }

  const broad = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/interpret", {
    method: "POST",
    body: { task: "Compare the available markets and rank the strongest option on the slate." },
  });
  assert.equal(broad.response.status, 200);
  assert.equal(broad.value.interpretation.primaryRoadway.name, "Broad Lock-Finding");

  const margin = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/interpret", {
    method: "POST",
    body: { task: "Can this favorite win by two, or is the one-score path too large at that number?" },
  });
  assert.equal(margin.response.status, 200);
  assert.equal(margin.value.interpretation.primaryRoadway.name, "Margin / Run-Line Value");

  const postmortem = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/interpret", {
    method: "POST",
    body: { task: "Explain what went wrong after the game and identify the postmortem correction." },
  });
  assert.equal(postmortem.response.status, 200);
  assert.equal(postmortem.value.interpretation.primaryRoadway.name, "Outcome / Postmortem");

  const ambiguous = await createSlice4Packet(worker, DB, {
    task: "Compare the best option and explain why the prior outcome failed.",
  }, "slice4-material-ambiguity");
  assert.equal(ambiguous.response.status, 409);
  assert.equal(ambiguous.value.status, "clarification_required");
  assert.equal(ambiguous.value.interpretation.materialAmbiguity, true);
  assert.equal(ambiguous.value.packet, null);

  const override = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/interpret", {
    method: "POST",
    body: {
      task: "Compare the best option and explain why the prior outcome failed.",
      roadwayOverride: "outcome-postmortem",
    },
  });
  assert.equal(override.response.status, 200);
  assert.equal(override.value.interpretation.primaryRoadway.name, "Outcome / Postmortem");
  assert.equal(override.value.interpretation.userSelectedOverride, true);
  assert.equal(
    DB.database.prepare("SELECT COUNT(*) AS count FROM roadway_versions WHERE project_id = ?").get("sports").count,
    3,
  );
});

test("Slice 4 comparable packets record the exact Slice 3 governance event that changes eligibility", async () => {
  const worker = await builtWorker("slice4-governance-packet-diff");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  const seeded = await seedSlice3Case(worker, DB, "slice4-margin-proof", ["challenge", "evidence"]);
  DB.database.prepare("UPDATE events SET exact_source_span = ?, compressed_representation = ? WHERE id = ?").run(
    "The one-score path remains the strongest counterexample to the favorite covering.",
    "One-score outcomes challenge the margin-cover thesis.",
    seeded.events[0].id,
  );
  const mechanismStatement = "Separate outright win probability from cover probability by testing margin distribution, one-score paths, and the offered number.";
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "slice4-proof-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: [seeded.events[1].id],
        proposalStatement: "Initial Atlas wording about margin distribution.",
        proposedScope: "project_wide",
        conditions: ["Use for run-line or winning-margin tasks."],
        exclusions: ["Do not use as a conclusion about favorites."],
        supportingEvidence: [seeded.events[1].id],
        counterevidence: [seeded.events[0].id],
        uncertainty: "One case does not establish a universal rule.",
        reasonForSurfacing: "The task mechanism separates winning from covering.",
        expectedRetrievalEffect: "Eligible only after Cody reviews and approves the final wording and scope.",
      }],
    },
  });
  assert.equal(checkpoint.response.status, 201);
  const finding = checkpoint.value.findings[0];
  const task = "Can this favorite win by two, or does the one-score path make the number too expensive?";

  const before = await createSlice4Packet(worker, DB, {
    task,
    caseId: seeded.caseId,
    tokenBudget: 800,
  }, "slice4-proof-before");
  assert.equal(before.response.status, 201, JSON.stringify(before.value));
  assert.equal(before.value.packet.status, "compiled");
  assert.equal(
    before.value.receipt.treatmentSummary.Use.some((item) => item.sourceType === "Mechanism"),
    false,
  );
  assert.equal(
    before.value.receipt.treatmentSummary.Consider.some((item) => item.sourceId === finding.id),
    true,
  );

  const revised = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice4-proof-revise",
      body: {
        action: "revise",
        actorId: "cody",
        sourceVersionId: finding.currentVersionId,
        reviewedStatement: mechanismStatement,
        scope: "project_wide",
        reason: "Cody is narrowing the mechanism to margin-value tasks.",
      },
    },
  );
  assert.equal(revised.response.status, 201);
  const approved = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "slice4-proof-approve",
      body: {
        action: "approve",
        actorId: "cody",
        sourceVersionId: revised.value.record.currentVersionId,
        scope: "project_wide",
        reason: "Approve Cody's reviewed wording for comparable margin-value retrieval.",
      },
    },
  );
  assert.equal(approved.response.status, 201);

  const after = await createSlice4Packet(worker, DB, {
    task,
    caseId: seeded.caseId,
    tokenBudget: 800,
  }, "slice4-proof-after");
  assert.equal(after.response.status, 201, JSON.stringify(after.value));
  assert.equal(after.value.packet.status, "compiled");
  assert.equal(after.value.packet.priorComparablePacketId, before.value.packet.id);
  const usedMechanism = after.value.receipt.treatmentSummary.Use.find(
    (item) => item.sourceId === approved.value.mechanism.id,
  );
  assert.ok(usedMechanism);
  assert.equal(usedMechanism.sourceVersionId, approved.value.mechanism.current_governing_version_id);
  assert.ok(
    after.value.receipt.treatmentSummary.Consider.some(
      (item) => item.sourceId === seeded.events[0].id && /counterevidence|challenge/i.test(item.reason),
    ),
  );
  assert.ok(
    after.value.receipt.governanceCauses.some(
      (cause) => cause.governanceEventId === approved.value.governanceEvent.id,
    ),
  );
  assert.ok(
    after.value.receipt.exactPacketDifference.some(
      (change) => change.sourceId === approved.value.mechanism.id,
    ),
  );
  assert.doesNotMatch(JSON.stringify(after.value.receipt.governanceCauses), /final decision (?:was|to be) correct/i);

  const read = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/packets/${encodeURIComponent(after.value.packet.id)}`,
  );
  assert.equal(read.response.status, 200);
  assert.deepEqual(read.value.packet, after.value.packet);
  assert.deepEqual(read.value.receipt, after.value.receipt);
  const receiptRead = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/packets/${encodeURIComponent(after.value.packet.id)}/receipt`,
  );
  assert.deepEqual(receiptRead.value.receipt, after.value.receipt);
  const comparisonRead = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/packets/${encodeURIComponent(after.value.packet.id)}/comparison`,
  );
  assert.equal(comparisonRead.value.priorComparablePacketId, before.value.packet.id);
  assert.deepEqual(comparisonRead.value.exactPacketDifference, after.value.receipt.exactPacketDifference);
});

test("Slice 4 calibration treatments enforce mechanism, scope, authority, evidence, conflict, and project gates", async () => {
  const expectations = JSON.parse(await readFile(
    new URL("../fixtures/slice4/calibration-expectations.json", import.meta.url),
    "utf8",
  )).fixtures;
  const worker = await builtWorker("slice4-calibration-treatments");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Development");
  const active = await seedSlice3Case(worker, DB, "slice4-calibration", ["correction", "outcome", "challenge", "assumption"]);
  const outside = await seedSlice3Case(worker, DB, "slice4-outside-scope", ["evidence"]);
  const [correction, outcome, challenge, inference] = active.events;
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ?, actor_id = 'cody', ingested_at = ? WHERE id = ?",
  ).run(
    "Cody correction: winning is not covering; keep the one-score margin path visible.",
    "Cody corrected the inference: winning and covering are distinct.",
    "2026-07-01T00:00:00.000Z",
    correction.id,
  );
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ?, ingested_at = ? WHERE id = ?",
  ).run(
    "Older completed outcome: the favorite won by one and did not cover.",
    "Outcome-backed evidence: favorite won by one and failed to cover.",
    "2026-06-01T00:00:00.000Z",
    outcome.id,
  );
  DB.database.prepare(
    "UPDATE events SET exact_source_span = ?, compressed_representation = ? WHERE id = ?",
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
  assert.equal(byId.get(challenge.id).packetEligibleProtected, true);
  for (const id of ["mechanism:conflict-include", "mechanism:conflict-exclude"]) {
    assert.equal(byId.get(id).treatment, expectations.conflicting_approved_mechanisms.expectedTreatment);
    assert.equal(byId.get(id).representation, expectations.conflicting_approved_mechanisms.expectedRepresentation);
    assert.equal(byId.get(id).packetEligibleProtected, true);
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

test("Slice 4 canonical reconstruction remains available beneath the final Ask workflow", async () => {
  const worker = await builtWorker("slice4-minimal-interface");
  const response = await worker.fetch(
    new Request("http://localhost/projects/sports/ask", { headers: { accept: "text/html" } }),
    { ASSETS: assets },
    ctx,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ["Ask with Atlas", "Canonical V1.7"]) {
    assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const [interfaceSource, candidateSource, packetSource] = await Promise.all([
    readFile(new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/candidate-treatment-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/packet-preview.tsx", import.meta.url), "utf8"),
  ]);
  for (const text of [
    "Interpret",
    "Treat candidates",
    "Compile packet",
    "400",
    "800",
    "1600",
  ]) {
    assert.match(`${interfaceSource}\n${candidateSource}\n${packetSource}`, new RegExp(text));
  }
  assert.match(interfaceSource, /reconstruction\/candidates/);
  assert.match(candidateSource, /canonical server results/);
  assert.match(packetSource, /same immutable packet response/i);
  assert.match(packetSource, /packetEligibleProtected === true/);
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
  const independentCorrection = Object.values(after.value.receipt.treatmentSummary).flat().find(
    (item) => item.sourceId === seeded.events[1].id,
  );
  assert.ok(independentCorrection);
  assert.equal(independentCorrection.treatment, "Consider");
  assert.equal(independentCorrection.packetEligibleProtected, true);
  assert.match(after.value.packet.compiledContent, /Cody corrected the scope: winning is not covering/i);

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

test("Slice 5 immutable handoff remains auditable through the final separated Ask presentation", async () => {
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
  const [service, adapter, api, interfaceSource, handoffSource, historySource, pageSource] = await Promise.all([
    readFile(new URL("../worker/handoff-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/receiving-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/slice5-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/reconstruction-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/handoff-presentation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/ask-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[projectId]/ask/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const text of [
    "Your request",
    "Atlas reconstruction",
    "Model answer",
    "Receipt",
    "Additional live retrieval",
    "No additional live retrieval occurred",
    "A test adapter is never selectable here",
  ]) {
    assert.match(handoffSource, new RegExp(text));
  }
  assert.match(pageSource, /Canonical V1\.7/);
  assert.match(interfaceSource, /model\.production === true/);
  assert.match(historySource, /never recompiles a packet or retries a handoff/i);
  assert.match(adapter, /not a new user instruction/i);
  assert.match(adapter, /role: "user"/);
  assert.match(service, /packetRecompiled: false/);
  assert.match(service, /Supplying context does not establish outcome correctness/i);
  assert.match(api, /parts\[1\] === "comparison"/);
  assert.doesNotMatch(`${service}\n${adapter}\n${api}`, /England|Ghana|seeded answer/i);
  assert.doesNotMatch(`${interfaceSource}\n${handoffSource}\n${pageSource}`, /atlas-test-receiver-v1|England|Ghana/);
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

test("Slice 6C previews server-owned candidate treatments without creating a packet", async () => {
  const worker = await builtWorker("slice6c-candidate-preview");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice6c-preview",
    statement: "Separate winning from covering by preserving the one-score counter-script.",
    counterevidenceIds: ["challenge:slice6c-preview"],
  });

  const before = await slice2Request(worker, DB, "/api/v1/projects/sports/packets");
  assert.equal(before.response.status, 200);
  assert.equal(before.value.packets.length, 0);

  const preview = await slice2Request(
    worker,
    DB,
    "/api/v1/projects/sports/reconstruction/candidates",
    {
      method: "POST",
      body: {
        task: "Can this favorite win by two, or is the one-score cover path too large?",
        tokenBudget: 800,
      },
    },
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.value));
  assert.equal(preview.value.status, "ready");
  assert.equal(preview.value.packetCreated, false);
  assert.equal(preview.value.projectId, "sports");
  assert.equal(preview.value.tokenBudget, 800);
  for (const treatment of ["Use", "Consider", "Exclude"]) {
    assert.ok(Array.isArray(preview.value.treatmentSummary[treatment]));
    for (const item of preview.value.treatmentSummary[treatment]) {
      assert.equal(item.treatment, treatment);
      assert.ok(item.reason);
    }
  }
  assert.equal(typeof preview.value.candidateSummary.strongestChallengeRetained, "boolean");

  const after = await slice2Request(worker, DB, "/api/v1/projects/sports/packets");
  assert.equal(after.response.status, 200);
  assert.equal(after.value.packets.length, 0);

  const ambiguous = await slice2Request(
    worker,
    DB,
    "/api/v1/projects/sports/reconstruction/candidates",
    {
      method: "POST",
      body: { task: "Which market explains the outcome?", tokenBudget: 400 },
    },
  );
  assert.equal(ambiguous.response.status, 409);
  assert.equal(ambiguous.value.status, "clarification_required");
  assert.equal(ambiguous.value.packetCreated, false);
  assert.equal(ambiguous.value.interpretation.primaryRoadway, null);

  const crossProject = await slice2Request(
    worker,
    DB,
    "/api/v1/projects/hockey/reconstruction/candidates",
    {
      method: "POST",
      body: {
        task: "Can this favorite win by two, or is the one-score cover path too large?",
        tokenBudget: 800,
      },
    },
  );
  assert.equal(crossProject.response.status, 200);
  assert.equal(
    Object.values(crossProject.value.treatmentSummary).flat()
      .some((item) => item.sourceId === "mechanism:slice6c-preview"),
    false,
  );
});

test("Dogfood preview uses canonical case context and collapses governed lineage without mutation", async () => {
  const worker = await builtWorker("dogfood-case-aware-lineage-treatment");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  const seeded = await seedSlice3Case(
    worker,
    DB,
    "case-aware-lineage",
    ["evidence", "correction", "challenge"],
    [
      "Wait for sustained territory, credible chance creation, and controlled transition risk before entering live on a soccer favorite.",
      "If the live price exceeds a preset maximum before those signals appear, pass rather than chase; the confirmation rule remains provisional.",
      "A genuine counterexample shows that early territory can occur without credible chance creation.",
    ],
  );
  const canonicalObjective = "Develop a repeatable rule for deciding when to enter live on a soccer favorite by balancing early control signals against the risk of the price getting worse.";
  DB.database.prepare("UPDATE cases SET objective = ? WHERE id = ? AND project_id = 'sports'").run(
    canonicalObjective,
    seeded.caseId,
  );
  const wrongCase = await seedSlice3Case(worker, DB, "wrong-case", ["evidence"]);
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "dogfood-case-lineage-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: [seeded.events[0].id, seeded.events[1].id],
        proposalStatement: "Atlas provisional live-entry wording.",
        proposedScope: "local",
        conditions: ["Use only for this soccer live-entry case."],
        exclusions: ["Do not treat the unresolved confirmation window as settled."],
        supportingEvidence: [seeded.events[0].id, seeded.events[1].id],
        counterevidence: [seeded.events[2].id],
        uncertainty: "The confirmation window remains provisional.",
        reasonForSurfacing: "The selected sources support one bounded live-entry consequence.",
        expectedRetrievalEffect: "No effect until Cody governs the reviewed wording.",
      }],
    },
  });
  assert.equal(checkpoint.response.status, 201, JSON.stringify(checkpoint.value));
  const finding = checkpoint.value.findings[0];
  const governedStatement = "Before entering live on a soccer favorite, require sustained territory, credible chance creation, and controlled transition risk. If the price exceeds a preset maximum before those signals appear, pass rather than chase. The confirmation rule remains provisional until we determine whether it should be primarily time-based, game-state-based, or a combination of both.";
  const revised = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "dogfood-case-lineage-revise",
      body: {
        action: "revise",
        actorId: "cody",
        sourceVersionId: finding.currentVersionId,
        reviewedStatement: governedStatement,
        scope: "local",
        reason: "Preserve the useful local rule and its unresolved confirmation window.",
      },
    },
  );
  assert.equal(revised.response.status, 201);
  const approved = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "dogfood-case-lineage-approve",
      body: {
        action: "approve",
        actorId: "cody",
        sourceVersionId: revised.value.record.currentVersionId,
        scope: "local",
        reason: "Approve Cody's final reviewed wording for this case only.",
      },
    },
  );
  assert.equal(approved.response.status, 201);
  const mechanismId = approved.value.mechanism.id;
  const task = "Compare the live-entry options for a soccer favorite and identify the strongest decision rule.";
  const packetCountBefore = DB.database.prepare("SELECT COUNT(*) AS count FROM packets WHERE project_id = 'sports'").get().count;
  const preview = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/candidates", {
    method: "POST",
    body: {
      task,
      caseId: seeded.caseId,
      caseObjective: "Injected client objective about an unrelated baseball payroll task.",
      roadwayOverride: "broad-lock-finding",
      tokenBudget: 1600,
    },
  });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.value));
  assert.equal(preview.value.packetCreated, false);
  assert.equal(preview.value.interpretation.literalRequest, task);
  assert.equal(preview.value.interpretation.caseObjective, canonicalObjective);
  assert.equal(preview.value.interpretation.caseContextUsedForMatching, true);
  assert.equal(preview.value.treatmentSummary.Use.length, 1);
  const mechanism = preview.value.treatmentSummary.Use[0];
  assert.equal(mechanism.sourceId, mechanismId);
  assert.equal(mechanism.statement, governedStatement);
  assert.equal(mechanism.authority, "approved_local");
  assert.equal(mechanism.caseId, seeded.caseId);
  assert.equal(mechanism.ranking.independentRepetition, 1);

  const representedEventIds = new Set([seeded.events[0].id, seeded.events[1].id]);
  const checkpointNodeIds = DB.database.prepare(
    `SELECT c.reasoning_node_id, v.source_event_ids
     FROM checkpoint_reasoning_nodes c
     JOIN reasoning_nodes n ON n.id = c.reasoning_node_id
     JOIN reasoning_node_versions v ON v.id = n.current_version_id
     WHERE c.checkpoint_id = ? ORDER BY c.selection_order`,
  ).all(finding.checkpointId)
    .filter((row) => JSON.parse(row.source_event_ids).some((id) => representedEventIds.has(id)))
    .map((row) => row.reasoning_node_id);
  const ancestorIds = new Set([
    finding.id,
    ...checkpointNodeIds,
    seeded.events[0].id,
    seeded.events[1].id,
  ]);
  const ancestors = Object.values(preview.value.treatmentSummary).flat()
    .filter((item) => ancestorIds.has(item.sourceId));
  assert.equal(ancestors.length, ancestorIds.size);
  assert.ok(ancestors.every((item) => item.treatment === "Exclude"));
  assert.ok(ancestors.every((item) => item.metadata.lineageOnly === true), JSON.stringify(ancestors, null, 2));
  assert.ok(ancestors.every((item) => item.metadata.representedByMechanismId === mechanismId));
  assert.ok(ancestors.every((item) => item.ranking.independentRepetition === 0));
  assert.ok(ancestors.every((item) => /retained for lineage and audit/i.test(item.reason)));
  assert.equal(preview.value.treatmentSummary.Consider.some((item) => ancestorIds.has(item.sourceId)), false);
  assert.equal(preview.value.candidateSummary.lineageRecordsRetained, ancestorIds.size);
  const correctionLineage = ancestors.filter((item) => (
    item.sourceId === seeded.events[1].id
    || (
      item.sourceType === "ReasoningNode"
      && item.metadata.sourceEventIds.includes(seeded.events[1].id)
    )
  ));
  assert.equal(correctionLineage.length, 2, JSON.stringify(correctionLineage, null, 2));
  assert.ok(correctionLineage.every((item) => item.protectedRole === "correction"));
  assert.ok(correctionLineage.every((item) => item.packetEligibleProtected === false));
  assert.equal(preview.value.protectedCorrections.length, 0);
  assert.equal(preview.value.candidateSummary.protectedCorrectionsRetained, 0);
  const challenge = preview.value.treatmentSummary.Consider.find((item) => item.sourceId === seeded.events[2].id);
  assert.ok(challenge);
  assert.match(challenge.reason, /counterevidence|challenge/i);
  assert.equal(challenge.packetEligibleProtected, true);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM packets WHERE project_id = 'sports'").get().count, packetCountBefore);

  for (const body of [
    { task, roadwayOverride: "broad-lock-finding" },
    { task, caseId: wrongCase.caseId, roadwayOverride: "broad-lock-finding" },
    { task: "Compare the strongest baseball payroll accounting option.", caseId: seeded.caseId, roadwayOverride: "broad-lock-finding" },
  ]) {
    const result = await slice2Request(worker, DB, "/api/v1/projects/sports/reconstruction/candidates", {
      method: "POST",
      body: { ...body, tokenBudget: 1600 },
    });
    assert.equal(result.response.status, 200);
    assert.equal(
      result.value.treatmentSummary.Use.some((item) => item.sourceId === mechanismId),
      false,
    );
    if (body.caseId === seeded.caseId) {
      assert.equal(result.value.interpretation.caseContextUsedForMatching, false);
    }
  }

  const isolated = await slice2Request(worker, DB, "/api/v1/projects/hockey/reconstruction/candidates", {
    method: "POST",
    body: { task, roadwayOverride: "broad-lock-finding", tokenBudget: 1600 },
  });
  assert.equal(isolated.response.status, 200);
  assert.equal(
    Object.values(isolated.value.treatmentSummary).flat().some((item) => item.sourceId === mechanismId),
    false,
  );

  const packet = await createSlice4Packet(worker, DB, {
    task,
    caseId: seeded.caseId,
    roadwayOverride: "broad-lock-finding",
    tokenBudget: 1600,
  }, "dogfood-lineage-protected-boundary-packet");
  assert.equal(packet.response.status, 201, JSON.stringify(packet.value));
  assert.equal(packet.value.packet.status, "compiled");
  assert.equal(packet.value.packet.finalTokenCount, preview.value.estimatedFinalSize);
  const packetExcluded = packet.value.receipt.treatmentSummary.Exclude.filter(
    (item) => correctionLineage.some((ancestor) => ancestor.sourceId === item.sourceId),
  );
  assert.equal(packetExcluded.length, 2);
  assert.ok(packetExcluded.every((item) => item.packetEligibleProtected === false));
  assert.ok(packetExcluded.every((item) => item.metadata.lineageOnly === true));
  assert.ok(packetExcluded.every((item) => item.metadata.representedByMechanismId === mechanismId));
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

async function reconstructionRunRequest(worker, DB, projectId, body, idempotencyKey, extraEnv = {}) {
  const response = await worker.fetch(new Request(
    `http://localhost/api/v1/projects/${encodeURIComponent(projectId)}/reconstruction/run`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer slice-2-test-key",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
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

async function seedReconstructionRunFixture(worker, DB, suffix = "default") {
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await initializeRoadways(worker, DB, "sports");
  seedSlice4Mechanism(DB, {
    id: `mechanism:reconstruction-run-${suffix}`,
    statement: "Compare candidate decision rules under a common evidence standard before selecting the strongest governed option.",
  });
  return {
    task: "Compare the strongest candidate decision rule.",
    roadwayOverride: "broad-lock-finding",
    tokenBudget: 800,
  };
}

async function seedSoccerReconstructionFixture(worker, DB) {
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await initializeRoadways(worker, DB, "sports");
  const seeded = await seedSlice3Case(
    worker,
    DB,
    "v171-slice-b-soccer",
    ["evidence", "correction"],
    [
      "Wait for sustained territory, credible chance creation, and controlled transition risk before entering live on a soccer favorite.",
      "If the live price exceeds a preset maximum before those signals appear, pass rather than chase; the confirmation rule remains provisional.",
    ],
  );
  DB.database.prepare("UPDATE cases SET objective = ? WHERE id = ? AND project_id = 'sports'").run(
    "Develop a repeatable rule for deciding when to enter live on a soccer favorite by balancing early control signals against the risk of the price getting worse.",
    seeded.caseId,
  );
  const checkpoint = await slice2Request(worker, DB, "/api/v1/projects/sports/checkpoints", {
    method: "POST",
    idempotencyKey: "v171-slice-b-soccer-checkpoint",
    body: {
      conversationId: seeded.conversationId,
      caseId: seeded.caseId,
      source: "explicit_analyzer_candidates",
      findingCandidates: [{
        findingType: "mechanism_recognition",
        sourceEventIds: seeded.events.map((event) => event.id),
        proposalStatement: "Atlas provisional soccer favorite decision rule.",
        proposedScope: "local",
        conditions: ["Use only for this soccer live-entry case."],
        exclusions: ["Do not treat the confirmation window as settled."],
        supportingEvidence: seeded.events.map((event) => event.id),
        counterevidence: [],
        uncertainty: "The confirmation rule remains provisional.",
        reasonForSurfacing: "Two Exact sources support one bounded live-entry consequence.",
        expectedRetrievalEffect: "No effect until Cody governs the reviewed wording.",
      }],
    },
  });
  assert.equal(checkpoint.response.status, 201, JSON.stringify(checkpoint.value));
  const finding = checkpoint.value.findings[0];
  const statement = "Before entering live on a soccer favorite, require sustained territory, credible chance creation, and controlled transition risk. If the price exceeds a preset maximum before those signals appear, pass rather than chase. The confirmation rule remains provisional until we determine whether it should be primarily time-based, game-state-based, or a combination of both.";
  const revised = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "v171-slice-b-soccer-revise",
      body: {
        action: "revise",
        actorId: "cody",
        sourceVersionId: finding.currentVersionId,
        reviewedStatement: statement,
        scope: "local",
        reason: "Preserve the complete pass condition and provisional confirmation uncertainty.",
      },
    },
  );
  assert.equal(revised.response.status, 201, JSON.stringify(revised.value));
  const approved = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/findings/${encodeURIComponent(finding.id)}/governance`,
    {
      method: "POST",
      idempotencyKey: "v171-slice-b-soccer-approve",
      body: {
        action: "approve",
        actorId: "cody",
        sourceVersionId: revised.value.record.currentVersionId,
        scope: "local",
        reason: "Approve Cody's reviewed wording for this exact case.",
      },
    },
  );
  assert.equal(approved.response.status, 201, JSON.stringify(approved.value));
  return {
    seeded,
    finding,
    mechanism: approved.value.mechanism,
    statement,
    body: {
      task: "Compare all the governed options for a soccer favorite and identify the strongest decision rule.",
      caseId: seeded.caseId,
      roadwayOverride: "broad-lock-finding",
      tokenBudget: 800,
    },
  };
}

test("V1.7.1 reconstruction/run exposes a write-authorized additive OpenAPI contract", async () => {
  const worker = await builtWorker("v171-slice-b-openapi");
  const response = await worker.fetch(
    new Request("http://localhost/.well-known/openapi.json"),
    { DB: memoryD1(), ASSETS: assets },
    ctx,
  );
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.info.version, "4.6.0");
  assert.ok(spec.paths["/api/v1/projects/{projectId}/continuity/check"]);
  const operation = spec.paths["/api/v1/projects/{projectId}/reconstruction/run"].post;
  assert.equal(operation.operationId, "runCanonicalReconstruction");
  assert.ok(operation.parameters.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required));
  assert.deepEqual(spec.components.schemas.ReconstructionRunRequest.properties.tokenBudget.enum, [400, 800, 1600]);
  assert.deepEqual(
    spec.components.schemas.ReconstructionRunStoppedResponse.properties.status.enum,
    ["clarification_required", "atlas_not_needed", "light_continuity_only", "missing_required_state", "unsafe_under_selected_budget"],
  );
  assert.equal(spec.components.schemas.ReconstructionRunEffects.properties.handoffCreated.const, false);
  assert.equal(spec.components.schemas.ReconstructionRunEffects.properties.providerCallPerformed.const, false);
  assert.equal(spec.components.schemas.ReconstructionRunCompiledResponse.properties.replaySource.enum[0], "saved_immutable_packet");
  assert.equal(spec.components.schemas.ReconstructionRunCompiledResponse.properties.currentPreflightPerformed.type, "boolean");
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, "bearer");
});

test("V1.7.1 reconstruction/run compiles one atomic packet and matches the canonical compiler", async () => {
  const worker = await builtWorker("v171-slice-b-parity");
  const directDB = await sqliteD1();
  const facadeDB = await sqliteD1();
  const directBody = await seedReconstructionRunFixture(worker, directDB, "parity");
  const facadeBody = await seedReconstructionRunFixture(worker, facadeDB, "parity");
  facadeBody.task = `  ${facadeBody.task}  `;

  const direct = await createSlice4Packet(worker, directDB, directBody, "v171-slice-b-direct");
  assert.equal(direct.response.status, 201, JSON.stringify(direct.value));
  const before = canonicalMutationCounts(facadeDB);
  let adapterCalls = 0;
  const facade = await reconstructionRunRequest(
    worker,
    facadeDB,
    "sports",
    facadeBody,
    "v171-slice-b-facade",
    { ATLAS_TEST_RECEIVING_MODEL_ADAPTER: { async execute() { adapterCalls += 1; throw new Error("must not execute"); } } },
  );
  assert.equal(facade.response.status, 201, JSON.stringify(facade.value));
  assert.equal(facade.value.status, "compiled");
  assert.equal(facade.value.idempotentReplay, false);
  assert.equal(facade.value.effects.packetCreated, true);
  assert.equal(facade.value.effects.receiptCreated, true);
  assert.equal(facade.value.effects.handoffCreated, false);
  assert.equal(facade.value.effects.providerCallPerformed, false);
  assert.equal(adapterCalls, 0);

  assert.equal(facade.value.literalTask, facadeBody.task);
  assert.equal(facade.value.packet.compiledContent, direct.value.packet.compiledContent);
  assert.equal(facade.value.caseId, direct.value.packet.caseId);
  assert.equal(facade.value.roadway.id, direct.value.packet.primaryRoadwayId);
  assert.equal(facade.value.roadway.versionId, direct.value.packet.primaryRoadwayVersionId);
  assert.equal(facade.value.packet.finalTokenCount, direct.value.packet.finalTokenCount);
  assert.deepEqual(facade.value.receipt.freshness, direct.value.receipt.freshness);
  assert.deepEqual(facade.value.receipt.governanceCauses, direct.value.receipt.governanceCauses);
  assert.deepEqual(facade.value.receipt.unresolvedConflicts, direct.value.receipt.unresolvedConflicts);
  assert.deepEqual(facade.value.receipt.exactPacketDifference, direct.value.receipt.exactPacketDifference);
  assert.deepEqual(facade.value.receipt.treatmentSummary, direct.value.receipt.treatmentSummary);
  assert.deepEqual(facade.value.receipt.treatmentCounts, {
    Use: direct.value.receipt.treatmentSummary.Use.length,
    Consider: direct.value.receipt.treatmentSummary.Consider.length,
    Exclude: direct.value.receipt.treatmentSummary.Exclude.length,
  });
  assert.match(facade.value.receipt.honestyStatement, /does not establish outcome correctness/i);

  const after = canonicalMutationCounts(facadeDB);
  assert.equal(after.packets, before.packets + 1);
  assert.equal(after.receipts, before.receipts + 1);
  assert.ok(after.packet_items > before.packet_items);
  for (const table of Object.keys(before)) {
    if (!["packets", "packet_items", "receipts"].includes(table)) assert.equal(after[table], before[table], table);
  }
  assert.equal(after.handoffs, 0);
  assert.equal(after.handoff_answers, 0);

  const saved = await slice2Request(
    worker,
    facadeDB,
    `/api/v1/projects/sports/packets/${encodeURIComponent(facade.value.packet.id)}`,
  );
  assert.equal(saved.response.status, 200);
  assert.equal(saved.value.packet.compiledContent, facade.value.packet.compiledContent);
  assert.equal(saved.value.receipt.id, facade.value.receipt.id);
  assert.equal(facade.value.links.packet, `/api/v1/projects/sports/packets/${encodeURIComponent(facade.value.packet.id)}`);
  assert.equal(facadeDB.database.prepare("SELECT COUNT(*) AS count FROM packets").get().count, 1);
});

test("V1.7.1 reconstruction/run reproduces the reviewed soccer mechanism and lineage boundary", async () => {
  const worker = await builtWorker("v171-slice-b-soccer-parity");
  const DB = await sqliteD1();
  const fixture = await seedSoccerReconstructionFixture(worker, DB);
  const before = canonicalMutationCounts(DB);
  const result = await reconstructionRunRequest(
    worker,
    DB,
    "sports",
    fixture.body,
    "v171-slice-b-soccer-run",
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.value));
  assert.equal(result.value.need.level, "full");
  assert.equal(result.value.roadway.name, "Broad Lock-Finding");
  assert.equal(result.value.summary.governingMechanismsSupplied, 1);
  assert.equal(result.value.summary.requiredChecksSupplied, 5);
  assert.equal(result.value.summary.considerItemsSupplied, 0);
  assert.equal(result.value.summary.auditOnlyProvenanceRetained, 5);
  assert.equal(result.value.summary.protectedCorrectionsSupplied, 0);
  assert.equal(result.value.packet.tokenBudget, 800);
  assert.equal(result.value.packet.finalTokenCount, 278);
  assert.equal(result.value.packet.compiledContent.includes(fixture.seeded.events[0].id), false);
  assert.equal(result.value.effects.authorityChanged, false);
  const after = canonicalMutationCounts(DB);
  for (const table of Object.keys(before)) {
    if (!["packets", "packet_items", "receipts"].includes(table)) assert.equal(after[table], before[table], table);
  }
  const packetDetail = await slice2Request(
    worker,
    DB,
    `/api/v1/projects/sports/packets/${encodeURIComponent(result.value.packet.id)}`,
  );
  const lineage = packetDetail.value.items.filter((item) => item.metadata?.lineageOnly === true);
  assert.equal(lineage.length, 5);
  assert.ok(lineage.every((item) => item.treatment === "Exclude"));
  assert.ok(lineage.every((item) => item.packetEligibleProtected === false));
  assert.ok(lineage.every((item) => !result.value.packet.compiledContent.includes(item.sourceId)));
  const governed = packetDetail.value.receipt.treatmentSummary.Use.find((item) => item.sourceType === "Mechanism");
  assert.equal(governed.sourceId, fixture.mechanism.id);
  assert.equal(governed.statement, fixture.statement);
  assert.match(governed.statement, /pass rather than chase/i);
  assert.match(governed.statement, /time-based, game-state-based, or a combination of both/i);
});

test("V1.7.1 reconstruction/run stops without writes for none, light, ambiguity, missing state, and unsafe budget", async () => {
  const worker = await builtWorker("v171-slice-b-stopped-results");

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "sports", { task: "Convert four inches to centimeters." }, "slice-b-none");
    assert.equal(result.response.status, 422);
    assert.equal(result.value.status, "atlas_not_needed");
    assert.equal(result.value.need.level, "none");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "workflow", "Workflow Engine");
    await initializeRoadways(worker, DB, "workflow");
    seedSlice4Mechanism(DB, {
      id: "mechanism:slice-b-mobile-transfer",
      projectId: "workflow",
      statement: "When Cody requests a Codex-ready transfer from mobile, use concise plain text; this does not suppress visual teaching elsewhere.",
    });
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "workflow", { task: "Prepare a Codex-ready transfer from mobile." }, "slice-b-light");
    assert.equal(result.response.status, 422);
    assert.equal(result.value.status, "light_continuity_only");
    assert.equal(result.value.need.level, "light");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "sports", {
      task: "Compare the best option and explain why the prior outcome failed.",
      tokenBudget: 800,
    }, "slice-b-ambiguity");
    assert.equal(result.response.status, 409);
    assert.equal(result.value.status, "clarification_required");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
    await initializeRoadways(worker, DB, "sports");
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "sports", { task: "Any best bets today?" }, "slice-b-missing");
    assert.equal(result.response.status, 422);
    assert.equal(result.value.status, "missing_required_state");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "overflow", "Overflow Engine");
    await initializeRoadways(worker, DB, "overflow");
    const longClause = " while preserving price, distribution, one-score paths, outright-loss scripts, corrections, and counterevidence";
    for (let index = 0; index < 8; index += 1) {
      seedSlice4Mechanism(DB, {
        id: `mechanism:slice-b-overflow-${index}`,
        projectId: "overflow",
        statement: `${index % 2 === 0 ? "Always include" : "Never include"} margin evidence ${index}${longClause.repeat(3)}.`,
        counterevidenceIds: [`mechanism:slice-b-overflow-${index % 2 === 0 ? index + 1 : index - 1}`],
      });
    }
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "overflow", {
      task: "Can the favorite win by two, or is the one-score margin path too large?",
      roadwayOverride: "margin-run-line-value",
      tokenBudget: 400,
    }, "slice-b-unsafe");
    assert.equal(result.response.status, 422, JSON.stringify(result.value));
    assert.equal(result.value.status, "unsafe_under_selected_budget");
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }

  {
    const DB = await sqliteD1();
    await seedCanonicalProject(worker, DB, "unavailable", "Unavailable Engine");
    const before = canonicalMutationCounts(DB);
    const result = await reconstructionRunRequest(worker, DB, "unavailable", {
      task: "Compare the strongest candidate decision rule.",
      roadwayOverride: "broad-lock-finding",
    }, "slice-b-unavailable-roadways");
    assert.equal(result.response.status, 500);
    assert.match(result.value.error, /roadway registry is unavailable/i);
    assert.deepEqual(canonicalMutationCounts(DB), before);
  }
});

test("V1.7.1 reconstruction/run enforces isolation, server ownership, and complete idempotency", async () => {
  const worker = await builtWorker("v171-slice-b-isolation-idempotency");
  const DB = await sqliteD1();
  await seedCanonicalProject(worker, DB, "sports", "Sports Engine");
  await seedCanonicalProject(worker, DB, "hockey", "Hockey Engine");
  await initializeRoadways(worker, DB, "sports");
  await initializeRoadways(worker, DB, "hockey");
  const bounded = await createContinuityCase(worker, DB, "sports", "slice-b-isolation", "Compare governed soccer favorite decision rules.");
  seedSlice4Mechanism(DB, {
    id: "mechanism:slice-b-case-local",
    statement: "Compare governed soccer favorite decision rules within the active case.",
    authority: "approved_local",
    supportingCaseIds: [bounded.caseId],
  });
  const body = {
    task: "Compare the strongest soccer favorite decision rule.",
    requestedOutput: "one governed decision rule",
    caseId: bounded.caseId,
    roadwayOverride: "broad-lock-finding",
    tokenBudget: 800,
  };
  const beforeAuthorizationChecks = canonicalMutationCounts(DB);
  const noKey = await reconstructionRunRequest(worker, DB, "sports", body, undefined);
  assert.equal(noKey.response.status, 400);
  assert.match(noKey.value.error, /idempotency key is required/i);
  const unauthorizedResponse = await worker.fetch(new Request(
    "http://localhost/api/v1/projects/sports/reconstruction/run",
    {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "slice-b-unauthorized" },
      body: JSON.stringify(body),
    },
  ), { DB, ASSETS: assets, CAMPUS_ATLAS_ACTION_KEY: "slice-2-test-key" }, ctx);
  assert.equal(unauthorizedResponse.status, 401);
  assert.match((await unauthorizedResponse.json()).error, /write authorization required/i);
  const invalidBudget = await reconstructionRunRequest(
    worker,
    DB,
    "sports",
    { ...body, tokenBudget: 500 },
    "slice-b-invalid-budget",
  );
  assert.equal(invalidBudget.response.status, 400);
  assert.match(invalidBudget.value.error, /token budget must be exactly/i);
  assert.deepEqual(canonicalMutationCounts(DB), beforeAuthorizationChecks);
  const created = await reconstructionRunRequest(worker, DB, "sports", body, "slice-b-idempotency");
  assert.equal(created.response.status, 201, JSON.stringify(created.value));
  const counts = canonicalMutationCounts(DB);
  const replay = await reconstructionRunRequest(worker, DB, "sports", body, "slice-b-idempotency");
  assert.equal(replay.response.status, 200, JSON.stringify(replay.value));
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.packet.id, created.value.packet.id);
  assert.equal(replay.value.receipt.id, created.value.receipt.id);
  assert.equal(replay.value.effects.packetCreated, false);
  assert.equal(replay.value.effects.receiptCreated, false);
  assert.equal(replay.value.currentPreflightPerformed, false);
  assert.equal(replay.value.replaySource, "saved_immutable_packet");
  assert.equal(replay.value.need.level, "full");
  assert.deepEqual(replay.value.need.reasonCodes, ["idempotent_saved_reconstruction"]);
  assert.deepEqual(canonicalMutationCounts(DB), counts);

  for (const changed of [
    { ...body, task: "Compare a different strongest option." },
    { ...body, requestedOutput: "a different output" },
    { ...body, caseId: undefined },
    { ...body, roadwayOverride: "margin-run-line-value" },
    { ...body, tokenBudget: 1600 },
  ]) {
    const conflict = await reconstructionRunRequest(worker, DB, "sports", changed, "slice-b-idempotency");
    assert.equal(conflict.response.status, 409, JSON.stringify(conflict.value));
    assert.match(conflict.value.error, /idempotency key conflicts/i);
    assert.deepEqual(canonicalMutationCounts(DB), counts);
  }

  const crossProject = await reconstructionRunRequest(worker, DB, "hockey", body, "slice-b-cross-project");
  assert.equal(crossProject.response.status, 404);
  assert.match(crossProject.value.error, /case not found/i);
  assert.deepEqual(canonicalMutationCounts(DB), counts);

  for (const [field, value] of [
    ["caseObjective", "client injection"],
    ["authority", "approved_project_wide"],
    ["eligibility", true],
    ["treatments", { Use: [] }],
    ["candidates", []],
    ["mechanismWording", "client mechanism"],
    ["findingWording", "client finding"],
    ["packetText", "client packet"],
    ["packetItems", []],
    ["receiptContents", {}],
  ]) {
    const rejected = await reconstructionRunRequest(worker, DB, "sports", { ...body, [field]: value }, `slice-b-injection-${field}`);
    assert.equal(rejected.response.status, 400, field);
    assert.match(rejected.value.error, /unsupported client-authored continuity field/i);
    assert.deepEqual(canonicalMutationCounts(DB), counts);
  }

  assert.throws(
    () => DB.database.prepare("UPDATE packets SET compiled_content = 'mutated' WHERE id = ?").run(created.value.packet.id),
    /immutable/i,
  );
  const beforeRead = canonicalMutationCounts(DB);
  const read = await slice2Request(worker, DB, `/api/v1/projects/sports/packets/${encodeURIComponent(created.value.packet.id)}`);
  assert.equal(read.response.status, 200);
  assert.equal(read.value.packet.compiledContent, created.value.packet.compiledContent);
  assert.deepEqual(canonicalMutationCounts(DB), beforeRead);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM handoffs").get().count, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM handoff_answers").get().count, 0);
});

test("V1.7.1 reconstruction/run exact replay bypasses current canonical preflight", async () => {
  const worker = await builtWorker("v171-slice-b-replay-before-preflight");
  const DB = await sqliteD1();
  const body = await seedReconstructionRunFixture(worker, DB, "replay-before-preflight");
  body.requestedOutput = "one bounded governed reconstruction";
  body.roadwayOverride = "broad-lock-finding";
  const key = "v171-slice-b-replay-before-preflight";
  let adapterCalls = 0;
  const adapter = {
    ATLAS_TEST_RECEIVING_MODEL_ADAPTER: {
      async execute() {
        adapterCalls += 1;
        throw new Error("receiving model must not execute");
      },
    },
  };

  const created = await reconstructionRunRequest(worker, DB, "sports", body, key, adapter);
  assert.equal(created.response.status, 201, JSON.stringify(created.value));
  assert.equal(created.value.currentPreflightPerformed, true);
  assert.equal(created.value.replaySource, null);
  const counts = canonicalMutationCounts(DB);

  const blockedPreflight = {
    database: DB.database,
    batch: DB.batch.bind(DB),
    prepare(sql) {
      if (/\b(?:FROM|JOIN)\s+(?:projects|cases|mechanisms|mechanism_versions|reasoning_nodes|roadways|roadway_versions|events|findings|finding_versions|live_state_snapshots|relationships)\b/i.test(sql)) {
        throw new Error("current canonical preflight must not execute during saved replay");
      }
      return DB.prepare(sql);
    },
  };
  const replay = await reconstructionRunRequest(worker, blockedPreflight, "sports", body, key, adapter);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.value));
  assert.equal(replay.value.packet.id, created.value.packet.id);
  assert.equal(replay.value.receipt.id, created.value.receipt.id);
  assert.equal(replay.value.packet.compiledContent, created.value.packet.compiledContent);
  assert.equal(replay.value.idempotentReplay, true);
  assert.equal(replay.value.effects.packetCreated, false);
  assert.equal(replay.value.effects.receiptCreated, false);
  assert.equal(replay.value.currentPreflightPerformed, false);
  assert.equal(replay.value.replaySource, "saved_immutable_packet");
  assert.deepEqual(canonicalMutationCounts(DB), counts);
  assert.equal(adapterCalls, 0);

  const conflict = await reconstructionRunRequest(
    worker,
    blockedPreflight,
    "sports",
    { ...body, task: `${body.task} changed` },
    key,
    adapter,
  );
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.value));
  assert.match(conflict.value.error, /idempotency key conflicts/i);
  assert.deepEqual(canonicalMutationCounts(DB), counts);
  assert.equal(adapterCalls, 0);

  const noReadsAllowed = {
    database: DB.database,
    async batch() { throw new Error("validation must not write"); },
    prepare() { throw new Error("unsupported input must be rejected before database access"); },
  };
  const rejected = await reconstructionRunRequest(
    worker,
    noReadsAllowed,
    "sports",
    { ...body, packetText: "client-authored packet" },
    key,
    adapter,
  );
  assert.equal(rejected.response.status, 400, JSON.stringify(rejected.value));
  assert.match(rejected.value.error, /unsupported client-authored continuity field/i);
  assert.deepEqual(canonicalMutationCounts(DB), counts);
  assert.equal(adapterCalls, 0);
});

test("V1.7.1 reconstruction/run rolls back packet and items when the atomic receipt write fails", async () => {
  const worker = await builtWorker("v171-slice-b-atomicity");
  const DB = await sqliteD1();
  const body = await seedReconstructionRunFixture(worker, DB, "atomicity");
  DB.database.exec(`
    CREATE TRIGGER slice_b_receipt_failure
    BEFORE INSERT ON receipts
    BEGIN
      SELECT RAISE(ABORT, 'injected receipt failure');
    END;
  `);
  const before = canonicalMutationCounts(DB);
  const failed = await reconstructionRunRequest(worker, DB, "sports", body, "slice-b-atomicity");
  assert.equal(failed.response.status, 500);
  assert.match(failed.value.error, /injected receipt failure/i);
  assert.deepEqual(canonicalMutationCounts(DB), before);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM packets").get().count, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM packet_items").get().count, 0);
  assert.equal(DB.database.prepare("SELECT COUNT(*) AS count FROM receipts").get().count, 0);
});
