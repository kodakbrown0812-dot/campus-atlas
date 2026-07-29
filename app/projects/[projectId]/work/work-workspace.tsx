"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "../../../components/write-session";
import styles from "./work.module.css";

type ReasoningHealth = {
  state: "Forming" | "Missing information" | "Awaiting decision" | "Awaiting outcome" | "Awaiting governance" | "Conflict";
  cause: { id: string; label: string; href: string };
  recommendedNextAction: string;
  latestCheckpoint: {
    id: string;
    status: string;
    completedAt: string | null;
  } | null;
  pendingFindingCount: number;
};

type WorkConversation = {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  activeCaseId: string | null;
  activeCaseObjective: string | null;
  activeCaseStatus: string | null;
  outcomeState: string | null;
  reasoningHealth: ReasoningHealth;
  lastMeaningfulChange: string;
  nextAction: string;
};

type WorkOverview = {
  project: {
    id: string;
    name: string;
    description: string | null;
  };
  activeConversationId: string | null;
  conversations: WorkConversation[];
  recentlyChangedPackets: Array<{
    id: string;
    task: string;
    status: string;
    tokenBudget: number;
    finalTokenCount: number;
    createdAt: string;
  }>;
  fixtureMode: false;
  source: "canonical_d1";
};

function formatTime(value: string | null) {
  if (!value) return "No canonical change recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function healthClass(state: ReasoningHealth["state"]) {
  return state.toLowerCase().replace(/\s+/g, "-");
}

function ConversationCard({
  projectId,
  conversation,
  featured = false,
}: {
  projectId: string;
  conversation: WorkConversation;
  featured?: boolean;
}) {
  return (
    <Link
      className={`${styles.workCard} ${featured ? styles.featured : ""}`}
      href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversation.id)}`}
    >
      <div>
        <span className={styles.cardEyebrow}>{featured ? "Continue working" : conversation.sourceType}</span>
        <h3>{conversation.title}</h3>
        <p>{conversation.activeCaseObjective || "No active case selected"}</p>
      </div>
      <span className={`${styles.health} ${styles[healthClass(conversation.reasoningHealth.state)]}`}>
        {conversation.reasoningHealth.state}
      </span>
      <dl>
        <div>
          <dt>Last meaningful change</dt>
          <dd>{formatTime(conversation.lastMeaningfulChange)}</dd>
        </div>
        <div>
          <dt>Pending findings</dt>
          <dd>{conversation.reasoningHealth.pendingFindingCount}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{conversation.nextAction}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default function WorkWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session, authorizationHeaders } = useWriteSession();
  const [overview, setOverview] = useState<WorkOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [mode, setMode] = useState<"none" | "native" | "import">("none");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/work`, {
      cache: "no-store",
    });
    const value = await response.json().catch(() => null) as WorkOverview | { error?: string } | null;
    const responseError = value && typeof (value as { error?: unknown }).error === "string"
      ? String((value as { error: string }).error)
      : null;
    if (!response.ok || !value || responseError) {
      throw new Error(responseError || "Canonical Work state is unavailable.");
    }
    return value as WorkOverview;
  }, [projectId]);

  useEffect(() => {
    let active = true;
    load()
      .then((value) => {
        if (!active) return;
        setOverview(value);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Canonical Work state is unavailable.");
        setStatus("unavailable");
      });
    return () => { active = false; };
  }, [load]);

  const sections = useMemo(() => {
    const conversations = overview?.conversations || [];
    return [
      { title: "Active conversations", items: conversations.filter((item) => item.status === "active") },
      { title: "Needs decision", items: conversations.filter((item) => item.reasoningHealth.state === "Awaiting decision") },
      { title: "Needs outcome", items: conversations.filter((item) => item.reasoningHealth.state === "Awaiting outcome") },
      { title: "Deferred", items: conversations.filter((item) => item.activeCaseStatus === "deferred") },
    ];
  }, [overview]);

  const activeConversation = overview?.conversations.find((item) => item.id === overview.activeConversationId) || null;
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  async function createNative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authorizationHeaders() },
        body: JSON.stringify({
          title,
          provenance: { source: "campus_atlas_native", createdFrom: "slice6a_work" },
          metadata: { interface: "work" },
        }),
      });
      const value = await response.json().catch(() => ({ error: "Conversation creation failed." })) as {
        conversation?: { id: string };
        error?: string;
      };
      if (!response.ok || !value.conversation) {
        setError(response.status === 401
          ? "Write authorization is required. No conversation was saved."
          : value.error || "Conversation creation failed. Nothing was saved.");
        setStatus("ready");
        return;
      }
      router.push(`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(value.conversation.id)}`);
    } catch (caught) {
      setError(caught instanceof Error
        ? `${caught.message} Nothing was saved.`
        : "Conversation creation failed. Nothing was saved.");
      setStatus("ready");
    }
  }

  async function importTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const transcript = String(form.get("transcript") || "");
    const format = String(form.get("format") || "text");
    const representationType = String(form.get("representationType") || "Exact");
    if (!title || !transcript) return;
    setStatus("saving");
    setError("");
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/conversations/import`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `work-import:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          title,
          sourceName: title,
          sourceType: "explicit_transcript_import",
          representationType,
          authorityState: "observed",
          format,
          transcript,
          provenance: { importedFrom: "slice6a_work" },
        }),
      });
      const value = await response.json().catch(() => ({ error: "Transcript import failed." })) as {
        conversation?: { id: string };
        error?: string;
      };
      if (!response.ok || !value.conversation) {
        setError(response.status === 401
          ? "Write authorization is required. No import was saved."
          : value.error || "Transcript import failed. Nothing was saved.");
        setStatus("ready");
        return;
      }
      router.push(`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(value.conversation.id)}`);
    } catch (caught) {
      setError(caught instanceof Error
        ? `${caught.message} Nothing was saved.`
        : "Transcript import failed. Nothing was saved.");
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <div className={styles.page}>
        <section className={styles.loadingState}>
          <span>Canonical Work</span>
          <h1>Restoring meaningful activity…</h1>
          <p>Reading project conversations, active cases, checkpoints, and pending findings from D1.</p>
        </section>
      </div>
    );
  }

  if (status === "unavailable" || !overview) {
    return (
      <div className={styles.page}>
        <section className={styles.failureState} role="alert">
          <span>Canonical Work unavailable</span>
          <h1>Work could not be loaded</h1>
          <p>{error}</p>
          <strong>No seeded conversation or project was substituted.</strong>
          <button onClick={() => window.location.reload()} type="button">Retry canonical read</button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Work · {overview.source}</span>
          <h1>{overview.project.name}</h1>
          <p>{overview.project.description || "Continue the canonical conversation that matters now."}</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={() => setMode(mode === "native" ? "none" : "native")} type="button">
            Start Atlas conversation
          </button>
          <button onClick={() => setMode(mode === "import" ? "none" : "import")} type="button">
            Import conversation
          </button>
        </div>
      </header>

      {!canWrite && (
        <div className={styles.readOnlyNotice}>
          <strong>Read-only session</strong>
          <span>Enable canonical writes once in the desktop sidebar or from the D1 session control in the mobile header.</span>
        </div>
      )}

      {mode === "native" && (
        <form className={styles.entryForm} onSubmit={createNative}>
          <div>
            <span className={styles.eyebrow}>Native exact-source conversation</span>
            <h2>Start in Atlas</h2>
            <p>The conversation becomes canonical only after the server confirms it.</p>
          </div>
          <label>
            Conversation title
            <input name="title" placeholder="What are we working through?" required />
          </label>
          <button disabled={!canWrite || status === "saving"} type="submit">
            {status === "saving" ? "Saving canonical conversation…" : "Create conversation"}
          </button>
        </form>
      )}

      {mode === "import" && (
        <form className={styles.entryForm} onSubmit={importTranscript}>
          <div>
            <span className={styles.eyebrow}>Preserved source import</span>
            <h2>Add existing work to Atlas</h2>
            <p>Exact bytes, provenance, representation, hash, and duplicate handling remain backend-owned.</p>
          </div>
          <label>
            Source title
            <input name="title" placeholder="Imported conversation" required />
          </label>
          <div className={styles.formRow}>
            <label>
              Format
              <select name="format" defaultValue="text">
                <option value="text">Text transcript</option>
                <option value="json">JSON or ChatGPT export</option>
              </select>
            </label>
            <label>
              Representation
              <select name="representationType" defaultValue="Exact">
                <option value="Exact">Exact</option>
                <option value="Reconstructed">Reconstructed</option>
              </select>
            </label>
          </div>
          <label>
            Source content
            <textarea name="transcript" placeholder="Paste the unchanged transcript or source artifact." required />
          </label>
          <button disabled={!canWrite || status === "saving"} type="submit">
            {status === "saving" ? "Preserving import…" : "Import canonical source"}
          </button>
        </form>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {activeConversation ? (
        <section className={styles.continue}>
          <ConversationCard conversation={activeConversation} featured projectId={projectId} />
        </section>
      ) : (
        <section className={styles.emptyState}>
          <span>Canonical Work is empty</span>
          <h2>Start a conversation or import existing work to begin.</h2>
          <p>No fixture, decorative project card, or simulated activity was inserted.</p>
        </section>
      )}

      {sections.map((section) => {
        const items = section.items.filter((item) => item.id !== activeConversation?.id);
        if (!items.length) return null;
        return (
          <section className={styles.section} key={section.title}>
            <div className={styles.sectionHeading}>
              <h2>{section.title}</h2>
              <span>{items.length}</span>
            </div>
            <div className={styles.cardGrid}>
              {items.map((conversation) => (
                <ConversationCard conversation={conversation} key={conversation.id} projectId={projectId} />
              ))}
            </div>
          </section>
        );
      })}

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Recently changed packets</h2>
          <span>{overview.recentlyChangedPackets.length}</span>
        </div>
        {overview.recentlyChangedPackets.length ? (
          <div className={styles.packetList}>
            {overview.recentlyChangedPackets.map((packet) => (
              <Link href={`/projects/${encodeURIComponent(projectId)}/ask`} key={packet.id}>
                <strong>{packet.task}</strong>
                <span>{packet.status} · {packet.finalTokenCount}/{packet.tokenBudget} tokens · {formatTime(packet.createdAt)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.quietEmpty}>Packets appear after Atlas reconstructs context for a task.</p>
        )}
      </section>
    </div>
  );
}
