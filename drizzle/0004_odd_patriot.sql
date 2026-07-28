CREATE TABLE `checkpoint_reasoning_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`reasoning_node_id` text NOT NULL,
	`selection_order` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reasoning_node_id`) REFERENCES `reasoning_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_reasoning_nodes_selection` ON `checkpoint_reasoning_nodes` (`checkpoint_id`,`selection_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoint_reasoning_nodes_node` ON `checkpoint_reasoning_nodes` (`checkpoint_id`,`reasoning_node_id`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`trigger` text NOT NULL,
	`source` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`status` text DEFAULT 'preparing' NOT NULL,
	`extraction_version` text NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`selected_count` integer DEFAULT 0 NOT NULL,
	`omitted_count` integer DEFAULT 0 NOT NULL,
	`health_before` text,
	`health_after` text,
	`missing_state` text DEFAULT '[]' NOT NULL,
	`ambiguity` text,
	`error` text,
	`idempotency_key` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_project_idempotency` ON `checkpoints` (`project_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `finding_versions` ADD `proposal_hash` text DEFAULT '' NOT NULL;
