"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "../../../../components/write-session";
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

type GovernanceEvent = {
  id: string;
  action: string;
  actor_id: string;
  source_version_id: string | null;
  resulting_version_id: string | null;
  prior_authority: string;
  new_authority: string;
  prior_scope: string;
  new_scope: string;
  prior_status: string;
  new_status: string;
  retrieval_effect: string;
  reason: string;
  created_at: string;
  rollback_of_event_id: string | null;
};

type FindingDetail = {
  finding: {
    id: string;
    finding_type: string;
    case_id: string;
    current_version_id: string;
    status: string;
    authority_state: string;
    return_condition: string | null;
    expires_at: string | null;
  };
  versions: Version[];
  governance: GovernanceEvent[];
  sourceEvents: Array<{
    id: string;
    type: string;
    exactSourceSpan: string;
    compressedRepresentation: string | null;
    sourceLinks: Array<{ messageId: string; href: string; span?: unknown }>;
  }>;
};

type GovernanceResult = {
  priorAuthority: string;
  newAuthority: string;
  priorScope: string;
  newScope: string;
  retrievalEffect: string;
  governingVersionId: string;
  governanceEvent: GovernanceEvent;
  timestamp: string;
};

const actionCopy = [
  { id: "approve", label: "Keep this for future rooms" },
  { id: "revise", label: "Save my revised wording for review" },
  { id: "reject", label: "Do not carry this forward" },
  { id: "defer", label: "Decide later" },
  { id: "keep_local", label: "Keep this only with the current work" },
  { id: "challenge", label: "Mark the evidence as insufficient" },
];

function lines(values: string[]) {
  return values.length ? values.map((value) => <li key={value}>{value}</li>) : <li>None recorded</li>;
}

export default function FindingReview({ projectId, findingId }: { projectId: string; findingId: string }) {
  const { session, authorizationHeaders } = useWriteSession();
  const [detail, setDetail] = useState<FindingDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [reviewedStatement, setReviewedStatement] = useState("");
  const [scope, setScope] = useState("local");
  const [reason, setReason] = useState("");
  const [returnCondition, setReturnCondition] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [result, setResult] = useState<GovernanceResult | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}`,
      { cache: "no-store" },
    );
    const value = await response.json().catch(() => ({ error: "Canonical finding unavailable." })) as FindingDetail & { error?: string };
    if (!response.ok) throw new Error(value.error || "Canonical finding unavailable.");
    return value;
  }, [findingId, projectId]);

  const applyDetail = useCallback((value: FindingDetail) => {
    setDetail(value);
    const current = value.versions.find((version) => version.id === value.finding.current_version_id);
    setReviewedStatement(current?.proposal_statement || "");
    setScope(current?.proposed_scope || "local");
  }, []);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (!active) return;
      applyDetail(value);
      setStatus("ready");
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Canonical finding unavailable.");
      setStatus("error");
    });
    return () => { active = false; };
  }, [applyDetail, load]);

  async function govern(action: string) {
    if (!detail) return;
    setStatus("saving");
    setError("");
    setResult(null);
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(findingId)}/governance`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `finding:${findingId}:${action}:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          action,
          actorId: session?.actor.id || "cody",
          sourceVersionId: detail.finding.current_version_id,
          reviewedStatement,
          scope,
          reason,
          returnCondition: action === "defer" ? returnCondition : undefined,
          expiresAt: action === "defer" && reviewDate ? new Date(`${reviewDate}T12:00:00Z`).toISOString() : undefined,
        }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Governance failed." })) as GovernanceResult & { error?: string };
    if (!response.ok) {
      setError(response.status === 409
        ? `${value.error || "Current version changed."} Refresh and review the latest canonical version. Nothing was saved.`
        : response.status === 401
          ? "Write authorization is required. Canonical state was not changed."
          : value.error || "Governance write failed. Canonical state was not changed.");
      setStatus("ready");
      return;
    }
    setResult(value);
    applyDetail(await load());
    setReason("");
    setReturnCondition("");
    setReviewDate("");
    setStatus("ready");
  }

  async function rollback(eventId: string) {
    setStatus("saving");
    setError("");
    setResult(null);
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/governance-events/${encodeURIComponent(eventId)}/rollback`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `rollback:${eventId}:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          actorId: session?.actor.id || "cody",
          reason: reason || "Rollback requested after reviewing the append-only governance history.",
        }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Rollback failed." })) as GovernanceResult & { error?: string };
    if (!response.ok) {
      setError(value.error || "Rollback failed. The original governance event and current canonical state remain unchanged.");
      setStatus("ready");
      return;
    }
    setResult(value);
    applyDetail(await load());
    setReason("");
    setStatus("ready");
  }

  const current = useMemo(() => detail?.versions.find((version) => version.id === detail.finding.current_version_id) || null, [detail]);
  if (status === "loading") return <section className={styles.panel}>Loading this review and its supporting conversation…</section>;
  if (status === "error" || !detail || !current) {
    return (
      <section className={`${styles.panel} ${styles.failure}`} role="alert">
        <strong>Review item unavailable</strong>
        <p>{error}</p>
      </section>
    );
  }

  const original = detail.versions[0];
  const terminal = ["approved", "rejected"].includes(detail.finding.status);
  const latestGovernance = detail.governance.at(-1);
  const canWrite = Boolean(session?.writeAuthorization.authorized);
  return (
    <div className={styles.grid}>
      <section className={styles.transcript}>
        <article className={styles.panel}>
          <span className={styles.eyebrow}>Atlas needs your decision</span>
          <h2>{original.proposal_statement}</h2>
          <p className={styles.muted}>{original.reason_for_surfacing}</p>
          {current.uncertainty ? <p><strong>What remains uncertain:</strong> {current.uncertainty}</p> : null}
        </article>

        <article className={styles.panel}>
          <span className={styles.eyebrow}>Evidence and limits</span>
          <div className={styles.twoColumns}>
            <div><h3>Conditions</h3><ul>{lines(current.conditions)}</ul></div>
            <div><h3>Exclusions</h3><ul>{lines(current.exclusions)}</ul></div>
            <div><h3>Strongest support</h3><ul>{lines(current.supporting_evidence)}</ul></div>
            <div><h3>Strongest challenge</h3><ul>{lines(current.counterevidence)}</ul></div>
          </div>
        </article>

        <article className={styles.panel}>
          <span className={styles.eyebrow}>Supporting conversation</span>
          {!detail.sourceEvents.length && <p className={styles.muted}>No exact conversation evidence is linked. Do not keep this without inspecting that gap.</p>}
          {detail.sourceEvents.map((event) => (
            <div className={styles.event} key={event.id}>
              <p>{event.exactSourceSpan}</p>
              {event.sourceLinks.map((link) => <a href={link.href} key={link.messageId}>Open the exact message</a>)}
            </div>
          ))}
        </article>

        <details className={styles.panel}>
          <summary>Advanced / Internal record</summary>
          <div className={styles.detailGrid}>
            <div><span>Finding type</span><strong>{detail.finding.finding_type}</strong></div>
            <div><span>Proposed scope</span><strong>{original.proposed_scope}</strong></div>
            <div><span>Current authority</span><strong>{detail.finding.authority_state}</strong></div>
            <div><span>Status</span><strong>{detail.finding.status}</strong></div>
            <div><span>Expected retrieval effect</span><strong>{current.expected_retrieval_effect}</strong></div>
          </div>
          {detail.versions.map((version, index) => (
            <div className={styles.event} key={version.id}>
              <strong>Version {index + 1} · {version.created_by}</strong>
              <p>{version.proposal_statement}</p>
              <p>{version.proposed_scope} · {version.created_at}</p>
            </div>
          ))}
        </details>
      </section>

      <aside className={styles.sidebar}>
        {result && (
          <section className={styles.checkpoint} role="status">
            <span className={styles.eyebrow}>Decision saved</span>
            <h2>Your review is recorded</h2>
            <details>
              <summary>Advanced result</summary>
              <p>Event: {result.governanceEvent.id}</p>
              <p>Authority: {result.priorAuthority} → {result.newAuthority}</p>
              <p>Scope: {result.priorScope} → {result.newScope}</p>
              <strong>{result.retrievalEffect}</strong>
            </details>
          </section>
        )}

        <section className={styles.panel}>
          <span className={styles.eyebrow}>What should carry forward</span>
          <textarea
            aria-label="Reviewed wording"
            className={styles.textarea}
            disabled={terminal || status === "saving"}
            onChange={(event) => setReviewedStatement(event.target.value)}
            value={reviewedStatement}
          />
          <div className={styles.diff}>
            <strong>Your wording</strong>
            <p>Atlas: {original.proposal_statement}</p>
            <p>You: {reviewedStatement}</p>
            <small>{reviewedStatement === original.proposal_statement ? "No wording change." : "Your reviewed wording differs and will be saved with this decision."}</small>
          </div>
          <label className={styles.fieldLabel}>
            Where this applies
            <select className={styles.select} disabled={terminal} onChange={(event) => setScope(event.target.value)} value={scope}>
              <option value="local">This work only</option>
              <option value="project_wide">The whole project</option>
            </select>
          </label>
          <input className={styles.input} onChange={(event) => setReason(event.target.value)} placeholder="Why did you choose this?" value={reason} />
          <input className={styles.input} onChange={(event) => setReturnCondition(event.target.value)} placeholder="When should Atlas ask again?" value={returnCondition} />
          <label className={styles.fieldLabel}>
            Optional manual review date
            <input className={styles.input} onChange={(event) => setReviewDate(event.target.value)} type="date" value={reviewDate} />
          </label>
          {!canWrite && <p className={styles.error}>Sign in from the application shell to save this decision.</p>}
          <div className={styles.governanceActions}>
            {actionCopy.map((action) => (
              <button
                className={styles.button}
                disabled={terminal || status === "saving" || !canWrite || !reason || (action.id === "defer" && !returnCondition && !reviewDate)}
                key={action.id}
                onClick={() => govern(action.id)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
          {detail.finding.status === "rejected" && (
            <div className={styles.rejectionNotice}>
              <strong>This decision is preserved, not deleted.</strong>
              <p>The source and rejected wording remain inspectable. Atlas will not carry the same wording forward unless materially different evidence appears.</p>
            </div>
          )}
          {detail.finding.status === "deferred" && (
            <p className={styles.muted}>Atlas will ask again when: {detail.finding.return_condition || detail.finding.expires_at}.</p>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>

        <details className={styles.panel}>
          <summary>Advanced / Decision history</summary>
          {!detail.governance.length && <p className={styles.muted}>No governance history exists for this record.</p>}
          {detail.governance.map((event) => (
            <div className={styles.event} key={event.id}>
              <strong>{event.action} · {event.actor_id}</strong>
              <p>{event.id}</p>
              <p>Version: {event.source_version_id || "none"} → {event.resulting_version_id || "none"}</p>
              <p>Authority: {event.prior_authority} → {event.new_authority}</p>
              <p>Scope: {event.prior_scope} → {event.new_scope}</p>
              <p>Status: {event.prior_status} → {event.new_status}</p>
              <p>{event.retrieval_effect}</p>
              <p>{event.reason} · {event.created_at}</p>
              {event.rollback_of_event_id && <p>Rolls back {event.rollback_of_event_id}</p>}
            </div>
          ))}
          {latestGovernance && latestGovernance.action !== "rollback" && (
            <button
              className={styles.button}
              disabled={!canWrite || status === "saving" || !reason}
              onClick={() => rollback(latestGovernance.id)}
              type="button"
            >
              Roll back this governance event while preserving history.
            </button>
          )}
        </details>
      </aside>
    </div>
  );
}
