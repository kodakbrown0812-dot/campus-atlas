"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStewardTask } from "../../../components/steward-task";
import styles from "./inspect.module.css";

type CaseRecord = Record<string, unknown> & {
  id: string;
  objective: string;
  status: string;
  activeConstraints?: string[];
  pendingFindingCount?: number;
  reasoningHealth?: {
    state?: string;
    cause?: unknown;
    recommendedNextAction?: string;
  };
};

type ReasoningRecord = Record<string, unknown> & {
  id: string;
  statement: string;
  authority?: string;
  status?: string;
  uncertainty?: string | null;
};

type MechanismRecord = Record<string, unknown> & {
  id: string;
  statement: string;
  status?: string;
  authority?: string;
  updatedAt?: string;
  packetUseCount?: number;
};

type PacketRecord = Record<string, unknown> & {
  id: string;
  task: string;
  status?: string;
  createdAt?: string;
};

type Overview = {
  projectId: string;
  cases: CaseRecord[];
  reasoning: ReasoningRecord[];
  mechanisms: MechanismRecord[];
  principles: Array<Record<string, unknown>>;
  principlesNote: string;
  blueprint: Record<string, unknown> & { proposedRevisions: Array<Record<string, unknown>> };
  packets: PacketRecord[];
  advanced: {
    transfers: Array<Record<string, unknown> & { id: string; conversationTitle?: string; stage?: string }>;
    governance: Array<Record<string, unknown> & { id: string }>;
    roadways: Array<Record<string, unknown> & { id: string; name: string }>;
    liveState: Array<Record<string, unknown> & { id: string }>;
    evaluations: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown> & { id: string }>;
    handoffs: Array<Record<string, unknown> & { id: string }>;
  };
};

type MechanismVersion = {
  id: string;
  statement: string;
  authority?: string;
  status?: string;
  supersedesVersionId?: string | null;
};

type SourceEvent = {
  id: string;
  representation?: string;
  conversationTitle?: string | null;
  exactSourceSpan?: string | null;
  sourceLinks?: Array<{ messageId: string; href: string }>;
};

type MechanismDetail = {
  mechanism: { id: string; currentVersionId: string; status?: string };
  versions: MechanismVersion[];
  governance: Array<Record<string, unknown>>;
  sourceFinding: (Record<string, unknown> & { proposal_statement?: string }) | null;
  sourceEvents: SourceEvent[];
  packetUsage: Array<Record<string, unknown>>;
  historicalLimitations: string[];
};

type PacketDetail = {
  packet: Record<string, unknown> & { id: string; task: string; compiledContent: string };
  items: Array<Record<string, unknown> & {
    sourceType?: string;
    sourceId?: string;
    treatment?: string;
    authority?: string;
    reason?: string;
  }>;
  receipt: Record<string, unknown> & { id: string };
};

const views = ["Overview", "State", "Deliveries", "Advanced"] as const;
const technicalViews = [
  "Cases",
  "Reasoning",
  "Mechanisms",
  "Principles",
  "Blueprint",
  "Packets",
  "Transfers",
  "Governance",
  "Roadways",
  "Live state",
  "Evaluations",
  "Relationships",
  "Handoffs",
] as const;

function value(item: unknown) {
  if (item === null || item === undefined || item === "") return "Not recorded";
  if (Array.isArray(item)) return item.length ? item.join(", ") : "None";
  if (typeof item === "object") return JSON.stringify(item);
  return String(item);
}

function hasValue(item: unknown): item is string {
  return typeof item === "string" && item.trim().length > 0;
}

function humanize(item: unknown) {
  const text = value(item).replaceAll("_", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function authorityLabel(authority: unknown, status: unknown) {
  const combined = `${String(authority || "")} ${String(status || "")}`.toLowerCase();
  if (combined.includes("supersed") || combined.includes("historical")) return "Superseded";
  if (combined.includes("challeng")) return "Challenged";
  if (combined.includes("reject") || combined.includes("exclude")) return "Excluded";
  if (combined.includes("propos") || combined.includes("pending")) return "Proposed";
  if (combined.includes("consider")) return "Consider";
  if (combined.includes("approved") || combined.includes("active")) return "Governing";
  return "Observed";
}

function isGoverning(record: MechanismRecord) {
  return authorityLabel(record.authority, record.status) === "Governing";
}

function readableDate(item: unknown) {
  if (!hasValue(item)) return null;
  const date = new Date(item);
  return Number.isNaN(date.getTime())
    ? item
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function detailHref(projectId: string, type: string, id: string) {
  return `/projects/${encodeURIComponent(projectId)}/inspect/${type}/${encodeURIComponent(id)}`;
}

export default function InspectWorkspace({ projectId }: { projectId: string }) {
  const { recentDelivery } = useStewardTask();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mechanismDetails, setMechanismDetails] = useState<Record<string, MechanismDetail>>({});
  const [latestPacket, setLatestPacket] = useState<PacketDetail | null>(null);
  const [view, setView] = useState<typeof views[number]>("Overview");
  const [technicalView, setTechnicalView] = useState<typeof technicalViews[number]>("Cases");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/inspect`, { cache: "no-store" });
        const result = await response.json().catch(() => ({ error: "Inspect unavailable." })) as Overview & { error?: string };
        if (!response.ok) throw new Error(result.error || "Inspect unavailable.");
        if (!active) return;
        setOverview(result);

        const [details, packet] = await Promise.all([
          Promise.all(result.mechanisms.map(async (record) => {
            const detailResponse = await fetch(
              `/api/v1/projects/${encodeURIComponent(projectId)}/inspect/mechanisms/${encodeURIComponent(record.id)}`,
              { cache: "no-store" },
            );
            if (!detailResponse.ok) return null;
            return await detailResponse.json() as MechanismDetail;
          })),
          result.packets[0]
            ? fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/packets/${encodeURIComponent(result.packets[0].id)}`, { cache: "no-store" })
                .then(async (packetResponse) => packetResponse.ok ? await packetResponse.json() as PacketDetail : null)
            : Promise.resolve(null),
        ]);
        if (!active) return;
        setMechanismDetails(Object.fromEntries(details.filter((item): item is MechanismDetail => Boolean(item)).map((item) => [item.mechanism.id, item])));
        setLatestPacket(packet);
        setStatus("ready");
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Inspect unavailable.");
        setStatus("error");
      }
    }
    void load();
    return () => { active = false; };
  }, [projectId]);

  const changes = useMemo(() => Object.values(mechanismDetails).flatMap((detail) => {
    const current = detail.versions.find((item) => item.id === detail.mechanism.currentVersionId);
    if (!current?.supersedesVersionId) return [];
    const previous = detail.versions.find((item) => item.id === current.supersedesVersionId);
    if (!previous) return [];
    const governance = detail.governance.find((item) => item.resultingVersionId === current.id || item.resulting_version_id === current.id)
      || detail.governance.at(-1);
    return [{ detail, current, previous, reason: governance?.reason }];
  }), [mechanismDetails]);

  if (status === "loading") return <main className={styles.page}><section className={styles.panel}>Reading governed project truth and lineage…</section></main>;
  if (status === "error" || !overview) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <span>Inspect unavailable</span>
          <h1>Project truth could not load</h1>
          <p>{error}</p>
          <strong>No seeded records or browser reconstruction were substituted.</strong>
        </section>
      </main>
    );
  }

  const activeCase = overview.cases.find((record) => record.status === "active") || overview.cases[0] || null;
  const governing = overview.mechanisms.filter(isGoverning);
  const unresolved = overview.reasoning.filter((record) => {
    const state = `${record.status || ""} ${record.authority || ""}`.toLowerCase();
    return Boolean(record.uncertainty) || /proposed|challenged|pending|conflict/.test(state);
  });
  const projectDelivery = recentDelivery?.projectId === projectId ? recentDelivery : null;
  const lineageDetail = governing.map((record) => mechanismDetails[record.id]).find(Boolean) || null;
  const lineageRecord = lineageDetail
    ? governing.find((record) => record.id === lineageDetail.mechanism.id) || null
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>Inspect</span><h1>Project truth and proof</h1></div>
        <div>
          <p>Understand what Atlas currently believes, what changed, and which project truth it supplied to a task.</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/findings`}>Open needs review</Link>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Inspect views">
        {views.map((item) => <button aria-current={view === item ? "page" : undefined} key={item} onClick={() => setView(item)} type="button">{item}</button>)}
      </nav>
      <label className={styles.mobileSelector}>
        Inspect view
        <select onChange={(event) => setView(event.target.value as typeof view)} value={view}>
          {views.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>

      {view === "Overview" ? (
        <div className={styles.overviewStack}>
          <OverviewState activeCase={activeCase} governing={governing} projectId={projectId} unresolved={unresolved} />
          <section className={styles.section}>
            <SectionHeading eyebrow="Correction history" title="What changed" />
            {changes.length ? changes.map((change) => (
              <article className={styles.changeCard} key={change.current.id}>
                <div><span>Previous</span><p>{change.previous.statement}</p></div>
                <i aria-hidden="true">↓</i>
                <div><span>Changed to</span><p>{change.current.statement}</p></div>
                <div className={styles.changeReason}>
                  <span>Why</span>
                  <p>{hasValue(change.reason) ? change.reason : "Atlas records the supersession relationship, but no human-readable reason is attached."}</p>
                </div>
                <Link href={detailHref(projectId, "mechanisms", change.detail.mechanism.id)}>Trace this change</Link>
              </article>
            )) : (
              <Empty text="No governed supersession is recorded for the current project state." detail="Historical records remain available under Advanced." />
            )}
          </section>

          <section className={styles.section}>
            <SectionHeading eyebrow="Context Delivery" title="What Atlas supplied" />
            <DeliverySummary delivery={projectDelivery} latestPacket={latestPacket} projectId={projectId} />
          </section>

          <section className={styles.section}>
            <SectionHeading eyebrow="Source confidence" title="Readable lineage" />
            <LineageSummary detail={lineageDetail} projectId={projectId} record={lineageRecord} />
          </section>
        </div>
      ) : null}

      {view === "State" ? (
        <div className={styles.overviewStack}>
          <section className={styles.section}>
            <SectionHeading eyebrow="State Truth" title="Governing project state" />
            {overview.mechanisms.length ? (
              <div className={styles.truthList}>
                {overview.mechanisms.map((record) => (
                  <Link className={styles.truthRow} href={detailHref(projectId, "mechanisms", record.id)} key={record.id}>
                    <span className={styles.stateBadge} data-state={authorityLabel(record.authority, record.status).toLowerCase()}>{authorityLabel(record.authority, record.status)}</span>
                    <div><strong>{record.statement}</strong><p>{humanize(record.authority)} · {humanize(record.status)}</p></div>
                    <span>View proof →</span>
                  </Link>
                ))}
              </div>
            ) : <Empty text="No governed project statements are recorded." />}
          </section>
          <section className={styles.section}>
            <SectionHeading eyebrow="Authority boundary" title="Observed or unresolved state" />
            {overview.reasoning.length ? (
              <div className={styles.truthList}>
                {overview.reasoning.map((record) => (
                  <Link className={styles.truthRow} href={detailHref(projectId, "reasoning", record.id)} key={record.id}>
                    <span className={styles.stateBadge} data-state={authorityLabel(record.authority, record.status).toLowerCase()}>{authorityLabel(record.authority, record.status)}</span>
                    <div><strong>{record.statement}</strong><p>{record.uncertainty ? `Uncertainty: ${record.uncertainty}` : "No explicit uncertainty recorded."}</p></div>
                    <span>Inspect →</span>
                  </Link>
                ))}
              </div>
            ) : <Empty text="No observations or reasoning nodes are recorded." />}
          </section>
        </div>
      ) : null}

      {view === "Deliveries" ? (
        <section className={styles.section}>
          <SectionHeading eyebrow="Context Delivery" title="Task-specific selections" />
          {projectDelivery ? <DeliverySummary delivery={projectDelivery} latestPacket={latestPacket} projectId={projectId} /> : null}
          <div className={styles.deliveryList}>
            {overview.packets.map((packet) => (
              <Link className={styles.deliveryRow} href={detailHref(projectId, "packets", packet.id)} key={packet.id}>
                <span>Full context</span>
                <div><strong>{packet.task}</strong><p>{readableDate(packet.createdAt) || "Saved delivery"}</p></div>
                <span>Inspect delivery →</span>
              </Link>
            ))}
          </div>
          {!overview.packets.length && !projectDelivery ? <Empty text="No saved Full context deliveries exist yet." detail="Light and None do not create packet or receipt records. Their most recent server result is inspectable only during the current app session." /> : null}
        </section>
      ) : null}

      {view === "Advanced" ? (
        <TechnicalRecords
          overview={overview}
          projectId={projectId}
          setView={setTechnicalView}
          view={technicalView}
        />
      ) : null}
    </main>
  );
}

function OverviewState({ activeCase, governing, projectId, unresolved }: { activeCase: CaseRecord | null; governing: MechanismRecord[]; projectId: string; unresolved: ReasoningRecord[] }) {
  const constraints = Array.isArray(activeCase?.activeConstraints) ? activeCase.activeConstraints : [];
  const thesis = activeCase?.currentThesis;
  const decision = activeCase?.currentDecision;
  const outcome = activeCase?.outcomeState;
  const pending = Number(activeCase?.pendingFindingCount || 0);
  const nextAction = activeCase?.reasoningHealth?.recommendedNextAction;
  return (
    <section className={styles.section}>
      <SectionHeading eyebrow="State Truth" title="Current state" />
      <div className={styles.currentState}>
        <div className={styles.orientation}>
          <span>Current work</span>
          <h2>{activeCase?.objective || "No active canonical case is recorded"}</h2>
          {activeCase ? <Link href={detailHref(projectId, "cases", activeCase.id)}>Inspect this work</Link> : null}
        </div>
        <div className={styles.stateColumns}>
          <article><span>Current direction</span><p>{hasValue(decision) ? decision : "No governed current decision recorded for this case."}</p></article>
          <article><span>Important constraints</span>{constraints.length ? <ul>{constraints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No active constraints are recorded on this case.</p>}</article>
          <article><span>Open questions</span><p>{pending ? `${pending} finding${pending === 1 ? "" : "s"} need review.` : unresolved.length ? `${unresolved.length} observed or uncertain item${unresolved.length === 1 ? "" : "s"} remain non-governing.` : "No unresolved governed conflict is visible here."}</p></article>
          <article><span>Next action</span><p>{hasValue(nextAction) ? `Atlas recommends: ${nextAction}` : "No governed next action is recorded."}</p></article>
        </div>
        {governing.length ? (
          <div className={styles.governingSummary}>
            <span>Governing project truth</span>
            <ul>{governing.slice(0, 4).map((record) => <li key={record.id}>{record.statement}</li>)}</ul>
            {governing.length > 4 ? <p>{governing.length - 4} more governing statements are available in State.</p> : null}
          </div>
        ) : <p className={styles.honestNote}>No approved governing mechanism is recorded for this project.</p>}
        {(!hasValue(thesis) || !hasValue(outcome)) ? <p className={styles.honestNote}>Atlas has not yet governed {![thesis, outcome].some(hasValue) ? "a thesis or final outcome" : !hasValue(thesis) ? "a thesis" : "a final outcome"} for this case.</p> : null}
      </div>
    </section>
  );
}

function DeliverySummary({ delivery, latestPacket, projectId }: { delivery: ReturnType<typeof useStewardTask>["recentDelivery"]; latestPacket: PacketDetail | null; projectId: string }) {
  if (delivery?.projectId === projectId) {
    if (delivery.need.level === "none") {
      return <article className={styles.deliveryCard}><span>No context supplied · current session</span><h3>{delivery.literalTask}</h3><p>Atlas found no applicable governed project context to add. It did not claim the room already had sufficient context.</p><small>No packet or receipt was created.</small></article>;
    }
    if (delivery.need.level === "light" && delivery.capsule) {
      const sourceLink = delivery.capsule.sourceType === "mechanism" ? detailHref(projectId, "mechanisms", delivery.capsule.sourceId) : `/projects/${encodeURIComponent(projectId)}/inspect`;
      return (
        <article className={styles.deliveryCard}>
          <span>Compact context · current session</span>
          <h3>{delivery.literalTask}</h3>
          <p>Atlas supplied {delivery.capsule.includedItems === 1 ? "one governing item" : `${delivery.capsule.includedItems} governing items`} because it materially affected this task.</p>
          <pre>{delivery.capsule.compiledContent}</pre>
          <Link href={sourceLink}>Inspect the governed source</Link>
          <small>No packet or receipt was created. This exact server result is held only for the current app session.</small>
        </article>
      );
    }
  }
  if (latestPacket) {
    const used = latestPacket.items.filter((item) => item.treatment === "Use");
    return <article className={styles.deliveryCard}><span>Full context · saved delivery</span><h3>{latestPacket.packet.task}</h3><p>Atlas supplied {used.length} governing project {used.length === 1 ? "item" : "items"} because they materially affected the requested continuation.</p><Link href={detailHref(projectId, "packets", latestPacket.packet.id)}>Inspect this delivery</Link><small>This packet is a task-specific selection from State Truth, not a replacement for it.</small></article>;
  }
  return <Empty text="No Context Delivery is available to inspect." detail="A Full preparation will create a saved packet. Light and None remain mutation-free and are visible here only during the current app session." />;
}

function LineageSummary({ detail, projectId, record }: { detail: MechanismDetail | null; projectId: string; record: MechanismRecord | null }) {
  if (!detail || !record) return <Empty text="No governing statement is available for readable lineage." />;
  const current = detail.versions.find((item) => item.id === detail.mechanism.currentVersionId);
  const event = detail.sourceEvents[0];
  const source = event?.sourceLinks?.[0];
  return (
    <article className={styles.lineageCard}>
      <div><span>Current governing statement</span><strong>{current?.statement || record.statement}</strong></div><i aria-hidden="true">↓</i>
      <div><span>Approved or corrected</span><strong>{humanize(current?.authority || record.authority)} · {humanize(current?.status || record.status)}</strong></div><i aria-hidden="true">↓</i>
      <div><span>Finding or observation</span><strong>{detail.sourceFinding?.proposal_statement || "No readable source finding statement is available."}</strong></div><i aria-hidden="true">↓</i>
      <div><span>Exact conversation evidence</span>{event?.representation === "Exact" && source ? <><strong>{event.conversationTitle || "Exact source conversation"}</strong><Link href={source.href}>View exact evidence</Link></> : <strong>Complete Exact-message linkage is not available for this statement.</strong>}</div>
      {detail.historicalLimitations.length ? <p className={styles.honestNote}>{detail.historicalLimitations.join(" ")}</p> : null}
      <Link href={detailHref(projectId, "mechanisms", detail.mechanism.id)}>Open complete lineage</Link>
    </article>
  );
}

function TechnicalRecords({ overview, projectId, setView, view }: { overview: Overview; projectId: string; setView: (view: typeof technicalViews[number]) => void; view: typeof technicalViews[number] }) {
  const advanced = view === "Transfers" ? overview.advanced.transfers : view === "Governance" ? overview.advanced.governance : view === "Roadways" ? overview.advanced.roadways : view === "Live state" ? overview.advanced.liveState : view === "Evaluations" ? overview.advanced.evaluations : view === "Relationships" ? overview.advanced.relationships : overview.advanced.handoffs;
  const advancedView = (["Transfers", "Governance", "Roadways", "Live state", "Evaluations", "Relationships", "Handoffs"] as string[]).includes(view);
  return (
    <section className={styles.section}>
      <SectionHeading eyebrow="Advanced" title="Canonical record anatomy" />
      <p className={styles.sectionIntro}>Every technical view remains available. These records prove the readable projection above; they do not compete with it by default.</p>
      <label className={styles.technicalSelector}>Technical view<select onChange={(event) => setView(event.target.value as typeof view)} value={view}>{technicalViews.map((item) => <option key={item}>{item}</option>)}</select></label>
      {view === "Cases" ? <div className={styles.stack}>{!overview.cases.length ? <Empty text="No canonical cases exist in this project." /> : null}{overview.cases.map((record) => <article className={styles.record} key={record.id}><header><strong>{record.objective}</strong><span>{humanize(record.status)}</span></header><dl>{hasValue(record.currentDecision) ? <Row label="Current decision" value={record.currentDecision} /> : null}{hasValue(record.currentThesis) ? <Row label="Current thesis" value={record.currentThesis} /> : null}<Row label="Open review" value={record.pendingFindingCount ? `${record.pendingFindingCount} findings` : "None"} /><Row label="Last meaningful change" value={readableDate(record.lastChanged) || "No timestamp recorded"} /></dl><Link href={detailHref(projectId, "cases", record.id)}>Open full case lineage</Link><details><summary>Raw case anatomy</summary><pre>{JSON.stringify(record, null, 2)}</pre></details></article>)}</div> : null}
      {view === "Reasoning" ? <TechnicalList projectId={projectId} records={overview.reasoning} type="reasoning" /> : null}
      {view === "Mechanisms" ? <TechnicalList projectId={projectId} records={overview.mechanisms} type="mechanisms" /> : null}
      {view === "Principles" ? <div className={styles.stack}>{overview.principles.length ? overview.principles.map((item) => <Raw key={String(item.id)} item={item} />) : <Empty text="No principles have been approved." detail={overview.principlesNote} />}</div> : null}
      {view === "Blueprint" ? <article className={styles.record}><header><strong>{value(overview.blueprint.version)}</strong><span>Frozen authority</span></header><details><summary>View Blueprint anatomy</summary><pre>{JSON.stringify(overview.blueprint, null, 2)}</pre></details></article> : null}
      {view === "Packets" ? <TechnicalList projectId={projectId} records={overview.packets} type="packets" /> : null}
      {advancedView ? <div className={styles.stack}>{!advanced.length ? <Empty text={`No canonical ${view.toLowerCase()} records exist.`} /> : null}{advanced.map((record) => view === "Transfers" ? <Link className={styles.record} href={detailHref(projectId, "transfers", String(record.id))} key={String(record.id)}><header><strong>{String(record.conversationTitle || "Transferred room")}</strong><span>{String(record.stage || "received")}</span></header><p>Open the preserved conversation, exact evidence, governance, and downstream use.</p></Link> : <Raw key={String(record.id || JSON.stringify(record))} item={record} />)}</div> : null}
    </section>
  );
}

function TechnicalList({ projectId, records, type }: { projectId: string; records: Array<Record<string, unknown> & { id: string }>; type: string }) {
  return <div className={styles.stack}>{!records.length ? <Empty text={`No canonical ${type} records exist.`} /> : null}{records.map((record) => <article className={styles.record} key={record.id}><header><strong>{String(record.statement || record.task || record.objective || record.id)}</strong><span>{humanize(record.status)}</span></header><Link href={detailHref(projectId, type, record.id)}>Open complete record</Link><details><summary>Raw canonical anatomy</summary><pre>{JSON.stringify(record, null, 2)}</pre></details></article>)}</div>;
}

function Raw({ item }: { item: Record<string, unknown> }) {
  return <details className={styles.rawRecord}><summary>Raw canonical record</summary><pre>{JSON.stringify(item, null, 2)}</pre></details>;
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <header className={styles.sectionHeading}><span>{eyebrow}</span><h2>{title}</h2></header>;
}

function Row({ label, value: item }: { label: string; value: unknown }) {
  return <div><dt>{label}</dt><dd>{value(item)}</dd></div>;
}

function Empty({ text, detail }: { text: string; detail?: string }) {
  return <article className={styles.empty}><strong>{text}</strong>{detail ? <p>{detail}</p> : null}</article>;
}
