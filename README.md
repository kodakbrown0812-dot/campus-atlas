# Campus Atlas

Campus Atlas is a reasoning sidecar for long-running ChatGPT Projects. It preserves decisions, evidence, corrections, challenges, and promoted principles as connected, inspectable knowledge—then compiles the smallest useful context for future work.

**Campus Atlas is the product.** “AI Reasoning Rebar” describes the architecture underneath it. Amy Campus is the example workspace, and Sports Engine is the mature proof project inside that workspace.

## V4.3 Build Week proof

V4.3 turns Sports Engine from a presentation page into a working project surface:

`Open case → Audit research → Record outcome → Run post-mortem → Human-promote knowledge → Test future retrieval`

Cases, Knowledge, and Blueprint are the only project destinations. Workbench actions now live inside the selected case. The browser and MCP/API use the same session-scoped demo workspace, so the durable-learning loop is observable end to end:

`Capture → Structure → Connect → Test → Promote → Retrieve`

The final step compares a context packet before and after a human-approved promotion. The claim is intentionally narrow: the demo proves that governed knowledge changes future context in an inspectable way. It does not claim that one example proves better prediction outcomes.

## Exact three-minute judge route

1. **0:00–0:15 — Problem.** Read the headline and supporting sentence: ChatGPT helps now; Atlas governs what deserves to affect next time.
2. **0:15–0:45 — Initial retrieval.** Open **Sports Engine → Cases**, select England–Ghana, and run **Test future retrieval** for the seeded heavy-favorite question. Show that the candidate signal-separation rule is excluded because it lacks authority.
3. **0:45–1:35 — Governed learning.** Inspect the 0–0 outcome and post-mortem, open the connected signal-separation candidate, review its evidence and challenge, and explicitly approve promotion.
4. **1:35–2:15 — Changed future context.** Return to the case and run the same question. The promoted rule now appears as a newly retrieved item with a typed path through the Cape Verde precedent.
5. **2:15–2:40 — Sidecar proof.** Show the shared workspace key, packet budget, exclusions, and action receipt. The same key can be supplied as `workspaceId` to the MCP tools.
6. **2:40–3:00 — Project intelligence.** Open **Blueprint** and show the promoted principle under Retrieval Authority with the evidence that earned it.

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

V4.3 supports two paths:

1. **Immediate handoff:** build a packet in the app and use **Copy for ChatGPT**. This works directly from the public demonstration workspace.
2. **Connected app:** connect the Site's HTTPS `/mcp` endpoint in ChatGPT developer mode after the endpoint is made reachable through a public or authenticated connector-safe access policy.

The MCP server implements initialize, tool discovery, and tool calls. It exposes six focused tools:

- `atlas_build_context_packet` — read; returns the smallest useful context with inclusion and exclusion reasons.
- `atlas_get_project_blueprint` — read; returns project rules and earned capabilities.
- `atlas_retrieve_precedents` — read; returns approved precedent with evidence paths.
- `atlas_get_receipt` — read; inspects preserved external action receipts.
- `atlas_capture_candidate` — write; creates a proposed case or knowledge object only.
- `atlas_record_outcome` — write; creates a reality evidence event only.

Every tool declares read/write, open-world, and destructive annotations. Writes require idempotency keys and never promote knowledge. External writes fail closed when `CAMPUS_ATLAS_ACTION_KEY` is absent and require that bearer token when it is configured. `GET /api/security` reports the protection mode without returning the secret.

An OpenAPI 3.1 fallback is available at `/openapi.json` for GPT Actions or other compatible clients. The privacy disclosure lives at `/privacy`.

With `CAMPUS_ATLAS_PUBLIC_DEMO=true`, each visitor receives an opaque demo `workspaceId`. Browser changes, context packets, and authorized connector writes use that session-scoped D1 record while the private workspace remains separate. Anyone holding a demo key may be able to read that demonstration state, so the public workspace must not contain sensitive information. Connector candidate/outcome writes remain separately bearer-protected.

## Persistence

In private-workspace mode, Campus state is stored in Cloudflare D1 through `GET /api/state` and `POST /api/state`. Captures, reviews, promotions, typed connections, packets, and AI Work Receipts survive refresh. State writes merge known UI fields so connector receipts and packet history are not erased by later browser saves.

In public-demo mode, private D1 state is never returned. The Site creates a session-scoped D1 record with an opaque workspace key; both `/api/state` and the context/MCP routes resolve that same record. The interface labels successful synchronization as **Browser + API synced**. Temporary Local Context remains inside its packet unless the visitor explicitly captures it.

## Sample data

Amy Campus contains seeded examples from Headquarters, Sports Engine, Health + Training, Lessons Division, Human Systems Lab, and Finance. Thesis 001—England -1.5 and Over 3.5 against Ghana—is the golden-loop case. The 0–0 outcome forces the system to separate favorite quality, match control, scoring probability, and market coverage instead of treating them as one signal.

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
- Added an implementation audit at `docs/V4_AUDIT.md` and expanded automated endpoint and interaction coverage.

### V4.3 additions

- Reduced Sports Engine to **Cases**, **Knowledge**, and **Blueprint**.
- Moved capture, outcome, post-mortem, correction, evidence, and retrieval actions into the unified case record.
- Grouped cases into active research, needs post-mortem, and completed work.
- Added a live before/after retrieval tester with packet deltas, exclusions, receipts, and the shared MCP workspace key.
- Added session-scoped D1 demo workspaces so browser changes and sidecar retrieval read the same evolving records without exposing private state.
- Updated the deployed Sports Engine blueprint and fallback corpus to V4.3 England–Ghana data.
- Allowed authorized sidecar captures to create either proposed cases or proposed knowledge; outcome writes now update the visible case lifecycle.

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
- Public-demo browser and sidecar requests share one opaque, session-scoped workspace.
- A human promotion changes the Blueprint and the next packet built from that workspace.
