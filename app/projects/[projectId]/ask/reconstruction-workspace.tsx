"use client";

import { useEffect, useState } from "react";
import { useWriteSession } from "../../../components/write-session";
import AskHistory from "./ask-history";
import {
  CandidatePreview,
  HandoffResult,
  HandoffSummary,
  Interpretation,
  PacketResult,
  PacketSummary,
  ReceivingModel,
  Roadway,
} from "./ask-types";
import CandidateTreatmentPanel from "./candidate-treatment-panel";
import HandoffPresentation from "./handoff-presentation";
import PacketPreview from "./packet-preview";
import styles from "./ask.module.css";

type CaseChoice = { id: string; objective: string; status: string };
type Stage = 1 | 2 | 3 | 4;

const budgets = [400, 800, 1600] as const;
const stages: Array<{ id: Stage; label: string; detail: string }> = [
  { id: 1, label: "Interpret", detail: "Confirm intent and roadway" },
  { id: 2, label: "Treat candidates", detail: "Inspect Use, Consider, Exclude" },
  { id: 3, label: "Compile packet", detail: "Save bounded immutable context" },
  { id: 4, label: "Handoff and receipt", detail: "Separate request, context, answer" },
];

function endpoint(projectId: string, suffix: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;
}

function fullFailure(message: string, saved = false) {
  return `${message} ${saved
    ? "The canonical failure record and all earlier records remain valid."
    : "Nothing new was presented as saved; earlier canonical records remain valid."} Review the state and retry only when the required condition is resolved.`;
}

export default function ReconstructionWorkspace({ projectId }: { projectId: string }) {
  const { session, authorizationHeaders } = useWriteSession();
  const [stage, setStage] = useState<Stage>(1);
  const [roadways, setRoadways] = useState<Roadway[]>([]);
  const [cases, setCases] = useState<CaseChoice[]>([]);
  const [models, setModels] = useState<ReceivingModel[]>([]);
  const [packets, setPackets] = useState<PacketSummary[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>([]);
  const [task, setTask] = useState("");
  const [requestedOutput, setRequestedOutput] = useState("");
  const [caseId, setCaseId] = useState("");
  const [budget, setBudget] = useState<number>(800);
  const [roadwayOverride, setRoadwayOverride] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [result, setResult] = useState<PacketResult | null>(null);
  const [receivingModel, setReceivingModel] = useState("");
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "unavailable">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(endpoint(projectId, "roadways"), { cache: "no-store" }),
      fetch(endpoint(projectId, "cases"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs/models"), { cache: "no-store" }),
      fetch(endpoint(projectId, "packets"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs"), { cache: "no-store" }),
    ])
      .then(async (responses) => {
        if (responses.some((response) => !response.ok)) {
          throw new Error("Canonical Ask records are unavailable.");
        }
        return Promise.all(responses.map((response) => response.json()));
      })
      .then((values) => {
        if (!active) return;
        const [roadwayValue, caseValue, modelValue, packetValue, handoffValue] = values as [
          { roadways: Roadway[] },
          { cases: CaseChoice[] },
          { models: ReceivingModel[] },
          { packets: PacketSummary[] },
          { handoffs: HandoffSummary[] },
        ];
        const productionModels = modelValue.models
          .filter((model) => model.production === true);
        setRoadways(roadwayValue.roadways);
        setCases(caseValue.cases);
        setModels(productionModels);
        setReceivingModel(productionModels[0]?.model || "");
        setPackets(packetValue.packets);
        setHandoffs(handoffValue.handoffs);
        setStatus("ready");
        const query = new URLSearchParams(window.location.search);
        const handoffId = query.get("handoff");
        const packetId = query.get("packet");
        if (handoffId) void openHandoff(handoffId, false);
        else if (packetId) void openPacket(packetId, false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(fullFailure(caught instanceof Error ? caught.message : "Canonical Ask is unavailable."));
        setStatus("unavailable");
      });
    return () => { active = false; };
    // The route component is keyed by projectId, so project switching remounts
    // all Ask-local state before this one-time canonical load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const canWrite = Boolean(session?.writeAuthorization.authorized);
  const working = status === "working";

  function historyUrl(kind: "packet" | "handoff", id: string) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set(kind, id);
    window.history.replaceState({}, "", url);
  }

  async function refreshHistory() {
    const [packetResponse, handoffResponse] = await Promise.all([
      fetch(endpoint(projectId, "packets"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs"), { cache: "no-store" }),
    ]);
    if (packetResponse.ok) {
      const value = await packetResponse.json() as { packets: PacketSummary[] };
      setPackets(value.packets);
    }
    if (handoffResponse.ok) {
      const value = await handoffResponse.json() as { handoffs: HandoffSummary[] };
      setHandoffs(value.handoffs);
    }
  }

  async function interpret(override = roadwayOverride) {
    setStatus("working");
    setError("");
    setNotice("");
    setPreview(null);
    setResult(null);
    setHandoff(null);
    setSelectedPacketId(null);
    setSelectedHandoffId(null);
    if (override !== roadwayOverride) setRoadwayOverride(override);
    const response = await fetch(endpoint(projectId, "reconstruction/interpret"), {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeaders() },
      body: JSON.stringify({
        task,
        requestedDecisionOrOutput: requestedOutput || undefined,
        caseId: caseId || undefined,
        roadwayOverride: override || undefined,
      }),
    });
    const value = await response.json().catch(() => ({ error: "Interpretation failed." })) as {
      error?: string;
      interpretation?: Interpretation;
    };
    if (!response.ok || !value.interpretation) {
      setError(fullFailure(value.error || "Interpretation failed."));
      setStatus("ready");
      return;
    }
    setInterpretation(value.interpretation);
    setRequestedOutput(value.interpretation.requestedDecisionOrOutput);
    setNotice(value.interpretation.materialAmbiguity
      ? "Material ambiguity stopped reconstruction before candidate treatment or packet creation."
      : "Interpretation is ready for Cody’s acceptance. No packet has been created.");
    setStage(1);
    setStatus("ready");
  }

  async function previewCandidates(nextBudget = budget) {
    if (!interpretation || interpretation.clarificationRequired) return;
    setStatus("working");
    setError("");
    setNotice("");
    const response = await fetch(endpoint(projectId, "reconstruction/candidates"), {
      method: "POST",
      headers: { "content-type": "application/json", ...authorizationHeaders() },
      body: JSON.stringify({
        task,
        requestedDecisionOrOutput: requestedOutput || undefined,
        caseId: caseId || undefined,
        roadwayOverride: roadwayOverride || undefined,
        tokenBudget: nextBudget,
      }),
    });
    const value = await response.json().catch(() => ({ error: "Candidate treatment failed." })) as (
      Partial<CandidatePreview> & { error?: string }
    );
    if (!response.ok || !value.interpretation || !value.treatmentSummary) {
      if (value.interpretation) setInterpretation(value.interpretation);
      setError(fullFailure(value.error || value.interpretation?.ambiguityReason || "Candidate treatment failed."));
      setStage(1);
      setStatus("ready");
      return;
    }
    setPreview(value as CandidatePreview);
    setInterpretation(value.interpretation);
    setStage(2);
    setNotice("Server-owned treatment is ready. No packet has been created or saved.");
    setStatus("ready");
  }

  async function changeBudget(nextBudget: number) {
    setBudget(nextBudget);
    setResult(null);
    setHandoff(null);
    setSelectedPacketId(null);
    setSelectedHandoffId(null);
    if (preview) await previewCandidates(nextBudget);
  }

  async function compile() {
    if (!preview || preview.interpretation.clarificationRequired) return;
    setStatus("working");
    setError("");
    setNotice("");
    setResult(null);
    setHandoff(null);
    const response = await fetch(endpoint(projectId, "packets"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `packet:${crypto.randomUUID()}`,
        ...authorizationHeaders(),
      },
      body: JSON.stringify({
        task,
        requestedDecisionOrOutput: requestedOutput || undefined,
        caseId: caseId || undefined,
        roadwayOverride: roadwayOverride || undefined,
        tokenBudget: budget,
      }),
    });
    const value = await response.json().catch(() => ({ error: "Packet compilation failed." })) as (
      Partial<PacketResult> & { error?: string; interpretation?: Interpretation }
    );
    if (response.status === 409 && value.interpretation) {
      setInterpretation(value.interpretation);
      setError(fullFailure(value.interpretation.ambiguityReason || "Roadway clarification is required."));
      setStage(1);
      setStatus("ready");
      return;
    }
    if (!value.packet || !value.receipt) {
      setError(fullFailure(value.error || "Packet compilation failed."));
      setStatus("ready");
      return;
    }
    const next = value as PacketResult;
    setResult(next);
    setInterpretation(next.packet.interpretation);
    setSelectedPacketId(next.packet.id);
    setSelectedHandoffId(null);
    setStage(3);
    historyUrl("packet", next.packet.id);
    await refreshHistory();
    if (!response.ok || next.packet.status !== "compiled" || next.packet.compilationError) {
      setError(fullFailure(
        next.packet.compilationError || value.error || "Packet compilation failed.",
        true,
      ));
    } else {
      setNotice("The exact saved packet and its receipt are immutable. Preview and raw data use the same snapshot.");
    }
    setStatus("ready");
  }

  async function sendToReceivingModel() {
    if (!result || result.packet.status !== "compiled" || result.packet.compilationError) return;
    const model = models.find((candidate) => candidate.model === receivingModel);
    if (!model) {
      setError(fullFailure("No supported production receiving model is selected."));
      return;
    }
    setStatus("working");
    setError("");
    setNotice("");
    const response = await fetch(endpoint(projectId, "handoffs"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `handoff:${crypto.randomUUID()}`,
        ...authorizationHeaders(),
      },
      body: JSON.stringify({
        packetId: result.packet.id,
        provider: model.provider,
        model: model.model,
        actorId: session?.actor.id || "cody",
      }),
    });
    const value = await response.json().catch(() => ({ error: "Receiving-model handoff failed." })) as (
      Partial<HandoffResult> & { error?: string }
    );
    if (value.handoff) {
      const next = value as HandoffResult;
      setHandoff(next);
      setSelectedHandoffId(next.handoff.id);
      setSelectedPacketId(next.handoff.packetId);
      historyUrl("handoff", next.handoff.id);
      await refreshHistory();
    }
    if (!response.ok) {
      setError(fullFailure(
        value.handoff?.failureReason || value.error || "Receiving-model handoff failed.",
        Boolean(value.handoff),
      ));
    } else {
      setNotice("The receiving-model answer and immutable handoff receipt were saved separately from Cody’s request and Atlas’s packet.");
    }
    setStatus("ready");
  }

  async function openPacket(packetId: string, updateUrl = true) {
    setStatus("working");
    setError("");
    setNotice("");
    const response = await fetch(endpoint(projectId, `packets/${encodeURIComponent(packetId)}`), {
      cache: "no-store",
    });
    const value = await response.json().catch(() => ({ error: "Packet unavailable." })) as (
      Partial<PacketResult> & { error?: string }
    );
    if (!response.ok || !value.packet || !value.receipt) {
      setError(fullFailure(value.error || "Packet unavailable or belongs to another project."));
      setStatus("ready");
      return;
    }
    const next = value as PacketResult;
    setResult(next);
    setHandoff(null);
    setTask(next.packet.task);
    setRequestedOutput(next.packet.interpretation.requestedDecisionOrOutput);
    setCaseId(next.packet.caseId || "");
    setBudget(next.packet.tokenBudget);
    setRoadwayOverride(next.packet.interpretation.userSelectedOverride
      ? next.packet.primaryRoadwayId
      : "");
    setInterpretation(next.packet.interpretation);
    setPreview(null);
    setSelectedPacketId(next.packet.id);
    setSelectedHandoffId(null);
    setStage(3);
    if (updateUrl) historyUrl("packet", next.packet.id);
    setNotice("Historical packet opened without recompilation.");
    setStatus("ready");
  }

  async function openHandoff(handoffId: string, updateUrl = true) {
    setStatus("working");
    setError("");
    setNotice("");
    const response = await fetch(endpoint(projectId, `handoffs/${encodeURIComponent(handoffId)}`), {
      cache: "no-store",
    });
    const value = await response.json().catch(() => ({ error: "Handoff unavailable." })) as (
      Partial<HandoffResult> & { error?: string }
    );
    if (!response.ok || !value.handoff || !value.packet || !value.packetReceipt) {
      setError(fullFailure(value.error || "Handoff unavailable or belongs to another project."));
      setStatus("ready");
      return;
    }
    const next = value as HandoffResult;
    setHandoff(next);
    setResult({
      packet: next.packet,
      items: next.packetItems,
      receipt: next.packetReceipt,
    });
    setTask(next.packet.task);
    setRequestedOutput(next.packet.interpretation.requestedDecisionOrOutput);
    setCaseId(next.packet.caseId || "");
    setBudget(next.packet.tokenBudget);
    setInterpretation(next.packet.interpretation);
    setPreview(null);
    setReceivingModel(next.handoff.model);
    setSelectedPacketId(next.packet.id);
    setSelectedHandoffId(next.handoff.id);
    setStage(4);
    if (updateUrl) historyUrl("handoff", next.handoff.id);
    setNotice("Historical handoff opened without retrying the provider or recompiling its packet.");
    setStatus("ready");
  }

  if (status === "loading") {
    return <section className={styles.loading}>Loading canonical roadways, cases, models, and history…</section>;
  }
  if (status === "unavailable" && !roadways.length) {
    return (
      <section className={styles.failureState} role="alert">
        <strong>Canonical state unavailable</strong>
        <p>{error}</p>
        <p>No fixture, seeded packet, model answer, or hidden persistence fallback was substituted.</p>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.mainColumn}>
        <nav className={styles.stageNav} aria-label="Ask with Atlas stages">
          {stages.map((item) => {
            const available = item.id === 1
              || (item.id === 2 && Boolean(preview))
              || (item.id === 3 && Boolean(preview || result))
              || (item.id === 4 && result?.packet.status === "compiled");
            return (
              <button
                aria-current={stage === item.id ? "step" : undefined}
                className={stage === item.id ? styles.activeStage : styles.stageButton}
                disabled={!available}
                key={item.id}
                onClick={() => setStage(item.id)}
                type="button"
              >
                <span>{item.id}</span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </button>
            );
          })}
        </nav>

        {error ? <div className={styles.failureBanner} role="alert">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

        {stage === 1 ? (
          <section className={styles.stagePanel} aria-labelledby="interpret-title">
            <div className={styles.sectionHeading}>
              <div>
                <span>Stage 1</span>
                <h2 id="interpret-title">Interpret Cody’s current task</h2>
              </div>
              <p>The literal request remains controlling. Atlas may clarify it, never replace it.</p>
            </div>
            <label className={styles.field}>
              Exact literal request
              <textarea
                onChange={(event) => setTask(event.target.value)}
                placeholder="Enter the legitimate current task. Do not repeat a mechanism merely to force retrieval."
                value={task}
              />
            </label>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                Requested decision or output
                <input
                  onChange={(event) => setRequestedOutput(event.target.value)}
                  placeholder="Atlas may infer this; Cody may correct it."
                  value={requestedOutput}
                />
              </label>
              <label className={styles.field}>
                Optional case scope
                <select onChange={(event) => setCaseId(event.target.value)} value={caseId}>
                  <option value="">Project scope only</option>
                  {cases.map((record) => (
                    <option key={record.id} value={record.id}>{record.objective}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Temporary roadway override
                <select onChange={(event) => setRoadwayOverride(event.target.value)} value={roadwayOverride}>
                  <option value="">Let Atlas interpret intent</option>
                  {roadways.map((roadway) => (
                    <option key={roadway.id} value={roadway.id}>{roadway.name} v{roadway.version}</option>
                  ))}
                </select>
              </label>
            </div>
            {!canWrite ? (
              <p className={styles.readOnly}>
                Read-only session. Enable canonical writes once in the application shell before interpretation and compilation.
              </p>
            ) : null}
            <button
              className={styles.primaryButton}
              disabled={!canWrite || !task.trim() || working}
              onClick={() => interpret()}
              type="button"
            >
              {working ? "Interpreting…" : interpretation ? "Re-run interpretation" : "Interpret task"}
            </button>

            {interpretation ? (
              <section className={styles.interpretation}>
                <header>
                  <div>
                    <span>{interpretation.materialAmbiguity ? "Clarification required" : "Primary roadway"}</span>
                    <h3>{interpretation.primaryRoadway?.name || "No roadway selected"}</h3>
                  </div>
                  <b>{interpretation.userSelectedOverride ? "Current-run override" : "Intent-selected"}</b>
                </header>
                <p>{interpretation.selectionReason}</p>
                <dl className={styles.metadataGrid}>
                  <div><dt>Literal request</dt><dd>{interpretation.literalRequest}</dd></div>
                  <div><dt>Requested output</dt><dd>{interpretation.requestedDecisionOrOutput}</dd></div>
                  <div><dt>Intent/mechanism</dt><dd>{interpretation.requiredReasoningMechanism}</dd></div>
                  <div><dt>Project</dt><dd>{interpretation.activeProjectId}</dd></div>
                  <div><dt>Case</dt><dd>{interpretation.caseId || "Project scope"}</dd></div>
                  <div><dt>Domain</dt><dd>{interpretation.domain}</dd></div>
                  <div><dt>Task type</dt><dd>{interpretation.taskOrMarketType}</dd></div>
                  <div><dt>Time sensitivity</dt><dd>{interpretation.timeSensitivity}</dd></div>
                  <div><dt>Scope</dt><dd>{interpretation.scope}</dd></div>
                  <div><dt>Supporting modules</dt><dd>{interpretation.supportingModules.join(", ") || "None"}</dd></div>
                  <div><dt>Required live state</dt><dd>{interpretation.requiredLiveState.join(", ") || "None"}</dd></div>
                  <div><dt>Shared meanings</dt><dd>{interpretation.relevantSharedMeanings.join(", ") || "None"}</dd></div>
                </dl>
                {interpretation.materialAmbiguity ? (
                  <div className={styles.ambiguity}>
                    <strong>{interpretation.ambiguityReason}</strong>
                    <p>Two candidate interpretations could materially change the packet. Select one before continuing.</p>
                    {interpretation.candidateInterpretations.map((candidate) => (
                      <button
                        className={styles.secondaryButton}
                        disabled={working}
                        key={candidate.roadwayId}
                        onClick={() => interpret(candidate.roadwayId)}
                        type="button"
                      >
                        <strong>Use {candidate.name} for this run</strong>
                        <span>{candidate.reason}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={styles.stickyControls}>
                    <button
                      className={styles.primaryButton}
                      disabled={working}
                      onClick={() => previewCandidates()}
                      type="button"
                    >
                      Accept interpretation and treat candidates
                    </button>
                  </div>
                )}
              </section>
            ) : null}
          </section>
        ) : null}

        {stage === 2 && preview ? (
          <CandidateTreatmentPanel
            onContinue={() => setStage(3)}
            preview={preview}
            projectId={projectId}
          />
        ) : null}

        {stage === 3 ? (
          result ? (
            <PacketPreview onContinue={() => setStage(4)} result={result} />
          ) : preview ? (
            <section className={styles.stagePanel} aria-labelledby="compile-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span>Stage 3</span>
                  <h2 id="compile-title">Compile bounded packet</h2>
                </div>
                <p>No packet exists until the canonical server saves the packet and receipt atomically.</p>
              </div>
              <div className={styles.budgetButtons} aria-label="Packet token budget">
                {budgets.map((value) => (
                  <button
                    aria-pressed={budget === value}
                    className={budget === value ? styles.activeBudget : styles.budgetButton}
                    disabled={working}
                    key={value}
                    onClick={() => void changeBudget(value)}
                    type="button"
                  >
                    <strong>{value.toLocaleString()}</strong>
                    <span>{value === 800 ? "Default" : "tokens"}</span>
                  </button>
                ))}
              </div>
              <div className={styles.compilationGrid}>
                <div><span>State</span><strong>{preview.status.replaceAll("_", " ")}</strong></div>
                <div><span>Selected budget</span><strong>{preview.tokenBudget}</strong></div>
                <div><span>Estimated safe minimum</span><strong>{preview.estimatedSafeMinimum ?? "Unknown"}</strong></div>
                <div><span>Estimated final size</span><strong>{preview.estimatedFinalSize ?? "Unknown"}</strong></div>
                <div><span>Required checks</span><strong>{preview.requiredChecks.length}</strong></div>
                <div><span>Protected corrections</span><strong>{preview.protectedCorrections.length}</strong></div>
                <div><span>Protected conflicts</span><strong>{preview.protectedConflicts.length}</strong></div>
                <div><span>Strongest challenge</span><strong>{preview.strongestChallenge ? "Retained" : "Not applicable"}</strong></div>
                <div><span>Live state</span><strong>{preview.freshness.safeToCompile ? "Available" : `Missing ${preview.freshness.missing.join(", ")}`}</strong></div>
                <div><span>Likely compression</span><strong>{preview.likelyCompression ? "Yes" : "No"}</strong></div>
              </div>
              {preview.importantExclusions.length ? (
                <details className={styles.advanced}>
                  <summary>Important exclusions before compilation</summary>
                  {preview.importantExclusions.map((item) => (
                    <p key={`${item.sourceType}:${item.sourceId}`}>{item.statement} — {item.reason}</p>
                  ))}
                </details>
              ) : null}
              {preview.status !== "ready" ? (
                <div className={styles.failureState}>
                  <strong>
                    {preview.status === "missing_required_state"
                      ? "Missing required state"
                      : "Unsafe under selected budget"}
                  </strong>
                  <p>
                    Compilation may save an honest failed packet and receipt. It will not expose partial unsafe content as success.
                  </p>
                </div>
              ) : null}
              <div className={styles.stickyControls}>
                <button
                  className={styles.primaryButton}
                  disabled={!canWrite || working}
                  onClick={compile}
                  type="button"
                >
                  {working
                    ? "Compiling…"
                    : preview.status === "ready"
                      ? "Compile and save immutable packet"
                      : "Record failed compilation honestly"}
                </button>
              </div>
            </section>
          ) : (
            <section className={styles.empty}>Interpret a task before Atlas reconstructs context.</section>
          )
        ) : null}

        {stage === 4 && result ? (
          <HandoffPresentation
            busy={working}
            canWrite={canWrite}
            handoff={handoff}
            models={models}
            onModelChange={setReceivingModel}
            onSend={sendToReceivingModel}
            packet={result}
            selectedModel={receivingModel}
          />
        ) : null}
      </section>

      <AskHistory
        handoffs={handoffs}
        onOpenHandoff={(id) => void openHandoff(id)}
        onOpenPacket={(id) => void openPacket(id)}
        packets={packets}
        selectedHandoffId={selectedHandoffId}
        selectedPacketId={selectedPacketId}
      />
    </div>
  );
}
