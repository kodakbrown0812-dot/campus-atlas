"use client";

import { useEffect, useState } from "react";
import styles from "../conversations/conversation.module.css";

type Roadway = {
  id: string;
  versionId: string;
  slug: string;
  name: string;
  version: number;
  purpose: string;
  requiredChecks: string[];
  authorityState: string;
};

type Interpretation = {
  literalRequest: string;
  requestedDecisionOrOutput: string;
  domain: string;
  taskOrMarketType: string;
  timeSensitivity: string;
  scope: string;
  requiredReasoningMechanism: string;
  relevantSharedMeanings: string[];
  materialAmbiguity: boolean;
  clarificationRequired: boolean;
  ambiguityReason: string | null;
  primaryRoadway: Roadway | null;
  candidateInterpretations: Array<{ roadwayId: string; versionId: string; name: string; reason: string }>;
  supportingModules: string[];
  requiredLiveState: string[];
  selectionReason: string;
  userSelectedOverride: boolean;
};

type TreatmentItem = {
  sourceType: string;
  sourceId: string;
  sourceVersionId: string | null;
  statement: string;
  treatment: "Use" | "Consider" | "Exclude";
  representation: string;
  scope: string;
  authority: string;
  freshness: string;
  reason: string;
};

type PacketResult = {
  packet: {
    id: string;
    status: string;
    task: string;
    interpretation: Interpretation;
    tokenBudget: number;
    finalTokenCount: number;
    compiledContent: string;
    compilationError: string | null;
    priorComparablePacketId: string | null;
  };
  receipt: {
    id: string;
    selectedRoadwayReason: string;
    treatmentSummary: Record<"Use" | "Consider" | "Exclude", TreatmentItem[]>;
    governanceCauses: Array<{ governanceEventId: string; effect: string }>;
    freshness: { required: string[]; missing: string[]; safeToCompile: boolean };
    inferenceDisclosure: string;
    unresolvedConflicts: Array<{ sourceId: string; statement: string }>;
    exactPacketDifference: Array<Record<string, unknown>>;
  };
};

const budgets = [400, 800, 1600] as const;

export default function ReconstructionWorkspace({ projectId }: { projectId: string }) {
  const [roadways, setRoadways] = useState<Roadway[]>([]);
  const [task, setTask] = useState("");
  const [caseId, setCaseId] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [budget, setBudget] = useState<number>(800);
  const [roadwayOverride, setRoadwayOverride] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [result, setResult] = useState<PacketResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/roadways`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Canonical roadway registry unavailable.");
        return response.json() as Promise<{ roadways: Roadway[] }>;
      })
      .then((value) => {
        if (active) {
          setRoadways(value.roadways);
          setStatus("ready");
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Roadways unavailable.");
          setStatus("error");
        }
      });
    return () => { active = false; };
  }, [projectId]);

  async function interpret() {
    setStatus("working");
    setError("");
    setResult(null);
    const response = await fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reconstruction/interpret`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${actionKey}`,
        },
        body: JSON.stringify({
          task,
          caseId: caseId || undefined,
          roadwayOverride: roadwayOverride || undefined,
        }),
      },
    );
    const value = await response.json().catch(() => ({ error: "Interpretation failed." })) as {
      error?: string;
      interpretation?: Interpretation;
    };
    if (!response.ok || !value.interpretation) {
      setError(value.error || "Interpretation failed.");
      setStatus("ready");
      return;
    }
    setInterpretation(value.interpretation);
    setStatus("ready");
  }

  async function compile() {
    setStatus("working");
    setError("");
    setResult(null);
    const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/packets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${actionKey}`,
        "idempotency-key": `packet:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        task,
        caseId: caseId || undefined,
        roadwayOverride: roadwayOverride || undefined,
        tokenBudget: budget,
      }),
    });
    const value = await response.json().catch(() => ({ error: "Packet compilation failed." })) as {
      error?: string;
      interpretation?: Interpretation;
      packet?: PacketResult["packet"] | null;
      receipt?: PacketResult["receipt"] | null;
    };
    if (response.status === 409 && value.interpretation) {
      setInterpretation(value.interpretation);
      setError(value.interpretation.ambiguityReason || "Roadway clarification is required.");
      setStatus("ready");
      return;
    }
    if (!response.ok || !value.packet || !value.receipt) {
      setError(value.error || "Packet compilation failed.");
      setStatus("ready");
      return;
    }
    setResult({ packet: value.packet, receipt: value.receipt });
    setInterpretation(value.packet.interpretation);
    setStatus("ready");
  }

  if (status === "loading") return <section className={styles.panel}>Loading canonical roadways…</section>;
  if (status === "error" && !roadways.length) {
    return <section className={`${styles.panel} ${styles.error}`}>{error} No fixture was substituted.</section>;
  }

  return (
    <div className={styles.grid}>
      <section className={styles.transcript}>
        <article className={styles.panel}>
          <span className={styles.eyebrow}>1. Interpret current task</span>
          <label className={styles.label} htmlFor="atlas-task">Literal request</label>
          <textarea
            className={styles.textarea}
            id="atlas-task"
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe the current task without repeating a mechanism merely to force retrieval."
            value={task}
          />
          <label className={styles.label} htmlFor="atlas-case">Optional canonical case ID</label>
          <input className={styles.input} id="atlas-case" onChange={(event) => setCaseId(event.target.value)} value={caseId} />
          <label className={styles.label} htmlFor="atlas-key">Write authorization</label>
          <input className={styles.input} id="atlas-key" onChange={(event) => setActionKey(event.target.value)} type="password" value={actionKey} />
          <div className={styles.actions}>
            <button className={styles.button} disabled={!task.trim() || status === "working"} onClick={interpret} type="button">
              Interpret
            </button>
            <button className={styles.button} disabled={!task.trim() || status === "working"} onClick={compile} type="button">
              Compile packet
            </button>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
        </article>

        {interpretation ? (
          <article className={styles.panel}>
            <span className={styles.eyebrow}>Interpreted intent</span>
            <h2>{interpretation.primaryRoadway?.name || "Clarification required"}</h2>
            <p>{interpretation.selectionReason}</p>
            <div className={styles.source}>
              <span>Output: {interpretation.requestedDecisionOrOutput}</span>
              <span>Mechanism: {interpretation.requiredReasoningMechanism}</span>
              <span>Domain: {interpretation.domain} · {interpretation.taskOrMarketType}</span>
              <span>Scope: {interpretation.scope} · time: {interpretation.timeSensitivity}</span>
              <span>Required state: {interpretation.requiredLiveState.join(", ") || "none"}</span>
            </div>
            {interpretation.materialAmbiguity ? (
              <div className={styles.list}>
                <strong>Material ambiguity is blocking compilation.</strong>
                {interpretation.candidateInterpretations.map((candidate) => (
                  <button
                    className={styles.button}
                    key={candidate.roadwayId}
                    onClick={() => setRoadwayOverride(candidate.roadwayId)}
                    type="button"
                  >
                    Use {candidate.name} for this run
                  </button>
                ))}
              </div>
            ) : null}
            {roadwayOverride ? <p className={styles.muted}>Current-run override selected. The registry is unchanged.</p> : null}
          </article>
        ) : null}

        {result ? (
          <>
            {(["Use", "Consider", "Exclude"] as const).map((treatment) => (
              <article className={styles.panel} key={treatment}>
                <span className={styles.eyebrow}>{treatment}</span>
                <div className={styles.list}>
                  {(result.receipt.treatmentSummary[treatment] || []).map((item) => (
                    <div className={styles.event} key={`${item.sourceType}:${item.sourceId}`}>
                      <strong>{item.statement}</strong>
                      <p>{item.reason}</p>
                      <small>{item.sourceType} · {item.representation} · {item.scope} · {item.authority} · {item.freshness}</small>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            <article className={styles.panel}>
              <span className={styles.eyebrow}>Immutable packet</span>
              <h2>{result.packet.id}</h2>
              <p>{result.packet.status} · {result.packet.finalTokenCount}/{result.packet.tokenBudget} tokens</p>
              {result.packet.compilationError ? <p className={styles.error}>{result.packet.compilationError}</p> : null}
              <pre className={styles.raw}>{result.packet.compiledContent}</pre>
            </article>
            <article className={styles.panel}>
              <span className={styles.eyebrow}>Causal receipt</span>
              <p>{result.receipt.selectedRoadwayReason}</p>
              <p className={styles.muted}>{result.receipt.inferenceDisclosure}</p>
              <div className={styles.source}>
                <span>Receipt: {result.receipt.id}</span>
                <span>Prior comparable packet: {result.packet.priorComparablePacketId || "none"}</span>
                <span>Exact changes: {result.receipt.exactPacketDifference.length}</span>
                <span>Governance causes: {result.receipt.governanceCauses.length}</span>
              </div>
              {result.receipt.governanceCauses.map((cause) => <p key={cause.governanceEventId}>{cause.effect}</p>)}
              <pre className={styles.raw}>{JSON.stringify(result.receipt.exactPacketDifference, null, 2)}</pre>
            </article>
          </>
        ) : null}
      </section>

      <aside className={styles.sidebar}>
        <section className={styles.panel}>
          <span className={styles.eyebrow}>Token budget</span>
          <select className={styles.select} onChange={(event) => setBudget(Number(event.target.value))} value={budget}>
            {budgets.map((value) => <option key={value} value={value}>{value.toLocaleString()} tokens</option>)}
          </select>
        </section>
        <section className={styles.panel}>
          <span className={styles.eyebrow}>Frozen registry</span>
          {roadways.map((roadway) => (
            <div className={styles.case} key={roadway.id}>
              <strong>{roadway.name} v{roadway.version}</strong>
              <p>{roadway.purpose}</p>
              <small>{roadway.authorityState}</small>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
