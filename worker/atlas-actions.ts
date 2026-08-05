import { demoWorkspaceIdFromRequest, loadAtlasState, normalizeDemoWorkspaceId, saveAtlasState } from "./atlas-state";

type AtlasNode = {
  id: string;
  project: string;
  room?: string;
  type?: string;
  title: string;
  summary: string;
  status: string;
  level: string;
  sources?: string[];
  sourceFidelity?: number;
  reconstructionValue?: number;
  decisionImpact?: number;
  scopeStability?: number;
  x?: number;
  y?: number;
  lineage?: string[];
  history?: unknown[];
  metadata?: Record<string, string>;
};

type AtlasState = {
  nodes?: AtlasNode[];
  reviews?: Array<Record<string, unknown>>;
  connections?: Array<Record<string, unknown>>;
  cases?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  knowledge?: Array<Record<string, unknown>>;
  blueprintRules?: Array<Record<string, unknown>>;
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
  CAMPUS_ATLAS_PUBLIC_DEMO?: string;
};

const fallbackNodes: AtlasNode[] = [
  {
    id: "core-reality",
    project: "hq",
    type: "principle",
    title: "Reality corrects the model",
    summary: "Outcomes and explicit corrections outrank elegant inference. Durable claims remain traceable to evidence.",
    status: "approved",
    level: "Core Lens",
    sources: ["Campus constitution v0.1", "Three explicit corrections", "Outcome audit set"],
    sourceFidelity: 96,
    reconstructionValue: 97,
    scopeStability: 95,
    lineage: ["Repeated user corrections", "Outcome audits across Sports Engine", "Cross-project governance pattern", "Approved Core Lens"],
  },
  {
    id: "correction-total",
    project: "sports",
    type: "correction",
    title: "Market options were overstated",
    summary: "The available total was corrected by the user. Future retrieval must distinguish researched markets from currently offered markets.",
    status: "approved",
    level: "Observation",
    sources: ["Direct user correction", "Market screenshot"],
    sourceFidelity: 99,
    reconstructionValue: 82,
    scopeStability: 76,
    lineage: ["Incorrect market assumption", "Direct correction", "Screenshot verification", "Retrieval constraint added"],
  },
  {
    id: "pattern-format",
    project: "sports",
    type: "pattern",
    title: "Separate dominance signals from market coverage",
    summary: "A strong favorite can control a match without producing the scoring volume or margin required by a handicap-and-total thesis.",
    status: "proposed",
    level: "Candidate Pattern",
    sources: ["England–Ghana post-mortem", "Cape Verde defensive-wall comparison"],
    sourceFidelity: 88,
    reconstructionValue: 96,
    scopeStability: 76,
    lineage: ["England–Ghana thesis", "0–0 outcome", "Signal-separation post-mortem", "Cape Verde comparison", "Scope narrowed after challenge", "Candidate pattern drafted"],
  },
  {
    id: "decision-england",
    project: "sports",
    type: "decision",
    title: "England -1.5 & Over 3.5 vs Ghana",
    summary: "England was approximately -525. The thesis treated favorite strength, match control, scoring probability, and handicap coverage as if they were the same signal.",
    status: "challenged",
    level: "Observation",
    sources: ["Sports thesis 001", "Exact final result: England 0–0 Ghana"],
    sourceFidelity: 96,
    reconstructionValue: 92,
    scopeStability: 73,
    lineage: ["Pre-match thesis", "Research audit", "England 0–0 Ghana", "Signal-separation post-mortem"],
  },
  {
    id: "precedent-cape-verde",
    project: "sports",
    type: "observation",
    title: "Cape Verde defensive-wall counterexample",
    summary: "A perceived quality gap did not guarantee repeated scoring. The case exposes the same defensive-wall failure mode without pretending the events were identical.",
    status: "approved",
    level: "Observation",
    sources: ["Earlier Sports Engine case", "Reconstructed comparison"],
    sourceFidelity: 78,
    reconstructionValue: 91,
    scopeStability: 72,
    lineage: ["Earlier match thesis", "Defensive-wall outcome", "Retrieved as a shared mechanism"],
  },
  {
    id: "principle-workload",
    project: "sports",
    type: "principle",
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
    type: "observation",
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
  version: "V4.6",
  purpose: "Turn audited sports cases into compact, inspectable reasoning that can improve later research without generating picks automatically.",
  rules: [
    "Classify the research state before assigning confidence.",
    "Separate estimated probability from market price and expected value.",
    "Verify the currently offered market before calculating value.",
    "Record counter-evidence, assumptions, and missing information.",
    "Grade outcome correctness and reasoning quality separately.",
    "Reusable principles require evidence lineage and explicit human promotion.",
  ],
  capabilities: ["Research audit", "Probability and EV", "Lock Score", "Explainable precedent retrieval", "Outcome post-mortem", "Confidence calibration", "Human-governed promotion"],
};

const generalBlueprint = {
  project: "Campus Atlas",
  version: "V4.6",
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
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, x-atlas-workspace", "access-control-allow-methods": "GET, POST, OPTIONS", "cache-control": "no-store", ...extraHeaders } });
}

function textResponse(text: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(text, { status, headers: { "content-type": contentType, "access-control-allow-origin": "*" } });
}

async function stateFor(db: D1Database, publicDemo = false, workspaceId?: string | null): Promise<AtlasState> {
  if (publicDemo && !workspaceId) return {};
  try {
    const loaded = await loadAtlasState(db, workspaceId || undefined);
    return (loaded.state ?? {}) as AtlasState;
  } catch {
    return {};
  }
}

function workspaceFor(request: Request, input: Record<string, unknown>, publicDemo: boolean) {
  if (!publicDemo) return null;
  return normalizeDemoWorkspaceId(input.workspaceId) || demoWorkspaceIdFromRequest(request);
}

function nodesFor(state: AtlasState) {
  return Array.isArray(state.nodes) && state.nodes.length ? state.nodes : fallbackNodes;
}

function normalizeProject(project?: string) {
  const value = (project || "sports").toLowerCase();
  if (value.includes("sport")) return "sports";
  if (value.includes("train") || value.includes("health") || value.includes("hockey")) return "hockey";
  if (value.includes("lesson") || value.includes("learn")) return "lessons";
  return value.replace(/[^a-z0-9-]/g, "-") || "all";
}

function blueprintFor(project?: string, state?: AtlasState) {
  const projectKey = normalizeProject(project);
  const projectName = projectKey === "sports" ? "Sports Engine" : projectKey === "hockey" ? "Hockey Development" : projectKey === "lessons" ? "Lessons Division" : project || "Campus Atlas";
  const activeRules = Array.isArray(state?.blueprintRules) ? state.blueprintRules.filter((rule) => String(rule.project) === projectKey && String(rule.status) === "Active") : [];
  if (!activeRules.length) return projectKey === "sports" ? sportsBlueprint : { ...generalBlueprint, project: projectName };
  const versions = activeRules.map((rule) => String(rule.version || "V4.6"));
  return {
    ...(projectKey === "sports" ? sportsBlueprint : generalBlueprint),
    project: projectName,
    version: versions.find((version) => version === "V4.6.1") || versions[0] || "V4.6",
    rules: activeRules.map((rule) => String(rule.content)),
    capabilities: projectKey === "sports" ? ["Research audit", "Probability and EV", "Outcome post-mortem", "Explainable retrieval", "Human-governed promotion"] : projectKey === "hockey" ? ["Game-transfer review", "Skill-dial evidence", "Explainable retrieval", "Human-governed promotion"] : generalBlueprint.capabilities,
  };
}

function fidelity(node: AtlasNode) {
  const value = node.sourceFidelity ?? 60;
  return value >= 90 ? "Exact" : value >= 72 ? "Reconstructed" : "Inferred";
}

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3).map((word) => word.endsWith("s") && word.length > 5 ? word.slice(0, -1) : word);
}

function inferredDomain(task: string) {
  const value = task.toLowerCase();
  if (/england|ghana|soccer|football|favorite|handicap|defensive wall|match total/.test(value)) return "soccer";
  if (/pitcher|strikeout|mlb|baseball|innings|pitch count/.test(value)) return "baseball";
  if (/hockey|puck|forecheck|skate|zone|support route/.test(value)) return "hockey";
  return "";
}

function rankedNodes(state: AtlasState, task: string, project?: string) {
  const projectKey = normalizeProject(project);
  const taskWords = words(task);
  const taskDomain = inferredDomain(task);
  return nodesFor(state).map((node) => {
    const metadata = node.metadata || {};
    const metadataText = Object.entries(metadata).map(([key, value]) => `${key} ${value}`).join(" ");
    const searchable = `${node.title} ${node.summary} ${(node.sources || []).join(" ")} ${metadataText}`.toLowerCase();
    const searchableWords = new Set(words(searchable));
    const matchedWords = [...new Set(taskWords.filter((word) => searchableWords.has(word)))];
    const keywordMatches = matchedWords.length;
    const projectFit = node.project === projectKey ? 24 : -30;
    const nodeDomain = String(metadata.Sport || metadata.Domain || "").toLowerCase();
    const domainFit = !taskDomain || !nodeDomain ? 0 : nodeDomain.includes(taskDomain) ? 24 : -38;
    const mechanism = String(metadata.Mechanism || metadata["Shared mechanism"] || metadata["Technical mechanism"] || "").toLowerCase();
    const mechanismWords = words(mechanism);
    const mechanismMatches = mechanismWords.filter((word) => taskWords.includes(word));
    const mechanismFit = mechanismMatches.length * 12;
    const market = String(metadata["Market type"] || "").toLowerCase();
    const marketFit = market && words(market).some((word) => taskWords.includes(word)) ? 14 : 0;
    const reality = /outcome|result|correction|post-mortem/i.test(searchable) ? 7 : 0;
    const authority = node.status === "approved" ? 24 : -24;
    const recordPriority = node.type === "principle" || node.type === "pattern" || node.type === "adapted transfer" ? 3 : node.type === "decision" || node.type === "observation" ? 2 : 1;
    const score = Math.max(0, Math.min(99, Math.round((node.reconstructionValue ?? 55) * .18 + (node.sourceFidelity ?? 60) * .13 + keywordMatches * 7 + projectFit + domainFit + mechanismFit + marketFit + reality + authority)));
    const labels = Object.entries(metadata).filter(([, value]) => words(String(value)).some((word) => taskWords.includes(word))).map(([key, value]) => `${key}: ${value}`);
    return { node, score, recordPriority, keywordMatches, matchedWords, domainFit, mechanismMatches, labels, nodeDomain };
  }).sort((a, b) => b.score - a.score || b.recordPriority - a.recordPriority || (b.node.reconstructionValue ?? 55) - (a.node.reconstructionValue ?? 55));
}

function approvedConnectionFor(state: AtlasState, node: AtlasNode, task: string) {
  const edges = Array.isArray(state.connections) ? state.connections : [];
  const allNodes = nodesFor(state);
  const taskWords = new Set(words(task));
  return edges
    .filter((value) => value && value.approved === true && (value.from === node.id || value.to === node.id))
    .map((edge) => {
      const otherId = String(edge.from === node.id ? edge.to : edge.from);
      const other = allNodes.find((candidate) => candidate.id === otherId);
      const matchCount = other ? words(`${other.title} ${other.summary}`).filter((word) => taskWords.has(word)).length : 0;
      return { edge, other, matchCount };
    })
    .filter((item) => item.other)
    .sort((a, b) => b.matchCount - a.matchCount)[0];
}

export function buildContextPacket(state: AtlasState, input: Record<string, unknown>) {
  const task = String(input.task || input.question || "Prepare the next project task using the smallest useful context.").trim();
  const project = String(input.project || "Sports Engine");
  const localContext = String(input.localContext || "").trim();
  const constraints = String(input.constraints || "").trim();
  const retrievalScope = ["project", "transfers", "campus"].includes(String(input.retrievalScope)) ? String(input.retrievalScope) : "project";
  const requestedTokens = Math.max(250, Math.min(2500, Number(input.tokenBudget) || 700));
  const itemLimit = Math.max(1, Math.min(6, Math.floor(requestedTokens / 190)));
  const workspaceId = normalizeDemoWorkspaceId(input.workspaceId);
  const ranked = rankedNodes(state, task, project);
  const projectKey = normalizeProject(project);
  const taskDomain = inferredDomain(task);
  const eligible = ranked.filter(({ node, nodeDomain, score }) => node.status === "approved" && node.project === projectKey && score >= 34 && (!taskDomain || !nodeDomain || nodeDomain.includes(taskDomain)));
  const durable = eligible.slice(0, itemLimit).map(({ node, score, matchedWords, mechanismMatches, labels }) => {
    const connected = approvedConnectionFor(state, node, task);
    const reasons = ["human-approved", "same project"];
    const sport = node.metadata?.Sport;
    if (sport) reasons.push(`same sport: ${sport}`);
    const market = node.metadata?.["Market type"];
    if (market && words(market).some((word) => words(task).includes(word))) reasons.push(`same market family: ${market}`);
    if (mechanismMatches.length) reasons.push(`shared mechanism: ${mechanismMatches.join(", ")}`);
    if (matchedWords.length) reasons.push(`task match: ${matchedWords.slice(0, 3).join(", ")}`);
    if (connected?.other) reasons.push(`approved path through ${connected.other.title}`);
    if (labels.length) reasons.push(`structured labels: ${labels.slice(0, 2).join(", ")}`);
    reasons.push(`${node.reconstructionValue ?? 55} reconstruction value`);
    const connectionPath = connected?.other
      ? [task, blueprintFor(project, state).project, connected.other.title, `${String(connected.edge.type || "Connected")}: ${String(connected.edge.explanation || connected.edge.reason || "Approved evidence path")}`, node.title]
      : [task, blueprintFor(project, state).project, node.title];
    return {
      id: node.id,
      title: node.title,
      summary: node.summary,
      usefulness: score,
      whyIncluded: reasons.join(" · "),
      retrievedBecause: reasons,
      source: (node.sources || ["Campus Atlas"])[0],
      confidence: node.sourceFidelity ?? 60,
      scope: blueprintFor(project, state).project,
      freshness: "Review before use if current conditions changed",
      fidelity: fidelity(node),
      authorityLevel: node.level,
      connectionPath,
      lineage: node.lineage || [],
    };
  });
  const challenges = ranked.filter(({ node, nodeDomain }) => node.project === projectKey && (!taskDomain || !nodeDomain || nodeDomain.includes(taskDomain)) && (node.status === "challenged" || /challenge|failed|underweight|uncertainty|\blost\b|\bloss\b|contradict/i.test(`${node.title} ${node.summary}`))).slice(0, 2).map(({ node }) => ({
    id: node.id,
    title: node.title,
    reason: "Carry this forward so the next answer does not repeat a known failure mode.",
    source: (node.sources || ["Campus Atlas"])[0],
    status: node.status,
  }));
  const includedIds = new Set(durable.map((item) => item.id));
  const excluded = ranked.filter(({ node }) => !includedIds.has(node.id)).slice(0, 6).map(({ node, nodeDomain, score }) => ({
    id: node.id,
    title: node.title,
    whyExcluded: node.status !== "approved" ? `Not approved: ${node.status}.` : node.project !== projectKey ? "Wrong project scope." : taskDomain && nodeDomain && !nodeDomain.includes(taskDomain) ? `Wrong sport or domain: ${nodeDomain}.` : score < 34 ? "Unrelated mechanism or insufficient task fit." : includedIds.size >= itemLimit ? "Outside token budget; less useful than selected evidence." : "Lower evidence quality or reconstruction value than selected records.",
  }));
  const packetId = `PKT-${Date.now().toString(36).toUpperCase()}`;
  const receiptId = `RCP-${Date.now().toString(36).toUpperCase()}`;
  const blueprint = blueprintFor(project, state);
  const allConnections = Array.isArray(state.connections) ? state.connections : [];
  const reconstructionPathways = allConnections.filter((connection) => String(connection.project) === "campus" && [String(connection.sourceId), String(connection.targetId)].some((id) => nodesFor(state).find((node) => node.id === id)?.project === projectKey)).map((connection) => {
    const approved = String(connection.approvalState || "").toLowerCase() === "approved";
    const rejected = String(connection.approvalState || "").toLowerCase() === "rejected";
    const mechanism = String(connection.sharedMechanism || "No mechanism established");
    const mechanismMatch = words(mechanism).some((word) => words(task).includes(word));
    const selected = !rejected && mechanismMatch && ((approved && (retrievalScope === "transfers" || retrievalScope === "campus")) || (!approved && retrievalScope === "campus"));
    const sourceNode = nodesFor(state).find((node) => node.id === String(connection.sourceId));
    const targetNode = nodesFor(state).find((node) => node.id === String(connection.targetId));
    return {
      id: String(connection.id),
      sourceProject: sourceNode ? blueprintFor(sourceNode.project, state).project : "Connected project",
      targetProject: targetNode ? blueprintFor(targetNode.project, state).project : blueprint.project,
      sharedMechanism: mechanism,
      authority: approved ? "Approved transfer" : rejected ? "Rejected pathway" : "Exploratory connection",
      recordsFollowed: [String(connection.sourceId), ...(Array.isArray(connection.evidenceIds) ? connection.evidenceIds.map(String) : []), String(connection.targetId)],
      contribution: selected ? approved ? "Supplied adapted target-project context with human-approved authority." : "Helped reconstruct a possible analogy without inserting source-project authority into the final packet." : "No context contributed.",
      domainLimitations: String(connection.domainLimitations || "Project conclusions remain separate."),
      selected,
      reason: selected ? `Activated by the shared mechanism “${mechanism}” under ${retrievalScope} scope.` : rejected ? "Rejected: keyword similarity did not establish a meaningful mechanism." : !mechanismMatch ? "Shared mechanism did not match the current task." : approved ? "Approved transfer was outside the selected retrieval scope." : "Transfer is not approved; Campus exploration is required for exploratory use.",
    };
  });
  const compiledPrompt = [
    `TASK\n${task}`,
    `PROJECT BLUEPRINT\n${blueprint.rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`,
    localContext ? `LOCAL CONTEXT — temporary for this task only\n${localContext}` : "LOCAL CONTEXT\nNone supplied.",
    constraints ? `CALLER CONSTRAINTS\n${constraints}` : "CALLER CONSTRAINTS\nNone supplied.",
    `RETRIEVED DURABLE KNOWLEDGE\n${durable.map((item) => `- ${item.title}: ${item.summary}\n  Why: ${item.whyIncluded}`).join("\n")}`,
    `CHALLENGES TO CARRY FORWARD\n${challenges.length ? challenges.map((item) => `- ${item.title}: ${item.reason}`).join("\n") : "- No active challenge matched this task."}`,
    reconstructionPathways.some((pathway) => pathway.selected) ? `RECONSTRUCTION PATHWAYS\n${reconstructionPathways.filter((pathway) => pathway.selected).map((pathway) => `- ${pathway.authority}: ${pathway.sharedMechanism}. ${pathway.contribution} Boundary: ${pathway.domainLimitations}`).join("\n")}` : "RECONSTRUCTION PATHWAYS\nNone used.",
    "INSTRUCTIONS\nUse this packet as context, verify time-sensitive facts, distinguish facts from assumptions, and do not treat retrieved precedent as a prediction.",
  ].join("\n\n");
  const approvedPrinciples = durable.filter((item) => {
    const source = nodesFor(state).find((node) => node.id === item.id);
    return source?.type === "principle" || source?.type === "pattern" || source?.type === "adapted transfer";
  }).map(({ id, title, summary, whyIncluded }) => ({ id, title, summary, whyIncluded }));
  const supportingCases = durable.filter((item) => {
    const source = nodesFor(state).find((node) => node.id === item.id);
    return source?.type === "decision" || source?.type === "observation";
  }).map(({ id, title, summary, whyIncluded }) => ({ id, title, summary, whyIncluded }));
  return {
    packetId,
    task,
    project: blueprint.project,
    workspace: workspaceId ? { id: workspaceId, stateSource: "Shared browser + API demo workspace" } : { id: "default", stateSource: "Default governed workspace" },
    blueprint,
    localContext: localContext ? { content: localContext, retention: "Temporary", expiration: "End of task", captureRequiredForDurability: true } : null,
    durableKnowledge: durable,
    approvedPrinciples,
    supportingCases,
    challenges,
    excluded,
    reconstructionPathways,
    budget: { used: durable.length, limit: itemLimit, estimatedTokens: Math.ceil(compiledPrompt.length / 4), requestedTokens },
    compiledPrompt,
    contextPacket: compiledPrompt,
    receipt: {
      id: receiptId,
      tool: "atlas_build_context_packet",
      proposedBy: "Campus Atlas deterministic retrieval",
      createdAt: new Date().toISOString(),
      checks: ["Canonical workspace state loaded", "Active project scope applied", "Domain and mechanism fit checked", "Only approved knowledge received retrieval authority", "Transfer authority boundary checked", "Packet token budget enforced", "Local context kept temporary", "Inclusion and exclusion reasons attached"],
      humanApprovalRequired: false,
      inclusions: durable.map((item) => ({ id: item.id, reason: item.whyIncluded })),
      exclusions: excluded.map((item) => ({ id: item.id, reason: item.whyExcluded })),
      labelsApplied: [...new Set(eligible.flatMap((item) => item.labels))].slice(0, 8),
    },
  };
}

function retrievePrecedents(state: AtlasState, input: Record<string, unknown>) {
  const task = String(input.task || "");
  const project = String(input.project || "Sports Engine");
  return {
    task,
    project: blueprintFor(project, state).project,
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
  if (!env.CAMPUS_ATLAS_ACTION_KEY) return false;
  return request.headers.get("authorization") === `Bearer ${env.CAMPUS_ATLAS_ACTION_KEY}`;
}

function securityStatus(env: ActionEnv) {
  const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
  return {
    externalWrites: env.CAMPUS_ATLAS_ACTION_KEY ? "bearer_required" : "disabled",
    writeSecretConfigured: Boolean(env.CAMPUS_ATLAS_ACTION_KEY),
    protectedRoutes: ["/api/candidates", "/api/outcomes", "/api/events", "atlas_capture_candidate", "atlas_record_outcome", "atlas_submit_case_event"],
    promotionPolicy: "Human approval inside Campus Atlas only",
    publicDemo,
    browserStatePersistence: publicDemo ? "session_scoped_d1" : "hosted_d1",
    browserAndApiShareState: true,
    publicWorkspaceIsolation: publicDemo ? "opaque demo workspace key; private workspace remains separate" : "site access policy",
    privateWorkspaceExposed: !publicDemo,
    siteAccessManagedSeparately: true,
  };
}

function requireFields(input: Record<string, unknown>, fields: string[]) {
  return fields.filter((field) => typeof input[field] !== "string" || !String(input[field]).trim());
}

async function captureCandidate(db: D1Database, input: Record<string, unknown>, workspaceId?: string | null) {
  const missing = requireFields(input, ["title", "summary", "source", "idempotencyKey"]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}`, status: 400 };
  const loaded = await stateFor(db, Boolean(workspaceId), workspaceId);
  const receipts = Array.isArray(loaded.externalReceipts) ? loaded.externalReceipts : [];
  const key = String(input.idempotencyKey);
  const existing = receipts.find((receipt) => receipt.idempotencyKey === key);
  if (existing) return { data: { created: false, idempotentReplay: true, receipt: existing }, status: 200 };
  const id = `candidate-${Date.now().toString(36)}`;
  const objectType = input.objectType === "case" ? "case" : "knowledge";
  const node: AtlasNode = {
    id,
    project: normalizeProject(String(input.project || "sports")),
    room: objectType === "case" ? "Decision Lab" : "Candidate Inbox",
    type: objectType === "case" ? "decision" : "observation",
    title: String(input.title),
    summary: String(input.summary),
    status: "proposed",
    level: "Observation",
    sources: [String(input.source)],
    sourceFidelity: Number(input.confidence || 60),
    decisionImpact: objectType === "case" ? 58 : 45,
    reconstructionValue: 50,
    scopeStability: 40,
    x: 50,
    y: 50,
    lineage: ["Captured from ChatGPT", "Awaiting human Knowledge Review"],
    history: [{ id: `history-${Date.now()}`, date: "Now", label: "Candidate captured", detail: "External write created proposed knowledge only; no promotion authority was granted." }],
  };
  const receipt: ActionReceipt = { id: `RCP-${Date.now().toString(36).toUpperCase()}`, tool: "atlas_capture_candidate", createdAt: new Date().toISOString(), idempotencyKey: key, checks: ["Required fields validated", "Idempotency key checked", "Status forced to proposed", "Promotion authority denied"], effect: objectType === "case" ? "Created proposed case in the Case ledger for human review" : "Created proposed Observation for human review", targetId: id };
  const timestamp = new Date().toISOString();
  const projectKey = normalizeProject(String(input.project || "sports"));
  const canonicalCase = objectType === "case" ? {
    id, project: projectKey, origin: "API-created", title: String(input.title), createdAt: timestamp, state: "Captured", confidence: Number(input.confidence || 60), outcomeState: "Pending", governanceState: "Draft", retrievalEligible: false,
    experience: String(input.summary), task: String(input.summary), localContext: "", thesis: "Awaiting research audit.", facts: [], estimates: [], assumptions: [], unknowns: [], counterarguments: [], fragility: "Not yet audited", completeness: 20, outcome: "", postmortem: { happened: "", failed: "", held: "", underweighted: "", change: "", evidence: [] }, metadata: { Origin: "API-created", "Governance state": "Draft" },
  } : null;
  const canonicalEvidence = objectType === "case" ? { id: `evidence-${Date.now().toString(36)}`, project: projectKey, caseId: id, recordType: "Capture", content: String(input.summary), source: String(input.source), fidelity: "Exact", confidence: Number(input.confidence || 60), role: "Context", creator: "API sidecar", timestamp, approvalState: "Draft", retrievalEligible: false, metadata: { Origin: "API-created" } } : null;
  const canonicalKnowledge = objectType === "knowledge" ? { id, project: projectKey, type: "Principle", title: String(input.title), content: String(input.summary), status: "Pending", scope: String(input.project || "Project"), confidence: Number(input.confidence || 60), humanApproval: null, supportingCaseIds: [], evidenceIds: [], challengingEvidenceIds: [], revisionHistory: ["Proposed through the API sidecar."], retrievalHistory: [], retrievalEligible: false, metadata: { Origin: "API-created", "Governance state": "Pending" } } : null;
  const activity = { id: `activity-${Date.now().toString(36)}`, project: projectKey, actor: "API sidecar", action: objectType === "case" ? "Case captured" : "Knowledge proposed", targetId: id, targetTitle: String(input.title), timestamp, previousState: "No record", newState: objectType === "case" ? "Captured" : "Pending review", consequence: "Retrieval did not change because no knowledge was approved." };
  const next: AtlasState = { ...loaded, nodes: [...nodesFor(loaded), node], cases: canonicalCase ? [canonicalCase, ...(Array.isArray(loaded.cases) ? loaded.cases : [])] : loaded.cases, evidence: canonicalEvidence ? [canonicalEvidence, ...(Array.isArray(loaded.evidence) ? loaded.evidence : [])] : loaded.evidence, knowledge: canonicalKnowledge ? [canonicalKnowledge, ...(Array.isArray(loaded.knowledge) ? loaded.knowledge : [])] : loaded.knowledge, activities: [activity, ...(Array.isArray(loaded.activities) ? loaded.activities : [])], externalReceipts: [...receipts, receipt] };
  await saveAtlasState(db, next, workspaceId || undefined);
  return { data: { created: true, candidate: node, receipt }, status: 201 };
}

async function recordOutcome(db: D1Database, input: Record<string, unknown>, workspaceId?: string | null) {
  const missing = requireFields(input, ["targetId", "result", "reasoningAssessment", "source", "idempotencyKey"]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}`, status: 400 };
  const loaded = await stateFor(db, Boolean(workspaceId), workspaceId);
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
  const outcomeHistory = { id: `history-${Date.now().toString(36)}`, date: "Now", label: "Outcome recorded", detail: `${String(input.result)}. ${String(input.reasoningAssessment)}` };
  const nextNodes = nodesFor(loaded).map((node) => node.id === targetId ? { ...node, status: "challenged", history: [outcomeHistory, ...(Array.isArray(node.history) ? node.history : [])], lineage: [...(node.lineage || []), "Outcome recorded through Campus Atlas sidecar"] } : node);
  const timestamp = new Date().toISOString();
  const evidenceRecord = { id: `evidence-${Date.now().toString(36)}`, project: target.project, caseId: targetId, recordType: "Outcome", content: String(input.result), source: String(input.source), fidelity: "Exact", confidence: Number(input.confidence || 80), role: "Contradicts", creator: "API sidecar", timestamp, approvalState: "Approved", retrievalEligible: true, metadata: { "Outcome status": "Recorded" } };
  const nextCases = Array.isArray(loaded.cases) ? loaded.cases.map((item) => String(item.id) === targetId ? { ...item, outcome: String(input.result), outcomeState: "Recorded", state: "Needs audit", governanceState: "Challenged" } : item) : loaded.cases;
  const activity = { id: `activity-${Date.now().toString(36)}`, project: target.project, actor: "API sidecar", action: "Outcome recorded", targetId, targetTitle: target.title, timestamp, previousState: "Needs outcome", newState: "Needs audit", consequence: "Reality evidence was attached; retrieval authority did not change." };
  const next: AtlasState = { ...loaded, nodes: nextNodes, cases: nextCases, evidence: [evidenceRecord, ...(Array.isArray(loaded.evidence) ? loaded.evidence : [])], reviews: [...(Array.isArray(loaded.reviews) ? loaded.reviews : []), review], activities: [activity, ...(Array.isArray(loaded.activities) ? loaded.activities : [])], externalReceipts: [...receipts, receipt] };
  await saveAtlasState(db, next, workspaceId || undefined);
  return { data: { created: true, review, receipt }, status: 201 };
}

async function submitCaseEvent(db: D1Database, input: Record<string, unknown>, workspaceId?: string | null) {
  const missing = requireFields(input, ["targetId", "eventType", "content", "source", "idempotencyKey"]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(", ")}`, status: 400 };
  const eventType = String(input.eventType);
  if (!["evidence", "correction", "proposed_learning"].includes(eventType)) return { error: "eventType must be evidence, correction, or proposed_learning.", status: 400 };
  const loaded = await stateFor(db, Boolean(workspaceId), workspaceId);
  const receipts = Array.isArray(loaded.externalReceipts) ? loaded.externalReceipts : [];
  const key = String(input.idempotencyKey);
  const existing = receipts.find((receipt) => receipt.idempotencyKey === key);
  if (existing) return { data: { created: false, idempotentReplay: true, receipt: existing }, status: 200 };
  const targetId = String(input.targetId);
  const target = nodesFor(loaded).find((node) => node.id === targetId);
  if (!target) return { error: "Target Case was not found.", status: 404 };
  const now = Date.now().toString(36);
  const confidence = Math.max(0, Math.min(100, Number(input.confidence || 75)));
  const receipt: ActionReceipt = {
    id: `RCP-${now.toUpperCase()}`,
    tool: "atlas_submit_case_event",
    createdAt: new Date().toISOString(),
    idempotencyKey: key,
    checks: ["Target Case exists", "Event type validated", "Source and confidence preserved", "No durable Knowledge created automatically", "Human review remains required"],
    effect: eventType === "proposed_learning" ? "Created proposed learning linked to the Case; retrieval authority denied pending human approval" : `Attached ${eventType} to the Case review ledger without changing retrieval authority`,
    targetId,
  };
  const reviews = Array.isArray(loaded.reviews) ? loaded.reviews : [];
  const connections = Array.isArray(loaded.connections) ? loaded.connections : [];
  let nextNodes = nodesFor(loaded);
  let nextReviews = reviews;
  let nextConnections = connections;
  let nextEvidence = Array.isArray(loaded.evidence) ? loaded.evidence : [];
  let nextKnowledge = Array.isArray(loaded.knowledge) ? loaded.knowledge : [];
  let nextCases = Array.isArray(loaded.cases) ? loaded.cases : [];
  let proposal: AtlasNode | null = null;
  if (eventType === "proposed_learning") {
    proposal = {
      id: `proposal-${now}`,
      project: target.project,
      room: "Review Queue",
      type: "pattern",
      title: String(input.title || "Proposed learning from Case"),
      summary: String(input.content),
      status: "proposed",
      level: "Candidate Pattern",
      sources: [String(input.source), target.title],
      sourceFidelity: confidence,
      reconstructionValue: 70,
      decisionImpact: 65,
      scopeStability: 55,
      lineage: [target.title, "Case audit", "Proposed learning", "Awaiting human approval"],
      history: [{ id: `history-${now}`, date: "Now", label: "Proposed learning", detail: "Created through the API sidecar without retrieval authority." }],
    };
    nextNodes = [...nextNodes, proposal];
    nextConnections = [...connections, { id: `edge-${now}`, from: targetId, to: proposal.id, type: "Derived From", reason: String(input.connectionReason || "The proposed learning was reconstructed from this audited Case."), approved: false, inferred: true }];
    nextKnowledge = [{ id: proposal.id, project: target.project, type: "Principle", title: proposal.title, content: proposal.summary, status: "Pending", scope: String(input.scope || target.project), confidence, humanApproval: null, supportingCaseIds: [targetId], evidenceIds: [], challengingEvidenceIds: [], revisionHistory: ["Proposed through the API sidecar."], retrievalHistory: [], retrievalEligible: false, metadata: { Origin: "API-created", "Governance state": "Pending" } }, ...nextKnowledge];
    nextReviews = [{ id: `review-${now}`, project: target.project, type: "Proposed principle", title: proposal.title, proposal: proposal.summary, why: String(input.connectionReason || "Proposed from an API-submitted case event."), sourceCaseId: targetId, supportEvidenceIds: [], challengeEvidenceIds: [], affectedKnowledgeId: proposal.id, blueprintEffect: "None unless separately authorized.", confidence, retrievalEffect: "No effect until human approval.", crossProjectConsequence: "None.", status: "Pending" }, ...nextReviews];
    nextCases = nextCases.map((item) => String(item.id) === targetId ? { ...item, state: "Awaiting review", governanceState: "Pending", proposedKnowledgeId: proposal?.id } : item);
  } else {
    const action = eventType === "correction" ? "Revise" : String(input.effect || "support") === "challenge" ? "Challenge" : "Reinforce";
    nextReviews = [...reviews, { id: `event-${now}`, nodeId: targetId, action, rationale: String(input.content), evidence: String(input.title || eventType), source: String(input.source), strength: String(input.strength || "Moderate"), scope: String(input.scope || "This Case"), confidence, project: target.project, relatedNodeId: targetId, createdAt: new Date().toISOString(), eventType }];
    nextNodes = nextNodes.map((node) => node.id === targetId ? { ...node, history: [{ id: `history-${now}`, date: "Now", label: eventType === "correction" ? "Correction proposed" : "Evidence added", detail: String(input.content) }, ...(Array.isArray(node.history) ? node.history : [])] } : node);
    nextEvidence = [{ id: `evidence-${now}`, project: target.project, caseId: targetId, recordType: eventType === "correction" ? "Correction" : "Evidence", content: String(input.content), source: String(input.source), fidelity: "Exact", confidence, role: eventType === "correction" ? "Refines" : String(input.effect || "support") === "challenge" ? "Challenges" : "Supports", creator: "API sidecar", timestamp: new Date().toISOString(), approvalState: eventType === "correction" ? "Approved" : "Pending", retrievalEligible: eventType === "correction", metadata: { Origin: "API-created" } }, ...nextEvidence];
  }
  const activity = { id: `activity-${now}`, project: target.project, actor: "API sidecar", action: eventType === "proposed_learning" ? "Principle proposed" : eventType === "correction" ? "Correction added" : "Evidence added", targetId, targetTitle: target.title, timestamp: new Date().toISOString(), previousState: "Case record", newState: eventType === "proposed_learning" ? "Awaiting review" : "Evidence updated", consequence: "No retrieval authority was granted automatically." };
  const next: AtlasState = { ...loaded, nodes: nextNodes, cases: nextCases, evidence: nextEvidence, knowledge: nextKnowledge, reviews: nextReviews, connections: nextConnections, activities: [activity, ...(Array.isArray(loaded.activities) ? loaded.activities : [])], externalReceipts: [...receipts, receipt] };
  await saveAtlasState(db, next, workspaceId || undefined);
  return { data: { created: true, eventType, proposal, receipt }, status: 201 };
}

const tools = [
  {
    name: "atlas_build_context_packet",
    title: "Build Context Packet",
    description: "Assemble the smallest useful, inspectable context from one Campus Atlas project for a new ChatGPT task.",
    inputSchema: { type: "object", properties: { task: { type: "string", description: "The specific task or question ChatGPT is working on." }, project: { type: "string", description: "The active Campus Atlas project, such as Sports Engine." }, localContext: { type: "string", description: "Optional temporary facts for this task only." }, constraints: { type: "string", description: "Optional caller constraints applied to the compiled packet." }, tokenBudget: { type: "number", minimum: 250, maximum: 2500, description: "Approximate maximum token budget for the packet." }, retrievalScope: { type: "string", enum: ["project", "transfers", "campus"], description: "Current project only, project plus approved transfers, or deliberate Campus exploration." }, workspaceId: { type: "string", description: "Optional demo workspace key shown in Campus Atlas so ChatGPT reads the same evolving cases as the browser." } }, required: ["task", "project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_get_project_blueprint",
    title: "Get Project Blueprint",
    description: "Return the current reasoning rules and earned capabilities for a Campus Atlas project.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, workspaceId: { type: "string", description: "Optional shared demo workspace key." } }, required: ["project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_retrieve_precedents",
    title: "Retrieve Explainable Precedents",
    description: "Find approved historical knowledge relevant to a task and explain each evidence path.",
    inputSchema: { type: "object", properties: { task: { type: "string" }, project: { type: "string" }, workspaceId: { type: "string", description: "Optional shared demo workspace key." } }, required: ["task", "project"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_get_receipt",
    title: "Get Atlas Receipt",
    description: "Inspect a preserved receipt for a ChatGPT-to-Atlas action.",
    inputSchema: { type: "object", properties: { receiptId: { type: "string" }, workspaceId: { type: "string", description: "Optional shared demo workspace key." } }, required: ["receiptId"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_capture_candidate",
    title: "Capture Candidate Case or Knowledge",
    description: "Create a proposed case or knowledge object for later human review. This never promotes or grants retrieval authority.",
    inputSchema: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, source: { type: "string" }, project: { type: "string" }, objectType: { type: "string", enum: ["case", "knowledge"], description: "Use case for a new thesis/decision record; use knowledge for a reusable observation." }, confidence: { type: "number", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string", description: "Stable unique key so retries do not duplicate the write." }, workspaceId: { type: "string", description: "Shared demo workspace key. Required for public-demo writes." } }, required: ["title", "summary", "source", "project", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_record_outcome",
    title: "Record Outcome Evidence",
    description: "Attach a result and reasoning assessment as a preserved evidence event. This never changes authority directly.",
    inputSchema: { type: "object", properties: { targetId: { type: "string" }, result: { type: "string" }, reasoningAssessment: { type: "string" }, source: { type: "string" }, impactStrength: { type: "string", enum: ["Light", "Moderate", "Strong"] }, scope: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string" }, workspaceId: { type: "string", description: "Shared demo workspace key. Required for public-demo writes." } }, required: ["targetId", "result", "reasoningAssessment", "source", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "atlas_submit_case_event",
    title: "Submit Evidence, Correction, or Proposed Learning",
    description: "Attach a governed event to an existing Case. Proposed learning remains review-only and never becomes durable Knowledge automatically.",
    inputSchema: { type: "object", properties: { targetId: { type: "string" }, eventType: { type: "string", enum: ["evidence", "correction", "proposed_learning"] }, title: { type: "string" }, content: { type: "string" }, source: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 100 }, effect: { type: "string", enum: ["support", "challenge"] }, connectionReason: { type: "string" }, idempotencyKey: { type: "string" }, workspaceId: { type: "string", description: "Shared demo workspace key. Required for public-demo writes." } }, required: ["targetId", "eventType", "content", "source", "idempotencyKey"], additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

async function executeTool(name: string, input: Record<string, unknown>, request: Request, env: ActionEnv) {
  const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
  const workspaceId = workspaceFor(request, input, publicDemo);
  const scopedInput = workspaceId ? { ...input, workspaceId } : input;
  const state = await stateFor(env.DB, publicDemo, workspaceId);
  if (name === "atlas_build_context_packet") {
    const packet = buildContextPacket(state, scopedInput);
    if (!publicDemo || workspaceId) await saveAtlasState(env.DB, { ...state, contextPackets: [...(Array.isArray(state.contextPackets) ? state.contextPackets : []), packet].slice(-25) }, workspaceId || undefined);
    return { data: packet, status: 200 };
  }
  if (name === "atlas_get_project_blueprint") return { data: blueprintFor(String(input.project || ""), state), status: 200 };
  if (name === "atlas_retrieve_precedents") return { data: retrievePrecedents(state, input), status: 200 };
  if (name === "atlas_get_receipt") {
    const receipt = (state.externalReceipts || []).find((item) => item.id === String(input.receiptId));
    return receipt ? { data: receipt, status: 200 } : { error: "Receipt not found.", status: 404 };
  }
  if (["atlas_capture_candidate", "atlas_record_outcome", "atlas_submit_case_event"].includes(name) && !isAuthorized(request, env)) return { error: "Write authorization required.", status: 401 };
  if (["atlas_capture_candidate", "atlas_record_outcome", "atlas_submit_case_event"].includes(name) && publicDemo && !workspaceId) return { error: "A valid public-demo workspaceId is required for writes.", status: 400 };
  if (name === "atlas_capture_candidate") return captureCandidate(env.DB, scopedInput, workspaceId);
  if (name === "atlas_record_outcome") return recordOutcome(env.DB, scopedInput, workspaceId);
  if (name === "atlas_submit_case_event") return submitCaseEvent(env.DB, scopedInput, workspaceId);
  return { error: `Unknown tool: ${name}`, status: 404 };
}

function openApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: { title: "Campus Atlas Actions", version: "4.6.0", description: "Project-scoped governed context retrieval and proposed writes for ChatGPT. Browser and sidecar share one canonical workspace; models never grant their own promotion authority." },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/projects/{projectId}/continuity/check": {
        post: {
          operationId: "checkCanonicalContinuity",
          tags: ["Canonical V1.7.1"],
          summary: "Determine whether a task needs none, light, or full governed continuity",
          description: "A read-only canonical façade. It creates no packet, receipt, handoff, answer, provider call, authority change, or retrieval-eligibility change.",
          parameters: [{
            name: "projectId",
            in: "path",
            required: true,
            schema: { type: "string" },
          }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContinuityCheckRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Non-mutating Need Gate and compact canonical continuity projection",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContinuityCheckResponse" },
                },
              },
            },
            "400": {
              description: "Invalid or client-authored canonical input",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CanonicalError" } } },
            },
            "404": {
              description: "Project or case not found within the requested project",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CanonicalError" } } },
            },
            "500": {
              description: "Canonical state or read-only roadway registry unavailable",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CanonicalError" } } },
            },
          },
        },
      },
      "/api/context": { post: { operationId: "buildContextPacket", summary: "Build the smallest useful context packet", requestBody: { required: true, content: { "application/json": { schema: tools[0].inputSchema } } }, responses: { "200": { description: "Inspectable context packet" } } } },
      "/api/blueprint": { get: { operationId: "getProjectBlueprint", summary: "Get a project reasoning blueprint", parameters: [{ name: "project", in: "query", required: true, schema: { type: "string" } }, { name: "workspaceId", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "Project blueprint" } } } },
      "/api/precedents": { post: { operationId: "retrievePrecedents", summary: "Retrieve explainable precedents", requestBody: { required: true, content: { "application/json": { schema: tools[2].inputSchema } } }, responses: { "200": { description: "Ranked precedents" } } } },
      "/api/candidates": { post: { operationId: "captureCandidate", summary: "Capture proposed knowledge for human review", requestBody: { required: true, content: { "application/json": { schema: tools[4].inputSchema } } }, responses: { "201": { description: "Candidate and action receipt" } } } },
      "/api/outcomes": { post: { operationId: "recordOutcome", summary: "Record reality evidence", requestBody: { required: true, content: { "application/json": { schema: tools[5].inputSchema } } }, responses: { "201": { description: "Evidence event and action receipt" } } } },
      "/api/events": { post: { operationId: "submitCaseEvent", summary: "Attach evidence, a correction, or proposed learning to a Case", requestBody: { required: true, content: { "application/json": { schema: tools[6].inputSchema } } }, responses: { "201": { description: "Governed event or proposed learning plus receipt" } } } },
      "/api/receipts": { get: { operationId: "getAtlasReceipt", summary: "Inspect an action receipt", parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }, { name: "workspaceId", in: "query", required: false, schema: { type: "string" } }], responses: { "200": { description: "Action receipt" } } } },
    },
    components: {
      schemas: {
        ContinuityCheckRequest: {
          type: "object",
          additionalProperties: false,
          required: ["task"],
          properties: {
            task: { type: "string", minLength: 1, description: "Exact current caller task; remains controlling." },
            requestedOutput: { type: "string", minLength: 1 },
            caseId: { type: "string", minLength: 3 },
            roadwayOverride: { type: "string", minLength: 3, description: "Current-run override only; never updates the registry." },
            tokenBudget: { type: "integer", enum: [400, 800, 1600], default: 800 },
          },
        },
        ContinuityCheckResponse: {
          type: "object",
          required: ["apiVersion", "projectId", "literalTask", "need", "status", "continuity", "freshness", "budget", "effects", "diagnostics", "next"],
          properties: {
            apiVersion: { type: "string", const: "v1.7.1" },
            projectId: { type: "string" },
            caseId: { type: ["string", "null"] },
            literalTask: { type: "string" },
            need: {
              type: "object",
              required: ["level", "reasonCodes", "explanation"],
              properties: {
                level: { type: "string", enum: ["none", "light", "full"] },
                reasonCodes: { type: "array", items: { type: "string" } },
                explanation: { type: "string" },
              },
            },
            status: {
              type: "string",
              enum: ["not_needed", "light_context_available", "ready", "clarification_required", "missing_required_state", "unsafe_under_selected_budget"],
            },
            interpretation: { type: ["object", "null"] },
            roadway: { type: "object" },
            compactCapsule: { type: ["object", "null"] },
            continuity: { type: "object" },
            freshness: { type: "object" },
            budget: { type: "object" },
            treatmentCounts: { type: "object" },
            effects: {
              type: "object",
              required: ["packetCreated", "providerCallPerformed", "authorityChanged", "canonicalMutationPerformed"],
              properties: {
                packetCreated: { type: "boolean", const: false },
                receiptCreated: { type: "boolean", const: false },
                handoffCreated: { type: "boolean", const: false },
                answerCreated: { type: "boolean", const: false },
                providerCallPerformed: { type: "boolean", const: false },
                authorityChanged: { type: "boolean", const: false },
                retrievalEligibilityChanged: { type: "boolean", const: false },
                canonicalMutationPerformed: { type: "boolean", const: false },
              },
            },
            diagnostics: { type: "object" },
            next: { type: "object" },
          },
        },
        CanonicalError: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    },
  };
}

export async function handleAtlasActions(request: Request, env: ActionEnv) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, x-atlas-workspace", "access-control-allow-methods": "GET, POST, OPTIONS" } });

  if (url.pathname === "/openapi.json" || url.pathname === "/.well-known/openapi.json") return json(openApi(url.origin));
  if (url.pathname === "/api/security" && request.method === "GET") return json(securityStatus(env));
  if (url.pathname === "/privacy") return textResponse("<!doctype html><html><head><title>Campus Atlas Privacy</title><meta name=viewport content='width=device-width,initial-scale=1'><style>body{font:16px/1.6 system-ui;max-width:760px;margin:64px auto;padding:0 24px;color:#172033}h1{font-size:34px}</style></head><body><h1>Campus Atlas privacy</h1><p>In public demo mode, each browser receives an opaque demonstration workspace key. Interactive changes are stored in a session-scoped demo record so the browser and context API inspect the same evolving project-scoped cases. That record is separate from the private Campus Atlas workspace.</p><p>Anyone holding a demo workspace key may be able to retrieve that demonstration state, so do not submit secrets, payment data, or sensitive medical information. Temporary Local Context stays attached to its packet unless explicitly captured.</p><p>External case, evidence, correction, and outcome writes require authorization and never promote knowledge. Human approval inside Campus Atlas remains the only promotion authority.</p></body></html>", 200, "text/html; charset=utf-8");

  if (url.pathname === "/api/context" && request.method === "POST") {
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const input = await request.json() as Record<string, unknown>;
    const workspaceId = workspaceFor(request, input, publicDemo);
    const scopedInput = workspaceId ? { ...input, workspaceId } : input;
    const state = await stateFor(env.DB, publicDemo, workspaceId);
    const packet = buildContextPacket(state, scopedInput);
    if (!publicDemo || workspaceId) await saveAtlasState(env.DB, { ...state, contextPackets: [...(Array.isArray(state.contextPackets) ? state.contextPackets : []), packet].slice(-25) }, workspaceId || undefined);
    return json(packet);
  }
  if (url.pathname === "/api/blueprint" && request.method === "GET") {
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const input = { workspaceId: url.searchParams.get("workspaceId") || "" };
    const workspaceId = workspaceFor(request, input, publicDemo);
    return json(blueprintFor(url.searchParams.get("project") || "", await stateFor(env.DB, publicDemo, workspaceId)));
  }
  if (url.pathname === "/api/precedents" && request.method === "POST") {
    const input = await request.json() as Record<string, unknown>;
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const workspaceId = workspaceFor(request, input, publicDemo);
    return json(retrievePrecedents(await stateFor(env.DB, publicDemo, workspaceId), input));
  }
  if (url.pathname === "/api/receipts" && request.method === "GET") {
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const input = { workspaceId: url.searchParams.get("workspaceId") || "" };
    const state = await stateFor(env.DB, publicDemo, workspaceFor(request, input, publicDemo));
    const receipt = (state.externalReceipts || []).find((item) => item.id === url.searchParams.get("id"));
    return receipt ? json(receipt) : json({ error: "Receipt not found." }, 404);
  }
  if (url.pathname === "/api/candidates" && request.method === "POST") {
    if (!isAuthorized(request, env)) return json({ error: "Write authorization required." }, 401);
    const input = await request.json() as Record<string, unknown>;
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const workspaceId = workspaceFor(request, input, publicDemo);
    if (publicDemo && !workspaceId) return json({ error: "A valid public-demo workspaceId is required for writes." }, 400);
    const result = await captureCandidate(env.DB, input, workspaceId);
    return "data" in result ? json(result.data, result.status) : json({ error: result.error }, result.status);
  }
  if (url.pathname === "/api/outcomes" && request.method === "POST") {
    if (!isAuthorized(request, env)) return json({ error: "Write authorization required." }, 401);
    const input = await request.json() as Record<string, unknown>;
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const workspaceId = workspaceFor(request, input, publicDemo);
    if (publicDemo && !workspaceId) return json({ error: "A valid public-demo workspaceId is required for writes." }, 400);
    const result = await recordOutcome(env.DB, input, workspaceId);
    return "data" in result ? json(result.data, result.status) : json({ error: result.error }, result.status);
  }
  if (url.pathname === "/api/events" && request.method === "POST") {
    if (!isAuthorized(request, env)) return json({ error: "Write authorization required." }, 401);
    const input = await request.json() as Record<string, unknown>;
    const publicDemo = env.CAMPUS_ATLAS_PUBLIC_DEMO === "true";
    const workspaceId = workspaceFor(request, input, publicDemo);
    if (publicDemo && !workspaceId) return json({ error: "A valid public-demo workspaceId is required for writes." }, 400);
    const result = await submitCaseEvent(env.DB, input, workspaceId);
    return "data" in result ? json(result.data, result.status) : json({ error: result.error }, result.status);
  }

  if (url.pathname !== "/mcp") return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "MCP uses POST requests." }, 405, { allow: "POST, OPTIONS" });
  const rpc = await request.json() as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
  if (rpc.method?.startsWith("notifications/")) return new Response(null, { status: 202, headers: { "access-control-allow-origin": "*" } });
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  const fail = (code: number, message: string) => json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message } });
  if (rpc.method === "initialize") return ok({ protocolVersion: String((rpc.params as { protocolVersion?: string } | undefined)?.protocolVersion || "2025-06-18"), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Campus Atlas", version: "4.6.0" } });
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
