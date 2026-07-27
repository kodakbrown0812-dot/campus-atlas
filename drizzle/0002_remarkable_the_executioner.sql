CREATE TABLE `case_boundary_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`proposal_id` text,
	`operation_type` text NOT NULL,
	`operation_payload` text NOT NULL,
	`applied_by` text NOT NULL,
	`operation_reason` text NOT NULL,
	`reverse_of_operation_id` text,
	`reversed_by_operation_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposal_id`) REFERENCES `case_boundary_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `case_boundary_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`source_case_ids` text DEFAULT '[]' NOT NULL,
	`target_case_id` text,
	`event_ids` text DEFAULT '[]' NOT NULL,
	`proposal_state` text DEFAULT 'proposed' NOT NULL,
	`proposed_by` text NOT NULL,
	`proposal_reason` text NOT NULL,
	`applied_operation_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversation_case_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`case_id` text NOT NULL,
	`relationship_state` text DEFAULT 'associated' NOT NULL,
	`linked_by` text NOT NULL,
	`link_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text,
	`supersedes_link_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_case_links_active` ON `conversation_case_links` (`conversation_id`,`case_id`) WHERE "conversation_case_links"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `conversation_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`import_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`source_type` text NOT NULL,
	`representation_type` text NOT NULL,
	`authority_state` text DEFAULT 'observed' NOT NULL,
	`provenance` text DEFAULT '{}' NOT NULL,
	`source_format` text NOT NULL,
	`source_name` text,
	`raw_source` text NOT NULL,
	`content_hash` text NOT NULL,
	`message_count` integer NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`diagnostics` text DEFAULT '{}' NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_imports_project_import` ON `conversation_imports` (`project_id`,`import_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_imports_project_idempotency` ON `conversation_imports` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_imports_project_content_hash` ON `conversation_imports` (`project_id`,`content_hash`);--> statement-breakpoint
DROP INDEX `messages_conversation_hash`;--> statement-breakpoint
ALTER TABLE `messages` ADD `source_message_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_source_key` ON `messages` (`conversation_id`,`source_message_key`);--> statement-breakpoint
ALTER TABLE `events` ADD `assignment_state` text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
CREATE TRIGGER `messages_immutable_update`
BEFORE UPDATE ON `messages`
BEGIN
	SELECT RAISE(ABORT, 'Canonical messages are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `messages_immutable_delete`
BEFORE DELETE ON `messages`
BEGIN
	SELECT RAISE(ABORT, 'Canonical messages are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `conversation_imports_immutable_update`
BEFORE UPDATE ON `conversation_imports`
BEGIN
	SELECT RAISE(ABORT, 'Conversation import sources are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `conversation_imports_immutable_delete`
BEFORE DELETE ON `conversation_imports`
BEGIN
	SELECT RAISE(ABORT, 'Conversation import sources are immutable');
END;
