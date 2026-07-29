"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "../../../../../components/write-session";
import styles from "../../conversation.module.css";

type EventRecord = {
  id: string;
  type: string;
  caseId: string | null;
  assignmentState: string;
  exactSourceSpan: string;
  authority: string;
  sourceLinks: Array<{ messageId: string; href: string }>;
};
type CaseDetail = {
  case: { id: string; objective: string; caseCore: Record<string, unknown>; outcomeState: string | null; outcomeSummary: string | null; postmortemState: string | null };
  events: EventRecord[];
  reasoning: Array<{ id: string; type: string; statement: string; authority: string; currentVersionId: string }>;
  findings: Array<Record<string, unknown> & { id: string }>;
  governance: Array<Record<string, unknown> & { id: string }>;
  packets: Array<Record<string, unknown> & { id: string }>;
  boundaryHistory: {
    proposals: Array<Record<string, unknown> & { id: string }>;
    operations: Array<Record<string, unknown> & { id: string; reversible: boolean }>;
  };
};
type Structure = {
  projectId: string;
  conversation: { id: string; title: string; activeCaseId: string | null; sourceType: string };
  cases: CaseDetail[];
  unassignedEvents: EventRecord[];
};

export default function StructureWorkspace({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const { session, authorizationHeaders } = useWriteSession();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/structure`,
      { cache: "no-store" },
    );
    const value = await response.json().catch(() => ({ error: "Structure unavailable." })) as Structure & { error?: string };
    if (!response.ok) throw new Error(value.error || "Structure unavailable.");
    return value;
  }, [conversationId, projectId]);

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (!active) return;
      setStructure(value);
      setStatus("ready");
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Structure unavailable.");
      setStatus("error");
    });
    return () => { active = false; };
  }, [load]);

  const events = useMemo(() => [
    ...(structure?.cases.flatMap((record) => record.events) || []),
    ...(structure?.unassignedEvents || []),
  ], [structure]);

  async function mutate(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeaders() },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({ error: "Structure mutation failed." })) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(value.error || "Structure mutation failed.");
    return value;
  }

  async function boundary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!structure) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const operationType = String(data.get("operationType") || "");
    const eventId = String(data.get("eventId") || "");
    const sourceCaseId = String(data.get("sourceCaseId") || "");
    const targetCaseId = String(data.get("targetCaseId") || "");
    const reason = String(data.get("reason") || "");
    setStatus("saving");
    setError("");
    setResult(null);
    try {
      const proposalResponse = await mutate(
        `/api/v1/projects/${encodeURIComponent(projectId)}/case-boundaries/proposals`,
        {
          conversationId,
          operationType,
          eventIds: eventId ? [eventId] : [],
          sourceCaseIds: sourceCaseId ? [sourceCaseId] : [],
          targetCaseId: ["attach", "move", "split", "merge"].includes(operationType) ? targetCaseId : undefined,
          actorId: session?.actor.id || "cody",
          reason,
        },
      );
      const proposal = proposalResponse.proposal as { id: string };
      if (["split", "merge"].includes(operationType)) {
        setResult({
          ...proposalResponse,
          notice: "Boundary change was proposed only. No case was silently split or merged.",
        });
      } else {
        const applied = await mutate(
          `/api/v1/projects/${encodeURIComponent(projectId)}/case-boundaries/proposals/${encodeURIComponent(proposal.id)}/apply`,
          { actorId: session?.actor.id || "cody", reason },
        );
        setResult({
          proposal: proposalResponse.proposal,
          ...applied,
          notice: "The explicit proposal was applied and remains reversible.",
        });
      }
      setStructure(await load());
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Structure mutation failed.");
      setStatus("ready");
    }
  }

  async function reverse(operationId: string) {
    setStatus("saving");
    setError("");
    setResult(null);
    try {
      const response = await mutate(
        `/api/v1/projects/${encodeURIComponent(projectId)}/case-boundaries/operations/${encodeURIComponent(operationId)}/reverse`,
        {
          actorId: session?.actor.id || "cody",
          reason: "Explicitly reversed after reviewing the boundary-operation history.",
        },
      );
      setResult({ ...response, notice: "A new reversal operation restored prior state; history was not deleted." });
      setStructure(await load());
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Boundary operation is not reversible.");
      setStatus("ready");
    }
  }

  if (status === "loading") return <main className={styles.page}><section className={styles.panel}>Loading stable case structure and lineage…</section></main>;
  if (status === "error" || !structure) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.failure}`} role="alert">
          <strong>Canonical structure unavailable</strong><p>{error}</p>
          <b>The transcript remains valid. No local or seeded structure was substituted.</b>
        </section>
      </main>
    );
  }

  const canWrite = Boolean(session?.writeAuthorization.authorized);
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href={`/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`}>← Conversation</Link>
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>Progressive structure · {structure.conversation.sourceType}</span><h1>{structure.conversation.title}</h1></div>
          <span className={styles.status}>{structure.cases.length} associated cases</span>
        </header>

        {result && <section className={styles.checkpoint} role="status"><strong>Canonical structure confirmed</strong><pre>{JSON.stringify(result, null, 2)}</pre></section>}
        {error && <section className={`${styles.panel} ${styles.failure}`} role="alert"><strong>Structure mutation failed</strong><p>{error}</p><b>Existing assignments and history remain valid.</b></section>}

        <div className={styles.grid}>
          <section className={styles.transcript}>
            {structure.cases.map((record) => (
              <article className={styles.panel} key={record.case.id}>
                <span className={styles.eyebrow}>{record.case.id === structure.conversation.activeCaseId ? "Active case" : "Associated case"}</span>
                <h2>{record.case.objective}</h2>
                <details open><summary>Stable case core</summary><pre className={styles.raw}>{JSON.stringify(record.case.caseCore, null, 2)}</pre></details>
                <details open><summary>Meaningful events</summary>{record.events.map((item) => <Event event={item} key={item.id} />)}</details>
                <details><summary>Reasoning nodes, evidence, and challenges</summary>
                  {record.reasoning.map((node) => (
                    <div className={styles.event} key={node.id}>
                      <strong>{node.type} · {node.authority}</strong><p>{node.statement}</p>
                      <Link href={`/projects/${encodeURIComponent(projectId)}/inspect/reasoning/${encodeURIComponent(node.id)}`}>Correct wording or inspect versions</Link>
                    </div>
                  ))}
                </details>
                <details><summary>Mechanism candidates and findings</summary><pre className={styles.raw}>{JSON.stringify(record.findings, null, 2)}</pre></details>
                <details><summary>Outcome and postmortem</summary><pre className={styles.raw}>{JSON.stringify({ outcomeState: record.case.outcomeState, outcomeSummary: record.case.outcomeSummary, postmortemState: record.case.postmortemState }, null, 2)}</pre></details>
                <details><summary>Governance history</summary><pre className={styles.raw}>{JSON.stringify(record.governance, null, 2)}</pre></details>
                <details><summary>Packet influence history</summary><pre className={styles.raw}>{JSON.stringify(record.packets, null, 2)}</pre></details>
                <details><summary>Boundary history</summary>
                  {record.boundaryHistory.operations.map((operation) => (
                    <div className={styles.event} key={operation.id}>
                      <pre className={styles.raw}>{JSON.stringify(operation, null, 2)}</pre>
                      {operation.reversible && (
                        <button className={styles.button} disabled={!canWrite || status === "saving"} onClick={() => reverse(operation.id)} type="button">
                          Reverse this eligible boundary operation and preserve history.
                        </button>
                      )}
                    </div>
                  ))}
                </details>
                <Link className={styles.textLink} href={`/projects/${encodeURIComponent(projectId)}/inspect/cases/${encodeURIComponent(record.case.id)}`}>Open full Inspect record</Link>
              </article>
            ))}
            {!structure.cases.length && <section className={styles.panel}>No canonical case is associated with this conversation.</section>}
          </section>

          <aside className={styles.sidebar}>
            <section className={styles.panel}>
              <span className={styles.eyebrow}>Bounded structural action</span>
              <h2>Propose or apply explicitly</h2>
              <form onSubmit={boundary}>
                <select className={styles.select} name="operationType" required>
                  <option value="">Select action</option>
                  <option value="attach">Attach event</option>
                  <option value="move">Move event</option>
                  <option value="unassign">Leave event unassigned</option>
                  <option value="chat_only">Mark event chat-only</option>
                  <option value="split">Propose split</option>
                  <option value="merge">Propose merge</option>
                </select>
                <select className={styles.select} name="eventId" required>
                  <option value="">Select event</option>
                  {events.map((item) => <option key={item.id} value={item.id}>{item.type} · {item.exactSourceSpan.slice(0, 70)}</option>)}
                </select>
                <select className={styles.select} name="sourceCaseId">
                  <option value="">No source case</option>
                  {structure.cases.map((record) => <option key={record.case.id} value={record.case.id}>{record.case.objective}</option>)}
                </select>
                <select className={styles.select} name="targetCaseId">
                  <option value="">No target case</option>
                  {structure.cases.map((record) => <option key={record.case.id} value={record.case.id}>{record.case.objective}</option>)}
                </select>
                <input className={styles.input} name="reason" placeholder="Why this boundary action is appropriate" required />
                {!canWrite && <p className={styles.error}>Read-only session. Enable writes from the shell.</p>}
                <button className={styles.button} disabled={!canWrite || status === "saving"} type="submit">
                  Create the explicit proposal and apply only eligible event actions.
                </button>
                <p className={styles.muted}>Split and merge stop at a proposal. Attach, move, unassign, and chat-only are applied only after this explicit submission and remain reversible.</p>
              </form>
            </section>
            <section className={styles.panel}>
              <span className={styles.eyebrow}>Unassigned and chat-only</span>
              {!structure.unassignedEvents.length && <p className={styles.muted}>No unassigned or chat-only events.</p>}
              {structure.unassignedEvents.map((item) => <Event event={item} key={item.id} />)}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Event({ event }: { event: EventRecord }) {
  return (
    <div className={styles.event}>
      <strong>{event.type} · {event.assignmentState} · {event.authority}</strong>
      <p>{event.exactSourceSpan}</p>
      {event.sourceLinks.map((link) => <a href={link.href} key={link.messageId}>Open exact source message and span</a>)}
    </div>
  );
}
