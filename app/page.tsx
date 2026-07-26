"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  ActivityRecord,
  AtlasState,
  BlueprintRule,
  CaseRecord,
  EvidenceRecord,
  GovernanceState,
  KnowledgeRecord,
  PacketRecord,
  ProjectKey,
  ReviewRecord,
  apiNodesFromState,
  makeSeedState,
  projectByKey,
  projects,
} from "./v46-data";

type GlobalView = "home" | "projects" | "project" | "review" | "atlas" | "integration";
type ProjectTab = "work" | "evidence" | "blueprint" | "activity";
type GraphMode = "connections" | "lineage" | "challenges" | "cross" | "transfer";
type CaptureType = "New case or experience" | "Research" | "Evidence" | "Outcome" | "Correction" | "Challenge" | "Observation" | "Proposed connection";
type Receipt = { title: string; location: string; previousState: string; newState: string; retrieval: string; api: string; next: string; pathway?: string };

const workflowStages = ["Captured", "Outcome recorded", "Audited", "Lesson proposed", "Awaiting review", "Approved", "Retrieval eligible"];
const captureTypes: CaptureType[] = ["New case or experience", "Research", "Evidence", "Outcome", "Correction", "Challenge", "Observation", "Proposed connection"];
const globalDestinations: Array<{ id: GlobalView; label: string; icon: string }> = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "projects", label: "Projects", icon: "▦" },
  { id: "review", label: "Review", icon: "✓" },
  { id: "atlas", label: "Atlas", icon: "⌁" },
];

function nowLabel() {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date());
}

function statusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z]+/g, "-");
}

function projectName(key: ProjectKey | "campus") {
  return key === "campus" ? "Amy Campus" : projectByKey(key).name;
}

function recordTitle(state: AtlasState, id: string) {
  return state.cases.find((item) => item.id === id)?.title
    || state.evidence.find((item) => item.id === id)?.content
    || state.knowledge.find((item) => item.id === id)?.title
    || state.blueprintRules.find((item) => item.id === id)?.content
    || state.contextPackets.find((item) => item.packetId === id)?.task
    || id;
}

function normalizeState(next: AtlasState): AtlasState {
  return { ...next, schemaVersion: 46, nodes: apiNodesFromState(next.cases, next.evidence, next.knowledge) };
}

function packetResponse(packet: PacketRecord) {
  const principle = packet.approvedPrinciples?.find((item) => item.id === "knowledge-signal-separation");
  const adapted = packet.approvedPrinciples?.find((item) => item.id === "knowledge-hockey-effort-control");
  if (principle) return "Treat favorite strength, territorial control, scoring probability, and handicap coverage as separate claims. Test each one against the matchup, market, and defensive-wall risk before combining them into a position.";
  if (adapted) return "Separate effort from control and expected outcome. Pressure when the route can create possession, force a useful error, or preserve support; otherwise recover early enough to influence the next play.";
  return `Start with the active ${packet.blueprint.project} Blueprint: ${packet.blueprint.rules[0] || "classify the work before assigning confidence"} Then verify current facts and carry forward the listed challenges without granting authority to pending proposals.`;
}

export default function CampusAtlas() {
  const [state, setState] = useState<AtlasState>(() => makeSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [view, setView] = useState<GlobalView>("home");
  const [activeProject, setActiveProject] = useState<ProjectKey>("sports");
  const [projectTab, setProjectTab] = useState<ProjectTab>("work");
  const [selectedCaseId, setSelectedCaseId] = useState("case-england-ghana");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("ev-england-outcome");
  const [selectedReviewId, setSelectedReviewId] = useState("review-signal");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureType, setCaptureType] = useState<CaptureType>("New case or experience");
  const [captureTarget, setCaptureTarget] = useState("case-england-ghana");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [toast, setToast] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [reviewEdit, setReviewEdit] = useState<ReviewRecord | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("lineage");
  const [selectedConnectionId, setSelectedConnectionId] = useState("cx-outcome-case");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState("case-england-ghana");
  const [askQuestion, setAskQuestion] = useState("How should Sports Engine evaluate a heavy favorite against a possible defensive wall?");
  const [askLocal, setAskLocal] = useState("");
  const [askConstraints, setAskConstraints] = useState("Distinguish facts, estimates, assumptions, and unknowns.");
  const [askBudget, setAskBudget] = useState(700);
  const [askScope, setAskScope] = useState<"project" | "transfers" | "campus">("project");
  const [askStatus, setAskStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [askPacket, setAskPacket] = useState<PacketRecord | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [evidenceType, setEvidenceType] = useState("All records");
  const [evidenceRole, setEvidenceRole] = useState("All roles");

  useEffect(() => {
    let current = true;
    fetch("/api/state").then(async (response) => response.ok ? await response.json() as { workspaceId?: string; state?: AtlasState } : null).then((result) => {
      if (!current) return;
      const workspaceId = typeof result?.workspaceId === "string" ? result.workspaceId : "";
      if (result?.state?.schemaVersion === 46) setState(normalizeState({ ...result.state, workspaceId } as AtlasState));
      else setState(makeSeedState(workspaceId));
    }).catch(() => setState(makeSeedState())).finally(() => {
      if (current) { setHydrated(true); setSaveState("saved"); }
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      fetch("/api/state?replace=true", {
        method: "POST",
        headers: { "content-type": "application/json", ...(state.workspaceId ? { "x-atlas-workspace": state.workspaceId } : {}) },
        body: JSON.stringify(state),
      }).then(async (response) => {
        if (!response.ok) throw new Error("save failed");
        const result = await response.json() as { workspaceId?: string };
        const workspaceId = result.workspaceId;
        if (workspaceId && workspaceId !== state.workspaceId) setState((current) => ({ ...current, workspaceId }));
        setSaveState("saved");
      }).catch(() => setSaveState("error"));
    }, 420);
    return () => window.clearTimeout(timer);
  }, [hydrated, state]);

  const project = projectByKey(activeProject);
  const projectCases = state.cases.filter((item) => item.project === activeProject);
  const projectEvidence = state.evidence.filter((item) => item.project === activeProject);
  const projectKnowledge = state.knowledge.filter((item) => item.project === activeProject);
  const projectRules = state.blueprintRules.filter((item) => item.project === activeProject);
  const projectReviews = state.reviews.filter((item) => item.status === "Pending" && (item.project === activeProject || (item.project === "campus" && item.targetProject === activeProject)));
  const projectActivities = state.activities.filter((item) => item.project === activeProject);
  const selectedCase = state.cases.find((item) => item.id === selectedCaseId && item.project === activeProject) || projectCases[0] || null;
  const selectedEvidence = state.evidence.find((item) => item.id === selectedEvidenceId && item.project === activeProject) || projectEvidence[0] || null;

  function changeState(updater: (current: AtlasState) => AtlasState) {
    setState((current) => normalizeState(updater(current)));
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function navigate(next: GlobalView) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openProject(key: ProjectKey, tab: ProjectTab = "work") {
    setActiveProject(key);
    setProjectTab(tab);
    const firstCase = state.cases.find((item) => item.project === key);
    const firstEvidence = state.evidence.find((item) => item.project === key);
    setSelectedCaseId(firstCase?.id || "");
    setSelectedEvidenceId(firstEvidence?.id || "");
    setSelectedGraphNodeId(firstCase?.id || firstEvidence?.id || "");
    setAskPacket(null);
    setView("project");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openAsk(key = activeProject) {
    setActiveProject(key);
    const definition = projectByKey(key);
    if (key === "sports") setAskQuestion("How should Sports Engine evaluate a heavy favorite against a possible defensive wall?");
    else if (key === "hockey") setAskQuestion("How should I decide when to pressure an unwinnable puck versus recover into support?");
    else setAskQuestion(`What approved context should ${definition.name} use for the next decision?`);
    setAskPacket(null);
    setView("atlas");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function syncSnapshot(snapshot = state) {
    const response = await fetch("/api/state?replace=true", {
      method: "POST",
      headers: { "content-type": "application/json", ...(snapshot.workspaceId ? { "x-atlas-workspace": snapshot.workspaceId } : {}) },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error("sync failed");
    return response.json();
  }

  async function requestPacket(question: string, key: ProjectKey, localContext = "", scope = askScope, budget = askBudget) {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: { "content-type": "application/json", ...(state.workspaceId ? { "x-atlas-workspace": state.workspaceId } : {}) },
      body: JSON.stringify({ task: question, project: projectByKey(key).name, localContext, constraints: askConstraints, tokenBudget: budget, retrievalScope: scope, workspaceId: state.workspaceId }),
    });
    if (!response.ok) throw new Error("packet failed");
    return response.json() as Promise<PacketRecord>;
  }

  async function buildAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (askQuestion.trim().length < 8) return;
    setAskStatus("loading");
    try {
      await syncSnapshot();
      const packet = await requestPacket(askQuestion, activeProject, askLocal);
      setAskPacket(packet);
      changeState((current) => ({ ...current, contextPackets: [...current.contextPackets, packet].slice(-8) }));
      setAskStatus("ready");
      notify("Context built from the active project with an inspectable receipt");
    } catch {
      setAskStatus("error");
    }
  }

  async function resolveReview(review: ReviewRecord, action: "Approve" | "Challenge" | "Reject" | "Defer" | "Connect" | "Merge" | "Supersede" | "Retire", editedProposal?: string) {
    if (review.id === "review-blueprint-signal" && action === "Approve") {
      const approved = state.knowledge.find((item) => item.id === "knowledge-signal-separation")?.status === "Approved";
      if (!approved) { notify("Approve the underlying knowledge before authorizing a Blueprint revision"); return; }
    }
    if (review.id === "review-transfer-effort" && action === "Approve") {
      const sourceApproved = state.knowledge.find((item) => item.id === "knowledge-signal-separation")?.status === "Approved";
      if (!sourceApproved) { notify("Approve the source Sports Engine principle before adapting it into Hockey Development"); return; }
    }
    let baseline: PacketRecord | null = null;
    if (review.id === "review-signal" && action === "Approve") {
      try {
        await syncSnapshot();
        baseline = await requestPacket("How should Sports Engine evaluate a heavy favorite against a possible defensive wall?", "sports", "", "project", 700);
      } catch { baseline = null; }
    }
    const timestamp = nowLabel();
    changeState((current) => {
      const next = { ...current };
      const terminal = action === "Approve" || action === "Connect" || action === "Merge" ? "Approved" : action === "Challenge" ? "Challenged" : action === "Reject" ? "Rejected" : "Deferred";
      next.reviews = current.reviews.map((item) => item.id === review.id ? { ...item, proposal: editedProposal || item.proposal, status: terminal } : item);
      if (review.id === "review-signal") {
        const approved = action === "Approve" || action === "Merge";
        next.knowledge = current.knowledge.map((item) => item.id === "knowledge-signal-separation" ? { ...item, content: editedProposal || item.content, status: approved ? "Approved" : terminal as GovernanceState, retrievalEligible: approved, humanApproval: approved ? `Approved ${timestamp} by Cody` : item.humanApproval, revisionHistory: [`${action} decision recorded ${timestamp}.`, ...item.revisionHistory] } : item);
        next.evidence = current.evidence.map((item) => item.id === "ev-england-audit" ? { ...item, approvalState: approved ? "Approved" : terminal as GovernanceState, retrievalEligible: approved } : item);
        next.cases = current.cases.map((item) => item.id === "case-england-ghana" ? { ...item, state: approved ? "Approved" : "Awaiting review", governanceState: approved ? "Approved" : terminal as GovernanceState, retrievalEligible: approved, metadata: { ...item.metadata, "Governance state": approved ? "Approved" : terminal } } : item);
        if (approved) next.reviews = next.reviews.map((item) => item.id === "review-blueprint-signal" ? { ...item, status: "Pending" } : item);
      }
      if (review.id === "review-blueprint-signal" && action === "Approve") {
        next.blueprintRules = current.blueprintRules.map((item) => item.id === "bp-sports-signal-proposed" ? { ...item, status: "Active", version: "V4.6.1", lastRevision: timestamp, approvalHistory: [`Approved ${timestamp} by Cody.`, ...item.approvalHistory], retrievalEffect: "Structures relevant Sports Engine soccer research and appears in the active Blueprint." } : item);
      }
      if (review.id === "review-transfer-effort" && action === "Approve") {
        const adapted: KnowledgeRecord = { id: "knowledge-hockey-effort-control", project: "hockey", type: "Adapted transfer", title: "Separate effort, control, and expected outcome", content: editedProposal || "Before committing maximum effort, separate effort level, likelihood of control, and the expected value of the next action.", status: "Approved", scope: "Hockey Development decisions about puck pressure, recovery, and support", confidence: 76, humanApproval: `Approved ${timestamp} by Cody`, supportingCaseIds: ["case-unwinnable-pucks"], evidenceIds: ["ev-hockey-reflection", "ev-england-audit"], challengingEvidenceIds: ["ev-hockey-challenge", "ev-cape-challenge"], revisionHistory: ["Adapted locally from a Sports Engine mechanism; source principle unchanged."], retrievalHistory: [], retrievalEligible: true, metadata: { "Skill dial": "Decision speed", Mechanism: "Effort-control-outcome separation", Origin: "Approved cross-project adaptation", "Governance state": "Approved" } };
        next.knowledge = current.knowledge.some((item) => item.id === adapted.id) ? current.knowledge.map((item) => item.id === adapted.id ? adapted : item) : [...current.knowledge, adapted];
        next.connections = current.connections.map((item) => item.id === "cx-transfer-hockey" ? { ...item, approvalState: "Approved", downstreamConsequence: "Created adapted Hockey Development knowledge; Sports Engine source remained unchanged." } : item);
      }
      if (review.id === "review-weak-keyword" && action === "Reject") next.connections = current.connections.map((item) => item.id === "cx-weak-coverage" ? { ...item, approvalState: "Rejected", downstreamConsequence: "Excluded because keyword similarity did not establish a mechanism." } : item);
      if ((action === "Retire" || action === "Supersede") && review.affectedKnowledgeId) next.knowledge = next.knowledge.map((item) => item.id === review.affectedKnowledgeId && item.status === "Approved" ? { ...item, status: "Retired", retrievalEligible: false, revisionHistory: [`${action} decision recorded ${timestamp}.`, ...item.revisionHistory] } : item);
      next.proofBaseline = baseline || current.proofBaseline;
      const activity: ActivityRecord = { id: `activity-${Date.now()}`, project: review.project, actor: "Cody", action: `${action} review decision`, targetId: review.id, targetTitle: review.title, timestamp, previousState: "Pending", newState: terminal, consequence: review.retrievalEffect };
      next.activities = [activity, ...current.activities];
      return next;
    });
    setReviewEdit(null);
    setReceipt({ title: `${action}: ${review.title}`, location: `${projectName(review.project)} → Review`, previousState: review.status, newState: action === "Approve" ? "Approved" : action, retrieval: review.retrievalEffect, api: "Canonical browser and API-visible state updated.", next: review.id === "review-signal" && action === "Approve" ? "Open Ask Atlas and run the same heavy-favorite question." : review.id === "review-transfer-effort" && action === "Approve" ? "Ask inside Hockey Development with approved transfers enabled." : "Inspect the affected record and its lineage." });
    notify(`${action} decision recorded across the case, ledger, activity, retrieval, and API state`);
  }

  function saveCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const type = String(data.get("type")) as CaptureType;
    const content = String(data.get("content") || "").trim();
    const localContext = String(data.get("localContext") || "").trim();
    const source = String(data.get("source") || "Direct user capture").trim();
    const targetId = String(data.get("targetId") || captureTarget);
    const timestamp = nowLabel();
    if (!content) return;
    let createdId = "";
    let location = `${project.name} → Evidence`;
    let previousState = "No record";
    let newState = "Captured";
    let nextAction = "Inspect the record and add an outcome when reality is available.";
    changeState((current) => {
      const next = { ...current };
      if (type === "New case or experience") {
        createdId = `case-${Date.now()}`;
        const record: CaseRecord = { id: createdId, project: activeProject, origin: "User-created", title: content.slice(0, 72), createdAt: timestamp, state: "Captured", confidence: 60, outcomeState: "Pending", governanceState: "Draft", retrievalEligible: false, experience: content, task: content, localContext, thesis: "Awaiting research audit.", facts: [], estimates: [], assumptions: [], unknowns: [], counterarguments: [], fragility: "Not yet audited", completeness: 20, outcome: "", postmortem: { happened: "", failed: "", held: "", underweighted: "", change: "", evidence: [] }, metadata: Object.fromEntries(project.schema.slice(0, 4).map((field) => [field, "Unclassified"])) };
        const evidence: EvidenceRecord = { id: `evidence-${Date.now()}`, project: activeProject, caseId: createdId, recordType: "Capture", content, source, fidelity: "Exact", confidence: 90, role: "Context", creator: "Cody", timestamp, approvalState: "Draft", retrievalEligible: false, metadata: { Origin: "User capture" } };
        next.cases = [record, ...current.cases]; next.evidence = [evidence, ...current.evidence];
        setSelectedCaseId(createdId); location = `${project.name} → Work → ${record.title}`;
      } else if (type === "Outcome") {
        createdId = `evidence-${Date.now()}`; previousState = "Needs outcome"; newState = "Needs audit"; nextAction = "Complete the research audit and review the failed assumptions.";
        next.cases = current.cases.map((item) => item.id === targetId ? { ...item, outcome: content, outcomeState: "Recorded", state: "Needs audit", governanceState: "Challenged" } : item);
        next.evidence = [{ id: createdId, project: activeProject, caseId: targetId, recordType: "Outcome", content, source, fidelity: "Exact", confidence: 96, role: "Contradicts", creator: "Cody", timestamp, approvalState: "Approved", retrievalEligible: true, metadata: { "Outcome status": "Recorded" } }, ...current.evidence];
      } else if (type === "Proposed connection") {
        createdId = `connection-${Date.now()}`; location = `${project.name} → Connections`; newState = "Pending review"; nextAction = "Open Review to govern the suggested relationship.";
        const target = current.cases.find((item) => item.id === targetId)?.proposedKnowledgeId || current.knowledge.find((item) => item.project === activeProject)?.id || targetId;
        next.connections = [{ id: createdId, project: activeProject, sourceId: targetId, targetId: target, type: "Shares mechanism with", explanation: content, sharedMechanism: localContext || "User-proposed mechanism", evidenceIds: [], confidence: 60, creator: "Cody", approvalState: "Pending", downstreamConsequence: "No effect until review.", reconstructionValue: 55, domainLimitations: "Awaiting review." }, ...current.connections];
        next.reviews = [{ id: `review-${Date.now()}`, project: activeProject, type: "Connection", title: `Review connection: ${content.slice(0, 48)}`, proposal: content, why: localContext || "User proposed this relationship.", sourceCaseId: targetId, supportEvidenceIds: [], challengeEvidenceIds: [], blueprintEffect: "None unless separately authorized.", confidence: 60, retrievalEffect: "No effect before approval.", crossProjectConsequence: "None.", status: "Pending" }, ...current.reviews];
      } else {
        const recordType = type as EvidenceRecord["recordType"];
        createdId = `evidence-${Date.now()}`;
        const role: EvidenceRecord["role"] = type === "Challenge" ? "Challenges" : type === "Correction" ? "Refines" : type === "Observation" ? "Context" : "Supports";
        const approved = type === "Correction";
        next.evidence = [{ id: createdId, project: activeProject, caseId: targetId, recordType, content, source, fidelity: "Exact", confidence: 88, role, creator: "Cody", timestamp, approvalState: approved ? "Approved" : "Pending", retrievalEligible: approved, metadata: { "Record type": type } }, ...current.evidence];
        if (type === "Challenge") next.cases = current.cases.map((item) => item.id === targetId ? { ...item, governanceState: "Challenged" } : item);
        nextAction = type === "Evidence" || type === "Research" ? "Audit how this evidence supports or challenges the case." : "Inspect its effect inside the case record.";
      }
      next.activities = [{ id: `activity-${Date.now()}`, project: activeProject, actor: "Cody", action: `${type} saved`, targetId: createdId, targetTitle: content.slice(0, 72), timestamp, previousState, newState, consequence: "Retrieval did not change because no new knowledge was approved." }, ...current.activities];
      return next;
    });
    setCaptureOpen(false);
    setReceipt({ title: `${type} saved`, location, previousState, newState, retrieval: "Retrieval did not change because no knowledge was approved.", api: "The same canonical record is now API-visible.", next: nextAction });
    notify(`${type} saved with a traceable creation receipt`);
  }

  function completeAudit(caseRecord: CaseRecord) {
    const timestamp = nowLabel();
    changeState((current) => {
      const knowledgeId = `knowledge-${Date.now()}`;
      const evidenceId = `evidence-${Date.now()}`;
      const proposed: KnowledgeRecord = { id: knowledgeId, project: caseRecord.project, type: "Principle", title: `Lesson from ${caseRecord.title}`, content: `Separate the failed assumption from the factual outcome: ${caseRecord.outcome}`, status: "Pending", scope: projectByKey(caseRecord.project).name, confidence: 68, humanApproval: null, supportingCaseIds: [caseRecord.id], evidenceIds: [evidenceId], challengingEvidenceIds: [], revisionHistory: ["Proposed by audit; human approval required."], retrievalHistory: [], retrievalEligible: false, metadata: { Mechanism: "Audit-derived", "Governance state": "Pending" } };
      const evidence: EvidenceRecord = { id: evidenceId, project: caseRecord.project, caseId: caseRecord.id, recordType: "Proposed learning", content: proposed.content, source: "Case audit", fidelity: "Inferred", confidence: 68, role: "Refines", creator: "Atlas", timestamp, approvalState: "Pending", retrievalEligible: false, metadata: { Mechanism: "Audit-derived" } };
      const review: ReviewRecord = { id: `review-${Date.now()}`, project: caseRecord.project, type: "Proposed principle", title: proposed.title, proposal: proposed.content, why: "Atlas separated the factual outcome from the failed assumption.", sourceCaseId: caseRecord.id, supportEvidenceIds: [evidenceId], challengeEvidenceIds: [], affectedKnowledgeId: knowledgeId, blueprintEffect: "None unless separately authorized.", confidence: 68, retrievalEffect: "No effect until approved.", crossProjectConsequence: "None.", status: "Pending" };
      return { ...current, cases: current.cases.map((item) => item.id === caseRecord.id ? { ...item, state: "Awaiting review", governanceState: "Pending", proposedKnowledgeId: knowledgeId, postmortem: { ...item.postmortem, happened: item.outcome, failed: item.assumptions.join(" ") || "The original thesis failed.", held: item.facts.join(" "), underweighted: item.counterarguments.join(" ") || "Counterevidence requires review.", change: proposed.content, evidence: [evidenceId] } } : item), evidence: [evidence, ...current.evidence], knowledge: [proposed, ...current.knowledge], reviews: [review, ...current.reviews], activities: [{ id: `activity-${Date.now()}`, project: caseRecord.project, actor: "Atlas", action: "Audit completed", targetId: caseRecord.id, targetTitle: caseRecord.title, timestamp, previousState: "Needs audit", newState: "Awaiting review", consequence: "A proposed lesson was created without retrieval authority." }, ...current.activities] };
    });
    setReceipt({ title: "Audit completed", location: `${project.name} → Work → ${caseRecord.title}`, previousState: "Needs audit", newState: "Awaiting review", retrieval: "No change. Proposed learning is excluded until human approval.", api: "Audit, evidence, and proposal are API-visible.", next: "Open Review and govern the proposed lesson." });
  }

  function resetDemo() {
    const fresh = makeSeedState(state.workspaceId);
    setState(fresh); setView("home"); setActiveProject("sports"); setProjectTab("work"); setSelectedCaseId("case-england-ghana"); setAskPacket(null); setReceipt(null); setResetOpen(false);
    fetch("/api/state?replace=true", { method: "POST", headers: { "content-type": "application/json", ...(state.workspaceId ? { "x-atlas-workspace": state.workspaceId } : {}) }, body: JSON.stringify(fresh) }).catch(() => undefined);
    notify("Amy Campus restored without touching unrelated workspaces");
  }

  return <main className="atlas-app">
    <GlobalSidebar view={view} onNavigate={navigate} onIntegration={() => navigate("integration")} onReset={() => setResetOpen(true)} />
    <div className="atlas-main">
      <Topbar saveState={saveState} activeProject={view === "project" || view === "atlas" ? project.name : "Amy Campus"} onProjects={() => navigate("projects")} />
      {view === "home" && <CampusHome state={state} onProject={openProject} onReview={(id) => { setSelectedReviewId(id); navigate("review"); }} onAtlas={openAsk} onProjects={() => navigate("projects")} onGraph={() => navigate("atlas")} />}
      {view === "projects" && <ProjectDirectory state={state} onProject={openProject} onHeadquarters={() => navigate("review")} />}
      {view === "project" && <ProjectWorkspace
        state={state} projectKey={activeProject} tab={projectTab} setTab={setProjectTab} cases={projectCases} evidence={projectEvidence} knowledge={projectKnowledge} rules={projectRules} reviews={projectReviews} activities={projectActivities}
        selectedCase={selectedCase} setSelectedCaseId={setSelectedCaseId} selectedEvidence={selectedEvidence} setSelectedEvidenceId={setSelectedEvidenceId}
        onAsk={() => openAsk(activeProject)} onCapture={(type = "New case or experience", target = selectedCase?.id || "") => { setCaptureType(type); setCaptureTarget(target); setCaptureOpen(true); }} onConnections={() => { setGraphMode("lineage"); navigate("atlas"); }} onReview={(id) => { setSelectedReviewId(id); navigate("review"); }} onAudit={completeAudit}
        evidenceQuery={evidenceQuery} setEvidenceQuery={setEvidenceQuery} evidenceType={evidenceType} setEvidenceType={setEvidenceType} evidenceRole={evidenceRole} setEvidenceRole={setEvidenceRole}
      />}
      {view === "review" && <ReviewWorkspace state={state} selectedId={selectedReviewId} setSelectedId={setSelectedReviewId} onDecision={(review, action) => action === "Approve" ? resolveReview(review, "Approve") : action === "Edit and approve" ? setReviewEdit(review) : resolveReview(review, action as "Challenge" | "Reject" | "Defer" | "Connect" | "Merge" | "Supersede" | "Retire")} onOpenCase={(id, key) => { setSelectedCaseId(id); openProject(key, "work"); }} />}
      {view === "atlas" && <AtlasWorkspace state={state} projectKey={activeProject} question={askQuestion} setQuestion={setAskQuestion} local={askLocal} setLocal={setAskLocal} constraints={askConstraints} setConstraints={setAskConstraints} budget={askBudget} setBudget={setAskBudget} scope={askScope} setScope={setAskScope} status={askStatus} packet={askPacket} onSubmit={buildAsk} baseline={state.proofBaseline} graphMode={graphMode} setGraphMode={setGraphMode} selectedConnectionId={selectedConnectionId} setSelectedConnectionId={setSelectedConnectionId} selectedNodeId={selectedGraphNodeId} setSelectedNodeId={setSelectedGraphNodeId} onProject={(key) => { setActiveProject(key); setAskPacket(null); setSelectedGraphNodeId(state.cases.find((item) => item.project === key)?.id || ""); }} />}
      {view === "integration" && <Integration state={state} />}
    </div>
    <MobileNav view={view} onNavigate={navigate} />
    {captureOpen && <CaptureModal projectKey={activeProject} cases={projectCases} type={captureType} setType={setCaptureType} target={captureTarget} setTarget={setCaptureTarget} onSubmit={saveCapture} onClose={() => setCaptureOpen(false)} />}
    {receipt && <TransitionReceipt receipt={receipt} onClose={() => setReceipt(null)} />}
    {reviewEdit && <EditReviewModal review={reviewEdit} onClose={() => setReviewEdit(null)} onApprove={(text) => resolveReview(reviewEdit, "Approve", text)} />}
    {resetOpen && <ResetModal onClose={() => setResetOpen(false)} onReset={resetDemo} />}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </main>;
}

function GlobalSidebar({ view, onNavigate, onIntegration, onReset }: { view: GlobalView; onNavigate: (view: GlobalView) => void; onIntegration: () => void; onReset: () => void }) {
  return <aside className="global-sidebar" aria-label="Campus Atlas workspace navigation">
    <button className="brand" onClick={() => onNavigate("home")}><span>CA</span><div><strong>Campus Atlas</strong><small>Amy Campus</small></div></button>
    <nav>{globalDestinations.map((item) => <button key={item.id} className={view === item.id || (item.id === "atlas" && view === "integration") ? "active" : ""} onClick={() => onNavigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
    <div className="sidebar-secondary"><button onClick={onIntegration}>↗ API & Integration</button><button onClick={onReset}>↻ Reset Amy Campus</button></div>
    <div className="sidecar-state"><i />OpenAPI sidecar live<small>Canonical state shared</small></div>
  </aside>;
}

function Topbar({ saveState, activeProject, onProjects }: { saveState: string; activeProject: string; onProjects: () => void }) {
  return <header className="topbar"><button className="mobile-brand" onClick={onProjects}>CA</button><div className="breadcrumb"><span>Amy Campus</span><i>›</i><strong>{activeProject}</strong></div><div className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Save unavailable" : "✓ Synced"}</div></header>;
}

function CampusHome({ state, onProject, onReview, onAtlas, onProjects, onGraph }: { state: AtlasState; onProject: (key: ProjectKey) => void; onReview: (id: string) => void; onAtlas: (key?: ProjectKey) => void; onProjects: () => void; onGraph: () => void }) {
  const pending = state.reviews.filter((item) => item.status === "Pending");
  const recentPacket = state.contextPackets.at(-1);
  return <div className="page-shell campus-home">
    <section className="quiet-hero"><div><p className="eyebrow">Amy Campus · command center</p><h1>What needs your attention?</h1><p>Continue real work, govern proposed understanding, or ask inside a project. The deeper engine stays available when you need to inspect it.</p></div><button className="primary" onClick={() => onAtlas("sports")}>✦ Ask Atlas</button></section>
    <section className="command-grid">
      <button className="command-card featured" onClick={() => onProject("sports")}><span className="card-label">Continue working</span><div className="project-mark sports">SE</div><div><strong>England vs Ghana</strong><p>Audit complete · principle awaiting your decision</p></div><b>Open Sports Engine →</b></button>
      <button className="command-card" onClick={() => onReview(pending[0]?.id || "review-signal")}><span className="card-label">Needs approval</span><strong>{pending.length} review items</strong><p>{pending[0]?.title || "Review queue is clear"}</p><b>Open Review →</b></button>
      <button className="command-card" onClick={() => onReview("review-transfer-effort")}><span className="card-label">Cross-project pathway</span><strong>Sports Engine → Hockey</strong><p>Exploratory mechanism transfer · not authoritative</p><b>Inspect proposal →</b></button>
      <button className="command-card" onClick={() => onAtlas("sports")}><span className="card-label">Recent packet</span><strong>{recentPacket?.packetId || "No packet yet"}</strong><p>{recentPacket ? `${recentPacket.budget.used} selected records · ${recentPacket.blueprint.version}` : "Ask Atlas to compile governed context."}</p><b>Build context →</b></button>
    </section>
    <section className="home-section"><div className="section-heading"><div><p className="eyebrow">Projects</p><h2>Specialized workspaces, shared governance.</h2></div><button className="text-button" onClick={onProjects}>View all projects →</button></div><div className="project-row">{projects.map((item) => <ProjectCard key={item.key} project={item} state={state} onClick={() => onProject(item.key)} />)}</div></section>
    <section className="home-split"><article><div className="section-heading compact"><div><p className="eyebrow">Meaningful activity</p><h2>What changed recently</h2></div></div><ActivityList items={state.activities.slice(0, 4)} /></article><article><div className="section-heading compact"><div><p className="eyebrow">Approved understanding</p><h2>Recently earned</h2></div></div>{state.knowledge.filter((item) => item.status === "Approved").slice(0, 3).map((item) => <button className="knowledge-line" key={item.id} onClick={() => onProject(item.project)}><span>{projectByKey(item.project).short}</span><div><strong>{item.title}</strong><small>{item.humanApproval}</small></div></button>)}<button className="text-button atlas-link" onClick={onGraph}>Inspect Campus Atlas →</button></article></section>
  </div>;
}

function ProjectDirectory({ state, onProject, onHeadquarters }: { state: AtlasState; onProject: (key: ProjectKey) => void; onHeadquarters: () => void }) {
  return <div className="page-shell"><section className="page-intro"><p className="eyebrow">Amy Campus</p><h1>Projects</h1><p>Each project owns its Work, Evidence, Blueprint, metadata schema, and retrieval boundary.</p></section><div className="directory-grid">{projects.map((item) => <ProjectCard key={item.key} project={item} state={state} onClick={() => onProject(item.key)} expanded />)}<button className="headquarters-card" onClick={onHeadquarters}><span>HQ</span><div><p className="eyebrow">Governance function</p><h2>Headquarters</h2><p>Campus-level review, transfer proposals, conflicts, supersession, and retirement—not another ordinary project.</p><b>Open Campus Review →</b></div></button></div></div>;
}

function ProjectCard({ project, state, onClick, expanded = false }: { project: ReturnType<typeof projectByKey>; state: AtlasState; onClick: () => void; expanded?: boolean }) {
  const cases = state.cases.filter((item) => item.project === project.key);
  const reviews = state.reviews.filter((item) => item.status === "Pending" && (item.project === project.key || item.targetProject === project.key));
  const approved = state.knowledge.filter((item) => item.project === project.key && item.status === "Approved").length;
  return <button className={`project-card ${expanded ? "expanded" : ""}`} style={{ "--project-color": project.color } as React.CSSProperties} onClick={onClick}><div className="project-emblem">{project.short}</div><div><span>{project.domain}</span><strong>{project.name}</strong><p>{project.description}</p><small>{cases.length} cases · {reviews.length} pending · {approved} approved</small></div><b>Open →</b></button>;
}

function ProjectWorkspace(props: {
  state: AtlasState; projectKey: ProjectKey; tab: ProjectTab; setTab: (tab: ProjectTab) => void; cases: CaseRecord[]; evidence: EvidenceRecord[]; knowledge: KnowledgeRecord[]; rules: BlueprintRule[]; reviews: ReviewRecord[]; activities: ActivityRecord[];
  selectedCase: CaseRecord | null; setSelectedCaseId: (id: string) => void; selectedEvidence: EvidenceRecord | null; setSelectedEvidenceId: (id: string) => void;
  onAsk: () => void; onCapture: (type?: CaptureType, target?: string) => void; onConnections: () => void; onReview: (id: string) => void; onAudit: (item: CaseRecord) => void;
  evidenceQuery: string; setEvidenceQuery: (value: string) => void; evidenceType: string; setEvidenceType: (value: string) => void; evidenceRole: string; setEvidenceRole: (value: string) => void;
}) {
  const { state, projectKey, tab, setTab, cases, evidence, knowledge, rules, reviews, activities, selectedCase, setSelectedCaseId, selectedEvidence, setSelectedEvidenceId, onAsk, onCapture, onConnections, onReview, onAudit } = props;
  const project = projectByKey(projectKey);
  const activeCount = cases.filter((item) => !["Approved", "Closed"].includes(item.state)).length;
  const approvedCount = knowledge.filter((item) => item.status === "Approved").length;
  return <div className="project-workspace" style={{ "--project-color": project.color } as React.CSSProperties}>
    <section className="project-header"><div className="project-identity"><span>{project.short}</span><div><p>{project.domain} · Blueprint {rules.find((item) => item.status === "Active")?.version || "Not established"}</p><h1>{project.name}</h1><small>{project.description}</small></div></div><div className="project-primary-actions"><button className="ghost" onClick={onConnections}>⌁ Connections</button><button className="ghost" onClick={onAsk}>✦ Ask Atlas</button><button className="primary" onClick={() => onCapture()}>＋ New Capture</button></div></section>
    <nav className="project-tabs" aria-label={`${project.name} workspace`}><button className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}><strong>Work</strong><small>{activeCount} active cases</small></button><button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}><strong>Evidence</strong><small>{evidence.length} ledger records</small></button><button className={tab === "blueprint" ? "active" : ""} onClick={() => setTab("blueprint")}><strong>Blueprint</strong><small>{rules.filter((item) => item.status === "Active").length} active rules</small></button></nav>
    <div className="project-counts"><button onClick={() => setTab("work")}><span>Active work</span><strong>{activeCount}</strong><small>Open exact records</small></button><button onClick={() => reviews[0] && onReview(reviews[0].id)}><span>Pending review</span><strong>{reviews.length}</strong><small>{reviews.length ? "Decision required" : "Queue clear"}</small></button><button onClick={() => setTab("blueprint")}><span>Approved knowledge</span><strong>{approvedCount}</strong><small>Trace earned authority</small></button><button onClick={() => setTab("activity")}><span>Activity</span><strong>{activities.length}</strong><small>Meaningful changes</small></button></div>
    {tab === "work" && <WorkView state={state} cases={cases} selected={selectedCase} onSelect={setSelectedCaseId} onCapture={onCapture} onReview={onReview} onAsk={onAsk} onAudit={onAudit} />}
    {tab === "evidence" && <EvidenceView project={project} cases={cases} evidence={evidence} selected={selectedEvidence} onSelect={setSelectedEvidenceId} query={props.evidenceQuery} setQuery={props.setEvidenceQuery} type={props.evidenceType} setType={props.setEvidenceType} role={props.evidenceRole} setRole={props.setEvidenceRole} onCapture={onCapture} />}
    {tab === "blueprint" && <BlueprintView rules={rules} knowledge={knowledge} cases={cases} evidence={evidence} onReview={onReview} reviews={state.reviews} />}
    {tab === "activity" && <section className="workspace-panel activity-panel"><div className="panel-title"><div><p className="eyebrow">Meaningful state changes only</p><h2>Project activity</h2></div><button className="ghost" onClick={() => setTab("work")}>Back to Work</button></div><ActivityList items={activities} /></section>}
    <button className="mobile-capture" onClick={() => onCapture()}>＋ New Capture</button>
  </div>;
}

function WorkView({ state, cases, selected, onSelect, onCapture, onReview, onAsk, onAudit }: { state: AtlasState; cases: CaseRecord[]; selected: CaseRecord | null; onSelect: (id: string) => void; onCapture: (type?: CaptureType, target?: string) => void; onReview: (id: string) => void; onAsk: () => void; onAudit: (item: CaseRecord) => void }) {
  const nextCase = cases.find((item) => !["Approved", "Closed"].includes(item.state));
  return <section className="work-layout workspace-panel"><aside className="work-index"><div className="panel-title small"><div><p className="eyebrow">Operational queue</p><h2>Work</h2></div><button className="icon-button" onClick={() => onCapture()}>＋</button></div>{nextCase && <button className="next-action" onClick={() => onSelect(nextCase.id)}><span>Recommended next action</span><strong>{nextCase.state === "Awaiting review" ? "Govern the proposed lesson" : nextCase.state === "Needs audit" ? "Complete the audit" : "Record the outcome"}</strong><small>{nextCase.title}</small></button>}<div className="work-groups">{["Captured", "Needs outcome", "Needs audit", "Awaiting review", "Approved", "Closed"].map((status) => {
    const grouped = cases.filter((item) => item.state === status);
    if (!grouped.length) return null;
    return <div key={status}><span>{status} · {grouped.length}</span>{grouped.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => onSelect(item.id)}><strong>{item.title}</strong><small>{item.origin} · {item.outcomeState === "Recorded" ? item.outcome : "Outcome pending"}</small></button>)}</div>;
  })}{!cases.length && <EmptyState title="No work captured yet" text="This project has an honest empty state. Capture the first experience to begin." action="New Capture" onAction={() => onCapture()} />}</div></aside><div className="case-stage">{selected ? <UnifiedCase state={state} item={selected} onCapture={onCapture} onReview={onReview} onAsk={onAsk} onAudit={onAudit} /> : <EmptyState title="Select a case" text="Choose work from the left or capture a new experience." action="New Capture" onAction={() => onCapture()} />}</div></section>;
}

function UnifiedCase({ state, item, onCapture, onReview, onAsk, onAudit }: { state: AtlasState; item: CaseRecord; onCapture: (type?: CaptureType, target?: string) => void; onReview: (id: string) => void; onAsk: () => void; onAudit: (item: CaseRecord) => void }) {
  const evidence = state.evidence.filter((record) => record.caseId === item.id);
  const proposed = state.knowledge.find((record) => record.id === item.proposedKnowledgeId);
  const review = state.reviews.find((record) => record.sourceCaseId === item.id && record.type === "Proposed principle");
  const connections = state.connections.filter((record) => record.sourceId === item.id || record.targetId === item.id || evidence.some((entry) => record.sourceId === entry.id || record.targetId === entry.id));
  const completedThrough = item.retrievalEligible ? 7 : item.governanceState === "Approved" ? 6 : item.state === "Awaiting review" ? 5 : item.state === "Needs audit" ? 2 : item.outcomeState === "Recorded" ? 2 : 1;
  return <article className="case-record"><header className="case-header"><div><div className="case-kickers"><span>{item.origin}</span><span className={`status ${statusClass(item.state)}`}>{item.state}</span></div><h2>{item.title}</h2><p>{item.task}</p></div><div className="case-actions"><button className="ghost" onClick={() => onCapture("Evidence", item.id)}>＋ Evidence</button><button className="ghost" onClick={() => onCapture("Outcome", item.id)}>Record outcome</button></div></header>
    <div className="case-facts"><div><span>Confidence</span><strong>{item.confidence}%</strong></div><div><span>Outcome</span><strong>{item.outcomeState}</strong></div><div><span>Governance</span><strong>{item.governanceState}</strong></div><div><span>Retrieval</span><strong>{item.retrievalEligible ? "Eligible" : "Excluded"}</strong></div></div>
    <div className="workflow-rail">{workflowStages.map((stage, index) => <div key={stage} className={index < completedThrough ? "complete" : index === completedThrough ? "current" : ""}><i>{index < completedThrough ? "✓" : index + 1}</i><span>{stage}</span></div>)}</div>
    <CaseSection title="What happened" eyebrow="Origin and reasoning"><p>{item.experience}</p><div className="detail-grid"><Detail label="Local context" value={item.localContext || "None supplied"} /><Detail label="Thesis" value={item.thesis} /><Detail label="Assumptions" value={item.assumptions.join(" ") || "Not yet audited"} /><Detail label="Created" value={item.createdAt} /></div></CaseSection>
    <CaseSection title="Research audit" eyebrow="Separate before scoring confidence"><div className="audit-grid"><AuditColumn label="Facts" values={item.facts} /><AuditColumn label="Estimates" values={item.estimates} /><AuditColumn label="Assumptions" values={item.assumptions} /><AuditColumn label="Unknowns" values={item.unknowns} /><AuditColumn label="Counterarguments" values={item.counterarguments} /></div><div className="audit-footer"><span>Fragility <strong>{item.fragility}</strong></span><span>Research completeness <strong>{item.completeness}%</strong></span></div>{item.state === "Needs audit" && <button className="primary" onClick={() => onAudit(item)}>Complete audit →</button>}</CaseSection>
    <CaseSection title="Evidence" eyebrow={`${evidence.length} underlying records`}><div className="evidence-mini-list">{evidence.map((record) => <article key={record.id}><div><span className={`role ${statusClass(record.role)}`}>{record.role}</span><strong>{record.content}</strong></div><p>{record.source} · {record.fidelity} · {record.confidence}% · {record.creator} · {record.timestamp}</p><small>{record.approvalState} · {record.retrievalEligible ? "Retrieval eligible" : "No retrieval authority"}</small></article>)}</div><button className="text-button" onClick={() => onCapture("Evidence", item.id)}>＋ Add evidence</button></CaseSection>
    <CaseSection title="Outcome" eyebrow="Factual result kept separate"><div className="outcome-callout"><span>{item.outcomeState}</span><strong>{item.outcome || "No outcome recorded yet."}</strong></div></CaseSection>
    <CaseSection title="Post-mortem" eyebrow="Interpretation after reality"><div className="detail-grid"><Detail label="What happened" value={item.postmortem.happened || "Audit pending"} /><Detail label="What failed" value={item.postmortem.failed || "Audit pending"} /><Detail label="What held up" value={item.postmortem.held || "Audit pending"} /><Detail label="What was underweighted" value={item.postmortem.underweighted || "Audit pending"} /></div><div className="change-next"><span>What should change next time</span><strong>{item.postmortem.change || "Complete the audit to propose a change."}</strong></div></CaseSection>
    <CaseSection title="Proposed learning" eyebrow="Structurally separate from approved knowledge">{proposed ? <div className={`proposed-learning ${statusClass(proposed.status)}`}><span>{proposed.status}</span><strong>{proposed.title}</strong><p>{proposed.content}</p><small>{proposed.retrievalEligible ? "Eligible for retrieval" : "Excluded from authoritative retrieval"}</small>{review?.status === "Pending" && <button className="primary" onClick={() => onReview(review.id)}>Open governance decision →</button>}</div> : <EmptyState title="No learning proposed" text="A completed audit can propose a scoped lesson without granting it authority." />}</CaseSection>
    <CaseSection title="Connections" eyebrow="Every relationship answers why"><div className="connection-list">{connections.map((connection) => <article key={connection.id}><span>{connection.type}</span><strong>{recordTitle(state, connection.sourceId)} → {recordTitle(state, connection.targetId)}</strong><p>{connection.explanation}</p><small>{connection.confidence}% · {connection.approvalState} · {connection.downstreamConsequence}</small></article>)}</div></CaseSection>
    <CaseSection title="Downstream effect" eyebrow="Visible state transition"><div className="downstream-grid"><Detail label="Record" value={proposed?.status === "Approved" ? "Approved knowledge updated" : proposed ? "Proposed knowledge awaiting review" : "Case only"} /><Detail label="Retrieval" value={item.retrievalEligible ? "Eligible within approved scope" : "Unchanged"} /><Detail label="Blueprint" value={state.blueprintRules.find((rule) => rule.relatedKnowledgeIds.includes(proposed?.id || ""))?.status === "Active" ? "Separately authorized" : "No authoritative change"} /><Detail label="API-visible state" value="Updated from the same canonical record" /></div><button className="ghost" onClick={onAsk}>Test this case in Ask Atlas →</button></CaseSection>
  </article>;
}

function EvidenceView({ project, cases, evidence, selected, onSelect, query, setQuery, type, setType, role, setRole, onCapture }: { project: ReturnType<typeof projectByKey>; cases: CaseRecord[]; evidence: EvidenceRecord[]; selected: EvidenceRecord | null; onSelect: (id: string) => void; query: string; setQuery: (value: string) => void; type: string; setType: (value: string) => void; role: string; setRole: (value: string) => void; onCapture: (type?: CaptureType, target?: string) => void }) {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  const ranked = evidence.map((item) => {
    const haystack = `${item.content} ${item.source} ${Object.values(item.metadata).join(" ")}`.toLowerCase();
    const matched = words.filter((word) => haystack.includes(word));
    const score = Math.min(99, Math.round(item.confidence * .55 + (item.retrievalEligible ? 16 : 0) + matched.length * 9 + (item.role === "Challenges" || item.role === "Contradicts" ? 8 : 0)));
    const labels = Object.entries(item.metadata).filter(([, value]) => query && value.toLowerCase().includes(query.toLowerCase().split(" ")[0])).map(([key, value]) => `${key}: ${value}`);
    const explanation = matched.length ? `Ranked highly because it matches ${matched.slice(0, 3).join(", ")}, ${item.project === project.key ? "the active project" : "a connected project"}, and ${item.role.toLowerCase()} evidence.` : `Ranked from governance authority, ${item.fidelity.toLowerCase()} fidelity, ${item.confidence}% confidence, and ${item.role.toLowerCase()} role.`;
    return { item, score, explanation, labels };
  }).filter(({ item }) => (type === "All records" || item.recordType === type) && (role === "All roles" || item.role === role) && (!query || `${item.content} ${item.source} ${Object.values(item.metadata).join(" ")}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => b.score - a.score);
  return <section className="evidence-layout workspace-panel"><div className="ledger-browser"><div className="panel-title"><div><p className="eyebrow">Working records, not a graph</p><h2>Evidence Ledger</h2></div><button className="primary" onClick={() => onCapture("Evidence", cases[0]?.id)}>＋ Add evidence</button></div><div className="ledger-filters"><input aria-label="Rank evidence for a question" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rank for a question, mechanism, or branch…" /><select aria-label="Record type" value={type} onChange={(event) => setType(event.target.value)}><option>All records</option>{[...new Set(evidence.map((item) => item.recordType))].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Evidence role" value={role} onChange={(event) => setRole(event.target.value)}><option>All roles</option>{[...new Set(evidence.map((item) => item.role))].map((item) => <option key={item}>{item}</option>)}</select></div><div className="schema-note"><span>Quiet project schema</span><p>{project.schema.join(" · ")}</p><small>Labels support ranking and reconstruction. They are not knowledge claims or feed events.</small></div><div className="ledger-list">{ranked.map(({ item, score, explanation }) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => onSelect(item.id)}><span className={`record-type ${statusClass(item.recordType)}`}>{item.recordType}</span><strong>{item.content}</strong><p>{item.source} · {item.fidelity} · {item.role}</p><small><b>{score}</b> {explanation}</small></button>)}{!ranked.length && <EmptyState title="No matching evidence" text="Adjust the filters or capture the first record for this branch." />}</div></div><aside className="ledger-inspector">{selected ? <><div className="inspector-heading"><span className={`status ${statusClass(selected.approvalState)}`}>{selected.approvalState}</span><h2>{selected.recordType}</h2><p>{selected.content}</p></div><div className="inspector-metrics"><Detail label="Source" value={selected.source} /><Detail label="Fidelity" value={selected.fidelity} /><Detail label="Confidence" value={`${selected.confidence}%`} /><Detail label="Role" value={selected.role} /><Detail label="Creator" value={selected.creator} /><Detail label="Timestamp" value={selected.timestamp} /><Detail label="Retrieval" value={selected.retrievalEligible ? "Eligible" : "Excluded"} /><Detail label="Case" value={cases.find((item) => item.id === selected.caseId)?.title || selected.caseId} /></div><div className="metadata-table"><span>Structured labels</span>{Object.entries(selected.metadata).map(([key, value]) => <div key={key}><small>{key}</small><strong>{value}</strong></div>)}</div><p className="quiet-note">Routine label edits stay in record history and do not clutter the project feed.</p></> : <EmptyState title="Select a record" text="Inspect its source, fidelity, role, governance, and quiet metadata." />}</aside></section>;
}

function BlueprintView({ rules, knowledge, cases, evidence, onReview, reviews }: { rules: BlueprintRule[]; knowledge: KnowledgeRecord[]; cases: CaseRecord[]; evidence: EvidenceRecord[]; onReview: (id: string) => void; reviews: ReviewRecord[] }) {
  const active = rules.filter((item) => item.status === "Active");
  const proposed = rules.filter((item) => item.status === "Proposed");
  return <section className="workspace-panel blueprint-view"><div className="panel-title"><div><p className="eyebrow">Durable methodology only</p><h2>Project Blueprint</h2><p>{active[0]?.version || "No active version"} · Knowledge approval and Blueprint authority require separate decisions.</p></div></div><div className="blueprint-grid"><div><h3>Active methodology</h3>{active.map((rule) => <BlueprintCard key={rule.id} rule={rule} knowledge={knowledge} cases={cases} evidence={evidence} />)}{!active.length && <EmptyState title="No active methodology yet" text="Create cases and approve evidence-backed rules to develop this project’s Blueprint." />}</div><aside><h3>Proposed revisions</h3>{proposed.map((rule) => { const review = reviews.find((item) => item.type === "Blueprint revision" && item.affectedKnowledgeId && rule.relatedKnowledgeIds.includes(item.affectedKnowledgeId)); return <article className="proposed-rule" key={rule.id}><span>Proposed · no authority</span><strong>{rule.content}</strong><p>{rule.retrievalEffect}</p>{review && <button className="ghost" onClick={() => onReview(review.id)}>Review separately →</button>}</article>; })}<div className="blueprint-boundary"><strong>Authority boundary</strong><p>Approved knowledge may enter retrieval within its scope. It revises the active Blueprint only through a separate human decision.</p></div></aside></div></section>;
}

function BlueprintCard({ rule, knowledge, cases, evidence }: { rule: BlueprintRule; knowledge: KnowledgeRecord[]; cases: CaseRecord[]; evidence: EvidenceRecord[] }) {
  return <details className="blueprint-card" open><summary><div><span>{rule.version} · {rule.status}</span><strong>{rule.content}</strong></div><i>⌄</i></summary><div className="blueprint-details"><Detail label="Cases that earned it" value={rule.supportingCaseIds.map((id) => cases.find((item) => item.id === id)?.title || id).join(" · ") || "None"} /><Detail label="Supporting evidence" value={rule.evidenceIds.map((id) => evidence.find((item) => item.id === id)?.source || id).join(" · ") || "None"} /><Detail label="Challenging evidence" value={rule.challengeIds.map((id) => evidence.find((item) => item.id === id)?.content || id).join(" · ") || "None"} /><Detail label="Related knowledge" value={rule.relatedKnowledgeIds.map((id) => knowledge.find((item) => item.id === id)?.title || id).join(" · ") || "None"} /><Detail label="Approval history" value={rule.approvalHistory.join(" ")} /><Detail label="Current retrieval effect" value={rule.retrievalEffect} /></div></details>;
}

function ReviewWorkspace({ state, selectedId, setSelectedId, onDecision, onOpenCase }: { state: AtlasState; selectedId: string; setSelectedId: (id: string) => void; onDecision: (review: ReviewRecord, action: string) => void; onOpenCase: (id: string, key: ProjectKey) => void }) {
  const queue = state.reviews.filter((item) => item.status === "Pending" || item.status === "Deferred");
  const selected = state.reviews.find((item) => item.id === selectedId) || queue[0] || state.reviews[0];
  const support = selected ? state.evidence.filter((item) => selected.supportEvidenceIds.includes(item.id)) : [];
  const challenges = selected ? state.evidence.filter((item) => selected.challengeEvidenceIds.includes(item.id)) : [];
  const sourceCase = selected?.sourceCaseId ? state.cases.find((item) => item.id === selected.sourceCaseId) : null;
  const actions = selected?.type === "Blueprint revision" ? ["Approve", "Edit and approve", "Challenge", "Reject", "Defer"] : selected?.type === "Transfer proposal" ? ["Approve", "Edit and approve", "Challenge", "Reject", "Defer"] : selected?.type === "Connection" ? ["Connect", "Edit and approve", "Reject", "Defer"] : selected?.type === "Retirement proposal" ? ["Retire", "Defer", "Reject"] : ["Approve", "Edit and approve", "Challenge", "Reject", "Merge", "Defer"];
  return <div className="page-shell review-page"><section className="page-intro"><p className="eyebrow">Headquarters · governed decisions</p><h1>Review</h1><p>Atlas proposes. You inspect the evidence, challenge the scope, and decide what deserves future influence.</p></section><section className="review-layout"><aside className="review-queue"><div className="queue-heading"><span>Decision queue</span><strong>{queue.length}</strong></div>{queue.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.type}</span><strong>{item.title}</strong><p>{projectName(item.project)} · {item.confidence}% confidence</p><small>{item.status}</small></button>)}{!queue.length && <EmptyState title="Review queue clear" text="New proposals, conflicts, and transfers will appear here." />}</aside><article className="review-detail">{selected && <><header><div><span className={`status ${statusClass(selected.status)}`}>{selected.status}</span><p>{selected.type} · {projectName(selected.project)}</p><h2>{selected.title}</h2></div><strong className="confidence-ring">{selected.confidence}<small>%</small></strong></header><section className="review-proposal"><span>What Atlas proposes</span><strong>{selected.proposal}</strong><p>{selected.why}</p></section>{sourceCase && <button className="source-case" onClick={() => onOpenCase(sourceCase.id, sourceCase.project)}><span>Source case</span><strong>{sourceCase.title}</strong><small>Open the unified record →</small></button>}<div className="review-evidence"><section><span>Supporting evidence</span>{support.map((item) => <article key={item.id}><strong>{item.content}</strong><small>{item.source} · {item.fidelity} · {item.confidence}%</small></article>)}{!support.length && <p>No supporting evidence attached.</p>}</section><section><span>Challenging evidence</span>{challenges.map((item) => <article key={item.id}><strong>{item.content}</strong><small>{item.source} · {item.fidelity} · {item.confidence}%</small></article>)}{!challenges.length && <p>No challenging evidence attached.</p>}</section></div><div className="review-effects"><Detail label="Existing knowledge affected" value={state.knowledge.find((item) => item.id === selected.affectedKnowledgeId)?.title || "None"} /><Detail label="Possible Blueprint effect" value={selected.blueprintEffect} /><Detail label="Expected retrieval effect" value={selected.retrievalEffect} /><Detail label="Cross-project consequence" value={selected.crossProjectConsequence} /></div><div className="review-actions">{actions.map((action) => <button key={action} className={action === "Approve" || action === "Connect" ? "primary" : action === "Reject" || action === "Retire" ? "danger" : "ghost"} onClick={() => onDecision(selected, action)}>{action}</button>)}</div></>}</article></section></div>;
}

function AtlasWorkspace(props: { state: AtlasState; projectKey: ProjectKey; question: string; setQuestion: (value: string) => void; local: string; setLocal: (value: string) => void; constraints: string; setConstraints: (value: string) => void; budget: number; setBudget: (value: number) => void; scope: "project" | "transfers" | "campus"; setScope: (value: "project" | "transfers" | "campus") => void; status: string; packet: PacketRecord | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; baseline: PacketRecord | null; graphMode: GraphMode; setGraphMode: (value: GraphMode) => void; selectedConnectionId: string; setSelectedConnectionId: (id: string) => void; selectedNodeId: string; setSelectedNodeId: (id: string) => void; onProject: (key: ProjectKey) => void }) {
  const { state, projectKey, question, setQuestion, local, setLocal, constraints, setConstraints, budget, setBudget, scope, setScope, status, packet, onSubmit, baseline, graphMode, setGraphMode, selectedConnectionId, setSelectedConnectionId, selectedNodeId, setSelectedNodeId, onProject } = props;
  return <div className="page-shell atlas-page"><section className="ask-shell"><div className="ask-intro"><p className="eyebrow">Ask inside the active project</p><h1>What are you working on?</h1><p>Get useful help first. Inspect the selected evidence, exclusions, pathways, packet, receipt, and JSON only when you need them.</p></div><form onSubmit={onSubmit} className="ask-form"><div className="active-project-picker"><span>Active project</span><select value={projectKey} onChange={(event) => onProject(event.target.value as ProjectKey)}>{projects.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select><small>Ask Atlas will not silently change this scope.</small></div><textarea aria-label="Question or task" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask the question you would normally ask ChatGPT…" rows={4} /><details className="ask-options"><summary>＋ Local context and retrieval controls</summary><div><label>Temporary local context<textarea value={local} onChange={(event) => setLocal(event.target.value)} rows={3} placeholder="Current facts that should expire after this task…" /></label><label>Constraints<textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} rows={3} /></label><label>Token budget<input type="number" min={250} max={2500} step={50} value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label><label>Retrieval scope<select value={scope} onChange={(event) => setScope(event.target.value as "project" | "transfers" | "campus")}><option value="project">Current project only</option><option value="transfers">Current project + approved transfers</option><option value="campus">Entire Campus exploration</option></select></label></div></details><button className="primary ask-submit" disabled={status === "loading"}>{status === "loading" ? "Building governed context…" : "Ask Atlas →"}</button>{status === "error" && <p className="form-error">Atlas could not build the packet. Your project state was not changed.</p>}</form>{packet ? <AskResult packet={packet} baseline={baseline} response={packetResponse(packet)} /> : <div className="ask-placeholder"><span>✦</span><strong>Useful response first.</strong><p>Blueprint, approved knowledge, evidence, challenges, exclusions, reconstruction pathways, receipt, and JSON remain underneath.</p></div>}</section><ProjectGraph state={state} projectKey={projectKey} mode={graphMode} setMode={setGraphMode} selectedConnectionId={selectedConnectionId} setSelectedConnectionId={setSelectedConnectionId} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} /></div>;
}

function AskResult({ packet, baseline, response }: { packet: PacketRecord; baseline: PacketRecord | null; response: string }) {
  const newIds = new Set(packet.durableKnowledge.map((item) => item.id));
  const beforeIds = new Set((baseline?.durableKnowledge || []).map((item) => item.id));
  const added = packet.durableKnowledge.filter((item) => !beforeIds.has(item.id));
  const displaced = (baseline?.durableKnowledge || []).filter((item) => !newIds.has(item.id));
  const validDiff = baseline && baseline.task === packet.task && baseline.packetId !== packet.packetId;
  return <div className="ask-result"><section className="direct-response"><div><span>Atlas response</span><small>{packet.blueprint.project} · {packet.blueprint.version}</small></div><p>{response}</p></section><details open><summary>Inspect context <span>{packet.budget.used} selected · ~{packet.budget.estimatedTokens} tokens</span></summary><div className="selected-context"><section><h3>Selected evidence and knowledge</h3>{packet.durableKnowledge.map((item) => <article key={item.id}><span>{item.usefulness}</span><div><strong>{item.title}</strong><p>{item.summary}</p><small>{item.whyIncluded}</small></div></article>)}</section><section><h3>Challenges carried forward</h3>{packet.challenges.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.reason}</p></article>)}</section></div></details><details><summary>Exclusions <span>{packet.excluded.length} explained</span></summary><div className="exclusion-list">{packet.excluded.map((item) => <p key={item.id}><strong>{item.title}</strong>{item.whyExcluded}</p>)}</div></details>{packet.reconstructionPathways?.length ? <details><summary>Reconstruction pathways <span>{packet.reconstructionPathways.filter((item) => item.selected).length} used</span></summary><div className="pathway-receipts">{packet.reconstructionPathways.map((path) => <article key={path.id} className={path.selected ? "selected" : "excluded"}><span>{path.authority}</span><strong>{path.sourceProject} → {path.targetProject}</strong><p>{path.sharedMechanism}</p><small>{path.reason}</small><div>{path.recordsFollowed.join(" → ")}</div><p><b>Contribution:</b> {path.contribution}</p><p><b>Domain boundary:</b> {path.domainLimitations}</p></article>)}</div></details> : null}<details><summary>Context packet <span>Compact model handoff</span></summary><pre>{packet.compiledPrompt}</pre></details><details><summary>Retrieval receipt <span>{packet.receipt.checks.length} governance checks</span></summary><div className="receipt-grid"><section><h3>Checks</h3>{packet.receipt.checks.map((item) => <p key={item}>✓ {item}</p>)}</section><section><h3>Labels that affected retrieval</h3>{packet.receipt.labelsApplied?.map((item) => <p key={item}>{item}</p>) || <p>No structured labels affected this request.</p>}</section><section><h3>Included</h3>{packet.receipt.inclusions.map((item) => <p key={item.id}><strong>{item.id}</strong>{item.reason}</p>)}</section><section><h3>Excluded</h3>{packet.receipt.exclusions.map((item) => <p key={item.id}><strong>{item.id}</strong>{item.reason}</p>)}</section></div></details>{validDiff && <details open className="packet-diff"><summary>Before-and-after diff <span>Approval-caused change</span></summary><div className="diff-grid"><section><span>Before</span><strong>{baseline.packetId}</strong>{baseline.durableKnowledge.map((item) => <p key={item.id}>{item.title}</p>)}</section><section className="diff-change"><span>What changed</span>{added.map((item) => <p key={item.id}>＋ {item.title}<small>{item.whyIncluded}</small></p>)}{displaced.map((item) => <p key={item.id}>− {item.title}<small>Displaced by more useful approved knowledge.</small></p>)}<strong>{added.length ? "The preserved failure mode now affects later context." : "No approval-caused selection changed."}</strong></section><section><span>After</span><strong>{packet.packetId}</strong>{packet.durableKnowledge.map((item) => <p key={item.id}>{item.title}</p>)}</section></div></details>}<details><summary>Raw JSON <span>POST /api/context</span></summary><pre>{JSON.stringify(packet, null, 2)}</pre></details></div>;
}

function ProjectGraph({ state, projectKey, mode, setMode, selectedConnectionId, setSelectedConnectionId, selectedNodeId, setSelectedNodeId }: { state: AtlasState; projectKey: ProjectKey; mode: GraphMode; setMode: (mode: GraphMode) => void; selectedConnectionId: string; setSelectedConnectionId: (id: string) => void; selectedNodeId: string; setSelectedNodeId: (id: string) => void }) {
  const project = projectByKey(projectKey);
  const relevant = state.connections.filter((item) => {
    const touchesProject = item.project === projectKey || item.project === "campus" && ([item.sourceId, item.targetId].some((id) => state.cases.find((record) => record.id === id)?.project === projectKey || state.knowledge.find((record) => record.id === id)?.project === projectKey));
    if (!touchesProject) return false;
    if (mode === "challenges") return item.type.includes("Challenge") || item.type.includes("Contradicted") || item.type === "Challenges";
    if (mode === "cross") return item.project === "campus";
    if (mode === "transfer") return item.type === "Proposed for transfer";
    if (mode === "lineage") return ["Derived from", "Contradicted by outcome", "Caused revision of", "Produced packet", "Shares mechanism with"].includes(item.type);
    return true;
  });
  const nodeIds = [...new Set(relevant.flatMap((item) => [item.sourceId, item.targetId]))];
  const selectedEdge = state.connections.find((item) => item.id === selectedConnectionId && relevant.some((edge) => edge.id === item.id)) || relevant[0];
  return <section className="project-graph"><div className="graph-heading"><div><p className="eyebrow">Localized project graph</p><h2>{project.name} lineage</h2><p>The graph inspects relationships. Work and Evidence remain the operating surfaces.</p></div><div className="graph-tabs">{(["connections", "lineage", "challenges", "cross", "transfer"] as GraphMode[]).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item === "cross" ? "Cross-Project Influence" : item === "transfer" ? "Transfer Review" : item[0].toUpperCase() + item.slice(1)}</button>)}</div></div><div className="graph-body"><div className="graph-canvas-v46"><div className="graph-nodes">{nodeIds.map((id) => <button key={id} className={selectedNodeId === id ? "active" : ""} onClick={() => setSelectedNodeId(id)}><i>{id.includes("case") ? "C" : id.includes("ev-") ? "E" : id.includes("knowledge") ? "K" : "R"}</i><span>{recordTitle(state, id)}</span></button>)}{!nodeIds.length && <EmptyState title={`No ${mode} relationships`} text="This project has no corresponding approved records yet." />}</div><div className="graph-edges">{relevant.map((edge) => <button key={edge.id} className={`${selectedEdge?.id === edge.id ? "active" : ""} ${statusClass(edge.approvalState)}`} onClick={() => setSelectedConnectionId(edge.id)}><span>{recordTitle(state, edge.sourceId)}</span><i>→</i><strong>{edge.type}</strong><i>→</i><span>{recordTitle(state, edge.targetId)}</span></button>)}</div></div><aside className="edge-inspector">{selectedEdge ? <><span className={`status ${statusClass(selectedEdge.approvalState)}`}>{selectedEdge.approvalState}</span><p className="eyebrow">{selectedEdge.type}</p><h3>{selectedEdge.sharedMechanism}</h3><p>{selectedEdge.explanation}</p><div><Detail label="Supporting evidence" value={selectedEdge.evidenceIds.map((id) => recordTitle(state, id)).join(" · ") || "None"} /><Detail label="Confidence" value={`${selectedEdge.confidence}%`} /><Detail label="Creator" value={selectedEdge.creator} /><Detail label="Downstream consequence" value={selectedEdge.downstreamConsequence} /><Detail label="Reconstruction value" value={`${selectedEdge.reconstructionValue}%`} /><Detail label="Domain limitations" value={selectedEdge.domainLimitations} /></div></> : <EmptyState title="Select a connection" text="Inspect why it exists, what supports it, and what it can change." />}</aside></div></section>;
}

function Integration({ state }: { state: AtlasState }) {
  return <div className="page-shell integration-page"><section className="page-intro"><p className="eyebrow">API & Integration</p><h1>The same governed reasoning, outside the UI.</h1><p>The browser and OpenAPI sidecar read the same project-scoped canonical state. Models can propose writes, but cannot approve their own conclusions.</p></section><div className="integration-grid"><article><span>Read context</span><strong>POST /api/context</strong><p>Blueprint, approved knowledge, supporting and challenging evidence, transfers, exploratory pathways, local context, exclusions, packet, and receipt.</p></article><article><span>Authorized writes</span><strong>Cases, evidence, outcomes, corrections</strong><p>Writes require authorization, retain idempotency, and create proposed—not automatically durable—knowledge.</p></article><article><span>OpenAPI</span><strong>/.well-known/openapi.json</strong><p>Public integration contract with project scope, retrieval scope, token budget, and inspectable responses.</p></article><article><span>MCP compatibility</span><strong>/mcp</strong><p>Initialization and tool calls are verified during the application test suite before any MCP claim is shown here.</p></article></div><details className="api-state"><summary>Current API-visible state <span>Schema V{state.schemaVersion}</span></summary><pre>{JSON.stringify({ workspaceId: state.workspaceId || "session workspace", projects: projects.map((item) => item.name), cases: state.cases.length, evidence: state.evidence.length, approvedKnowledge: state.knowledge.filter((item) => item.status === "Approved").length, pendingReviews: state.reviews.filter((item) => item.status === "Pending").length, contextPackets: state.contextPackets.length }, null, 2)}</pre></details></div>;
}

function CaptureModal({ projectKey, cases, type, setType, target, setTarget, onSubmit, onClose }: { projectKey: ProjectKey; cases: CaseRecord[]; type: CaptureType; setType: (type: CaptureType) => void; target: string; setTarget: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const project = projectByKey(projectKey);
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal capture-modal-v46" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Short, project-scoped capture</p><h2>Add to {project.name}</h2><small>Save first. Atlas will show exactly where it went and what should happen next.</small></div><button type="button" onClick={onClose}>×</button></header><label>Project<input value={project.name} readOnly /></label><label>Capture type<select name="type" value={type} onChange={(event) => setType(event.target.value as CaptureType)}>{captureTypes.map((item) => <option key={item}>{item}</option>)}</select></label>{type !== "New case or experience" && <label>Related case<select name="targetId" value={target} onChange={(event) => setTarget(event.target.value)}>{cases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}<label>What happened?<textarea name="content" required rows={5} placeholder={type === "Outcome" ? "Record the factual outcome without interpretation…" : "Describe the experience, evidence, correction, or observation…"} /></label><label>Optional local context<textarea name="localContext" rows={3} placeholder="Situation-specific context or the mechanism behind a proposed connection…" /></label><label>Evidence or source<input name="source" placeholder="Direct observation, research URL, screenshot, API caller…" /></label><div className="capture-boundary"><strong>Governance boundary</strong><p>Saving creates a record and receipt. It does not automatically create approved Knowledge or change retrieval.</p></div><button className="primary wide">Save and show receipt →</button></form></div>;
}

function TransitionReceipt({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal transition-receipt" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Transition receipt</p><h2>{receipt.title}</h2></div><button onClick={onClose}>×</button></header><div className="receipt-location"><span>Where it went</span><strong>{receipt.location}</strong></div><div className="state-transition"><article><span>Previous state</span><strong>{receipt.previousState}</strong></article><i>→</i><article><span>New state</span><strong>{receipt.newState}</strong></article></div><div className="receipt-details"><Detail label="Retrieval effect" value={receipt.retrieval} /><Detail label="API-visible state" value={receipt.api} />{receipt.pathway && <Detail label="Reconstruction pathway" value={receipt.pathway} />}<Detail label="Recommended next step" value={receipt.next} /></div><button className="primary wide" onClick={onClose}>Continue →</button></section></div>;
}

function EditReviewModal({ review, onClose, onApprove }: { review: ReviewRecord; onClose: () => void; onApprove: (text: string) => void }) {
  const [text, setText] = useState(review.proposal);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal edit-review" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Edit and approve</p><h2>{review.title}</h2></div><button onClick={onClose}>×</button></header><label>Approved wording<textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} /></label><div className="capture-boundary"><strong>Human authority</strong><p>Your edited wording becomes the governed record. Blueprint authority remains separate unless this is explicitly a Blueprint review.</p></div><button className="primary wide" onClick={() => onApprove(text)}>Approve edited version →</button></section></div>;
}

function ResetModal({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal reset-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">Reset Amy Campus demo</p><h2>Restore the seeded V4.6 proof?</h2></div><button onClick={onClose}>×</button></header><p>This restores seeded cases, evidence, Review, approved Knowledge, Blueprint versions, graph connections, transfer proposals, reconstruction pathways, packet history, and activity for this demo workspace.</p><div className="capture-boundary"><strong>Unrelated work stays safe</strong><p>The reset applies only to the current Amy Campus demo session.</p></div><button className="danger wide" onClick={onReset}>Restore seeded demo</button><button className="ghost wide" onClick={onClose}>Cancel</button></section></div>;
}

function MobileNav({ view, onNavigate }: { view: GlobalView; onNavigate: (view: GlobalView) => void }) {
  return <nav className="mobile-nav" aria-label="Campus Atlas mobile workspace">{globalDestinations.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>;
}

function CaseSection({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <section className="case-section"><header><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></header>{children}</section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail"><span>{label}</span><p>{value || "None"}</p></div>;
}

function AuditColumn({ label, values }: { label: string; values: string[] }) {
  return <section><span>{label}</span>{values.length ? values.map((item) => <p key={item}>{item}</p>) : <p className="empty-copy">Not yet captured.</p>}</section>;
}

function ActivityList({ items }: { items: ActivityRecord[] }) {
  return <div className="activity-list">{items.map((item) => <article key={item.id}><i /><div><span>{item.action} · {projectName(item.project)}</span><strong>{item.targetTitle}</strong><p>{item.consequence}</p><small>{item.actor} · {item.timestamp}</small></div></article>)}{!items.length && <EmptyState title="No meaningful activity yet" text="Captures and governed state changes will appear here—not cosmetic clicks or routine metadata updates." />}</div>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span>○</span><strong>{title}</strong><p>{text}</p>{action && onAction && <button className="ghost" onClick={onAction}>{action} →</button>}</div>;
}
