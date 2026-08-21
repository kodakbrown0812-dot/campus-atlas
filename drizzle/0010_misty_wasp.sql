CREATE TABLE `transfer_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`transfer_run_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`stage` text NOT NULL,
	`outcome` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_run_id`) REFERENCES `transfer_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_run_events_stage_outcome` ON `transfer_run_events` (`transfer_run_id`,`attempt_number`,`stage`,`outcome`);--> statement-breakpoint
CREATE TABLE `transfer_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`source_import_id` text,
	`source_fingerprint` text NOT NULL,
	`case_id` text,
	`checkpoint_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`stage` text DEFAULT 'received' NOT NULL,
	`stage_timestamps` text DEFAULT '{}' NOT NULL,
	`expected_counts` text DEFAULT '{}' NOT NULL,
	`actual_counts` text DEFAULT '{}' NOT NULL,
	`generated_record_ids` text DEFAULT '{}' NOT NULL,
	`reconciliation` text DEFAULT '[]' NOT NULL,
	`blocked_reason` text,
	`failure_reason` text,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`origin_deployment_version` text,
	`origin_source_commit` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_import_id`) REFERENCES `conversation_imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_runs_project_fingerprint` ON `transfer_runs` (`project_id`,`source_fingerprint`);