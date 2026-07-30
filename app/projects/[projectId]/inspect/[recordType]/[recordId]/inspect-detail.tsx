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
  return "Canonical record";
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

  return (
    <main className={styles.page}>
      <Link href={`/projects/${encodeURIComponent(projectId)}/inspect`}>← Inspect</Link>
      <header className={styles.header}>
        <div><span>{recordType} · immutable lineage</span><h1>{titleFor(recordType, detail)}</h1></div>
        <p>{recordId}</p>
      </header>
      {result && (
        <section className={styles.panel} role="status">
          <strong>Canonical correction confirmed</strong>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
      <section className={styles.stack}>
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
      </section>
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
