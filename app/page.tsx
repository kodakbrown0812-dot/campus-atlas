"use client";

import { FormEvent, useMemo, useState } from "react";

type RoomKey = "hq" | "sports" | "training" | "lessons" | "human" | "finance";
type NodeType = "core" | "principle" | "pattern" | "observation" | "decision";

type MemoryNode = {
  id: string;
  room: RoomKey;
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
};

const rooms: { key: RoomKey; label: string; short: string; color: string }[] = [
  { key: "hq", label: "Headquarters", short: "HQ", color: "#a78bfa" },
  { key: "sports", label: "Sports Analytics", short: "SA", color: "#4d7cfe" },
  { key: "training", label: "Health + Training", short: "HT", color: "#27d4c7" },
  { key: "lessons", label: "Lessons Division", short: "LD", color: "#f4b860" },
  { key: "human", label: "Human Systems Lab", short: "HS", color: "#f58aa8" },
  { key: "finance", label: "Finance", short: "FI", color: "#77d68b" },
];

const initialNodes: MemoryNode[] = [
  {
    id: "core-reality",
    room: "hq",
    type: "core",
    title: "Reality corrects the model",
    summary: "Outcomes and explicit user corrections outrank elegant inference. Durable claims remain traceable to evidence.",
    confidence: 96,
    support: 9,
    status: "verified",
    x: 50,
    y: 47,
    sources: ["Rebar Blueprint v0.1", "Three explicit corrections"],
    connected: ["principle-fast", "principle-timeline", "pattern-overwork", "decision-england"],
  },
  {
    id: "decision-england",
    room: "sports",
    type: "decision",
    title: "England +1.5 & Under 4.5",
    summary: "A competitive, controlled third-place match was expected. France won 3–1; the combined market lost.",
    confidence: 68,
    support: 1,
    status: "verified",
    x: 19,
    y: 25,
    sources: ["Thesis 001", "Final result: France 3–1 England"],
    connected: ["pattern-format", "core-reality"],
  },
  {
    id: "pattern-format",
    room: "sports",
    type: "pattern",
    title: "Event format can break the base rate",
    summary: "Third-place matches can produce unusual motivation, rotation, and variance. Format deserves an explicit adjustment.",
    confidence: 61,
    support: 2,
    status: "proposed",
    x: 30,
    y: 60,
    sources: ["Thesis 001 post-mortem", "Historical format note"],
    connected: ["decision-england", "core-reality", "principle-timeline"],
  },
  {
    id: "principle-fast",
    room: "training",
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
  },
  {
    id: "pattern-overwork",
    room: "human",
    type: "pattern",
    title: "More work is not always better",
    summary: "High drive becomes counterproductive when effort is spent on unwinnable pucks, excess volume, or recovery debt.",
    confidence: 82,
    support: 6,
    status: "verified",
    x: 79,
    y: 68,
    sources: ["Game reflection", "Training timeline", "Knee recovery notes"],
    connected: ["principle-fast", "principle-timeline", "core-reality"],
  },
  {
    id: "principle-timeline",
    room: "training",
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
  },
  {
    id: "principle-reconstruct",
    room: "lessons",
    type: "principle",
    title: "Connections preserve continuity",
    summary: "Knowledge compounds when relationships and reconstruction paths survive compression.",
    confidence: 91,
    support: 5,
    status: "verified",
    x: 49,
    y: 12,
    sources: ["Lessons Division", "Rebar architecture review"],
    connected: ["core-reality", "principle-timeline"],
  },
];

const typeLabels: Record<NodeType, string> = {
  core: "Core lens",
  principle: "Whiteboard principle",
  pattern: "Pattern",
  observation: "Observation",
  decision: "Decision case",
};

function roomFor(key: RoomKey) {
  return rooms.find((room) => room.key === key) ?? rooms[0];
}

export default function Home() {
  const [nodes, setNodes] = useState(initialNodes);
  const [selectedId, setSelectedId] = useState("core-reality");
  const [room, setRoom] = useState<RoomKey | "all">("all");
  const [query, setQuery] = useState("");
  const [packetOpen, setPacketOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [toast, setToast] = useState("");

  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const visibleNodes = room === "all" ? nodes : nodes.filter((node) => node.room === room || node.type === "core");
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
    const ranked = nodes
      .map((node) => {
        const text = `${node.title} ${node.summary} ${roomFor(node.room).label}`.toLowerCase();
        const keyword = words.reduce((score, word) => score + (text.includes(word) ? 18 : 0), 0);
        const link = selected.connected.includes(node.id) || node.connected.includes(selected.id) ? 20 : 0;
        return { node, score: Math.round(node.confidence * 0.45 + Math.min(node.support * 4, 24) + keyword + link) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    return ranked;
  }, [nodes, query, selected]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function updateSelected(action: "reinforce" | "challenge" | "approve") {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selected.id) return node;
        if (action === "reinforce") return { ...node, support: node.support + 1, confidence: Math.min(99, node.confidence + 3) };
        if (action === "challenge") return { ...node, confidence: Math.max(10, node.confidence - 7), status: "inference" };
        return { ...node, status: "verified", confidence: Math.max(node.confidence, 72) };
      }),
    );
    flash(action === "reinforce" ? "Support added — confidence recalibrated" : action === "challenge" ? "Challenge preserved — claim weakened" : "Human approval recorded");
  }

  function retrieve(event: FormEvent) {
    event.preventDefault();
    setPacketOpen(true);
  }

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "Untitled observation");
    const selectedRoom = String(data.get("room") || "human") as RoomKey;
    const newNode: MemoryNode = {
      id: `observation-${Date.now()}`,
      room: selectedRoom,
      type: "observation",
      title,
      summary: String(data.get("summary") || "Captured for later review."),
      confidence: 42,
      support: 1,
      status: "inference",
      x: 15 + Math.round(Math.random() * 70),
      y: 18 + Math.round(Math.random() * 65),
      sources: ["Direct user capture"],
      connected: [selected.id],
    };
    setNodes((current) => [...current, newNode]);
    setSelectedId(newNode.id);
    setCaptureOpen(false);
    flash("Observation captured and connected");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Rebar home">
          <span className="brand-mark">R</span>
          <span><strong>Rebar</strong><small>Decision memory for ChatGPT Projects</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <button className="nav-active">Campus Atlas</button>
          <button onClick={() => document.getElementById("learning-loop")?.scrollIntoView({ behavior: "smooth" })}>Learning loop</button>
          <button onClick={() => setPacketOpen(true)}>Context packets</button>
        </nav>
        <button className="primary-button" onClick={() => setCaptureOpen(true)}><span>＋</span> Capture experience</button>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow"><span className="live-dot" /> Amy Campus · live graph</p>
          <h1>Memory should become<br /><em>connected understanding.</em></h1>
          <p className="hero-copy">Rebar runs beside ChatGPT Projects—preserving why decisions were made, linking evidence across rooms, and returning the smallest useful context when it matters.</p>
        </div>
        <div className="hero-stats" aria-label="Graph statistics">
          <div><strong>{nodes.length}</strong><span>knowledge nodes</span></div>
          <div><strong>{edges.length}</strong><span>traceable connections</span></div>
          <div><strong>94%</strong><span>correction adoption</span></div>
        </div>
      </section>

      <section className="workspace" aria-label="Campus knowledge graph">
        <aside className="room-panel panel">
          <div className="panel-heading"><div><p>Institution</p><h2>Amy Campus</h2></div><span className="castle">⌂</span></div>
          <button className={`room-button ${room === "all" ? "active" : ""}`} onClick={() => setRoom("all")}>
            <span className="room-icon all">∞</span><span><strong>All connections</strong><small>Cross-room view</small></span><b>{nodes.length}</b>
          </button>
          <div className="room-list">
            {rooms.map((item) => {
              const count = nodes.filter((node) => node.room === item.key).length;
              return (
                <button key={item.key} className={`room-button ${room === item.key ? "active" : ""}`} onClick={() => setRoom(item.key)}>
                  <span className="room-icon" style={{ "--room-color": item.color } as React.CSSProperties}>{item.short}</span>
                  <span><strong>{item.label}</strong><small>{count} active nodes</small></span><b>{count}</b>
                </button>
              );
            })}
          </div>
          <div className="governance-note">
            <span>Human governed</span>
            <p>Rebar can propose. Cody + Headquarters approve what becomes institutional.</p>
          </div>
        </aside>

        <section className="graph-panel panel">
          <div className="graph-toolbar">
            <div><p>Knowledge graph</p><h2>{room === "all" ? "Campus-wide reasoning" : roomFor(room).label}</h2></div>
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
              const itemRoom = roomFor(node.room);
              const isSelected = node.id === selected.id;
              return (
                <button
                  key={node.id}
                  className={`graph-node ${node.type} ${node.status} ${isSelected ? "selected" : ""}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%`, "--node-color": itemRoom.color } as React.CSSProperties}
                  onClick={() => setSelectedId(node.id)}
                  aria-label={`Open ${node.title}`}
                >
                  <span className="node-pulse" />
                  <span className="node-core">{node.type === "core" ? "R" : itemRoom.short}</span>
                  <span className="node-label"><small>{typeLabels[node.type]}</small><strong>{node.title}</strong></span>
                </button>
              );
            })}
            <div className="graph-caption">Connections brighten when a node is selected. Line strength represents retrieval usefulness—not simple keyword similarity.</div>
          </div>
          <form className="retrieval-bar" onSubmit={retrieve}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask Rebar what matters before the next decision…" aria-label="Retrieval question" />
            <button type="submit">Build context packet <span>→</span></button>
          </form>
        </section>

        <aside className="inspector panel">
          <div className="inspector-top">
            <div className="type-chip" style={{ "--node-color": roomFor(selected.room).color } as React.CSSProperties}>{typeLabels[selected.type]}</div>
            <button aria-label="More actions">•••</button>
          </div>
          <p className="room-name">{roomFor(selected.room).label}</p>
          <h2>{selected.title}</h2>
          <p className="node-summary">{selected.summary}</p>

          <div className="confidence-block">
            <div><span>Confidence</span><strong>{selected.confidence}%</strong></div>
            <div className="confidence-track"><i style={{ width: `${selected.confidence}%` }} /></div>
            <small>{selected.status === "verified" ? "Supported by reality-linked evidence" : selected.status === "proposed" ? "Awaiting human review" : "Inference—do not present as fact"}</small>
          </div>

          <div className="evidence-block">
            <div className="section-label"><span>Evidence trail</span><b>{selected.sources.length}</b></div>
            {selected.sources.map((source, index) => <div className="source-row" key={source}><span>{index + 1}</span><p>{source}</p><i>↗</i></div>)}
          </div>

          <div className="connection-block">
            <div className="section-label"><span>Connected knowledge</span><b>{selected.connected.length}</b></div>
            {selected.connected.slice(0, 3).map((id) => {
              const linked = nodes.find((node) => node.id === id);
              return linked ? <button key={id} onClick={() => setSelectedId(id)}><i style={{ background: roomFor(linked.room).color }} /><span>{linked.title}</span><b>{linked.confidence}%</b></button> : null;
            })}
          </div>

          <div className="action-grid">
            <button onClick={() => updateSelected("reinforce")}>＋ Reinforce</button>
            <button onClick={() => updateSelected("challenge")}>◇ Challenge</button>
            {selected.status !== "verified" && <button className="approve" onClick={() => updateSelected("approve")}>✓ Approve promotion</button>}
          </div>
        </aside>
      </section>

      <section className="learning-loop" id="learning-loop">
        <div className="loop-intro">
          <p className="eyebrow">How Rebar improves the system</p>
          <h2>Better context—not pretend retraining.</h2>
          <p>ChatGPT still reasons. Rebar makes each future reasoning pass start from a more accurate, connected, and efficiently reconstructed picture.</p>
        </div>
        <div className="loop-steps">
          {[
            ["01", "Capture", "Decisions, observations, outcomes, and corrections become typed evidence."],
            ["02", "Connect", "Relationships gain strength from support, contradiction, scope, and reality contact."],
            ["03", "Retrieve", "Expected usefulness selects a small subgraph; every inclusion and exclusion is auditable."],
            ["04", "Compile", "Rebar sends the Project a transparent context packet—not a dump of old files."],
            ["05", "Correct", "Reality and Cody’s corrections revise confidence, edges, and future retrieval."],
          ].map(([number, title, copy], index) => (
            <article key={number}><span>{number}</span><div className="loop-node">{index === 4 ? "↻" : "•"}</div><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </div>
      </section>

      {packetOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPacketOpen(false)}>
          <section className="packet-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="packet-title">
            <div className="modal-header"><div><p>Retrieval audit · packet 0042</p><h2 id="packet-title">Smallest useful subgraph</h2></div><button onClick={() => setPacketOpen(false)} aria-label="Close">×</button></div>
            <div className="query-card"><span>Question</span><p>{query || "What prior knowledge should shape this decision?"}</p></div>
            <div className="packet-list">
              {packetNodes.map(({ node, score }, index) => (
                <article key={node.id}><span className="rank">0{index + 1}</span><div><small>{roomFor(node.room).label} · {typeLabels[node.type]}</small><h3>{node.title}</h3><p>{index === 0 ? "Selected for direct relevance, strong reality contact, and high reconstruction value." : "Selected through a traceable connection to the active decision and calibrated support."}</p></div><strong>{score}<small>utility</small></strong></article>
              ))}
            </div>
            <div className="exclusion-note"><span>Excluded</span><p>{Math.max(0, nodes.length - packetNodes.length)} nodes omitted as redundant, weakly scoped, or low-utility for this question.</p></div>
            <div className="packet-footer"><p><strong>{packetNodes.length} nodes</strong> · {Math.round(packetNodes.length * 86)} estimated tokens · source links preserved</p><button onClick={() => { setPacketOpen(false); flash("Context packet ready for ChatGPT Project"); }}>Send to Project <span>→</span></button></div>
          </section>
        </div>
      )}

      {captureOpen && (
        <div className="modal-backdrop" onMouseDown={() => setCaptureOpen(false)}>
          <form className="capture-modal" onSubmit={capture} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><p>New graph input</p><h2>Capture an experience</h2></div><button type="button" onClick={() => setCaptureOpen(false)} aria-label="Close">×</button></div>
            <label>Room<select name="room" defaultValue="human">{rooms.filter((item) => item.key !== "hq").map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
            <label>What happened?<input name="title" required placeholder="One specific observation or decision" /></label>
            <label>Why might it matter?<textarea name="summary" rows={4} placeholder="Separate what happened from your interpretation…" /></label>
            <div className="capture-rule"><span>i</span><p>This begins as an inference-level Observation. Rebar will connect it, but only evidence and human review can promote it.</p></div>
            <button className="primary-button wide" type="submit">Capture and connect <span>→</span></button>
          </form>
        </div>
      )}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
