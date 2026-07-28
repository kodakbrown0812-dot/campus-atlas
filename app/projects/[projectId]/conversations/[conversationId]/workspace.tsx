"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

type Detail = {
  conversation: {
    id: string;
    title: string;
    sourceType: string;
    provenance: Record<string, unknown>;
    activeCaseId: string | null;
    originalStartedAt: string | null;
    originalEndedAt: string | null;
  };
  messages: Message[];
  cases: Case[];
  events: Event[];
  imports: Array<{
    importId: string;
    sourceType: string;
    representationType: string;
    authorityState: string;
    sourceName: string | null;
    contentHash: string;
    messageCount: number;
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
  findings: Array<{ id: string; proposal: string; status: string }>;
  noDurableFindingProposed?: boolean;
};

export default function ConversationWorkspace({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [actionKey, setActionKey] = useState("");
  const [selectedCase, setSelectedCase] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "analyzing" | "complete" | "error">("idle");
  const [checkpoint, setCheckpoint] = useState<CheckpointResult | null>(null);
  const [error, setError] = useState("");

  const fetchConversation = useCallback(async () => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
    );
    if (!response.ok) throw new Error("Canonical conversation unavailable.");
    return response.json() as Promise<Detail>;
  }, [conversationId, projectId]);

  useEffect(() => {
    let active = true;
    fetchConversation()
      .then((result) => {
        if (active) {
          setDetail(result);
          setSelectedCase(result.conversation.activeCaseId || "");
          setStatus("ready");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Conversation unavailable.");
          setStatus("error");
        }
      });
    return () => { active = false; };
  }, [fetchConversation]);

  async function changeActiveCase() {
    if (!selectedCase) return;
    setStatus("saving");
    setError("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/active-case`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${actionKey}`,
        },
        body: JSON.stringify({ caseId: selectedCase, actorId: "cody", reason: "Selected from the canonical conversation interface." }),
      },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: "Active case update failed." })) as { error?: string };
      setError(result.error || "Active case update failed.");
      setStatus("ready");
      return;
    }
    const refreshed = await fetchConversation();
    setDetail(refreshed);
    setSelectedCase(refreshed.conversation.activeCaseId || "");
    setStatus("ready");
  }

  async function inspectOriginalSource() {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/source`,
    );
    if (!response.ok) {
      setError("Original import source is unavailable.");
      return;
    }
    setSource(await response.json() as Source);
  }

  async function analyzeNow() {
    if (!activeCase) return;
    setAnalysisStatus("analyzing");
    setError("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${actionKey}`,
          "idempotency-key": `analyze-now:${conversationId}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          conversationId,
          caseId: activeCase.id,
          trigger: "analyze_now",
          source: "canonical_case_events",
          findingCandidates: [],
        }),
      },
    );
    const result = await response.json().catch(() => ({ error: "Checkpoint failed." })) as CheckpointResult & { error?: string };
    if (!response.ok) {
      setError(result.error || "Checkpoint failed.");
      setAnalysisStatus("error");
      return;
    }
    setCheckpoint(result);
    setAnalysisStatus("complete");
  }

  if (status === "loading") return <div className={styles.shell}><section className={styles.panel}>Loading preserved conversation…</section></div>;
  if (status === "error" || !detail) {
    return <div className={styles.shell}><section className={`${styles.panel} ${styles.error}`}>{error}</section></div>;
  }

  const activeCase = detail.cases.find((record) => record.id === detail.conversation.activeCaseId) || null;
  return (
    <div className={styles.shell}>
      <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/conversations`}>← Conversations</Link>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{detail.conversation.sourceType} conversation</span>
          <h1>{detail.conversation.title}</h1>
          <p>{detail.conversation.originalStartedAt || "Original start unavailable"} → {detail.conversation.originalEndedAt || "open"}</p>
        </div>
        <span className={styles.status}>{detail.messages.length} immutable messages</span>
      </header>

      <div className={styles.grid}>
        <section className={styles.transcript} aria-label="Preserved transcript">
          {detail.messages.map((message) => (
            <article className={styles.message} id={`message-${encodeURIComponent(message.id)}`} key={message.id}>
              <header>
                <strong>{message.actorId || message.actorType}</strong>
                <span>Message {message.sequence}</span>
              </header>
              <pre>{message.exactContent}</pre>
              <div className={styles.source}>
                <span>{message.originalTimestamp || "Original timestamp unavailable"}</span>
                <code>{message.sourceReference || message.contentHash}</code>
              </div>
            </article>
          ))}
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.panel}>
            <span className={styles.eyebrow}>Source</span>
            <h2>Provenance</h2>
            <div className={styles.source}>
              <code>{JSON.stringify(detail.conversation.provenance)}</code>
              {detail.imports.map((record) => (
                <span key={record.importId}>
                  {record.sourceName || record.importId} · {record.representationType} · {record.authorityState} · {record.messageCount} messages · {record.contentHash}
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
            <span className={styles.eyebrow}>Active continuity</span>
            <h2>Case</h2>
            {detail.cases.length ? (
              <>
                <select className={styles.select} onChange={(event) => setSelectedCase(event.target.value)} value={selectedCase}>
                  <option value="">Select a case</option>
                  {detail.cases.map((record) => <option key={record.id} value={record.id}>{record.objective}</option>)}
                </select>
                <input
                  aria-label="Canonical write key"
                  className={styles.input}
                  onChange={(event) => setActionKey(event.target.value)}
                  placeholder="Write key (kept only in memory)"
                  type="password"
                  value={actionKey}
                />
                <button className={styles.button} disabled={status === "saving" || !selectedCase || !actionKey} onClick={changeActiveCase} type="button">
                  {status === "saving" ? "Saving…" : "Set active case"}
                </button>
              </>
            ) : <p className={styles.muted}>No case is associated with this conversation.</p>}
            {error && <p className={styles.error}>{error}</p>}
            {activeCase && (
              <article className={styles.case}>
                <strong>{activeCase.objective}</strong>
                <p>Status: {activeCase.status}</p>
                <p>Thesis: {activeCase.thesis || "Not established"}</p>
                <p>Decision: {activeCase.decision || "Not established"}</p>
                <p>Constraints: {activeCase.constraints.length ? activeCase.constraints.join(", ") : "None recorded"}</p>
                <p>Core: {JSON.stringify(activeCase.caseCore)}</p>
              </article>
            )}
            {activeCase && (
              <>
                <button
                  className={styles.button}
                  disabled={!actionKey || analysisStatus === "analyzing"}
                  onClick={analyzeNow}
                  type="button"
                >
                  {analysisStatus === "analyzing" ? "Analyzing canonical events…" : "Analyze now"}
                </button>
                <Link className={styles.textLink} href={`/projects/${encodeURIComponent(projectId)}/findings`}>
                  Open Atlas Found
                </Link>
              </>
            )}
            {checkpoint && (
              <article className={styles.checkpoint}>
                <strong>{checkpoint.checkpoint.healthBefore} → {checkpoint.checkpoint.healthAfter}</strong>
                <p>
                  {checkpoint.checkpoint.candidateCount} candidates · {checkpoint.checkpoint.selectedCount} selected · {checkpoint.checkpoint.omittedCount} omitted
                </p>
                <p>
                  {checkpoint.noDurableFindingProposed
                    ? "No durable finding proposed."
                    : `${checkpoint.findings.length} finding${checkpoint.findings.length === 1 ? "" : "s"} need review.`}
                </p>
                {!!checkpoint.checkpoint.missingState.length && (
                  <p>Missing state: {checkpoint.checkpoint.missingState.join(", ")}</p>
                )}
              </article>
            )}
          </section>

          <section className={styles.panel}>
            <span className={styles.eyebrow}>Consequential events</span>
            <h2>Source links</h2>
            {!detail.events.length && <p className={styles.muted}>No events extracted. The transcript remains valid.</p>}
            {detail.events.map((event) => (
              <article className={styles.event} key={event.id}>
                <strong>{event.type} · {event.assignmentState}</strong>
                <p>{event.exactSourceSpan}</p>
                {event.sourceLinks.map((link) => <a href={link.href} key={link.messageId}>Open exact message</a>)}
              </article>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
