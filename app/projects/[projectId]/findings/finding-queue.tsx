"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../conversations/conversation.module.css";

type Finding = {
  id: string;
  caseId: string;
  sourceCase: string | null;
  type: string;
  proposal: string;
  status: string;
  authority: string;
  proposedScope: string;
  uncertainty: string | null;
  reasonForSurfacing: string;
  expectedRetrievalEffect: string;
  returnCondition: string | null;
  expiresAt: string | null;
  createdAt: string;
  supportingEvidence: string[];
  counterevidence: string[];
};

function queueSection(finding: Finding) {
  if (finding.status === "deferred") {
    return /outcome/i.test(finding.returnCondition || "") ? "Awaiting outcome" : "Deferred";
  }
  if (finding.status === "challenged") return "Conflict-related";
  if (["approved", "rejected"].includes(finding.status)) return "Recently resolved";
  return "Needs review";
}

const sectionOrder = ["Needs review", "Deferred", "Awaiting outcome", "Conflict-related", "Recently resolved"];

export default function FindingQueue({ projectId }: { projectId: string }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filters, setFilters] = useState({ type: "", caseId: "", status: "", scope: "", since: "" });

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/findings`, { cache: "no-store" })
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

  const visible = useMemo(() => findings.filter((finding) => {
    if (filters.type && finding.type !== filters.type) return false;
    if (filters.caseId && finding.caseId !== filters.caseId) return false;
    if (filters.status && finding.status !== filters.status) return false;
    if (filters.scope && finding.proposedScope !== filters.scope) return false;
    if (filters.since && finding.createdAt < filters.since) return false;
    return true;
  }), [filters, findings]);
  const types = [...new Set(findings.map((finding) => finding.type))];
  const cases = [...new Map(findings.map((finding) => [finding.caseId, finding.sourceCase || finding.caseId])).entries()];

  if (status === "loading") return <section className={styles.panel}>Loading canonical findings…</section>;
  if (status === "error") {
    return (
      <section className={`${styles.panel} ${styles.failure}`} role="alert">
        <strong>Canonical findings are unavailable.</strong>
        <p>Existing canonical records remain valid. Retry when D1 is available.</p>
        <b>No fixture or seeded finding was substituted.</b>
      </section>
    );
  }
  return (
    <div className={styles.transcript}>
      <section className={styles.panel}>
        <span className={styles.eyebrow}>Project-scoped filters</span>
        <div className={styles.filterGrid}>
          <select aria-label="Finding type filter" onChange={(event) => setFilters((value) => ({ ...value, type: event.target.value }))} value={filters.type}>
            <option value="">All finding types</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select aria-label="Case filter" onChange={(event) => setFilters((value) => ({ ...value, caseId: event.target.value }))} value={filters.caseId}>
            <option value="">All cases</option>
            {cases.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Status filter" onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))} value={filters.status}>
            <option value="">All statuses</option>
            {["proposed", "under_review", "deferred", "challenged", "approved", "rejected"].map((value) => <option key={value}>{value}</option>)}
          </select>
          <select aria-label="Scope filter" onChange={(event) => setFilters((value) => ({ ...value, scope: event.target.value }))} value={filters.scope}>
            <option value="">All scopes</option>
            <option value="local">Local</option>
            <option value="project_wide">Project-wide</option>
          </select>
          <input aria-label="Created since" onChange={(event) => setFilters((value) => ({ ...value, since: event.target.value }))} type="date" value={filters.since} />
        </div>
      </section>

      {!visible.length && (
        <section className={styles.panel}>
          <strong>{findings.length ? "No findings match these filters." : "Nothing consequential is awaiting governance."}</strong>
          <p className={styles.muted}>
            {findings.length
              ? "Change the project-scoped filters to inspect another canonical queue."
              : "A successful checkpoint may legitimately produce zero findings."}
          </p>
        </section>
      )}

      {sectionOrder.map((section) => {
        const items = visible.filter((finding) => queueSection(finding) === section);
        if (!items.length) return null;
        return (
          <section className={styles.panel} key={section}>
            <span className={styles.eyebrow}>{section}</span>
            <div className={styles.list}>
              {items.map((finding) => (
                <Link
                  className={styles.findingCard}
                  href={`/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(finding.id)}`}
                  key={finding.id}
                >
                  <header>
                    <span>{finding.type}</span>
                    <b>{finding.status}</b>
                  </header>
                  <strong>{finding.proposal}</strong>
                  <dl>
                    <div><dt>Source case</dt><dd>{finding.sourceCase || finding.caseId}</dd></div>
                    <div><dt>Why it matters</dt><dd>{finding.reasonForSurfacing}</dd></div>
                    <div><dt>Why uncertain</dt><dd>{finding.uncertainty || "No uncertainty recorded"}</dd></div>
                    <div><dt>Scope / authority</dt><dd>{finding.proposedScope} · {finding.authority}</dd></div>
                    {finding.returnCondition && <div><dt>Return condition</dt><dd>{finding.returnCondition}</dd></div>}
                  </dl>
                  <small>
                    Next: {finding.status === "deferred"
                      ? "Wait for the return condition, then review again."
                      : finding.status === "challenged"
                        ? "Resolve the challenge without hiding it."
                        : ["approved", "rejected"].includes(finding.status)
                          ? "Inspect the governance result and rollback history."
                          : "Review one consequence and govern Cody's final wording."}
                  </small>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
