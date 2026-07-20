import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

function memoryD1() {
  const rows = new Map();
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return /SELECT payload/i.test(sql) ? rows.get(values[0]) ?? null : null; },
        async run() {
          if (/INSERT INTO atlas_state/i.test(sql)) rows.set(values[0], { payload: values[1], updated_at: new Date().toISOString() });
          return { success: true };
        },
      };
    },
  };
}

async function builtWorker(suffix) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(suffix, `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("mobile navigation focuses one workspace instead of stacking the full Atlas", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /aria-label="Campus Atlas mobile workspace"/);
  assert.match(page, />Ask<\/button>/);
  assert.match(page, />Projects<\/button>/);
  assert.match(page, />Atlas<\/button>/);
  assert.match(page, />Review<\/button>/);
  assert.match(css, /\.mobile-ask \.workspace/);
  assert.match(css, /\.mobile-atlas \.project-strip/);
  assert.match(css, /\.mobile-review \.workspace/);
});

test("project capture stays contextual instead of becoming a duplicate destination", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(page, /className="nav-capture"/);
  assert.doesNotMatch(page, /className="mobile-capture"/);
  assert.doesNotMatch(page, /className="floating-capture"/);
  assert.match(page, /SportsWorkspaceView = "cases" \| "knowledge" \| "blueprint"/);
  assert.doesNotMatch(page, /\["workbench", "Workbench"/);
  assert.match(page, /case workspace/);
  assert.match(page, /Every action lands here/);
  assert.match(page, /Live sidecar test/);
  assert.match(page, /Test future retrieval/);
  assert.match(css, /\.sports-workspace-tabs/);
});

test("capture migrates older device records and shows validation failures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /function normalizeNode/);
  assert.match(page, /data\.nodes\.map\(\(item: Partial<KnowledgeNode>\) => normalizeNode\(item\)\)/);
  assert.match(page, /Complete the highlighted field before saving/);
  assert.match(page, /Saving creates a receipt and updates Cases, Recent Work/);
  assert.match(page, /No additional connection/);
});

test("V4.3 exposes the complete governed Sports Engine workspace lifecycle", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const action of [
    "Capture research / thesis",
    "Record outcome",
    "Run post-mortem",
    "Add correction",
    "Add evidence",
    "Build context packet",
  ]) assert.match(page, new RegExp(action.replace("/", "\\/")));

  for (const stage of [
    "Captured",
    "Connected",
    "Tested",
    "Eligible for promotion",
    "Available to future retrieval",
  ]) assert.match(page, new RegExp(stage));

  assert.match(page, /Change Receipt · V4\.3/);
  assert.match(page, /Create a new case/);
  assert.match(page, /Update the selected case/);
  assert.match(page, /Thesis/);
  assert.match(page, /Research audit/);
  assert.match(page, /Evidence ledger/);
  assert.match(page, /Promotion status/);
  assert.match(page, /Future retrieval influence/);
  assert.match(page, /relatedId && relatedId !== target\.id/);
  assert.match(page, /approved: false, inferred: true/);
  assert.match(page, /Approve this connection/);
});

test("structures a capture with an explicit governed fallback receipt", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("structure", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/structure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "England -1.5 and Over 3.5 against Ghana should hold because the quality gap should produce margin and scoring volume.",
        project: "Sports Engine",
      }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.proposal.truthClass, "Predicted");
  assert.equal(payload.proposal.projectOfOrigin, "Sports Engine");
  assert.equal(payload.receipt.mode, "seeded_demo");
  assert.ok(payload.receipt.checks.includes("No promotion authority granted"));
});

test("rejects captures that cannot produce inspectable structure", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("validation", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/structure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "too short", project: "Sports Engine" }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 400);
});

test("builds a useful context handoff while keeping Local Context temporary", async () => {
  const worker = await builtWorker("context");
  const DB = memoryD1();
  const response = await worker.fetch(
    new Request("http://localhost/api/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "Research deGrom over 6.5 strikeouts and verify workload stability.",
        project: "Sports Engine",
        localContext: "The lineup is not final and this expires after the task.",
      }),
    }),
    { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const packet = await response.json();
  assert.equal(packet.project, "Sports Engine");
  assert.equal(packet.localContext.retention, "Temporary");
  assert.equal(packet.localContext.captureRequiredForDurability, true);
  assert.ok(packet.durableKnowledge.length > 0 && packet.durableKnowledge.length <= 4);
  assert.ok(packet.durableKnowledge.every((item) => item.whyIncluded && item.connectionPath.length >= 3));
  assert.match(packet.compiledPrompt, /CHALLENGES TO CARRY FORWARD/);
  assert.ok(packet.receipt.checks.includes("Packet budget enforced"));

  const stored = await worker.fetch(
    new Request("http://localhost/api/state"),
    { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const persisted = await stored.json();
  assert.equal(persisted.state.contextPackets.at(-1).packetId, packet.packetId);
});

test("exposes six governed MCP tools with explicit safety annotations", async () => {
  const worker = await builtWorker("mcp-list");
  const DB = memoryD1();
  const response = await worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
    { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const rpc = await response.json();
  assert.equal(rpc.result.tools.length, 6);
  assert.ok(rpc.result.tools.every((tool) => typeof tool.annotations.readOnlyHint === "boolean"));
  assert.equal(rpc.result.tools.find((tool) => tool.name === "atlas_capture_candidate").annotations.readOnlyHint, false);
});

test("MCP writes create proposed knowledge and replay safely", async () => {
  const worker = await builtWorker("mcp-write");
  const DB = memoryD1();
  const call = () => worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-action-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "atlas_capture_candidate", arguments: { title: "Workload stability case", summary: "Verify the starter's usable pitch count before pricing strikeouts.", source: "ChatGPT research", project: "Sports Engine", objectType: "case", confidence: 74, idempotencyKey: "test-candidate-001" } } }),
    }),
    { DB, CAMPUS_ATLAS_ACTION_KEY: "test-action-key", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const first = await (await call()).json();
  assert.equal(first.result.structuredContent.candidate.status, "proposed");
  assert.equal(first.result.structuredContent.candidate.type, "decision");
  assert.match(first.result.structuredContent.receipt.effect, /Case ledger/i);
  assert.match(first.result.structuredContent.receipt.effect, /human review/i);
  const replay = await (await call()).json();
  assert.equal(replay.result.structuredContent.idempotentReplay, true);
});

test("external writes fail closed without a configured secret or valid bearer", async () => {
  const worker = await builtWorker("write-security");
  const DB = memoryD1();
  const body = JSON.stringify({ title: "Candidate", summary: "This must not be stored without authorization.", source: "Test", project: "Sports Engine", idempotencyKey: "blocked-001" });
  const disabled = await worker.fetch(
    new Request("http://localhost/api/candidates", { method: "POST", headers: { "content-type": "application/json" }, body }),
    { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(disabled.status, 401);

  const wrongBearer = await worker.fetch(
    new Request("http://localhost/api/candidates", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body }),
    { DB, CAMPUS_ATLAS_ACTION_KEY: "correct", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(wrongBearer.status, 401);
});

test("reports write security without revealing the secret", async () => {
  const worker = await builtWorker("security-status");
  const DB = memoryD1();
  const response = await worker.fetch(
    new Request("http://localhost/api/security"),
    { DB, CAMPUS_ATLAS_ACTION_KEY: "never-return-this", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.externalWrites, "bearer_required");
  assert.equal(status.writeSecretConfigured, true);
  assert.doesNotMatch(JSON.stringify(status), /never-return-this/);
});

test("public demo keeps a shared browser/API workspace without exposing private D1 state", async () => {
  const worker = await builtWorker("public-isolation");
  const DB = memoryD1();
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
  const privateState = { nodes: [{ id: "private", title: "PRIVATE-NEVER-RETURN", status: "approved" }] };
  const seeded = await worker.fetch(
    new Request("http://localhost/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(privateState) }),
    { DB, ASSETS: assets },
    ctx,
  );
  assert.equal(seeded.status, 200);

  const publicEnv = { DB, CAMPUS_ATLAS_PUBLIC_DEMO: "true", CAMPUS_ATLAS_ACTION_KEY: "configured", ASSETS: assets };
  const publicState = await worker.fetch(new Request("http://localhost/api/state"), publicEnv, ctx);
  const statePayload = await publicState.json();
  assert.equal(statePayload.mode, "public_demo");
  assert.equal(statePayload.state, null);
  assert.match(statePayload.workspaceId, /^demo-[a-z0-9]{24}$/);
  assert.equal(statePayload.privateWorkspaceExposed, false);
  const cookie = publicState.headers.get("set-cookie").split(";")[0];

  const demoState = {
    workspaceName: "Judge workspace",
    nodes: [
      { id: "pattern-format", project: "sports", title: "Separate dominance signals from market coverage", summary: "A strong favorite can control a match without producing handicap or total coverage.", status: "proposed", level: "Candidate Pattern", sources: ["England–Ghana post-mortem"], sourceFidelity: 88, reconstructionValue: 96, lineage: ["England 0–0 Ghana", "Post-mortem"] },
      { id: "precedent-cape-verde", project: "sports", title: "Cape Verde defensive-wall counterexample", summary: "A quality gap did not guarantee repeated scoring against a defensive wall.", status: "approved", level: "Observation", sources: ["Earlier case"], sourceFidelity: 78, reconstructionValue: 91, lineage: ["Earlier match", "Defensive-wall outcome"] },
    ],
    connections: [{ id: "demo-edge", from: "pattern-format", to: "precedent-cape-verde", type: "Supports", reason: "Shared defensive-wall mechanism.", approved: true }],
  };
  const demoWrite = await worker.fetch(
    new Request("http://localhost/api/state", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(demoState) }),
    publicEnv,
    ctx,
  );
  assert.equal(demoWrite.status, 200);

  const beforePacket = await worker.fetch(
    new Request("http://localhost/api/context", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ task: "Evaluate a heavy favorite against a defensive wall", project: "Sports Engine", workspaceId: statePayload.workspaceId }) }),
    publicEnv,
    ctx,
  );
  assert.equal(beforePacket.status, 200);
  const before = await beforePacket.json();
  assert.equal(before.workspace.id, statePayload.workspaceId);
  assert.ok(before.durableKnowledge.some((item) => item.id === "precedent-cape-verde"));
  assert.ok(before.excluded.some((item) => item.id === "pattern-format" && /No retrieval authority/.test(item.whyExcluded)));
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE-NEVER-RETURN/);

  const promotedState = { ...demoState, nodes: demoState.nodes.map((node) => node.id === "pattern-format" ? { ...node, status: "approved", level: "Validated Principle", lineage: [...node.lineage, "Human approval"] } : node) };
  const promotionWrite = await worker.fetch(
    new Request("http://localhost/api/state", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(promotedState) }),
    publicEnv,
    ctx,
  );
  assert.equal(promotionWrite.status, 200);
  const afterPacket = await worker.fetch(
    new Request("http://localhost/api/context", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ task: "Evaluate a heavy favorite against a defensive wall", project: "Sports Engine", workspaceId: statePayload.workspaceId }) }),
    publicEnv,
    ctx,
  );
  const after = await afterPacket.json();
  assert.ok(after.durableKnowledge.some((item) => item.id === "pattern-format"));
  assert.match(after.durableKnowledge.find((item) => item.id === "pattern-format").whyIncluded, /approved path through Cape Verde defensive-wall counterexample/);

  const stillPrivate = await worker.fetch(new Request("http://localhost/api/state"), { DB, ASSETS: assets }, ctx);
  const privatePayload = await stillPrivate.json();
  assert.equal(privatePayload.state.nodes[0].title, "PRIVATE-NEVER-RETURN");
  assert.equal(privatePayload.state.contextPackets, undefined);
});

test("authorized sidecar writes become visible in the same public demo case ledger", async () => {
  const worker = await builtWorker("public-sidecar-loop");
  const DB = memoryD1();
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
  const env = { DB, CAMPUS_ATLAS_PUBLIC_DEMO: "true", CAMPUS_ATLAS_ACTION_KEY: "judge-key", ASSETS: assets };
  const session = await worker.fetch(new Request("http://localhost/api/state"), env, ctx);
  const { workspaceId } = await session.json();

  const capture = await worker.fetch(
    new Request("http://localhost/api/candidates", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer judge-key" },
      body: JSON.stringify({ title: "New heavy-favorite case", summary: "Audit favorite quality, control, scoring, and coverage separately.", source: "ChatGPT task", project: "Sports Engine", objectType: "case", confidence: 82, idempotencyKey: "public-case-001", workspaceId }),
    }),
    env,
    ctx,
  );
  assert.equal(capture.status, 201);
  const captured = await capture.json();
  assert.equal(captured.candidate.type, "decision");

  const outcome = await worker.fetch(
    new Request("http://localhost/api/outcomes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer judge-key" },
      body: JSON.stringify({ targetId: captured.candidate.id, result: "0–0", reasoningAssessment: "The quality edge did not convert into margin or scoring volume.", source: "Exact final result", impactStrength: "Strong", confidence: 98, idempotencyKey: "public-outcome-001", workspaceId }),
    }),
    env,
    ctx,
  );
  assert.equal(outcome.status, 201);

  const state = await worker.fetch(new Request(`http://localhost/api/state?workspaceId=${workspaceId}`), env, ctx);
  const payload = await state.json();
  const caseNode = payload.state.nodes.find((node) => node.id === captured.candidate.id);
  assert.equal(caseNode.type, "decision");
  assert.equal(caseNode.status, "challenged");
  assert.match(caseNode.history[0].label, /Outcome recorded/);
  assert.ok(payload.state.reviews.some((review) => review.nodeId === captured.candidate.id));
});

test("public security status advertises shared session-scoped persistence", async () => {
  const worker = await builtWorker("public-status");
  const response = await worker.fetch(
    new Request("http://localhost/api/security"),
    { DB: memoryD1(), CAMPUS_ATLAS_PUBLIC_DEMO: "true", CAMPUS_ATLAS_ACTION_KEY: "configured", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const status = await response.json();
  assert.equal(status.publicDemo, true);
  assert.equal(status.browserStatePersistence, "session_scoped_d1");
  assert.equal(status.browserAndApiShareState, true);
  assert.equal(status.privateWorkspaceExposed, false);
});

test("publishes an OpenAPI fallback and privacy policy", async () => {
  const worker = await builtWorker("openapi");
  const DB = memoryD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const schema = await (await worker.fetch(new Request("http://localhost/openapi.json"), env, ctx)).json();
  assert.equal(schema.info.version, "4.3.0");
  assert.ok(schema.paths["/api/context"]);
  assert.ok(schema.paths["/api/candidates"]);
  const privacy = await worker.fetch(new Request("http://localhost/privacy"), env, ctx);
  assert.equal(privacy.status, 200);
  assert.match(await privacy.text(), /External candidate and outcome writes require authorization and never promote knowledge/);
});
