import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const atlasState = sqliteTable("atlas_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  ownerActorId: text("owner_actor_id").notNull(),
  visibility: text("visibility").notNull().default("private"),
  status: text("status").notNull().default("active"),
  schemaVersion: integer("schema_version").notNull().default(17),
  legacyProjectKey: text("legacy_project_key"),
  metadata: text("metadata").notNull().default("{}"),
  ...timestamps,
}, (table) => [uniqueIndex("projects_workspace_legacy_key").on(table.workspaceId, table.legacyProjectKey)]);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  sourceType: text("source_type").notNull(),
  title: text("title").notNull(),
  provenance: text("provenance").notNull().default("{}"),
  importId: text("import_id"),
  activeCaseId: text("active_case_id"),
  status: text("status").notNull().default("active"),
  originalStartedAt: text("original_started_at"),
  originalEndedAt: text("original_ended_at"),
  legacyReference: text("legacy_reference"),
  metadata: text("metadata").notNull().default("{}"),
  ...timestamps,
}, (table) => [uniqueIndex("conversations_project_import").on(table.projectId, table.importId)]);

export const conversationImports = sqliteTable("conversation_imports", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  importId: text("import_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceType: text("source_type").notNull(),
  representationType: text("representation_type").notNull(),
  authorityState: text("authority_state").notNull().default("observed"),
  provenance: text("provenance").notNull().default("{}"),
  sourceFormat: text("source_format").notNull(),
  sourceName: text("source_name"),
  rawSource: text("raw_source").notNull(),
  contentHash: text("content_hash").notNull(),
  messageCount: integer("message_count").notNull(),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  diagnostics: text("diagnostics").notNull().default("{}"),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("conversation_imports_project_import").on(table.projectId, table.importId),
  uniqueIndex("conversation_imports_project_idempotency").on(table.projectId, table.idempotencyKey),
  uniqueIndex("conversation_imports_project_content_hash").on(table.projectId, table.contentHash),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  sequenceNumber: integer("sequence_number").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  exactContent: text("exact_content").notNull(),
  originalTimestamp: text("original_timestamp"),
  ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sourceReference: text("source_reference"),
  sourceMessageKey: text("source_message_key"),
  contentHash: text("content_hash").notNull(),
  legacyReference: text("legacy_reference"),
  metadata: text("metadata").notNull().default("{}"),
}, (table) => [
  uniqueIndex("messages_conversation_sequence").on(table.conversationId, table.sequenceNumber),
  uniqueIndex("messages_conversation_source_key").on(table.conversationId, table.sourceMessageKey),
]);

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  objective: text("objective").notNull(),
  currentThesis: text("current_thesis"),
  currentDecision: text("current_decision"),
  status: text("status").notNull().default("active"),
  timeHorizon: text("time_horizon"),
  scope: text("scope").notNull().default("local"),
  activeConstraints: text("active_constraints").notNull().default("[]"),
  caseCore: text("case_core").notNull().default("{}"),
  outcomeState: text("outcome_state"),
  outcomeSummary: text("outcome_summary"),
  postmortemState: text("postmortem_state"),
  legacyReference: text("legacy_reference"),
  metadata: text("metadata").notNull().default("{}"),
  closedAt: text("closed_at"),
  ...timestamps,
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  caseId: text("case_id").references(() => cases.id),
  eventType: text("event_type").notNull(),
  exactSourceSpan: text("exact_source_span").notNull(),
  compressedRepresentation: text("compressed_representation"),
  sourceMessageIds: text("source_message_ids").notNull().default("[]"),
  actorId: text("actor_id"),
  observedAt: text("observed_at"),
  ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  invalidatedAt: text("invalidated_at"),
  extractionMethod: text("extraction_method").notNull(),
  extractionVersion: text("extraction_version").notNull(),
  confidence: integer("confidence"),
  authorityState: text("authority_state").notNull().default("observed"),
  assignmentState: text("assignment_state").notNull().default("unassigned"),
  version: integer("version").notNull().default(1),
  legacyReference: text("legacy_reference"),
  metadata: text("metadata").notNull().default("{}"),
});

export const conversationCaseLinks = sqliteTable("conversation_case_links", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  caseId: text("case_id").notNull().references(() => cases.id),
  relationshipState: text("relationship_state").notNull().default("associated"),
  linkedBy: text("linked_by").notNull(),
  linkReason: text("link_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: text("ended_at"),
  supersedesLinkId: text("supersedes_link_id"),
}, (table) => [uniqueIndex("conversation_case_links_active")
  .on(table.conversationId, table.caseId)
  .where(sql`${table.endedAt} IS NULL`)]);

export const caseEventAttachments = sqliteTable("case_event_attachments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  caseId: text("case_id").notNull().references(() => cases.id),
  eventId: text("event_id").notNull().references(() => events.id),
  attachmentState: text("attachment_state").notNull(),
  attachedBy: text("attached_by").notNull(),
  attachmentReason: text("attachment_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: text("ended_at"),
  supersedesAttachmentId: text("supersedes_attachment_id"),
});

export const caseBoundaryProposals = sqliteTable("case_boundary_proposals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  operationType: text("operation_type").notNull(),
  sourceCaseIds: text("source_case_ids").notNull().default("[]"),
  targetCaseId: text("target_case_id").references(() => cases.id),
  eventIds: text("event_ids").notNull().default("[]"),
  proposalState: text("proposal_state").notNull().default("proposed"),
  proposedBy: text("proposed_by").notNull(),
  proposalReason: text("proposal_reason").notNull(),
  appliedOperationId: text("applied_operation_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});

export const caseBoundaryOperations = sqliteTable("case_boundary_operations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  proposalId: text("proposal_id").references(() => caseBoundaryProposals.id),
  operationType: text("operation_type").notNull(),
  operationPayload: text("operation_payload").notNull(),
  appliedBy: text("applied_by").notNull(),
  operationReason: text("operation_reason").notNull(),
  reverseOfOperationId: text("reverse_of_operation_id"),
  reversedByOperationId: text("reversed_by_operation_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reasoningNodes = sqliteTable("reasoning_nodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  caseId: text("case_id").notNull().references(() => cases.id),
  nodeType: text("node_type").notNull(),
  currentVersionId: text("current_version_id"),
  scope: text("scope").notNull().default("local"),
  authorityState: text("authority_state").notNull().default("inferred"),
  status: text("status").notNull().default("active"),
  legacyReference: text("legacy_reference"),
  ...timestamps,
});

export const reasoningNodeVersions = sqliteTable("reasoning_node_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  reasoningNodeId: text("reasoning_node_id").notNull().references(() => reasoningNodes.id),
  statement: text("statement").notNull(),
  representationType: text("representation_type").notNull(),
  sourceEventIds: text("source_event_ids").notNull().default("[]"),
  evidenceLinks: text("evidence_links").notNull().default("[]"),
  counterevidenceLinks: text("counterevidence_links").notNull().default("[]"),
  uncertainty: text("uncertainty"),
  confidence: integer("confidence"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  supersedesVersionId: text("supersedes_version_id"),
});

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  caseId: text("case_id").notNull().references(() => cases.id),
  checkpointId: text("checkpoint_id"),
  findingType: text("finding_type").notNull(),
  sourceEventIds: text("source_event_ids").notNull().default("[]"),
  currentVersionId: text("current_version_id"),
  status: text("status").notNull().default("proposed"),
  reviewRequired: integer("review_required", { mode: "boolean" }).notNull().default(true),
  returnCondition: text("return_condition"),
  expiresAt: text("expires_at"),
  legacyReference: text("legacy_reference"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
});

export const findingVersions = sqliteTable("finding_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  findingId: text("finding_id").notNull().references(() => findings.id),
  proposalStatement: text("proposal_statement").notNull(),
  proposedScope: text("proposed_scope").notNull(),
  conditions: text("conditions").notNull().default("[]"),
  exclusions: text("exclusions").notNull().default("[]"),
  supportingEvidence: text("supporting_evidence").notNull().default("[]"),
  counterevidence: text("counterevidence").notNull().default("[]"),
  uncertainty: text("uncertainty"),
  reasonForSurfacing: text("reason_for_surfacing").notNull(),
  expectedRetrievalEffect: text("expected_retrieval_effect").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  supersedesVersionId: text("supersedes_version_id"),
});

export const mechanisms = sqliteTable("mechanisms", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  currentGoverningVersionId: text("current_governing_version_id"),
  status: text("status").notNull().default("proposed"),
  legacyReference: text("legacy_reference"),
  ...timestamps,
});

export const mechanismVersions = sqliteTable("mechanism_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  mechanismId: text("mechanism_id").notNull().references(() => mechanisms.id),
  statement: text("statement").notNull(),
  scopeConditions: text("scope_conditions").notNull().default("[]"),
  exclusions: text("exclusions").notNull().default("[]"),
  supportingCaseIds: text("supporting_case_ids").notNull().default("[]"),
  supportingNodeIds: text("supporting_node_ids").notNull().default("[]"),
  counterevidenceIds: text("counterevidence_ids").notNull().default("[]"),
  realityContact: text("reality_contact"),
  authorityState: text("authority_state").notNull().default("proposed"),
  intendedRetrievalEffect: text("intended_retrieval_effect").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  supersedesVersionId: text("supersedes_version_id"),
});

export const governanceEvents = sqliteTable("governance_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  sourceVersionId: text("source_version_id"),
  resultingVersionId: text("resulting_version_id"),
  priorAuthority: text("prior_authority"),
  newAuthority: text("new_authority"),
  priorScope: text("prior_scope"),
  newScope: text("new_scope"),
  reason: text("reason"),
  retrievalEffect: text("retrieval_effect").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  idempotencyKey: text("idempotency_key").notNull(),
}, (table) => [uniqueIndex("governance_project_idempotency").on(table.projectId, table.idempotencyKey)]);

export const roadways = sqliteTable("roadways", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  currentVersionId: text("current_version_id"),
  status: text("status").notNull().default("proposed"),
  legacyReference: text("legacy_reference"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const roadwayVersions = sqliteTable("roadway_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  roadwayId: text("roadway_id").notNull().references(() => roadways.id),
  purpose: text("purpose").notNull(),
  intentPatterns: text("intent_patterns").notNull().default("[]"),
  nonApplicablePatterns: text("non_applicable_patterns").notNull().default("[]"),
  requiredChecks: text("required_checks").notNull().default("[]"),
  supportingMechanismModules: text("supporting_mechanism_modules").notNull().default("[]"),
  requiredLiveState: text("required_live_state").notNull().default("[]"),
  expectedChallenges: text("expected_challenges").notNull().default("[]"),
  wideningRules: text("widening_rules").notNull().default("[]"),
  narrowingRules: text("narrowing_rules").notNull().default("[]"),
  stopConditions: text("stop_conditions").notNull().default("[]"),
  packetContract: text("packet_contract").notNull().default("{}"),
  authorityState: text("authority_state").notNull().default("proposed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const packets = sqliteTable("packets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  caseId: text("case_id").references(() => cases.id),
  task: text("task").notNull(),
  inferredIntent: text("inferred_intent").notNull(),
  primaryRoadwayId: text("primary_roadway_id").references(() => roadways.id),
  primaryRoadwayVersionId: text("primary_roadway_version_id"),
  supportingModules: text("supporting_modules").notNull().default("[]"),
  tokenBudget: integer("token_budget").notNull(),
  compiledContent: text("compiled_content").notNull(),
  priorComparablePacketId: text("prior_comparable_packet_id"),
  status: text("status").notNull(),
  compilationError: text("compilation_error"),
  legacyReference: text("legacy_reference"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const packetItems = sqliteTable("packet_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  packetId: text("packet_id").notNull().references(() => packets.id),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceVersionId: text("source_version_id"),
  treatment: text("treatment").notNull(),
  representationType: text("representation_type").notNull(),
  scope: text("scope").notNull(),
  authorityState: text("authority_state").notNull(),
  freshness: text("freshness"),
  inclusionReason: text("inclusion_reason"),
  exclusionReason: text("exclusion_reason"),
  sequenceOrder: integer("sequence_order").notNull(),
});

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  packetId: text("packet_id").notNull().references(() => packets.id),
  selectedRoadwayReason: text("selected_roadway_reason").notNull(),
  alternativeRoadwaysConsidered: text("alternative_roadways_considered").notNull().default("[]"),
  candidateTreatmentSummary: text("candidate_treatment_summary").notNull().default("{}"),
  governanceCauses: text("governance_causes").notNull().default("[]"),
  freshnessSummary: text("freshness_summary"),
  inferenceDisclosure: text("inference_disclosure"),
  unresolvedConflicts: text("unresolved_conflicts").notNull().default("[]"),
  diffSummary: text("diff_summary"),
  legacyReference: text("legacy_reference"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const handoffs = sqliteTable("handoffs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  packetId: text("packet_id").notNull().references(() => packets.id),
  originalTask: text("original_task").notNull(),
  receivingModel: text("receiving_model").notNull(),
  handoffAt: text("handoff_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  additionalLiveRetrieval: text("additional_live_retrieval").notNull().default("[]"),
  finalAnswerReference: text("final_answer_reference"),
  handoffStatus: text("handoff_status").notNull(),
  failureReason: text("failure_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
}, (table) => [uniqueIndex("handoffs_project_idempotency").on(table.projectId, table.idempotencyKey)]);
