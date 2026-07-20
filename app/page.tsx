"use client";

import { FormEvent, useMemo, useState } from "react";

type ProjectKey = "hq" | "sports" | "training" | "lessons" | "human" | "finance";
type NodeType = "core" | "principle" | "pattern" | "observation" | "decision" | "correction";
type View = "atlas" | "sports";

type KnowledgeNode = {
  id: string;
  project: ProjectKey;
  room: string;
  type: NodeType;
  title: string;
  summary: string;
  confidence: number;
  support: number;
  status: "verified" | "inference" | "proposed";
  x: number;
  y: number;
  sources: string[];
  connected: string[];
  connectionWhy: string;
};

type Project = {
  key: ProjectKey;
  label: string;
  short: string;
  color: string;
  rooms: number;
  description: string;
  capabilityCount: number;
};

const projects: Project[] = [
  { key: "hq", label: "Headquarters", short: "HQ", color: "#a78bfa", rooms: 2, description: "Campus governance and promotion", capabilityCount: 1 },
  { key: "sports", label: "Sports Engine", short: "SE", color: "#4d7cfe", rooms: 4, description: "Research, pricing, and calibration", capabilityCount: 7 },
  { key: "training", label: "Health + Training", short: "HT", color: "#27d4c7", rooms: 3, description: "Load, recovery, and performance", capabilityCount: 2 },
  { key: "lessons", label: "Lessons Division", short: "LD", color: "#f4b860", rooms: 3, description: "Learning paths and reconstruction", capabilityCount: 2 },
  { key: "human", label: "Human Systems Lab", short: "HS", color: "#f58aa8", rooms: 2, description: "Patterns, experiments, and updates", capabilityCount: 1 },
  { key: "finance", label: "Finance", short: "FI", color: "#77d68b", rooms: 2, description: "Decisions, assumptions, and outcomes", capabilityCount: 1 },
];

const initialNodes: KnowledgeNode[] = [
  {
    id: "core-reality",
    project: "hq",
    room: "Core Lens",
    type: "core",
    title: "Reality corrects the model",
    summary: "Outcomes and explicit corrections outrank elegant inference. Durable claims remain traceable to evidence.",
    confidence: 96,
    support: 9,
    status: "verified",
    x: 50,
    y: 47,
    sources: ["Campus constitution v0.1", "Three explicit corrections"],
    connected: ["principle-fast", "principle-timeline", "pattern-overwork", "decision-england"],
    connectionWhy: "Campus-wide governance rule",
  },
  {
    id: "decision-england",
    project: "sports",
    room: "Decision Lab",
    type: "decision",
    title: "England +1.5 & Under 4.5",
    summary: "A competitive, controlled match was expected. France won 3–1; the combined market lost and triggered a post-mortem.",
    confidence: 68,
    support: 1,
    status: "verified",
    x: 18,
    y: 26,
    sources: ["Sports thesis 001", "Final result: France 3–1 England"],
    connected: ["pattern-format", "core-reality"],
    connectionWhy: "Outcome revised the original thesis",
  },
  {
    id: "pattern-format",
    project: "sports",
    room: "Precedent Library",
    type: "pattern",
    title: "Event format can break the base rate",
    summary: "Motivation, rotation, and variance can shift in special formats. The project blueprint now requires an explicit format adjustment.",
    confidence: 61,
    support: 2,
    status: "proposed",
    x: 30,
    y: 62,
    sources: ["Thesis 001 post-mortem", "Historical format note"],
    connected: ["decision-england", "core-reality", "principle-timeline"],
    connectionWhy: "Reusable lesson promoted from an outcome",
  },
  {
    id: "principle-fast",
    project: "training",
    room: "On-Ice Development",
    type: "principle",
    title: "Play fast. Don’t just skate hard.",
    summary: "Decision speed, scanning, support, and timing create more transfer than constant maximum exertion.",
    confidence: 86,
    support: 7,
    status: "verified",
    x: 78,
    y: 22,
    sources: ["On-Ice V2", "Seven skate observations"],
    connected: ["pattern-overwork", "core-reality"],
    connectionWhy: "Same effort-versus-utility mechanism",
  },
  {
    id: "pattern-overwork",
    project: "human",
    room: "Pattern Lab",
    type: "pattern",
    title: "More work is not always better",
    summary: "High drive becomes counterproductive when effort is spent on unwinnable pucks, excess volume, or recovery debt.",
    confidence: 82,
    support: 6,
    status: "verified",
    x: 79,
    y: 69,
    sources: ["Game reflection", "Training timeline", "Knee recovery notes"],
    connected: ["principle-fast", "principle-timeline", "core-reality"],
    connectionWhy: "Cross-project pattern with shared mechanism",
  },
  {
    id: "principle-timeline",
    project: "training",
    room: "Recovery Board",
    type: "principle",
    title: "Consider the timeline",
    summary: "Interpret today’s signal inside recent workload, recovery, and trajectory—not as an isolated reading.",
    confidence: 89,
    support: 8,
    status: "verified",
    x: 61,
    y: 84,
    sources: ["Health + Training Whiteboard", "Eight linked observations"],
    connected: ["pattern-overwork", "pattern-format", "core-reality"],
    connectionWhy: "Time-aware interpretation improves both domains",
  },
  {
    id: "principle-reconstruct",
    project: "lessons",
    room: "Software Engineering",
    type: "principle",
    title: "Connections preserve continuity",
    summary: "Knowledge compounds when relationships and reconstruction paths survive compression.",
    confidence: 91,
    support: 5,
    status: "verified",
    x: 49,
    y: 12,
    sources: ["Lessons Division", "Architecture review"],
    connected: ["core-reality", "principle-timeline"],
    connectionWhy: "Architectural principle for context retrieval",
  },
  {
    id: "correction-total",
    project: "sports",
    room: "Corrections",
    type: "correction",
    title: "Market options were overstated",
    summary: "The available total was corrected by the user. Future retrieval must distinguish researched markets from currently offered markets.",
    confidence: 99,
    support: 3,
    status: "verified",
    x: 17,
    y: 80,
    sources: ["Direct user correction", "Market screenshot"],
    connected: ["decision-england", "core-reality"],
    connectionWhy: "Explicit correction overrides prior assumption",
  },
];

const typeLabels: Record<NodeType, string> = {
  core: "Core lens",
  principle: "Principle",
  pattern: "Pattern",
  observation: "Observation",
  decision: "Decision case",
  correction: "Correction",
};

const sportsCapabilities = [
  ["Research-quality audit", "Checks whether the evidence is complete enough to price."],
  ["Probability + EV", "Separates predicted probability from the market price."],
  ["Lock Score", "Summarizes edge, evidence quality, uncertainty, and fragility."],
  ["Explainable precedent", "Retrieves prior cases and shows why each one matters."],
  ["Outcome post-mortem", "Compares the original thesis with what reality revealed."],
  ["Confidence calibration", "Tracks whether 70% calls behave like 70% calls over time."],
  ["Principle promotion", "Proposes reusable lessons for human approval."],
];

function projectFor(key: ProjectKey) {
  return projects.find((project) => project.key === key) ?? projects[0];
}

export default function Home() {
  const [nodes, setNodes] = useState(initialNodes);
  const [selectedId, setSelectedId] = useState("core-reality");
  const [project, setProject] = useState<ProjectKey | "all">("all");
  const [view, setView] = useState<View>("atlas");
  const [query, setQuery] = useState("");
  const [packetOpen, setPacketOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [campusOpen, setCampusOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Amy Campus");
  const [exampleMode, setExampleMode] = useState(true);

  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const visibleNodes = project === "all" ? nodes : nodes.filter((node) => node.project === project || node.type === "core");
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const edges = useMemo(() => {
    const seen = new Set<string>();
    return nodes.flatMap((node) =>
      node.connected.flatMap((target) => {
        const key = [node.id, target].sort().join("|");
        if (seen.has(key)) return [];
        seen.add(key);
        const to = nodes.find((candidate) => candidate.id === target);
        return to ? [{ from: node, to }] : [];
      }),
    );
  }, [nodes]);

  const packetNodes = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    return nodes
      .map((node) => {
        const text = `${node.title} ${node.summary} ${projectFor(node.project).label}`.toLowerCase();
        const keyword = words.reduce((score, word) => score + (text.includes(word) ? 18 : 0), 0);
        const link = selected.connected.includes(node.id) || node.connected.includes(selected.id) ? 20 : 0;
        const projectFit = project !== "all" && node.project === project ? 12 : 0;
        return { node, score: Math.min(99, Math.round(node.confidence * 0.42 + Math.min(node.support * 4, 24) + keyword + link + projectFit)) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [nodes, project, query, selected]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function openProject(key: ProjectKey) {
    if (key === "sports") {
      setView("sports");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setProject(key);
    flash(`${projectFor(key).label} filtered in the Atlas`);
  }

  function updateSelected(action: "reinforce" | "challenge" | "approve") {
    setNodes((current) => current.map((node) => {
      if (node.id !== selected.id) return node;
      if (action === "reinforce") return { ...node, support: node.support + 1, confidence: Math.min(99, node.confidence + 3) };
      if (action === "challenge") return { ...node, confidence: Math.max(10, node.confidence - 7), status: "inference" };
      return { ...node, status: "verified", confidence: Math.max(node.confidence, 72) };
    }));
    flash(action === "reinforce" ? "Support added — confidence recalibrated" : action === "challenge" ? "Challenge preserved — claim weakened" : "Human approval recorded");
  }

  function retrieve(event: FormEvent) {
    event.preventDefault();
    setPacketOpen(true);
  }

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedProject = String(data.get("project") || "human") as ProjectKey;
    const newNode: KnowledgeNode = {
      id: `observation-${Date.now()}`,
      project: selectedProject,
      room: "Inbox",
      type: "observation",
      title: String(data.get("title") || "Untitled observation"),
      summary: String(data.get("summary") || "Captured for later review."),
      confidence: 42,
      support: 1,
      status: "inference",
      x: 15 + Math.round(Math.random() * 70),
      y: 18 + Math.round(Math.random() * 65),
      sources: ["Direct user capture"],
      connected: [selected.id],
      connectionWhy: "New input linked for later review",
    };
    setNodes((current) => [...current, newNode]);
    setSelectedId(newNode.id);
    setCaptureOpen(false);
    flash("Observation captured and connected");
  }

  function createCampus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("campus") || "My Campus").trim();
    const firstProject = String(data.get("firstProject") || "My First Project").trim();
    setWorkspaceName(name);
    setExampleMode(false);
    setCampusOpen(false);
    setView("atlas");
    flash(`${name} created · ${firstProject} blueprint ready`);
  }

  if (view === "sports") {
    return (
      <main className="app-shell sports-shell">
        <header className="topbar">
          <button className="brand brand-button" onClick={() => setView("atlas")} aria-label="Back to Campus Atlas">
            <span className="brand-mark">CA</span>
            <span><strong>Campus Atlas</strong><small>Connected reasoning for ChatGPT Projects</small></span>
          </button>
          <div className="breadcrumb"><button onClick={() => setView("atlas")}>{workspaceName}</button><span>/</span><strong>Sports Engine</strong></div>
          <button className="ghost-button" onClick={() => setView("atlas")}>← Back to Atlas</button>
        </header>

        <section className="project-hero">
          <div>
            <p className="eyebrow"><span className="live-dot" /> Example project · specialized capability layer</p>
            <div className="project-title-row"><span className="project-emblem">SE</span><h1>Sports Engine</h1></div>
            <p>One ChatGPT Project that has grown beyond a folder of conversations. Its own blueprint turns research, decisions, corrections, and outcomes into a specialized reasoning system.</p>
          </div>
          <div className="project-health"><span>Blueprint maturity</span><strong>Stage 4</strong><div><i /></div><small>Reality-linked · 12 audited decisions</small></div>
        </section>

        <section className="sports-grid">
          <article className="sports-panel blueprint-panel">
            <div className="sports-panel-head"><div><p>Project blueprint</p><h2>How this project reasons</h2></div><span className="project-only">Sports Engine only</span></div>
            <div className="blueprint-flow">
              {["Research", "Audit", "Price", "Decide", "Outcome", "Promote"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < 5 && <i>→</i>}</div>)}
            </div>
            <div className="blueprint-rule"><span>Constitutional rule</span><p>No Lock Score before research quality is classified. No promoted principle without outcome evidence and human review.</p></div>
          </article>

          <article className="sports-panel decision-panel">
            <div className="sports-panel-head"><div><p>Decision case · closed</p><h2>England +1.5 & Under 4.5</h2></div><span className="loss-chip">Lost · 3–1</span></div>
            <div className="decision-metrics">
              <div><span>Research</span><strong className="amber">Partial</strong></div><div><span>Model probability</span><strong>68%</strong></div><div><span>Lock Score</span><strong>6.1</strong></div><div><span>Calibration delta</span><strong className="red">−18</strong></div>
            </div>
            <div className="postmortem"><span>Outcome-based update</span><p>The scoreline was plausible, but the thesis underweighted third-place format variance. A new format-adjustment principle is proposed—not automatically promoted.</p><button onClick={() => { setSelectedId("pattern-format"); setProject("sports"); setView("atlas"); }}>Open evidence chain →</button></div>
          </article>

          <article className="sports-panel capability-panel">
            <div className="sports-panel-head"><div><p>Emergent capabilities</p><h2>Built from this project’s history</h2></div><b>{sportsCapabilities.length}</b></div>
            <div className="capability-list">
              {sportsCapabilities.map(([name, copy], index) => <div key={name}><span>{index + 1}</span><div><strong>{name}</strong><p>{copy}</p></div><i>✓</i></div>)}
            </div>
          </article>

          <article className="sports-panel precedent-panel">
            <div className="sports-panel-head"><div><p>Explainable retrieval</p><h2>Why this precedent appeared</h2></div><span className="utility-score">84 utility</span></div>
            <div className="precedent-card"><span className="precedent-icon">↗</span><div><small>Precedent · format variance</small><strong>Knockout consolation matches</strong><p>Included because it shares the decision’s motivation uncertainty, rotation risk, and total-goals sensitivity.</p></div></div>
            <div className="audit-row"><span>Direct relevance</span><i><b style={{ width: "92%" }} /></i><strong>92</strong></div>
            <div className="audit-row"><span>Reality contact</span><i><b style={{ width: "78%" }} /></i><strong>78</strong></div>
            <div className="audit-row"><span>Source quality</span><i><b style={{ width: "65%" }} /></i><strong>65</strong></div>
            <p className="explain-note">Campus Atlas supplies the retrieval and audit infrastructure. Sports Engine supplies the sports-specific scoring logic.</p>
          </article>
        </section>

        <section className="boundary-callout">
          <div><p className="eyebrow">The architecture boundary</p><h2>Platform underneath. Project intelligence on top.</h2></div>
          <div className="boundary-columns"><div><span>Campus Atlas provides</span><p>Typed nodes · sources · confidence · connections · context packets · corrections · history · promotion controls</p></div><div><span>Sports Engine adds</span><p>Research audits · EV · Lock Scores · precedent logic · outcome post-mortems · calibration</p></div></div>
        </section>
        {toast && <div className="toast"><span>✓</span>{toast}</div>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Campus Atlas home">
          <span className="brand-mark">CA</span>
          <span><strong>Campus Atlas</strong><small>Connected reasoning for ChatGPT Projects</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <button className="nav-active">Atlas</button>
          <button onClick={() => document.getElementById("projects")?.scrollIntoView({ behavior: "smooth" })}>Projects</button>
          <button onClick={() => setPacketOpen(true)}>Context packets</button>
        </nav>
        <button className="primary-button" onClick={() => setCampusOpen(true)}><span>＋</span> Create your campus</button>
      </header>

      <section className="product-intro" id="top">
        <div>
          <p className="eyebrow">Durable reasoning infrastructure</p>
          <h1>Your ChatGPT Projects should<br /><em>build on each other.</em></h1>
          <p>Campus Atlas connects decisions, evidence, corrections, and principles across your projects—then returns useful context without flattening everything into one giant chat history.</p>
        </div>
        <div className="intro-actions"><button className="primary-button large" onClick={() => setCampusOpen(true)}>Build my campus <span>→</span></button><small>No special template required. You govern what becomes durable.</small></div>
      </section>

      <section className="demo-banner">
        <div><span className="example-chip">Example workspace</span><strong>{workspaceName}</strong><p>{exampleMode ? "A polished campus showing how multiple projects connect—and how one project develops specialized capabilities." : "Your new campus shell is ready. Amy Campus remains available as the reference example."}</p></div>
        {!exampleMode && <button onClick={() => { setWorkspaceName("Amy Campus"); setExampleMode(true); flash("Amy Campus example restored"); }}>View Amy Campus example</button>}
        {exampleMode && <span className="explore-note">Explore it, then make it yours ↘</span>}
      </section>

      <section className="project-strip" id="projects">
        <div className="strip-heading"><div><p>Projects inside this campus</p><h2>Each project keeps its own blueprint and capabilities.</h2></div><span>{projects.length} projects · 16 rooms</span></div>
        <div className="project-cards">
          {projects.filter((item) => item.key !== "hq").map((item) => (
            <button key={item.key} className={`project-card ${item.key === "sports" ? "featured" : ""}`} onClick={() => openProject(item.key)} style={{ "--project-color": item.color } as React.CSSProperties}>
              <span className="project-card-icon">{item.short}</span>
              <span><small>{item.rooms} rooms · {item.capabilityCount} {item.capabilityCount === 1 ? "capability" : "capabilities"}</small><strong>{item.label}</strong><p>{item.description}</p></span>
              <i>{item.key === "sports" ? "Open flagship example →" : "View in Atlas →"}</i>
            </button>
          ))}
        </div>
      </section>

      <section className="workspace" aria-label="Amy Campus knowledge graph">
        <aside className="room-panel panel">
          <div className="panel-heading"><div><p>Workspace</p><h2>{workspaceName}</h2><small>{exampleMode ? "Example campus" : "Personal campus"}</small></div><span className="castle">⌂</span></div>
          <button className={`room-button ${project === "all" ? "active" : ""}`} onClick={() => setProject("all")}>
            <span className="room-icon all">∞</span><span><strong>All projects</strong><small>Cross-project view</small></span><b>{nodes.length}</b>
          </button>
          <div className="room-list">
            {projects.map((item) => {
              const count = nodes.filter((node) => node.project === item.key).length;
              return (
                <button key={item.key} className={`room-button ${project === item.key ? "active" : ""}`} onClick={() => item.key === "sports" ? openProject(item.key) : setProject(item.key)}>
                  <span className="room-icon" style={{ "--room-color": item.color } as React.CSSProperties}>{item.short}</span>
                  <span><strong>{item.label}</strong><small>{item.rooms} rooms</small></span><b>{count}</b>
                </button>
              );
            })}
          </div>
          <div className="governance-note"><span>Human governed</span><p>Atlas can propose connections and promotions. You approve what becomes durable knowledge.</p></div>
        </aside>

        <section className="graph-panel panel">
          <div className="graph-toolbar">
            <div><p>Knowledge Atlas</p><h2>{project === "all" ? "Cross-project reasoning" : projectFor(project).label}</h2></div>
            <div className="legend"><span className="verified">Verified</span><span className="proposed">Proposed</span><span className="inference">Inference</span></div>
          </div>
          <div className="graph-canvas">
            <div className="grid-glow" />
            <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {edges.map(({ from, to }) => {
                const visible = visibleIds.has(from.id) && visibleIds.has(to.id);
                const selectedEdge = from.id === selected.id || to.id === selected.id;
                return <line key={`${from.id}-${to.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`${visible ? "visible-edge" : "hidden-edge"} ${selectedEdge ? "selected-edge" : ""}`} />;
              })}
            </svg>
            {visibleNodes.map((node) => {
              const itemProject = projectFor(node.project);
              const isSelected = node.id === selected.id;
              return (
                <button key={node.id} className={`graph-node ${node.type} ${node.status} ${isSelected ? "selected" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%`, "--node-color": itemProject.color } as React.CSSProperties} onClick={() => setSelectedId(node.id)} aria-label={`Open ${node.title}`}>
                  <span className="node-pulse" /><span className="node-core">{node.type === "core" ? "CA" : itemProject.short}</span><span className="node-label"><small>{typeLabels[node.type]}</small><strong>{node.title}</strong></span>
                </button>
              );
            })}
            <div className="graph-caption">Select a node to see its sources, confidence, revision state, and an explanation for every connection.</div>
          </div>
          <form className="retrieval-bar" onSubmit={retrieve}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What prior context should shape the next decision?" aria-label="Retrieval question" /><button type="submit">Build context packet <span>→</span></button></form>
        </section>

        <aside className="inspector panel">
          <div className="inspector-top"><div className="type-chip" style={{ "--node-color": projectFor(selected.project).color } as React.CSSProperties}>{typeLabels[selected.type]}</div><span className="revision-chip">v{selected.support}.2</span></div>
          <p className="room-name">{projectFor(selected.project).label} · {selected.room}</p><h2>{selected.title}</h2><p className="node-summary">{selected.summary}</p>
          <div className="confidence-block"><div><span>Confidence</span><strong>{selected.confidence}%</strong></div><div className="confidence-track"><i style={{ width: `${selected.confidence}%` }} /></div><small>{selected.status === "verified" ? "Supported by reality-linked evidence" : selected.status === "proposed" ? "Awaiting human review" : "Inference—do not present as fact"}</small></div>
          <div className="evidence-block"><div className="section-label"><span>Sources</span><b>{selected.sources.length}</b></div>{selected.sources.map((source, index) => <div className="source-row" key={source}><span>{index + 1}</span><p>{source}</p><i>↗</i></div>)}</div>
          <div className="connection-reason"><span>Why connected</span><p>{selected.connectionWhy}</p></div>
          <div className="connection-block"><div className="section-label"><span>Connected knowledge</span><b>{selected.connected.length}</b></div>{selected.connected.slice(0, 3).map((id) => { const linked = nodes.find((node) => node.id === id); return linked ? <button key={id} onClick={() => setSelectedId(id)}><i style={{ background: projectFor(linked.project).color }} /><span>{linked.title}</span><b>{linked.confidence}%</b></button> : null; })}</div>
          <div className="action-grid"><button onClick={() => updateSelected("reinforce")}>＋ Reinforce</button><button onClick={() => updateSelected("challenge")}>◇ Challenge</button>{selected.status !== "verified" && <button className="approve" onClick={() => updateSelected("approve")}>✓ Approve promotion</button>}</div>
        </aside>
      </section>

      <section className="platform-layer" id="platform-layer">
        <div className="loop-intro"><p className="eyebrow">The general Campus Atlas layer</p><h2>Infrastructure every project can use.</h2><p>Projects can become specialized without forcing their domain rules onto the rest of your campus.</p></div>
        <div className="platform-grid">{[
          ["Projects + rooms", "Keep boundaries meaningful while still enabling cross-project retrieval."],
          ["Typed knowledge", "Distinguish observations, claims, decisions, corrections, and principles."],
          ["Explainable links", "Show why knowledge is connected—not only that a similarity score exists."],
          ["Sources + confidence", "Trace durable claims to evidence and mark inference honestly."],
          ["Context packets", "Compile the smallest useful subgraph for the active ChatGPT Project."],
          ["Revision history", "Preserve corrections, challenges, superseded claims, and outcome updates."],
          ["Human promotion", "Let the system propose; let the person govern what becomes durable."],
          ["Project blueprints", "Allow each project to develop its own workflows and capabilities."],
        ].map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      {packetOpen && <div className="modal-backdrop" onMouseDown={() => setPacketOpen(false)}><section className="packet-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="packet-title"><div className="modal-header"><div><p>Explainable retrieval · packet 0042</p><h2 id="packet-title">Smallest useful subgraph</h2></div><button onClick={() => setPacketOpen(false)} aria-label="Close">×</button></div><div className="query-card"><span>Question</span><p>{query || "What prior knowledge should shape this decision?"}</p></div><div className="packet-list">{packetNodes.map(({ node, score }, index) => <article key={node.id}><span className="rank">0{index + 1}</span><div><small>{projectFor(node.project).label} · {typeLabels[node.type]}</small><h3>{node.title}</h3><p>{index === 0 ? "Selected for direct relevance, strong reality contact, and high reconstruction value." : node.connectionWhy}</p></div><strong>{score}<small>utility</small></strong></article>)}</div><div className="exclusion-note"><span>Excluded</span><p>{Math.max(0, nodes.length - packetNodes.length)} nodes omitted as redundant, weakly scoped, or low-utility for this question.</p></div><div className="packet-footer"><p><strong>{packetNodes.length} nodes</strong> · {Math.round(packetNodes.length * 86)} estimated tokens · source links preserved</p><button onClick={() => { setPacketOpen(false); flash("Context packet ready for the active ChatGPT Project"); }}>Send to Project <span>→</span></button></div></section></div>}

      {captureOpen && <div className="modal-backdrop" onMouseDown={() => setCaptureOpen(false)}><form className="capture-modal" onSubmit={capture} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>New knowledge input</p><h2>Capture an experience</h2></div><button type="button" onClick={() => setCaptureOpen(false)} aria-label="Close">×</button></div><label>Project<select name="project" defaultValue="human">{projects.filter((item) => item.key !== "hq").map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>What happened?<input name="title" required placeholder="One specific observation, decision, or correction" /></label><label>Why might it matter?<textarea name="summary" rows={4} placeholder="Separate what happened from your interpretation…" /></label><div className="capture-rule"><span>i</span><p>This begins as an inference-level observation. Atlas can connect it, but only evidence and human review can promote it.</p></div><button className="primary-button wide" type="submit">Capture and connect <span>→</span></button></form></div>}

      {campusOpen && <div className="modal-backdrop" onMouseDown={() => setCampusOpen(false)}><form className="capture-modal campus-modal" onSubmit={createCampus} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>Start with your structure</p><h2>Create your knowledge campus</h2></div><button type="button" onClick={() => setCampusOpen(false)} aria-label="Close">×</button></div><p className="modal-copy">Your campus connects ChatGPT Projects without erasing their boundaries. Begin with one project; its blueprint can evolve as you use it.</p><label>Campus name<input name="campus" required defaultValue="Cody Campus" /></label><label>First project<input name="firstProject" required placeholder="Research, School, Training, Work…" /></label><div className="starter-steps"><div><span>1</span><p><strong>Create a project</strong>Keep its purpose and rooms clear.</p></div><div><span>2</span><p><strong>Connect knowledge</strong>Capture sources, decisions, and corrections.</p></div><div><span>3</span><p><strong>Grow capabilities</strong>Let its blueprint become useful over time.</p></div></div><button className="primary-button wide" type="submit">Create campus <span>→</span></button></form></div>}

      <button className="floating-capture" onClick={() => setCaptureOpen(true)}>＋ Capture knowledge</button>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
