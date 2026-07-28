type Proposal = {
  claim: string;
  evidence: string[];
  counterEvidence: string[];
  assumptions: string[];
  missingInformation: string[];
  source: string;
  confidence: number;
  truthClass: "Observed" | "Claimed" | "Predicted" | "Corrected";
  scope: string;
  projectOfOrigin: string;
  fidelity: "Exact" | "Reconstructed" | "Inferred";
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["claim", "evidence", "counterEvidence", "assumptions", "missingInformation", "source", "confidence", "truthClass", "scope", "projectOfOrigin", "fidelity"],
  properties: {
    claim: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    counterEvidence: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    source: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    truthClass: { type: "string", enum: ["Observed", "Claimed", "Predicted", "Corrected"] },
    scope: { type: "string" },
    projectOfOrigin: { type: "string" },
    fidelity: { type: "string", enum: ["Exact", "Reconstructed", "Inferred"] },
  },
} as const;

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && (content as { type?: unknown }).type === "output_text" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text;
    }
  }
  return null;
}

function validateProposal(value: unknown): value is Proposal {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.claim === "string" && item.claim.length > 8
    && Array.isArray(item.evidence) && item.evidence.every((entry) => typeof entry === "string")
    && Array.isArray(item.counterEvidence) && item.counterEvidence.every((entry) => typeof entry === "string")
    && Array.isArray(item.assumptions) && item.assumptions.every((entry) => typeof entry === "string")
    && Array.isArray(item.missingInformation) && item.missingInformation.every((entry) => typeof entry === "string")
    && typeof item.source === "string" && typeof item.scope === "string" && typeof item.projectOfOrigin === "string"
    && typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 100
    && ["Observed", "Claimed", "Predicted", "Corrected"].includes(String(item.truthClass))
    && ["Exact", "Reconstructed", "Inferred"].includes(String(item.fidelity));
}

export async function handleStructure(request: Request, apiKey?: string) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  let body: { input?: unknown; project?: unknown; operation?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const project = typeof body.project === "string" ? body.project.trim() : "Sports Engine";
  const operation = typeof body.operation === "string" ? body.operation.trim() : "Structure knowledge capture";
  if (input.length < 20 || input.length > 8_000) return Response.json({ error: "Capture must contain between 20 and 8,000 characters." }, { status: 400 });

  const checks = ["Input bounds validated", "Project scope preserved", "No promotion authority granted"];
  if (!apiKey) {
    return Response.json({
      error: "Live structuring is unavailable because OPENAI_API_KEY is not configured.",
      mode: "unavailable",
      proposal: null,
      findingCreated: false,
      sourcePersistedByThisEndpoint: false,
      checks,
    }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6",
          input: [
            { role: "system", content: "Structure the user's sports forecasting thesis into an inspectable knowledge proposal. Preserve uncertainty. Do not add unsupported statistics. Distinguish evidence, counter-evidence, assumptions, and missing information. This proposal has no authority until a human approves it." },
            { role: "user", content: `Project: ${project}\nExact capture:\n${input}` },
          ],
          text: { format: { type: "json_schema", name: "campus_atlas_capture", strict: true, schema } },
        }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}`);
    const payload = await response.json();
    const output = extractOutputText(payload);
    if (!output) throw new Error("OpenAI response contained no structured output");
    const proposal = JSON.parse(output) as unknown;
    if (!validateProposal(proposal)) throw new Error("Structured output failed deterministic validation");
    checks.push("Structured schema validated", "GPT-5.6 structured output accepted");
    return Response.json({
      proposal,
      receipt: {
        id: `air-${crypto.randomUUID()}`,
        operation,
        model: "gpt-5.6",
        mode: "live_gpt",
        proposedAt: new Date().toISOString(),
        checks,
        approved: [],
        rejected: [],
        inputSummary: input.slice(0, 180),
      },
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Live structuring failed.",
      mode: "failed",
      proposal: null,
      findingCreated: false,
      sourcePersistedByThisEndpoint: false,
      checks,
    }, { status: 502 });
  }
}
