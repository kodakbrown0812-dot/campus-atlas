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
  { id: "approve", label: "Approve this revised mechanism for the selected retrieval scope." },
  { id: "revise", label: "Record Cody’s revision without changing retrieval authority." },
  { id: "reject", label: "Reject this proposal and suppress unchanged resurfacing." },
  { id: "defer", label: "Defer this finding until its return condition is met." },
  { id: "keep_local", label: "Keep this consequence local to the current case." },
  { id: "challenge", label: "Challenge this proposal because its evidence or scope is insufficient." },
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
  if (status === "loading") return <section className={styles.panel}>Loading finding, exact lineage, and governance history…</section>;
  if (status === "error" || !detail || !current) {
    return (
      <section className={`${styles.panel} ${styles.failure}`} role="alert">
        <strong>Finding unavailable</strong>
        <p>{error}</p>
        <b>No fixture or frontend-owned version was substituted.</b>
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
          <span className={styles.eyebrow}>Atlas’s original proposal</span>
          <h2>{original.proposal_statement}</h2>
          <p className={styles.muted}>{original.reason_for_surfacing}</p>
          <div className={styles.detailGrid}>
            <div><span>Finding type</span><strong>{detail.finding.finding_type}</strong></div>
            <div><span>Proposed scope</span><strong>{original.proposed_scope}</strong></div>
            <div><span>Current authority</span><strong>{detail.finding.authority_state}</strong></div>
            <div><span>Status</span><strong>{detail.finding.status}</strong></div>
            <div><span>Why uncertain</span><strong>{current.uncertainty || "Not recorded"}</strong></div>
            <div><span>Expected retrieval effect</span><strong>{current.expected_retrieval_effect}</strong></div>
          </div>
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
          <span className={styles.eyebrow}>Exact source events and messages</span>
          {!detail.sourceEvents.length && <p className={styles.muted}>No canonical source event is available. Governance should not proceed without inspecting this gap.</p>}
          {detail.sourceEvents.map((event) => (
            <div className={styles.event} key={event.id}>
              <strong>{event.type}</strong>
              <p>{event.exactSourceSpan}</p>
              {event.sourceLinks.map((link) => <a href={link.href} key={link.messageId}>Open exact message and span</a>)}
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <span className={styles.eyebrow}>Immutable proposal and review versions</span>
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
        {result && (
          <section className={styles.checkpoint} role="status">
            <span className={styles.eyebrow}>Canonical governance confirmed</span>
            <h2>{result.governanceEvent.action}</h2>
            <p>Event: {result.governanceEvent.id}</p>
            <p>Authority: {result.priorAuthority} → {result.newAuthority}</p>
            <p>Scope: {result.priorScope} → {result.newScope}</p>
            <strong>{result.retrievalEffect}</strong>
          </section>
        )}

        <section className={styles.panel}>
          <span className={styles.eyebrow}>Cody’s current reviewed wording</span>
          <textarea
            aria-label="Reviewed finding wording"
            className={styles.textarea}
            disabled={terminal || status === "saving"}
            onChange={(event) => setReviewedStatement(event.target.value)}
            value={reviewedStatement}
          />
          <div className={styles.diff}>
            <strong>Exact wording difference</strong>
            <p>Atlas: {original.proposal_statement}</p>
            <p>Cody: {reviewedStatement}</p>
            <small>{reviewedStatement === original.proposal_statement ? "No wording change." : "Cody’s reviewed wording differs and will be the governed wording."}</small>
          </div>
          <label className={styles.fieldLabel}>
            Retrieval scope
            <select className={styles.select} disabled={terminal} onChange={(event) => setScope(event.target.value)} value={scope}>
              <option value="local">Local case</option>
              <option value="project_wide">Project-wide</option>
            </select>
          </label>
          <input className={styles.input} onChange={(event) => setReason(event.target.value)} placeholder="Reason required for governance or rollback" value={reason} />
          <input className={styles.input} onChange={(event) => setReturnCondition(event.target.value)} placeholder="Deferral return condition" value={returnCondition} />
          <label className={styles.fieldLabel}>
            Optional manual review date
            <input className={styles.input} onChange={(event) => setReviewDate(event.target.value)} type="date" value={reviewDate} />
          </label>
          {!canWrite && <p className={styles.error}>Read-only session. Enable writes once from the application shell.</p>}
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
              <strong>Rejection is preserved, not deleted.</strong>
              <p>The source and rejected proposal remain inspectable. Retrieval eligibility is removed, unchanged resurfacing is suppressed, and a materially changed later proposal must explain what changed.</p>
            </div>
          )}
          {detail.finding.status === "deferred" && (
            <p className={styles.muted}>Deferral has no authoritative retrieval effect. Return when: {detail.finding.return_condition || detail.finding.expires_at}.</p>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>

        <section className={styles.panel}>
          <span className={styles.eyebrow}>Append-only governance history</span>
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
        </section>
      </aside>
    </div>
  );
}
