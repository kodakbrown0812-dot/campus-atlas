"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useWriteSession } from "../../../../components/write-session";
import { messageAnchorId, messageIdFromAnchorHash } from "../../../../../shared/message-anchors";
import styles from "../conversation.module.css";

type Message = {
  id: string;
  sequence: number;
  actorType: string;
  actorId: string | null;
  exactContent: string;
  originalTimestamp: string | null;
  ingestedAt: string;
  sourceReference: string | null;
  contentHash: string;
};

type Case = {
  id: string;
  objective: string;
  thesis: string | null;
  decision: string | null;
  status: string;
  timeHorizon: string | null;
  constraints: string[];
  caseCore: Record<string, unknown>;
};

type Event = {
  id: string;
  type: string;
  assignmentState: string;
  exactSourceSpan: string;
  sourceLinks: Array<{ messageId: string; href: string }>;
};

type ReasoningHealth = {
  state: "Forming" | "Missing information" | "Awaiting decision" | "Awaiting outcome" | "Awaiting governance" | "Conflict";
  cause: { id: string; label: string; href: string };
  recommendedNextAction: string;
  latestCheckpoint: {
    id: string;
    status: string;
    trigger: string;
    selectedCount: number;
    omittedCount: number;
    completedAt: string | null;
  } | null;
  pendingFindingCount: number;
  derivedAt: string;
};

type Detail = {
  conversation: {
    id: string;
    title: string;
    sourceType: string;
    provenance: Record<string, unknown>;
    activeCaseId: string | null;
    originalStartedAt: string | null;
    originalEndedAt: string | null;
    createdAt: string;
  };
  reasoningHealth: ReasoningHealth;
  messages: Message[];
  cases: Case[];
  events: Event[];
  imports: Array<{
    id: string;
    importId: string;
    sourceType: string;
    representationType: string;
    authorityState: string;
    sourceName: string | null;
    contentHash: string;
    messageCount: number;
    provenance: Record<string, unknown>;
  }>;
};

type Source = {
  imports: Array<{
    id: string;
    sourceName: string | null;
    rawSource: string;
    contentHash: string;
    diagnostics: Record<string, unknown>;
  }>;
};

type CheckpointResult = {
  checkpoint: {
    id: string;
    trigger: string;
    status: string;
    candidateCount: number;
    selectedCount: number;
    omittedCount: number;
    healthBefore: string;
    healthAfter: string;
    missingState: string[];
    ambiguity: string | null;
  };
  selectedNodes: Array<{
    id: string;
    type: string;
    statement: string;
    representationType: string;
    sourceEventIds: string[];
  }>;
  findings: Array<{
    id: string;
    proposal: string;
    status: string;
    selectedNodeIds?: string[];
  }>;
  retrievalEffect?: "none" | "no_change_until_governed";
  suppressedFindingCount?: number;
  noDurableFindingProposed?: boolean;
};

const analysisStages = [
  "Preparing source events",
  "Identifying candidate structure",
  "Selecting consequential nodes",
  "Checking missing state and conflict",
  "Creating findings",
] as const;

function readableTime(value: string | null) {
  if (!value) return "Exact timestamp unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function healthClass(value: ReasoningHealth["state"]) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

export default function ConversationWorkspace({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string;
}) {
  const { session, authorizationHeaders } = useWriteSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [selectedCase, setSelectedCase] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "running" | "complete" | "failed">("idle");
  const [checkpoint, setCheckpoint] = useState<CheckpointResult | null>(null);
  const [checkpointOrigin, setCheckpointOrigin] = useState<"new" | "restored" | null>(null);
  const [error, setError] = useState("");

  const fetchConversation = useCallback(async () => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      { cache: "no-store" },
    );
    const value = await response.json().catch(() => null) as Detail | { error?: string } | null;
    const responseError = value && typeof (value as { error?: unknown }).error === "string"
      ? String((value as { error: string }).error)
      : null;
    if (!response.ok || !value || responseError) {
      throw new Error(responseError || "Canonical conversation unavailable.");
    }
    return value as Detail;
  }, [conversationId, projectId]);

  const fetchLatestCheckpoint = useCallback(async (caseId: string | null) => {
    if (!caseId) return null;
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints/latest?conversationId=${encodeURIComponent(conversationId)}&caseId=${encodeURIComponent(caseId)}`,
      { cache: "no-store" },
    );
    const value = await response.json().catch(() => null) as {
      error?: string;
      result?: CheckpointResult | null;
    } | null;
    if (!response.ok || !value) throw new Error(value?.error || "Latest checkpoint unavailable.");
    return value.result || null;
  }, [conversationId, projectId]);

  const refresh = useCallback(async () => {
    const value = await fetchConversation();
    setDetail(value);
    setSelectedCase(value.conversation.activeCaseId || "");
    return value;
  }, [fetchConversation]);

  useEffect(() => {
    let active = true;
    fetchConversation()
      .then(async (result) => {
        if (!active) return;
        setDetail(result);
        setSelectedCase(result.conversation.activeCaseId || "");
        try {
          const latest = await fetchLatestCheckpoint(result.conversation.activeCaseId);
          if (!active) return;
          if (latest) {
            setCheckpoint(latest);
            setCheckpointOrigin("restored");
            setAnalysisStatus("complete");
          }
        } catch (caught) {
          if (!active) return;
          setError(caught instanceof Error
            ? `${caught.message} The preserved transcript remains valid.`
            : "Latest checkpoint unavailable. The preserved transcript remains valid.");
        }
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Canonical conversation unavailable.");
        setStatus("unavailable");
      });
    return () => { active = false; };
  }, [fetchConversation, fetchLatestCheckpoint]);

  useEffect(() => {
    if (!detail) return;

    let frame = 0;
    const revealExactMessage = () => {
      document.querySelectorAll<HTMLElement>("[data-source-target='true']").forEach((element) => {
        delete element.dataset.sourceTarget;
      });

      const messageId = messageIdFromAnchorHash(window.location.hash);
      if (!messageId) return;

      const target = document.getElementById(messageAnchorId(messageId));
      if (!target) return;

      target.dataset.sourceTarget = "true";
      target.scrollIntoView({ block: "center", behavior: "auto" });
    };

    frame = window.requestAnimationFrame(revealExactMessage);
    window.addEventListener("hashchange", revealExactMessage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", revealExactMessage);
    };
  }, [detail]);

  const canWrite = Boolean(session?.writeAuthorization.authorized);
  const activeCase = detail?.cases.find((record) => record.id === detail.conversation.activeCaseId) || null;

  async function postCanonical(path: string, body: Record<string, unknown>, idempotencyKey?: string) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...authorizationHeaders(),
      },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({ error: "Canonical write failed." })) as {
      error?: string;
      [key: string]: unknown;
    };
    if (!response.ok) {
      throw new Error(response.status === 401
        ? "Write authorization is required. Nothing was saved."
        : value.error || "Canonical write failed. Nothing was saved.");
    }
    return value;
  }

  async function changeActiveCase() {
    if (!selectedCase) return;
    setStatus("saving");
    setError("");
    try {
      await postCanonical(
        `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/active-case`,
        {
          caseId: selectedCase,
          actorId: session?.actor.id || "cody",
          reason: "Selected from the canonical conversation interface.",
        },
      );
      await refresh();
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Active case update failed.");
      setStatus("ready");
    }
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const objective = String(data.get("objective") || "").trim();
    if (!objective) return;
    setStatus("saving");
    setError("");
    try {
      await postCanonical(`/api/v1/projects/${encodeURIComponent(projectId)}/cases`, {
        objective,
        conversationId,
        makeActive: true,
        actorId: session?.actor.id || "cody",
        reason: "Created as the active case from the conversation workspace.",
      });
      form.reset();
      await refresh();
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Case creation failed.");
      setStatus("ready");
    }
  }

  async function appendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const content = String(data.get("content") || "");
    const actorType = String(data.get("actorType") || "user");
    if (!content.trim()) return;
    setSaveStatus("saving");
    setError("");
    try {
      await postCanonical(
        `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          actorType,
          actorId: actorType === "user" ? session?.actor.id || "cody" : "receiving_model",
          content,
          originalTimestamp: new Date().toISOString(),
          metadata: { source: "slice6a_native_composer" },
        },
        `native-message:${crypto.randomUUID()}`,
      );
      form.reset();
      await refresh();
      setSaveStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Message save failed.");
      setSaveStatus("failed");
    }
  }

  async function inspectOriginalSource() {
    setError("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/source`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      setError("Original import source is unavailable. The transcript already loaded remains valid.");
      return;
    }
    setSource(await response.json() as Source);
  }

  async function analyzeNow() {
    if (!activeCase) return;
    setAnalysisStatus("running");
    setCheckpoint(null);
    setCheckpointOrigin(null);
    setError("");
    try {
      const result = await postCanonical(
        `/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`,
        {
          conversationId,
          caseId: activeCase.id,
          trigger: "analyze_now",
          source: "canonical_case_events",
        },
        `analyze-now:${conversationId}:${crypto.randomUUID()}`,
      ) as unknown as CheckpointResult;
      setCheckpoint(result);
      setCheckpointOrigin("new");
      await refresh();
      setAnalysisStatus("complete");
      window.requestAnimationFrame(() => {
        document.getElementById("checkpoint-result")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkpoint failed. Nothing was presented as analyzed.");
      setAnalysisStatus("failed");
    }
  }

  if (status === "loading") {
    return (
      <div className={styles.shell}>
        <section className={styles.panel}>
          <span className={styles.eyebrow}>Canonical conversation</span>
          <h1>Loading preserved transcript…</h1>
          <p className={styles.muted}>No message is shown until D1 confirms it.</p>
        </section>
      </div>
    );
  }

  if (status === "unavailable" || !detail) {
    return (
      <div className={styles.shell}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <span className={styles.eyebrow}>Canonical conversation unavailable</span>
          <h1>The transcript could not be loaded</h1>
          <p>{error}</p>
          <strong>No seeded transcript or success state was substituted.</strong>
          <button className={styles.button} onClick={() => window.location.reload()} type="button">Retry canonical read</button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/work`}>← Work</Link>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{detail.conversation.sourceType} conversation</span>
          <h1>{detail.conversation.title}</h1>
          <p>{readableTime(detail.conversation.originalStartedAt || detail.conversation.createdAt)} → {detail.conversation.originalEndedAt ? readableTime(detail.conversation.originalEndedAt) : "Open"}</p>
        </div>
        <span className={styles.status}>{detail.messages.length} immutable messages</span>
      </header>

      <section className={styles.caseBar} id="active-case">
        <div>
          <span>Project</span>
          <strong>{projectId}</strong>
        </div>
        <div className={styles.caseObjective}>
          <span>Active case</span>
          <strong>{activeCase?.objective || "No active case"}</strong>
          <small>
            {activeCase
              ? `${activeCase.status} · ${activeCase.timeHorizon || "no current-state window"}`
              : "Create or select a case"}
          </small>
        </div>
        <div>
          <span>Reasoning Health</span>
          <Link
            className={`${styles.healthBadge} ${styles[healthClass(detail.reasoningHealth.state)]}`}
            href={detail.reasoningHealth.cause.href}
          >
            {detail.reasoningHealth.state}
          </Link>
          <small>{detail.reasoningHealth.recommendedNextAction}</small>
        </div>
        <div>
          <span>Latest checkpoint</span>
          <strong>{detail.reasoningHealth.latestCheckpoint?.status || "Not run"}</strong>
          <small>{detail.reasoningHealth.pendingFindingCount} pending findings</small>
          {checkpoint && <a href="#checkpoint-result">Inspect canonical result</a>}
        </div>
        <button className={styles.analyzeButton} disabled={!canWrite || !activeCase || analysisStatus === "running"} onClick={analyzeNow} type="button">
          {analysisStatus === "running" ? "Analyzing…" : "Analyze now"}
        </button>
        <Link className={styles.structureButton} href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/structure`}>
          View structure
        </Link>
      </section>

      {!canWrite && (
        <div className={styles.readOnly}>
          Read-only session. Enable canonical writes from the sidebar or mobile D1 control. Transcript reads remain available.
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.transcript} aria-label="Preserved transcript">
          {!detail.messages.length && (
            <section className={styles.panel}>
              <strong>This canonical conversation has no messages yet.</strong>
              <p className={styles.muted}>Write the first message below. It will appear only after the server preserves it.</p>
            </section>
          )}
          {detail.messages.map((message) => (
            <article className={styles.message} id={messageAnchorId(message.id)} key={message.id}>
              <header>
                <strong>{message.actorId || message.actorType}</strong>
                <span>Message {message.sequence}</span>
              </header>
              <pre>{message.exactContent}</pre>
              <div className={styles.source}>
                <span>{readableTime(message.originalTimestamp || message.ingestedAt)}</span>
                <code>{message.sourceReference || message.contentHash}</code>
              </div>
            </article>
          ))}

          <form className={styles.composer} onSubmit={appendMessage}>
            <div className={styles.composerHeader}>
              <div>
                <span className={styles.eyebrow}>Native composer</span>
                <strong>Continue the exact conversation</strong>
              </div>
              <select aria-label="Message author" defaultValue="user" name="actorType">
                <option value="user">Cody · user</option>
                <option value="assistant">Receiving model · assistant</option>
              </select>
            </div>
            <textarea
              aria-label="Exact message"
              disabled={!canWrite || saveStatus === "saving"}
              name="content"
              placeholder="Write the next exact message…"
              required
            />
            <div className={styles.composerFooter}>
              <span className={saveStatus === "failed" ? styles.error : styles.muted}>
                {saveStatus === "saving"
                  ? "Saving to canonical D1…"
                  : saveStatus === "saved"
                    ? "Server confirmed the preserved message."
                    : saveStatus === "failed"
                      ? "Save failed. The message was not presented as preserved."
                      : "Messages are immutable after canonical confirmation."}
              </span>
              <button className={styles.button} disabled={!canWrite || saveStatus === "saving"} type="submit">
                Preserve message
              </button>
            </div>
          </form>
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>Case continuity</span>
            <h2>Active case</h2>
            {detail.cases.length ? (
              <>
                <select className={styles.select} onChange={(event) => setSelectedCase(event.target.value)} value={selectedCase}>
                  <option value="">Select a case</option>
                  {detail.cases.map((record) => <option key={record.id} value={record.id}>{record.objective}</option>)}
                </select>
                <button className={styles.button} disabled={!canWrite || status === "saving" || !selectedCase} onClick={changeActiveCase} type="button">
                  {status === "saving" ? "Saving…" : "Change active case"}
                </button>
              </>
            ) : <p className={styles.muted}>No case is associated with this conversation.</p>}
            <form className={styles.caseForm} onSubmit={createCase}>
              <label htmlFor="case-objective">New case objective</label>
              <input className={styles.input} id="case-objective" name="objective" placeholder="Bound the work that should remain continuous" required />
              <button className={styles.button} disabled={!canWrite || status === "saving"} type="submit">Create active case</button>
            </form>
            {activeCase && (
              <article className={styles.case}>
                <strong>{activeCase.objective}</strong>
                <p>Thesis: {activeCase.thesis || "Not established"}</p>
                <p>Decision: {activeCase.decision || "Not established"}</p>
                <p>Freshness: {activeCase.timeHorizon || "No time horizon recorded"}</p>
              </article>
            )}
          </section>

          <section className={styles.panel}>
            <span className={styles.eyebrow}>Source and provenance</span>
            <h2>{detail.imports.length ? "Imported source" : "Native source"}</h2>
            <div className={styles.source}>
              <code>{JSON.stringify(detail.conversation.provenance)}</code>
              {detail.imports.map((record) => (
                <span key={record.importId}>
                  {record.sourceName || record.importId} · {record.representationType} · {record.authorityState} · {record.messageCount} messages
                </span>
              ))}
            </div>
            {detail.conversation.sourceType !== "native" && (
              <button className={styles.button} onClick={inspectOriginalSource} type="button">Inspect exact imported source</button>
            )}
            {source?.imports.map((record) => (
              <details key={record.id}>
                <summary>{record.sourceName || record.contentHash}</summary>
                <pre className={styles.raw}>{record.rawSource}</pre>
              </details>
            ))}
          </section>

          <section className={styles.panel}>
            <span className={styles.eyebrow}>Consequential events</span>
            <h2>Source links</h2>
            {!detail.events.length && <p className={styles.muted}>No events extracted. The transcript remains valid.</p>}
            {detail.events.map((event) => (
              <article className={styles.event} id={`event-${encodeURIComponent(event.id)}`} key={event.id}>
                <strong>{event.type} · {event.assignmentState}</strong>
                <p>{event.exactSourceSpan}</p>
                {event.sourceLinks.map((link) => <a href={link.href} key={link.messageId}>Open exact message</a>)}
              </article>
            ))}
          </section>
        </aside>
      </div>

      {analysisStatus !== "idle" && (
        <section className={`${styles.analysisPanel} ${analysisStatus === "failed" ? styles.analysisFailed : ""}`} id="checkpoint-result">
          <header>
            <div>
              <span className={styles.eyebrow}>{checkpointOrigin === "restored" ? "Existing canonical checkpoint" : "Checkpoint action"}</span>
              <h2>{analysisStatus === "running"
                ? "Analyze now is running"
                : analysisStatus === "complete"
                  ? checkpointOrigin === "restored" ? "Saved Analyze result" : "Analyze now complete"
                  : "Analyze now failed"}</h2>
            </div>
            <span className={styles.status}>{checkpoint?.checkpoint.id || "No checkpoint saved yet"}</span>
          </header>
          <ol className={styles.analysisStages}>
            {analysisStages.map((stage, index) => (
              <li key={stage}>
                <i>
                  {analysisStatus === "complete"
                    ? "✓"
                    : analysisStatus === "failed"
                      ? index === 0 ? "!" : "—"
                      : index === 0 ? "…" : "·"}
                </i>
                <span>{stage}</span>
              </li>
            ))}
          </ol>
          {checkpoint && (
            <div className={styles.analysisResult}>
              <dl>
                <div><dt>Trigger</dt><dd>{checkpoint.checkpoint.trigger}</dd></div>
                <div><dt>Case</dt><dd>{activeCase?.objective || checkpoint.checkpoint.id}</dd></div>
                <div><dt>Events considered</dt><dd>{checkpoint.checkpoint.candidateCount}</dd></div>
                <div><dt>Selected</dt><dd>{checkpoint.checkpoint.selectedCount}</dd></div>
                <div><dt>Omitted</dt><dd>{checkpoint.checkpoint.omittedCount}</dd></div>
                <div><dt>Reasoning Health</dt><dd>{checkpoint.checkpoint.healthBefore} → {checkpoint.checkpoint.healthAfter}</dd></div>
                <div><dt>Missing state</dt><dd>{checkpoint.checkpoint.missingState.join(", ") || "None recorded"}</dd></div>
                <div><dt>Ambiguity</dt><dd>{checkpoint.checkpoint.ambiguity || "None recorded"}</dd></div>
                <div><dt>Findings created</dt><dd>{checkpoint.findings.length}</dd></div>
                <div><dt>Retrieval effect</dt><dd>{checkpoint.retrievalEffect === "no_change_until_governed"
                  ? "No authority changed; findings remain proposals until governed."
                  : "No retrieval eligibility changed."}</dd></div>
              </dl>
              <div>
                <h3>Selected nodes</h3>
                {checkpoint.selectedNodes.length
                  ? checkpoint.selectedNodes.map((node) => <p key={node.id}>{node.type}: {node.statement}</p>)
                  : <p>No consequential node was selected.</p>}
              </div>
              <strong>
                {checkpoint.noDurableFindingProposed
                  ? "Atlas found no consequence that should change future retrieval."
                  : `${checkpoint.findings.length} atomic finding${checkpoint.findings.length === 1 ? "" : "s"} awaits governance.`}
              </strong>
              {checkpoint.findings.length > 0 && (
                <div>
                  <h3>Atlas Found proposals</h3>
                  {checkpoint.findings.map((finding) => (
                    <p key={finding.id}>
                      <Link href={`/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(finding.id)}`}>
                        {finding.proposal}
                      </Link>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {analysisStatus === "failed" && (
            <p className={styles.error}>{error} Existing transcript and case records remain valid.</p>
          )}
        </section>
      )}

      {error && analysisStatus !== "failed" && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
