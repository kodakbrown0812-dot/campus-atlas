CREATE TABLE `case_event_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text NOT NULL,
	`event_id` text NOT NULL,
	`attachment_state` text NOT NULL,
	`attached_by` text NOT NULL,
	`attachment_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text,
	`supersedes_attachment_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`objective` text NOT NULL,
	`current_thesis` text,
	`current_decision` text,
	`status` text DEFAULT 'active' NOT NULL,
	`time_horizon` text,
	`scope` text DEFAULT 'local' NOT NULL,
	`active_constraints` text DEFAULT '[]' NOT NULL,
	`case_core` text DEFAULT '{}' NOT NULL,
	`outcome_state` text,
	`outcome_summary` text,
	`postmortem_state` text,
	`legacy_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`provenance` text DEFAULT '{}' NOT NULL,
	`import_id` text,
	`active_case_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`original_started_at` text,
	`original_ended_at` text,
	`legacy_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_project_import` ON `conversations` (`project_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`case_id` text,
	`event_type` text NOT NULL,
	`exact_source_span` text NOT NULL,
	`compressed_representation` text,
	`source_message_ids` text DEFAULT '[]' NOT NULL,
	`actor_id` text,
	`observed_at` text,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`invalidated_at` text,
	`extraction_method` text NOT NULL,
	`extraction_version` text NOT NULL,
	`confidence` integer,
	`authority_state` text DEFAULT 'observed' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`legacy_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `finding_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`proposal_statement` text NOT NULL,
	`proposed_scope` text NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`exclusions` text DEFAULT '[]' NOT NULL,
	`supporting_evidence` text DEFAULT '[]' NOT NULL,
	`counterevidence` text DEFAULT '[]' NOT NULL,
	`uncertainty` text,
	`reason_for_surfacing` text NOT NULL,
	`expected_retrieval_effect` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`supersedes_version_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text NOT NULL,
	`checkpoint_id` text,
	`finding_type` text NOT NULL,
	`source_event_ids` text DEFAULT '[]' NOT NULL,
	`current_version_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`review_required` integer DEFAULT true NOT NULL,
	`return_condition` text,
	`expires_at` text,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `governance_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`source_version_id` text,
	`resulting_version_id` text,
	`prior_authority` text,
	`new_authority` text,
	`prior_scope` text,
	`new_scope` text,
	`reason` text,
	`retrieval_effect` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`idempotency_key` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `governance_project_idempotency` ON `governance_events` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`original_task` text NOT NULL,
	`receiving_model` text NOT NULL,
	`handoff_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`additional_live_retrieval` text DEFAULT '[]' NOT NULL,
	`final_answer_reference` text,
	`handoff_status` text NOT NULL,
	`failure_reason` text,
	`idempotency_key` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_id`) REFERENCES `packets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoffs_project_idempotency` ON `handoffs` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `mechanism_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mechanism_id` text NOT NULL,
	`statement` text NOT NULL,
	`scope_conditions` text DEFAULT '[]' NOT NULL,
	`exclusions` text DEFAULT '[]' NOT NULL,
	`supporting_case_ids` text DEFAULT '[]' NOT NULL,
	`supporting_node_ids` text DEFAULT '[]' NOT NULL,
	`counterevidence_ids` text DEFAULT '[]' NOT NULL,
	`reality_contact` text,
	`authority_state` text DEFAULT 'proposed' NOT NULL,
	`intended_retrieval_effect` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`supersedes_version_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mechanism_id`) REFERENCES `mechanisms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mechanisms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`current_governing_version_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`exact_content` text NOT NULL,
	`original_timestamp` text,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_reference` text,
	`content_hash` text NOT NULL,
	`legacy_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_sequence` ON `messages` (`conversation_id`,`sequence_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_hash` ON `messages` (`conversation_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `packet_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version_id` text,
	`treatment` text NOT NULL,
	`representation_type` text NOT NULL,
	`scope` text NOT NULL,
	`authority_state` text NOT NULL,
	`freshness` text,
	`inclusion_reason` text,
	`exclusion_reason` text,
	`sequence_order` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_id`) REFERENCES `packets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `packets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text,
	`task` text NOT NULL,
	`inferred_intent` text NOT NULL,
	`primary_roadway_id` text,
	`primary_roadway_version_id` text,
	`supporting_modules` text DEFAULT '[]' NOT NULL,
	`token_budget` integer NOT NULL,
	`compiled_content` text NOT NULL,
	`prior_comparable_packet_id` text,
	`status` text NOT NULL,
	`compilation_error` text,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_roadway_id`) REFERENCES `roadways`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner_actor_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`schema_version` integer DEFAULT 17 NOT NULL,
	`legacy_project_key` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_workspace_legacy_key` ON `projects` (`workspace_id`,`legacy_project_key`);--> statement-breakpoint
CREATE TABLE `reasoning_node_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`reasoning_node_id` text NOT NULL,
	`statement` text NOT NULL,
	`representation_type` text NOT NULL,
	`source_event_ids` text DEFAULT '[]' NOT NULL,
	`evidence_links` text DEFAULT '[]' NOT NULL,
	`counterevidence_links` text DEFAULT '[]' NOT NULL,
	`uncertainty` text,
	`confidence` integer,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`supersedes_version_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reasoning_node_id`) REFERENCES `reasoning_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reasoning_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text NOT NULL,
	`node_type` text NOT NULL,
	`current_version_id` text,
	`scope` text DEFAULT 'local' NOT NULL,
	`authority_state` text DEFAULT 'inferred' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`selected_roadway_reason` text NOT NULL,
	`alternative_roadways_considered` text DEFAULT '[]' NOT NULL,
	`candidate_treatment_summary` text DEFAULT '{}' NOT NULL,
	`governance_causes` text DEFAULT '[]' NOT NULL,
	`freshness_summary` text,
	`inference_disclosure` text,
	`unresolved_conflicts` text DEFAULT '[]' NOT NULL,
	`diff_summary` text,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_id`) REFERENCES `packets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roadway_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`roadway_id` text NOT NULL,
	`purpose` text NOT NULL,
	`intent_patterns` text DEFAULT '[]' NOT NULL,
	`non_applicable_patterns` text DEFAULT '[]' NOT NULL,
	`required_checks` text DEFAULT '[]' NOT NULL,
	`supporting_mechanism_modules` text DEFAULT '[]' NOT NULL,
	`required_live_state` text DEFAULT '[]' NOT NULL,
	`expected_challenges` text DEFAULT '[]' NOT NULL,
	`widening_rules` text DEFAULT '[]' NOT NULL,
	`narrowing_rules` text DEFAULT '[]' NOT NULL,
	`stop_conditions` text DEFAULT '[]' NOT NULL,
	`packet_contract` text DEFAULT '{}' NOT NULL,
	`authority_state` text DEFAULT 'proposed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadway_id`) REFERENCES `roadways`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roadways` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`current_version_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`legacy_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
