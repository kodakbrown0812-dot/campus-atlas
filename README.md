# Campus Atlas

Campus Atlas is a reasoning sidecar for long-running ChatGPT Projects. It preserves decisions, evidence, corrections, challenges, and promoted principles as connected, inspectable knowledge—then compiles the smallest useful context for future work.

**Campus Atlas is the product.** “AI Reasoning Rebar” describes the architecture underneath it. Amy Campus is the example workspace, and Sports Engine is the mature proof project inside that workspace.

## Build Week proof

The V2.2 judge path demonstrates one complete loop:

`Capture → Structure → Connect → Test → Promote → Retrieve`

The final step compares a context packet before and after a human-approved promotion. The claim is intentionally narrow: the demo proves that governed knowledge changes future context in an inspectable way. It does not claim that one example proves better prediction outcomes.

## Three-minute demo route

1. Open the homepage and state the problem: ChatGPT helps people think now; Campus Atlas helps their projects build on what happened before.
2. Select **See the Learning Loop**.
3. Structure the seeded Sports Engine thesis. Open the **AI Work Receipt** if time permits, then approve the proposal as an Observation.
4. Inspect the **before** Context Packet. Point out that the format lesson exists but is excluded because it has an unresolved challenge and no retrieval authority.
5. Record the 3–1 outcome and post-mortem. Emphasize that result quality and reasoning quality are graded separately.
6. Apply the Knowledge Review. The action creates a preserved event, typed edge, ledger update, and history entry; there is no direct score control.
7. Approve promotion to **Validated Principle**.
8. Show the **after** packet. The newly promoted principle now appears with its constraint and exact lineage.
9. Close into the changed Atlas and open a **Connection Receipt** to show why an edge exists.
10. Open Sports Engine and show its project-specific **Capability Ledger**.

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

## Persistence

Campus state is stored in Cloudflare D1 through `GET /api/state` and `POST /api/state`. Captures, reviews, promotions, typed connections, packets, and AI Work Receipts survive refresh. Temporary Local Context remains inside its packet unless the user explicitly chooses **Capture as Candidate Knowledge**.

## Sample data

Amy Campus contains seeded examples from Headquarters, Sports Engine, Health + Training, Lessons Division, Human Systems Lab, and Finance. Thesis 001—England +1.5 and Under 4.5—is the golden-loop case because its loss requires the system to separate outcome correctness from process quality.

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

The hosted Sites project owns its D1 binding. A live model call additionally requires the `OPENAI_API_KEY` runtime secret.

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
