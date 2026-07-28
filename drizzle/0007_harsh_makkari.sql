CREATE TABLE `live_state_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_id` text,
	`provider` text NOT NULL,
	`source_identity` text NOT NULL,
	`category` text NOT NULL,
	`entity` text NOT NULL,
	`raw_value` text NOT NULL,
	`normalized_value` text DEFAULT '{}' NOT NULL,
	`observed_at` text NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`superseded_at` text,
	`freshness_window_seconds` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`conflict_group` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_state_project_idempotency` ON `live_state_snapshots` (`project_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `packets` ADD `interpretation` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `packets` ADD `final_token_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `packets` ADD `comparison_key` text;--> statement-breakpoint
ALTER TABLE `packets` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `packets_project_idempotency` ON `packets` (`project_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `packet_items_sequence` ON `packet_items` (`packet_id`,`sequence_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_packet` ON `receipts` (`packet_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `roadways_project_name` ON `roadways` (`project_id`,`name`);--> statement-breakpoint
CREATE TRIGGER `roadway_versions_immutable_update`
BEFORE UPDATE ON `roadway_versions`
BEGIN
  SELECT RAISE(ABORT, 'roadway versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `roadway_versions_immutable_delete`
BEFORE DELETE ON `roadway_versions`
BEGIN
  SELECT RAISE(ABORT, 'roadway versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `packets_immutable_update`
BEFORE UPDATE ON `packets`
BEGIN
  SELECT RAISE(ABORT, 'packets are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `packets_immutable_delete`
BEFORE DELETE ON `packets`
BEGIN
  SELECT RAISE(ABORT, 'packets are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `packet_items_immutable_update`
BEFORE UPDATE ON `packet_items`
BEGIN
  SELECT RAISE(ABORT, 'packet items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `packet_items_immutable_delete`
BEFORE DELETE ON `packet_items`
BEGIN
  SELECT RAISE(ABORT, 'packet items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `receipts_immutable_update`
BEFORE UPDATE ON `receipts`
BEGIN
  SELECT RAISE(ABORT, 'receipts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `receipts_immutable_delete`
BEFORE DELETE ON `receipts`
BEGIN
  SELECT RAISE(ABORT, 'receipts are immutable');
END;
