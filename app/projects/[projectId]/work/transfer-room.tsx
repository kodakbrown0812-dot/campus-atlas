"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useStewardTask } from "../../../components/steward-task";
import { useWriteSession } from "../../../components/write-session";
import styles from "./work.module.css";

type ConversationChoice = {
  id: string;
  title: string;
  sourceType: string;
};

type ReconciliationItem = {
  findingId: string;
  findingVersionId: string;
  statement: string;
  candidateType: string;
  authority: string;
  scope: string;
  uncertainty: string | null;
  sensitivity: string;
  relationship: string;
  proposedTreatment: "Use" | "Consider" | "Exclude";
  reviewRequired: boolean;
  reason: string;
  exactSources: Array<{ eventId: string; messageIds: string[]; exactContent: string }>;
  status: string;
  mechanismId: string | null;
};

type Transfer = {
  id: string;
  projectId: string;
  conversationId: string;
  caseId: string | null;
  conversationTitle: string;
  status: string;
  stage: string;
  stageTimestamps: Record<string, string>;
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
  reconciliation: ReconciliationItem[];
  blockedReason: string | null;
  failureReason: string | null;
  retrySafe: boolean;
  attemptCount: number;
};

const outcomes = [
  ["source_preserved", "Source preserved"],
  ["events_materialized", "Exact evidence prepared"],
  ["analyzed", "Project state analyzed"],
  ["reconciled", "Compared with existing state"],
] as const;

function count(value: Record<string, number>, key: string) {
  return Number(value[key] || 0);
}

export default function TransferRoom({
  projectId,
  conversations,
  onCanonicalChange,
}: {
  projectId: string;
  conversations: ConversationChoice[];
  onCanonicalChange: () => void;
}) {
  const { session, authorizationHeaders } = useWriteSession();
  const { carryTask } = useStewardTask();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [current, setCurrent] = useState<Transfer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/transfers`, { cache: "no-store" });
    const value = await response.json().catch(() => ({ error: "Transfers unavailable." })) as {
      transfers?: Transfer[];
      error?: string;
    };
    if (!response.ok || !value.transfers) throw new Error(value.error || "Transfers unavailable.");
    setTransfers(value.transfers);
    setCurrent((prior) => value.transfers?.find((item) => item.id === prior?.id) || value.transfers?.[0] || null);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/transfers`, { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json().catch(() => ({ error: "Transfers unavailable." })) as {
          transfers?: Transfer[];
          error?: string;
        };
        if (!response.ok || !value.transfers) throw new Error(value.error || "Transfers unavailable.");
        return value.transfers;
      })
      .then((value) => {
        if (!active) return;
        setTransfers(value);
        setCurrent(value[0] || null);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Transfers unavailable.");
        setStatus("error");
      });
    return () => { active = false; };
  }, [projectId]);

  async function transfer(body: Record<string, unknown>) {
    setStatus("saving");
    setError("");
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/transfers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `transfer-room:${crypto.randomUUID()}`,
        ...authorizationHeaders(),
      },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({ error: "Room transfer failed." })) as Transfer & { error?: string };
    if (!response.ok || !value.id) {
      setError(response.status === 401
        ? "Canonical writes are not authorized. Nothing was transferred."
        : value.error || "Room transfer failed. Preserved stages remain safe to resume.");
      setStatus("ready");
      return false;
    }
    setCurrent(value);
    await load();
    onCanonicalChange();
    setStatus("ready");
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const succeeded = await transfer({
      title: String(data.get("title") || ""),
      format: String(data.get("format") || "text"),
      transcript: String(data.get("transcript") || ""),
    });
    if (succeeded) form.reset();
  }

  async function resume(id: string) {
    setStatus("saving");
    setError("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/transfers/${encodeURIComponent(id)}/resume`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `transfer-resume:${id}:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
      },
    );
    const value = await response.json().catch(() => ({ error: "Transfer resume failed." })) as Transfer & { error?: string };
    if (!response.ok || !value.id) {
      setError(value.error || "Transfer resume failed. Earlier verified stages remain preserved.");
      setStatus("ready");
      return;
    }
    setCurrent(value);
    await load();
    onCanonicalChange();
    setStatus("ready");
  }

  async function govern(item: ReconciliationItem, treatment: "Use" | "Consider" | "Exclude") {
    if (!current) return;
    setStatus("saving");
    setError("");
    const action = treatment === "Use" ? "approve" : treatment === "Consider" ? "defer" : "reject";
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(item.findingId)}/governance`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `transfer-review:${current.id}:${item.findingId}:${treatment}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          action,
          actorId: session?.actor.id || "owner",
          sourceVersionId: item.findingVersionId,
          reviewedStatement: reviewed[item.findingId] || item.statement,
          scope: "project_wide",
          reason: treatment === "Use"
            ? "Owner accepted this reviewed statement for future project continuity."
            : treatment === "Consider"
              ? "Owner kept this source inspectable without granting retrieval authority."
              : "Owner excluded this proposal from governing project state.",
          returnCondition: treatment === "Consider" ? "Return only when a future task makes this candidate materially applicable." : undefined,
        }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Review action failed." })) as { error?: string };
    if (!response.ok) {
      setError(value.error || "Review action failed. Project truth was not changed.");
      setStatus("ready");
      return;
    }
    await resume(current.id);
  }

  const imported = useMemo(
    () => conversations.filter((conversation) => conversation.sourceType === "imported"),
    [conversations],
  );
  const reviewItems = current?.reconciliation.filter((item) => item.reviewRequired) || [];
  const preserved = current ? count(current.actualCounts, "messages") : 0;
  const candidates = current ? count(current.actualCounts, "durableCandidates") : 0;

  return (
    <section className={styles.transferRoom}>
      <header>
        <span className={styles.eyebrow}>Incoming continuity</span>
        <h2>Transfer a room into Atlas</h2>
        <p>Bring in a conversation once. Atlas preserves the exact source, identifies durable project state, and prepares it for future work.</p>
      </header>

      <form className={styles.transferForm} onSubmit={submit}>
        <label>
          Room title
          <input name="title" placeholder="What work is this room preserving?" required />
        </label>
        <label>
          Source format
          <select defaultValue="text" name="format">
            <option value="text">Exact text transcript</option>
            <option value="json">ChatGPT or structured JSON export</option>
          </select>
        </label>
        <label className={styles.transferTranscript}>
          Exact room transcript
          <textarea name="transcript" placeholder="Paste the unchanged conversation or export." required />
        </label>
        <button disabled={!canWrite || status === "saving"} type="submit">
          {status === "saving" ? "Transferring this room…" : "Transfer this room into Atlas"}
        </button>
      </form>

      {imported.length ? (
        <div className={styles.preservedRooms}>
          <span>Already preserved rooms</span>
          {imported.map((conversation) => {
            const existing = transfers.find((item) => item.conversationId === conversation.id);
            return (
              <button
                disabled={!canWrite || status === "saving"}
                key={conversation.id}
                onClick={() => existing ? resume(existing.id) : transfer({ conversationId: conversation.id })}
                type="button"
              >
                <strong>{conversation.title}</strong>
                <small>{existing ? `Continue · ${existing.stage.replaceAll("_", " ")}` : "Continue transfer"}</small>
              </button>
            );
          })}
        </div>
      ) : null}

      {!canWrite && <p className={styles.readOnlyNotice}>Sign in as the verified owner to transfer or review project state. Public visitors remain read-only.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {current ? (
        <article className={styles.transferResult} aria-live="polite">
          <div className={styles.transferResultHeader}>
            <div>
              <span className={styles.eyebrow}>{current.status === "complete" ? "Ready for Steward" : "Room transferred"}</span>
              <h3>{current.conversationTitle}</h3>
              <p>{preserved} message{preserved === 1 ? "" : "s"} preserved · {candidates} durable candidate{candidates === 1 ? "" : "s"} detected · {reviewItems.length} item{reviewItems.length === 1 ? "" : "s"} needs your review</p>
            </div>
            <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/transfers/${encodeURIComponent(current.id)}`}>Open in Inspect</Link>
          </div>
          <ol className={styles.transferProgress}>
            {outcomes.map(([stage, label]) => (
              <li data-complete={Boolean(current.stageTimestamps[stage])} key={stage}>
                <span>{current.stageTimestamps[stage] ? "✓" : "·"}</span>{label}
              </li>
            ))}
            <li data-complete={current.stage === "awaiting_review" || current.stage === "ready_for_steward"}>
              <span>{current.stage === "awaiting_review" || current.stage === "ready_for_steward" ? "✓" : "·"}</span>
              {current.stage === "ready_for_steward" ? "Ready for Steward" : "Review needed"}
            </li>
          </ol>

          {current.stage === "awaiting_review" && (
            <details className={styles.transferReview} open>
              <summary>Review {reviewItems.length} item{reviewItems.length === 1 ? "" : "s"}</summary>
              {reviewItems.map((item) => (
                <article key={item.findingId}>
                  <span>{item.candidateType.replaceAll("_", " ")} · proposed {item.proposedTreatment}</span>
                  <textarea
                    aria-label={`Reviewed wording for ${item.findingId}`}
                    onChange={(event) => setReviewed((value) => ({ ...value, [item.findingId]: event.target.value }))}
                    value={reviewed[item.findingId] || item.statement}
                  />
                  <p>{item.reason}</p>
                  <dl>
                    <div><dt>Relationship</dt><dd>{item.relationship.replaceAll("_", " ")}</dd></div>
                    <div><dt>Authority</dt><dd>{item.authority}</dd></div>
                    <div><dt>Uncertainty</dt><dd>{item.uncertainty || "None recorded"}</dd></div>
                    <div><dt>Sensitivity</dt><dd>{item.sensitivity.replaceAll("_", " ")}</dd></div>
                  </dl>
                  <details>
                    <summary>View exact supporting source</summary>
                    {item.exactSources.map((source) => <pre key={source.eventId}>{source.exactContent}</pre>)}
                  </details>
                  <div className={styles.reviewActions}>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Use")} type="button">Use</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Consider")} type="button">Consider</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Exclude")} type="button">Exclude</button>
                  </div>
                </article>
              ))}
            </details>
          )}

          {current.stage === "ready_for_steward" && (
            <div className={styles.transferReady}>
              <strong>Accepted project state is available to Atlas Steward.</strong>
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/ask`}
                onClick={() => carryTask(projectId, "", current.caseId)}
              >
                Prepare context in Steward
              </Link>
            </div>
          )}
          {["blocked", "failed"].includes(current.stage) && (
            <div className={styles.transferFailure} role="alert">
              <strong>{current.stage === "blocked" ? "Transfer blocked" : "Transfer failed"}</strong>
              <p>{current.blockedReason || current.failureReason}</p>
              <span>Verified earlier stages remain preserved. Retrying is safe.</span>
              <button disabled={!canWrite || status === "saving"} onClick={() => resume(current.id)} type="button">Retry transfer</button>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
