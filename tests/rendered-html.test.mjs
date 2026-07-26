import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("renders the development preview", async () => {
  const worker = await builtWorker("render");
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: assets }, ctx);
  assert.equal(response.status, 200);
  assert.match(await response.text(), developmentPreviewMeta);
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
  const stored = await (await worker.fetch(new Request("http://localhost/api/state"), { DB, ASSETS: assets }, ctx)).json();
  assert.ok(stored.state.cases.some((item) => item.title === "New soccer case" && item.origin === "API-created"));
  assert.ok(stored.state.evidence.some((item) => item.content.includes("inspectable evidence")));
  assert.ok(stored.state.activities.some((item) => item.action === "Case captured"));
  assert.ok(stored.state.nodes.some((item) => item.title === "New soccer case"));
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
