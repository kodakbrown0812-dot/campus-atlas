"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStewardTask } from "../../../components/steward-task";
import { useWriteSession } from "../../../components/write-session";
import HandoffPresentation from "../ask/handoff-presentation";
import PacketPreview from "../ask/packet-preview";
import type { PreparedContext, ReconstructionRunResult } from "../ask/ask-types";
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
  reconstructedState: {
    status: "ready" | "needs_review" | "insufficient";
    currentDirection: string | null;
    nextAction: string | null;
    importantConstraints: string[];
    changedOrReplaced: string[];
    governedStatementCount: number;
    stateTruthPrecedesTaskSelection: true;
  };
  blockedReason: string | null;
  failureReason: string | null;
  retrySafe: boolean;
  attemptCount: number;
};

function count(value: Record<string, number>, key: string) {
  return Number(value[key] || 0);
}

export default function TransferRoom({
  projectId,
  conversations,
  onCanonicalChange,
  preferredConversationId,
}: {
  projectId: string;
  conversations: ConversationChoice[];
  onCanonicalChange: () => void;
  preferredConversationId?: string | null;
}) {
  const { session, authorizationHeaders } = useWriteSession();
  const { rememberDelivery } = useStewardTask();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [current, setCurrent] = useState<Transfer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [continuationTask, setContinuationTask] = useState("");
  const [packetStatus, setPacketStatus] = useState<"idle" | "preparing" | "needs_input" | "ready" | "failure">("idle");
  const [packetRun, setPacketRun] = useState<ReconstructionRunResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedContext | null>(null);
  const [packetError, setPacketError] = useState("");
  const packetAttempt = useRef<{ signature: string; key: string } | null>(null);
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  function resetPreparedPacket() {
    setContinuationTask("");
    setPacketStatus("idle");
    setPacketRun(null);
    setPrepared(null);
    setPacketError("");
    packetAttempt.current = null;
  }

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/transfers`, { cache: "no-store" });
    const value = await response.json().catch(() => ({ error: "Transfers unavailable." })) as {
      transfers?: Transfer[];
      error?: string;
    };
    if (!response.ok || !value.transfers) throw new Error(value.error || "Transfers unavailable.");
    setTransfers(value.transfers);
    setCurrent((prior) => value.transfers?.find((item) => item.id === prior?.id)
      || value.transfers?.find((item) => item.conversationId === preferredConversationId)
      || value.transfers?.[0]
      || null);
  }, [preferredConversationId, projectId]);

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
        setCurrent(value.find((item) => item.conversationId === preferredConversationId) || value[0] || null);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Transfers unavailable.");
        setStatus("error");
      });
    return () => { active = false; };
  }, [preferredConversationId, projectId]);

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
        ? "Sign in to transfer this room. Nothing was changed."
        : value.error || "Room transfer failed. Preserved stages remain safe to resume.");
      setStatus("ready");
      return false;
    }
    resetPreparedPacket();
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
    resetPreparedPacket();
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
      setError(value.error || "That decision could not be saved. The preserved project state was not changed.");
      setStatus("ready");
      return;
    }
    await resume(current.id);
  }

  async function preparePacket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !continuationTask.trim() || !canWrite) return;
    const task = continuationTask.trim();
    const signature = JSON.stringify([current.id, current.caseId, task]);
    if (packetAttempt.current?.signature !== signature) {
      packetAttempt.current = {
        signature,
        key: `room-transfer-packet:${crypto.randomUUID()}`,
      };
    }
    setPacketStatus("preparing");
    setPacketRun(null);
    setPrepared(null);
    setPacketError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/reconstruction/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": packetAttempt.current.key,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          task,
          ...(current.caseId ? { caseId: current.caseId } : {}),
          tokenBudget: 800,
        }),
      });
      const value = await response.json().catch(() => ({ error: "Transfer packet preparation failed." })) as (
        Partial<ReconstructionRunResult> & { error?: string }
      );
      if (value.status === "compiled" && value.packet && value.receipt && value.links && value.literalTask) {
        const complete = value as ReconstructionRunResult;
        const context: PreparedContext = {
          projectId,
          literalTask: complete.literalTask,
          packet: complete.packet!,
          receipt: complete.receipt!,
          links: complete.links!,
          raw: complete,
        };
        setPacketRun(complete);
        setPrepared(context);
        setPacketStatus("ready");
        rememberDelivery(projectId, complete);
        return;
      }
      const stopped = value.status ? value as ReconstructionRunResult : null;
      setPacketRun(stopped);
      setPacketStatus(value.status === "clarification_required" ? "needs_input" : "failure");
      setPacketError(value.error || value.need?.explanation || "Atlas could not prepare a truthful transfer packet.");
    } catch (caught) {
      setPacketStatus("failure");
      setPacketError(caught instanceof Error ? caught.message : "Atlas could not prepare a truthful transfer packet.");
    }
  }

  function changeContinuationTask(value: string) {
    setContinuationTask(value);
    if (packetStatus !== "idle") {
      setPacketStatus("idle");
      setPacketRun(null);
      setPrepared(null);
      setPacketError("");
    }
  }

  const imported = useMemo(
    () => conversations.filter((conversation) => conversation.sourceType === "imported"),
    [conversations],
  );
  const reviewItems = current?.reconciliation.filter((item) => item.reviewRequired) || [];
  const preserved = current ? count(current.actualCounts, "messages") : 0;
  const journey = current ? [
    {
      label: "Conversation preserved",
      complete: Boolean(current.stageTimestamps.source_preserved),
    },
    {
      label: "Project state identified",
      complete: Boolean(current.stageTimestamps.analyzed || current.stageTimestamps.reconciled),
    },
    ...(reviewItems.length ? [{
      label: `Needs review · ${reviewItems.length}`,
      complete: current.stage === "awaiting_review" || current.stage === "ready_for_steward",
    }] : []),
    {
      label: "Ready to continue",
      complete: current.stage === "ready_for_steward",
    },
  ] : [];

  return (
    <section className={styles.transferRoom}>
      <header>
        <span className={styles.eyebrow}>Room transfer</span>
        <h2>What room do you want to continue?</h2>
        <p>Paste the conversation. Atlas will preserve it exactly, reconstruct what is current, and prepare it for a fresh room.</p>
      </header>

      <form className={styles.transferForm} onSubmit={submit}>
        <label>
          Room title
          <input name="title" placeholder="What work is this room preserving?" required />
        </label>
        <label>
          Current method
          <select defaultValue="text" name="format">
            <option value="text">Paste conversation</option>
            <option value="json">Paste structured export</option>
          </select>
        </label>
        <label className={styles.transferTranscript}>
          Conversation
          <textarea name="transcript" placeholder="Paste the conversation or export here." required />
        </label>
        <button disabled={!canWrite || status === "saving"} type="submit">
          {status === "saving" ? "Transferring room…" : "Transfer room"}
        </button>
      </form>

      {imported.length ? (
        <div className={styles.preservedRooms}>
          <span>Continue a previous transfer</span>
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
                <small>{existing?.stage === "ready_for_steward" ? "Ready to continue" : "Continue transfer"}</small>
              </button>
            );
          })}
        </div>
      ) : null}

      {!canWrite && <p className={styles.readOnlyNotice}>Sign in as the owner to transfer a room or make review decisions.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {current ? (
        <article className={styles.transferResult} aria-live="polite">
          <div className={styles.transferResultHeader}>
            <div>
              <span className={styles.eyebrow}>{current.status === "complete" ? "Ready to continue" : "Room transferred"}</span>
              <h3>{current.conversationTitle}</h3>
              <p>
                {current.stage === "ready_for_steward"
                  ? `${preserved} message${preserved === 1 ? "" : "s"} preserved. This room is ready to continue.`
                  : reviewItems.length
                    ? `${preserved} message${preserved === 1 ? "" : "s"} preserved. Atlas needs your judgment on ${reviewItems.length} item${reviewItems.length === 1 ? "" : "s"}.`
                    : `${preserved} message${preserved === 1 ? "" : "s"} preserved. Atlas is identifying what should carry forward.`}
              </p>
            </div>
            <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/transfers/${encodeURIComponent(current.id)}`}>Open in Inspect</Link>
          </div>
          <ol className={styles.transferProgress}>
            {journey.map((step) => (
              <li data-complete={step.complete} key={step.label}>
                <span>{step.complete ? "✓" : "·"}</span>{step.label}
              </li>
            ))}
          </ol>

          {current.stage === "awaiting_review" && (
            <details className={styles.transferReview} open>
              <summary>Needs review · {reviewItems.length}</summary>
              {reviewItems.map((item) => (
                <article key={item.findingId}>
                  <span>Review what Atlas should carry forward</span>
                  <textarea
                    aria-label="Reviewed wording"
                    onChange={(event) => setReviewed((value) => ({ ...value, [item.findingId]: event.target.value }))}
                    value={reviewed[item.findingId] || item.statement}
                  />
                  <p>{item.reason}</p>
                  <details>
                    <summary>View the supporting conversation</summary>
                    {item.exactSources.map((source) => <pre key={source.eventId}>{source.exactContent}</pre>)}
                  </details>
                  <div className={styles.reviewActions}>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Use")} type="button">Accept</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Consider")} type="button">Decide later</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Exclude")} type="button">Do not keep</button>
                  </div>
                </article>
              ))}
            </details>
          )}

          {current.stage === "ready_for_steward" && (
            <div className={styles.roomReady}>
              <header>
                <span className={styles.eyebrow}>Room ready</span>
                <h3>Atlas reconstructed the current state of this work.</h3>
              </header>
              <dl className={styles.roomStateSummary}>
                <div>
                  <dt>Preserved current state</dt>
                  <dd>{current.reconstructedState.governedStatementCount} governing statement{current.reconstructedState.governedStatementCount === 1 ? "" : "s"}</dd>
                </div>
                <div>
                  <dt>Current direction</dt>
                  <dd>{current.reconstructedState.currentDirection || "No accepted direction was established."}</dd>
                </div>
                {current.reconstructedState.nextAction ? <div><dt>Next action</dt><dd>{current.reconstructedState.nextAction}</dd></div> : null}
                <div>
                  <dt>Important constraints</dt>
                  <dd>{current.reconstructedState.importantConstraints.length
                    ? current.reconstructedState.importantConstraints.join(" ")
                    : "No separate governing constraint was established."}</dd>
                </div>
                {current.reconstructedState.changedOrReplaced.length ? (
                  <div><dt>Changed or replaced</dt><dd>{current.reconstructedState.changedOrReplaced.join(" ")}</dd></div>
                ) : null}
              </dl>
              {!prepared ? (
                <form className={styles.transferTask} onSubmit={(event) => void preparePacket(event)}>
                  <div>
                    <span className={styles.eyebrow}>Steer the transfer</span>
                    <h3>What should the fresh room continue?</h3>
                    <p>Atlas will select the minimum safe part of the reconstructed state and determine whether this transfer is Light, Medium, or Full.</p>
                  </div>
                  <label htmlFor={`transfer-task-${current.id}`}>Continuation task</label>
                  <textarea
                    id={`transfer-task-${current.id}`}
                    onChange={(event) => changeContinuationTask(event.target.value)}
                    placeholder="Describe the work, decision, or next step the fresh room should continue."
                    value={continuationTask}
                  />
                  <button disabled={!canWrite || !continuationTask.trim() || packetStatus === "preparing"} type="submit">
                    {packetStatus === "preparing" ? "Preparing transfer…" : "Prepare transfer"}
                  </button>
                  {packetStatus === "needs_input" ? (
                    <div className={styles.transferGuidance} role="alert">
                      <strong>Atlas needs a clearer continuation direction.</strong>
                      <p>{packetRun?.need.explanation || packetError}</p>
                      <span>Revise the task above. Atlas did not create a packet or invent missing continuity.</span>
                    </div>
                  ) : null}
                  {packetStatus === "failure" ? (
                    <div className={styles.transferGuidance} role="alert">
                      <strong>Atlas stopped before creating the packet.</strong>
                      <p>{packetError}</p>
                      <span>The reconstructed room and completed transfer stages remain preserved.</span>
                    </div>
                  ) : null}
                </form>
              ) : null}
              {prepared ? (
                <div className={styles.embeddedPacket}>
                  <PacketPreview
                    actions={<HandoffPresentation context={prepared} />}
                    advancedActions={null}
                    context={prepared}
                  />
                  <div className={styles.transferReady}>
                    <button onClick={() => changeContinuationTask(continuationTask)} type="button">Prepare a different transfer</button>
                    <Link href={prepared.links.inspect}>Inspect transfer</Link>
                  </div>
                </div>
              ) : (
                <div className={styles.transferReady}>
                  <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/transfers/${encodeURIComponent(current.id)}`}>Inspect what Atlas preserved</Link>
                </div>
              )}
            </div>
          )}
          {["blocked", "failed"].includes(current.stage) && (
            <div className={styles.transferFailure} role="alert">
              <strong>{current.stage === "blocked" ? "Transfer blocked" : "Transfer failed"}</strong>
              <p>{current.blockedReason || current.failureReason}</p>
              <span>Completed steps remain preserved. Retrying is safe.</span>
              <button disabled={!canWrite || status === "saving"} onClick={() => resume(current.id)} type="button">Try again</button>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
