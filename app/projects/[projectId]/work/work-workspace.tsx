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
  projectId,
  conversation,
}: {
  projectId: string;
  conversation: WorkConversation;
}) {
  return (
    <Link
      className={styles.historyCard}
      href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversation.id)}`}
    >
      <strong>{conversation.title}</strong>
      <span>{conversation.activeCaseObjective || "No active objective yet"}</span>
      <small>Open work →</small>
    </Link>
  );
}

export default function WorkWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { session, authorizationHeaders } = useWriteSession();
  const { carryTask } = useStewardTask();
  const [overview, setOverview] = useState<WorkOverview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [mode, setMode] = useState<"none" | "native" | "transfer">("none");
  const [error, setError] = useState("");
  const [stewardTask, setStewardTask] = useState("");

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

  const projectWork = useMemo(() => {
    const conversations = overview?.conversations || [];
    return conversations.filter((item) => item.id !== overview?.activeConversationId);
  }, [overview]);

  const activeConversation = overview?.conversations.find((item) => item.id === overview.activeConversationId) || null;
  const canWrite = Boolean(session?.writeAuthorization.authorized);

  function openSteward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stewardTask.trim()) return;
    carryTask(projectId, stewardTask);
    router.push(`/projects/${encodeURIComponent(projectId)}/ask`);
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
          <p>Your current work and the simplest way to continue it.</p>
        </div>
      </header>

      {activeConversation ? (
        <section className={styles.currentWork} aria-labelledby="current-work-title">
          <div>
            <span className={styles.eyebrow}>Current work</span>
            <h2 id="current-work-title">{activeConversation.title}</h2>
            <p>{activeConversation.activeCaseObjective || "Continue this conversation and shape the next useful decision."}</p>
          </div>
          <div className={styles.nextAction}>
            <span>Next</span>
            <p>{activeConversation.nextAction}</p>
          </div>
          <Link
            className={styles.continueButton}
            href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(activeConversation.id)}`}
          >
            Continue
          </Link>
        </section>
      ) : (
        <section className={styles.emptyState}>
          <span>Current work</span>
          <h2>Nothing is active yet.</h2>
          <p>Transfer an existing room or start a new conversation when you’re ready.</p>
        </section>
      )}

      <form className={styles.stewardEntry} onSubmit={openSteward}>
        <div>
          <span className={styles.eyebrow}>Continue with Atlas</span>
          <h2>Pick up the work without starting over.</h2>
          <p>Tell Atlas what you’re continuing. Steward will prepare the context that matters.</p>
        </div>
        <label htmlFor="home-steward-task">What are you trying to continue?</label>
        <textarea
          id="home-steward-task"
          onChange={(event) => setStewardTask(event.target.value)}
          placeholder="Describe the decision, task, or missing project context."
          value={stewardTask}
        />
        <button disabled={!stewardTask.trim()} type="submit">Prepare context</button>
      </form>

      <section className={styles.transferEntry}>
        <div>
          <span className={styles.eyebrow}>Bring in existing work</span>
          <h2>Transfer a room</h2>
          <p>Bring in an existing conversation so Atlas can preserve what still matters and prepare it for future work.</p>
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
          projectId={projectId}
        />
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {overview.project.pendingFindingCount > 0 ? (
        <Link className={styles.reviewNotice} href={`/projects/${encodeURIComponent(projectId)}/findings`}>
          <strong>Needs review · {overview.project.pendingFindingCount}</strong>
          <span>Atlas needs your judgment before this can become part of the project’s working truth.</span>
          <small>Review now →</small>
        </Link>
      ) : null}

      <details className={styles.historyDisclosure}>
        <summary>Project history · {projectWork.length}</summary>
        <div className={styles.historyHeader}>
          <p>Earlier work stays available without crowding the next step.</p>
          <Link href={`/projects/${encodeURIComponent(projectId)}/conversations`}>View all work</Link>
        </div>
        {projectWork.length ? (
          <div className={styles.cardGrid}>
            {projectWork.map((conversation) => (
              <HistoryCard conversation={conversation} key={conversation.id} projectId={projectId} />
            ))}
          </div>
        ) : <p className={styles.quietEmpty}>No earlier work in this project.</p>}
      </details>

      <details className={styles.moreActions}>
        <summary>More ways to work</summary>
        <button onClick={() => setMode(mode === "native" ? "none" : "native")} type="button">
          Start a new conversation in Atlas
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
