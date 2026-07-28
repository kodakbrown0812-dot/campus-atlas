"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../conversations/conversation.module.css";

type Version = {
  id: string;
  proposal_statement: string;
  proposed_scope: string;
  conditions: string[];
  exclusions: string[];
  supporting_evidence: string[];
  counterevidence: string[];
  uncertainty: string | null;
  reason_for_surfacing: string;
  expected_retrieval_effect: string;
  created_by: string;
  created_at: string;
};

type FindingDetail = {
  finding: {
    id: string;
    finding_type: string;
    current_version_id: string;
    status: string;
    authority_state: string;
    return_condition: string | null;
    expires_at: string | null;
  };
  versions: Version[];
  governance: Array<{
    id: string;
    action: string;
    actor_id: string;
    prior_authority: string;
    new_authority: string;
    retrieval_effect: string;
    reason: string;
    created_at: string;
  }>;
  sourceEvents: Array<{
    id: string;
    type: string;
    exactSourceSpan: string;
    compressedRepresentation: string | null;
    sourceLinks: Array<{ messageId: string; href: string }>;
  }>;
};

const actions = [
  { id: "approve", label: "Approve reviewed wording" },
  { id: "revise", label: "Save revision for review" },
  { id: "reject", label: "Reject" },
  { id: "defer", label: "Defer" },
  { id: "keep_local", label: "Keep local" },
  { id: "challenge", label: "Challenge" },
];

export default function FindingReview({
  projectId,
  findingId,
}: {
  projectId: string;
  findingId: string;
}) {
  const [detail, setDetail] = useState<FindingDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [reviewedStatement, setReviewedStatement] = useState("");
  const [scope, setScope] = useState("local");
  const [reason, setReason] = useState("");
  const [returnCondition, setReturnCondition] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}`,
    );
    if (!response.ok) throw new Error("Canonical finding unavailable.");
    return response.json() as Promise<FindingDetail>;
  }, [findingId, projectId]);

  useEffect(() => {
    let active = true;
    load()
      .then((result) => {
        if (!active) return;
        setDetail(result);
        const current = result.versions.find((version) => version.id === result.finding.current_version_id);
        setReviewedStatement(current?.proposal_statement || "");
        setScope(current?.proposed_scope || "local");
        setStatus("ready");
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Canonical finding unavailable.");
          setStatus("error");
        }
      });
    return () => { active = false; };
  }, [load]);

  async function govern(action: string) {
    if (!detail) return;
    setStatus("saving");
    setError("");
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}/governance`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${actionKey}`,
          "idempotency-key": `finding:${findingId}:${action}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          action,
          actorId: "cody",
          sourceVersionId: detail.finding.current_version_id,
          reviewedStatement,
          scope,
          reason,
          returnCondition: action === "defer" ? returnCondition : undefined,
        }),
      },
    );
    const result = await response.json().catch(() => ({ error: "Governance failed." })) as { error?: string };
    if (!response.ok) {
      setError(result.error || "Governance failed.");
      setStatus("ready");
      return;
    }
    const refreshed = await load();
    setDetail(refreshed);
    const current = refreshed.versions.find((version) => version.id === refreshed.finding.current_version_id);
    setReviewedStatement(current?.proposal_statement || "");
    setScope(current?.proposed_scope || "local");
    setReason("");
    setReturnCondition("");
    setStatus("ready");
  }

  if (status === "loading") return <section className={styles.panel}>Loading finding and lineage…</section>;
  if (status === "error" || !detail) {
    return <section className={`${styles.panel} ${styles.error}`}>{error}</section>;
  }

  const original = detail.versions[0];
  const terminal = ["approved", "rejected"].includes(detail.finding.status);
  return (
    <div className={styles.grid}>
      <section className={styles.transcript}>
        <article className={styles.panel}>
          <span className={styles.eyebrow}>Atlas observed</span>
          <h2>{original.proposal_statement}</h2>
          <p className={styles.muted}>{original.reason_for_surfacing}</p>
          <div className={styles.source}>
            <span>Type: {detail.finding.finding_type}</span>
            <span>Scope: {original.proposed_scope}</span>
            <span>Uncertainty: {original.uncertainty || "Not recorded"}</span>
            <span>Expected effect: {original.expected_retrieval_effect}</span>
          </div>
        </article>

        <article className={styles.panel}>
          <span className={styles.eyebrow}>Exact source lineage</span>
          <h2>Sources</h2>
          {detail.sourceEvents.map((event) => (
            <div className={styles.event} key={event.id}>
              <strong>{event.type}</strong>
              <p>{event.exactSourceSpan}</p>
              {event.sourceLinks.map((link) => (
                <a href={link.href} key={link.messageId}>Open exact message</a>
              ))}
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <span className={styles.eyebrow}>Immutable versions</span>
          <h2>Proposal history</h2>
          {detail.versions.map((version, index) => (
            <div className={styles.event} key={version.id}>
              <strong>Version {index + 1} · {version.created_by}</strong>
              <p>{version.proposal_statement}</p>
              <p>{version.proposed_scope} · {version.created_at}</p>
            </div>
          ))}
        </article>
      </section>

      <aside className={styles.sidebar}>
        <section className={styles.panel}>
          <span className={styles.eyebrow}>Current state</span>
          <h2>{detail.finding.status}</h2>
          <p className={styles.muted}>Authority: {detail.finding.authority_state}</p>
          <p className={styles.muted}>
            {detail.finding.return_condition || "No return condition."}
          </p>
        </section>

        <section className={styles.panel}>
          <span className={styles.eyebrow}>Cody’s reviewed draft</span>
          <h2>Govern one consequence</h2>
          <textarea
            aria-label="Reviewed finding wording"
            className={styles.textarea}
            disabled={terminal}
            onChange={(event) => setReviewedStatement(event.target.value)}
            value={reviewedStatement}
          />
          {reviewedStatement !== original.proposal_statement && (
            <div className={styles.checkpoint}>
              <strong>Wording changed</strong>
              <p>Atlas: {original.proposal_statement}</p>
              <p>Cody: {reviewedStatement}</p>
            </div>
          )}
          <select className={styles.select} disabled={terminal} onChange={(event) => setScope(event.target.value)} value={scope}>
            <option value="local">Local case</option>
            <option value="project_wide">Project-wide</option>
          </select>
          <input
            className={styles.input}
            disabled={terminal}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for this governance action"
            value={reason}
          />
          <input
            className={styles.input}
            disabled={terminal}
            onChange={(event) => setReturnCondition(event.target.value)}
            placeholder="Return condition (required for Defer)"
            value={returnCondition}
          />
          <input
            aria-label="Canonical write key"
            className={styles.input}
            disabled={terminal}
            onChange={(event) => setActionKey(event.target.value)}
            placeholder="Write key (kept only in memory)"
            type="password"
            value={actionKey}
          />
          <div className={styles.actions}>
            {actions.map((action) => (
              <button
                className={styles.button}
                disabled={terminal || status === "saving" || !actionKey || !reason || (action.id === "defer" && !returnCondition)}
                key={action.id}
                onClick={() => govern(action.id)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.panel}>
          <span className={styles.eyebrow}>Governance history</span>
          {!detail.governance.length && <p className={styles.muted}>No authority change has occurred.</p>}
          {detail.governance.map((event) => (
            <div className={styles.event} key={event.id}>
              <strong>{event.action} · {event.actor_id}</strong>
              <p>{event.prior_authority} → {event.new_authority}</p>
              <p>{event.retrieval_effect}</p>
              <p>{event.reason}</p>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
