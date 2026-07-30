"use client";

import { PacketResult } from "./ask-types";
import styles from "./ask.module.css";

function readableSections(content: string) {
  const result: Array<{ title: string; lines: string[] }> = [];
  let current = { title: "Task and packet contract", lines: [] as string[] };
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) {
      if (current.lines.some((value) => value.trim())) result.push(current);
      current = { title: line.slice(3), lines: [] };
    } else if (!line.startsWith("# ")) {
      current.lines.push(line);
    }
  }
  if (current.lines.some((value) => value.trim())) result.push(current);
  return result;
}

function changeLabel(change: Record<string, unknown>) {
  if (change.type === "added") return "Added";
  if (change.type === "removed") return "Removed";
  const fields = Array.isArray(change.fields)
    ? change.fields.map((field) => String((field as Record<string, unknown>).field)).join(", ")
    : "Treatment";
  return `${fields} changed`;
}

export default function PacketPreview({
  result,
  onContinue,
}: {
  result: PacketResult;
  onContinue(): void;
}) {
  const compiled = result.packet.status === "compiled" && !result.packet.compilationError;
  const differences = result.receipt.exactPacketDifference;
  const changedIds = new Set(differences.map((item) => String(item.sourceId || "")));
  const protectedUnchanged = Object.values(result.receipt.treatmentSummary)
    .flat()
    .filter((item) => item.protectedRole && !changedIds.has(item.sourceId));

  return (
    <section className={styles.stagePanel} aria-labelledby="packet-preview-title">
      <div className={styles.sectionHeading}>
        <div>
          <span>Stage 3</span>
          <h2 id="packet-preview-title">Immutable packet</h2>
        </div>
        <p>{result.packet.id} · version {result.packet.version}</p>
      </div>

      <div className={compiled ? styles.successState : styles.failureState} role="status">
        <strong>{compiled ? "Compiled" : "Packet compilation failed"}</strong>
        <span>
          {compiled
            ? `${result.packet.finalTokenCount}/${result.packet.tokenBudget} estimated tokens. This snapshot cannot be edited.`
            : `${result.packet.compilationError}. The failed record remains inspectable and was not presented as partial success.`}
        </span>
      </div>

      <div className={styles.packetSections}>
        {readableSections(result.packet.compiledContent).map((section) => (
          <article key={section.title}>
            <h3>{section.title}</h3>
            <pre>{section.lines.join("\n").trim()}</pre>
          </article>
        ))}
      </div>

      <section className={styles.comparison}>
        <header>
          <div>
            <span>Packet comparison</span>
            <h3>{result.packet.priorComparablePacketId ? "Causal change from prior packet" : "No comparable prior packet exists"}</h3>
          </div>
          <p>
            {result.packet.priorComparablePacketId
              ? `${result.packet.priorComparablePacketId} → ${result.packet.id}`
              : "This packet starts a new comparison chain."}
          </p>
        </header>
        {differences.length ? (
          <div className={styles.diffList}>
            {differences.map((change, index) => (
              <article key={`${String(change.sourceId)}:${index}`}>
                <strong>{changeLabel(change)}</strong>
                <span>{String(change.sourceType || "Record")} · {String(change.sourceId || "unknown")}</span>
                {Array.isArray(change.fields) ? (
                  <ul>
                    {change.fields.map((field, fieldIndex) => {
                      const value = field as Record<string, unknown>;
                      return (
                        <li key={fieldIndex}>
                          {String(value.field)}: {String(value.from)} → {String(value.to)}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        ) : <p className={styles.empty}>No consequential item changed from the comparable snapshot.</p>}
        {result.receipt.governanceCauses.map((cause) => (
          <p className={styles.cause} key={cause.governanceEventId}>
            {cause.effect} Event: {cause.governanceEventId}. This records eligibility, not outcome correctness.
          </p>
        ))}
        {protectedUnchanged.length ? (
          <details className={styles.advanced}>
            <summary>Important unchanged protected items</summary>
            {protectedUnchanged.map((item) => (
              <p key={`${item.sourceType}:${item.sourceId}`}>{item.statement}</p>
            ))}
          </details>
        ) : null}
      </section>

      <details className={styles.advanced}>
        <summary>Advanced · raw canonical snapshot</summary>
        <p>Readable and raw views are derived from this same immutable packet response.</p>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>

      <div className={styles.stickyControls}>
        <button
          className={styles.primaryButton}
          disabled={!compiled}
          onClick={onContinue}
          type="button"
        >
          Continue to receiving-model handoff
        </button>
      </div>
    </section>
  );
}
