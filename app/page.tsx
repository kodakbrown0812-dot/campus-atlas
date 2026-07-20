"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ProjectKey = "hq" | "sports" | "training" | "lessons" | "human" | "finance";
type NodeType = "core" | "principle" | "pattern" | "observation" | "decision" | "correction";
type PromotionLevel = "Observation" | "Candidate Pattern" | "Validated Principle" | "Whiteboard Method" | "Core Lens";
type ReviewAction = "Reinforce" | "Challenge" | "Revise" | "Narrow Scope" | "Supersede" | "Merge" | "Retire";
type EdgeType = "Supports" | "Challenges" | "Revises" | "Applies To" | "Derived From" | "Shares Principle With" | "Supersedes" | "Constrained By";
type GraphView = "connections" | "lineage" | "challenges" | "influence";
type MobileSurface = "ask" | "projects" | "atlas" | "review";
type LocalKind = "Objective" | "Temporary fact" | "Constraint" | "Assumption" | "Exclusion" | "Time horizon" | "Current condition" | "User instruction" | "Missing information";

type Project = { key: ProjectKey; label: string; short: string; color: string; rooms: number; description: string; capabilityCount: number };
type HistoryEntry = { id: string; date: string; label: string; detail: string };
type KnowledgeNode = {
  id: string; project: ProjectKey; room: string; type: NodeType; title: string; summary: string;
  status: "approved" | "inferred" | "proposed" | "challenged" | "retired"; level: PromotionLevel;
  x: number; y: number; sources: string[]; lineage: string[]; sourceFidelity: number;
  decisionImpact: number; reconstructionValue: number; scopeStability: number; history: HistoryEntry[];
};
type ReviewEvent = {
  id: string; nodeId: string; action: ReviewAction; rationale: string; evidence: string; source: string;
  strength: "Light" | "Moderate" | "Strong"; scope: string; confidence: number; project: ProjectKey;
  relatedNodeId: string; createdAt: string;
};
type Connection = { id: string; from: string; to: string; type: EdgeType; reason: string; approved: boolean; inferred?: boolean };
type LocalContext = {
  id: string; kind: LocalKind; content: string; source: string; confidence: number; scope: "This packet" | "This project" | "Entire campus";
  expires: string; promotion: "Temporary" | "Eligible for later promotion"; linkedNodeId: string; captured?: boolean;
};
type PacketState = { id: string; question: string; local: LocalContext[]; excludedIds: string[]; compiledAt?: string };
type StructuredCapture = {
  claim: string; evidence: string[]; counterEvidence: string[]; assumptions: string[]; missingInformation: string[];
  source: string; confidence: number; truthClass: "Observed" | "Claimed" | "Predicted" | "Corrected";
  scope: string; projectOfOrigin: string; fidelity: "Exact" | "Reconstructed" | "Inferred";
};
type AIReceipt = {
  id: string; operation: string; model: string; mode: "live_gpt" | "seeded_demo"; proposedAt: string;
  checks: string[]; approved: string[]; rejected: string[]; inputSummary: string;
};
type HandoffPacket = {
  packetId: string; task: string; project: string;
  blueprint: { project: string; version: string; purpose: string; rules: string[]; capabilities: string[] };
  localContext: null | { content: string; retention: string; expiration: string; captureRequiredForDurability: boolean };
  durableKnowledge: Array<{ id: string; title: string; summary: string; usefulness: number; whyIncluded: string; source: string; confidence: number; scope: string; freshness: string; fidelity: string; authorityLevel: string; connectionPath: string[]; lineage: string[] }>;
  challenges: Array<{ id: string; title: string; reason: string; source: string; status: string }>;
  excluded: Array<{ id: string; title: string; whyExcluded: string }>;
  budget: { used: number; limit: number; estimatedTokens: number };
  compiledPrompt: string;
  receipt: { id: string; tool: string; proposedBy: string; createdAt: string; checks: string[]; humanApprovalRequired: boolean };
};

const projects: Project[] = [
  { key: "hq", label: "Headquarters", short: "HQ", color: "#a78bfa", rooms: 2, description: "Campus governance and promotion", capabilityCount: 1 },
  { key: "sports", label: "Sports Engine", short: "SE", color: "#4d7cfe", rooms: 4, description: "Research, pricing, and calibration", capabilityCount: 7 },
  { key: "training", label: "Health + Training", short: "HT", color: "#27d4c7", rooms: 3, description: "Load, recovery, and performance", capabilityCount: 2 },
  { key: "lessons", label: "Lessons Division", short: "LD", color: "#f4b860", rooms: 3, description: "Learning paths and reconstruction", capabilityCount: 2 },
  { key: "human", label: "Human Systems Lab", short: "HS", color: "#f58aa8", rooms: 2, description: "Patterns, experiments, and updates", capabilityCount: 1 },
  { key: "finance", label: "Finance", short: "FI", color: "#77d68b", rooms: 2, description: "Decisions, assumptions, and outcomes", capabilityCount: 1 },
];

const levels: PromotionLevel[] = ["Observation", "Candidate Pattern", "Validated Principle", "Whiteboard Method", "Core Lens"];
const reviewActions: ReviewAction[] = ["Reinforce", "Challenge", "Revise", "Narrow Scope", "Supersede", "Merge", "Retire"];
const edgeTypes: EdgeType[] = ["Supports", "Challenges", "Revises", "Applies To", "Derived From", "Shares Principle With", "Supersedes", "Constrained By"];
const localKinds: LocalKind[] = ["Objective", "Temporary fact", "Constraint", "Assumption", "Exclusion", "Time horizon", "Current condition", "User instruction", "Missing information"];

const initialNodes: KnowledgeNode[] = [
  { id: "core-reality", project: "hq", room: "Core Lens", type: "core", title: "Reality corrects the model", summary: "Outcomes and explicit corrections outrank elegant inference. Durable claims remain traceable to evidence.", status: "approved", level: "Core Lens", x: 50, y: 46, sources: ["Campus constitution v0.1", "Three explicit corrections", "Outcome audit set"], lineage: ["Repeated user corrections", "Outcome audits across Sports Engine", "Cross-project governance pattern", "Approved Core Lens"], sourceFidelity: 96, decisionImpact: 94, reconstructionValue: 97, scopeStability: 95, history: [{ id: "h1", date: "Jul 12", label: "Promoted", detail: "Headquarters approved campus-wide authority." }] },
  { id: "decision-england", project: "sports", room: "Decision Lab", type: "decision", title: "England +1.5 & Under 4.5", summary: "A competitive, controlled match was expected. France won 3–1; the combined market lost and triggered a post-mortem.", status: "approved", level: "Observation", x: 17, y: 25, sources: ["Sports thesis 001", "Final result: France 3–1 England"], lineage: ["Pre-match thesis", "Market correction", "Final result", "Outcome post-mortem"], sourceFidelity: 91, decisionImpact: 78, reconstructionValue: 74, scopeStability: 66, history: [{ id: "h2", date: "Jul 18", label: "Outcome attached", detail: "Reality event closed the decision case." }] },
  { id: "pattern-format", project: "sports", room: "Precedent Library", type: "pattern", title: "Event format can break the base rate", summary: "Motivation, rotation, and variance can shift in special formats. The project blueprint may need an explicit format adjustment.", status: "proposed", level: "Candidate Pattern", x: 30, y: 63, sources: ["Thesis 001 post-mortem", "Historical format note"], lineage: ["England decision case", "3–1 outcome", "Format variance post-mortem", "Candidate pattern drafted"], sourceFidelity: 72, decisionImpact: 81, reconstructionValue: 86, scopeStability: 58, history: [{ id: "h3", date: "Jul 19", label: "Candidate created", detail: "Promotion blocked by one unresolved contradiction." }] },
  { id: "principle-fast", project: "training", room: "On-Ice Development", type: "principle", title: "Play fast. Don’t just skate hard.", summary: "Decision speed, scanning, support, and timing create more transfer than constant maximum exertion.", status: "approved", level: "Validated Principle", x: 79, y: 22, sources: ["On-Ice V2", "Seven skate observations", "Game-transfer review"], lineage: ["Seven skate observations", "Game reflection", "Repeated transfer under pressure", "Human-approved principle"], sourceFidelity: 89, decisionImpact: 91, reconstructionValue: 88, scopeStability: 84, history: [{ id: "h4", date: "Jul 15", label: "Promoted", detail: "Evidence held across practice and game environments." }] },
  { id: "pattern-overwork", project: "human", room: "Pattern Lab", type: "pattern", title: "More work is not always better", summary: "High drive becomes counterproductive when effort is spent on unwinnable pucks, excess volume, or recovery debt.", status: "approved", level: "Validated Principle", x: 80, y: 69, sources: ["Game reflection", "Training timeline", "Knee recovery notes"], lineage: ["Unwinnable puck reflection", "Recovery debt observations", "Human Systems comparison", "Cross-project validation"], sourceFidelity: 85, decisionImpact: 88, reconstructionValue: 84, scopeStability: 82, history: [{ id: "h5", date: "Jul 17", label: "Scope widened", detail: "Confirmed beyond hockey in workload decisions." }] },
  { id: "principle-timeline", project: "training", room: "Recovery Board", type: "principle", title: "Consider the timeline", summary: "Interpret today’s signal inside recent workload, recovery, and trajectory—not as an isolated reading.", status: "approved", level: "Whiteboard Method", x: 61, y: 84, sources: ["Health + Training Whiteboard", "Eight linked observations"], lineage: ["Knee signal observations", "Load-history comparison", "Repeated recovery decisions", "Whiteboard method approved"], sourceFidelity: 92, decisionImpact: 93, reconstructionValue: 91, scopeStability: 90, history: [{ id: "h6", date: "Jul 16", label: "Method promoted", detail: "Now has authority in Health + Training decisions." }] },
  { id: "principle-reconstruct", project: "lessons", room: "Software Engineering", type: "principle", title: "Connections preserve continuity", summary: "Knowledge compounds when relationships and reconstruction paths survive compression.", status: "approved", level: "Whiteboard Method", x: 49, y: 12, sources: ["Lessons Division", "Architecture review", "Codex blueprint"], lineage: ["Context storage lesson", "Architecture review", "Cross-room reconstruction tests", "Whiteboard approval"], sourceFidelity: 94, decisionImpact: 86, reconstructionValue: 99, scopeStability: 91, history: [{ id: "h7", date: "Jul 18", label: "Reinforced", detail: "Rebar blueprint supplied independent confirmation." }] },
  { id: "correction-total", project: "sports", room: "Corrections", type: "correction", title: "Market options were overstated", summary: "The available total was corrected by the user. Future retrieval must distinguish researched markets from currently offered markets.", status: "approved", level: "Observation", x: 16, y: 81, sources: ["Direct user correction", "Market screenshot"], lineage: ["Incorrect market assumption", "Direct correction", "Screenshot verification", "Retrieval constraint added"], sourceFidelity: 99, decisionImpact: 72, reconstructionValue: 82, scopeStability: 76, history: [{ id: "h8", date: "Jul 18", label: "Correction preserved", detail: "Direct correction overrides system inference." }] },
  { id: "principle-workload", project: "sports", room: "Pitching Props", type: "principle", title: "Workload stability gates strikeout overs", summary: "Before pricing pitcher strikeouts, verify recent pitch counts, manager constraints, and a realistic innings range.", status: "approved", level: "Validated Principle", x: 43, y: 37, sources: ["Three closed pitcher-prop post-mortems", "Human promotion review"], lineage: ["Three pitcher-prop cases", "Failed innings assumption", "Scope review", "Human-approved principle"], sourceFidelity: 84, decisionImpact: 92, reconstructionValue: 92, scopeStability: 86, history: [{ id: "h9", date: "Jul 20", label: "Promoted", detail: "Workload verification earned authority after comparison across three closed props." }] },
  { id: "precedent-pitcher-set", project: "sports", room: "Precedent Library", type: "observation", title: "Ace-versus-lineup strikeout precedent set", summary: "Two comparable strikeout props held, while the failed case overestimated innings because pitch-count stability was never verified.", status: "approved", level: "Observation", x: 41, y: 78, sources: ["Reconstructed Sports Engine case set"], lineage: ["Three closed props", "Outcome comparison", "Reconstructed precedent set"], sourceFidelity: 76, decisionImpact: 87, reconstructionValue: 89, scopeStability: 72, history: [{ id: "h10", date: "Jul 20", label: "Precedent set reconstructed", detail: "The retrieval path preserves the shared mechanism and the failed innings assumption." }] },
];

const seedReviews: ReviewEvent[] = [
  { id: "r1", nodeId: "core-reality", action: "Reinforce", rationale: "The principle held across multiple outcome reviews.", evidence: "Three explicit corrections improved later decisions.", source: "Campus audit", strength: "Strong", scope: "Entire campus", confidence: 96, project: "hq", relatedNodeId: "correction-total", createdAt: "2026-07-18" },
  { id: "r2", nodeId: "core-reality", action: "Reinforce", rationale: "Independent project confirmation.", evidence: "Training load decisions improved when reality signals overruled plans.", source: "Health + Training review", strength: "Strong", scope: "Entire campus", confidence: 91, project: "training", relatedNodeId: "principle-timeline", createdAt: "2026-07-17" },
  { id: "r3", nodeId: "pattern-format", action: "Reinforce", rationale: "The post-mortem identifies a reusable format mechanism.", evidence: "Motivation and rotation differed from the base competition sample.", source: "Thesis 001 post-mortem", strength: "Moderate", scope: "Sports Engine", confidence: 74, project: "sports", relatedNodeId: "decision-england", createdAt: "2026-07-19" },
  { id: "r4", nodeId: "pattern-format", action: "Challenge", rationale: "One case cannot establish the direction or size of the adjustment.", evidence: "Historical sample is not yet separated by format.", source: "Research audit", strength: "Moderate", scope: "Sports Engine", confidence: 88, project: "sports", relatedNodeId: "decision-england", createdAt: "2026-07-19" },
  { id: "r5", nodeId: "principle-fast", action: "Reinforce", rationale: "Game environment confirmed transfer.", evidence: "Better routes and scanning preserved pace without constant max effort.", source: "Beer league reflection", strength: "Strong", scope: "Health + Training", confidence: 88, project: "training", relatedNodeId: "pattern-overwork", createdAt: "2026-07-15" },
  { id: "r6", nodeId: "pattern-overwork", action: "Reinforce", rationale: "Same mechanism appeared in recovery planning.", evidence: "Added volume produced recovery debt without useful transfer.", source: "Training timeline", strength: "Strong", scope: "Cross-project", confidence: 86, project: "training", relatedNodeId: "principle-fast", createdAt: "2026-07-17" },
  { id: "r7", nodeId: "pattern-overwork", action: "Reinforce", rationale: "Independent Human Systems observation.", evidence: "Permission to stop improved allocation of effort.", source: "Human Systems Lab", strength: "Moderate", scope: "Cross-project", confidence: 82, project: "human", relatedNodeId: "principle-timeline", createdAt: "2026-07-17" },
  { id: "r8", nodeId: "principle-timeline", action: "Reinforce", rationale: "Repeated health decisions reconstructed correctly.", evidence: "Current pain made sense only inside recent workload.", source: "Recovery Board", strength: "Strong", scope: "Health + Training", confidence: 92, project: "training", relatedNodeId: "pattern-overwork", createdAt: "2026-07-16" },
  { id: "r9", nodeId: "principle-reconstruct", action: "Reinforce", rationale: "Architecture tests preserved why a fact mattered.", evidence: "Typed edges reconstructed prior decisions after compression.", source: "Codex architecture review", strength: "Strong", scope: "Entire campus", confidence: 94, project: "lessons", relatedNodeId: "core-reality", createdAt: "2026-07-18" },
  { id: "r10", nodeId: "correction-total", action: "Reinforce", rationale: "Direct source verified the correction.", evidence: "Screenshot showed only 0.5, 1.5, and 2.5 totals.", source: "Market screenshot", strength: "Strong", scope: "Sports Engine", confidence: 99, project: "sports", relatedNodeId: "decision-england", createdAt: "2026-07-18" },
  { id: "r11", nodeId: "principle-workload", action: "Reinforce", rationale: "The same workload mechanism appeared across three closed pitcher props.", evidence: "The failed thesis overestimated innings after pitch-count stability went unverified.", source: "Pitcher-prop post-mortems", strength: "Strong", scope: "Sports Engine", confidence: 86, project: "sports", relatedNodeId: "precedent-pitcher-set", createdAt: "2026-07-20" },
  { id: "r12", nodeId: "precedent-pitcher-set", action: "Challenge", rationale: "The cases are reconstructed and should not substitute for current workload research.", evidence: "Today’s manager constraints and recent pitch counts remain time-sensitive.", source: "Research audit", strength: "Moderate", scope: "Sports Engine", confidence: 90, project: "sports", relatedNodeId: "principle-workload", createdAt: "2026-07-20" },
];

const initialConnections: Connection[] = [
  { id: "e1", from: "decision-england", to: "pattern-format", type: "Derived From", reason: "The candidate pattern was reconstructed from this outcome and its post-mortem.", approved: true },
  { id: "e2", from: "correction-total", to: "decision-england", type: "Revises", reason: "The correction changes which market assumptions are valid in the original case.", approved: true },
  { id: "e3", from: "pattern-format", to: "core-reality", type: "Supports", reason: "The outcome demonstrates why reality must be able to revise a blueprint.", approved: true },
  { id: "e4", from: "principle-fast", to: "pattern-overwork", type: "Shares Principle With", reason: "Both distinguish useful pace from indiscriminate effort.", approved: true },
  { id: "e5", from: "pattern-overwork", to: "principle-timeline", type: "Applies To", reason: "The timeline method reveals when more effort is creating recovery debt.", approved: true },
  { id: "e6", from: "principle-reconstruct", to: "core-reality", type: "Supports", reason: "Preserved reconstruction paths keep corrections traceable to their evidence.", approved: true },
  { id: "e7", from: "pattern-format", to: "decision-england", type: "Challenges", reason: "The pattern challenges the original use of a standard competition base rate.", approved: true },
  { id: "e8", from: "principle-timeline", to: "core-reality", type: "Shares Principle With", reason: "Both use evidence over isolated interpretation.", approved: true },
  { id: "e9", from: "precedent-pitcher-set", to: "principle-workload", type: "Supports", reason: "The closed case set earned the workload-verification principle while preserving the failed innings assumption.", approved: true },
  { id: "e10", from: "principle-workload", to: "core-reality", type: "Applies To", reason: "Current workload evidence must be able to override a projection built from generic matchup strength.", approved: true },
];

const actionDelta: Record<ReviewAction, number> = { Reinforce: 1, Challenge: -1, Revise: 0.25, "Narrow Scope": -0.15, Supersede: -1.2, Merge: 0.2, Retire: -2 };
const strengthValue = { Light: 4, Moderate: 7, Strong: 11 };

function projectFor(key: ProjectKey) { return projects.find((project) => project.key === key) ?? projects[0]; }
function fidelityFor(node: KnowledgeNode) { return node.sourceFidelity >= 90 ? "Exact" : node.sourceFidelity >= 72 ? "Reconstructed" : "Inferred"; }
function clamp(value: number) { return Math.max(5, Math.min(99, Math.round(value))); }
function confidenceFor(nodeId: string, events: ReviewEvent[]) {
  const relevant = events.filter((event) => event.nodeId === nodeId);
  const evidenceScore = relevant.reduce((total, event) => total + actionDelta[event.action] * strengthValue[event.strength] * (event.confidence / 100), 0);
  const sourceTrust = relevant.length ? relevant.reduce((total, event) => total + event.confidence, 0) / relevant.length : 50;
  return clamp(48 + evidenceScore + (sourceTrust - 50) * .22);
}
function metricsFor(nodeId: string, events: ReviewEvent[]) {
  const relevant = events.filter((event) => event.nodeId === nodeId);
  const supporting = relevant.filter((event) => ["Reinforce", "Revise", "Merge"].includes(event.action)).length;
  const challenging = relevant.filter((event) => ["Challenge", "Supersede", "Retire", "Narrow Scope"].includes(event.action)).length;
  const projectsCount = new Set(relevant.filter((event) => event.action === "Reinforce").map((event) => event.project)).size;
  const challenges = relevant.filter((event) => event.action === "Challenge").length;
  const resolutions = relevant.filter((event) => ["Revise", "Narrow Scope", "Supersede", "Retire"].includes(event.action)).length;
  return { supporting, challenging, projectsCount, unresolved: Math.max(0, challenges - resolutions) };
}

const sportsCapabilities = [
  { name: "Research-quality audits", rule: "Classify research state before confidence", evidence: "12 audited decisions", tested: "Thesis 001", limit: "Manual evidence entry", next: "Independent source coverage" },
  { name: "Probability + expected value", rule: "Separate likelihood from price", evidence: "8 priced theses", tested: "Pre-match review", limit: "No live odds feed", next: "Price-change receipts" },
  { name: "Lock Scores", rule: "Confidence + value after audit", evidence: "7 scored cases", tested: "Thesis 001", limit: "Calibration sample is small", next: "25 closed cases" },
  { name: "Explainable precedent retrieval", rule: "Return why each case is relevant", evidence: "Typed precedent paths", tested: "Format query", limit: "Seeded corpus", next: "More independent cases" },
  { name: "Outcome post-mortems", rule: "Grade outcome and process separately", evidence: "Reality-linked case", tested: "France 3–1 England", limit: "Manual outcome entry", next: "Repeated closed loops" },
  { name: "Confidence calibration", rule: "Scores derive from evidence events", evidence: "Support/challenge ledger", tested: "Knowledge Review", limit: "Early calibration", next: "Brier-style history" },
  { name: "Reusable principle promotion", rule: "Human approval after lineage review", evidence: "Golden demo principle", tested: "V2.2 judge loop", limit: "One mature proof", next: "Cross-case confirmation" },
];

export default function Home() {
  const [nodes, setNodes] = useState(initialNodes);
  const [reviews, setReviews] = useState(seedReviews);
  const [connections, setConnections] = useState(initialConnections);
  const [selectedId, setSelectedId] = useState("pattern-format");
  const [selectedEdgeId, setSelectedEdgeId] = useState("e1");
  const [edgeReceiptOpen, setEdgeReceiptOpen] = useState(false);
  const [project, setProject] = useState<ProjectKey | "all">("all");
  const [graphView, setGraphView] = useState<GraphView>("connections");
  const [query, setQuery] = useState("How should Sports Engine adjust research for unusual event formats?");
  const [packet, setPacket] = useState<PacketState>({ id: "PKT-0042", question: "", local: [], excludedIds: ["principle-fast"] });
  const [packetOpen, setPacketOpen] = useState(false);
  const [localFormOpen, setLocalFormOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPreview, setReviewPreview] = useState<ReviewEvent | null>(null);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [campusOpen, setCampusOpen] = useState(false);
  const [sportsOpen, setSportsOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Amy Campus");
  const [exampleMode, setExampleMode] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [proposalStates, setProposalStates] = useState<Record<string, "approved" | "rejected" | "pending">>({ p1: "pending", p2: "pending", p3: "pending" });
  const [proposalTypes, setProposalTypes] = useState<Record<string, EdgeType>>({ p1: "Derived From", p2: "Challenges", p3: "Constrained By" });
  const [aiReceipts, setAiReceipts] = useState<AIReceipt[]>([]);
  const [saveStatus, setSaveStatus] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [persistenceMode, setPersistenceMode] = useState<"hosted" | "device">("hosted");
  const [handoffTask, setHandoffTask] = useState("Research deGrom over 6.5 strikeouts without repeating past innings assumptions.");
  const [handoffProject, setHandoffProject] = useState("Sports Engine");
  const [handoffLocal, setHandoffLocal] = useState("");
  const [handoffResult, setHandoffResult] = useState<HandoffPacket | null>(null);
  const [handoffStatus, setHandoffStatus] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [manualCopyOpen, setManualCopyOpen] = useState(false);
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>("ask");

  useEffect(() => {
    let active = true;
    void fetch("/api/state").then((response) => response.ok ? response.json() : null).then((result) => {
      if (!active) return;
      let data = result?.state;
      if (result?.mode === "public_demo") {
        setPersistenceMode("device");
        try { data = JSON.parse(window.localStorage.getItem("campus-atlas-public-demo-v4") || "null"); } catch { data = null; }
      } else {
        setPersistenceMode("hosted");
      }
      if (!data) return;
      if (Array.isArray(data.nodes)) { const ids = new Set(data.nodes.map((item: KnowledgeNode) => item.id)); setNodes([...data.nodes, ...initialNodes.filter((item) => !ids.has(item.id))]); }
      if (Array.isArray(data.reviews)) { const ids = new Set(data.reviews.map((item: ReviewEvent) => item.id)); setReviews([...data.reviews, ...seedReviews.filter((item) => !ids.has(item.id))]); }
      if (Array.isArray(data.connections)) { const ids = new Set(data.connections.map((item: Connection) => item.id)); setConnections([...data.connections, ...initialConnections.filter((item) => !ids.has(item.id))]); }
      if (data.packet) setPacket(data.packet);
      if (data.workspaceName) setWorkspaceName(data.workspaceName);
      if (typeof data.exampleMode === "boolean") setExampleMode(data.exampleMode);
      if (Array.isArray(data.aiReceipts)) setAiReceipts(data.aiReceipts);
      if (Array.isArray(data.contextPackets) && data.contextPackets.length) setHandoffResult(data.contextPackets[data.contextPackets.length - 1]);
    }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      const state = { schemaVersion: 4, nodes, reviews, connections, packet, workspaceName, exampleMode, aiReceipts, contextPackets: handoffResult ? [handoffResult] : [] };
      if (persistenceMode === "device") {
        try { window.localStorage.setItem("campus-atlas-public-demo-v4", JSON.stringify(state)); setSaveStatus("saved"); } catch { setSaveStatus("error"); }
        return;
      }
      void fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state) })
        .then((response) => { if (!response.ok) throw new Error("save failed"); setSaveStatus("saved"); })
        .catch(() => setSaveStatus("error"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [hydrated, persistenceMode, nodes, reviews, connections, packet, workspaceName, exampleMode, aiReceipts, handoffResult]);

  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedConfidence = confidenceFor(selected.id, reviews);
  const selectedMetrics = metricsFor(selected.id, reviews);
  const visibleNodes = project === "all" ? nodes : nodes.filter((node) => node.project === project || node.project === "hq");
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleConnections = connections.filter((edge) => {
    if (!edge.approved || !visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return false;
    if (graphView === "lineage") return ["Derived From", "Revises", "Supersedes"].includes(edge.type);
    if (graphView === "challenges") return ["Challenges", "Constrained By"].includes(edge.type);
    if (graphView === "influence") {
      const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to);
      return Boolean(from && to && from.project !== to.project);
    }
    return true;
  });
  const selectedEdge = connections.find((edge) => edge.id === selectedEdgeId) ?? connections[0];
  const packetNodes = useMemo(() => {
    const words = (packet.question || query).toLowerCase().split(/\s+/).filter((word) => word.length > 3);
    return nodes.map((node) => {
      const text = `${node.title} ${node.summary} ${projectFor(node.project).label}`.toLowerCase();
      const direct = words.filter((word) => text.includes(word)).length * 12;
      const connected = connections.some((edge) => edge.approved && ((edge.from === selected.id && edge.to === node.id) || (edge.to === selected.id && edge.from === node.id))) ? 14 : 0;
      const reality = node.sources.some((source) => /outcome|correction|result|audit/i.test(source)) ? 10 : 0;
      return { node, score: clamp(node.reconstructionValue * .45 + confidenceFor(node.id, reviews) * .25 + direct + connected + reality), why: direct ? "Directly matches the active objective and preserves a useful reconstruction path." : connected ? "Included through an approved typed connection to the active node." : "Included for high reconstruction value and reality-linked evidence." };
    }).filter(({ node }) => node.status === "approved" && !packet.excludedIds.includes(node.id)).sort((a, b) => b.score - a.score).slice(0, 4);
  }, [nodes, reviews, connections, packet.question, packet.excludedIds, query, selected.id]);

  const promotionCandidates = nodes.filter((node) => node.level !== "Core Lens" && node.status !== "retired").sort((a, b) => b.reconstructionValue - a.reconstructionValue).slice(0, 4);
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };

  function focusSurface(surface: MobileSurface, target: string) {
    setMobileSurface(surface);
    window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }
  function openProject(key: ProjectKey) { if (key === "sports") { setSportsOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); } else { setProject(key); focusSurface("atlas", "atlas-workspace"); } }
  function openPacket(event?: FormEvent) { event?.preventDefault(); setHandoffTask(query || handoffTask); focusSurface("ask", "chatgpt-handoff"); }

  async function requestHandoff(task = handoffTask, projectName = handoffProject, localContext = handoffLocal) {
    if (task.trim().length < 8) return;
    setHandoffStatus("building");
    try {
      const response = await fetch("/api/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, project: projectName, localContext }) });
      if (!response.ok) throw new Error("packet failed");
      const result = await response.json() as HandoffPacket;
      setHandoffResult(result); setHandoffStatus("ready");
      setQuery(task); setPacket((current) => ({ ...current, question: task }));
      flash("ChatGPT handoff built with inspectable context");
    } catch {
      setHandoffStatus("error");
    }
  }

  function buildHandoff(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void requestHandoff(); }

  async function copyHandoff() {
    if (!handoffResult) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(handoffResult.compiledPrompt);
      copied = true;
    } catch {
      const field = document.createElement("textarea"); field.value = handoffResult.compiledPrompt; field.style.position = "fixed"; field.style.opacity = "0"; document.body.appendChild(field); field.select(); copied = document.execCommand("copy"); field.remove();
    }
    setManualCopyOpen(!copied);
    flash(copied ? "Compiled handoff copied for ChatGPT" : "Clipboard blocked—handoff opened for manual copy");
  }

  function addLocalContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const addition: LocalContext = { id: `local-${Date.now()}`, kind: String(data.get("kind")) as LocalKind, content: String(data.get("content")), source: String(data.get("source")), confidence: Number(data.get("confidence")), scope: String(data.get("scope")) as LocalContext["scope"], expires: String(data.get("expires") || "End of task"), promotion: String(data.get("promotion")) as LocalContext["promotion"], linkedNodeId: String(data.get("linkedNodeId") || "") };
    setPacket((current) => ({ ...current, local: [...current.local, addition] })); setLocalFormOpen(false); flash("Local context attached to this packet only"); event.currentTarget.reset();
  }

  function captureLocal(local: LocalContext) {
    if (local.captured) return;
    const node: KnowledgeNode = { id: `observation-${Date.now()}`, project: project === "all" ? "human" : project, room: "Candidate Inbox", type: "observation", title: local.content.slice(0, 62), summary: `${local.kind} captured from ${packet.id}. It remains an observation until reviewed.`, status: "proposed", level: "Observation", x: 18 + Math.round(Math.random() * 64), y: 20 + Math.round(Math.random() * 62), sources: [local.source, packet.id], lineage: [`Local context in ${packet.id}`, "Explicitly captured as candidate knowledge"], sourceFidelity: local.confidence, decisionImpact: 48, reconstructionValue: 55, scopeStability: 42, history: [{ id: `h-${Date.now()}`, date: "Now", label: "Candidate captured", detail: "User explicitly moved temporary packet context into the durable review queue." }] };
    setNodes((current) => [...current, node]);
    setPacket((current) => ({ ...current, local: current.local.map((item) => item.id === local.id ? { ...item, captured: true } : item) }));
    setSelectedId(node.id); flash("Candidate knowledge captured—promotion still requires review");
  }

  function buildReviewPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    setReviewPreview({ id: `review-${Date.now()}`, nodeId: selected.id, action: String(data.get("action")) as ReviewAction, rationale: String(data.get("rationale")), evidence: String(data.get("evidence")), source: String(data.get("source")), strength: String(data.get("strength")) as ReviewEvent["strength"], scope: String(data.get("scope")), confidence: Number(data.get("confidence")), project: String(data.get("project")) as ProjectKey, relatedNodeId: String(data.get("relatedNodeId") || selected.id), createdAt: new Date().toISOString() });
  }

  function applyReview() {
    if (!reviewPreview) return;
    setReviews((current) => [...current, reviewPreview]);
    setNodes((current) => current.map((node) => node.id === selected.id ? { ...node, status: reviewPreview.action === "Retire" ? "retired" : reviewPreview.action === "Challenge" ? "challenged" : node.status, history: [{ id: `h-${Date.now()}`, date: "Now", label: `${reviewPreview.action} review`, detail: `${reviewPreview.rationale} Evidence: ${reviewPreview.evidence}` }, ...node.history] } : node));
    const type: EdgeType = reviewPreview.action === "Challenge" ? "Challenges" : reviewPreview.action === "Revise" ? "Revises" : reviewPreview.action === "Supersede" ? "Supersedes" : reviewPreview.action === "Narrow Scope" ? "Constrained By" : "Supports";
    setConnections((current) => [...current, { id: `edge-${Date.now()}`, from: selected.id, to: reviewPreview.relatedNodeId, type, reason: reviewPreview.rationale, approved: true }]);
    setReviewOpen(false); setReviewPreview(null); flash("Review event preserved · ledger, history, and connection updated");
  }

  function approvePromotion(node: KnowledgeNode) {
    const index = levels.indexOf(node.level); const next = levels[Math.min(levels.length - 1, index + 1)];
    const approvedProposals = Object.entries(proposalStates).filter(([, state]) => state === "approved");
    const proposalTargets = ["decision-england", "core-reality", "principle-timeline"];
    const newEdges = approvedProposals.map(([id], idx) => ({ id: `promoted-${Date.now()}-${id}`, from: node.id, to: proposalTargets[idx] ?? "core-reality", type: proposalTypes[id], reason: "Connection approved during human promotion review.", approved: true } as Connection));
    setConnections((current) => [...current, ...newEdges]);
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, level: next, status: "approved", history: [{ id: `h-${Date.now()}`, date: "Now", label: `Promoted to ${next}`, detail: "Human approval recorded after lineage, evidence, counter-evidence, and connection review." }, ...item.history] } : item));
    setPromotionOpen(false); flash(`Human approval recorded · promoted to ${next}`);
  }

  function captureExperience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const key = String(data.get("project")) as ProjectKey;
    const node: KnowledgeNode = { id: `observation-${Date.now()}`, project: key, room: "Inbox", type: "observation", title: String(data.get("title")), summary: String(data.get("summary")), status: "inferred", level: "Observation", x: 15 + Math.round(Math.random() * 70), y: 15 + Math.round(Math.random() * 70), sources: [String(data.get("source") || "Direct capture")], lineage: ["Experience captured", "Structured as observation"], sourceFidelity: 60, decisionImpact: 45, reconstructionValue: 52, scopeStability: 40, history: [{ id: `h-${Date.now()}`, date: "Now", label: "Captured", detail: "No promotion authority granted." }] };
    setNodes((current) => [...current, node]); setSelectedId(node.id); setCaptureOpen(false); flash("Experience captured as an observation—not promoted");
  }

  function createCampus(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setWorkspaceName(String(data.get("campus"))); setExampleMode(false); setCampusOpen(false); flash("Campus created · first project blueprint ready"); }

  function resetDemo() {
    setNodes(initialNodes); setReviews(seedReviews); setConnections(initialConnections);
    setPacket({ id: "PKT-0042", question: "", local: [], excludedIds: ["principle-fast"] });
    setAiReceipts([]); setSelectedId("pattern-format"); setProject("all");
    flash("Judge demo reset to its seeded starting state");
  }

  if (sportsOpen) return <SportsEngine onBack={() => setSportsOpen(false)} onEvidence={() => { setSportsOpen(false); setSelectedId("pattern-format"); setProject("sports"); focusSurface("atlas", "atlas-workspace"); }} onPromotion={() => { setSportsOpen(false); setSelectedId("pattern-format"); setPromotionOpen(true); }} toast={toast} />;

  return (
    <main className={`app-shell mobile-${mobileSurface}`}>
      <header className="topbar">
        <a className="brand" href="#top" onClick={() => setMobileSurface("ask")}><span className="brand-mark">CA</span><span><strong>Campus Atlas</strong><small>Connected reasoning for ChatGPT Projects</small></span></a>
        <nav><button onClick={() => focusSurface("ask", "chatgpt-handoff")}>Ask Atlas</button><button onClick={() => focusSurface("review", "promotion-queue")}>Review Inbox</button><button onClick={() => focusSurface("atlas", "atlas-workspace")}>Explore Atlas</button><button onClick={() => openProject("sports")}>Sports Engine</button></nav>
        <div className="topbar-actions"><span className={`save-state ${saveStatus}`}>{saveStatus === "saved" ? persistenceMode === "device" ? "✓ Saved on device" : "✓ Saved" : saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Loading…"}</span><button className="primary-button" onClick={() => setCampusOpen(true)}>＋ Create your campus</button></div>
      </header>

      <nav className="mobile-dock" aria-label="Campus Atlas mobile workspace">
        <button className={mobileSurface === "ask" ? "active" : ""} aria-pressed={mobileSurface === "ask"} onClick={() => focusSurface("ask", "top")}><span>✦</span>Ask</button>
        <button className={mobileSurface === "projects" ? "active" : ""} aria-pressed={mobileSurface === "projects"} onClick={() => focusSurface("projects", "projects")}><span>▦</span>Projects</button>
        <button className={mobileSurface === "atlas" ? "active" : ""} aria-pressed={mobileSurface === "atlas"} onClick={() => focusSurface("atlas", "atlas-workspace")}><span>∞</span>Atlas</button>
        <button className={mobileSurface === "review" ? "active" : ""} aria-pressed={mobileSurface === "review"} onClick={() => focusSurface("review", "promotion-queue")}><span>✓</span>Review</button>
      </nav>

      <section className="product-intro" id="top">
        <div><p className="eyebrow">Durable reasoning infrastructure</p><h1>Your ChatGPT Projects should<br /><em>build on each other.</em></h1><p>ChatGPT helps you think now. Campus Atlas helps your projects build on what happened before—governing which decisions, corrections, and principles deserve to affect what happens next.</p></div>
        <div className="intro-actions"><button className="primary-button large judge-cta" onClick={() => focusSurface("ask", "chatgpt-handoff")}>Ask Atlas →</button><button className="text-cta" onClick={() => setDemoOpen(true)}>See the Learning Loop</button><small>Simple in conversation. Inspectable underneath.</small></div>
      </section>

      <section className="handoff-section" id="chatgpt-handoff">
        <div className="handoff-heading"><div><span className="example-chip">ChatGPT handoff · live V4 flow</span><h2>Ask normally. Atlas brings forward what your projects earned.</h2><p>Describe the next task. Campus Atlas loads the project blueprint, retrieves a small set of relevant precedents and corrections, and returns a concise handoff for ChatGPT.</p></div><div className="connector-state"><span className="live-dot" /><div><strong>Connector-ready</strong><small>6 governed tools · setup required in ChatGPT</small></div></div></div>
        <div className="handoff-grid">
          <form className="handoff-compose" onSubmit={buildHandoff}>
            <div className="compose-title"><span>01</span><div><strong>What are you working on?</strong><small>This should feel like starting a normal ChatGPT conversation.</small></div></div>
            <label>Project<select value={handoffProject} onChange={(event) => setHandoffProject(event.target.value)}><option>Sports Engine</option><option>Health + Training</option><option>Lessons Division</option><option>Human Systems Lab</option><option>Finance</option></select></label>
            <label>Task<textarea rows={4} value={handoffTask} onChange={(event) => setHandoffTask(event.target.value)} placeholder="Ask the question you would normally ask ChatGPT…" /></label>
            <details className="local-context-control"><summary>＋ Add what matters right now <span>optional · temporary</span></summary><label>Local Context<textarea rows={3} value={handoffLocal} onChange={(event) => setHandoffLocal(event.target.value)} placeholder="Current conditions, constraints, exclusions, or user instructions…" /></label><small>This stays inside this packet. It will not enter durable knowledge automatically.</small></details>
            <div className="quick-prompts"><span>Try one</span><button type="button" onClick={() => setHandoffTask("Research deGrom over 6.5 strikeouts. Verify workload stability before estimating probability.")}>Strikeout prop</button><button type="button" onClick={() => setHandoffTask("Evaluate a third-place match total without importing a standard knockout-round base rate.")}>Format risk</button></div>
            <button className="primary-button large wide" disabled={handoffStatus === "building" || handoffTask.trim().length < 8}>{handoffStatus === "building" ? "Building the smallest useful context…" : "Build ChatGPT handoff →"}</button>
            {handoffStatus === "error" && <div className="inline-error">The packet could not be built. Your task is still here—try again.</div>}
          </form>

          <div className={`handoff-output ${handoffResult ? "has-result" : ""}`}>
            {!handoffResult ? <><div className="output-placeholder"><span className="atlas-spark">✦</span><p className="eyebrow">What happens underneath</p><h3>One request. Three quiet steps.</h3></div><div className="handoff-steps"><article><span>1</span><div><strong>Load the blueprint</strong><p>Apply the rules and capabilities this project has earned.</p></div></article><article><span>2</span><div><strong>Retrieve with reasons</strong><p>Carry forward useful precedent, corrections, and active challenges.</p></div></article><article><span>3</span><div><strong>Compile the handoff</strong><p>Give ChatGPT only the smallest useful context—not the entire graph.</p></div></article></div><details className="connect-details"><summary>How this connects to ChatGPT <span>＋</span></summary><p>V4 exposes an HTTPS MCP endpoint at <code>/mcp</code> plus an OpenAPI fallback. Connect it in ChatGPT developer mode after the endpoint has connector access. Read tools retrieve context; write tools create review candidates; promotion stays inside Atlas.</p></details></> : <><div className="output-ready"><div><span className="ready-check">✓</span><div><p>Ready for ChatGPT</p><h3>{handoffResult.packetId}</h3></div></div><span>{handoffResult.budget.used}/{handoffResult.budget.limit} items · ~{handoffResult.budget.estimatedTokens} tokens</span></div><div className="blueprint-loaded"><span>Blueprint loaded</span><strong>{handoffResult.blueprint.project} {handoffResult.blueprint.version}</strong><p>{handoffResult.blueprint.rules[0]}</p></div><div className="retrieval-results"><div className="result-section-title"><span>Retrieved durable knowledge</span><b>{handoffResult.durableKnowledge.length} with reasons</b></div>{handoffResult.durableKnowledge.slice(0, 3).map((item) => <details key={item.id}><summary><span>{item.usefulness}</span><div><strong>{item.title}</strong><small>{item.fidelity} · {item.authorityLevel} · {item.confidence}% source confidence</small></div><i>⌄</i></summary><p>{item.whyIncluded}</p><small>Path: {item.connectionPath.join(" → ")}</small></details>)}</div>{handoffResult.challenges.length > 0 && <div className="carried-challenge"><span>Challenge carried forward</span><strong>{handoffResult.challenges[0].title}</strong><p>{handoffResult.challenges[0].reason}</p></div>}<div className="handoff-actions"><button className="primary-button" onClick={copyHandoff}>Copy for ChatGPT</button><button className="ghost-button" onClick={() => setPacketOpen(true)}>Inspect packet anatomy</button><button className="text-cta" onClick={() => focusSurface("atlas", "atlas-workspace")}>Trace it in Atlas</button></div>{manualCopyOpen && <div className="manual-copy"><span>Select and copy this handoff</span><textarea readOnly rows={7} value={handoffResult.compiledPrompt} onFocus={(event) => event.currentTarget.select()} /></div>}<details className="work-receipt"><summary>AI Work Receipt <span>{handoffResult.receipt.checks.length} checks passed</span></summary>{handoffResult.receipt.checks.map((check) => <p key={check}>✓ {check}</p>)}<small>{handoffResult.receipt.tool} · {handoffResult.receipt.id}</small></details></>}
          </div>
        </div>
      </section>

      <section className="home-loop" aria-label="Campus Atlas learning mechanism">
        {["Capture experience", "Connect precedent", "Test against reality", "Promote durable knowledge", "Return better context"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < 4 && <i>→</i>}</div>)}
        <p>Every promotion is earned through visible evidence, challenges, approvals, and connections—not a number increasing.</p>
      </section>

      <section className="demo-banner"><div><span className="example-chip">{persistenceMode === "device" ? "Public demo · device-local" : "Example workspace"}</span><strong>{workspaceName}</strong><p>{persistenceMode === "device" ? "Seeded demonstration knowledge only. Your interactions persist on this device without touching the private Campus Atlas workspace." : exampleMode ? "A polished campus showing how multiple projects connect—and how one project develops specialized capabilities." : "Your campus shell is ready. Amy Campus remains the reference example."}</p></div>{exampleMode ? <span className="explore-note">Explore the governed learning loop ↘</span> : <button onClick={() => { setWorkspaceName("Amy Campus"); setExampleMode(true); }}>Restore Amy Campus example</button>}</section>

      <section className="project-strip" id="projects"><div className="strip-heading"><div><p>Projects inside this campus</p><h2>Each project keeps its own blueprint and capabilities.</h2></div><span>{projects.length} projects · 16 rooms</span></div><div className="project-cards">{projects.filter((item) => item.key !== "hq").map((item) => <button key={item.key} className={`project-card ${item.key === "sports" ? "featured" : ""}`} onClick={() => openProject(item.key)} style={{ "--project-color": item.color } as React.CSSProperties}><span className="project-card-icon">{item.short}</span><span><small>{item.rooms} rooms · {item.capabilityCount} capabilities</small><strong>{item.label}</strong><p>{item.description}</p></span><i>{item.key === "sports" ? "Open flagship example →" : "View in Atlas →"}</i></button>)}</div></section>

      <section className="workspace" id="atlas-workspace">
        <aside className="room-panel panel"><div className="panel-heading"><div><p>Workspace</p><h2>{workspaceName}</h2><small>{exampleMode ? "Example campus" : "Personal campus"}</small></div><span className="castle">⌂</span></div><button className={`room-button ${project === "all" ? "active" : ""}`} onClick={() => setProject("all")}><span className="room-icon all">∞</span><span><strong>All projects</strong><small>Cross-project view</small></span><b>{nodes.length}</b></button><div className="room-list">{projects.map((item) => <button key={item.key} className={`room-button ${project === item.key ? "active" : ""}`} onClick={() => item.key === "sports" ? openProject(item.key) : setProject(item.key)}><span className="room-icon" style={{ "--room-color": item.color } as React.CSSProperties}>{item.short}</span><span><strong>{item.label}</strong><small>{item.rooms} rooms</small></span><b>{nodes.filter((node) => node.project === item.key).length}</b></button>)}</div><div className="governance-note"><span>Authority comes from lineage</span><p>Scores summarize preserved events. They never promote knowledge by themselves.</p></div></aside>

        <section className="graph-panel panel">
          <div className="graph-toolbar"><div><p>Knowledge Atlas</p><h2>{project === "all" ? "Cross-project reasoning" : projectFor(project).label}</h2></div><div className="graph-view-tabs">{([['connections','Connection View'],['lineage','Promotion Lineage'],['challenges','Challenge Map'],['influence','Cross-Project Influence']] as [GraphView,string][]).map(([key,label]) => <button className={graphView === key ? "active" : ""} onClick={() => setGraphView(key)} key={key}>{label}</button>)}</div></div>
          <div className={`graph-canvas view-${graphView}`}><div className="grid-glow" /><svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none">{visibleConnections.map((edge) => { const from = nodes.find((node) => node.id === edge.from)!; const to = nodes.find((node) => node.id === edge.to)!; return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`edge-${edge.type.toLowerCase().replaceAll(" ", "-")} ${selectedEdgeId === edge.id ? "selected-edge" : ""}`} onClick={() => setSelectedEdgeId(edge.id)} />; })}</svg>{visibleNodes.map((node) => { const itemProject = projectFor(node.project); const metrics = metricsFor(node.id, reviews); return <button key={node.id} className={`graph-node ${node.type} ${node.status} ${node.id === selected.id ? "selected" : ""} ${metrics.unresolved ? "has-challenge" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%`, "--node-color": itemProject.color } as React.CSSProperties} onClick={() => setSelectedId(node.id)}><span className="node-pulse" /><span className="node-core">{node.type === "core" ? "CA" : itemProject.short}</span><span className="node-label"><small>{node.level} · {node.status === "approved" ? "Human approved" : "Inferred"} · {fidelityFor(node)}</small><strong>{node.title}</strong></span>{metrics.unresolved > 0 && <b className="challenge-badge">!</b>}</button>; })}<div className="edge-explainer"><span>{selectedEdge.type}</span><p>{selectedEdge.reason}</p><button onClick={() => setEdgeReceiptOpen(true)}>Connection receipt →</button></div></div>
          <form className="retrieval-bar" onSubmit={openPacket}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Retrieval question" /><button>Build context packet →</button></form>
        </section>

        <aside className="inspector panel"><div className="inspector-top"><div className="type-chip" style={{ "--node-color": projectFor(selected.project).color } as React.CSSProperties}>{selected.level}</div><span className={`authority-chip ${selected.status}`}>{selected.status === "approved" ? "✓ Human approved" : selected.status}</span></div><p className="room-name">{projectFor(selected.project).label} · {selected.room}</p><h2>{selected.title}</h2><p className="node-summary">{selected.summary}</p><div className="confidence-block"><div><span>Computed confidence</span><strong>{selectedConfidence}%</strong></div><div className="confidence-track"><i style={{ width: `${selectedConfidence}%` }} /></div><small>Derived from {reviews.filter((event) => event.nodeId === selected.id).length} preserved review events—not directly editable.</small></div><div className="ledger-grid"><div><strong>{selectedMetrics.supporting}</strong><span>Support</span></div><div><strong>{selectedMetrics.challenging}</strong><span>Challenge</span></div><div><strong>{selectedMetrics.projectsCount}</strong><span>Projects</span></div><div className={selectedMetrics.unresolved ? "warn" : ""}><strong>{selectedMetrics.unresolved}</strong><span>Unresolved</span></div></div><div className="mini-metrics"><span>Scope stability <b>{selected.scopeStability}</b></span><span>Source fidelity <b>{selected.sourceFidelity}</b></span><span>Confidence trend <b>{selectedMetrics.challenging ? "Review" : "Stable ↑"}</b></span></div><div className="lineage-preview"><div className="section-label"><span>Lineage</span><b>{selected.lineage.length} stages</b></div>{selected.lineage.slice(-3).map((item, index) => <p key={item}><i>{index + 1}</i>{item}</p>)}</div><div className="inspector-actions"><button className="primary-button" onClick={() => { setReviewPreview(null); setReviewOpen(true); }}>Open Knowledge Review</button><button onClick={() => setPromotionOpen(true)}>Inspect promotion eligibility →</button></div></aside>
      </section>

      <section className="promotion-section" id="promotion-queue"><div className="promotion-heading"><div><p className="eyebrow">Review Inbox · governed promotion</p><h2>Decide what deserves future influence.</h2><p>Every candidate arrives with supporting cases, challenges, scope, lineage, and a clear blocker. Review the receipt—never raise a number directly.</p></div><div className="promotion-hierarchy">{levels.map((level, index) => <span key={level}><b>{index + 1}</b>{level}{index < levels.length - 1 && <i>→</i>}</span>)}</div></div><div className="queue-grid">{promotionCandidates.map((node) => { const metrics = metricsFor(node.id, reviews); const eligible = metrics.supporting >= 1 && metrics.unresolved === 0 && node.sourceFidelity >= 70; return <article key={node.id} className={node.id === "pattern-format" ? "featured-candidate" : ""}><div className="candidate-top"><span>{node.level}</span><b className={eligible ? "eligible" : "blocked"}>{eligible ? "Eligible" : "Blocked"}</b></div><h3>{node.title}</h3><div className="candidate-metrics"><span><b>{metrics.supporting}</b> supporting cases</span><span><b>{metrics.challenging}</b> challenging cases</span><span><b>{metrics.projectsCount}</b> independent projects</span><span><b>{confidenceFor(node.id, reviews)}%</b> computed confidence</span><span><b>{node.sourceFidelity}</b> source fidelity</span><span><b>{node.decisionImpact}</b> decision impact</span><span><b>{node.reconstructionValue}</b> reconstruction value</span><span><b>{metrics.unresolved}</b> contradictions</span></div><div className={`eligibility-note ${eligible ? "ready" : "hold"}`}><strong>{eligible ? "Why eligible" : "What blocks promotion"}</strong><p>{eligible ? "Evidence is traceable, scope is stable enough, and no active contradiction remains." : metrics.unresolved ? "Resolve the active challenge and add an independent comparison case." : "Needs stronger support or source fidelity before review."}</p></div><button onClick={() => { setSelectedId(node.id); setPromotionOpen(true); }}>Review complete lineage →</button></article>; })}</div></section>

      <section className="platform-layer"><div className="loop-intro"><p className="eyebrow">The general Campus Atlas layer</p><h2>Capture → Structure → Connect → Test → Promote → Retrieve</h2><p>Sports Engine proves what one mature project can become. The governed learning architecture belongs to every project.</p></div><div className="platform-grid">{[["Local Context","Task-specific additions stay inside their packet until explicitly captured."],["Evidence events","Support and challenge are preserved reviews, never score buttons."],["Support ledgers","Confidence is computed from traceable events and independent confirmation."],["Promotion lineage","Every durable principle can reconstruct the cases that earned its authority."],["Connection review","Typed post-promotion edges are individually approved, rejected, or edited."],["Challenge maps","Contradictions stay visible instead of being averaged away."],["Human governance","The system proposes. A person decides what becomes durable."],["Project blueprints","Specialized capabilities emerge locally without hardcoding the whole platform."]].map(([title,copy],index) => <article key={title}><span>{String(index + 1).padStart(2,"0")}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

      {packetOpen && <PacketModal packet={packet} setPacket={setPacket} packetNodes={packetNodes} nodes={nodes} reviews={reviews} query={query} onClose={() => setPacketOpen(false)} localFormOpen={localFormOpen} setLocalFormOpen={setLocalFormOpen} addLocalContext={addLocalContext} captureLocal={captureLocal} flash={flash} />}
      {reviewOpen && <ReviewModal selected={selected} nodes={nodes} preview={reviewPreview} onPreview={buildReviewPreview} onApply={applyReview} onClose={() => { setReviewOpen(false); setReviewPreview(null); }} reviews={reviews} />}
      {promotionOpen && <PromotionModal node={selected} reviews={reviews} nodes={nodes} proposalStates={proposalStates} setProposalStates={setProposalStates} proposalTypes={proposalTypes} setProposalTypes={setProposalTypes} onApprove={() => approvePromotion(selected)} onClose={() => setPromotionOpen(false)} />}
      {captureOpen && <CaptureModal onSubmit={captureExperience} onClose={() => setCaptureOpen(false)} />}
      {campusOpen && <CampusModal onSubmit={createCampus} onClose={() => setCampusOpen(false)} />}
      {demoOpen && <GuidedDemo nodes={nodes} setNodes={setNodes} reviews={reviews} setReviews={setReviews} setConnections={setConnections} receipts={aiReceipts} setReceipts={setAiReceipts} onClose={() => setDemoOpen(false)} onReset={resetDemo} flash={flash} />}
      {edgeReceiptOpen && <ConnectionReceipt edge={selectedEdge} nodes={nodes} onClose={() => setEdgeReceiptOpen(false)} />}
      <button className="floating-capture" onClick={() => setCaptureOpen(true)}>＋ Capture experience</button>{toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}

function PacketModal({ packet, setPacket, packetNodes, nodes, reviews, query, onClose, localFormOpen, setLocalFormOpen, addLocalContext, captureLocal, flash }: { packet: PacketState; setPacket: React.Dispatch<React.SetStateAction<PacketState>>; packetNodes: { node: KnowledgeNode; score: number; why: string }[]; nodes: KnowledgeNode[]; reviews: ReviewEvent[]; query: string; onClose: () => void; localFormOpen: boolean; setLocalFormOpen: (open: boolean) => void; addLocalContext: (event: FormEvent<HTMLFormElement>) => void; captureLocal: (item: LocalContext) => void; flash: (message: string) => void }) {
  const conflicts = packetNodes.filter(({ node }) => metricsFor(node.id, reviews).unresolved > 0);
  const excluded = nodes.filter((node) => packet.excludedIds.includes(node.id) || node.status !== "approved");
  const estimatedTokens = 180 + packet.local.length * 55 + packetNodes.length * 115 + conflicts.length * 45;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="packet-modal v21-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Context Packet Builder · {packet.id}</p><h2>Compile the smallest useful context</h2><small>Local additions stay attached to this packet. Nothing becomes durable without an explicit capture.</small></div><div className="packet-header-actions"><span>{packetNodes.length} / 6 slots · ~{estimatedTokens} tokens</span><button onClick={onClose}>×</button></div></div><div className="packet-question"><span>Current objective or question</span><strong>{packet.question || query}</strong></div><div className="packet-columns">
    <section><div className="packet-section-head"><span>A</span><div><strong>Local Context</strong><small>Situation-specific · not durable</small></div><button onClick={() => setLocalFormOpen(!localFormOpen)}>＋ Add</button></div>{localFormOpen && <form className="local-form" onSubmit={addLocalContext}><div className="form-row"><label>Type<select name="kind">{localKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Scope<select name="scope"><option>This packet</option><option>This project</option><option>Entire campus</option></select></label></div><label>Local addition<textarea name="content" required rows={2} placeholder="What matters for this task right now?" /></label><div className="form-row"><label>Source<input name="source" required placeholder="User, live condition, brief…" /></label><label>Confidence<input name="confidence" type="number" min="1" max="100" defaultValue="75" /></label></div><div className="form-row"><label>Freshness / expiration<input name="expires" defaultValue="End of task" /></label><label>Durability<select name="promotion"><option>Temporary</option><option>Eligible for later promotion</option></select></label></div><label>Optional Atlas connection<select name="linkedNodeId"><option value="">No connection</option>{nodes.map((node) => <option value={node.id} key={node.id}>{node.title}</option>)}</select></label><button className="primary-button">Attach to packet</button></form>}{packet.local.length === 0 ? <div className="empty-context"><strong>No local context yet</strong><p>Add constraints, assumptions, current conditions, exclusions, or missing information.</p></div> : packet.local.map((item) => <article className="local-item" key={item.id}><div><span>{item.kind}</span><b>{item.scope}</b></div><p>{item.content}</p><small>{item.source} · {item.confidence}% · expires {item.expires}</small>{item.promotion === "Eligible for later promotion" && <button disabled={item.captured} onClick={() => captureLocal(item)}>{item.captured ? "✓ Captured as candidate" : "Capture as Candidate Knowledge"}</button>}</article>)}</section>
    <section><div className="packet-section-head"><span>B</span><div><strong>Retrieved Durable Knowledge</strong><small>Every inclusion explained</small></div></div>{packetNodes.map(({ node, score, why }) => <article className="retrieved-item" key={node.id}><div><span>{node.level}</span><b>{score} utility</b></div><h3>{node.title}</h3><p>{why}</p><div className="packet-item-meta"><span>Source <b>{node.sources[0]}</b></span><span>Confidence <b>{confidenceFor(node.id, reviews)}%</b></span><span>Scope <b>{projectFor(node.project).label}</b></span><span>Freshness <b>{node.history[0]?.date ?? "Preserved"}</b></span><span>Fidelity <b>{fidelityFor(node)}</b></span><span>Path <b>{node.lineage.slice(-2).join(" → ")}</b></span></div><button onClick={() => setPacket((current) => ({ ...current, excludedIds: [...current.excludedIds, node.id] }))}>Exclude from packet</button></article>)}</section>
    <section><div className="packet-section-head"><span>C</span><div><strong>Conflicts and Challenges</strong><small>Never silently averaged away</small></div></div>{conflicts.length ? conflicts.map(({ node }) => <article className="conflict-item" key={node.id}><span>Active contradiction</span><h3>{node.title}</h3><p>{metricsFor(node.id, reviews).unresolved} unresolved challenge must travel with the claim.</p></article>) : <div className="empty-context"><strong>No active conflicts</strong><p>Included knowledge has no unresolved contradiction.</p></div>}<div className="packet-section-head subsection"><span>D</span><div><strong>Excluded Context</strong><small>Omissions remain inspectable</small></div></div>{excluded.map((node) => { const governed = node.status !== "approved"; return <article className="excluded-item" key={node.id}><div><strong>{node.title}</strong><small>{governed ? `Excluded by governance: ${node.status} knowledge requires approval` : "Explicitly excluded as low-scope or redundant"}</small></div><button disabled={governed} onClick={() => setPacket((current) => ({ ...current, excludedIds: current.excludedIds.filter((id) => id !== node.id) }))}>{governed ? "Requires approval" : "Restore"}</button></article>; })}</section>
  </div><section className="compiled-packet"><div className="packet-section-head"><span>E</span><div><strong>Final Compiled Packet</strong><small>Local + durable + conflicts + exclusions</small></div><button onClick={() => { setPacket((current) => ({ ...current, compiledAt: new Date().toISOString() })); flash("Final packet compiled and preserved"); }}>Compile packet</button></div><div className="compiled-summary"><span><b>{packet.local.length}</b> local additions</span><span><b>{packetNodes.length}</b> durable nodes</span><span><b>{conflicts.length}</b> conflicts</span><span><b>{excluded.length}</b> exclusions</span><span><b>{packet.compiledAt ? "Ready" : "Draft"}</b> status</span></div>{packet.compiledAt && <button className="primary-button" onClick={() => { onClose(); flash("Compiled packet preserved and ready to use"); }}>Close and return to Atlas →</button>}</section></section></div>;
}

function ReviewModal({ selected, nodes, preview, onPreview, onApply, onClose, reviews }: { selected: KnowledgeNode; nodes: KnowledgeNode[]; preview: ReviewEvent | null; onPreview: (event: FormEvent<HTMLFormElement>) => void; onApply: () => void; onClose: () => void; reviews: ReviewEvent[] }) {
  const before = confidenceFor(selected.id, reviews); const after = preview ? confidenceFor(selected.id, [...reviews, preview]) : before;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="review-modal v21-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Knowledge Review · preserved evidence event</p><h2>{selected.title}</h2><small>You cannot directly change a score. Record what happened and why.</small></div><button onClick={onClose}>×</button></div><form className="review-form" onSubmit={onPreview}><div className="form-row three"><label>Review action<select name="action">{reviewActions.map((action) => <option key={action}>{action}</option>)}</select></label><label>Strength of impact<select name="strength"><option>Light</option><option>Moderate</option><option>Strong</option></select></label><label>Confidence<input name="confidence" type="number" min="1" max="100" defaultValue="80" /></label></div><label>Rationale<textarea name="rationale" required rows={2} placeholder="Why should this event change how the knowledge is treated?" /></label><label>Supporting or contradicting evidence<textarea name="evidence" required rows={3} placeholder="Preserve the experience, case, result, or counter-example…" /></label><div className="form-row"><label>Source<input name="source" required placeholder="Outcome, experiment, document, user correction…" /></label><label>Scope affected<select name="scope"><option>This claim only</option><option>This project</option><option>Cross-project</option><option>Entire campus</option></select></label></div><div className="form-row"><label>Related project<select name="project">{projects.map((project) => <option value={project.key} key={project.key}>{project.label}</option>)}</select></label><label>Related node / principle<select name="relatedNodeId">{nodes.filter((node) => node.id !== selected.id).map((node) => <option value={node.id} key={node.id}>{node.title}</option>)}</select></label></div><button className="primary-button">Preview review →</button></form>{preview && <section className="review-preview"><div className="preview-heading"><span>Application preview</span><b>No changes applied yet</b></div><div className="preview-grid"><article><span>Computed score</span><strong>{before}% → {after}%</strong><small>Derived consequence, not the reason</small></article><article><span>Status may change</span><strong>{preview.action === "Challenge" ? "Active challenge" : preview.action === "Retire" ? "Retired" : "History updated"}</strong><small>Based on review action</small></article><article><span>Typed connection</span><strong>{preview.action === "Challenge" ? "Challenges" : preview.action === "Revise" ? "Revises" : "Supports"}</strong><small>To the selected related node</small></article><article><span>Promotion eligibility</span><strong>{preview.action === "Challenge" ? "Blocked" : "Recalculated"}</strong><small>Human approval still required</small></article></div><div className="event-chain"><span>Applying creates</span><b>1 feedback event</b><i>→</i><b>1 typed connection</b><i>→</i><b>ledger update</b><i>→</i><b>history entry</b></div><button className="primary-button" onClick={onApply}>Apply and preserve review</button></section>}</section></div>;
}

function PromotionModal({ node, reviews, nodes, proposalStates, setProposalStates, proposalTypes, setProposalTypes, onApprove, onClose }: { node: KnowledgeNode; reviews: ReviewEvent[]; nodes: KnowledgeNode[]; proposalStates: Record<string, "approved" | "rejected" | "pending">; setProposalStates: React.Dispatch<React.SetStateAction<Record<string, "approved" | "rejected" | "pending">>>; proposalTypes: Record<string, EdgeType>; setProposalTypes: React.Dispatch<React.SetStateAction<Record<string, EdgeType>>>; onApprove: () => void; onClose: () => void }) {
  const events = reviews.filter((event) => event.nodeId === node.id); const metrics = metricsFor(node.id, reviews); const eligible = metrics.supporting >= 1 && metrics.unresolved === 0 && node.sourceFidelity >= 70; const next = levels[Math.min(levels.length - 1, levels.indexOf(node.level) + 1)];
  const proposals = [{ id: "p1", target: "decision-england", reason: "Original decision and outcome produced this candidate." }, { id: "p2", target: "core-reality", reason: "The candidate operationalizes reality-based blueprint correction." }, { id: "p3", target: "principle-timeline", reason: "Format effects remain constrained by the time horizon and event conditions." }];
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="promotion-modal v21-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Promotion candidate · {node.level}</p><h2>{node.title}</h2><small>Proposed destination: {next}. Promotion changes authority, not just display.</small></div><button onClick={onClose}>×</button></div><div className="promotion-modal-grid"><section><h3>Complete lineage</h3><div className="lineage-timeline">{node.lineage.map((item, index) => <article key={item}><span>{index + 1}</span><div><strong>{item}</strong><small>{index === node.lineage.length - 1 ? "Current candidate state" : "Preserved origin stage"}</small></div></article>)}</div><h3>Evidence and counter-evidence</h3><div className="event-list">{events.length ? events.map((event) => <article key={event.id} className={event.action === "Challenge" ? "challenge" : "support"}><span>{event.action}</span><div><strong>{event.evidence}</strong><p>{event.rationale}</p><small>{event.source} · {projectFor(event.project).label} · {event.strength}</small></div></article>) : <div className="empty-context">No formal review events yet.</div>}</div><h3>Earlier versions and history</h3>{node.history.map((entry) => <div className="history-row" key={entry.id}><span>{entry.date}</span><strong>{entry.label}</strong><p>{entry.detail}</p></div>)}</section><section><div className={`promotion-decision ${eligible ? "ready" : "blocked"}`}><span>{eligible ? "Eligible for human decision" : "Promotion blocked"}</span><strong>{node.level} → {next}</strong><p>{eligible ? "Evidence threshold is met. The final authority decision remains yours." : metrics.unresolved ? `${metrics.unresolved} unresolved contradiction must be addressed before promotion.` : "Add an evidence review with traceable support before promotion."}</p></div><h3>Proposed typed connections</h3><p className="section-copy">Approve, reject, or edit each edge. A promoted principle never enters the Atlas isolated.</p><div className="proposal-list">{proposals.map((proposal) => { const target = nodes.find((item) => item.id === proposal.target); const state = proposalStates[proposal.id]; return <article key={proposal.id} className={state}><div><select value={proposalTypes[proposal.id]} onChange={(event) => setProposalTypes((current) => ({ ...current, [proposal.id]: event.target.value as EdgeType }))}>{edgeTypes.map((type) => <option key={type}>{type}</option>)}</select><span>→ {target?.title}</span></div><p>{proposal.reason}</p><div><button className={state === "approved" ? "active approve" : ""} onClick={() => setProposalStates((current) => ({ ...current, [proposal.id]: "approved" }))}>✓ Approve</button><button className={state === "rejected" ? "active reject" : ""} onClick={() => setProposalStates((current) => ({ ...current, [proposal.id]: "rejected" }))}>× Reject</button></div></article>; })}</div><div className="traceability-rule"><span>Constitutional guarantee</span><p>After promotion, this principle remains traceable to every observation, review, correction, and case that produced it. Reinforcement adds evidence here; it does not create a duplicate node.</p></div><button className="primary-button wide" disabled={!eligible} onClick={onApprove}>Approve promotion to {next}</button></section></div></section></div>;
}

function ConnectionReceipt({ edge, nodes, onClose }: { edge: Connection; nodes: KnowledgeNode[]; onClose: () => void }) {
  const from = nodes.find((node) => node.id === edge.from); const to = nodes.find((node) => node.id === edge.to);
  const confidence = from && to ? Math.round((from.sourceFidelity + to.sourceFidelity) / 2) : 70;
  const crossProject = Boolean(from && to && from.project !== to.project);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="connection-receipt" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Connection Receipt · {edge.id}</p><h2>{edge.type}</h2><small>A relationship is inspectable evidence—not a decorative line.</small></div><button onClick={onClose}>×</button></div><div className="receipt-nodes"><article><span>From</span><strong>{from?.title}</strong><small>{from ? `${projectFor(from.project).label} · ${fidelityFor(from)}` : "Unknown source"}</small></article><i>→</i><article><span>To</span><strong>{to?.title}</strong><small>{to ? `${projectFor(to.project).label} · ${fidelityFor(to)}` : "Unknown target"}</small></article></div><div className="receipt-facts"><article><span>Why it exists</span><p>{edge.reason}</p></article><article><span>Supporting evidence</span><p>{from?.sources.join(" · ") || "Connection review event"}</p></article><article><span>Scope</span><p>{crossProject ? "Cross-project influence" : `${from ? projectFor(from.project).label : "Project"} only`}</p></article><article><span>Confidence</span><p>{confidence}% · derived from source fidelity</p></article><article><span>Proposed by</span><p>{edge.inferred ? "Campus Atlas inference" : "Governed workflow"}</p></article><article><span>Approved by</span><p>{edge.approved ? "Human-approved" : "Pending human review"}</p></article></div><div className="receipt-history"><span>Revision history</span><p><b>Created</b>Typed relationship preserved with its rationale.</p><p><b>Current</b>{edge.approved ? "Active in retrieval and graph explanation." : "Excluded from retrieval until approved."}</p></div><button className="primary-button wide" onClick={onClose}>Close receipt</button></section></div>;
}

function GuidedDemo({ nodes, setNodes, reviews, setReviews, setConnections, receipts, setReceipts, onClose, onReset, flash }: {
  nodes: KnowledgeNode[]; setNodes: React.Dispatch<React.SetStateAction<KnowledgeNode[]>>;
  reviews: ReviewEvent[]; setReviews: React.Dispatch<React.SetStateAction<ReviewEvent[]>>;
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>;
  receipts: AIReceipt[]; setReceipts: React.Dispatch<React.SetStateAction<AIReceipt[]>>;
  onClose: () => void; onReset: () => void; flash: (message: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [thesis, setThesis] = useState("England +1.5 and Under 4.5 should hold because France is stronger, but England can keep the match competitive and the game should stay controlled.");
  const [structured, setStructured] = useState<StructuredCapture | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<AIReceipt | null>(receipts[0] ?? null);
  const pattern = nodes.find((node) => node.id === "pattern-format") ?? initialNodes.find((node) => node.id === "pattern-format")!;
  const patternMetrics = metricsFor("pattern-format", reviews);
  const promoted = pattern.level === "Validated Principle" || pattern.level === "Whiteboard Method" || pattern.level === "Core Lens";
  const outcomeRecorded = nodes.some((node) => node.id === "demo-outcome");
  const reviewApplied = reviews.some((event) => event.id === "demo-format-review");
  const steps = ["Capture", "Context before", "Reality", "Knowledge Review", "Promote", "Context after"];

  async function structureThesis() {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/structure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: thesis, project: "Sports Engine", operation: "Structure forecasting thesis" }) });
      if (!response.ok) throw new Error("The proposal service could not complete this request.");
      const result = await response.json() as { proposal: StructuredCapture; receipt: AIReceipt };
      setStructured(result.proposal); setReceipt(result.receipt); setReceipts((current) => [result.receipt, ...current.filter((item) => item.id !== result.receipt.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to structure this capture."); }
    finally { setWorking(false); }
  }

  function approveCapture() {
    if (!structured) return;
    if (!nodes.some((node) => node.id === "demo-thesis")) {
      const node: KnowledgeNode = { id: "demo-thesis", project: "sports", room: "Decision Lab", type: "decision", title: structured.claim.slice(0, 70), summary: structured.claim, status: "approved", level: "Observation", x: 21, y: 39, sources: [structured.source], lineage: ["Natural-language thesis", `${receipt?.model ?? "Model"} structured proposal`, "Deterministic schema checks passed", "Human approved observation"], sourceFidelity: structured.fidelity === "Exact" ? 96 : structured.fidelity === "Reconstructed" ? 78 : 62, decisionImpact: 62, reconstructionValue: 70, scopeStability: 54, history: [{ id: "demo-capture-history", date: "Now", label: "Capture approved", detail: "The model proposed structure; deterministic checks ran; the user approved durable storage." }] };
      setNodes((current) => [...current, node]);
    }
    if (receipt) setReceipts((current) => current.map((item) => item.id === receipt.id ? { ...item, approved: ["Structured knowledge object", "Sports Engine scope", "Observation authority"], rejected: ["Automatic promotion", "Unverified outcome"] } : item));
    flash("Structured capture approved as an Observation"); setStep(1);
  }

  function recordOutcome() {
    if (!outcomeRecorded) {
      const outcome: KnowledgeNode = { id: "demo-outcome", project: "sports", room: "Outcome Lab", type: "correction", title: "France 3–1 England · expected control failed", summary: "The match exceeded the expected controlled game script. The result was wrong, and the format-variance assumption deserves explicit review.", status: "approved", level: "Observation", x: 25, y: 53, sources: ["Final result", "Outcome post-mortem"], lineage: ["Final result recorded", "Prediction graded separately from process", "Failed assumption isolated"], sourceFidelity: 98, decisionImpact: 88, reconstructionValue: 91, scopeStability: 74, history: [{ id: "demo-outcome-history", date: "Now", label: "Reality attached", detail: "Result and reasoning process were graded separately." }] };
      setNodes((current) => [...current, outcome]);
      setReviews((current) => [...current, { id: "demo-outcome-event", nodeId: "decision-england", action: "Challenge", rationale: "The controlled-match assumption failed in reality.", evidence: "France won 3–1 and the total reached four despite the expected low-variance script.", source: "Final result + post-mortem", strength: "Strong", scope: "This claim only", confidence: 98, project: "sports", relatedNodeId: "demo-outcome", createdAt: new Date().toISOString() }]);
      setConnections((current) => [...current, { id: "demo-outcome-edge", from: "demo-outcome", to: "decision-england", type: "Challenges", reason: "The final result contradicts the original controlled-match assumption.", approved: true }]);
    }
    flash("Reality event preserved without silently changing authority"); setStep(3);
  }

  function applyKnowledgeReview() {
    if (!reviewApplied) {
      setReviews((current) => [...current, { id: "demo-format-review", nodeId: "pattern-format", action: "Revise", rationale: "Narrow the lesson to unusual event formats instead of assuming every knockout match behaves the same.", evidence: "The third-place match combined rotation, motivation uncertainty, and a more open scoring environment.", source: "Thesis 001 post-mortem", strength: "Strong", scope: "Sports Engine", confidence: 88, project: "sports", relatedNodeId: "decision-england", createdAt: new Date().toISOString() }]);
      setConnections((current) => [...current, { id: "demo-review-edge", from: "pattern-format", to: "decision-england", type: "Constrained By", reason: "The reusable lesson is limited to formats with distinct motivation, rotation, or variance conditions.", approved: true }]);
      setNodes((current) => current.map((node) => node.id === "pattern-format" ? { ...node, status: "proposed", history: [{ id: "demo-review-history", date: "Now", label: "Scope revised", detail: "A preserved review resolved the broad-scope challenge and created a typed constraint." }, ...node.history] } : node));
    }
    flash("Review event, typed edge, ledger update, and history preserved"); setStep(4);
  }

  function approveDemoPromotion() {
    setNodes((current) => current.map((node) => node.id === "pattern-format" ? { ...node, status: "approved", level: "Validated Principle", lineage: [...node.lineage, "Scope revised after challenge", "Human-approved Validated Principle"], history: [{ id: "demo-promotion-history", date: "Now", label: "Promoted to Validated Principle", detail: "Human approval granted after the challenge was resolved and connection proposals were reviewed." }, ...node.history] } : node));
    const additions: Connection[] = [
      { id: "demo-promoted-derived", from: "decision-england", to: "pattern-format", type: "Derived From", reason: "The principle remains reconstructable from the original case and outcome.", approved: true },
      { id: "demo-promoted-applies", from: "pattern-format", to: "core-reality", type: "Applies To", reason: "The promoted principle operationalizes reality-led blueprint correction inside Sports Engine.", approved: true },
    ];
    setConnections((current) => [...current.filter((edge) => !additions.some((item) => item.id === edge.id)), ...additions]);
    flash("Human approval recorded · future retrieval authority granted"); setStep(5);
  }

  function resetAndClose() { onReset(); setStep(0); setStructured(null); setReceipt(null); setError(""); }

  return <div className="modal-backdrop demo-backdrop"><section className="guided-demo" onMouseDown={(event) => event.stopPropagation()}>
    <header className="demo-header"><div><span className="example-chip">Guided judge demo · Sports Engine</span><h2>See the Learning Loop</h2><p>One case. Real state changes. Roughly 90 seconds.</p></div><div><button className="ghost-button" onClick={resetAndClose}>↻ Reset Demo</button><button className="demo-close" onClick={onClose}>×</button></div></header>
    <nav className="demo-steps">{steps.map((label, index) => <button key={label} className={`${step === index ? "active" : ""} ${step > index ? "complete" : ""}`} onClick={() => index <= step && setStep(index)}><span>{step > index ? "✓" : index + 1}</span><strong>{label}</strong></button>)}</nav>
    <div className="demo-body">
      {step === 0 && <section className="demo-stage capture-stage"><div className="stage-copy"><p className="eyebrow">01 · Capture and structure</p><h3>Turn a natural-language thesis into an inspectable object.</h3><p>The model proposes structure. Deterministic rules validate the schema. You decide whether it becomes durable.</p><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} rows={5} /><button className="primary-button" disabled={working || thesis.trim().length < 20} onClick={structureThesis}>{working ? "Structuring…" : "Structure with GPT-5.6 →"}</button>{error && <div className="inline-error">{error}</div>}</div><div className="structured-proposal">{structured ? <><div className="proposal-title"><div><span>{structured.truthClass} · {structured.fidelity}</span><strong>Structured proposal</strong></div><b>{structured.confidence}% confidence</b></div><h4>{structured.claim}</h4><div className="proposal-fields"><article><span>Evidence</span>{structured.evidence.map((item) => <p key={item}>＋ {item}</p>)}</article><article><span>Counter-evidence</span>{structured.counterEvidence.map((item) => <p key={item}>− {item}</p>)}</article><article><span>Assumptions</span>{structured.assumptions.map((item) => <p key={item}>◇ {item}</p>)}</article><article><span>Missing</span>{structured.missingInformation.map((item) => <p key={item}>? {item}</p>)}</article></div><div className="proposal-meta"><span>Source <b>{structured.source}</b></span><span>Scope <b>{structured.scope}</b></span><span>Project <b>{structured.projectOfOrigin}</b></span></div><button className="primary-button wide" onClick={approveCapture}>Approve as durable Observation</button></> : <div className="empty-proposal"><span>✦</span><strong>Awaiting model proposal</strong><p>No knowledge is stored until the proposed structure is reviewed and approved.</p></div>}</div></section>}

      {step === 1 && <section className="demo-stage"><div className="stage-heading"><div><p className="eyebrow">02 · Context before promotion</p><h3>Build the smallest useful packet.</h3></div><span className="packet-budget">3 / 5 knowledge slots · 612 estimated tokens</span></div><div className="packet-proof before"><div className="packet-label"><span>BEFORE</span><strong>Future question: How should we research another unusual-format match?</strong></div><div className="packet-proof-grid"><article><span>Local Context</span><p><b>Objective:</b> Evaluate a related market without assuming the prior conclusion.</p><p><b>Constraint:</b> Current lineups are not final.</p><small>Temporary · expires after task</small></article><article><span>Retrieved Durable Knowledge</span><p><b>Reality corrects the model</b></p><p><b>Market options were overstated</b></p><small>Included through approved evidence paths</small></article><article><span>Excluded / blocked</span><p><b>Event format can break the base rate</b></p><small>Candidate only · unresolved challenge · no retrieval authority</small></article></div></div><div className="demo-next"><p>The candidate exists, but it cannot influence future work yet.</p><button className="primary-button" onClick={() => setStep(2)}>Test the thesis against reality →</button></div></section>}

      {step === 2 && <section className="demo-stage reality-stage"><div className="stage-heading"><div><p className="eyebrow">03 · Reality becomes evidence</p><h3>The bet lost. Now grade the result and the reasoning separately.</h3></div><span className="loss-chip">France 3–1 England</span></div><div className="reality-grid"><article><span>Was the prediction correct?</span><strong className="bad">No</strong><p>The combined market did not cash.</p></article><article><span>Was the process sound?</span><strong className="mixed">Partially</strong><p>Risks were named, but format variance was underweighted.</p></article><article><span>Assumption that failed</span><strong>Controlled match</strong><p>The scoring environment became more open than expected.</p></article><article><span>Reusable candidate</span><strong>Format adjustment</strong><p>Motivation and rotation may change the base rate.</p></article></div><div className="receipt-preview"><span>Applying this outcome creates</span><b>1 reality node</b><i>→</i><b>1 challenge event</b><i>→</i><b>1 typed edge</b><i>→</i><b>history</b></div><div className="demo-next"><p>Reality records evidence. It does not silently move a score.</p><button className="primary-button" onClick={recordOutcome}>{outcomeRecorded ? "Continue to Knowledge Review →" : "Record outcome and post-mortem →"}</button></div></section>}

      {step === 3 && <section className="demo-stage review-stage"><div className="stage-heading"><div><p className="eyebrow">04 · Knowledge Review</p><h3>Resolve the challenge by narrowing the lesson.</h3></div><span className="authority-summary">Authority comes from the receipt</span></div><div className="review-proof"><article><span>Target</span><strong>Event format can break the base rate</strong><p>Candidate Pattern · Sports Engine</p></article><article><span>Action</span><strong>Revise + Narrow Scope</strong><p>Apply only when motivation, rotation, or format conditions materially differ.</p></article><article><span>Evidence</span><strong>Thesis 001 post-mortem</strong><p>The 3–1 result exposed an underweighted format mechanism.</p></article></div><div className="application-preview"><div><span>Preserved event</span><strong>Revision review</strong></div><i>→</i><div><span>Typed connection</span><strong>Constrained By</strong></div><i>→</i><div><span>Ledger</span><strong>{patternMetrics.unresolved} unresolved → 0</strong></div><i>→</i><div><span>Promotion</span><strong>Becomes eligible</strong></div></div><div className="demo-next"><p>No direct score control exists. The review event produces every downstream change.</p><button className="primary-button" onClick={applyKnowledgeReview}>{reviewApplied ? "Continue to promotion →" : "Apply and preserve review →"}</button></div></section>}

      {step === 4 && <section className="demo-stage promote-stage"><div className="stage-heading"><div><p className="eyebrow">05 · Human-governed promotion</p><h3>Grant retrieval authority only after inspecting the lineage.</h3></div><span className="eligible-badge">Eligible for human decision</span></div><div className="promotion-proof"><div className="lineage-rail">{["Original thesis", "Final result", "Post-mortem", "Challenge", "Scope revision", "Human approval"].map((item, index) => <div key={item} className={index < 5 ? "complete" : "pending"}><span>{index < 5 ? "✓" : index + 1}</span><strong>{item}</strong></div>)}</div><div className="earned-authority"><h4>Earned Authority</h4><div><span>Supporting cases <b>{metricsFor("pattern-format", reviews).supporting}</b></span><span>Challenging cases <b>{metricsFor("pattern-format", reviews).challenging}</b></span><span>Source fidelity <b>{pattern.sourceFidelity}</b></span><span>Decision impact <b>{pattern.decisionImpact}</b></span><span>Unresolved contradictions <b>{metricsFor("pattern-format", reviews).unresolved}</b></span><span>Human approvals <b>{promoted ? 1 : 0}</b></span></div><p>Proposed typed connections: <b>Derived From</b> the original decision and <b>Applies To</b> reality-led blueprint correction.</p></div></div><div className="demo-next"><p>Promotion changes what future packets are allowed to retrieve.</p><button className="primary-button" disabled={metricsFor("pattern-format", reviews).unresolved > 0} onClick={approveDemoPromotion}>{promoted ? "Show future influence →" : "Approve as Validated Principle →"}</button></div></section>}

      {step === 5 && <section className="demo-stage after-stage"><div className="stage-heading"><div><p className="eyebrow">06 · Prove future influence</p><h3>The architecture changed the next packet—not merely a score.</h3></div><span className="verified-impact">✓ Inspectable influence</span></div><div className="packet-comparison"><article><div className="packet-label"><span>BEFORE</span><strong>Candidate excluded</strong></div><p>Reality corrects the model</p><p>Market correction</p><p className="excluded-line">Event-format lesson excluded</p></article><div className="comparison-arrow">→</div><article className="after"><div className="packet-label"><span>AFTER</span><strong>New because of promotion</strong></div><p>Reality corrects the model</p><p>Market correction</p><p className="new-line">＋ Event format can break the base rate</p><small>Carried forward with its scope constraint and challenge history.</small></article></div><div className="influence-receipt"><div><span>Why included</span><strong>Human-approved Validated Principle</strong></div><div><span>Connection path</span><strong>Future question → unusual format → promoted principle</strong></div><div><span>Exact lineage</span><strong>Thesis → result → post-mortem → review → approval</strong></div></div><div className="demo-finish"><div><span className="pulse-node">SE</span><p><strong>The node now pulses through the Atlas.</strong> Its typed connections, challenges, approval, and downstream retrieval remain inspectable.</p></div><button className="primary-button" onClick={() => { onClose(); document.getElementById("atlas-workspace")?.scrollIntoView({ behavior: "smooth" }); }}>Open changed Atlas →</button></div></section>}
    </div>
    {receipt && <details className="ai-receipt"><summary><span>AI Work Receipt</span><strong>{receipt.mode === "live_gpt" ? "GPT-5.6 live proposal" : "Seeded demo proposal"}</strong><i>⌄</i></summary><div><article><span>Model proposed</span><p>{receipt.operation}</p><small>{receipt.model} · {receipt.proposedAt}</small></article><article><span>Deterministic checks</span>{receipt.checks.map((item) => <p key={item}>✓ {item}</p>)}</article><article><span>Human decision</span><p>Approved: {receipt.approved.join(", ") || "Pending"}</p><p>Rejected: {receipt.rejected.join(", ") || "Pending"}</p></article></div></details>}
  </section></div>;
}

function CaptureModal({ onSubmit, onClose }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><form className="capture-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Capture · start of the learning loop</p><h2>Structure an experience</h2></div><button type="button" onClick={onClose}>×</button></div><label>Project<select name="project">{projects.filter((item) => item.key !== "hq").map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>What happened?<input name="title" required /></label><label>Why might it matter?<textarea name="summary" required rows={4} /></label><label>Source<input name="source" required placeholder="Conversation, result, observation…" /></label><div className="capture-rule"><span>i</span><p>This begins as an observation. It gains authority only through evidence, challenges, connections, and human promotion.</p></div><button className="primary-button wide">Capture observation →</button></form></div>; }

function CampusModal({ onSubmit, onClose }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><form className="capture-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Start with your structure</p><h2>Create your knowledge campus</h2></div><button type="button" onClick={onClose}>×</button></div><label>Campus name<input name="campus" required defaultValue="Cody Campus" /></label><label>First project<input name="firstProject" required placeholder="Research, school, training, work…" /></label><div className="starter-steps"><div><span>1</span><p><strong>Capture</strong>Begin with specific experiences.</p></div><div><span>2</span><p><strong>Test</strong>Preserve support and challenge.</p></div><div><span>3</span><p><strong>Promote</strong>Approve earned authority.</p></div></div><button className="primary-button wide">Create campus →</button></form></div>; }

function SportsEngine({ onBack, onEvidence, onPromotion, toast }: { onBack: () => void; onEvidence: () => void; onPromotion: () => void; toast: string }) { return <main className="app-shell sports-shell"><header className="topbar"><button className="brand brand-button" onClick={onBack}><span className="brand-mark">CA</span><span><strong>Campus Atlas</strong><small>Connected reasoning for ChatGPT Projects</small></span></button><span className="breadcrumb">Amy Campus / <strong>Sports Engine</strong></span><button className="ghost-button" onClick={onBack}>← Back to Atlas</button></header><section className="project-hero"><div><p className="eyebrow"><span className="live-dot" /> Flagship example · project-specific capability layer</p><div className="project-title-row"><span className="project-emblem">SE</span><h1>Sports Engine</h1></div><p>One project that has grown beyond a folder of conversations. Its blueprint turns research, decisions, corrections, and outcomes into specialized reasoning capabilities.</p></div><div className="project-health"><span>Blueprint maturity</span><strong>Stage 4</strong><div><i /></div><small>Reality-linked · 12 audited decisions</small></div></section><section className="sports-grid"><article className="sports-panel blueprint-panel"><div className="sports-panel-head"><div><p>Project blueprint</p><h2>How this project reasons</h2></div><span className="project-only">Sports Engine only</span></div><div className="blueprint-flow">{["Research","Audit","Price","Decide","Outcome","Promote"].map((step,index)=><div key={step}><span>0{index+1}</span><strong>{step}</strong>{index<5&&<i>→</i>}</div>)}</div><div className="blueprint-rule"><span>Constitutional rule</span><p>No Lock Score before research quality is classified. No promoted principle without outcome evidence and human review.</p></div></article><article className="sports-panel"><div className="sports-panel-head"><div><p>Decision case · closed</p><h2>England +1.5 & Under 4.5</h2></div><span className="loss-chip">Lost · 3–1</span></div><div className="decision-metrics"><div><span>Research</span><strong className="amber">Partial</strong></div><div><span>Probability</span><strong>68%</strong></div><div><span>Lock Score</span><strong>6.1</strong></div><div><span>Outcome</span><strong className="red">Lost</strong></div></div><div className="postmortem"><span>Outcome-based update</span><p>The thesis underweighted third-place format variance. A reusable lesson is proposed—not automatically promoted.</p><button onClick={onEvidence}>Open evidence chain →</button></div></article><article className="sports-panel capability-panel"><div className="sports-panel-head"><div><p>Capability Ledger</p><h2>What this project has earned</h2></div><b>7</b></div><div className="capability-ledger">{sportsCapabilities.map((cap,index)=><details key={cap.name} open={index===4}><summary><span>{index+1}</span><strong>{cap.name}</strong><i>Tested</i></summary><div><p><b>Blueprint rule</b>{cap.rule}</p><p><b>Evidence</b>{cap.evidence}</p><p><b>Last tested</b>{cap.tested}</p><p><b>Current limitation</b>{cap.limit}</p><p><b>Next improvement</b>{cap.next}</p></div></details>)}</div></article><article className="sports-panel precedent-panel"><div className="sports-panel-head"><div><p>Explainable precedent</p><h2>Why this case returned</h2></div><span className="utility-score">84 utility</span></div><div className="precedent-card"><span className="precedent-icon">↗</span><div><small>Format variance</small><strong>Knockout consolation matches</strong><p>Included for shared motivation uncertainty, rotation risk, and total-goals sensitivity.</p></div></div><button className="ghost-button" onClick={onPromotion}>Inspect proposed principle →</button></article></section><section className="boundary-callout"><div><p className="eyebrow">The architecture boundary</p><h2>Platform underneath. Project intelligence on top.</h2></div><div className="boundary-columns"><div><span>Campus Atlas provides</span><p>Typed nodes · sources · reviews · lineage · context packets · promotion governance</p></div><div><span>Sports Engine adds</span><p>Research audits · EV · Lock Scores · precedents · post-mortems · calibration</p></div></div></section>{toast&&<div className="toast">✓ {toast}</div>}</main>; }
