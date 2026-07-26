# Campus Atlas V4 interface and integration audit

## Product test

Campus Atlas should make one normal ChatGPT request better without forcing the user to operate a knowledge-management dashboard first.

The V3 architecture is valuable, but the default experience starts with the system instead of the user's task. Its top navigation is mostly section scrolling, and the Context Packet is an intricate editor that stops before the most important handoff: giving ChatGPT a concise, governed payload it can actually use.

## Research conclusions

- ChatGPT Apps use MCP tools as the contract between the model and an external product.
- Tools should have one job, explicit schemas, predictable structured outputs, and separate read/write behavior.
- ChatGPT UX should optimize for conversation rather than navigation. The external UI should clarify, confirm, and inspect—not recreate an entire website inside chat.
- Read actions and write actions need accurate impact annotations. Consequential changes remain human-governed.
- ChatGPT can connect to an HTTPS `/mcp` endpoint in developer mode. A conventional OpenAPI surface remains a useful fallback for GPT Actions.
- The model may retry tool calls, so all Atlas writes need stable identifiers and idempotency keys.
- Only the context needed for the current task should reach the model. Lineage details remain available through receipts instead of bloating every packet.

## V3 findings

### Preserve

- Premium visual identity
- Amy Campus example workspace
- Sports Engine proof project
- Governed promotion and full lineage
- Typed graph connections and receipts
- D1 persistence
- Separate outcome and process review

### Change

1. Replace section-scroll navigation with **Ask Atlas**, **Review Inbox**, **Explore Atlas**, and **Sports Engine** actions.
2. Make a natural-language task the first useful interaction.
3. Turn Context Packets into outputs, not forms: compact, ranked, source-aware handoffs with a clear budget.
4. Put temporary local context in one optional field instead of exposing every internal context category up front.
5. Show the exact tool receipt and compiled payload ChatGPT receives.
6. Keep the graph, support ledger, promotion lineage, and conflict detail behind progressive disclosure.
7. Expose a real tool surface over MCP plus a documented OpenAPI fallback.

## V4 tool contract

| Tool | Type | Job |
| --- | --- | --- |
| `atlas.build_context_packet` | Read | Compile the smallest useful blueprint, precedents, constraints, and challenges for a task. |
| `atlas.get_project_blueprint` | Read | Return the active reasoning rules and project-specific capabilities. |
| `atlas.retrieve_precedents` | Read | Return similar cases with explicit reasons and relevant corrections. |
| `atlas.get_receipt` | Read | Reconstruct the evidence, approvals, revisions, and connection path behind one item. |
| `atlas.capture_candidate` | Write | Preserve a structured observation as proposed knowledge with no promotion authority. |
| `atlas.record_outcome` | Write | Preserve reality and create review evidence without silently changing authority. |

Writes create proposed or evidence state only. Promotion remains an explicit human action in the Atlas interface.

## V4 primary flow

1. Enter a normal task such as “Research deGrom over 6.5 strikeouts.”
2. Atlas identifies the project and loads its blueprint.
3. Atlas retrieves a few high-utility precedents and carries forward relevant challenges.
4. Atlas visibly excludes low-authority or irrelevant knowledge.
5. Atlas returns a concise compiled handoff and tool receipt.
6. ChatGPT reasons with that payload.
7. Any proposed capture or outcome returns to the Review Inbox.

## Acceptance criteria

- The first useful action is obvious in under ten seconds.
- The full Context Packet can be built from one task plus optional local context.
- The packet endpoint and interface return the same governed structure.
- The packet is copyable and ready for ChatGPT even before the connector is installed.
- `/mcp` supports initialize, tool discovery, and tool calls.
- Read/write tools are separate and accurately annotated.
- Writes are idempotent and never grant promotion authority.
- Every included and excluded item has a reason.
- V3 graph, promotion lineage, and Sports Engine depth remain accessible.
- Desktop is polished and the primary task flow works cleanly on mobile.

## Deployment boundary

The existing owner-only site can safely demonstrate the full workflow. A remote ChatGPT connector requires a reachable HTTPS endpoint and an explicit access/authentication decision before broader use. V4 prepares the server and interface without silently widening the site's audience.
