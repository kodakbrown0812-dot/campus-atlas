"use client";

import { HandoffResult, PacketResult, ReceivingModel } from "./ask-types";
import styles from "./ask.module.css";

function failureGuidance(handoff: HandoffResult) {
  const category = handoff.handoff.failureCategory || "provider_failure";
  const packetValid = handoff.packet.status === "compiled" && !handoff.packet.compilationError;
  return {
    failed: handoff.handoff.failureReason || "The receiving-model handoff failed.",
    recordCreated: Boolean(handoff.handoff.id),
    lifecycleSaved: handoff.lifecycle.length > 0,
    packetValid,
    answerExists: Boolean(handoff.answer),
    retrySafe: packetValid && handoff.handoff.status === "failed",
    nextAction: category === "missing_configuration"
      ? "Configure OPENAI_API_KEY in the authorized environment, then create a new handoff attempt."
      : "Review the provider failure, then create a new handoff attempt with a new idempotency key when safe.",
  };
}

export default function HandoffPresentation({
  packet,
  handoff,
  models,
  selectedModel,
  canWrite,
  busy,
  onModelChange,
  onSend,
}: {
  packet: PacketResult;
  handoff: HandoffResult | null;
  models: ReceivingModel[];
  selectedModel: string;
  canWrite: boolean;
  busy: boolean;
  onModelChange(value: string): void;
  onSend(): void;
}) {
  const failure = handoff?.handoff.status === "failed" ? failureGuidance(handoff) : null;
  const live = handoff?.handoff.additionalLiveRetrieval;
  return (
    <section className={styles.stagePanel} aria-labelledby="handoff-title">
      <div className={styles.sectionHeading}>
        <div>
          <span>Stage 4</span>
          <h2 id="handoff-title">Handoff and receipt</h2>
        </div>
        <p>Four canonical records remain visually and technically separate.</p>
      </div>

      <div className={styles.separationGrid}>
        <article>
          <span>Your request</span>
          <h3>Cody’s exact original task</h3>
          <pre>{packet.packet.task}</pre>
          <small>No Atlas wording is inserted into this user-authored request.</small>
        </article>
        <article>
          <span>Atlas reconstruction</span>
          <h3>Packet {packet.packet.id}</h3>
          <pre>{packet.packet.compiledContent}</pre>
          <small>
            Atlas-supplied governed context. Not a new user message. It cannot override this request or higher-priority instructions.
          </small>
        </article>
        <article>
          <span>Model answer</span>
          <h3>{handoff?.answer ? `${handoff.answer.provider} · ${handoff.answer.model}` : "No model answer exists"}</h3>
          {handoff?.answer ? (
            <>
              <p>{handoff.answer.answerText}</p>
              <small>
                Provider response {handoff.answer.providerResponseId} · {handoff.answer.answerTimestamp}
              </small>
            </>
          ) : (
            <p>
              {handoff?.handoff.failureReason
                || "The saved packet has not produced a receiving-model answer. No seeded or test answer was substituted."}
            </p>
          )}
        </article>
        <article>
          <span>Receipt</span>
          <h3>{handoff?.receipt?.id || "No handoff receipt yet"}</h3>
          <p>
            {handoff?.receipt?.honestyStatement
              || "A receipt will prove what Atlas supplied and why; it will not claim that context caused correctness."}
          </p>
          <small>Packet receipt remains immutable and is referenced rather than rewritten.</small>
        </article>
      </div>

      {!handoff || handoff.handoff.status === "failed" ? (
        <section className={styles.dispatchPanel}>
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
          {!models.length ? (
            <p className={styles.failureText}>
              No supported production model is available. A test adapter is never selectable here.
            </p>
          ) : null}
          <button
            className={styles.primaryButton}
            disabled={!canWrite || busy || !models.length}
            onClick={onSend}
            type="button"
          >
            {busy ? "Creating canonical handoff…" : handoff ? "Create a new handoff attempt" : "Send exact saved packet"}
          </button>
        </section>
      ) : null}

      {handoff ? (
        <>
          <section className={styles.receiptPanel}>
            <div className={styles.metadataGrid}>
              <div><dt>Handoff</dt><dd>{handoff.handoff.id}</dd></div>
              <div><dt>Packet</dt><dd>{handoff.handoff.packetId}</dd></div>
              <div><dt>Packet version</dt><dd>{handoff.packet.version}</dd></div>
              <div><dt>Roadway</dt><dd>{handoff.packet.interpretation.primaryRoadway?.name}</dd></div>
              <div><dt>Provider/model</dt><dd>{handoff.handoff.provider} · {handoff.handoff.model}</dd></div>
              <div><dt>Status</dt><dd>{handoff.handoff.status}</dd></div>
              <div><dt>Created</dt><dd>{handoff.handoff.createdAt}</dd></div>
              <div><dt>Terminal</dt><dd>{handoff.handoff.terminalAt || "Pending"}</dd></div>
              <div><dt>Answer reference</dt><dd>{handoff.answer?.id || "None"}</dd></div>
              <div><dt>Prior packet</dt><dd>{handoff.receipt?.priorComparablePacketId || "None"}</dd></div>
            </div>

            <h3>Lifecycle</h3>
            <ol className={styles.lifecycle}>
              {handoff.lifecycle.map((event) => (
                <li key={event.id}>
                  <strong>{event.status}</strong>
                  <span>{event.createdAt}</span>
                  {event.failureReason ? <p>{event.failureReason}</p> : null}
                </li>
              ))}
            </ol>

            <h3>Additional live retrieval</h3>
            <p>{live?.performed ? "Additional live retrieval was recorded." : "No additional live retrieval occurred."}</p>
            <ul>
              <li>Requested: {live?.requested ? "yes" : "no"}</li>
              <li>Retrieval time: {live?.retrievedAt || "none"}</li>
              <li>Tools: {live?.tools.length ? live.tools.map((tool) => tool.identity || tool.type).join(", ") : "none"}</li>
              <li>Newer state used: {live?.reliedOnNewerStateThanPacket ? "yes" : "no"}</li>
            </ul>

            <h3>Causal packet difference</h3>
            {handoff.receipt?.governanceCauses.map((cause) => (
              <p className={styles.cause} key={cause.governanceEventId}>
                {cause.effect} Event: {cause.governanceEventId}.
              </p>
            ))}
            <pre>{JSON.stringify(handoff.receipt?.causalPacketDifference || [], null, 2)}</pre>

            {handoff.receipt?.unresolvedConflicts.length ? (
              <>
                <h3>Unresolved conflicts</h3>
                {handoff.receipt.unresolvedConflicts.map((item) => <p key={item.sourceId}>{item.statement}</p>)}
              </>
            ) : null}
            {handoff.receipt?.strongestChallenges.length ? (
              <>
                <h3>Strongest challenge</h3>
                <pre>{JSON.stringify(handoff.receipt.strongestChallenges, null, 2)}</pre>
              </>
            ) : null}
            {handoff.receipt?.corrections.length ? (
              <>
                <h3>Corrections</h3>
                <pre>{JSON.stringify(handoff.receipt.corrections, null, 2)}</pre>
              </>
            ) : null}
            {handoff.receipt?.historicalLimitations.length ? (
              <>
                <h3>Historical-source limitations</h3>
                <pre>{JSON.stringify(handoff.receipt.historicalLimitations, null, 2)}</pre>
              </>
            ) : null}
          </section>

          {failure ? (
            <section className={styles.failureState} role="alert">
              <strong>{failure.failed}</strong>
              <ul>
                <li>Handoff record created: {failure.recordCreated ? "yes" : "no"}</li>
                <li>Lifecycle events saved: {failure.lifecycleSaved ? "yes" : "no"}</li>
                <li>Saved packet remains valid: {failure.packetValid ? "yes" : "no"}</li>
                <li>Answer exists: {failure.answerExists ? "yes" : "no"}</li>
                <li>Retry is safe: {failure.retrySafe ? "yes, as a new attempt" : "not yet"}</li>
              </ul>
              <p>Next action: {failure.nextAction}</p>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
