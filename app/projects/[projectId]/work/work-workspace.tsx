"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "../../../components/write-session";
import { useStewardTask } from "../../../components/steward-task";
import TransferRoom from "./transfer-room";
import styles from "./work.module.css";

type WorkConversation = {
  id: string;
  title: string;
  sourceType: string;
  status: "active" | "completed" | "archived";
  activeCaseObjective: string | null;
  nextAction: string;
};

type WorkOverview = {
  project: {
    id: string;
    name: string;
    description: string | null;
    pendingFindingCount: number;
  };
  activeConversationId: string | null;
  conversations: WorkConversation[];
};

function HistoryCard({
  canWrite,
  onRestore,
  projectId,
  conversation,
}: {
  canWrite: boolean;
  onRestore: (conversation: WorkConversation) => void;
  projectId: string;
  conversation: WorkConversation;
}) {
  return (
    <article className={styles.historyCard}>
      <span className={styles.historyStatus}>
        {conversation.status === "archived" ? "Archived" : conversation.status === "completed" ? "Completed" : "Earlier work"}
      </span>
      <strong>{conversation.title}</strong>
      <span>{conversation.activeCaseObjective || "No active objective yet"}</span>
      <div>
        <Link href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversation.id)}`}>
          Open history
        </Link>
        {conversation.status !== "active" ? (
          <button disabled={!canWrite} onClick={() => onRestore(conversation)} type="button">Restore</button>
        ) : null}
      </div>
    </article>
  );
}

export default function WorkWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session, authorizationHeaders } = useWriteSession();
  const { clearTask } = useStewardTask();
  const [overview, setOverview] = useState<WorkOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [mode, setMode] = useState<"none" | "native" | "transfer">("none");
  const [error, setError] = useState("");
  const [lifecycleMessage, setLifecycleMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/work`, {
      cache: "no-store",
    });
    const value = await response.json().catch(() => null) as WorkOverview | { error?: string } | null;
    const responseError = value && typeof (value as { error?: unknown }).error === "string"
      ? String((value as { error: string }).error)
      : null;
    if (!response.ok || !value || responseError) {
      throw new Error(responseError || "Project state is unavailable.");
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
        setError(caught instanceof Error ? caught.message : "Project state is unavailable.");
        setStatus("unavailable");
      });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      void load().then(setOverview).catch(() => undefined);
    };
    window.addEventListener("atlas:project-lifecycle", refresh);
    return () => window.removeEventListener("atlas:project-lifecycle", refresh);
  }, [load]);

  const projectWork = useMemo(() => {
    const conversations = overview?.conversations || [];
    return conversations.filter((item) => item.id !== overview?.activeConversationId);
  }, [overview]);

  const activeConversation = overview?.conversations.find((item) => item.id === overview.activeConversationId) || null;
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  async function updateWorkLifecycle(conversation: WorkConversation, nextStatus: WorkConversation["status"]) {
    setStatus("saving");
    setError("");
    setLifecycleMessage("");
    try {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/work/${encodeURIComponent(conversation.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", ...authorizationHeaders() },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const value = await response.json().catch(() => ({ error: "Work update failed." })) as { error?: string };
      if (!response.ok) {
        throw new Error(response.status === 401
          ? "Sign in as the owner to change active work."
          : value.error || "Work update failed.");
      }
      if (nextStatus !== "active") clearTask(projectId);
      setOverview(await load());
      setLifecycleMessage(nextStatus === "active"
        ? `${conversation.title} is active again.`
        : nextStatus === "completed"
          ? `${conversation.title} is complete. Its history is still preserved.`
          : `${conversation.title} was archived. Its history is still preserved.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Work update failed.");
    } finally {
      setStatus("ready");
    }
  }

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

  if (status === "loading") {
    return (
      <div className={styles.page}>
        <section className={styles.loadingState}>
          <span>Home</span>
          <h1>Getting your work ready…</h1>
          <p>Loading the latest state of this project.</p>
        </section>
      </div>
    );
  }

  if (status === "unavailable" || !overview) {
    return (
      <div className={styles.page}>
        <section className={styles.failureState} role="alert">
          <span>Home unavailable</span>
          <h1>We couldn’t load this project</h1>
          <p>{error}</p>
          <strong>Atlas did not substitute other project data.</strong>
          <button onClick={() => window.location.reload()} type="button">Try again</button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Current project</span>
          <h1>{overview.project.name}</h1>
          <p>Connect an existing room. Atlas will reconstruct where the work actually is and prepare it to continue.</p>
        </div>
      </header>

      <section className={styles.transferEntry}>
        <div>
          <span className={styles.eyebrow}>Start here</span>
          <h2>Transfer an existing room</h2>
          <p>Paste any existing room. Atlas will preserve the source, reconstruct what is current, and stop only if it truly needs your decision.</p>
        </div>
        <button
          aria-expanded={mode === "transfer"}
          onClick={() => setMode(mode === "transfer" ? "none" : "transfer")}
          type="button"
        >
          {mode === "transfer" ? "Close transfer" : "Transfer a room"}
        </button>
      </section>

      {mode === "transfer" && (
        <TransferRoom
          conversations={overview.conversations}
          onCanonicalChange={() => load().then(setOverview).catch(() => undefined)}
          preferredConversationId={overview.activeConversationId}
          projectId={projectId}
        />
      )}

      {activeConversation ? (
        <section className={styles.currentWork} aria-labelledby="current-work-title">
          <details className={styles.workMenu}>
            <summary aria-label="Current work options">…</summary>
            <div>
              <button
                disabled={!canWrite || status === "saving"}
                onClick={() => void updateWorkLifecycle(activeConversation, "completed")}
                type="button"
              >
                Mark complete
              </button>
              <button
                disabled={!canWrite || status === "saving"}
                onClick={() => void updateWorkLifecycle(activeConversation, "archived")}
                type="button"
              >
                Archive
              </button>
            </div>
          </details>
          <div>
            <span className={styles.eyebrow}>Current work</span>
            <h2 id="current-work-title">{activeConversation.title}</h2>
            <p>{activeConversation.activeCaseObjective || "Continue this conversation and shape the next useful decision."}</p>
          </div>
          <div className={styles.nextAction}>
            <span>Next</span>
            <p>{activeConversation.nextAction}</p>
          </div>
          <button
            className={styles.continueButton}
            onClick={() => setMode("transfer")}
            type="button"
          >
            Continue transfer
          </button>
        </section>
      ) : (
        <section className={styles.emptyState}>
          <span>Current work</span>
          <h2>No active work yet.</h2>
          <p>Transfer an existing room to reconstruct its current state and continue it safely.</p>
        </section>
      )}

      {lifecycleMessage && <p className={styles.lifecycleMessage} role="status">{lifecycleMessage}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {overview.project.pendingFindingCount > 0 ? (
        <Link className={styles.reviewNotice} href={`/projects/${encodeURIComponent(projectId)}/findings`}>
          <strong>Needs review · {overview.project.pendingFindingCount}</strong>
          <span>Atlas needs your judgment before this can become part of the project’s working truth.</span>
          <small>Review now →</small>
        </Link>
      ) : null}

      <details className={styles.moreActions}>
        <summary>Advanced / Internal records</summary>
        <div className={styles.historyHeader}>
          <p>Developer access to preserved conversations and legacy native-work controls.</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/conversations`}>View all internal conversations</Link>
        </div>
        {projectWork.length ? (
          <div className={styles.cardGrid}>
            {projectWork.map((conversation) => (
              <HistoryCard
                canWrite={canWrite}
                conversation={conversation}
                key={conversation.id}
                onRestore={(item) => void updateWorkLifecycle(item, "active")}
                projectId={projectId}
              />
            ))}
          </div>
        ) : <p className={styles.quietEmpty}>No earlier work in this project.</p>}
        <button onClick={() => setMode(mode === "native" ? "none" : "native")} type="button">
          Open legacy native conversation creator
        </button>
        {mode === "native" && (
          <form className={styles.entryForm} onSubmit={createNative}>
            <div>
              <h2>Start a new conversation</h2>
              <p>Give the work a clear title. Atlas will open a new space for it.</p>
            </div>
            <label>
              Conversation title
              <input name="title" placeholder="What are we working through?" required />
            </label>
            {!canWrite && <p className={styles.readOnlyNotice}>Sign in as the owner to create a conversation.</p>}
            <button disabled={!canWrite || status === "saving"} type="submit">
              {status === "saving" ? "Creating conversation…" : "Create conversation"}
            </button>
          </form>
        )}
      </details>
    </div>
  );
}
