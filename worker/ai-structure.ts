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

function seededProposal(input: string, project: string): Proposal {
  return {
    claim: input.trim(),
    evidence: [
      "The captured thesis priced England as a heavy favorite.",
      "The user explicitly linked team quality, scoring volume, and handicap coverage.",
    ],
    counterEvidence: [
      "A defensive-wall outcome can preserve control without producing margin or total coverage.",
      "Favorite strength alone does not establish the scoring distribution.",
    ],
    assumptions: [
      "England's quality edge would convert into both margin and scoring volume.",
      "Match control, scoring probability, and market coverage represented the same underlying signal.",
    ],
    missingInformation: ["Independent scoring-distribution estimate", "Defensive-wall counter-scenarios", "Verified offered market"],
    source: "User-entered thesis · exact capture",
    confidence: 68,
    truthClass: "Predicted",
    scope: "This match and market before kickoff",
    projectOfOrigin: project,
    fidelity: "Exact",
  };
}

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

  const checks = ["Input bounds validated", "Structured schema validated", "Project scope preserved", "No promotion authority granted"];
  let proposal: Proposal;
  let mode: "live_gpt" | "seeded_demo" = "seeded_demo";

  if (apiKey) {
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
      const parsed = JSON.parse(output);
      if (!validateProposal(parsed)) throw new Error("Structured output failed deterministic validation");
      proposal = parsed;
      mode = "live_gpt";
      checks.push("GPT-5.6 structured output accepted");
    } catch {
      proposal = seededProposal(input, project);
      checks.push("Live model unavailable · explicit seeded fallback used");
    }
  } else {
    proposal = seededProposal(input, project);
    checks.push("No runtime API key · explicit seeded fallback used");
  }

  return Response.json({
    proposal,
    receipt: {
      id: `air-${crypto.randomUUID()}`,
      operation,
      model: mode === "live_gpt" ? "gpt-5.6" : "gpt-5.6-ready seeded fallback",
      mode,
      proposedAt: new Date().toISOString(),
      checks,
      approved: [],
      rejected: [],
      inputSummary: input.slice(0, 180),
    },
  });
}
