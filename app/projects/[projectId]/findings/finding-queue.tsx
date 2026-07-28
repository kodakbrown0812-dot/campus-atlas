"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../conversations/conversation.module.css";

type Finding = {
  id: string;
  type: string;
  proposal: string;
  status: string;
  authority: string;
  proposedScope: string;
  uncertainty: string | null;
  reasonForSurfacing: string;
  expectedRetrievalEffect: string;
  createdAt: string;
};

const sections = [
  { title: "Needs review", statuses: new Set(["proposed", "under_review"]) },
  { title: "Deferred", statuses: new Set(["deferred"]) },
  { title: "Conflict-related", statuses: new Set(["challenged"]) },
  { title: "Recently resolved", statuses: new Set(["approved", "rejected"]) },
];

export default function FindingQueue({ projectId }: { projectId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/findings`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Atlas Found unavailable.");
        return response.json() as Promise<{ findings: Finding[] }>;
      })
      .then((result) => {
        if (active) {
          setFindings(result.findings);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => { active = false; };
  }, [projectId]);

  if (status === "loading") return <section className={styles.panel}>Loading canonical findings…</section>;
  if (status === "error") {
    return <section className={`${styles.panel} ${styles.error}`}>Canonical findings are unavailable. No fixture was substituted.</section>;
  }
  if (!findings.length) {
    return (
      <section className={styles.panel}>
        <strong>Atlas has no durable finding to propose.</strong>
        <p className={styles.muted}>A successful checkpoint may legitimately produce no finding.</p>
      </section>
    );
  }
  return (
    <div className={styles.transcript}>
      {sections.map((section) => {
        const items = findings.filter((finding) => section.statuses.has(finding.status));
        if (!items.length) return null;
        return (
          <section className={styles.panel} key={section.title}>
            <span className={styles.eyebrow}>{section.title}</span>
            <div className={styles.list}>
              {items.map((finding) => (
                <Link
                  className={styles.card}
                  href={`/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(finding.id)}`}
                  key={finding.id}
                >
                  <strong>{finding.proposal}</strong>
                  <span className={styles.status}>{finding.status}</span>
                  <small>{finding.type} · {finding.proposedScope} · {finding.authority}</small>
                  <small>{finding.reasonForSurfacing}</small>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
