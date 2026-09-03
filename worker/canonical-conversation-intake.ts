import { importConversation } from "./conversation-cases";
import { requiredString, Row } from "./slice3-support";

export type ConversationSourceAdapter = "manual_paste" | "future_export" | "future_api";

export type CanonicalConversationIntake = {
  adapter: ConversationSourceAdapter;
  title: string;
  format: "text" | "json";
  source: unknown;
};

const SOURCE_ADAPTERS = new Set<ConversationSourceAdapter>([
  "manual_paste",
  "future_export",
  "future_api",
]);

export function normalizeConversationIntake(body: Row): CanonicalConversationIntake {
  const adapter = typeof body.sourceAdapter === "string"
    ? body.sourceAdapter as ConversationSourceAdapter
    : "manual_paste";
  if (!SOURCE_ADAPTERS.has(adapter)) throw new Error("Unsupported room source.");
  const format = body.format === "json" ? "json" : "text";
  return {
    adapter,
    title: requiredString(body.title, "Room title"),
    format,
    source: body.transcript,
  };
}

export async function ingestCanonicalConversation(
  db: D1Database,
  projectId: string,
  intake: CanonicalConversationIntake,
  idempotencyKey: string,
) {
  return importConversation(db, projectId, {
    title: intake.title,
    sourceName: intake.title,
    sourceType: "explicit_transcript_import",
    representationType: "Exact",
    authorityState: "observed",
    format: intake.format,
    transcript: intake.source,
    provenance: {
      importedFrom: "canonical_conversation_intake_v1",
      sourceAdapter: intake.adapter,
    },
    metadata: {
      interface: "transfer_room_v1",
      sourceAdapter: intake.adapter,
      normalizedIntakeContract: "canonical_conversation_intake_v1",
    },
  }, idempotencyKey);
}

export async function ingestRoomSource(
  db: D1Database,
  projectId: string,
  body: Row,
  idempotencyKey: string,
) {
  return ingestCanonicalConversation(
    db,
    projectId,
    normalizeConversationIntake(body),
    idempotencyKey,
  );
}
