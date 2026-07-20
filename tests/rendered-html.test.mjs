import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

function memoryD1() {
  let row = null;
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() { return /SELECT payload/i.test(sql) ? row : null; },
        async run() {
          if (/INSERT INTO atlas_state/i.test(sql)) row = { payload: values[1], updated_at: new Date().toISOString() };
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

test("structures a capture with an explicit governed fallback receipt", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("structure", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/structure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "England +1.5 and Under 4.5 should hold because the expected game script is competitive and controlled.",
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "atlas_capture_candidate", arguments: { title: "Workload stability matters", summary: "Verify the starter's usable pitch count before pricing strikeouts.", source: "ChatGPT research", project: "Sports Engine", confidence: 74, idempotencyKey: "test-candidate-001" } } }),
    }),
    { DB, CAMPUS_ATLAS_ACTION_KEY: "test-action-key", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const first = await (await call()).json();
  assert.equal(first.result.structuredContent.candidate.status, "proposed");
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

test("public demo mode never reads or writes the private D1 workspace", async () => {
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
  assert.equal(statePayload.privateWorkspaceExposed, false);

  const blockedWrite = await worker.fetch(
    new Request("http://localhost/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceName: "Attacker" }) }),
    publicEnv,
    ctx,
  );
  assert.equal(blockedWrite.status, 403);

  const publicPacket = await worker.fetch(
    new Request("http://localhost/api/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "Research a strikeout prop", project: "Sports Engine" }) }),
    publicEnv,
    ctx,
  );
  assert.equal(publicPacket.status, 200);
  assert.doesNotMatch(JSON.stringify(await publicPacket.json()), /PRIVATE-NEVER-RETURN/);

  const stillPrivate = await worker.fetch(new Request("http://localhost/api/state"), { DB, ASSETS: assets }, ctx);
  const privatePayload = await stillPrivate.json();
  assert.equal(privatePayload.state.nodes[0].title, "PRIVATE-NEVER-RETURN");
  assert.equal(privatePayload.state.contextPackets, undefined);
});

test("public security status advertises device-local persistence", async () => {
  const worker = await builtWorker("public-status");
  const response = await worker.fetch(
    new Request("http://localhost/api/security"),
    { DB: memoryD1(), CAMPUS_ATLAS_PUBLIC_DEMO: "true", CAMPUS_ATLAS_ACTION_KEY: "configured", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  const status = await response.json();
  assert.equal(status.publicDemo, true);
  assert.equal(status.browserStatePersistence, "device_local");
  assert.equal(status.privateWorkspaceExposed, false);
});

test("publishes an OpenAPI fallback and privacy policy", async () => {
  const worker = await builtWorker("openapi");
  const DB = memoryD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const schema = await (await worker.fetch(new Request("http://localhost/openapi.json"), env, ctx)).json();
  assert.equal(schema.info.version, "4.0.0");
  assert.ok(schema.paths["/api/context"]);
  assert.ok(schema.paths["/api/candidates"]);
  const privacy = await worker.fetch(new Request("http://localhost/privacy"), env, ctx);
  assert.equal(privacy.status, 200);
  assert.match(await privacy.text(), /External writes never promote knowledge/);
});
