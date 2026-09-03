"use client";

import { useState } from "react";
import { HandoffResult, PreparedContext, ReceivingModel } from "./ask-types";
import styles from "./ask.module.css";

type CopyState = "copied" | "failed" | null;

function selectPreparedContext() {
  const node = document.getElementById("prepared-context-content");
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  node.focus();
}

export default function HandoffPresentation({
  context,
}: {
  context: PreparedContext;
}) {
  const [copyState, setCopyState] = useState<CopyState>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(context.packet.compiledContent);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className={styles.continuationActions} aria-label="Prepared context destinations">
      <h3>Ready for a fresh room</h3>
      <div className={styles.destinationGrid}>
        <article className={styles.primaryDestination}>
          <strong>Transfer packet</strong>
          <p>Paste this exact packet into the fresh conversation before continuing the work.</p>
          <button onClick={() => void copy()} type="button">Copy for fresh room</button>
        </article>
      </div>

      {copyState === "copied" ? (
        <div className={styles.copySuccess} role="status">
          <strong>Transfer packet copied</strong>
          <span>Paste it into the fresh room before continuing the work.</span>
        </div>
      ) : null}
      {copyState === "failed" ? (
        <div className={styles.copyFailure} role="alert">
          <strong>Automatic copy was unavailable.</strong>
          <span>Select the exact prepared context, then copy it manually.</span>
          <button onClick={selectPreparedContext} type="button">Select prepared context</button>
        </div>
      ) : null}

      <p className={styles.resultExplanation}>The copied text is the exact immutable packet returned by Atlas.</p>
    </section>
  );
}

export function HandoffAdvanced({
  busy,
  canWrite,
  handoff,
  models,
  onModelChange,
  onSend,
  selectedModel,
}: {
  busy: boolean;
  canWrite: boolean;
  handoff: HandoffResult | null;
  models: ReceivingModel[];
  onModelChange(value: string): void;
  onSend(): void;
  selectedModel: string;
}) {
  return (
    <section className={styles.providerSection} aria-label="Provider handoff controls">
      <h3>Send another way</h3>
      <div className={styles.providerControls}>
        <label htmlFor="receiving-model">Supported production receiving model</label>
        <select
          id="receiving-model"
          onChange={(event) => onModelChange(event.target.value)}
          value={selectedModel}
        >
          {models.map((model) => (
            <option key={`${model.provider}:${model.model}`} value={model.model}>
              {model.provider} · {model.model}
            </option>
          ))}
        </select>
        <button disabled={!canWrite || busy || !models.length} onClick={onSend} type="button">
          {busy ? "Sending immutable packet…" : "Send exact saved packet"}
        </button>
        {!models.length ? <p>No supported production provider is configured.</p> : null}
      </div>

      {handoff ? (
        <details className={styles.handoffReceipt} open={handoff.handoff.status === "failed"}>
          <summary>Provider handoff and receipt · {handoff.handoff.status}</summary>
          <dl>
            <div><dt>Handoff</dt><dd>{handoff.handoff.id}</dd></div>
            <div><dt>Provider / model</dt><dd>{handoff.handoff.provider} · {handoff.handoff.model}</dd></div>
            <div><dt>Packet</dt><dd>{handoff.handoff.packetId}</dd></div>
            <div><dt>Answer</dt><dd>{handoff.answer?.id || "No answer exists"}</dd></div>
          </dl>
          {handoff.handoff.failureReason ? <p role="alert">{handoff.handoff.failureReason}</p> : null}
          {handoff.answer ? <p>{handoff.answer.answerText}</p> : null}
        </details>
      ) : null}
    </section>
  );
}
