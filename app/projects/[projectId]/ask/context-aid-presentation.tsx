"use client";

import { useState } from "react";
import { TargetedContextCapsule } from "./ask-types";
import styles from "./ask.module.css";

type CopyState = "idle" | "copied" | "failed";

function selectContextAid() {
  const node = document.getElementById("context-aid-content");
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  node.focus();
}

export default function ContextAidPresentation({
  capsule,
  onPrepareFullTransfer,
}: {
  capsule: TargetedContextCapsule;
  onPrepareFullTransfer(): void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(capsule.compiledContent);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className={styles.contextAidPanel} aria-labelledby="context-aid-title">
      <header className={styles.readyHeader}>
        <div>
          <span>Context aid ready</span>
          <h2 id="context-aid-title">Aid this room</h2>
          <p>A targeted governed context capsule is ready for the conversation already in progress.</p>
        </div>
        <dl>
          <div><dt>Included items</dt><dd>{capsule.includedItems}</dd></div>
          <div><dt>Estimated tokens</dt><dd>{capsule.estimatedTokens}</dd></div>
        </dl>
      </header>

      <pre className={styles.compiledContent} id="context-aid-content" tabIndex={0}>{capsule.compiledContent}</pre>

      <article className={`${styles.contextAidDestination} ${styles.primaryDestination}`}>
        <div>
          <h3>Aid this room</h3>
          <p>Copy the targeted context into the conversation already in progress.</p>
        </div>
        <button onClick={() => void copy()} type="button">Copy for this room</button>
      </article>

      {copyState === "copied" ? (
        <div className={styles.copySuccess} role="status">
          <strong>Context aid copied</strong>
          <span>Paste it into the conversation already in progress.</span>
        </div>
      ) : null}
      {copyState === "failed" ? (
        <div className={styles.copyFailure} role="alert">
          <strong>Automatic copy was unavailable.</strong>
          <span>Select the exact context aid, then copy it manually.</span>
          <button onClick={selectContextAid} type="button">Select context aid</button>
        </div>
      ) : null}

      <details className={styles.whyDisclosure}>
        <summary>Why Atlas chose this</summary>
        <dl className={styles.capsuleEvidence}>
          <div><dt>Treatment</dt><dd>Used</dd></div>
          <div><dt>Source</dt><dd>{capsule.sourceType} · {capsule.sourceId}</dd></div>
          <div><dt>Authority</dt><dd>{capsule.authority}</dd></div>
          <div><dt>Provenance</dt><dd>{capsule.sourceVersionId}</dd></div>
          <div><dt>Reason</dt><dd>{capsule.reason}</dd></div>
        </dl>
      </details>

      <button className={styles.fullTransferAction} onClick={onPrepareFullTransfer} type="button">
        Prepare full room transfer
      </button>
    </section>
  );
}
