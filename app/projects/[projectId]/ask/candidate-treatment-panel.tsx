"use client";

import { CandidatePreview, TreatmentItem } from "./ask-types";
import styles from "./ask.module.css";

function CandidateCard({
  item,
  projectId,
  strongestChallenge,
}: {
  item: TreatmentItem;
  projectId: string;
  strongestChallenge: TreatmentItem | null;
}) {
  const challengeApplies = item.treatment === "Use" && strongestChallenge;
  return (
    <article className={styles.candidateCard}>
      <header>
        <span>{item.sourceType}</span>
        <b>{item.representation}</b>
      </header>
      <strong>{item.statement}</strong>
      <p>{item.reason}</p>
      <dl className={styles.metadataGrid}>
        <div><dt>Source</dt><dd>{item.sourceId}</dd></div>
        <div><dt>Version</dt><dd>{item.sourceVersionId || "Unversioned source"}</dd></div>
        <div><dt>Project</dt><dd>{projectId}</dd></div>
        <div><dt>Case</dt><dd>{item.caseId || "Project scope"}</dd></div>
        <div><dt>Scope</dt><dd>{item.scope}</dd></div>
        <div><dt>Authority</dt><dd>{item.authority}</dd></div>
        <div><dt>Freshness</dt><dd>{item.freshness}</dd></div>
        <div><dt>Status</dt><dd>{item.status || "snapshot"}</dd></div>
        <div><dt>Evidence strength</dt><dd>{item.ranking?.evidenceStrength ?? "not scored"}</dd></div>
        <div><dt>Governance cause</dt><dd>{item.governanceEventId || "None"}</dd></div>
      </dl>
      {item.counterevidenceIds?.length ? (
        <p className={styles.challenge}>Counterevidence: {item.counterevidenceIds.join(", ")}</p>
      ) : null}
      {challengeApplies ? (
        <p className={styles.challenge}>
          Strongest challenge retained: {strongestChallenge.statement}
        </p>
      ) : null}
      <details className={styles.advanced}>
        <summary>Discovery and ranking details</summary>
        <pre>{JSON.stringify({ protectedRole: item.protectedRole, metadata: item.metadata }, null, 2)}</pre>
      </details>
    </article>
  );
}

export default function CandidateTreatmentPanel({
  preview,
  projectId,
  onContinue,
}: {
  preview: CandidatePreview;
  projectId: string;
  onContinue(): void;
}) {
  return (
    <section className={styles.stagePanel} aria-labelledby="candidate-treatment-title">
      <div className={styles.sectionHeading}>
        <div>
          <span>Stage 2</span>
          <h2 id="candidate-treatment-title">Treat candidates</h2>
        </div>
        <p>These treatments are canonical server results. The browser cannot promote authority.</p>
      </div>

      <div className={styles.metricGrid}>
        <div><span>Discovered</span><strong>{preview.candidateSummary.discovered}</strong></div>
        <div><span>Used</span><strong>{preview.candidateSummary.used}</strong></div>
        <div><span>Considered</span><strong>{preview.candidateSummary.considered}</strong></div>
        <div><span>Excluded</span><strong>{preview.candidateSummary.excluded}</strong></div>
        <div><span>Redundant removed</span><strong>{preview.candidateSummary.redundantRecordsRemoved}</strong></div>
        <div><span>Corrections retained</span><strong>{preview.candidateSummary.protectedCorrectionsRetained}</strong></div>
      </div>

      <div className={styles.protectionNotice}>
        <strong>
          Strongest challenge {preview.candidateSummary.strongestChallengeRetained ? "retained" : "not applicable"}
        </strong>
        <span>
          Narrow-task protection is active. Discovery did not become a broad project-memory dump.
        </span>
      </div>

      {(["Use", "Consider", "Exclude"] as const).map((treatment) => (
        <section className={styles.treatmentGroup} key={treatment}>
          <header>
            <div>
              <span>{treatment}</span>
              <strong>{preview.treatmentSummary[treatment].length} consequential items</strong>
            </div>
            <p>
              {treatment === "Use"
                ? "Scope-appropriate governing context and required state."
                : treatment === "Consider"
                  ? "Relevant context that cannot govern the receiving model."
                  : "Inspectably omitted because authority, scope, freshness, mechanism, redundancy, or budget disallows use."}
            </p>
          </header>
          <div className={styles.candidateList}>
            {preview.treatmentSummary[treatment].length ? (
              preview.treatmentSummary[treatment].map((item) => (
                <CandidateCard
                  item={item}
                  key={`${item.sourceType}:${item.sourceId}`}
                  projectId={projectId}
                  strongestChallenge={preview.strongestChallenge}
                />
              ))
            ) : (
              <p className={styles.empty}>No candidates received this treatment.</p>
            )}
          </div>
        </section>
      ))}

      <div className={styles.stickyControls}>
        <button className={styles.primaryButton} onClick={onContinue} type="button">
          Continue to packet compilation
        </button>
      </div>
    </section>
  );
}
