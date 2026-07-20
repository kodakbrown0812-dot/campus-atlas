import { loadAtlasState, saveAtlasState } from "./atlas-state";

type AtlasNode = {
  id: string;
  project: string;
  title: string;
  summary: string;
  status: string;
  level: string;
  sources?: string[];
  sourceFidelity?: number;
  reconstructionValue?: number;
  scopeStability?: number;
  lineage?: string[];
  history?: unknown[];
};

type AtlasState = {
  nodes?: AtlasNode[];
  reviews?: Array<Record<string, unknown>>;
  connections?: Array<Record<string, unknown>>;
  externalReceipts?: ActionReceipt[];
  [key: string]: unknown;
};

type ActionReceipt = {
  id: string;
  tool: string;
  createdAt: string;
  idempotencyKey?: string;
  checks: string[];
  effect: string;
  targetId?: string;
};

type ActionEnv = {
  DB: D1Database;
  CAMPUS_ATLAS_ACTION_KEY?: string;
};

const fallbackNodes: AtlasNode[] = [
  {
    id: "core-reality",
    project: "hq",
    title: "Reality corrects the model",
    summary: "Outcomes and direct corrections outrank elegant inference. Preserve the evidence that changed the conclusion.",
    status: "approved",
    level: "Core Lens",
    sources: ["Campus constitution", "Outcome audits"],
    sourceFidelity: 96,
    reconstructionValue: 97,
    scopeStability: 95,
    lineage: ["Corrections", "Outcome audits", "Human approval"],
  },
  {
    id: "correction-total",
    project: "sports",
    title: "Verify the market that is actually offered",
    summary: "Distinguish researched markets from currently available markets before pricing or scoring an opportunity.",
    status: "approved",
    level: "Observation",
    sources: ["Direct user correction", "Market screenshot"],
    sourceFidelity: 99,
    reconstructionValue: 82,
    scopeStability: 76,
    lineage: ["Incorrect assumption", "Direct correction", "Retrieval constraint"],
  },
  {
    id: "pattern-format",
    project: "sports",
    title: "Event format can break the base rate",
    summary: "When motivation, rotation, or incentives materially differ, explicitly adjust the expected variance instead of importing the standard competition baseline.",
    status: "approved",
    level: "Validated Principle",
    sources: ["Thesis 001 post-mortem", "Human promotion review"],
    sourceFidelity: 86,
    reconstructionValue: 91,
    scopeStability: 84,
    lineage: ["Original thesis", "Outcome", "Post-mortem", "Challenge", "Scope revision", "Human approval"],
  },
  {
    id: "decision-england",
    project: "sports",
    title: "England +1.5 and Under 4.5",
    summary: "A losing thesis whose post-mortem identified underweighted third-place match variance.",
    status: "approved",
    level: "Observation",
    sources: ["Sports thesis 001", "France 3–1 England"],
    sourceFidelity: 91,
    reconstructionValue: 74,
    scopeStability: 66,
    lineage: ["Thesis", "Result", "Post-mortem"],
  },
  {
    id: "principle-workload",
    project: "sports",
    title: "Workload stability gates strikeout overs",
    summary: "Before pricing pitcher strikeouts, verify recent pitch counts, manager constraints, and a realistic innings range.",
    status: "approved",
    level: "Validated Principle",
    sources: ["Three closed pitcher-prop post-mortems", "Human promotion review"],
    sourceFidelity: 84,
    reconstructionValue: 92,
    scopeStability: 86,
    lineage: ["Three pitcher-prop cases", "Failed innings assumption", "Scope review", "Human approval"],
  },
  {
    id: "precedent-pitcher-set",
    project: "sports",
    title: "Ace-versus-lineup strikeout precedent set",
    summary: "Two comparable strikeout props held, while the failed case overestimated innings because pitch-count stability was never verified.",
    status: "approved",
    level: "Observation",
    sources: ["Reconstructed Sports Engine case set"],
    sourceFidelity: 76,
    reconstructionValue: 89,
    scopeStability: 72,
    lineage: ["Three closed props", "Outcome comparison", "Reconstructed precedent set"],
  },
];

const sportsBlueprint = {
  project: "Sports Engine",
  version: "V4",
  purpose: "Preserve and improve the reasoning behind sports research; never generate picks automatically.",
  rules: [
    "Classify the research state before assigning confidence.",
    "Separate estimated probability from market price and expected value.",
    "Verify the currently offered market before calculating value.",
    "Record counter-evidence, assumptions, and missing information.",
    "Grade outcome correctness and reasoning quality separately.",
    "Reusable principles require evidence lineage and explicit human promotion.",
  ],
  capabilities: ["Research audit", "Probability and EV", "Lock Score", "Explainable precedent retrieval", "Outcome post-mortem", "Confidence calibration"],
};

const generalBlueprint = {
  project: "Campus Atlas",
  version: "V4",
  purpose: "Carry forward governed, inspectable knowledge across long-running ChatGPT Projects.",
  rules: [
    "Local context stays temporary unless explicitly captured.",
    "The model proposes; deterministic checks validate; a person approves consequential changes.",
    "Every durable item retains source, scope, confidence, fidelity, and lineage.",
    "Promotion authority comes from preserved evidence events, not direct score changes.",
  ],
  capabilities: ["Typed knowledge", "Explainable connections", "Context retrieval", "Revision history", "Governed promotion"],
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS", ...extraHeaders } });
}

function textResponse(text: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(text, { status, headers: { "content-type": contentType, "access-control-allow-origin": "*" } });
}

async function stateFor(db: D1Database): Promise<AtlasState> {
  try {
    const loaded = await loadAtlasState(db);
    return (loaded.state ?? {}) as AtlasState;
  } catch {
    return {};
  }
}

function nodesFor(state: AtlasState) {
  return Array.isArray(state.nodes) && state.nodes.length ? state.nodes : fallbackNodes;
}

function normalizeProject(project?: string) {
  const value = (project || "sports").toLowerCase();
  if (value.includes("sport")) return "sports";
  if (value.includes("train") || value.includes("health") || value.includes("hockey")) return "training";
  if (value.includes("lesson") || value.includes("learn")) return "lessons";
  return value.replace(/[^a-z0-9-]/g, "-") || "all";
}

function blueprintFor(project?: string) {
  return normalizeProject(project) === "sports" ? sportsBlueprint : generalBlueprint;
}

function fidelity(node: AtlasNode) {
  const value = node.sourceFidelity ?? 60;
  return value >= 90 ? "Exact" : value >= 72 ? "Reconstructed" : "Inferred";
}

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3).map((word) => word.endsWith("s") && word.length > 5 ? word.slice(0, -1) : word);
}

function rankedNodes(state: AtlasState, task: string, project?: string) {
  const projectKey = normalizeProject(project);
  const taskWords = words(task);
  return nodesFor(state).map((node) => {
    const searchable = `${node.title} ${node.summary} ${(node.sources || []).join(" ")}`.toLowerCase();
    const searchableWords = new Set(words(searchable));
    const keywordMatches = taskWords.filter((word) => searchableWords.has(word)).length;
    const projectFit = node.project === projectKey ? 16 : node.project === "hq" ? 9 : 0;
    const reality = /outcome|result|correction|post-mortem/i.test(searchable) ? 7 : 0;
    const authority = node.status === "approved" ? 10 : 0;
    const score = Math.min(99, Math.round((node.reconstructionValue ?? 55) * .28 + (node.sourceFidelity ?? 60) * .18 + keywordMatches * 9 + projectFit + reality + authority));
    return { node, score, keywordMatches };
  }).sort((a, b) => b.score - a.score);
}

export function buildContextPacket(state: AtlasState, input: Record<string, unknown>) {
  const task = String(input.task || input.question || "Prepare the next project task using the smallest useful context.").trim();
  const project = String(input.project || "Sports Engine");
  const localContext = String(input.localContext || "").trim();
  const ranked = rankedNodes(state, task, project);
  const durable = ranked.filter(({ node }) => node.status === "approved").slice(0, 3).map(({ node, score, keywordMatches }) => ({
    id: node.id,
    title: node.title,
    summary: node.summary,
    usefulness: score,
    whyIncluded: keywordMatches ? "Matches the active task and retains an inspectable evidence path." : node.project === "hq" ? "Campus-wide governance lens applies to every project task." : "High-value project precedent with reality-linked evidence.",
    source: (node.sources || ["Campus Atlas"])[0],
    confidence: node.sourceFidelity ?? 60,
    scope: node.project === "hq" ? "Entire campus" : blueprintFor(project).project,
    freshness: "Review before use if current conditions changed",
    fidelity: fidelity(node),
    authorityLevel: node.level,
    connectionPath: [task, blueprintFor(project).project, node.title],
    lineage: node.lineage || [],
  }));
  const challenges = ranked.filter(({ node }) => node.status === "challenged" || /challenge|failed|underweight|uncertainty|\blost\b|\bloss\b/i.test(`${node.title} ${node.summary}`)).slice(0, 2).map(({ node }) => ({
    id: node.id,
    title: node.title,
    reason: "Carry this forward so the next answer does not repeat a known failure mode.",
    source: (node.sources || ["Campus Atlas"])[0],
    status: node.status,
  }));
  const includedIds = new Set(durable.map((item) => item.id));
  const excluded = ranked.filter(({ node }) => !includedIds.has(node.id)).slice(0, 3).map(({ node }) => ({
    id: node.id,
    title: node.title,
    whyExcluded: node.status !== "approved" ? `No retrieval authority: ${node.status}.` : "Lower usefulness for this task and outside the packet budget.",
  }));
  const packetId = `PKT-${Date.now().toString(36).toUpperCase()}`;
  const receiptId = `RCP-${Date.now().toString(36).toUpperCase()}`;
  const blueprint = blueprintFor(project);
  const compiledPrompt = [
    `TASK\n${task}`,
    `PROJECT BLUEPRINT\n${blueprint.rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`,
    localContext ? `LOCAL CONTEXT — temporary for this task only\n${localContext}` : "LOCAL CONTEXT\nNone supplied.",
    `RETRIEVED DURABLE KNOWLEDGE\n${durable.map((item) => `- ${item.title}: ${item.summary}\n  Why: ${item.whyIncluded}`).join("\n")}`,
    `CHALLENGES TO CARRY FORWARD\n${challenges.length ? challenges.map((item) => `- ${item.title}: ${item.reason}`).join("\n") : "- No active challenge matched this task."}`,
    "INSTRUCTIONS\nUse this packet as context, verify time-sensitive facts, distinguish facts from assumptions, and do not treat retrieved precedent as a prediction.",
  ].join("\n\n");
  return {
    packetId,
    task,
    project: blueprint.project,
    blueprint,
    localContext: localContext ? { content: localContext, retention: "Temporary", expiration: "End of task", captureRequiredForDurability: true } : null,
    durableKnowledge: durable,
    challenges,
    excluded,
    budget: { used: durable.length, limit: 4, estimatedTokens: Math.ceil(compiledPrompt.length / 4) },
    compiledPrompt,
    receipt: {
      id: receiptId,
      tool: "atlas_build_context_packet",
      proposedBy: "Campus Atlas deterministic retrieval",
      createdAt: new Date().toISOString(),
      checks: ["Project scope applied", "Only approved knowledge received retrieval authority", "Packet budget enforced", "Local context kept temporary", "Inclusion and exclusion reasons attached"],
      humanApprovalRequired: false,
    },
  };
}

function retrievePrecedents(state: AtlasState, input: Record<string, unknown>) {
  const task = String(input.task || "");
  const project = String(input.project || "Sports Engine");
  return {
    task,
    project: blueprintFor(project).project,
    precedents: rankedNodes(state, task, project).filter(({ node }) => node.status === "approved").slice(0, 5).map(({ node, score }) => ({
      id: node.id,
      title: node.title,
      summary: node.summary,
      relevance: score,
      whyItMatters: node.project === normalizeProject(project) ? "Same project blueprint and an inspectable reasoning path." : "Cross-project lens with approved campus-wide scope.",
      evidencePath: node.lineage || [],
    })),
  };
}

function isAuthorized(request: Request, env: ActionEnv) {
  if (!env.CAMPUS_ATLAS_ACTION_KEY) return true;
  return request.headers.get("authorization") === `Bearer ${env.CAMPUS_ATLAS_ACTION_KEY}`;
}

function requireFields(input: Record<string, unknown>, fields: string[]) {
  return fields.filter((field) => typeof input[field] !== "string" || !String(input[field]).trim());
}

async function captureCandidate(db: D1Database, input: Record<string, unknown>) {
  const missing = requireFields(input, ["title", "summary", "source", "idempotencyKey"]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}`, status: 400 };
  const loaded = await stateFor(db);
  const receipts = Array.isArray(loaded.externalReceipts) ? loaded.externalReceipts : [];
  const key = String(input.idempotencyKey);
  const existing = receipts.find((receipt) => receipt.idempotencyKey === key);
  if (existing) return { data: { created: false, idempotentReplay: true, receipt: existing }, status: 200 };
  const id = `candidate-${Date.now().toString(36)}`;
  const node: AtlasNode = {
    id,
    project: normalizeProject(String(input.project || "sports")),
    title: String(input.title),
    summary: String(input.summary),
    status: "proposed",
    level: "Observation",
    sources: [String(input.source)],
    sourceFidelity: Number(input.confidence || 60),
    reconstructionValue: 50,
    scopeStability: 40,
    lineage: ["Captured from ChatGPT", "Awaiting human Knowledge Review"],
    history: [{ id: `history-${Date.now()}`, date: "Now", label: "Candidate captured", detail: "External write created proposed knowledge only; no promotion authority was granted." }],
  };
  const receipt: ActionReceipt = { id: `RCP-${Date.now().toString(36).toUpperCase()}`, tool: "atlas_capture_candidate", createdAt: new Date().toISOString(), idempotencyKey: key, checks: ["Required fields validated", "Idempotency key checked", "Status forced to proposed", "Promotion authority denied"], effect: "Created proposed Observation for human review", targetId: id };
  const next: AtlasState = { ...loaded, nodes: [...nodesFor(loaded), node], externalReceipts: [...receipts, receipt] };
  await saveAtlasState(db, next);
  return { data: { created: true, candidate: node, receipt }, status: 201 };
}

async function recordOutcome(db: D1Database, input: Record<string, unknown>) {
  const missing = requireFields(input, ["targetId", "result", "reasoningAssessment", "source", "idempotencyKey"]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}`, status: 400 };
  const loaded = await stateFor(db);
  const receipts = Array.isArray(loaded.externalReceipts) ? loaded.externalReceipts : [];
  const key = String(input.idempotencyKey);
  const existing = receipts.find((receipt) => receipt.idempotencyKey === key);
  if (existing) return { data: { created: false, idempotentReplay: true, receipt: existing }, status: 200 };
  const targetId = String(input.targetId);
  const target = nodesFor(loaded).find((node) => node.id === targetId);
  if (!target) return { error: "Target knowledge node was not found.", status: 404 };
  const review = {
    id: `outcome-${Date.now().toString(36)}`,
    nodeId: targetId,
    action: "Challenge",
    rationale: String(input.reasoningAssessment),
    evidence: String(input.result),
    source: String(input.source),
    strength: String(input.impactStrength || "Moderate"),
    scope: String(input.scope || target.project),
    confidence: Number(input.confidence || 80),
    project: target.project,
    relatedNodeId: targetId,
    createdAt: new Date().toISOString(),
    eventType: "Reality outcome",
  };
  const receipt: ActionReceipt = { id: `RCP-${Date.now().toString(36).toUpperCase()}`, tool: "atlas_record_outcome", createdAt: new Date().toISOString(), idempotencyKey: key, checks: ["Target exists", "Outcome preserved as evidence event", "No score changed directly", "Promotion authority unchanged"], effect: "Attached reality evidence and opened human review", targetId };
  const next: AtlasState = { ...loaded, reviews: [...(Array.isArray(loaded.reviews) ? loaded.reviews : []), review], externalReceipts: [...receipts, receipt] };
  await saveAtlasState(db, next);
  return { data: { created: true, review, receipt }, status: 201 };
}

const tools = [
  {
    name: "atlas_build_context_packet",
    title: "Build Context Packet",
    description: "Assemble the smallest useful, inspectable context from one Campus Atlas project for a new ChatGPT task.",
    inputSchema: { type: "object", properties: { task: { type: "string", description: "The specific task or question ChatGPT is working on." }, project: { type: "string", description: "The Campus Atlas project, such as Sports Engine." }, localContext: { type: "string", description: "Optional temporary facts or constraints for this task only." } }, required: ["task", "project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_get_project_blueprint",
    title: "Get Project Blueprint",
    description: "Return the current reasoning rules and earned capabilities for a Campus Atlas project.",
    inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_retrieve_precedents",
    title: "Retrieve Explainable Precedents",
    description: "Find approved historical knowledge relevant to a task and explain each evidence path.",
    inputSchema: { type: "object", properties: { task: { type: "string" }, project: { type: "string" } }, required: ["task", "project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_get_receipt",
    title: "Get Atlas Receipt",
    description: "Inspect a preserved receipt for a ChatGPT-to-Atlas action.",
    inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_capture_candidate",
    title: "Capture Candidate Knowledge",
    description: "Create proposed knowledge for later human review. This never promotes or grants retrieval authority.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, source: { type: "string" }, project: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string", description: "Stable unique key so retries do not duplicate the write." } }, required: ["title", "summary", "source", "project", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_record_outcome",
    title: "Record Outcome Evidence",
    description: "Attach a result and reasoning assessment as a preserved evidence event. This never changes authority directly.",
    inputSchema: { type: "object", properties: { targetId: { type: "string" }, result: { type: "string" }, reasoningAssessment: { type: "string" }, source: { type: "string" }, impactStrength: { type: "string", enum: ["Light", "Moderate", "Strong"] }, scope: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string" } }, required: ["targetId", "result", "reasoningAssessment", "source", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

async function executeTool(name: string, input: Record<string, unknown>, request: Request, env: ActionEnv) {
  const state = await stateFor(env.DB);
  if (name === "atlas_build_context_packet") {
    const packet = buildContextPacket(state, input);
    await saveAtlasState(env.DB, { ...state, contextPackets: [...(Array.isArray(state.contextPackets) ? state.contextPackets : []), packet].slice(-25) });
    return { data: packet, status: 200 };
  }
  if (name === "atlas_get_project_blueprint") return { data: blueprintFor(String(input.project || "")), status: 200 };
  if (name === "atlas_retrieve_precedents") return { data: retrievePrecedents(state, input), status: 200 };
  if (name === "atlas_get_receipt") {
    const receipt = (state.externalReceipts || []).find((item) => item.id === String(input.receiptId));
    return receipt ? { data: receipt, status: 200 } : { error: "Receipt not found.", status: 404 };
  }
  if (["atlas_capture_candidate", "atlas_record_outcome"].includes(name) && !isAuthorized(request, env)) return { error: "Write authorization required.", status: 401 };
  if (name === "atlas_capture_candidate") return captureCandidate(env.DB, input);
  if (name === "atlas_record_outcome") return recordOutcome(env.DB, input);
  return { error: `Unknown tool: ${name}`, status: 404 };
}

function openApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: { title: "Campus Atlas Actions", version: "4.0.0", description: "Governed context retrieval and candidate capture for ChatGPT. Writes never grant promotion authority." },
    servers: [{ url: origin }],
    paths: {
      "/api/context": { post: { operationId: "buildContextPacket", summary: "Build the smallest useful context packet", requestBody: { required: true, content: { "application/json": { schema: tools[0].inputSchema } } }, responses: { "200": { description: "Inspectable context packet" } } } },
      "/api/blueprint": { get: { operationId: "getProjectBlueprint", summary: "Get a project reasoning blueprint", parameters: [{ name: "project", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Project blueprint" } } } },
      "/api/precedents": { post: { operationId: "retrievePrecedents", summary: "Retrieve explainable precedents", requestBody: { required: true, content: { "application/json": { schema: tools[2].inputSchema } } }, responses: { "200": { description: "Ranked precedents" } } } },
      "/api/candidates": { post: { operationId: "captureCandidate", summary: "Capture proposed knowledge for human review", requestBody: { required: true, content: { "application/json": { schema: tools[4].inputSchema } } }, responses: { "201": { description: "Candidate and action receipt" } } } },
      "/api/outcomes": { post: { operationId: "recordOutcome", summary: "Record reality evidence", requestBody: { required: true, content: { "application/json": { schema: tools[5].inputSchema } } }, responses: { "201": { description: "Evidence event and action receipt" } } } },
      "/api/receipts": { get: { operationId: "getAtlasReceipt", summary: "Inspect an action receipt", parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Action receipt" } } } },
    },
  };
}

export async function handleAtlasActions(request: Request, env: ActionEnv) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version", "access-control-allow-methods": "GET, POST, OPTIONS" } });

  if (url.pathname === "/openapi.json" || url.pathname === "/.well-known/openapi.json") return json(openApi(url.origin));
  if (url.pathname === "/privacy") return textResponse("<!doctype html><html><head><title>Campus Atlas Privacy</title><meta name=viewport content='width=device-width,initial-scale=1'><style>body{font:16px/1.6 system-ui;max-width:760px;margin:64px auto;padding:0 24px;color:#172033}h1{font-size:34px}</style></head><body><h1>Campus Atlas privacy</h1><p>Campus Atlas stores the project knowledge, review events, context packets, and action receipts that a user explicitly submits. Temporary Local Context stays attached to its packet unless the user captures it as candidate knowledge.</p><p>ChatGPT tools may read approved project knowledge or create proposed candidates and outcome evidence. External writes never promote knowledge or grant authority. Consequential promotion requires explicit review inside Campus Atlas.</p><p>Do not submit secrets, payment data, or sensitive medical information to the demonstration workspace.</p></body></html>", 200, "text/html; charset=utf-8");

  if (url.pathname === "/api/context" && request.method === "POST") {
    const state = await stateFor(env.DB);
    const packet = buildContextPacket(state, await request.json() as Record<string, unknown>);
    await saveAtlasState(env.DB, { ...state, contextPackets: [...(Array.isArray(state.contextPackets) ? state.contextPackets : []), packet].slice(-25) });
    return json(packet);
  }
  if (url.pathname === "/api/blueprint" && request.method === "GET") return json(blueprintFor(url.searchParams.get("project") || ""));
  if (url.pathname === "/api/precedents" && request.method === "POST") return json(retrievePrecedents(await stateFor(env.DB), await request.json() as Record<string, unknown>));
  if (url.pathname === "/api/receipts" && request.method === "GET") {
    const state = await stateFor(env.DB);
    const receipt = (state.externalReceipts || []).find((item) => item.id === url.searchParams.get("id"));
    return receipt ? json(receipt) : json({ error: "Receipt not found." }, 404);
  }
  if (url.pathname === "/api/candidates" && request.method === "POST") {
    if (!isAuthorized(request, env)) return json({ error: "Write authorization required." }, 401);
    const result = await captureCandidate(env.DB, await request.json() as Record<string, unknown>);
    return "data" in result ? json(result.data, result.status) : json({ error: result.error }, result.status);
  }
  if (url.pathname === "/api/outcomes" && request.method === "POST") {
    if (!isAuthorized(request, env)) return json({ error: "Write authorization required." }, 401);
    const result = await recordOutcome(env.DB, await request.json() as Record<string, unknown>);
    return "data" in result ? json(result.data, result.status) : json({ error: result.error }, result.status);
  }

  if (url.pathname !== "/mcp") return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "MCP uses POST requests." }, 405, { allow: "POST, OPTIONS" });
  const rpc = await request.json() as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
  if (rpc.method?.startsWith("notifications/")) return new Response(null, { status: 202, headers: { "access-control-allow-origin": "*" } });
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  const fail = (code: number, message: string) => json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message } });
  if (rpc.method === "initialize") return ok({ protocolVersion: String((rpc.params as { protocolVersion?: string } | undefined)?.protocolVersion || "2025-06-18"), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Campus Atlas", version: "4.0.0" } });
  if (rpc.method === "tools/list") return ok({ tools });
  if (rpc.method === "tools/call") {
    const params = (rpc.params || {}) as { name?: string; arguments?: Record<string, unknown> };
    if (!params.name) return fail(-32602, "Tool name is required.");
    const result = await executeTool(params.name, params.arguments || {}, request, env);
    if ("error" in result) return ok({ isError: true, content: [{ type: "text", text: result.error }] });
    return ok({ content: [{ type: "text", text: JSON.stringify(result.data) }], structuredContent: result.data });
  }
  return fail(-32601, `Method not found: ${rpc.method || "unknown"}`);
}
