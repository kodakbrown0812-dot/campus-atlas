"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useWriteSession } from "./write-session";
import styles from "./contextual-add.module.css";

type Choice = { id: string; objective?: string; title?: string };
type SourceMessage = {
  id: string;
  projectId: string;
  conversationId: string;
  sequence: number;
  actorType: string;
  actorId: string | null;
  exactContent: string;
  originalTimestamp: string | null;
  ingestedAt: string;
  contentHash: string;
};
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
  sourceLineage?: {
    messageId: string;
    start: number;
    end: number;
    href: string;
  } | null;
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

function messageLabel(message: SourceMessage) {
  const actor = message.actorId || message.actorType;
  const timestamp = message.originalTimestamp || message.ingestedAt;
  return `Message ${message.sequence} · ${actor} · ${new Date(timestamp).toLocaleString()}`;
}

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
  const [conversationId, setConversationId] = useState("");
  const [representation, setRepresentation] = useState("Reconstructed");
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState<SourceMessage[]>([]);
  const [messageStatus, setMessageStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sourceMessageId, setSourceMessageId] = useState("");
  const [spanMode, setSpanMode] = useState<"full" | "explicit">("full");
  const [sourceStart, setSourceStart] = useState("0");
  const [sourceEnd, setSourceEnd] = useState("0");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [messageError, setMessageError] = useState("");
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
      setReceipt(null);
      setError("");
      setStatus("idle");
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Canonical destinations are unavailable.");
      setStatus("error");
    });
  }, [open, projectId]);

  useEffect(() => {
    if (!open || representation !== "Exact" || !conversationId) return;
    let active = true;
    fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`,
      { cache: "no-store" },
    ).then(async (response) => {
      if (!response.ok) throw new Error("Canonical source messages are unavailable.");
      const value = await response.json() as {
        conversation: { id: string };
        messages: SourceMessage[];
      };
      if (
        value.conversation.id !== conversationId
        || value.messages.some((message) => (
          message.projectId !== projectId || message.conversationId !== conversationId
        ))
      ) {
        throw new Error("Canonical source-message scope did not match the selected conversation.");
      }
      if (!active) return;
      setMessages(value.messages);
      setMessageStatus("ready");
    }).catch((caught) => {
      if (!active) return;
      setMessageError(caught instanceof Error ? caught.message : "Canonical source messages are unavailable.");
      setMessageStatus("error");
    });
    return () => {
      active = false;
    };
  }, [conversationId, open, projectId, representation]);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === sourceMessageId) || null,
    [messages, sourceMessageId],
  );
  const span = useMemo(() => {
    if (!selectedMessage) return null;
    const start = spanMode === "full" ? 0 : Number(sourceStart);
    const end = spanMode === "full" ? selectedMessage.exactContent.length : Number(sourceEnd);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end <= start
      || end > selectedMessage.exactContent.length
    ) return null;
    return {
      start,
      end,
      text: selectedMessage.exactContent.slice(start, end),
    };
  }, [selectedMessage, sourceEnd, sourceStart, spanMode]);

  const submittedContent = representation === "Exact" ? span?.text || "" : content;

  function clearSourceSelection() {
    setMessages([]);
    setMessageStatus("idle");
    setSourceMessageId("");
    setSpanMode("full");
    setSourceStart("0");
    setSourceEnd("0");
    setMessageError("");
  }

  function close() {
    setType("observation");
    setConversationId("");
    setRepresentation("Reconstructed");
    setContent("");
    clearSourceSelection();
    setReceipt(null);
    setError("");
    setStatus("idle");
    onClose();
  }

  function changeConversation(nextConversationId: string) {
    setConversationId(nextConversationId);
    clearSourceSelection();
    if (representation === "Exact" && nextConversationId) setMessageStatus("loading");
  }

  function changeRepresentation(nextRepresentation: string) {
    setRepresentation(nextRepresentation);
    clearSourceSelection();
    if (nextRepresentation === "Exact" && conversationId) setMessageStatus("loading");
  }

  function chooseSourceMessage(messageId: string) {
    setSourceMessageId(messageId);
    const message = messages.find((candidate) => candidate.id === messageId);
    setSourceStart("0");
    setSourceEnd(String(message?.exactContent.length || 0));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setReceipt(null);
    if (representation === "Exact") {
      if (!conversationId) {
        setError("Exact representation requires a selected canonical conversation. Nothing was saved.");
        setStatus("error");
        return;
      }
      if (!selectedMessage || !span) {
        setError("Select a canonical source message and a valid exact span. Nothing was saved.");
        setStatus("error");
        return;
      }
      if (submittedContent !== span.text) {
        setError("What happened must match the exact selected source span. Nothing was saved.");
        setStatus("error");
        return;
      }
    }
    setStatus("saving");
    const body = {
      type,
      objective: String(data.get("objective") || ""),
      content: submittedContent,
      caseId: String(data.get("caseId") || "") || undefined,
      conversationId: conversationId || undefined,
      representation,
      sourceMessageId: representation === "Exact" ? selectedMessage?.id : undefined,
      sourceStart: representation === "Exact" ? span?.start : undefined,
      sourceEnd: representation === "Exact" ? span?.end : undefined,
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
    setType("observation");
    setConversationId("");
    setRepresentation("Reconstructed");
    setContent("");
    setMessages([]);
    setSourceMessageId("");
    setSpanMode("full");
    setSourceStart("0");
    setSourceEnd("0");
  }

  if (!open) return null;
  const authorized = Boolean(session?.writeAuthorization.authorized);
  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <section aria-label="Contextual Add" className={styles.sheet} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>Contextual Add</span>
            <h2>Add to {projectId}</h2>
          </div>
          <button aria-label="Close Contextual Add" onClick={close} type="button">×</button>
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
              {receipt.sourceLineage && (
                <div>
                  <dt>Exact source lineage</dt>
                  <dd>
                    <Link href={receipt.sourceLineage.href}>
                      Open message {receipt.sourceLineage.messageId}, characters {receipt.sourceLineage.start}–{receipt.sourceLineage.end}
                    </Link>
                  </dd>
                </div>
              )}
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
              <select onChange={(event) => {
                const nextType = event.target.value;
                setType(nextType);
                if (nextType === "case") changeRepresentation("Reconstructed");
              }} value={type}>
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
                <select onChange={(event) => changeConversation(event.target.value)} value={conversationId}>
                  <option value="">Use case association</option>
                  {conversations.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
                </select>
              </label>
              {type !== "case" && (
                <label>
                  Representation
                  <select onChange={(event) => changeRepresentation(event.target.value)} value={representation}>
                    <option value="Reconstructed">Reconstructed</option>
                    <option value="Compressed">Compressed</option>
                    <option value="Exact">Exact</option>
                  </select>
                </label>
              )}
            </div>
            {representation === "Exact" && type !== "case" && (
              <fieldset className={styles.sourcePicker}>
                <legend>Exact canonical source</legend>
                {!conversationId ? (
                  <p>Select a canonical conversation before choosing an Exact source message.</p>
                ) : messageStatus === "loading" ? (
                  <p>Loading immutable messages…</p>
                ) : (
                  <>
                    <label>
                      Source message
                      <select onChange={(event) => chooseSourceMessage(event.target.value)} value={sourceMessageId}>
                        <option value="">Select an immutable message</option>
                        {messages.map((message) => (
                          <option key={message.id} value={message.id}>{messageLabel(message)}</option>
                        ))}
                      </select>
                    </label>
                    {messageStatus === "ready" && messages.length === 0 && (
                      <p>This conversation has no immutable messages to cite.</p>
                    )}
                    {selectedMessage && (
                      <>
                        <div className={styles.spanModes}>
                          <label>
                            <input
                              checked={spanMode === "full"}
                              name="spanMode"
                              onChange={() => setSpanMode("full")}
                              type="radio"
                            />
                            Full message
                          </label>
                          <label>
                            <input
                              checked={spanMode === "explicit"}
                              name="spanMode"
                              onChange={() => setSpanMode("explicit")}
                              type="radio"
                            />
                            Explicit character span
                          </label>
                        </div>
                        {spanMode === "explicit" && (
                          <div className={styles.offsets}>
                            <label>
                              Start offset
                              <input
                                max={selectedMessage.exactContent.length - 1}
                                min="0"
                                onChange={(event) => setSourceStart(event.target.value)}
                                step="1"
                                type="number"
                                value={sourceStart}
                              />
                            </label>
                            <label>
                              End offset (exclusive)
                              <input
                                max={selectedMessage.exactContent.length}
                                min="1"
                                onChange={(event) => setSourceEnd(event.target.value)}
                                step="1"
                                type="number"
                                value={sourceEnd}
                              />
                            </label>
                          </div>
                        )}
                        <div className={styles.preview}>
                          <span>Exact selected text</span>
                          {span ? <pre>{span.text}</pre> : <p>Select a valid non-empty span within the message.</p>}
                        </div>
                      </>
                    )}
                  </>
                )}
                {messageError && <p className={styles.error}>{messageError}</p>}
              </fieldset>
            )}
            {type === "case" ? (
              <label>
                Case objective
                <textarea name="objective" placeholder="Bound the work that should remain continuous." required />
              </label>
            ) : (
              <label>
                What happened
                <textarea
                  name="content"
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={representation === "Exact"
                    ? "Select a canonical source message and span above."
                    : "Preserve the observation without promoting it."}
                  readOnly={representation === "Exact"}
                  required
                  value={submittedContent}
                />
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
            <button
              className={styles.primary}
              disabled={
                !authorized
                || status === "saving"
                || status === "loading"
                || (representation === "Exact" && (!conversationId || !selectedMessage || !span))
              }
              type="submit"
            >
              {status === "saving" ? "Saving canonically…" : "Save and show connection receipt"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
