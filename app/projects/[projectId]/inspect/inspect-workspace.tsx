"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./inspect.module.css";

type Overview = {
  projectId: string;
  cases: Array<Record<string, unknown> & { id: string; objective: string }>;
  reasoning: Array<Record<string, unknown> & { id: string; statement: string }>;
  mechanisms: Array<Record<string, unknown> & { id: string; statement: string }>;
  principles: Array<Record<string, unknown>>;
  principlesNote: string;
  blueprint: Record<string, unknown> & { proposedRevisions: Array<Record<string, unknown>> };
  packets: Array<Record<string, unknown> & { id: string; task: string }>;
  advanced: {
    governance: Array<Record<string, unknown> & { id: string }>;
    roadways: Array<Record<string, unknown> & { id: string; name: string }>;
    liveState: Array<Record<string, unknown> & { id: string }>;
    evaluations: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown> & { id: string }>;
    handoffs: Array<Record<string, unknown> & { id: string }>;
  };
};

const tabs = ["Cases", "Reasoning", "Mechanisms", "Principles", "Blueprint", "Packets", "Advanced"] as const;

function value(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function InspectWorkspace({ projectId }: { projectId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>("Cases");
  const [advancedTab, setAdvancedTab] = useState("Governance");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/inspect`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({ error: "Inspect unavailable." })) as Overview & { error?: string };
        if (!response.ok) throw new Error(result.error || "Inspect unavailable.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Inspect unavailable.");
        setStatus("error");
      });
    return () => { active = false; };
  }, [projectId]);

  if (status === "loading") return <main className={styles.page}><section className={styles.panel}>Loading canonical records and lineage…</section></main>;
  if (status === "error" || !overview) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <span>Canonical Inspect unavailable</span>
          <h1>Inspection could not load</h1>
          <p>{error}</p>
          <strong>No seeded records or frontend reconstruction were substituted.</strong>
        </section>
      </main>
    );
  }

  const advanced = overview.advanced[advancedTab === "Governance"
    ? "governance"
    : advancedTab === "Roadways"
      ? "roadways"
      : advancedTab === "Live state"
        ? "liveState"
        : advancedTab === "Evaluations"
          ? "evaluations"
          : advancedTab === "Relationships"
            ? "relationships"
            : "handoffs"];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>Canonical inspection · {projectId}</span><h1>Readable lineage</h1></div>
        <p>Inspect source, versions, authority, challenges, governance, and downstream use without editing history.</p>
      </header>
      <nav className={styles.tabs} aria-label="Inspect records">
        {tabs.map((item) => <button aria-current={tab === item ? "page" : undefined} key={item} onClick={() => setTab(item)} type="button">{item}</button>)}
      </nav>

      {tab === "Cases" && (
        <section className={styles.stack}>
          {!overview.cases.length && <Empty text="No canonical cases exist in this project." />}
          {overview.cases.map((record) => (
            <Link className={styles.record} href={detailHref(projectId, "cases", record.id)} key={record.id}>
              <header><strong>{record.objective}</strong><span>{value(record.status)}</span></header>
              <dl>
                <Row label="Current thesis" value={record.currentThesis} />
                <Row label="Current decision" value={record.currentDecision} />
                <Row label="Reasoning Health" value={(record.reasoningHealth as Record<string, unknown> | undefined)?.state} />
                <Row label="Health cause / next action" value={`${value((record.reasoningHealth as Record<string, unknown> | undefined)?.cause)} / ${value((record.reasoningHealth as Record<string, unknown> | undefined)?.recommendedNextAction)}`} />
                <Row label="Outcome / postmortem" value={`${value(record.outcomeState)} / ${value(record.postmortemState)}`} />
                <Row label="Pending findings" value={record.pendingFindingCount} />
                <Row label="Packet influence" value={record.packetInfluence} />
                <Row label="Last changed" value={record.lastChanged} />
              </dl>
            </Link>
          ))}
        </section>
      )}
      {tab === "Reasoning" && (
        <section className={styles.stack}>
          {!overview.reasoning.length && <Empty text="No reasoning nodes have been selected for this project." />}
          {overview.reasoning.map((record) => (
            <Link className={styles.record} href={detailHref(projectId, "reasoning", record.id)} key={record.id}>
              <header><strong>{record.statement}</strong><span>{value(record.type)}</span></header>
              <dl>
                <Row label="Representation" value={record.representation} />
                <Row label="Case" value={record.caseId} />
                <Row label="Scope / authority" value={`${value(record.scope)} / ${value(record.authority)}`} />
                <Row label="Status / version" value={`${value(record.status)} / ${value(record.currentVersionId)}`} />
                <Row label="Evidence / challenge" value={`${value(record.evidenceLinks)} / ${value(record.counterevidenceLinks)}`} />
              </dl>
            </Link>
          ))}
        </section>
      )}
      {tab === "Mechanisms" && (
        <section className={styles.stack}>
          {!overview.mechanisms.length && <Empty text="No governed mechanisms exist in this project." />}
          {overview.mechanisms.map((record) => (
            <Link className={styles.record} href={detailHref(projectId, "mechanisms", record.id)} key={record.id}>
              <header><strong>{record.statement}</strong><span>{value(record.status)}</span></header>
              <dl>
                <Row label="Scope conditions" value={record.scopeConditions} />
                <Row label="Exclusions" value={record.exclusions} />
                <Row label="Authority" value={record.authority} />
                <Row label="Supporting cases" value={record.supportingCaseIds} />
                <Row label="Strongest challenge" value={record.counterevidenceIds} />
                <Row label="Governing version / packet use" value={`${value(record.currentVersionId)} / ${value(record.packetUseCount)}`} />
              </dl>
              <small>Approval is scoped authority, not universal truth.</small>
            </Link>
          ))}
        </section>
      )}
      {tab === "Principles" && (
        <section className={styles.stack}>
          {!overview.principles.length && <Empty text="No principles have been approved." detail={overview.principlesNote} />}
        </section>
      )}
      {tab === "Blueprint" && (
        <section className={styles.record}>
          <header><strong>{value(overview.blueprint.version)}</strong><span>Frozen authority</span></header>
          <dl>
            {Object.entries(overview.blueprint).filter(([key]) => key !== "proposedRevisions").map(([key, item]) => <Row key={key} label={key} value={item} />)}
          </dl>
          <h3>Proposed revisions remain separate</h3>
          {overview.blueprint.proposedRevisions.length
            ? overview.blueprint.proposedRevisions.map((item) => <pre key={String(item.id)}>{JSON.stringify(item, null, 2)}</pre>)
            : <p>No Blueprint revision is awaiting governance.</p>}
        </section>
      )}
      {tab === "Packets" && (
        <section className={styles.stack}>
          {!overview.packets.length && <Empty text="No packets exist yet." detail="Packets appear after Atlas reconstructs governed context for a task." />}
          {overview.packets.map((record) => (
            <Link className={styles.record} href={detailHref(projectId, "packets", record.id)} key={record.id}>
              <header><strong>{record.task}</strong><span>{value(record.status)}</span></header>
              <dl>
                <Row label="Roadway" value={record.primaryRoadwayId} />
                <Row label="Token budget / final size" value={`${value(record.tokenBudget)} / ${value(record.finalSize)}`} />
                <Row label="Created" value={record.createdAt} />
                <Row label="Prior packet" value={record.priorComparablePacketId} />
                <Row label="Receiving model / handoff" value={`${value(record.receivingModel)} / ${value(record.handoffStatus)}`} />
                <Row label="Answer reference" value={record.answerReference} />
              </dl>
            </Link>
          ))}
        </section>
      )}
      {tab === "Advanced" && (
        <>
          <nav className={styles.subtabs}>
            {["Governance", "Roadways", "Live state", "Evaluations", "Relationships", "Handoffs"].map((item) => (
              <button aria-current={advancedTab === item ? "page" : undefined} key={item} onClick={() => setAdvancedTab(item)} type="button">{item}</button>
            ))}
          </nav>
          <section className={styles.stack}>
            {!advanced.length && <Empty text={`No canonical ${advancedTab.toLowerCase()} records exist.`} />}
            {advanced.map((record) => <pre className={styles.rawRecord} key={String(record.id || JSON.stringify(record))}>{JSON.stringify(record, null, 2)}</pre>)}
          </section>
        </>
      )}
    </main>
  );
}

function detailHref(projectId: string, type: string, id: string) {
  return `/projects/${encodeURIComponent(projectId)}/inspect/${type}/${encodeURIComponent(id)}`;
}

function Row({ label, value: item }: { label: string; value: unknown }) {
  return <div><dt>{label}</dt><dd>{value(item)}</dd></div>;
}

function Empty({ text, detail }: { text: string; detail?: string }) {
  return <article className={styles.empty}><strong>{text}</strong>{detail && <p>{detail}</p>}</article>;
}
