import { all, first, parseJson, requireCase, requireConversation, Row } from "./slice3-support";
import { reasoningHealthForConversation } from "./reasoning-health";

function messageHref(projectId: string, conversationId: unknown, messageId: string) {
  return `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(String(conversationId))}#message-${encodeURIComponent(messageId)}`;
}

function eventView(projectId: string, row: Row) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  const sourceMessageIds = parseJson<string[]>(row.source_message_ids, []);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    caseId: row.case_id,
    type: row.event_type,
    exactSourceSpan: row.exact_source_span,
    compressedRepresentation: row.compressed_representation,
    representation: typeof metadata.representationType === "string"
      ? metadata.representationType
      : row.compressed_representation ? "Compressed" : "Exact",
    assignmentState: row.assignment_state,
    authority: row.authority_state,
    observedAt: row.observed_at,
    ingestedAt: row.ingested_at,
    sourceLinks: sourceMessageIds.map((messageId) => ({
      messageId,
      href: messageHref(projectId, row.conversation_id, messageId),
      span: Array.isArray(metadata.sourceSpans)
        ? metadata.sourceSpans.find((span) =>
          span && typeof span === "object" && (span as Row).messageId === messageId
        ) ?? null
        : null,
    })),
    metadata,
  };
}

function nodeView(row: Row) {
  return {
    id: row.id,
    caseId: row.case_id,
    type: row.node_type,
    statement: row.statement,
    representation: row.representation_type,
    scope: row.scope,
    authority: row.authority_state,
    status: row.status,
    currentVersionId: row.current_version_id,
    uncertainty: row.uncertainty,
    sourceEventIds: parseJson(row.source_event_ids, []),
    evidenceLinks: parseJson(row.evidence_links, []),
    counterevidenceLinks: parseJson(row.counterevidence_links, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mechanismView(row: Row) {
  return {
    id: row.id,
    sourceFindingId: row.source_finding_id,
    status: row.status,
    currentVersionId: row.current_governing_version_id,
    statement: row.statement,
    scopeConditions: parseJson(row.scope_conditions, []),
    exclusions: parseJson(row.exclusions, []),
    authority: row.authority_state,
    supportingCaseIds: parseJson(row.supporting_case_ids, []),
    supportingNodeIds: parseJson(row.supporting_node_ids, []),
    counterevidenceIds: parseJson(row.counterevidence_ids, []),
    realityContact: row.reality_contact,
    intendedRetrievalEffect: row.intended_retrieval_effect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    packetUseCount: Number(row.packet_use_count || 0),
  };
}

function governanceView(row: Row) {
  return {
    id: row.id,
    actor: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    sourceVersionId: row.source_version_id,
    resultingVersionId: row.resulting_version_id,
    priorAuthority: row.prior_authority,
    newAuthority: row.new_authority,
    priorStatus: row.prior_status,
    newStatus: row.new_status,
    priorScope: row.prior_scope,
    newScope: row.new_scope,
    affectedMechanismId: row.affected_mechanism_id,
    rollbackOfEventId: row.rollback_of_event_id,
    reason: row.reason,
    retrievalEffect: row.retrieval_effect,
    createdAt: row.created_at,
  };
}

export async function inspectOverview(db: D1Database, projectId: string) {
  const [
    cases,
    nodes,
    mechanisms,
    packets,
    governance,
    roadways,
    liveState,
    relationships,
    handoffs,
    blueprintRevisions,
  ] = await Promise.all([
    all<Row>(db.prepare(
      `SELECT c.*,
              (SELECT l.conversation_id FROM conversation_case_links l
               WHERE l.project_id = c.project_id AND l.case_id = c.id AND l.ended_at IS NULL
               ORDER BY CASE WHEN l.relationship_state = 'active' THEN 0 ELSE 1 END, l.created_at DESC
               LIMIT 1) AS conversation_id,
              (SELECT COUNT(*) FROM findings f
               WHERE f.project_id = c.project_id AND f.case_id = c.id
                 AND f.status IN ('proposed', 'under_review', 'deferred', 'challenged')) AS pending_finding_count,
              (SELECT COUNT(*) FROM packet_items pi
               JOIN packets p ON p.id = pi.packet_id AND p.project_id = pi.project_id
               WHERE pi.project_id = c.project_id AND p.case_id = c.id) AS packet_influence
       FROM cases c WHERE c.project_id = ?
       ORDER BY c.updated_at DESC, c.created_at DESC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT n.*, v.statement, v.representation_type, v.source_event_ids,
              v.evidence_links, v.counterevidence_links, v.uncertainty, v.created_at
       FROM reasoning_nodes n
       JOIN reasoning_node_versions v
         ON v.id = n.current_version_id AND v.project_id = n.project_id
       WHERE n.project_id = ?
       ORDER BY n.updated_at DESC, n.created_at DESC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT m.*, v.statement, v.scope_conditions, v.exclusions,
              v.supporting_case_ids, v.supporting_node_ids, v.counterevidence_ids,
              v.reality_contact, v.authority_state, v.intended_retrieval_effect,
              v.created_at,
              (SELECT COUNT(*) FROM packet_items pi
               WHERE pi.project_id = m.project_id AND pi.source_id = m.id) AS packet_use_count
       FROM mechanisms m
       JOIN mechanism_versions v
         ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
       WHERE m.project_id = ?
       ORDER BY m.updated_at DESC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT p.id, p.task, p.primary_roadway_id, p.primary_roadway_version_id,
              p.token_budget, p.final_token_count, p.status, p.created_at,
              p.prior_comparable_packet_id, r.diff_summary, r.governance_causes,
              h.receiving_model, h.handoff_status, h.final_answer_reference
       FROM packets p
       LEFT JOIN receipts r ON r.packet_id = p.id AND r.project_id = p.project_id
       LEFT JOIN handoffs h ON h.packet_id = p.id AND h.project_id = p.project_id
       WHERE p.project_id = ?
       ORDER BY p.created_at DESC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      "SELECT * FROM governance_events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT r.*, v.purpose, v.intent_patterns, v.non_applicable_patterns,
              v.required_checks, v.expected_challenges, v.required_live_state,
              v.stop_conditions, v.authority_state, v.created_at AS version_created_at
       FROM roadways r
       JOIN roadway_versions v ON v.id = r.current_version_id AND v.project_id = r.project_id
       WHERE r.project_id = ? ORDER BY r.name ASC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      "SELECT * FROM live_state_snapshots WHERE project_id = ? ORDER BY observed_at DESC, rowid DESC",
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT id, 'conversation_case' AS relationship_type, conversation_id AS source_id,
              case_id AS destination_id, relationship_state AS authority,
              link_reason AS reason, created_at, ended_at
       FROM conversation_case_links WHERE project_id = ?
       UNION ALL
       SELECT id, 'case_event' AS relationship_type, case_id AS source_id,
              event_id AS destination_id, attachment_state AS authority,
              attachment_reason AS reason, created_at, ended_at
       FROM case_event_attachments WHERE project_id = ?
       ORDER BY created_at DESC`,
    ).bind(projectId, projectId)),
    all<Row>(db.prepare(
      `SELECT h.id, h.packet_id, h.receiving_provider, h.receiving_model,
              h.handoff_status, h.final_answer_reference, h.failure_reason, h.handoff_at,
              hr.id AS receipt_id
       FROM handoffs h
       LEFT JOIN handoff_receipts hr ON hr.handoff_id = h.id AND hr.project_id = h.project_id
       WHERE h.project_id = ? ORDER BY h.handoff_at DESC, h.rowid DESC`,
    ).bind(projectId)),
    all<Row>(db.prepare(
      `SELECT f.id, f.status, f.authority_state, f.current_version_id,
              v.proposal_statement, v.proposed_scope, v.created_at
       FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.finding_type = 'blueprint_revision'
       ORDER BY f.created_at DESC`,
    ).bind(projectId)),
  ]);
  const caseViews = await Promise.all(cases.map(async (row) => {
    const health = row.conversation_id
      ? await reasoningHealthForConversation(db, projectId, String(row.conversation_id), String(row.id))
      : {
        state: "Forming",
        cause: {
          type: "case",
          id: String(row.id),
          label: "No canonical conversation is associated with this case.",
          href: `/projects/${encodeURIComponent(projectId)}/inspect/cases/${encodeURIComponent(String(row.id))}`,
        },
        recommendedNextAction: "Associate the case with a canonical conversation.",
        latestCheckpoint: null,
        pendingFindingCount: Number(row.pending_finding_count || 0),
        derivedAt: new Date().toISOString(),
      };
    return {
      id: row.id,
      objective: row.objective,
      status: row.status,
      currentThesis: row.current_thesis,
      currentDecision: row.current_decision,
      activeConstraints: parseJson(row.active_constraints, []),
      reasoningHealth: health,
      outcomeState: row.outcome_state,
      postmortemState: row.postmortem_state,
      pendingFindingCount: Number(row.pending_finding_count || 0),
      lastChanged: row.updated_at,
      packetInfluence: Number(row.packet_influence || 0),
    };
  }));

  return {
    projectId,
    cases: caseViews,
    reasoning: nodes.map(nodeView),
    mechanisms: mechanisms.map(mechanismView),
    principles: [],
    principlesNote: "No stable canonical principle record exists in this project. Principle proposals remain findings until a later governed promotion service exists.",
    blueprint: {
      version: "V1.7 frozen authority",
      purpose: "Govern authentic experience into inspectable, reversible reasoning continuity without replacing the receiving model.",
      requiredChecks: [
        "Preserve source, representation, scope, authority, freshness, challenge, and lineage.",
        "Use one atomic consequence per finding and Cody's reviewed wording for governance.",
        "Fail honestly when required state or safe packet context is unavailable.",
      ],
      researchStages: ["Observe", "Bound a case", "Checkpoint", "Govern", "Reconstruct", "Handoff"],
      failureModes: [
        "Frontend-owned authority",
        "Seeded production success",
        "Cross-project leakage",
        "Silent conflict resolution",
        "Mutable historical packets",
      ],
      requiredCounterarguments: ["Preserve the strongest applicable challenge with governing mechanisms."],
      liveStateRequirements: ["Roadway-specific current state must be present, attributed, timestamped, and fresh."],
      packetRules: ["One primary roadway", "Use / Consider / Exclude", "400 / 800 / 1,600 token budgets"],
      sharedMeanings: ["Atlas supplies governed context; the receiving model performs final reasoning."],
      approvedRules: [],
      proposedRevisions: blueprintRevisions,
    },
    packets: packets.map((row) => ({
      id: row.id,
      task: row.task,
      primaryRoadwayId: row.primary_roadway_id,
      primaryRoadwayVersionId: row.primary_roadway_version_id,
      tokenBudget: row.token_budget,
      finalSize: row.final_token_count,
      status: row.status,
      createdAt: row.created_at,
      priorComparablePacketId: row.prior_comparable_packet_id,
      difference: parseJson(row.diff_summary, []),
      governanceCauses: parseJson(row.governance_causes, []),
      receivingModel: row.receiving_model,
      handoffStatus: row.handoff_status,
      answerReference: row.final_answer_reference,
    })),
    advanced: {
      governance: governance.map(governanceView),
      roadways: roadways.map((row) => ({
        id: row.id,
        versionId: row.current_version_id,
        name: row.name,
        purpose: row.purpose,
        applicablePatterns: parseJson(row.intent_patterns, []),
        nonApplicablePatterns: parseJson(row.non_applicable_patterns, []),
        requiredChecks: parseJson(row.required_checks, []),
        strongestChallenges: parseJson(row.expected_challenges, []),
        requiredLiveState: parseJson(row.required_live_state, []),
        stopConditions: parseJson(row.stop_conditions, []),
        authority: row.authority_state,
      })),
      liveState: liveState.map((row) => ({
        id: row.id,
        provider: row.provider,
        source: row.source_identity,
        category: row.category,
        observedAt: row.observed_at,
        validUntil: row.valid_until,
        freshnessWindowSeconds: row.freshness_window_seconds,
        status: row.status,
        supersededAt: row.superseded_at,
        conflictGroup: row.conflict_group,
      })),
      evaluations: [],
      relationships,
      handoffs: handoffs.map((row) => ({
        id: row.id,
        packetId: row.packet_id,
        provider: row.receiving_provider,
        model: row.receiving_model,
        status: row.handoff_status,
        answerReference: row.final_answer_reference,
        receiptId: row.receipt_id,
        failure: row.failure_reason,
        createdAt: row.handoff_at,
      })),
    },
  };
}

export async function inspectCase(db: D1Database, projectId: string, caseId: string) {
  const caseRecord = await requireCase(db, projectId, caseId);
  const [conversations, events, nodes, checkpoints, findings, governance, packets, proposals, operations] = await Promise.all([
    all<Row>(db.prepare(
      `SELECT c.id, c.title, c.source_type, l.relationship_state, l.created_at
       FROM conversation_case_links l
       JOIN conversations c ON c.id = l.conversation_id AND c.project_id = l.project_id
       WHERE l.project_id = ? AND l.case_id = ?
       ORDER BY l.created_at ASC`,
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      "SELECT * FROM events WHERE project_id = ? AND case_id = ? ORDER BY ingested_at ASC, id ASC",
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      `SELECT n.*, v.statement, v.representation_type, v.source_event_ids,
              v.evidence_links, v.counterevidence_links, v.uncertainty, v.created_at
       FROM reasoning_nodes n JOIN reasoning_node_versions v
         ON v.id = n.current_version_id AND v.project_id = n.project_id
       WHERE n.project_id = ? AND n.case_id = ? ORDER BY n.created_at ASC`,
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      "SELECT * FROM checkpoints WHERE project_id = ? AND case_id = ? ORDER BY started_at DESC",
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      `SELECT f.*, v.proposal_statement, v.proposed_scope
       FROM findings f JOIN finding_versions v
         ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.case_id = ? ORDER BY f.created_at DESC`,
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      `SELECT g.* FROM governance_events g
       JOIN findings f ON f.id = g.target_id AND f.project_id = g.project_id
       WHERE g.project_id = ? AND g.target_type = 'finding' AND f.case_id = ?
       ORDER BY g.created_at DESC, g.rowid DESC`,
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      "SELECT id, task, status, created_at FROM packets WHERE project_id = ? AND case_id = ? ORDER BY created_at DESC",
    ).bind(projectId, caseId)),
    all<Row>(db.prepare(
      `SELECT * FROM case_boundary_proposals
       WHERE project_id = ? AND (target_case_id = ? OR source_case_ids LIKE ?)
       ORDER BY created_at DESC`,
    ).bind(projectId, caseId, `%${caseId}%`)),
    all<Row>(db.prepare(
      `SELECT * FROM case_boundary_operations
       WHERE project_id = ? AND operation_payload LIKE ?
       ORDER BY created_at DESC, rowid DESC`,
    ).bind(projectId, `%${caseId}%`)),
  ]);
  return {
    projectId,
    case: {
      id: caseRecord.id,
      objective: caseRecord.objective,
      status: caseRecord.status,
      currentThesis: caseRecord.current_thesis,
      currentDecision: caseRecord.current_decision,
      activeConstraints: parseJson(caseRecord.active_constraints, []),
      caseCore: parseJson(caseRecord.case_core, {}),
      outcomeState: caseRecord.outcome_state,
      outcomeSummary: caseRecord.outcome_summary,
      postmortemState: caseRecord.postmortem_state,
      scope: caseRecord.scope,
      createdAt: caseRecord.created_at,
      updatedAt: caseRecord.updated_at,
    },
    conversations,
    events: events.map((row) => eventView(projectId, row)),
    reasoning: nodes.map(nodeView),
    checkpoints: checkpoints.map((row) => ({
      ...row,
      missing_state: parseJson(row.missing_state, []),
      metadata: parseJson(row.metadata, {}),
    })),
    findings,
    governance: governance.map(governanceView),
    packets,
    boundaryHistory: {
      proposals: proposals.map((row) => ({
        ...row,
        source_case_ids: parseJson(row.source_case_ids, []),
        event_ids: parseJson(row.event_ids, []),
      })),
      operations: operations.map((row) => ({
        ...row,
        operation_payload: parseJson(row.operation_payload, {}),
        reversible: !row.reversed_by_operation_id && !row.reverse_of_operation_id,
      })),
    },
  };
}

export async function inspectReasoningNode(db: D1Database, projectId: string, nodeId: string) {
  const node = await first<Row>(db.prepare(
    "SELECT * FROM reasoning_nodes WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(nodeId, projectId));
  if (!node) throw new Error("Reasoning node not found.");
  const [versions, events, findings, mechanisms, packets, corrections] = await Promise.all([
    all<Row>(db.prepare(
      "SELECT * FROM reasoning_node_versions WHERE project_id = ? AND reasoning_node_id = ? ORDER BY created_at ASC, rowid ASC",
    ).bind(projectId, nodeId)),
    all<Row>(db.prepare(
      `SELECT e.* FROM events e
       JOIN reasoning_node_versions v ON v.reasoning_node_id = ?
       WHERE e.project_id = ? AND v.project_id = e.project_id
         AND v.source_event_ids LIKE '%' || e.id || '%'
       GROUP BY e.id ORDER BY e.ingested_at ASC`,
    ).bind(nodeId, projectId)),
    all<Row>(db.prepare(
      `SELECT f.*, v.proposal_statement FROM findings f
       JOIN finding_versions v ON v.id = f.current_version_id AND v.project_id = f.project_id
       WHERE f.project_id = ? AND f.case_id = ? AND f.source_event_ids IN (
         SELECT source_event_ids FROM reasoning_node_versions
         WHERE project_id = ? AND reasoning_node_id = ?
       )`,
    ).bind(projectId, node.case_id, projectId, nodeId)),
    all<Row>(db.prepare(
      `SELECT m.*, v.statement, v.authority_state FROM mechanisms m
       JOIN mechanism_versions v ON v.id = m.current_governing_version_id AND v.project_id = m.project_id
       WHERE m.project_id = ? AND v.supporting_node_ids LIKE ?`,
    ).bind(projectId, `%${nodeId}%`)),
    all<Row>(db.prepare(
      "SELECT packet_id, treatment, authority_state, inclusion_reason, exclusion_reason FROM packet_items WHERE project_id = ? AND source_id = ?",
    ).bind(projectId, nodeId)),
    all<Row>(db.prepare(
      `SELECT * FROM governance_events
       WHERE project_id = ? AND target_type = 'reasoning_node' AND target_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).bind(projectId, nodeId)),
  ]);
  return {
    projectId,
    node: {
      id: node.id,
      caseId: node.case_id,
      type: node.node_type,
      scope: node.scope,
      authority: node.authority_state,
      status: node.status,
      currentVersionId: node.current_version_id,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
    },
    versions: versions.map((row) => ({
      id: row.id,
      statement: row.statement,
      representation: row.representation_type,
      sourceEventIds: parseJson(row.source_event_ids, []),
      evidenceLinks: parseJson(row.evidence_links, []),
      counterevidenceLinks: parseJson(row.counterevidence_links, []),
      uncertainty: row.uncertainty,
      createdBy: row.created_by,
      createdAt: row.created_at,
      supersedesVersionId: row.supersedes_version_id,
    })),
    events: events.map((row) => eventView(projectId, row)),
    findings,
    mechanisms,
    packetInfluence: packets,
    correctionHistory: corrections.map(governanceView),
  };
}

export async function inspectMechanism(db: D1Database, projectId: string, mechanismId: string) {
  const mechanism = await first<Row>(db.prepare(
    "SELECT * FROM mechanisms WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(mechanismId, projectId));
  if (!mechanism) throw new Error("Mechanism not found.");
  const [versions, governance, packets, sourceFinding, reconstructedSource] = await Promise.all([
    all<Row>(db.prepare(
      "SELECT * FROM mechanism_versions WHERE project_id = ? AND mechanism_id = ? ORDER BY created_at ASC, rowid ASC",
    ).bind(projectId, mechanismId)),
    all<Row>(db.prepare(
      `SELECT * FROM governance_events
       WHERE project_id = ? AND (affected_mechanism_id = ? OR target_id = ?)
       ORDER BY created_at ASC, rowid ASC`,
    ).bind(projectId, mechanismId, mechanismId)),
    all<Row>(db.prepare(
      "SELECT packet_id, treatment, representation_type, authority_state, inclusion_reason, exclusion_reason FROM packet_items WHERE project_id = ? AND source_id = ?",
    ).bind(projectId, mechanismId)),
    mechanism.source_finding_id
      ? first<Row>(db.prepare(
        `SELECT f.*, v.proposal_statement, v.proposed_scope, v.counterevidence
         FROM findings f JOIN finding_versions v
           ON v.id = f.current_version_id AND v.project_id = f.project_id
         WHERE f.project_id = ? AND f.id = ? LIMIT 1`,
      ).bind(projectId, mechanism.source_finding_id))
      : Promise.resolve(null),
    mechanism.source_finding_id
      ? first<Row>(db.prepare(
        `SELECT ci.id, ci.representation_type, ci.source_type
         FROM findings f
         JOIN events e
           ON e.project_id = f.project_id AND f.source_event_ids LIKE '%' || e.id || '%'
         JOIN conversation_imports ci
           ON ci.project_id = e.project_id AND ci.conversation_id = e.conversation_id
         WHERE f.project_id = ? AND f.id = ? AND ci.representation_type = 'Reconstructed'
         LIMIT 1`,
      ).bind(projectId, mechanism.source_finding_id))
      : Promise.resolve(null),
  ]);
  return {
    projectId,
    mechanism: {
      id: mechanism.id,
      status: mechanism.status,
      sourceFindingId: mechanism.source_finding_id,
      currentVersionId: mechanism.current_governing_version_id,
      createdAt: mechanism.created_at,
      updatedAt: mechanism.updated_at,
    },
    versions: versions.map((row) => ({
      id: row.id,
      statement: row.statement,
      scopeConditions: parseJson(row.scope_conditions, []),
      exclusions: parseJson(row.exclusions, []),
      supportingCaseIds: parseJson(row.supporting_case_ids, []),
      supportingNodeIds: parseJson(row.supporting_node_ids, []),
      strongestChallengeIds: parseJson(row.counterevidence_ids, []),
      authority: row.authority_state,
      status: row.id === mechanism.current_governing_version_id ? mechanism.status : "historical",
      createdBy: row.created_by,
      createdAt: row.created_at,
      supersedesVersionId: row.supersedes_version_id,
    })),
    governance: governance.map(governanceView),
    sourceFinding: sourceFinding
      ? { ...sourceFinding, counterevidence: parseJson(sourceFinding.counterevidence, []) }
      : null,
    packetUsage: packets,
    historicalLimitations: reconstructedSource
      ? ["Brewers historical raw transcript unavailable; reconstructed source is not Exact."]
      : [],
  };
}

export async function conversationStructure(db: D1Database, projectId: string, conversationId: string) {
  const conversation = await requireConversation(db, projectId, conversationId);
  const cases = await all<Row>(db.prepare(
    `SELECT c.*, l.relationship_state
     FROM conversation_case_links l
     JOIN cases c ON c.id = l.case_id AND c.project_id = l.project_id
     WHERE l.project_id = ? AND l.conversation_id = ? AND l.ended_at IS NULL
     ORDER BY l.created_at ASC`,
  ).bind(projectId, conversationId));
  const details = await Promise.all(cases.map((row) => inspectCase(db, projectId, String(row.id))));
  const unassigned = await all<Row>(db.prepare(
    `SELECT * FROM events
     WHERE project_id = ? AND conversation_id = ? AND assignment_state IN ('unassigned', 'chat_only')
     ORDER BY ingested_at ASC`,
  ).bind(projectId, conversationId));
  return {
    projectId,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      activeCaseId: conversation.active_case_id,
      sourceType: conversation.source_type,
    },
    cases: details,
    unassignedEvents: unassigned.map((row) => eventView(projectId, row)),
  };
}
