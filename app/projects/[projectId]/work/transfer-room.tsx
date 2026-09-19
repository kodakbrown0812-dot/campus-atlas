"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStewardTask } from "../../../components/steward-task";
import { useWriteSession } from "../../../components/write-session";
import HandoffPresentation from "../ask/handoff-presentation";
import type { PreparedContext, ReconstructionRunResult } from "../ask/ask-types";
import styles from "./work.module.css";

type ConversationChoice = {
  id: string;
  title: string;
  sourceType: string;
  status: "active" | "completed" | "archived";
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
  exactSources: Array<{ eventId: string; messageIds: string[]; exactContent: string; actorType?: string; sequence?: number | null }>;
  status: string;
  mechanismId: string | null;
  sourceAuthorship?: "user" | "assistant" | "mixed" | "unknown";
};

type Transfer = {
  id: string;
  projectId: string;
  conversationId: string;
  caseId: string | null;
  conversationTitle: string;
  conversationStatus: "active" | "completed" | "archived";
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

const DEFAULT_CONTINUATION_TASK = "Continue this room from its current governed state. Start with the next materially correct action.";
const STANDARD_TRANSFER_TOKEN_BUDGET = 800;
const EXPANDED_TRANSFER_TOKEN_BUDGET = 1600;

function inferredRoomTitle(transcript: string) {
  const trimmed = transcript.trim();
  try {
    const parsed = JSON.parse(trimmed) as { title?: unknown; messages?: Array<{ role?: string; content?: string; text?: string }> };
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title.trim().replace(/\s+/g, " ").slice(0, 72);
    }
    const message = parsed.messages?.find((item) => item.role === "user") || parsed.messages?.[0];
    const content = String(message?.content || message?.text || "").trim();
    if (content) return content.replace(/\s+/g, " ").slice(0, 72);
  } catch {
    // Plain pasted rooms are expected; title inference continues below.
  }
  const firstMeaningfulLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:user|assistant|human|chatgpt)\s*:\s*/i, "").trim())
    .find(Boolean);
  return (firstMeaningfulLine || "Transferred room").replace(/\s+/g, " ").slice(0, 72);
}

function inferredRoomFormat(transcript: string) {
  try {
    const parsed = JSON.parse(transcript) as { messages?: unknown };
    return Array.isArray(parsed.messages) ? "json" : "text";
  } catch {
    return "text";
  }
}

function manifestItems(context: PreparedContext, sectionId: string) {
  return context.deliveryManifest?.sections.find((section) => section.id === sectionId)?.items || [];
}

function ReadyTransfer({ context, preserved }: { context: PreparedContext; preserved: number }) {
  const next = manifestItems(context, "next")[0]?.statement || null;
  const open = manifestItems(context, "open");
  const factCount = context.deliveryManifest?.sections.reduce((count, section) => count + section.items.length, 0)
    || context.receipt.treatmentSummary.Use.filter((item) => item.sourceType !== "RoadwayCheck").length;
  const run = context.raw as Partial<ReconstructionRunResult>;
  const deliveryLevel = run.need?.level ? run.need.level.toUpperCase() : "PREPARED";
  return (
    <section className={styles.transferCompletion} aria-labelledby="transfer-complete-title">
      <header>
        <span className={styles.eyebrow}>Final transfer checkpoint</span>
        <h3 id="transfer-complete-title">Ready to continue in a fresh room.</h3>
        <p>Atlas needs nothing else from you. It reconstructed the room and prepared the smallest complete continuation it can safely deliver.</p>
      </header>
      <dl className={styles.transferOutcome}>
        <div><dt>Source</dt><dd>{preserved.toLocaleString()} messages</dd></div>
        <div><dt>Transfer</dt><dd>{deliveryLevel} · {context.packet.finalTokenCount.toLocaleString()} estimated tokens</dd></div>
        <div><dt>Carried forward</dt><dd>{factCount} governing facts</dd></div>
        <div><dt>Still open</dt><dd>{open.length ? `${open.length} intentionally unresolved · no answer needed` : "None"}</dd></div>
      </dl>
      {next ? <article className={styles.nextActionPreview}><span>Start here</span><strong>{next}</strong></article> : null}
      <HandoffPresentation context={context} />
      <div className={styles.transferCompletionLinks}>
        <details className={styles.packetPreviewDisclosure}>
          <summary>Preview transfer packet</summary>
          <pre id="prepared-context-content" tabIndex={0}>{context.packet.compiledContent}</pre>
        </details>
        <Link href={context.links.inspect}>Inspect why Atlas carried this forward →</Link>
      </div>
    </section>
  );
}

export default function TransferRoom({
  projectId,
  conversations = [],
  onCanonicalChange,
  preferredConversationId,
  surface = "home",
}: {
  projectId: string;
  conversations?: ConversationChoice[];
  onCanonicalChange?: () => void;
  preferredConversationId?: string | null;
  surface?: "home" | "transfer";
}) {
  const router = useRouter();
  const { session, authorizationHeaders } = useWriteSession();
  const { rememberDelivery } = useStewardTask();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [current, setCurrent] = useState<Transfer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [directionNote, setDirectionNote] = useState("");
  const [packetStatus, setPacketStatus] = useState<"idle" | "preparing" | "needs_input" | "ready" | "failure">("idle");
  const [packetRun, setPacketRun] = useState<ReconstructionRunResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedContext | null>(null);
  const [packetError, setPacketError] = useState("");
  const [removeConfirmation, setRemoveConfirmation] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const packetAttempt = useRef<{ signature: string; key: string } | null>(null);
  const legacyReviewAttempt = useRef(new Set<string>());
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  function notifyCanonicalChange() {
    onCanonicalChange?.();
    window.dispatchEvent(new Event("atlas:project-lifecycle"));
  }

  function openTransfer(id: string) {
    router.push(`/projects/${encodeURIComponent(projectId)}/ask?transfer=${encodeURIComponent(id)}`);
  }

  function resetPreparedPacket() {
    setDirectionNote("");
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
    const requestedTransferId = surface === "transfer"
      ? new URLSearchParams(window.location.search).get("transfer")
      : null;
    const requestedConversationId = surface === "transfer"
      ? new URLSearchParams(window.location.search).get("conversation")
      : null;
    setCurrent((prior) => value.transfers?.find((item) => item.id === prior?.id)
      || value.transfers?.find((item) => item.id === requestedTransferId)
      || value.transfers?.find((item) => item.conversationId === requestedConversationId)
      || value.transfers?.find((item) => item.conversationId === preferredConversationId)
      || value.transfers?.[0]
      || null);
  }, [preferredConversationId, projectId, surface]);

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
        const requestedTransferId = surface === "transfer"
          ? new URLSearchParams(window.location.search).get("transfer")
          : null;
        const requestedConversationId = surface === "transfer"
          ? new URLSearchParams(window.location.search).get("conversation")
          : null;
        setCurrent(value.find((item) => item.id === requestedTransferId)
          || value.find((item) => item.conversationId === requestedConversationId)
          || value.find((item) => item.conversationId === preferredConversationId)
          || value[0]
          || null);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Transfers unavailable.");
        setStatus("error");
      });
    return () => { active = false; };
  }, [preferredConversationId, projectId, surface]);

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
    notifyCanonicalChange();
    setStatus("ready");
    return value;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const transcript = String(data.get("transcript") || "");
    const created = await transfer({
      title: inferredRoomTitle(transcript),
      format: inferredRoomFormat(transcript),
      transcript,
    });
    if (created) {
      form.reset();
      openTransfer(created.id);
    }
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
    notifyCanonicalChange();
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
          reviewedStatement: item.statement,
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

  async function preparePacket(taskOverride?: string) {
    if (!current || !canWrite) return;
    const task = taskOverride?.trim() || directionNote.trim() || DEFAULT_CONTINUATION_TASK;
    const signature = JSON.stringify([current.id, current.caseId, task]);
    if (packetAttempt.current?.signature !== signature) {
      packetAttempt.current = {
        signature,
        key: task === DEFAULT_CONTINUATION_TASK
          ? `room-transfer-auto-manifest-v1:${current.id}`
          : `room-transfer-direction:${current.id}:${crypto.randomUUID()}`,
      };
    }
    setPacketStatus("preparing");
    setPacketRun(null);
    setPrepared(null);
    setPacketError("");
    try {
      const requestPacket = async (tokenBudget: number, idempotencyKey: string) => {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/reconstruction/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            ...authorizationHeaders(),
          },
          body: JSON.stringify({
            task,
            ...(current.caseId ? { caseId: current.caseId } : {}),
            tokenBudget,
          }),
        });
        return response.json().catch(() => ({ error: "Transfer packet preparation failed." })) as Promise<(
          Partial<ReconstructionRunResult> & { error?: string }
        )>;
      };
      let value = await requestPacket(STANDARD_TRANSFER_TOKEN_BUDGET, packetAttempt.current.key);
      const safeMinimum = Number(value.failure?.estimatedSafeMinimum || 0);
      if (value.status === "unsafe_under_selected_budget"
        && safeMinimum > STANDARD_TRANSFER_TOKEN_BUDGET
        && safeMinimum <= EXPANDED_TRANSFER_TOKEN_BUDGET) {
        value = await requestPacket(
          EXPANDED_TRANSFER_TOKEN_BUDGET,
          `${packetAttempt.current.key}:safe-${EXPANDED_TRANSFER_TOKEN_BUDGET}`,
        );
      }
      if (value.status === "compiled" && value.packet && value.receipt && value.links && value.literalTask) {
        const complete = value as ReconstructionRunResult;
        const context: PreparedContext = {
          projectId,
          literalTask: complete.literalTask,
          packet: complete.packet!,
          deliveryManifest: complete.deliveryManifest || null,
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
      const unresolvedMinimum = Number(value.failure?.estimatedSafeMinimum || 0);
      setPacketError(value.error
        || value.failure?.message
        || (value.status === "unsafe_under_selected_budget" && unresolvedMinimum > EXPANDED_TRANSFER_TOKEN_BUDGET
          ? `The smallest complete transfer needs about ${unresolvedMinimum} tokens, above Atlas's ${EXPANDED_TRANSFER_TOKEN_BUDGET}-token safety ceiling.`
          : value.need?.explanation)
        || "Atlas could not prepare a truthful transfer packet.");
    } catch (caught) {
      setPacketStatus("failure");
      setPacketError(caught instanceof Error ? caught.message : "Atlas could not prepare a truthful transfer packet.");
    }
  }

  async function removeTransfer(transferToRemove: Transfer) {
    setStatus("saving");
    setError("");
    setActionMessage("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/work/${encodeURIComponent(transferToRemove.conversationId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authorizationHeaders() },
        body: JSON.stringify({ status: "archived" }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Transfer removal failed." })) as { error?: string };
    if (!response.ok) {
      setError(value.error || "Transfer removal failed. Nothing was deleted.");
      setStatus("ready");
      return;
    }
    resetPreparedPacket();
    setRemoveConfirmation(null);
    await load();
    notifyCanonicalChange();
    setActionMessage("Transfer removed from active work. Its source and history remain available in Inspect.");
    setStatus("ready");
  }

  useEffect(() => {
    if (surface !== "transfer" || !canWrite || current?.stage !== "ready_for_steward" || prepared || packetStatus !== "idle") return;
    const pending = window.setTimeout(() => void preparePacket(DEFAULT_CONTINUATION_TASK), 0);
    return () => window.clearTimeout(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, current?.id, current?.stage, packetStatus, prepared, surface]);

  const imported = useMemo(
    () => conversations.filter((conversation) => conversation.sourceType === "imported" && conversation.status !== "archived"),
    [conversations],
  );
  const reviewItems = current?.reconciliation.filter((item) => item.reviewRequired) || [];
  const legacyReview = reviewItems.length > 0 && reviewItems.every((item) => !item.sourceAuthorship);
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
    ...(reviewItems.length && !legacyReview ? [{
      label: `Needs your decision · ${reviewItems.length}`,
      complete: current.stage === "awaiting_review" || current.stage === "ready_for_steward",
    }] : []),
    {
      label: "Ready to continue",
      complete: current.stage === "ready_for_steward",
    },
  ] : [];

  useEffect(() => {
    if (!canWrite
      || status !== "ready"
      || current?.stage !== "awaiting_review"
      || !legacyReview
      || legacyReviewAttempt.current.has(current.id)) return;
    legacyReviewAttempt.current.add(current.id);
    void resume(current.id);
    // The retry is intentionally keyed to the canonical transfer ID. A failed
    // automatic migration remains visible as an error instead of looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, current?.id, current?.stage, legacyReview, status]);

  return (
    <section className={styles.transferRoom}>
      <header>
        <span className={styles.eyebrow}>{surface === "home" ? "Room transfer" : "Final transfer filter"}</span>
        <h2>{surface === "home" ? "Paste the room you want to continue." : "Atlas handles the handoff from here."}</h2>
        <p>{surface === "home"
          ? "That’s it. Atlas will name it, preserve it, reconstruct what is current, and create the fresh-room transfer."
          : "Atlas checks governing clarity, applies the final task-specific filter, and prepares the fresh-room packet."}</p>
      </header>

      {surface === "home" ? (
        <form className={styles.transferForm} onSubmit={submit}>
          <label className={styles.transferTranscript}>
            Conversation
            <textarea name="transcript" placeholder="Paste the whole ChatGPT conversation here." required />
          </label>
          <button disabled={!canWrite || status === "saving"} type="submit">
            {status === "saving" ? "Atlas is reconstructing…" : "Continue this room"}
          </button>
        </form>
      ) : null}

      {surface === "home" && imported.length ? (
        <div className={styles.preservedRooms}>
          <span>Continue a previous transfer</span>
          {imported.map((conversation) => {
            const existing = transfers.find((item) => item.conversationId === conversation.id);
            return (
              <button
                disabled={!canWrite || status === "saving"}
                key={conversation.id}
                onClick={() => {
                  if (existing) openTransfer(existing.id);
                  else void transfer({ conversationId: conversation.id }).then((created) => {
                    if (created) openTransfer(created.id);
                  });
                }}
                type="button"
              >
                <strong>{conversation.title}</strong>
                <small>{existing?.stage === "ready_for_steward" ? "Ready to continue" : "Continue transfer"}</small>
              </button>
            );
          })}
        </div>
      ) : null}

      {surface === "transfer" && transfers.length > 1 ? (
        <label className={styles.transferSelector}>
          Room
          <select
            onChange={(event) => {
              const selected = transfers.find((item) => item.id === event.target.value) || null;
              resetPreparedPacket();
              setCurrent(selected);
              if (selected) window.history.replaceState({}, "", `?transfer=${encodeURIComponent(selected.id)}`);
            }}
            value={current?.id || ""}
          >
            {transfers.map((item) => <option key={item.id} value={item.id}>{item.conversationTitle}</option>)}
          </select>
        </label>
      ) : null}

      {!canWrite && <p className={styles.readOnlyNotice}>Sign in as the owner to transfer a room or make governing decisions.</p>}
      {actionMessage && <p className={styles.lifecycleMessage} role="status">{actionMessage}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {surface === "transfer" && !current && status === "ready" ? (
        <div className={styles.noTransferState}>
          <strong>No room is ready to transfer yet.</strong>
          <p>Connect an existing conversation on Home. Atlas will reconstruct it and bring you back here only if it needs clarity.</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/work`}>Connect a room</Link>
        </div>
      ) : null}

      {surface === "transfer" && current ? (
        <article className={styles.transferResult} aria-live="polite">
          <div className={styles.transferResultHeader}>
            <div>
              <span className={styles.eyebrow}>{current.status === "complete" ? "Ready to continue" : "Room transferred"}</span>
              <h3>{current.conversationTitle}</h3>
              <p>
                {current.stage === "ready_for_steward"
                  ? `${preserved} message${preserved === 1 ? "" : "s"} preserved. This room is ready to continue.`
                  : legacyReview
                    ? `${preserved} message${preserved === 1 ? "" : "s"} preserved. Atlas is organizing the current state.`
                  : reviewItems.length
                    ? `${preserved} message${preserved === 1 ? "" : "s"} preserved. Atlas needs your judgment on ${reviewItems.length} item${reviewItems.length === 1 ? "" : "s"}.`
                    : `${preserved} message${preserved === 1 ? "" : "s"} preserved. Atlas is identifying what should carry forward.`}
              </p>
            </div>
            <div className={styles.transferResultActions}>
              <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/transfers/${encodeURIComponent(current.id)}`}>Open in Inspect</Link>
              {removeConfirmation === current.id ? (
                <div className={styles.removeTransferConfirmation}>
                  <span>Remove from active work? Atlas will keep its history.</span>
                  <button disabled={!canWrite || status === "saving"} onClick={() => void removeTransfer(current)} type="button">Confirm remove</button>
                  <button onClick={() => setRemoveConfirmation(null)} type="button">Cancel</button>
                </div>
              ) : (
                <button disabled={!canWrite || status === "saving"} onClick={() => setRemoveConfirmation(current.id)} type="button">Remove transfer</button>
              )}
            </div>
          </div>
          <ol className={styles.transferProgress}>
            {journey.map((step) => (
              <li data-complete={step.complete} key={step.label}>
                <span>{step.complete ? "✓" : "·"}</span>{step.label}
              </li>
            ))}
          </ol>

          {current.stage === "awaiting_review" && legacyReview ? (
            <div className={styles.automaticTransfer} role="status">
              <span className={styles.eyebrow}>Reconstructing the room</span>
              <strong>Atlas is resolving repeated and already-answered state.</strong>
              <p>No review is needed unless a real ambiguity remains.</p>
            </div>
          ) : null}

          {current.stage === "awaiting_review" && !legacyReview && (
            <details className={styles.transferReview} open>
              <summary>{reviewItems.length === 1 ? "Atlas needs one decision" : `Atlas needs ${reviewItems.length} decisions`}</summary>
              {reviewItems.map((item) => (
                <article key={item.findingId}>
                  <span>Governing clarity</span>
                  <strong className={styles.reviewStatement}>{item.statement}</strong>
                  <p>Atlas cannot safely decide from the conversation alone whether this should guide the fresh room.</p>
                  <details>
                    <summary>View the supporting conversation</summary>
                    {item.exactSources.map((source) => <pre key={source.eventId}>{source.exactContent}</pre>)}
                  </details>
                  <div className={styles.reviewActions}>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Use")} type="button">Keep</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Consider")} type="button">Decide later</button>
                    <button disabled={!canWrite || status === "saving"} onClick={() => govern(item, "Exclude")} type="button">Do not keep</button>
                  </div>
                </article>
              ))}
            </details>
          )}

          {current.stage === "ready_for_steward" && (
            <div className={styles.roomReady}>
              {!prepared && ["idle", "preparing"].includes(packetStatus) ? (
                <div className={styles.automaticTransfer} role="status">
                  <span className={styles.eyebrow}>Reconstruction complete</span>
                  <strong>Atlas is preparing the final continuation.</strong>
                  <p>{preserved.toLocaleString()} messages are preserved. No prompt or packet setup is required.</p>
                </div>
              ) : null}
              {!prepared && packetStatus === "needs_input" ? (
                <form className={styles.transferTask} onSubmit={(event) => { event.preventDefault(); void preparePacket(); }}>
                  <div>
                    <span className={styles.eyebrow}>One direction needed</span>
                    <h3>Atlas found more than one safe way to continue.</h3>
                    <p>{packetRun?.need.explanation || packetError}</p>
                  </div>
                  <label htmlFor={`transfer-direction-${current.id}`}>What should the fresh room focus on?</label>
                  <textarea
                    id={`transfer-direction-${current.id}`}
                    onChange={(event) => setDirectionNote(event.target.value)}
                    placeholder="One short direction is enough."
                    value={directionNote}
                  />
                  <button disabled={!canWrite || !directionNote.trim()} type="submit">Continue</button>
                </form>
              ) : null}
              {!prepared && packetStatus === "failure" ? (
                <div className={styles.transferGuidance} role="alert">
                  <strong>Atlas stopped before creating the packet.</strong>
                  <p>{packetError}</p>
                  <span>The room and completed reconstruction remain preserved.</span>
                  <button disabled={!canWrite} onClick={() => { setPacketStatus("idle"); packetAttempt.current = null; }} type="button">Try again</button>
                </div>
              ) : null}
              {prepared ? (
                <div className={styles.embeddedPacket}>
                  <ReadyTransfer context={prepared} preserved={preserved} />
                  {packetRun?.need.level === "full" ? (
                    <details className={styles.directionControl}>
                      <summary>Adjust direction <span>Optional</span></summary>
                      <p>Atlas already created the complete transfer. Only change this if the fresh room should start somewhere specific.</p>
                      <div className={styles.directionChoices}>
                        <button onClick={() => setDirectionNote("Continue from the current next action.")} type="button">Current next action</button>
                        <button onClick={() => setDirectionNote("Resolve the most material open decision before taking the next action.")} type="button">Open decision first</button>
                      </div>
                      <form onSubmit={(event) => { event.preventDefault(); void preparePacket(); }}>
                        <label htmlFor={`optional-direction-${current.id}`}>Direction</label>
                        <textarea
                          id={`optional-direction-${current.id}`}
                          onChange={(event) => setDirectionNote(event.target.value)}
                          placeholder="Optional: give Atlas one short directional note."
                          value={directionNote}
                        />
                        <button disabled={!directionNote.trim() || packetStatus === "preparing"} type="submit">
                          {packetStatus === "preparing" ? "Updating…" : "Update transfer"}
                        </button>
                      </form>
                    </details>
                  ) : null}
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
