import { sha256 } from "./transcript-import";

type Row = Record<string, unknown>;

export type SourceEventPreparation = {
  eligible: boolean;
  status: "not_eligible" | "prepared" | "already_prepared" | "blocked" | "failed";
  expectedMessageCount: number;
  materializedEventCount: number;
  createdEventCount: number;
  attachedEventCount: number;
  eventIds: string[];
  missingMessageIds: string[];
  requirement: string | null;
};

type ExactImport = {
  id: string;
  importId: string;
  sourceType: string;
  representationType: string;
  authorityState: string;
  provenance: Record<string, unknown>;
  format: string;
  sourceName: string | null;
  messageCount: number;
};

type ExactMessage = {
  id: string;
  sequence: number;
  actorType: string;
  actorId: string | null;
  exactContent: string;
  originalTimestamp: string | null;
  ingestedAt: string;
  sourceReference: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
};

type EventSpec = {
  id: string;
  spanId: string;
  message: ExactMessage;
  metadata: Record<string, unknown>;
};

const EXTRACTION_METHOD = "exact_import_materialization";
const EXTRACTION_VERSION = "slice2-exact-message-v1";

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function first<T extends Row>(statement: D1PreparedStatement) {
  return statement.first<T>();
}

async function all<T extends Row>(statement: D1PreparedStatement) {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function notEligible(): SourceEventPreparation {
  return {
    eligible: false,
    status: "not_eligible",
    expectedMessageCount: 0,
    materializedEventCount: 0,
    createdEventCount: 0,
    attachedEventCount: 0,
    eventIds: [],
    missingMessageIds: [],
    requirement: null,
  };
}

function blocked(
  expectedMessageCount: number,
  materializedEventCount: number,
  eventIds: string[],
  missingMessageIds: string[],
  requirement: string,
): SourceEventPreparation {
  return {
    eligible: true,
    status: "blocked",
    expectedMessageCount,
    materializedEventCount,
    createdEventCount: 0,
    attachedEventCount: 0,
    eventIds,
    missingMessageIds,
    requirement,
  };
}

async function exactImport(
  db: D1Database,
  projectId: string,
  conversationId: string,
): Promise<ExactImport | null> {
  const row = await first<Row>(db.prepare(
    `SELECT i.*
     FROM conversations c
     JOIN conversation_imports i
       ON i.project_id = c.project_id AND i.conversation_id = c.id
     WHERE c.project_id = ? AND c.id = ? AND c.source_type = 'imported'
       AND i.representation_type = 'Exact'
     ORDER BY i.imported_at ASC
     LIMIT 1`,
  ).bind(projectId, conversationId));
  if (!row) return null;
  return {
    id: String(row.id),
    importId: String(row.import_id),
    sourceType: String(row.source_type),
    representationType: String(row.representation_type),
    authorityState: String(row.authority_state),
    provenance: parseJson(row.provenance, {}),
    format: String(row.source_format),
    sourceName: row.source_name ? String(row.source_name) : null,
    messageCount: Number(row.message_count),
  };
}

async function exactMessages(
  db: D1Database,
  projectId: string,
  conversationId: string,
): Promise<ExactMessage[]> {
  const rows = await all<Row>(db.prepare(
    `SELECT * FROM messages
     WHERE project_id = ? AND conversation_id = ?
     ORDER BY sequence_number ASC, id ASC`,
  ).bind(projectId, conversationId));
  return rows.map((row) => ({
    id: String(row.id),
    sequence: Number(row.sequence_number),
    actorType: String(row.actor_type),
    actorId: row.actor_id ? String(row.actor_id) : null,
    exactContent: String(row.exact_content),
    originalTimestamp: row.original_timestamp ? String(row.original_timestamp) : null,
    ingestedAt: String(row.ingested_at),
    sourceReference: row.source_reference ? String(row.source_reference) : null,
    contentHash: String(row.content_hash),
    metadata: parseJson(row.metadata, {}),
  }));
}

async function eventSpec(projectId: string, conversationId: string, record: ExactImport, message: ExactMessage) {
  const identity = await sha256(`${EXTRACTION_VERSION}\n${projectId}\n${conversationId}\n${message.id}`);
  const sequence = String(message.sequence).padStart(8, "0");
  const id = `event:exact-message:${sequence}:${identity.slice(0, 24)}`;
  const spanId = `source-span:exact-message:${identity.slice(0, 32)}`;
  return {
    id,
    spanId,
    message,
    metadata: {
      representationType: "Exact",
      materialization: {
        method: EXTRACTION_METHOD,
        version: EXTRACTION_VERSION,
        deterministicIdentity: identity,
      },
      sourceSpans: [{
        id: spanId,
        messageId: message.id,
        start: 0,
        end: message.exactContent.length,
      }],
      sourceMessage: {
        id: message.id,
        sequence: message.sequence,
        actorType: message.actorType,
        actorId: message.actorId,
        originalTimestamp: message.originalTimestamp,
        ingestedAt: message.ingestedAt,
        sourceReference: message.sourceReference,
        contentHash: message.contentHash,
        metadata: message.metadata,
      },
      import: {
        id: record.id,
        importId: record.importId,
        sourceType: record.sourceType,
        representationType: record.representationType,
        authorityState: record.authorityState,
        format: record.format,
        sourceName: record.sourceName,
        provenance: record.provenance,
      },
    },
  } satisfies EventSpec;
}

function eventMatches(row: Row, spec: EventSpec, projectId: string, conversationId: string) {
  const messageIds = parseJson<string[]>(row.source_message_ids, []);
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  const sourceMessage = metadata.sourceMessage && typeof metadata.sourceMessage === "object"
    ? metadata.sourceMessage as Row
    : {};
  const spans = Array.isArray(metadata.sourceSpans) ? metadata.sourceSpans : [];
  const span = spans[0] && typeof spans[0] === "object" ? spans[0] as Row : {};
  return row.project_id === projectId
    && row.conversation_id === conversationId
    && row.event_type === "source_message"
    && row.exact_source_span === spec.message.exactContent
    && row.compressed_representation === null
    && row.extraction_method === EXTRACTION_METHOD
    && row.extraction_version === EXTRACTION_VERSION
    && row.authority_state === "observed"
    && messageIds.length === 1
    && messageIds[0] === spec.message.id
    && Number(sourceMessage.sequence) === spec.message.sequence
    && sourceMessage.actorType === spec.message.actorType
    && (sourceMessage.actorId ?? null) === spec.message.actorId
    && (sourceMessage.originalTimestamp ?? null) === spec.message.originalTimestamp
    && span.id === spec.spanId
    && span.messageId === spec.message.id
    && Number(span.start) === 0
    && Number(span.end) === spec.message.exactContent.length;
}

export async function ensureExactImportSourceEvents(
  db: D1Database,
  projectId: string,
  conversationId: string,
  caseId: string | null = null,
): Promise<SourceEventPreparation> {
  const record = await exactImport(db, projectId, conversationId);
  if (!record) return notEligible();

  const messages = await exactMessages(db, projectId, conversationId);
  if (!Number.isInteger(record.messageCount) || record.messageCount < 1) {
    return blocked(
      record.messageCount,
      0,
      [],
      [],
      "The Exact import does not declare a positive immutable-message count.",
    );
  }
  if (messages.length !== record.messageCount) {
    return blocked(
      record.messageCount,
      0,
      [],
      [],
      `The Exact import expects ${record.messageCount} immutable message${record.messageCount === 1 ? "" : "s"}, but ${messages.length} are available.`,
    );
  }

  const specs = await Promise.all(messages.map((message) => eventSpec(projectId, conversationId, record, message)));
  const existingBefore = await Promise.all(specs.map((spec) => first<Row>(db.prepare(
    "SELECT * FROM events WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
  ).bind(spec.id, projectId, conversationId))));
  const preparedAt = new Date().toISOString();
  await db.batch(specs.map((spec) => db.prepare(
    `INSERT OR IGNORE INTO events (
      id, project_id, conversation_id, case_id, event_type, exact_source_span,
      compressed_representation, source_message_ids, actor_id, observed_at,
      ingested_at, extraction_method, extraction_version, confidence,
      authority_state, assignment_state, version, metadata
    ) VALUES (?, ?, ?, NULL, 'source_message', ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'observed', 'unassigned', 1, ?)`,
  ).bind(
    spec.id,
    projectId,
    conversationId,
    spec.message.exactContent,
    JSON.stringify([spec.message.id]),
    spec.message.actorId,
    spec.message.originalTimestamp,
    preparedAt,
    EXTRACTION_METHOD,
    EXTRACTION_VERSION,
    JSON.stringify(spec.metadata),
  )));

  const materialized = await Promise.all(specs.map((spec) => first<Row>(db.prepare(
    "SELECT * FROM events WHERE id = ? AND project_id = ? AND conversation_id = ? LIMIT 1",
  ).bind(spec.id, projectId, conversationId))));
  const missingMessageIds = specs
    .filter((spec, index) => !materialized[index] || !eventMatches(materialized[index]!, spec, projectId, conversationId))
    .map((spec) => spec.message.id);
  if (missingMessageIds.length) {
    return blocked(
      record.messageCount,
      materialized.filter(Boolean).length,
      specs.map((spec) => spec.id),
      missingMessageIds,
      `Canonical source events could not be verified for ${missingMessageIds.length} eligible immutable message${missingMessageIds.length === 1 ? "" : "s"}.`,
    );
  }

  let attachedEventCount = 0;
  if (caseId) {
    const link = await first<Row>(db.prepare(
      `SELECT id FROM conversation_case_links
       WHERE project_id = ? AND conversation_id = ? AND case_id = ? AND ended_at IS NULL
       LIMIT 1`,
    ).bind(projectId, conversationId, caseId));
    if (!link) {
      return blocked(
        record.messageCount,
        materialized.length,
        specs.map((spec) => spec.id),
        [],
        "The active case is not linked to this Exact imported conversation.",
      );
    }
    const attachmentSpecs = await Promise.all(specs.map(async (spec) => ({
      eventId: spec.id,
      id: `case-event:exact-message:${(await sha256(`${projectId}\n${caseId}\n${spec.id}`)).slice(0, 32)}`,
    })));
    const attachedBefore = await Promise.all(attachmentSpecs.map((attachment) => first<Row>(db.prepare(
      `SELECT id FROM case_event_attachments
       WHERE id = ? AND project_id = ? AND case_id = ? AND event_id = ? AND ended_at IS NULL
       LIMIT 1`,
    ).bind(attachment.id, projectId, caseId, attachment.eventId))));
    await db.batch(attachmentSpecs.map((attachment) => db.prepare(
      `INSERT OR IGNORE INTO case_event_attachments (
        id, project_id, case_id, event_id, attachment_state, attached_by,
        attachment_reason, created_at
      ) VALUES (?, ?, ?, ?, 'attached', 'atlas_source_preparation', ?, ?)`,
    ).bind(
      attachment.id,
      projectId,
      caseId,
      attachment.eventId,
      "Exact imported message prepared for the active case.",
      preparedAt,
    )));
    const attachedAfter = await Promise.all(attachmentSpecs.map((attachment) => first<Row>(db.prepare(
      `SELECT id FROM case_event_attachments
       WHERE id = ? AND project_id = ? AND case_id = ? AND event_id = ? AND ended_at IS NULL
       LIMIT 1`,
    ).bind(attachment.id, projectId, caseId, attachment.eventId))));
    if (attachedAfter.some((attachment) => !attachment)) {
      return blocked(
        record.messageCount,
        materialized.length,
        specs.map((spec) => spec.id),
        [],
        "Canonical source events could not be attached to the active case.",
      );
    }
    attachedEventCount = attachedBefore.filter((attachment) => !attachment).length;
  }

  const createdEventCount = existingBefore.filter((event) => !event).length;
  return {
    eligible: true,
    status: createdEventCount > 0 ? "prepared" : "already_prepared",
    expectedMessageCount: record.messageCount,
    materializedEventCount: materialized.length,
    createdEventCount,
    attachedEventCount,
    eventIds: specs.map((spec) => spec.id),
    missingMessageIds: [],
    requirement: null,
  };
}
