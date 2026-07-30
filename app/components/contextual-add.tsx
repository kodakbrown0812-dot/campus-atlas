"use client";

import { FormEvent, useEffect, useState } from "react";
import { useWriteSession } from "./write-session";
import styles from "./contextual-add.module.css";

type Choice = { id: string; objective?: string; title?: string };
type Receipt = {
  canonicalRecordId: string;
  destination: string;
  projectId: string;
  caseId: string | null;
  conversationId: string | null;
  recordType: string;
  representation: string;
  authority: string;
  source: string;
  suggestedRelationships: unknown[];
  nextAction: string;
  retrievalChanged: boolean;
  retrievalReason: string;
};

const types = [
  ["case", "Case"],
  ["research_evidence", "Research or evidence"],
  ["outcome", "Outcome"],
  ["correction", "Correction"],
  ["challenge", "Challenge"],
  ["observation", "Observation"],
  ["proposed_connection", "Proposed connection"],
] as const;

export default function ContextualAdd({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { session, authorizationHeaders } = useWriteSession();
  const [cases, setCases] = useState<Choice[]>([]);
  const [conversations, setConversations] = useState<Choice[]>([]);
  const [type, setType] = useState("observation");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/cases`, { cache: "no-store" }),
      fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/conversations`, { cache: "no-store" }),
    ]).then(async ([caseResponse, conversationResponse]) => {
      if (!caseResponse.ok || !conversationResponse.ok) throw new Error("Canonical destinations are unavailable.");
      const caseValue = await caseResponse.json() as { cases: Choice[] };
      const conversationValue = await conversationResponse.json() as { conversations: Choice[] };
      setCases(caseValue.cases);
      setConversations(conversationValue.conversations);
      setStatus("idle");
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Canonical destinations are unavailable.");
      setStatus("error");
    });
  }, [open, projectId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("saving");
    setError("");
    setReceipt(null);
    const body = {
      type,
      objective: String(data.get("objective") || ""),
      content: String(data.get("content") || ""),
      caseId: String(data.get("caseId") || "") || undefined,
      conversationId: String(data.get("conversationId") || "") || undefined,
      representation: String(data.get("representation") || "Reconstructed"),
      sourceReference: String(data.get("sourceReference") || "") || undefined,
      reason: String(data.get("reason") || "Captured through Contextual Add."),
      targetType: String(data.get("targetType") || "") || undefined,
      targetId: String(data.get("targetId") || "") || undefined,
      actorId: session?.actor.id || "cody",
    };
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/contextual-add`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `contextual-add:${crypto.randomUUID()}`,
        ...authorizationHeaders(),
      },
      body: JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({ error: "Contextual Add failed." })) as {
      error?: string;
      receipt?: Receipt;
    };
    if (!response.ok || !value.receipt) {
      setError(response.status === 401
        ? "Write authorization is required. Nothing was saved."
        : value.error || "Contextual Add failed. Nothing was presented as saved.");
      setStatus("error");
      return;
    }
    setReceipt(value.receipt);
    setStatus("saved");
    form.reset();
  }

  if (!open) return null;
  const authorized = Boolean(session?.writeAuthorization.authorized);
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section aria-label="Contextual Add" className={styles.sheet} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>Contextual Add</span>
            <h2>Add to {projectId}</h2>
          </div>
          <button aria-label="Close Contextual Add" onClick={onClose} type="button">×</button>
        </header>

        {receipt ? (
          <article className={styles.receipt}>
            <span>Connection receipt</span>
            <h3>{receipt.recordType} saved canonically</h3>
            <dl>
              <div><dt>Record</dt><dd>{receipt.canonicalRecordId}</dd></div>
              <div><dt>Destination</dt><dd>{receipt.destination}</dd></div>
              <div><dt>Project</dt><dd>{receipt.projectId}</dd></div>
              <div><dt>Case</dt><dd>{receipt.caseId || "Unassigned"}</dd></div>
              <div><dt>Conversation</dt><dd>{receipt.conversationId || "None"}</dd></div>
              <div><dt>Representation</dt><dd>{receipt.representation}</dd></div>
              <div><dt>Authority</dt><dd>{receipt.authority}</dd></div>
              <div><dt>Source</dt><dd>{receipt.source}</dd></div>
              <div><dt>Retrieval changed</dt><dd>{receipt.retrievalChanged ? "Yes" : "No"}</dd></div>
            </dl>
            <p>{receipt.retrievalReason}</p>
            <strong>Next: {receipt.nextAction}</strong>
            <button className={styles.primary} onClick={() => setReceipt(null)} type="button">Add another record</button>
          </article>
        ) : (
          <form onSubmit={save}>
            <label>
              Type
              <select onChange={(event) => setType(event.target.value)} value={type}>
                {types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className={styles.columns}>
              <label>
                Project
                <input disabled value={projectId} />
              </label>
              <label>
                Case
                <select defaultValue="" name="caseId">
                  <option value="">Unassigned</option>
                  {cases.map((record) => <option key={record.id} value={record.id}>{record.objective}</option>)}
                </select>
              </label>
              <label>
                Conversation
                <select defaultValue="" name="conversationId">
                  <option value="">Use case association</option>
                  {conversations.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
                </select>
              </label>
              <label>
                Representation
                <select defaultValue="Reconstructed" name="representation">
                  <option value="Reconstructed">Reconstructed</option>
                  <option value="Compressed">Compressed</option>
                </select>
              </label>
            </div>
            {type === "case" ? (
              <label>
                Case objective
                <textarea name="objective" placeholder="Bound the work that should remain continuous." required />
              </label>
            ) : (
              <label>
                What happened
                <textarea name="content" placeholder="Preserve the observation without promoting it." required />
              </label>
            )}
            <label>
              Optional source reference
              <input name="sourceReference" placeholder="URL, document, or source identity" />
            </label>
            <label>
              Save reason
              <input defaultValue="Captured through Contextual Add." name="reason" required />
            </label>
            {type === "proposed_connection" && (
              <div className={styles.columns}>
                <label>
                  Target type
                  <input name="targetType" placeholder="mechanism, case, node…" required />
                </label>
                <label>
                  Canonical target ID
                  <input name="targetId" required />
                </label>
              </div>
            )}
            {!authorized && (
              <p className={styles.error}>Read-only session. Enable canonical writes once from the shell. Nothing can be saved yet.</p>
            )}
            {error && <p className={styles.error}>{error} Existing canonical records remain unchanged.</p>}
            <button className={styles.primary} disabled={!authorized || status === "saving" || status === "loading"} type="submit">
              {status === "saving" ? "Saving canonically…" : "Save and show connection receipt"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
