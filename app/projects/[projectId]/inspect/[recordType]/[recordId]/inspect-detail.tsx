"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "../../../../../components/write-session";
import styles from "../../inspect.module.css";

type Detail = Record<string, unknown> & {
  error?: string;
  node?: { id: string; currentVersionId: string; authority: string; scope: string; status: string };
  versions?: Array<{ id: string; statement?: string; representation?: string; createdBy?: string; createdAt?: string }>;
};

function endpoint(projectId: string, recordType: string, recordId: string) {
  const prefix = `/api/v1/projects/${encodeURIComponent(projectId)}`;
  if (recordType === "packets") return `${prefix}/packets/${encodeURIComponent(recordId)}`;
  return `${prefix}/inspect/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`;
}

function titleFor(recordType: string, detail: Detail) {
  if (recordType === "cases") return String((detail.case as Record<string, unknown> | undefined)?.objective || "Case");
  if (recordType === "reasoning") return String(detail.versions?.at(-1)?.statement || "Reasoning node");
  if (recordType === "mechanisms") return String((detail.versions as Array<Record<string, unknown>> | undefined)?.at(-1)?.statement || "Mechanism");
  if (recordType === "packets") return String((detail.packet as Record<string, unknown> | undefined)?.task || "Packet");
  if (recordType === "transfers") return String((detail.transfer as Record<string, unknown> | undefined)?.conversationTitle || "Room transfer");
  return "Canonical record";
}

function readableValue(item: unknown) {
  if (item === null || item === undefined || item === "") return "Not recorded";
  if (Array.isArray(item)) return item.length ? JSON.stringify(item) : "None";
  if (typeof item === "object") return JSON.stringify(item);
  return String(item);
}

function selectedItemLabel(item: Record<string, unknown>) {
  const metadata = item.metadata && typeof item.metadata === "object"
    ? item.metadata as Record<string, unknown>
    : null;
  if (typeof metadata?.statement === "string" && metadata.statement.trim()) return metadata.statement;
  if (String(item.sourceId || "").includes(":check:")) return "Required proof constraint";
  if (typeof item.sourceType === "string" && item.sourceType.trim()) {
    const words = item.sourceType.replaceAll("_", " ");
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  }
  return "Selected governed context";
}

function humanLabel(item: unknown) {
  const raw = readableValue(item).replaceAll("_", " ");
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
}

function DetailRow({ label, value: item }: { label: string; value: unknown }) {
  return <div><dt>{label}</dt><dd>{readableValue(item)}</dd></div>;
}

function DetailList({ label, value: item }: { label: string; value: unknown }) {
  const items = Array.isArray(item) ? item : [];
  return <div><dt>{label}</dt><dd>{items.length ? <ul>{items.map((entry) => <li key={String(entry)}>{String(entry)}</li>)}</ul> : "None recorded"}</dd></div>;
}

export default function InspectDetail({
  projectId,
  recordType,
  recordId,
}: {
  projectId: string;
  recordType: string;
  recordId: string;
}) {
  const { session, authorizationHeaders } = useWriteSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(endpoint(projectId, recordType, recordId), { cache: "no-store" });
    const value = await response.json().catch(() => ({ error: "Canonical record unavailable." })) as Detail;
    if (!response.ok) throw new Error(value.error || "Canonical record unavailable.");
    return value;
  }, [projectId, recordId, recordType]);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (!active) return;
      setDetail(value);
      setStatus("ready");
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Canonical record unavailable.");
      setStatus("error");
    });
    return () => { active = false; };
  }, [load]);

  async function correctNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail?.node) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("saving");
    setError("");
    setResult(null);
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reasoning-nodes/${encodeURIComponent(recordId)}/corrections`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `node-correction:${recordId}:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          sourceVersionId: detail.node.currentVersionId,
          reviewedStatement: String(data.get("statement") || ""),
          actorId: session?.actor.id || "cody",
          reason: String(data.get("reason") || ""),
        }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Node correction failed." })) as Record<string, unknown> & { error?: string };
    if (!response.ok) {
      setError(response.status === 409
        ? `${value.error || "Current version changed."} Refresh and review the latest node. Nothing was saved.`
        : value.error || "Node correction failed. The prior version remains current.");
      setStatus("ready");
      return;
    }
    setResult(value);
    setDetail(await load());
    form.reset();
    setStatus("ready");
  }

  const currentStatement = useMemo(() => detail?.versions?.at(-1)?.statement || "", [detail]);
  if (status === "loading") return <main className={styles.page}><section className={styles.panel}>Loading exact lineage and versions…</section></main>;
  if (status === "error" || !detail) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <strong>Canonical record unavailable</strong>
          <p>{error}</p>
          <b>The project-scoped backend rejected or could not read this direct link. No other project’s record was shown.</b>
        </section>
      </main>
    );
  }

  const packet = recordType === "packets" && detail.packet && typeof detail.packet === "object"
    ? detail.packet as Record<string, unknown>
    : null;
  const packetReceipt = packet && detail.receipt && typeof detail.receipt === "object"
    ? detail.receipt as Record<string, unknown>
    : null;
  const treatments = packetReceipt?.treatmentSummary && typeof packetReceipt.treatmentSummary === "object"
    ? packetReceipt.treatmentSummary as Record<string, unknown>
    : {};
  const treatmentCount = (name: string) => Array.isArray(treatments[name]) ? treatments[name].length : 0;
  const transfer = recordType === "transfers" && detail.transfer && typeof detail.transfer === "object"
    ? detail.transfer as Record<string, unknown>
    : null;
  const mechanism = recordType === "mechanisms" && detail.mechanism && typeof detail.mechanism === "object"
    ? detail.mechanism as Record<string, unknown>
    : null;
  const mechanismVersions = mechanism && Array.isArray(detail.versions)
    ? detail.versions as Array<Record<string, unknown>>
    : [];
  const currentMechanismVersion = mechanismVersions.find((item) => item.id === mechanism?.currentVersionId)
    || mechanismVersions.at(-1)
    || null;
  const previousMechanismVersion = currentMechanismVersion?.supersedesVersionId
    ? mechanismVersions.find((item) => item.id === currentMechanismVersion.supersedesVersionId) || null
    : null;
  const mechanismGovernance = mechanism && Array.isArray(detail.governance)
    ? detail.governance as Array<Record<string, unknown>>
    : [];
  const governingEvent = currentMechanismVersion
    ? mechanismGovernance.find((item) => item.resultingVersionId === currentMechanismVersion.id) || mechanismGovernance.at(-1)
    : null;
  const sourceFinding = mechanism && detail.sourceFinding && typeof detail.sourceFinding === "object"
    ? detail.sourceFinding as Record<string, unknown>
    : null;
  const sourceEvents = mechanism && Array.isArray(detail.sourceEvents)
    ? detail.sourceEvents as Array<Record<string, unknown>>
    : [];
  const exactSource = sourceEvents.find((item) => item.representation === "Exact") || sourceEvents[0] || null;
  const exactSourceLinks = exactSource && Array.isArray(exactSource.sourceLinks)
    ? exactSource.sourceLinks as Array<Record<string, unknown>>
    : [];
  const mechanismPacketUsage = mechanism && Array.isArray(detail.packetUsage)
    ? detail.packetUsage as Array<Record<string, unknown>>
    : [];
  const packetItems = packet && Array.isArray(detail.items)
    ? detail.items as Array<Record<string, unknown>>
    : [];
  const usedPacketItems = packetItems.filter((item) => item.treatment === "Use");

  return (
    <main className={styles.page}>
      <Link href={`/projects/${encodeURIComponent(projectId)}/inspect`}>← Inspect</Link>
      <header className={`${styles.header} ${styles.detailHeader}`}>
        <div><span>{recordType} · immutable lineage</span><h1>{titleFor(recordType, detail)}</h1></div>
        <details className={styles.headerIdentity}><summary>Technical identity</summary><p>{recordId}</p></details>
      </header>
      {packet ? (
        <>
          <section className={styles.record}>
            <header><strong>Prepared context</strong><span>{readableValue(packet.status)}</span></header>
            <p>This is the task-specific Context Delivery Atlas selected from governed State Truth.</p>
            <dl>
              <DetailRow label="Literal task" value={packet.task} />
              <DetailRow label="Created" value={packet.createdAt} />
            </dl>
            <pre>{readableValue(packet.compiledContent)}</pre>
            <details>
              <summary>Delivery technical summary</summary>
              <dl>
                <DetailRow label="Project" value={packet.projectId} />
                <DetailRow label="Estimated tokens" value={`${readableValue(packet.finalTokenCount)} / ${readableValue(packet.tokenBudget)}`} />
              </dl>
            </details>
          </section>
          <section className={styles.record}>
            <header><strong>Governing truth selected</strong><span>{usedPacketItems.length} supplied</span></header>
            {usedPacketItems.length ? usedPacketItems.map((item) => (
              <div key={String(item.id || `${item.sourceType}:${item.sourceId}`)}>
                <strong>{selectedItemLabel(item)}</strong>
                <p>{readableValue(item.reason)}</p>
                {item.sourceType === "mechanism" && item.sourceId ? (
                  <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/mechanisms/${encodeURIComponent(String(item.sourceId))}`}>
                    Trace to governed truth
                  </Link>
                ) : null}
              </div>
            )) : <p>No governing Use item is recorded in this packet.</p>}
          </section>
          <section className={styles.record}>
            <header><strong>Delivery receipt</strong><span>Saved</span></header>
            <dl>
              <DetailRow label="Used" value={treatmentCount("Use")} />
              <DetailRow label="Considered" value={treatmentCount("Consider")} />
              <DetailRow label="Excluded" value={treatmentCount("Exclude")} />
            </dl>
            <details>
              <summary>Why this selection was safe</summary>
              <dl>
                <DetailRow label="Inference disclosure" value={packetReceipt?.inferenceDisclosure} />
                <DetailRow label="Unresolved conflicts" value={packetReceipt?.unresolvedConflicts} />
              </dl>
            </details>
          </section>
          <details className={styles.record}>
            <summary>Raw canonical packet and receipt</summary>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </details>
        </>
      ) : null}
      {mechanism ? (
        <>
          <section className={styles.record}>
            <header><strong>Current governing statement</strong><span>{readableValue(currentMechanismVersion?.status || mechanism.status)}</span></header>
            <h2>{readableValue(currentMechanismVersion?.statement)}</h2>
            <dl>
              <DetailRow label="Authority" value={humanLabel(currentMechanismVersion?.authority)} />
              <DetailList label="Scope conditions" value={currentMechanismVersion?.scopeConditions} />
              <DetailList label="Exclusions" value={currentMechanismVersion?.exclusions} />
            </dl>
          </section>
          {previousMechanismVersion ? (
            <section className={styles.record}>
              <header><strong>What changed</strong><span>Supersession</span></header>
              <dl>
                <DetailRow label="Previously" value={previousMechanismVersion.statement} />
                <DetailRow label="Changed to" value={currentMechanismVersion?.statement} />
                <DetailRow label="Changed because" value={governingEvent?.reason || "A canonical supersession is recorded, but no human-readable reason is attached."} />
              </dl>
            </section>
          ) : null}
          <section className={styles.record}>
            <header><strong>Why Atlas believes this</strong><span>Readable lineage</span></header>
            <div className={styles.lineageCard}>
              <div><span>Current governing statement</span><strong>{readableValue(currentMechanismVersion?.statement)}</strong></div>
              <i aria-hidden="true">↓</i>
              <div><span>Approved or corrected</span><strong>{readableValue(currentMechanismVersion?.authority)} · {readableValue(currentMechanismVersion?.status)}</strong></div>
              <i aria-hidden="true">↓</i>
              <div><span>Finding or observation</span><strong>{readableValue(sourceFinding?.proposal_statement)}</strong></div>
              <i aria-hidden="true">↓</i>
              <div>
                <span>Exact conversation evidence</span>
                <strong>{exactSource?.conversationTitle ? String(exactSource.conversationTitle) : exactSource ? "Source event recorded without a conversation label" : "No exact source event is linked"}</strong>
                {exactSourceLinks[0]?.href ? <Link href={String(exactSourceLinks[0].href)}>View exact evidence</Link> : null}
              </div>
            </div>
          </section>
          <section className={styles.record}>
            <header><strong>Context Delivery use</strong><span>{mechanismPacketUsage.length} saved uses</span></header>
            {mechanismPacketUsage.length ? mechanismPacketUsage.map((usage) => (
              <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/packets/${encodeURIComponent(String(usage.packet_id))}`} key={String(usage.packet_id)}>
                {readableValue(usage.treatment)} · {readableValue(usage.inclusion_reason || usage.exclusion_reason)}
              </Link>
            )) : <p>No saved Full packet has supplied this statement. Light delivery may still occur without creating a packet or receipt.</p>}
          </section>
          <details className={styles.record}>
            <summary>Raw canonical mechanism, versions, governance, and source records</summary>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </details>
        </>
      ) : null}
      {transfer ? (
        <>
          <section className={styles.record}>
            <header><strong>Transfer outcome</strong><span>{readableValue(transfer.stage)}</span></header>
            <dl>
              <DetailRow label="Status" value={transfer.status} />
              <DetailRow label="Exact conversation" value={transfer.conversationId} />
              <DetailRow label="Expected counts" value={transfer.expectedCounts} />
              <DetailRow label="Actual counts" value={transfer.actualCounts} />
              <DetailRow label="Attempts" value={transfer.attemptCount} />
              <DetailRow label="Blocked / failed reason" value={transfer.blockedReason || transfer.failureReason} />
            </dl>
          </section>
          {[
            ["Exact conversation", detail.exactConversation],
            ["Immutable messages", detail.immutableMessages],
            ["Canonical source events", detail.canonicalSourceEvents],
            ["Analysis checkpoint", detail.checkpoint],
            ["Reconciliation result", detail.reconciliation],
            ["Governance history", detail.governance],
            ["Governed project state", detail.governedProjectState],
            ["Steward context artifacts", detail.stewardArtifacts],
          ].map(([label, item]) => (
            <section className={styles.record} key={String(label)}>
              <header><strong>{String(label)}</strong><span>canonical lineage</span></header>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </section>
          ))}
          <details className={styles.record}>
            <summary>Raw canonical transfer record</summary>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </details>
        </>
      ) : null}
      {result && (
        <section className={styles.panel} role="status">
          <strong>Canonical correction confirmed</strong>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
      {!packet && !transfer && !mechanism ? <section className={styles.stack}>
        {Object.entries(detail).map(([key, item]) => (
          <article className={styles.record} key={key}>
            <header><strong>{key}</strong><span>canonical</span></header>
            {Array.isArray(item) ? (
              item.length
                ? item.map((row, index) => <pre key={`${key}:${index}`}>{JSON.stringify(row, null, 2)}</pre>)
                : <p>No canonical {key} record exists.</p>
            ) : <pre>{JSON.stringify(item, null, 2)}</pre>}
          </article>
        ))}
      </section> : null}
      {recordType === "reasoning" && detail.node && (
        <form className={styles.record} onSubmit={correctNode}>
          <header><strong>Correct reasoning-node wording</strong><span>No authority promotion</span></header>
          <p>The prior version remains immutable. This creates a versioned Reconstructed correction and an append-only event.</p>
          <textarea defaultValue={currentStatement} name="statement" required />
          <input name="reason" placeholder="Why this wording is being corrected" required />
          {!session?.writeAuthorization.authorized && <p>Read-only session. Enable canonical writes from the shell.</p>}
          <button disabled={!session?.writeAuthorization.authorized || status === "saving"} type="submit">
            Preserve the corrected wording as a new canonical version.
          </button>
          {error && <p>{error}</p>}
        </form>
      )}
    </main>
  );
}
