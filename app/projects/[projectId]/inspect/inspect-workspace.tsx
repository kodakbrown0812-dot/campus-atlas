"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DeliveryManifest, DeliveryManifestSectionId } from "../ask/ask-types";
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
  type?: string;
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
  caseId?: string | null;
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
    transfers: TransferRecord[];
    governance: Array<Record<string, unknown> & { id: string }>;
    roadways: Array<Record<string, unknown> & { id: string; name: string }>;
    liveState: Array<Record<string, unknown> & { id: string }>;
    evaluations: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown> & { id: string }>;
    handoffs: Array<Record<string, unknown> & { id: string }>;
  };
};

type PacketDetail = {
  packet: Record<string, unknown> & {
    id: string;
    task: string;
    compiledContent: string;
    finalTokenCount?: number;
  };
  deliveryManifest?: DeliveryManifest;
  items: Array<Record<string, unknown> & {
    sourceType?: string;
    sourceId?: string;
    treatment?: string;
    authority?: string;
    reason?: string;
    protectedRole?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  receipt: Record<string, unknown> & {
    id: string;
    treatmentSummary?: Record<string, Array<Record<string, unknown>>>;
  };
};

type ReconciliationItem = Record<string, unknown> & {
  findingId?: string;
  statement?: string;
  uncertainty?: string | null;
  reviewRequired?: boolean;
  reason?: string;
  mechanismId?: string | null;
  relatedMechanismId?: string | null;
};

type TransferRecord = Record<string, unknown> & {
  id: string;
  caseId?: string | null;
  conversationTitle?: string;
  conversationStatus?: string;
  stage?: string;
  status?: string;
  updatedAt?: string;
  actualCounts?: Record<string, number>;
  reconstructedState?: {
    governedStatementCount?: number;
  };
  blockedReason?: string | null;
  failureReason?: string | null;
  reconciliation?: ReconciliationItem[];
};

type InspectFact = {
  key: string;
  statement: string;
  role: string;
  section?: DeliveryManifestSectionId;
  reason?: string;
  sourceId?: string;
  authority?: string;
  actionRequired?: boolean;
  resolutionPath?: boolean;
};

const views = ["Transfer", "History", "Advanced"] as const;
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

const roleLabels: Record<string, string> = {
  direction: "Current direction",
  next_action: "Next action",
  constraint: "Must preserve",
  conditional: "Condition",
  correction: "Correction guard",
  rationale: "Why it matters",
  unresolved: "Still open",
  conflict: "Open conflict",
  semantic_identity: "Exact identity",
  shared_term: "Project term",
};

function packetStatement(item: Record<string, unknown>) {
  const metadata = item.metadata && typeof item.metadata === "object"
    ? item.metadata as Record<string, unknown>
    : null;
  if (hasValue(metadata?.statement)) return metadata.statement.trim();
  if (hasValue(item.statement)) return item.statement.trim();
  return hasValue(item.reason) ? item.reason.trim() : "Preserved project context";
}

function packetRole(item: Record<string, unknown>) {
  const metadata = item.metadata && typeof item.metadata === "object"
    ? item.metadata as Record<string, unknown>
    : null;
  const roles = Array.isArray(metadata?.continuationRoles)
    ? metadata.continuationRoles.filter((role): role is string => typeof role === "string")
    : [];
  return String(roles[0] || item.protectedRole || "direction").toLowerCase();
}

function hasResolutionPath(statement: string) {
  return /\b(?:until|unless|only if|pending|blocked on|waiting for|after .{1,80}(?:check|confirm|verify)|before .{1,80}(?:check|confirm|verify)|must (?:check|confirm|verify))\b/iu.test(statement);
}

function normalizedFact(statement: string) {
  return statement.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function factsFromPacket(packet: PacketDetail | null): InspectFact[] {
  if (!packet) return [];
  if (packet.deliveryManifest?.sections.length) {
    return packet.deliveryManifest.sections.flatMap((section) => section.items.map((item) => ({
      key: item.id,
      statement: item.statement,
      role: item.primaryRole,
      section: section.id,
      reason: item.reason,
      sourceId: item.sourceId,
      authority: item.authority,
      resolutionPath: hasResolutionPath(item.statement),
    })));
  }
  return packet.items
    .filter((item) => item.treatment === "Use" && item.sourceType !== "RoadwayCheck")
    .map((item, index) => {
      const statement = packetStatement(item);
      return {
        key: String(item.id || `${item.sourceType}:${item.sourceId || index}`),
        statement,
        role: packetRole(item),
        reason: hasValue(item.reason) ? item.reason : undefined,
        sourceId: hasValue(item.sourceId) ? item.sourceId : undefined,
        authority: hasValue(item.authority) ? item.authority : undefined,
        resolutionPath: hasResolutionPath(statement),
      };
    });
}

function factLabel(fact: InspectFact) {
  if (fact.section === "current_plan") return "Current plan";
  if (fact.section === "people") return "Person or responsibility";
  if (fact.section === "constraints") return "Governing constraint";
  if (fact.section === "open") return "Still open";
  if (fact.section === "next") return "Next action";
  if (fact.section === "replaced") return "Supersession guard";
  return roleLabels[fact.role] || humanize(fact.role);
}

function treatmentItems(packet: PacketDetail | null, treatment: "Consider" | "Exclude") {
  const summary = packet?.receipt?.treatmentSummary;
  return summary && Array.isArray(summary[treatment]) ? summary[treatment] : [];
}

export default function InspectWorkspace({ projectId }: { projectId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [latestPacket, setLatestPacket] = useState<PacketDetail | null>(null);
  const [view, setView] = useState<typeof views[number]>("Transfer");
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
        const latestTransfer = result.advanced.transfers.find((transfer) => transfer.conversationStatus !== "archived")
          || null;
        const relevantPacket = latestTransfer?.caseId
          ? result.packets.find((packet) => packet.caseId === latestTransfer.caseId) || null
          : null;
        const packet = relevantPacket
          ? await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/packets/${encodeURIComponent(relevantPacket.id)}`, { cache: "no-store" })
              .then(async (packetResponse) => packetResponse.ok ? await packetResponse.json() as PacketDetail : null)
          : null;
        if (!active) return;
        setOverview(result);
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

  const facts = useMemo(() => factsFromPacket(latestPacket), [latestPacket]);
  const latestTransfer = overview?.advanced.transfers.find((transfer) => transfer.conversationStatus !== "archived")
    || null;
  const actionableOpen = (latestTransfer?.reconciliation || [])
    .filter((item) => item.reviewRequired)
    .map((item, index): InspectFact => ({
      key: String(item.findingId || `review:${index}`),
      statement: hasValue(item.statement) ? item.statement : "Atlas found a decision the conversation did not settle.",
      role: "unresolved",
      reason: hasValue(item.uncertainty) ? item.uncertainty : hasValue(item.reason) ? item.reason : undefined,
      sourceId: hasValue(item.mechanismId) ? item.mechanismId : hasValue(item.relatedMechanismId) ? item.relatedMechanismId : undefined,
      actionRequired: true,
      resolutionPath: false,
    }));
  const openFacts = [...actionableOpen, ...facts.filter((fact) => fact.section === "open" || ["unresolved", "conflict"].includes(fact.role))]
    .filter((fact, index, all) => all.findIndex((candidate) => normalizedFact(candidate.statement) === normalizedFact(fact.statement)) === index);
  const nextFacts = facts.filter((fact) => fact.section === "next" || fact.role === "next_action");
  const currentPlan = facts.filter((fact) => fact.section === "current_plan");
  const preservedFacts = facts.filter((fact) => ["people", "constraints"].includes(fact.section || ""));
  const changes = facts.filter((fact) => fact.section === "replaced" || fact.role === "correction");
  const considered = treatmentItems(latestPacket, "Consider");
  const excluded = treatmentItems(latestPacket, "Exclude");
  const manifestExclusions = latestPacket?.deliveryManifest?.exclusions || [];

  if (status === "loading") return <main className={styles.page}><section className={styles.panel}>Reading the latest transfer and its exact sources…</section></main>;
  if (status === "error" || !overview) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <span>Inspect unavailable</span>
          <h1>The transfer could not be inspected</h1>
          <p>{error}</p>
          <strong>No substitute project data was shown.</strong>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>Inspect</span><h1>Understand this transfer</h1></div>
        <div><p>See what the fresh room will know, what remains open, what changed, and the exact evidence behind it.</p></div>
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

      {view === "Transfer" ? (
        <div className={styles.overviewStack}>
          <section className={styles.section}>
            <SectionHeading eyebrow="Continuation brief" title="What the fresh room will know" />
            {latestPacket ? <DeliverySummary latestPacket={latestPacket} projectId={projectId} /> : latestTransfer ? (
              <article className={styles.packetHero}>
                <span>Room reconstructed · packet not saved</span>
                <strong>No fresh-room packet has been prepared yet.</strong>
                <p>Atlas preserved {Number(latestTransfer.actualCounts?.messages || 0).toLocaleString()} messages and reconstructed {Number(latestTransfer.reconstructedState?.governedStatementCount || 0)} governing facts, but packet preparation is not complete.</p>
                {hasValue(latestTransfer.blockedReason || latestTransfer.failureReason) ? <p>{latestTransfer.blockedReason || latestTransfer.failureReason}</p> : null}
                <Link href={`/projects/${encodeURIComponent(projectId)}/ask?transfer=${encodeURIComponent(latestTransfer.id)}`}>Return to Transfer →</Link>
              </article>
            ) : <Empty text="No transfer packet has been prepared yet." detail="Transfer a room first. Inspect will explain the exact packet Atlas creates." />}
          </section>

          {nextFacts.length ? <section className={styles.section}>
            <SectionHeading eyebrow="Immediate continuation" title="Next action" />
            <InspectFacts facts={nextFacts} projectId={projectId} />
          </section> : null}

          {currentPlan.length ? <section className={styles.section}>
            <SectionHeading eyebrow="Current state" title="Current plan" />
            <InspectFacts facts={currentPlan} projectId={projectId} />
          </section> : null}

          {preservedFacts.length ? <section className={styles.section}>
            <SectionHeading eyebrow="Carried forward" title="Must preserve" />
            <InspectFacts facts={preservedFacts} projectId={projectId} />
          </section> : null}

          {openFacts.length ? <section className={styles.section}>
            <SectionHeading eyebrow="Decision state" title="Still open" />
            <OpenState facts={openFacts} projectId={projectId} />
          </section> : null}

          {changes.length ? <section className={styles.section}>
            <SectionHeading eyebrow="Current versus earlier" title="What changed" />
            <InspectFacts facts={changes} projectId={projectId} />
          </section> : null}

          <section className={styles.section}>
            <SectionHeading eyebrow="Pruned context" title="What Atlas left out" />
            {!considered.length && !excluded.length && !manifestExclusions.length ? <Empty text="No omitted governed candidates were recorded." detail="Atlas does not fill Inspect with unrelated project history. The exact room remains preserved in Advanced." /> : <article className={styles.omissionCard}><p>Atlas kept the exact room but withheld <strong>{excluded.length + manifestExclusions.length}</strong> irrelevant, stale, repeated, replaced, or unnecessary candidate{excluded.length + manifestExclusions.length === 1 ? "" : "s"}. It held back <strong>{considered.length}</strong> additional item{considered.length === 1 ? "" : "s"} that may matter to another continuation.</p>{considered.length ? <OmissionDetails label="Considered but not needed" items={considered} /> : null}{excluded.length ? <OmissionDetails label="Excluded from the packet" items={excluded} /> : null}{manifestExclusions.length ? <details><summary>Pruned before delivery · {manifestExclusions.length}</summary><p>These candidates were redundant, stale, weak, or outside the bounded continuation. Their exact source remains available in Advanced.</p></details> : null}</article>}
          </section>

        </div>
      ) : null}

      {view === "History" ? (
        <div className={styles.overviewStack}>
          <section className={styles.section}>
            <SectionHeading eyebrow="Saved transfers" title="Transfer history" />
            <div className={styles.deliveryList}>{overview.advanced.transfers.map((transfer) => <Link className={styles.deliveryRow} href={detailHref(projectId, "transfers", transfer.id)} key={transfer.id}><span>Room</span><div><strong>{transfer.conversationTitle || "Transferred room"}</strong><p>{humanize(transfer.stage || transfer.status || "received")} · {readableDate(transfer.updatedAt) || "Saved history"}</p></div><span>Inspect →</span></Link>)}</div>
            {!overview.advanced.transfers.length ? <Empty text="No room transfers are preserved yet." /> : null}
          </section>
          <section className={styles.section}>
            <SectionHeading eyebrow="Saved packets" title="Packet history" />
            <div className={styles.deliveryList}>{overview.packets.map((packet) => <Link className={styles.deliveryRow} href={detailHref(projectId, "packets", packet.id)} key={packet.id}><span>Packet</span><div><strong>{packet.task}</strong><p>{readableDate(packet.createdAt) || "Saved delivery"}</p></div><span>Inspect →</span></Link>)}</div>
            {!overview.packets.length ? <Empty text="No transfer packets have been prepared yet." /> : null}
          </section>
        </div>
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

function InspectFacts({ facts, projectId }: { facts: InspectFact[]; projectId: string }) {
  if (!facts.length) return <Empty text="Nothing in this category affects the transfer." detail="Atlas leaves empty categories out of the fresh-room packet." />;
  return (
    <div className={styles.evidenceList}>
      {facts.map((fact) => (
        <details className={styles.evidenceCard} key={fact.key}>
          <summary><span>{factLabel(fact)}</span><strong>{fact.statement}</strong></summary>
          <div>
            <p>{fact.reason || "Atlas carried this governed fact because leaving it out could change how the fresh room continues."}</p>
            <small>{humanize(fact.authority || "governed source")}</small>
            {fact.sourceId ? <Link href={detailHref(projectId, "mechanisms", fact.sourceId)}>View exact source and lineage →</Link> : <p className={styles.honestNote}>No direct mechanism link was stored for this packet item.</p>}
          </div>
        </details>
      ))}
    </div>
  );
}

function OpenState({ facts, projectId }: { facts: InspectFact[]; projectId: string }) {
  const needsDecision = facts.filter((fact) => fact.actionRequired);
  const waiting = facts.filter((fact) => !fact.actionRequired && fact.resolutionPath);
  const intentionallyOpen = facts.filter((fact) => !fact.actionRequired && !fact.resolutionPath);
  if (!facts.length) return <Empty text="No open decision affects this transfer." detail="Atlas found no unresolved state that the fresh room needs to carry." />;
  return (
    <div className={styles.openStateList}>
      {needsDecision.map((fact) => <article className={`${styles.openStateCard} ${styles.actionState}`} key={fact.key}><span>Needs your decision</span><strong>{fact.statement}</strong><p>{fact.reason || "Atlas cannot resolve this from the conversation alone."}</p><Link href={`/projects/${encodeURIComponent(projectId)}/ask`}>Resolve in Transfer →</Link></article>)}
      {waiting.map((fact) => <article className={styles.openStateCard} key={fact.key}><span>Waiting on a known check</span><strong>{fact.statement}</strong><p>Atlas preserved the condition without turning it into a decision prematurely.</p></article>)}
      {intentionallyOpen.map((fact) => <article className={styles.openStateCard} key={fact.key}><span>Intentionally undecided</span><strong>{fact.statement}</strong><p>This remains open in the transferred state. No response is required here.</p></article>)}
    </div>
  );
}

function OmissionDetails({ label, items }: { label: string; items: Array<Record<string, unknown>> }) {
  return <details><summary>{label} · {items.length}</summary><ul>{items.slice(0, 12).map((item, index) => <li key={String(item.id || item.sourceId || index)}>{packetStatement(item)}</li>)}</ul>{items.length > 12 ? <small>{items.length - 12} more remain in Advanced packet records.</small> : null}</details>;
}

function DeliverySummary({ latestPacket, projectId }: { latestPacket: PacketDetail | null; projectId: string }) {
  if (latestPacket) {
    const manifest = latestPacket.deliveryManifest;
    const factCount = manifest?.sections.reduce((count, section) => count + section.items.length, 0) || 0;
    const openCount = manifest?.sections.find((section) => section.id === "open")?.items.length || 0;
    const next = manifest?.sections.find((section) => section.id === "next")?.items[0]?.statement || null;
    return (
      <article className={`${styles.deliveryCard} ${styles.packetHero}`}>
        <div className={styles.packetMeta}><span>{humanize(latestPacket.packet.status || "prepared")} transfer</span><small>{latestPacket.packet.finalTokenCount ? `${latestPacket.packet.finalTokenCount} estimated tokens` : "Saved immutable packet"}</small></div>
        <h3>{manifest?.orientation || "Atlas prepared a governed continuation for this project."}</h3>
        <p>{factCount} governing fact{factCount === 1 ? "" : "s"} will travel to the fresh room. {openCount ? `${openCount} intentionally open item${openCount === 1 ? " remains" : "s remain"} unresolved.` : "No unresolved decision is being carried."}</p>
        {next ? <div className={styles.briefNext}><span>Start here</span><strong>{next}</strong></div> : null}
        <Link href={detailHref(projectId, "packets", latestPacket.packet.id)}>Open packet and technical details →</Link>
      </article>
    );
  }
  return <Empty text="No transfer packet is available to inspect." detail="Prepare one in Transfer when a fresh room needs project context." />;
}

function TechnicalRecords({ overview, projectId, setView, view }: { overview: Overview; projectId: string; setView: (view: typeof technicalViews[number]) => void; view: typeof technicalViews[number] }) {
  const advanced = view === "Transfers" ? overview.advanced.transfers : view === "Governance" ? overview.advanced.governance : view === "Roadways" ? overview.advanced.roadways : view === "Live state" ? overview.advanced.liveState : view === "Evaluations" ? overview.advanced.evaluations : view === "Relationships" ? overview.advanced.relationships : overview.advanced.handoffs;
  const advancedView = (["Transfers", "Governance", "Roadways", "Live state", "Evaluations", "Relationships", "Handoffs"] as string[]).includes(view);
  return (
    <section className={styles.section}>
      <SectionHeading eyebrow="Advanced" title="Internal records" />
      <p className={styles.sectionIntro}>These records prove the readable transfer above. Open them only when you need canonical history or implementation detail.</p>
      <label className={styles.technicalSelector}>Technical view<select onChange={(event) => setView(event.target.value as typeof view)} value={view}>{technicalViews.map((item) => <option key={item}>{item}</option>)}</select></label>
      {view === "Cases" ? <div className={styles.stack}>{!overview.cases.length ? <Empty text="No canonical cases exist in this project." /> : null}{overview.cases.map((record) => <article className={styles.record} key={record.id}><header><strong>{record.objective}</strong><span>{humanize(record.status)}</span></header><dl>{hasValue(record.currentDecision) ? <Row label="Current decision" value={record.currentDecision} /> : null}{hasValue(record.currentThesis) ? <Row label="Current thesis" value={record.currentThesis} /> : null}<Row label="Open review" value={record.pendingFindingCount ? `${record.pendingFindingCount} findings` : "None"} /><Row label="Last meaningful change" value={readableDate(record.lastChanged) || "No timestamp recorded"} /></dl><Link href={detailHref(projectId, "cases", record.id)}>Open full case lineage</Link><details><summary>Raw case anatomy</summary><pre>{JSON.stringify(record, null, 2)}</pre></details></article>)}</div> : null}
      {view === "Reasoning" ? <TechnicalList projectId={projectId} records={overview.reasoning} type="reasoning" /> : null}
      {view === "Mechanisms" ? <TechnicalList projectId={projectId} records={overview.mechanisms} type="mechanisms" /> : null}
      {view === "Principles" ? <div className={styles.stack}>{overview.principles.length ? overview.principles.map((item) => <Raw key={String(item.id)} item={item} />) : <Empty text="No principles have been approved." detail={overview.principlesNote} />}</div> : null}
      {view === "Blueprint" ? <article className={styles.record}><header><strong>{value(overview.blueprint.version)}</strong><span>Frozen authority</span></header><details><summary>View Blueprint anatomy</summary><pre>{JSON.stringify(overview.blueprint, null, 2)}</pre></details></article> : null}
      {view === "Packets" ? <TechnicalList projectId={projectId} records={overview.packets} type="packets" /> : null}
      {advancedView ? <div className={styles.stack}>{!advanced.length ? <Empty text={`No canonical ${view.toLowerCase()} records exist.`} /> : null}{advanced.map((record) => view === "Transfers" ? <Link className={styles.record} href={detailHref(projectId, "transfers", String(record.id))} key={String(record.id)}><header><strong>{String(record.conversationTitle || "Transferred room")}</strong><span>{String(record.stage || "received")}</span></header><p>Open the transfer summary, then load internal evidence only if needed.</p></Link> : <Raw key={String(record.id || JSON.stringify(record))} item={record} />)}</div> : null}
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
