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
  literalTask,
}: {
  capsule: TargetedContextCapsule;
  literalTask: string;
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
          <span>Compact context</span>
          <h2 id="context-aid-title">
            {capsule.includedItems === 1 ? "One project decision matters here" : `${capsule.includedItems} project decisions matter here`}
          </h2>
          <p>Atlas prepared the governed context that applies to this task.</p>
        </div>
      </header>

      <div className={styles.resultTask}>
        <span>Your task</span>
        <p>{literalTask}</p>
      </div>

      <pre className={styles.compiledContent} id="context-aid-content" tabIndex={0}>{capsule.compiledContent}</pre>

      <div className={styles.contextAidDestination}>
        <button onClick={() => void copy()} type="button">Copy for this room</button>
      </div>

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

      <p className={styles.resultExplanation}>Atlas kept this preparation compact, and no packet or receipt was created.</p>
    </section>
  );
}
