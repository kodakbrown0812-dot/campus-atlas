"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { PreparedContext, ReconstructionRunResult, TreatmentItem } from "./ask-types";
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
  advancedActions,
  actions,
  context,
}: {
  advancedActions: ReactNode;
  actions: ReactNode;
  context: PreparedContext;
}) {
  const includedItems = context.receipt.treatmentSummary.Use.filter((item) => item.sourceType !== "RoadwayCheck").length;
  const comparisonUrl = `${context.links.packet}/comparison`;
  const run = context.raw as Partial<ReconstructionRunResult>;

  return (
    <section className={styles.readyPanel} aria-labelledby="prepared-context-title">
      <header className={styles.readyHeader}>
        <div>
          <span>Fresh-room packet</span>
          <h2 id="prepared-context-title">Ready to copy</h2>
          <p>Atlas prepared the smallest safe project context this continuation needs.</p>
        </div>
      </header>

      <div className={styles.resultTask}>
        <span>Your task</span>
        <p>{context.literalTask}</p>
      </div>

      {context.receipt.unresolvedConflicts.length ? (
        <div className={styles.uncertaintyNotice}>
          Material uncertainty remains visible: {context.receipt.unresolvedConflicts.length} unresolved conflict{context.receipt.unresolvedConflicts.length === 1 ? "" : "s"}.
        </div>
      ) : null}

      <pre className={styles.compiledContent} id="prepared-context-content" tabIndex={0}>{context.packet.compiledContent}</pre>

      {actions}

      <details className={styles.technicalDetails}>
        <summary>Advanced details</summary>
        <dl className={styles.resultMetadata}>
          <div><dt>Need level</dt><dd>Full</dd></div>
          <div><dt>Reason codes</dt><dd>{run.need?.reasonCodes?.join(", ") || "Available in Inspect"}</dd></div>
          <div><dt>Roadway</dt><dd>{run.roadway?.primary?.name || run.roadway?.name || "Available in Inspect"}</dd></div>
          <div><dt>Included items</dt><dd>{includedItems}</dd></div>
          <div><dt>Estimated tokens</dt><dd>{context.packet.finalTokenCount}/{context.packet.tokenBudget}</dd></div>
          <div><dt>Packet</dt><dd>{context.packet.id}</dd></div>
          <div><dt>Receipt</dt><dd>{context.receipt.id}</dd></div>
          <div><dt>Packet created this run</dt><dd>{run.effects ? run.effects.packetCreated ? "Yes" : "No · immutable replay" : "Existing record"}</dd></div>
          <div><dt>Receipt created this run</dt><dd>{run.effects ? run.effects.receiptCreated ? "Yes" : "No · immutable replay" : "Existing record"}</dd></div>
        </dl>
        {advancedActions}
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
        <nav className={styles.advancedLinks} aria-label="Prepared context inspection">
          <Link href={context.links.inspect}>Inspect why</Link>
          <Link href={`/projects/${encodeURIComponent(context.projectId)}/inspect`}>View sources</Link>
          <a href={comparisonUrl} rel="noreferrer" target="_blank">Compare packet</a>
          <Link href={context.links.inspect}>Source lineage</Link>
          <a href={context.links.packet} rel="noreferrer" target="_blank">Raw JSON</a>
        </nav>
      </details>
    </section>
  );
}
