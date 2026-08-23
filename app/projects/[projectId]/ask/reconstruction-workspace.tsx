"use client";

import { FormEvent, useEffect, useState } from "react";
import { useStewardTask } from "../../../components/steward-task";
import { useWriteSession } from "../../../components/write-session";
import AskHistory from "./ask-history";
import {
  HandoffResult,
  HandoffSummary,
  PacketResult,
  PacketSummary,
  PreparedContext,
  ReceivingModel,
  ReconstructionRunResult,
  Roadway,
} from "./ask-types";
import HandoffPresentation from "./handoff-presentation";
import ContextAidPresentation from "./context-aid-presentation";
import PacketPreview from "./packet-preview";
import styles from "./ask.module.css";

type CaseChoice = { id: string; objective: string; status: string };
type ProjectChoice = { id: string; name: string };
type ViewState = "idle" | "preparing" | "clarification" | "not_needed" | "light" | "ready" | "failure";

const budgets = [400, 800, 1600] as const;

function endpoint(projectId: string, suffix: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/${suffix}`;
}

function preparedFromPacket(projectId: string, result: PacketResult): PreparedContext {
  const packetPath = endpoint(projectId, `packets/${encodeURIComponent(result.packet.id)}`);
  return {
    projectId,
    literalTask: result.packet.task,
    packet: result.packet,
    receipt: result.receipt,
    links: {
      packet: packetPath,
      receipt: `${packetPath}/receipt`,
      inspect: `/projects/${encodeURIComponent(projectId)}/inspect/packets/${encodeURIComponent(result.packet.id)}`,
    },
    raw: result,
  };
}

export default function ReconstructionWorkspace({ projectId }: { projectId: string }) {
  const { session, authorizationHeaders } = useWriteSession();
  const { pendingTask, clearTask } = useStewardTask();
  const [roadways, setRoadways] = useState<Roadway[]>([]);
  const [projectName, setProjectName] = useState(projectId);
  const [cases, setCases] = useState<CaseChoice[]>([]);
  const [models, setModels] = useState<ReceivingModel[]>([]);
  const [packets, setPackets] = useState<PacketSummary[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffSummary[]>([]);
  const [task, setTask] = useState(() => (
    pendingTask?.projectId === projectId ? pendingTask.literalTask : ""
  ));
  const [requestedOutput, setRequestedOutput] = useState("");
  const [caseId, setCaseId] = useState(() => (
    pendingTask?.projectId === projectId ? pendingTask.caseId || "" : ""
  ));
  const [budget, setBudget] = useState<number>(800);
  const [roadwayOverride, setRoadwayOverride] = useState("");
  const [receivingModel, setReceivingModel] = useState("");
  const [view, setView] = useState<ViewState>("idle");
  const [run, setRun] = useState<ReconstructionRunResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedContext | null>(null);
  const [handoff, setHandoff] = useState<HandoffResult | null>(null);
  const [fullTransferRequested, setFullTransferRequested] = useState(false);
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/v1/projects", { cache: "no-store" }),
      fetch(endpoint(projectId, "roadways"), { cache: "no-store" }),
      fetch(endpoint(projectId, "cases"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs/models"), { cache: "no-store" }),
      fetch(endpoint(projectId, "packets"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs"), { cache: "no-store" }),
    ])
      .then(async (responses) => {
        if (responses.some((response) => !response.ok)) throw new Error("Canonical Steward records are unavailable.");
        return Promise.all(responses.map((response) => response.json()));
      })
      .then((values) => {
        if (!active) return;
        const [projectValue, roadwayValue, caseValue, modelValue, packetValue, handoffValue] = values as [
          { projects: ProjectChoice[] },
          { roadways: Roadway[] },
          { cases: CaseChoice[] },
          { models: ReceivingModel[] },
          { packets: PacketSummary[] },
          { handoffs: HandoffSummary[] },
        ];
        setProjectName(projectValue.projects.find((project) => project.id === projectId)?.name || projectId);
        const productionModels = modelValue.models.filter((model) => model.production === true);
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
        setError(caught instanceof Error ? caught.message : "Atlas Steward is unavailable.");
        setStatus("unavailable");
      });
    return () => { active = false; };
    // The route is keyed by projectId, so project switches remount all local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const canWrite = Boolean(session?.writeAuthorization.authorized);
  const working = view === "preparing";

  function historyUrl(kind: "packet" | "handoff", id: string) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set(kind, id);
    window.history.replaceState({}, "", url);
  }

  function clearHistoryUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url);
  }

  async function refreshHistory() {
    const [packetResponse, handoffResponse] = await Promise.all([
      fetch(endpoint(projectId, "packets"), { cache: "no-store" }),
      fetch(endpoint(projectId, "handoffs"), { cache: "no-store" }),
    ]);
    if (packetResponse.ok) setPackets(((await packetResponse.json()) as { packets: PacketSummary[] }).packets);
    if (handoffResponse.ok) setHandoffs(((await handoffResponse.json()) as { handoffs: HandoffSummary[] }).handoffs);
  }

  async function prepareContext(
    event?: FormEvent<HTMLFormElement>,
    override = roadwayOverride,
    prepareFullTransfer = false,
  ) {
    event?.preventDefault();
    if (!task.trim() || !canWrite) return;
    const fullTransfer = prepareFullTransfer || fullTransferRequested;
    if (prepareFullTransfer) setFullTransferRequested(true);
    clearTask(projectId);
    setView("preparing");
    setError("");
    setRun(null);
    setPrepared(null);
    setHandoff(null);
    setSelectedPacketId(null);
    setSelectedHandoffId(null);
    if (override !== roadwayOverride) setRoadwayOverride(override);
    try {
      const response = await fetch(endpoint(projectId, "reconstruction/run"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `steward:${crypto.randomUUID()}`,
          ...authorizationHeaders(),
        },
        body: JSON.stringify({
          task,
          ...(fullTransfer
            ? { requestedOutput: [requestedOutput.trim(), "Prepare a full room transfer."].filter(Boolean).join(" ") }
            : requestedOutput.trim() ? { requestedOutput } : {}),
          ...(caseId ? { caseId } : {}),
          ...(override ? { roadwayOverride: override } : {}),
          tokenBudget: budget,
        }),
      });
      const value = await response.json().catch(() => ({ error: "Context preparation failed." })) as (
        Partial<ReconstructionRunResult> & { error?: string }
      );
      if (value.status === "compiled" && value.packet && value.receipt && value.links && value.literalTask) {
        const complete = value as ReconstructionRunResult;
        const context: PreparedContext = {
          projectId,
          literalTask: complete.literalTask,
          packet: complete.packet!,
          receipt: complete.receipt!,
          links: complete.links!,
          raw: complete,
        };
        setRun(complete);
        setPrepared(context);
        setSelectedPacketId(context.packet.id);
        setView("ready");
        historyUrl("packet", context.packet.id);
        await refreshHistory();
        return;
      }
      if (value.status === "clarification_required") {
        setRun(value as ReconstructionRunResult);
        setView("clarification");
        return;
      }
      if (value.status === "atlas_not_needed") {
        setRun(value as ReconstructionRunResult);
        setView("not_needed");
        return;
      }
      if (value.status === "light_continuity_only") {
        setRun(value as ReconstructionRunResult);
        setView("light");
        return;
      }
      setRun(value.status ? value as ReconstructionRunResult : null);
      setError(value.error || value.need?.explanation || "Atlas could not prepare context safely.");
      setView("failure");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Atlas could not prepare context safely.");
      setView("failure");
    }
  }

  async function sendToReceivingModel() {
    if (!prepared || prepared.packet.status !== "compiled") return;
    const model = models.find((candidate) => candidate.model === receivingModel);
    if (!model) {
      setError("No supported production receiving model is selected.");
      return;
    }
    setError("");
    const response = await fetch(endpoint(projectId, "handoffs"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `handoff:${crypto.randomUUID()}`,
        ...authorizationHeaders(),
      },
      body: JSON.stringify({
        packetId: prepared.packet.id,
        provider: model.provider,
        model: model.model,
        actorId: session?.actor.id || "cody",
      }),
    });
    const value = await response.json().catch(() => ({ error: "Provider handoff failed." })) as (
      Partial<HandoffResult> & { error?: string }
    );
    if (value.handoff) {
      const next = value as HandoffResult;
      setHandoff(next);
      setSelectedHandoffId(next.handoff.id);
      historyUrl("handoff", next.handoff.id);
      await refreshHistory();
    }
    if (!response.ok) setError(value.handoff?.failureReason || value.error || "Provider handoff failed.");
  }

  async function openPacket(packetId: string, updateUrl = true) {
    setError("");
    const response = await fetch(endpoint(projectId, `packets/${encodeURIComponent(packetId)}`), { cache: "no-store" });
    const value = await response.json().catch(() => ({ error: "Packet unavailable." })) as (
      Partial<PacketResult> & { error?: string }
    );
    if (!response.ok || !value.packet || !value.receipt) {
      setError(value.error || "Packet unavailable or belongs to another project.");
      setView("failure");
      return;
    }
    const next = value as PacketResult;
    const context = preparedFromPacket(projectId, next);
    setPrepared(context);
    setTask(context.literalTask);
    setRequestedOutput(next.packet.interpretation.requestedDecisionOrOutput);
    setCaseId(next.packet.caseId || "");
    setBudget(next.packet.tokenBudget);
    setHandoff(null);
    setSelectedPacketId(next.packet.id);
    setSelectedHandoffId(null);
    setView(next.packet.status === "compiled" && !next.packet.compilationError ? "ready" : "failure");
    if (next.packet.compilationError) setError(next.packet.compilationError);
    if (updateUrl) historyUrl("packet", next.packet.id);
  }

  async function openHandoff(handoffId: string, updateUrl = true) {
    setError("");
    const response = await fetch(endpoint(projectId, `handoffs/${encodeURIComponent(handoffId)}`), { cache: "no-store" });
    const value = await response.json().catch(() => ({ error: "Handoff unavailable." })) as (
      Partial<HandoffResult> & { error?: string }
    );
    if (!response.ok || !value.handoff || !value.packet || !value.packetReceipt) {
      setError(value.error || "Handoff unavailable or belongs to another project.");
      setView("failure");
      return;
    }
    const next = value as HandoffResult;
    const packetResult: PacketResult = { packet: next.packet, items: next.packetItems, receipt: next.packetReceipt };
    setPrepared(preparedFromPacket(projectId, packetResult));
    setTask(next.packet.task);
    setRequestedOutput(next.packet.interpretation.requestedDecisionOrOutput);
    setCaseId(next.packet.caseId || "");
    setBudget(next.packet.tokenBudget);
    setReceivingModel(next.handoff.model);
    setHandoff(next);
    setSelectedPacketId(next.packet.id);
    setSelectedHandoffId(next.handoff.id);
    setView("ready");
    if (updateUrl) historyUrl("handoff", next.handoff.id);
  }

  function resetPreparation() {
    setRun(null);
    setPrepared(null);
    setHandoff(null);
    setError("");
    setSelectedPacketId(null);
    setSelectedHandoffId(null);
    setFullTransferRequested(false);
    setView("idle");
    clearHistoryUrl();
  }

  if (status === "loading") {
    return <section className={styles.loading}>Loading project scope and Steward controls…</section>;
  }
  if (status === "unavailable") {
    return (
      <section className={styles.failureState} role="alert">
        <strong>Could not prepare safely</strong>
        <p>{error}</p>
        <p>No fixture, seeded packet, or hidden fallback was substituted.</p>
      </section>
    );
  }

  const advancedControls = (
    <details className={styles.advancedControls}>
      <summary>Advanced controls</summary>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Requested output
          <input onChange={(event) => setRequestedOutput(event.target.value)} placeholder="Atlas may infer this." value={requestedOutput} />
        </label>
        <label className={styles.field}>
          Optional case scope
          <select onChange={(event) => setCaseId(event.target.value)} value={caseId}>
            <option value="">Project scope only</option>
            {cases.map((record) => <option key={record.id} value={record.id}>{record.objective}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Advanced retrieval path
          <select onChange={(event) => setRoadwayOverride(event.target.value)} value={roadwayOverride}>
            <option value="">Let Atlas interpret the task</option>
            {roadways.map((roadway) => <option key={roadway.id} value={roadway.id}>{roadway.name} v{roadway.version}</option>)}
          </select>
        </label>
        <fieldset className={styles.packetSize}>
          <legend>Estimated tokens</legend>
          {budgets.map((value) => (
            <button aria-pressed={budget === value} key={value} onClick={() => setBudget(value)} type="button">
              {value}{value === 800 ? " · Default" : ""}
            </button>
          ))}
        </fieldset>
        <label className={styles.field}>
          Provider for “Send another way”
          <select onChange={(event) => setReceivingModel(event.target.value)} value={receivingModel}>
            {models.map((model) => <option key={`${model.provider}:${model.model}`} value={model.model}>{model.provider} · {model.model}</option>)}
          </select>
        </label>
      </div>
      <details className={styles.historyDisclosure}>
        <summary>Packet and handoff history</summary>
        <AskHistory
          handoffs={handoffs}
          onOpenHandoff={(id) => void openHandoff(id)}
          onOpenPacket={(id) => void openPacket(id)}
          packets={packets}
          selectedHandoffId={selectedHandoffId}
          selectedPacketId={selectedPacketId}
        />
      </details>
    </details>
  );

  return (
    <div className={styles.workspace}>
      {view === "idle" ? (
        <form className={styles.stewardForm} onSubmit={(event) => void prepareContext(event)}>
          <label className={styles.field} htmlFor="steward-task">
            What are you trying to continue?
            <textarea
              id="steward-task"
              onChange={(event) => setTask(event.target.value)}
              placeholder="Describe the decision, task, or project state the model needs."
              value={task}
            />
          </label>
          {advancedControls}
          {!canWrite ? <p className={styles.readOnly}>Enable canonical writes in the application shell before preparing context.</p> : null}
          <button className={styles.primaryButton} disabled={!canWrite || !task.trim()} type="submit">Prepare context</button>
        </form>
      ) : null}

      {view === "preparing" ? (
        <section className={styles.preparingState} role="status">
          <span>Preparing context</span>
          <h2>Finding and governing the prior work this task needs.</h2>
          <p>Atlas is checking relevance, authority, scope, freshness, and packet safety.</p>
          <i aria-hidden="true" />
        </section>
      ) : null}

      {view === "clarification" && run ? (
        <section className={styles.outcomeState}>
          <span>Needs clarification</span>
          <h2>One material choice is required.</h2>
          <blockquote>{run.literalTask}</blockquote>
          <p>{run.need.explanation}</p>
          <div className={styles.clarificationChoices}>
            {(run.roadway.candidates || []).map((candidate) => (
              <button disabled={working} key={candidate.roadwayId} onClick={() => void prepareContext(undefined, candidate.roadwayId, fullTransferRequested)} type="button">
                <strong>{candidate.name}</strong><span>{candidate.reason}</span>
              </button>
            ))}
          </div>
          <button className={styles.textAction} onClick={resetPreparation} type="button">Return to task</button>
        </section>
      ) : null}

      {view === "not_needed" && run ? (
        <section className={styles.outcomeState}>
          <span>No applicable context</span>
          <h2>Atlas found no applicable governed context to supply.</h2>
          <p>{run.need.explanation}</p>
          <strong>No capsule, packet, or packet receipt was created.</strong>
          <button className={styles.textAction} onClick={resetPreparation} type="button">Prepare a different task</button>
        </section>
      ) : null}

      {view === "light" && run?.capsule ? (
        <>
          <ContextAidPresentation
            capsule={run.capsule}
            onPrepareFullTransfer={() => void prepareContext(undefined, roadwayOverride, true)}
          />
          <button className={styles.textAction} onClick={resetPreparation} type="button">Prepare another task</button>
        </>
      ) : null}

      {view === "light" && run && !run.capsule ? (
        <section className={styles.outcomeState} role="alert">
          <span>Could not prepare safely</span>
          <h2>Atlas found a bounded continuity signal but could not produce a governed context aid.</h2>
          <p>{run.need.explanation}</p>
          <strong>No capsule, packet, or packet receipt was created.</strong>
          <button className={styles.textAction} onClick={resetPreparation} type="button">Review task and controls</button>
        </section>
      ) : null}

      {view === "failure" ? (
        <section className={styles.outcomeState} role="alert">
          <span>Could not prepare safely</span>
          <h2>Atlas did not produce a valid context packet.</h2>
          <p>{error}</p>
          {run?.preflight?.freshness.missing?.length ? <p>Missing current state: {run.preflight.freshness.missing.join(", ")}.</p> : null}
          <button className={styles.textAction} onClick={resetPreparation} type="button">Review task and controls</button>
        </section>
      ) : null}

      {view === "ready" && prepared ? (
        <>
          {error ? <div className={styles.failureBanner} role="alert">{error}</div> : null}
          <PacketPreview context={prepared} projectName={projectName} />
          <HandoffPresentation
            busy={working}
            canWrite={canWrite}
            context={prepared}
            handoff={handoff}
            key={prepared.packet.id}
            models={models}
            onModelChange={setReceivingModel}
            onSend={() => void sendToReceivingModel()}
            selectedModel={receivingModel}
          />
          <button className={styles.textAction} onClick={resetPreparation} type="button">Prepare another task</button>
        </>
      ) : null}
    </div>
  );
}
