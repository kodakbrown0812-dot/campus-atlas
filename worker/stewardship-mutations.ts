import { canonicalId } from "./canonical-records";
import { sha256 } from "./transcript-import";
import {
  assertId,
  first,
  json,
  now,
  optionalString,
  parseJson,
  requiredString,
  requireCase,
  requireConversation,
  requireProject,
  Row,
} from "./slice3-support";

const CONTEXTUAL_TYPES = new Set([
  "case",
  "research_evidence",
  "outcome",
  "correction",
  "challenge",
  "observation",
  "proposed_connection",
]);
const REPRESENTATIONS = new Set(["Exact", "Compressed", "Reconstructed"]);

function stableFields(body: Row) {
  return {
    type: body.type,
    projectId: body.projectId,
    caseId: body.caseId || null,
    conversationId: body.conversationId || null,
    content: body.content,
    objective: body.objective,
    representation: body.representation,
    sourceMessageId: body.sourceMessageId || null,
    sourceStart: body.sourceStart,
    sourceEnd: body.sourceEnd,
    targetType: body.targetType || null,
    targetId: body.targetId || null,
    reasoningNodeId: body.reasoningNodeId || null,
  };
}

async function stableRecordId(prefix: string, projectId: string, idempotencyKey: string) {
  return `${prefix}:${(await sha256(`${projectId}\n${idempotencyKey}`)).slice(0, 32)}`;
}

async function linkedConversation(db: D1Database, projectId: string, caseId: string) {
  return first<Row>(db.prepare(
    `SELECT c.* FROM conversation_case_links l
     JOIN conversations c ON c.id = l.conversation_id AND c.project_id = l.project_id
     WHERE l.project_id = ? AND l.case_id = ? AND l.ended_at IS NULL
     ORDER BY CASE WHEN l.relationship_state = 'active' THEN 0 ELSE 1 END, l.created_at DESC
     LIMIT 1`,
  ).bind(projectId, caseId));
}

async function requireReplayMatch(row: Row, fingerprint: string) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  if (metadata.contextualAddFingerprint !== fingerprint) {
    throw new Error("Idempotency key conflicts with a different Contextual Add request.");
  }
}

export async function correctReasoningNode(
  db: D1Database,
  projectId: string,
  nodeId: string,
  body: Row,
  idempotencyKey: string,
) {
  const sourceVersionId = assertId(body.sourceVersionId, "source version ID");
  const reviewedStatement = requiredString(body.reviewedStatement, "Corrected wording");
  const actorId = requiredString(body.actorId, "Correction actor");
  const reason = requiredString(body.reason, "Correction reason");
  const replay = await first<Row>(db.prepare(
    `SELECT * FROM governance_events
     WHERE project_id = ? AND idempotency_key = ? LIMIT 1`,
  ).bind(projectId, idempotencyKey));
  if (replay) {
    if (
      replay.action !== "correct"
      || replay.target_type !== "reasoning_node"
      || replay.target_id !== nodeId
      || replay.source_version_id !== sourceVersionId
    ) {
      throw new Error("Idempotency key conflicts with a different node correction.");
    }
    const version = await first<Row>(db.prepare(
      "SELECT * FROM reasoning_node_versions WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(replay.resulting_version_id, projectId));
    if (!version || version.statement !== reviewedStatement || replay.reason !== reason) {
      throw new Error("Idempotency key conflicts with different correction content.");
    }
    return {
      projectId,
      nodeId,
      version,
      governanceEvent: replay,
      retrievalEffect: replay.retrieval_effect,
      idempotentReplay: true,
    };
  }

  const node = await first<Row>(db.prepare(
    "SELECT * FROM reasoning_nodes WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(nodeId, projectId));
  if (!node) throw new Error("Reasoning node not found.");
  if (node.current_version_id !== sourceVersionId) {
    throw new Error("Reasoning node current version changed; review the latest version before correcting.");
  }
  const source = await first<Row>(db.prepare(
    `SELECT * FROM reasoning_node_versions
     WHERE id = ? AND project_id = ? AND reasoning_node_id = ? LIMIT 1`,
  ).bind(sourceVersionId, projectId, nodeId));
  if (!source) throw new Error("Reasoning node source version not found.");
  if (source.statement === reviewedStatement) throw new Error("A correction must change the node wording.");

  const createdAt = now();
  const versionId = canonicalId("reasoning-node-version");
  const eventId = canonicalId("governance");
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO reasoning_node_versions (
        id, project_id, reasoning_node_id, statement, representation_type,
        source_event_ids, evidence_links, counterevidence_links, uncertainty,
        confidence, created_by, created_at, supersedes_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      projectId,
      nodeId,
      reviewedStatement,
      "Reconstructed",
      source.source_event_ids,
      source.evidence_links,
      source.counterevidence_links,
      source.uncertainty,
      source.confidence,
      actorId,
      createdAt,
      sourceVersionId,
    ),
    db.prepare(
      `UPDATE reasoning_nodes SET current_version_id = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND current_version_id = ?`,
    ).bind(versionId, createdAt, nodeId, projectId, sourceVersionId),
    db.prepare(
      `INSERT INTO governance_events (
        id, project_id, actor_id, action, target_type, target_id,
        source_version_id, resulting_version_id, prior_authority, new_authority,
        prior_status, new_status, prior_scope, new_scope, reason,
        retrieval_effect, created_at, idempotency_key
      ) VALUES (?, ?, ?, 'correct', 'reasoning_node', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      eventId,
      projectId,
      actorId,
      nodeId,
      sourceVersionId,
      versionId,
      node.authority_state,
      node.authority_state,
      node.status,
      node.status,
      node.scope,
      node.scope,
      reason,
      "wording_corrected_no_authority_promotion",
      createdAt,
      idempotencyKey,
    ),
  ];
  await db.batch(statements);
  return {
    projectId,
    nodeId,
    version: await first<Row>(db.prepare(
      "SELECT * FROM reasoning_node_versions WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(versionId, projectId)),
    governanceEvent: await first<Row>(db.prepare(
      "SELECT * FROM governance_events WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(eventId, projectId)),
    retrievalEffect: "wording_corrected_no_authority_promotion",
    idempotentReplay: false,
  };
}

async function contextualCase(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
  fingerprint: string,
) {
  const id = await stableRecordId("case", projectId, idempotencyKey);
  const existing = await first<Row>(db.prepare(
    "SELECT * FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(id, projectId));
  if (existing) {
    await requireReplayMatch(existing, fingerprint);
    return { record: existing, idempotentReplay: true };
  }
  const conversationId = optionalString(body.conversationId);
  if (conversationId) await requireConversation(db, projectId, assertId(conversationId, "conversation ID"));
  const createdAt = now();
  const actorId = optionalString(body.actorId) || "cody";
  const metadata = {
    contextualAddFingerprint: fingerprint,
    idempotencyKey,
    representation: "Reconstructed",
    authority: "observed",
    source: optionalString(body.sourceReference),
  };
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO cases (
        id, project_id, objective, status, scope, active_constraints, case_core,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 'local', '[]', '{}', ?, ?, ?)`,
    ).bind(
      id,
      projectId,
      requiredString(body.objective || body.content, "Case objective"),
      json(metadata),
      createdAt,
      createdAt,
    ),
  ];
  if (conversationId) {
    statements.push(db.prepare(
      `INSERT INTO conversation_case_links (
        id, project_id, conversation_id, case_id, relationship_state,
        linked_by, link_reason, created_at
      ) VALUES (?, ?, ?, ?, 'associated', ?, ?, ?)`,
    ).bind(
      canonicalId("conversation-case"),
      projectId,
      conversationId,
      id,
      actorId,
      optionalString(body.reason) || "Associated through Contextual Add.",
      createdAt,
    ));
  }
  await db.batch(statements);
  return {
    record: await first<Row>(db.prepare(
      "SELECT * FROM cases WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(id, projectId)),
    idempotentReplay: false,
  };
}

async function sourceForContextualEvent(
  db: D1Database,
  projectId: string,
  conversationId: string,
  body: Row,
) {
  const content = requiredString(body.content, "What happened");
  const sourceMessageId = optionalString(body.sourceMessageId);
  if (!sourceMessageId) {
    if (body.representation === "Exact") {
      throw new Error("Exact representation requires a canonical source-message span.");
    }
    return {
      exactSourceSpan: content,
      sourceMessageIds: [] as string[],
      spans: [] as Array<{ id: string; messageId: string; start: number; end: number }>,
      representation: optionalString(body.representation) || "Reconstructed",
    };
  }
  const messageId = assertId(sourceMessageId, "source message ID");
  const message = await first<Row>(db.prepare(
    `SELECT * FROM messages
     WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1`,
  ).bind(messageId, projectId, conversationId));
  if (!message) throw new Error("Source message not found.");
  const start = Number(body.sourceStart ?? 0);
  const end = Number(body.sourceEnd ?? String(message.exact_content).length);
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || end > String(message.exact_content).length
  ) {
    throw new Error("Source span offsets are invalid.");
  }
  const exact = String(message.exact_content).slice(start, end);
  if (exact !== content) throw new Error("Contextual Add content does not match the exact source span.");
  return {
    exactSourceSpan: exact,
    sourceMessageIds: [messageId],
    spans: [{ id: canonicalId("source-span"), messageId, start, end }],
    representation: "Exact",
  };
}

async function contextualEvent(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
  fingerprint: string,
  type: string,
) {
  const id = await stableRecordId("event", projectId, idempotencyKey);
  const existing = await first<Row>(db.prepare(
    "SELECT * FROM events WHERE id = ? AND project_id = ? LIMIT 1",
  ).bind(id, projectId));
  if (existing) {
    await requireReplayMatch(existing, fingerprint);
    return { record: existing, idempotentReplay: true };
  }
  const caseId = optionalString(body.caseId);
  if (caseId) await requireCase(db, projectId, assertId(caseId, "case ID"));
  let conversationId = optionalString(body.conversationId);
  if (body.representation === "Exact" && !conversationId) {
    throw new Error("Exact representation requires a selected canonical conversation.");
  }
  if (!conversationId && caseId) {
    const linked = await linkedConversation(db, projectId, caseId);
    conversationId = linked ? String(linked.id) : null;
  }
  if (!conversationId) {
    throw new Error("A conversation or a case with an associated conversation is required for this canonical event.");
  }
  await requireConversation(db, projectId, assertId(conversationId, "conversation ID"));
  if (caseId) {
    const link = await first<Row>(db.prepare(
      `SELECT id FROM conversation_case_links
       WHERE project_id = ? AND conversation_id = ? AND case_id = ? AND ended_at IS NULL
       LIMIT 1`,
    ).bind(projectId, conversationId, caseId));
    if (!link) throw new Error("Selected case is not associated with the selected conversation.");
  }
  const source = await sourceForContextualEvent(db, projectId, conversationId, body);
  if (!REPRESENTATIONS.has(source.representation)) throw new Error("Unsupported representation.");
  const createdAt = now();
  const actorId = optionalString(body.actorId) || "cody";
  const assignmentState = caseId ? "assigned" : "unassigned";
  const eventType = type === "research_evidence" ? "evidence" : type;
  const metadata = {
    contextualAddFingerprint: fingerprint,
    idempotencyKey,
    representationType: source.representation,
    sourceReference: optionalString(body.sourceReference),
    sourceSpans: source.spans,
    proposedConnection: type === "proposed_connection"
      ? {
        targetType: requiredString(body.targetType, "Connection target type"),
        targetId: assertId(body.targetId, "connection target ID"),
        relationshipType: optionalString(body.relationshipType) || "proposed_connection",
        authority: "proposed",
      }
      : null,
  };
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO events (
        id, project_id, conversation_id, case_id, event_type, exact_source_span,
        compressed_representation, source_message_ids, actor_id, observed_at,
        ingested_at, extraction_method, extraction_version, authority_state,
        assignment_state, version, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'contextual_add',
                'slice6b-v1', 'observed', ?, 1, ?)`,
    ).bind(
      id,
      projectId,
      conversationId,
      caseId,
      eventType,
      source.exactSourceSpan,
      optionalString(body.compressedRepresentation),
      json(source.sourceMessageIds),
      actorId,
      optionalString(body.observedAt) || createdAt,
      createdAt,
      assignmentState,
      json(metadata),
    ),
  ];
  if (caseId) {
    statements.push(db.prepare(
      `INSERT INTO case_event_attachments (
        id, project_id, case_id, event_id, attachment_state, attached_by,
        attachment_reason, created_at
      ) VALUES (?, ?, ?, ?, 'attached', ?, ?, ?)`,
    ).bind(
      canonicalId("case-event"),
      projectId,
      caseId,
      id,
      actorId,
      optionalString(body.reason) || "Attached through Contextual Add.",
      createdAt,
    ));
  }
  if (type === "outcome" && caseId) {
    statements.push(db.prepare(
      `UPDATE cases
       SET outcome_state = 'recorded', outcome_summary = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(source.exactSourceSpan, createdAt, caseId, projectId));
  }
  await db.batch(statements);
  return {
    record: await first<Row>(db.prepare(
      "SELECT * FROM events WHERE id = ? AND project_id = ? LIMIT 1",
    ).bind(id, projectId)),
    idempotentReplay: false,
  };
}

export async function contextualAdd(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  await requireProject(db, projectId);
  const type = requiredString(body.type, "Contextual Add type").toLowerCase();
  if (!CONTEXTUAL_TYPES.has(type)) throw new Error("Unsupported Contextual Add type.");
  const fingerprint = await sha256(JSON.stringify(stableFields({ ...body, projectId })));

  if (type === "correction" && body.reasoningNodeId) {
    const result = await correctReasoningNode(
      db,
      projectId,
      assertId(body.reasoningNodeId, "reasoning node ID"),
      {
        sourceVersionId: body.sourceVersionId,
        reviewedStatement: body.content,
        actorId: body.actorId,
        reason: body.reason,
      },
      idempotencyKey,
    );
    return {
      ...result,
      receipt: {
        canonicalRecordId: result.version?.id,
        destination: result.nodeId,
        projectId,
        caseId: optionalString(body.caseId),
        conversationId: optionalString(body.conversationId),
        recordType: "reasoning_node_version",
        representation: "Reconstructed",
        authority: "unchanged",
        source: optionalString(body.sourceReference),
        suggestedRelationships: [],
        nextAction: "Review the corrected node and govern any consequential meaning separately.",
        retrievalChanged: false,
        retrievalReason: "A wording correction preserves history and does not promote authority.",
      },
    };
  }

  const result = type === "case"
    ? await contextualCase(db, projectId, body, idempotencyKey, fingerprint)
    : await contextualEvent(db, projectId, body, idempotencyKey, fingerprint, type);
  const record = result.record!;
  const representation = type === "case"
    ? "Reconstructed"
    : parseJson<Record<string, unknown>>(record.metadata, {}).representationType || "Reconstructed";
  const eventMetadata = type === "case"
    ? {}
    : parseJson<Record<string, unknown>>(record.metadata, {});
  const sourceSpan = Array.isArray(eventMetadata.sourceSpans)
    ? eventMetadata.sourceSpans.find((candidate) => candidate && typeof candidate === "object") as Row | undefined
    : undefined;
  const sourceLineage = representation === "Exact" && sourceSpan
    ? {
        messageId: String(sourceSpan.messageId),
        start: Number(sourceSpan.start),
        end: Number(sourceSpan.end),
        href: `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(String(record.conversation_id))}#message-${encodeURIComponent(String(sourceSpan.messageId))}`,
      }
    : null;
  return {
    projectId,
    receipt: {
      canonicalRecordId: record.id,
      destination: type === "case" ? "Cases" : "Case structure",
      projectId,
      caseId: type === "case" ? record.id : record.case_id,
      conversationId: type === "case" ? optionalString(body.conversationId) : record.conversation_id,
      recordType: type === "case" ? "case" : "event",
      representation,
      authority: type === "proposed_connection" ? "proposed" : "observed",
      source: representation === "Exact"
        ? "Canonical message span"
        : optionalString(body.sourceReference) || "User-supplied contextual capture",
      sourceLineage,
      suggestedRelationships: type === "proposed_connection"
        ? [parseJson<Record<string, unknown>>(record.metadata, {}).proposedConnection]
        : [],
      nextAction: type === "outcome"
        ? "Run a checkpoint when you want Atlas to evaluate the outcome."
        : "Review this record in Inspect; govern any consequential meaning separately.",
      retrievalChanged: false,
      retrievalReason: "No consequential meaning was approved by this capture.",
    },
    record,
    idempotentReplay: result.idempotentReplay,
  };
}
