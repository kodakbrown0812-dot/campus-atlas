# Campus Atlas

Campus Atlas is a reasoning sidecar for long-running ChatGPT Projects. It preserves decisions, evidence, corrections, challenges, and promoted principles as connected, inspectable knowledge—then compiles the smallest useful context for future work.

**Campus Atlas is the product.** “AI Reasoning Rebar” describes the architecture underneath it. Amy Campus is the example workspace, and Sports Engine is the mature proof project inside that workspace.

## V4 Build Week proof

V4 keeps the governed learning loop and adds the missing everyday-use surface:

`Ask in normal language → Load project blueprint → Retrieve precedent + corrections → Compile a small handoff → Work in ChatGPT`

The judge path still demonstrates the complete durable-learning loop:

`Capture → Structure → Connect → Test → Promote → Retrieve`

The final step compares a context packet before and after a human-approved promotion. The claim is intentionally narrow: the demo proves that governed knowledge changes future context in an inspectable way. It does not claim that one example proves better prediction outcomes.

## Exact three-minute judge route

1. **0:00–0:15 — Problem.** Read the headline and supporting sentence: ChatGPT helps now; Atlas governs what deserves to affect next time.
2. **0:15–0:50 — Everyday use.** In **Ask Atlas**, leave the deGrom strikeout task and select **Build ChatGPT handoff**. Point out the Sports Engine V4 blueprint, three budgeted items, the pitcher-prop precedent, and the carried-forward failed innings assumption.
3. **0:50–1:05 — Inspectability.** Expand one retrieved item, show its inclusion reason and connection path, then open **AI Work Receipt**. Use **Copy for ChatGPT** to show that this output is useful immediately even before the connector is enabled.
4. **1:05–2:20 — Learning loop.** Select **See the Learning Loop**. Structure and approve the seeded thesis, record the 3–1 result, apply the scope revision, approve promotion, and show the before/after packet. Emphasize that the architecture changed future context—not merely a score.
5. **2:20–2:40 — Explanation layer.** Close the demo, open the Atlas, and select a typed edge to show the Connection Receipt and preserved lineage.
6. **2:40–3:00 — Project intelligence.** Open **Sports Engine** and show its blueprint and Capability Ledger. Finish with: Campus Atlas supplies governance; each project earns different capabilities.

The guided portion is designed to fit inside 90 seconds; the Atlas and Capability Ledger provide the remaining explanation.

## Architecture

### General Campus Atlas layer

- Projects and rooms
- Typed knowledge nodes and connections
- Exact, reconstructed, and inferred fidelity
- Evidence and challenge events
- Computed support ledgers
- Human-governed promotion
- Context Packet retrieval and exclusions
- Connection and AI Work Receipts
- D1-backed persistence and revision history

### Project-specific layer

Each project owns its blueprint and capabilities. Sports Engine adds research audits, probability and expected-value analysis, Lock Scores, explainable precedent retrieval, outcome post-mortems, confidence calibration, and principle promotion. These capabilities are not hardcoded as global Campus Atlas behavior.

### Governance boundary

The model proposes. Deterministic application logic validates input bounds, output schema, scope, persistence, event history, and promotion gates. A human approves consequential changes.

No hidden chain-of-thought is displayed. The AI Work Receipt shows structured proposals, deterministic checks, approvals, and rejections.

## Model integration

`POST /api/structure` uses the OpenAI Responses API with model `gpt-5.6` and a strict JSON schema when `OPENAI_API_KEY` is configured in the hosted environment.

Without a runtime API key, the same endpoint returns an explicitly labeled seeded demonstration proposal so the judge path remains replayable. The receipt never mislabels fallback output as a live model call.

## Using Campus Atlas with ChatGPT today

V4 supports two paths:

1. **Immediate handoff:** build a packet in the app and use **Copy for ChatGPT**. This works with the current owner-only deployment.
2. **Connected app:** connect the Site's HTTPS `/mcp` endpoint in ChatGPT developer mode after the endpoint is made reachable through a public or authenticated connector-safe access policy.

The MCP server implements initialize, tool discovery, and tool calls. It exposes six focused tools:

- `atlas_build_context_packet` — read; returns the smallest useful context with inclusion and exclusion reasons.
- `atlas_get_project_blueprint` — read; returns project rules and earned capabilities.
- `atlas_retrieve_precedents` — read; returns approved precedent with evidence paths.
- `atlas_get_receipt` — read; inspects preserved external action receipts.
- `atlas_capture_candidate` — write; creates proposed knowledge only.
- `atlas_record_outcome` — write; creates a reality evidence event only.

Every tool declares read/write, open-world, and destructive annotations. Writes require idempotency keys and never promote knowledge. External writes fail closed when `CAMPUS_ATLAS_ACTION_KEY` is absent and require that bearer token when it is configured. `GET /api/security` reports the protection mode without returning the secret.

An OpenAPI 3.1 fallback is available at `/openapi.json` for GPT Actions or other compatible clients. The privacy disclosure lives at `/privacy`.

The production Site remains owner-restricted until its audience is explicitly changed. A public-demo boundary is available through `CAMPUS_ATLAS_PUBLIC_DEMO=true`: public visitors receive seeded demonstration knowledge only, `/api/state` never reads or writes the private D1 workspace, Context Packet reads do not create D1 history, and interactive changes persist in that visitor's browser storage. Connector candidate/outcome writes remain separately bearer-protected.

## Persistence

In private-workspace mode, Campus state is stored in Cloudflare D1 through `GET /api/state` and `POST /api/state`. Captures, reviews, promotions, typed connections, packets, and AI Work Receipts survive refresh. State writes merge known UI fields so connector receipts and packet history are not erased by later browser saves.

In public-demo mode, private D1 state is never returned and hosted state writes return `403`. The same interactions survive refresh through device-local browser storage. The interface labels this mode **Public demo · device-local** and never implies that those changes entered the private workspace. Temporary Local Context remains inside its packet unless the visitor explicitly captures it as candidate knowledge on that device.

## Sample data

Amy Campus contains seeded examples from Headquarters, Sports Engine, Health + Training, Lessons Division, Human Systems Lab, and Finance. Thesis 001—England +1.5 and Under 4.5—is the golden-loop case because its loss requires the system to separate outcome correctness from process quality.

V4 also includes a clearly reconstructed pitcher-prop precedent set. It demonstrates that a new deGrom strikeout task can retrieve the promoted workload-stability rule and carry forward the failed pitch-count/innings assumption without pretending the historical case predicts today's result.

Use **Reset Demo** to restore the seeded starting state.

## What existed before V2.2

The previous version already included the premium Campus Atlas visual system, the Amy Campus workspace, project cards, left-side project navigation, a central graph, a node inspector, a Promotion Queue, Local Context in Context Packets, Knowledge Review actions, basic persistence, and the Sports Engine project page.

## What Codex added during Build Week

- A homepage **See the Learning Loop** CTA
- A replayable six-stage judge experience
- Structured capture proposal and AI Work Receipt endpoint
- Deterministic capture validation
- Explicit before/after Context Packet comparison
- Reality events and separate outcome/process grading
- Review-event-driven promotion eligibility
- Human-approved promotion with typed edges
- Downstream retrieval proof and graph pulse
- Connection Receipts
- Context packet budgets and richer provenance metadata
- Sports Engine Capability Ledger
- Visible save state and persistence verification
- Functional reset and clearer non-dead actions
- Automated endpoint validation tests

### V4 additions

- Replaced passive scroll-label navigation with **Ask Atlas**, **Review Inbox**, **Explore Atlas**, and **Sports Engine** actions.
- Added a conversation-first ChatGPT handoff that makes Context Packets useful before exposing their internal anatomy.
- Added Local Context as a small optional, temporary layer instead of a required knowledge-entry form.
- Added ranked retrieval with exact inclusion reasons, exclusions, source fidelity, connection paths, packet budgets, and a compiled ChatGPT payload.
- Added the pitcher-prop precedent and workload-stability principle needed for a genuinely useful strikeout-task demonstration.
- Added a complete MCP server, six governed tool schemas, OpenAPI fallback, privacy page, idempotent writes, and persistent action receipts.
- Added copy-to-ChatGPT with a manual fallback when clipboard access is unavailable.
- Preserved the Atlas graph, promotion lineage, guided learning loop, Amy Campus workspace, and Sports Engine Capability Ledger.
- Added an implementation audit at `docs/V4_AUDIT.md` and expanded automated coverage to seven passing tests.

## Local development

Requirements:

- Node.js `>=22.13.0`
- Linux tooling used by the Sites build scripts

Common commands:

```bash
npm run dev
npm run lint
npm test
```

The hosted Sites project owns its D1 binding. A live model call additionally requires the `OPENAI_API_KEY` runtime secret. Before exposing write tools publicly, set `CAMPUS_ATLAS_ACTION_KEY` and use a connector-safe authentication policy.

## Acceptance coverage

- Captures persist after refresh.
- Temporary Local Context does not automatically become durable.
- Reviews create events, typed connections, ledger changes, and history entries.
- Scores are computed from evidence events.
- Promotion requires an explicit click.
- Promoted nodes retain complete lineage.
- Packet items explain inclusion, exclusion, provenance, scope, confidence, fidelity, and connection path.
- The after packet visibly changes because of the approved promotion.
- Sports-specific capability rules remain inside Sports Engine.
- Amy Campus is labeled as an example workspace.
- Context packets persist and retain their receipts.
- MCP tool discovery returns six tools with explicit safety annotations.
- ChatGPT writes are idempotent and remain proposed/evidence state.
- OpenAPI and privacy endpoints are present.
- Public-demo requests cannot read or mutate private D1 state.
- Public-demo packets use seeded knowledge and do not create hosted retrieval history.
- Public interactions persist only on the visitor's device and are labeled accordingly.
