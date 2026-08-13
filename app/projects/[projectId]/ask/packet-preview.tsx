"use client";

import Link from "next/link";
import { PreparedContext, TreatmentItem } from "./ask-types";
import styles from "./ask.module.css";

const treatmentMeaning = {
  Use: "Included in the prepared context under server-owned policy. Authority, uncertainty, and provenance remain explicit.",
  Consider: "Relevant material retained for review, but not included in the prepared context.",
  Exclude: "Omitted because it is stale, superseded, conflicting, out of scope, unsafe, redundant, or unnecessary.",
} as const;

function SourceItem({ item }: { item: TreatmentItem }) {
  return (
    <article className={styles.sourceItem}>
      <header>
        <strong>{item.statement}</strong>
        <span>{item.representation}</span>
      </header>
      <p>{item.reason}</p>
      <dl>
        <div><dt>Source</dt><dd>{item.sourceType} · {item.sourceId}</dd></div>
        <div><dt>Provenance</dt><dd>{item.sourceVersionId || "Unversioned source"}</dd></div>
        <div><dt>Authority</dt><dd>{item.authority}</dd></div>
        <div><dt>Scope / freshness</dt><dd>{item.scope} · {item.freshness}</dd></div>
      </dl>
    </article>
  );
}

export default function PacketPreview({
  context,
  projectName,
}: {
  context: PreparedContext;
  projectName: string;
}) {
  const includedItems = context.receipt.treatmentSummary.Use.filter((item) => item.sourceType !== "RoadwayCheck").length;
  const comparisonUrl = `${context.links.packet}/comparison`;

  return (
    <section className={styles.readyPanel} aria-labelledby="prepared-context-title">
      <header className={styles.readyHeader}>
        <div>
          <span>Context packet ready</span>
          <h2 id="prepared-context-title">Prepared context</h2>
          <small className={styles.projectName}>Project · {projectName}</small>
          <p>{context.literalTask}</p>
        </div>
        <dl>
          <div><dt>Included items</dt><dd>{includedItems}</dd></div>
          <div><dt>Estimated tokens</dt><dd>{context.packet.finalTokenCount}/{context.packet.tokenBudget}</dd></div>
        </dl>
      </header>

      {context.receipt.unresolvedConflicts.length ? (
        <div className={styles.uncertaintyNotice}>
          Material uncertainty remains visible: {context.receipt.unresolvedConflicts.length} unresolved conflict{context.receipt.unresolvedConflicts.length === 1 ? "" : "s"}.
        </div>
      ) : null}

      <pre className={styles.compiledContent} id="prepared-context-content" tabIndex={0}>{context.packet.compiledContent}</pre>

      <details className={styles.whyDisclosure}>
        <summary>Why Atlas chose this</summary>
        <div className={styles.treatmentSummary}>
          {(["Use", "Consider", "Exclude"] as const).map((treatment) => (
            <section key={treatment}>
              <header>
                <div><strong>{treatment === "Use" ? "Used" : treatment === "Consider" ? "Considered" : "Excluded"}</strong><b>{context.receipt.treatmentSummary[treatment].length}</b></div>
                <p>{treatmentMeaning[treatment]}</p>
              </header>
              <details>
                <summary>View {treatment.toLowerCase()} sources</summary>
                <div className={styles.sourceList}>
                  {context.receipt.treatmentSummary[treatment].length
                    ? context.receipt.treatmentSummary[treatment].map((item) => (
                      <SourceItem item={item} key={`${item.sourceType}:${item.sourceId}`} />
                    ))
                    : <p>No sources received this treatment.</p>}
                </div>
              </details>
            </section>
          ))}
        </div>
      </details>

      <details className={styles.inspectLinks}>
        <summary>Inspect sources and receipts</summary>
        <nav aria-label="Prepared context inspection">
          <Link href={`/projects/${encodeURIComponent(context.projectId)}/inspect`}>View sources</Link>
          <Link href={context.links.inspect}>View packet in Inspect</Link>
          <a href={comparisonUrl} rel="noreferrer" target="_blank">Compare packet</a>
          <Link href={context.links.inspect}>Source lineage</Link>
          <a href={context.links.packet} rel="noreferrer" target="_blank">Raw JSON</a>
        </nav>
      </details>
    </section>
  );
}
