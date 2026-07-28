CREATE TABLE `handoff_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`handoff_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`provider_response_id` text NOT NULL,
	`receiving_provider` text NOT NULL,
	`receiving_model` text NOT NULL,
	`answer_text` text NOT NULL,
	`answer_timestamp` text NOT NULL,
	`canonical_message_reference` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handoff_id`) REFERENCES `handoffs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_id`) REFERENCES `packets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_answers_handoff` ON `handoff_answers` (`handoff_id`);--> statement-breakpoint
CREATE TABLE `handoff_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`handoff_id` text NOT NULL,
	`status` text NOT NULL,
	`provider_response_id` text,
	`failure_category` text,
	`failure_reason` text,
	`additional_live_retrieval` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handoff_id`) REFERENCES `handoffs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_lifecycle_status` ON `handoff_lifecycle_events` (`handoff_id`,`status`);--> statement-breakpoint
CREATE TABLE `handoff_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`handoff_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`packet_receipt_id` text NOT NULL,
	`lineage` text DEFAULT '[]' NOT NULL,
	`treatment_summary` text DEFAULT '{}' NOT NULL,
	`authority_and_scope` text DEFAULT '{}' NOT NULL,
	`freshness_summary` text DEFAULT '{}' NOT NULL,
	`inference_disclosure` text,
	`unresolved_conflicts` text DEFAULT '[]' NOT NULL,
	`governance_causes` text DEFAULT '[]' NOT NULL,
	`packet_difference` text DEFAULT '[]' NOT NULL,
	`additional_live_retrieval` text DEFAULT '{}' NOT NULL,
	`final_answer_reference` text,
	`historical_limitations` text DEFAULT '[]' NOT NULL,
	`honesty_statement` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handoff_id`) REFERENCES `handoffs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_id`) REFERENCES `packets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`packet_receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_receipts_handoff` ON `handoff_receipts` (`handoff_id`);--> statement-breakpoint
ALTER TABLE `handoffs` ADD `packet_snapshot_hash` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `primary_roadway_id` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `primary_roadway_version_id` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `receiving_provider` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `actor_id` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `request_fingerprint` text;--> statement-breakpoint
ALTER TABLE `handoffs` ADD `metadata` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE TRIGGER `handoffs_immutable_update`
BEFORE UPDATE ON `handoffs`
BEGIN
  SELECT RAISE(ABORT, 'handoffs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoffs_immutable_delete`
BEFORE DELETE ON `handoffs`
BEGIN
  SELECT RAISE(ABORT, 'handoffs are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_lifecycle_events_immutable_update`
BEFORE UPDATE ON `handoff_lifecycle_events`
BEGIN
  SELECT RAISE(ABORT, 'handoff lifecycle events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_lifecycle_events_immutable_delete`
BEFORE DELETE ON `handoff_lifecycle_events`
BEGIN
  SELECT RAISE(ABORT, 'handoff lifecycle events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_answers_immutable_update`
BEFORE UPDATE ON `handoff_answers`
BEGIN
  SELECT RAISE(ABORT, 'handoff answers are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_answers_immutable_delete`
BEFORE DELETE ON `handoff_answers`
BEGIN
  SELECT RAISE(ABORT, 'handoff answers are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_receipts_immutable_update`
BEFORE UPDATE ON `handoff_receipts`
BEGIN
  SELECT RAISE(ABORT, 'handoff receipts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `handoff_receipts_immutable_delete`
BEFORE DELETE ON `handoff_receipts`
BEGIN
  SELECT RAISE(ABORT, 'handoff receipts are immutable');
END;
