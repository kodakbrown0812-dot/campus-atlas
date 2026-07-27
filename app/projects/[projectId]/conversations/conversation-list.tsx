"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./conversation.module.css";

type Conversation = {
  id: string;
  title: string;
  sourceType: string;
  activeCaseId: string | null;
  originalStartedAt: string | null;
};

export default function ConversationList({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/conversations`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Conversation list unavailable.");
        return response.json() as Promise<{ conversations: Conversation[] }>;
      })
      .then((result) => {
        if (active) {
          setItems(result.conversations);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => { active = false; };
  }, [projectId]);

  if (status === "loading") return <section className={styles.panel}>Loading canonical conversations…</section>;
  if (status === "error") {
    return <section className={`${styles.panel} ${styles.error}`}>Canonical conversations are unavailable. No fixture was substituted.</section>;
  }
  if (!items.length) {
    return (
      <section className={styles.panel}>
        <strong>No canonical conversations yet.</strong>
        <p className={styles.muted}>Create a native conversation or explicitly import a transcript through the Slice 2 API.</p>
      </section>
    );
  }
  return (
    <section className={styles.list} aria-label="Canonical conversations">
      {items.map((conversation) => (
        <Link
          className={styles.card}
          href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversation.id)}`}
          key={conversation.id}
        >
          <strong>{conversation.title}</strong>
          <span className={styles.status}>{conversation.sourceType}</span>
          <small>{conversation.originalStartedAt || "Original time unavailable"}</small>
          <small>{conversation.activeCaseId ? "Active case selected" : "No active case"}</small>
        </Link>
      ))}
    </section>
  );
}
