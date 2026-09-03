CREATE TABLE `project_deletion_authorizations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`confirmed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DROP TRIGGER `messages_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `messages_immutable_delete` BEFORE DELETE ON `messages`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'Canonical messages are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `conversation_imports_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `conversation_imports_immutable_delete` BEFORE DELETE ON `conversation_imports`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'Conversation import sources are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `reasoning_node_versions_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `reasoning_node_versions_immutable_delete` BEFORE DELETE ON `reasoning_node_versions`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'reasoning node versions are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `finding_versions_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `finding_versions_immutable_delete` BEFORE DELETE ON `finding_versions`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'finding versions are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `mechanism_versions_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `mechanism_versions_immutable_delete` BEFORE DELETE ON `mechanism_versions`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'mechanism versions are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `governance_events_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `governance_events_immutable_delete` BEFORE DELETE ON `governance_events`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'governance events are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `roadway_versions_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `roadway_versions_immutable_delete` BEFORE DELETE ON `roadway_versions`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'roadway versions are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `packets_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `packets_immutable_delete` BEFORE DELETE ON `packets`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'packets are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `packet_items_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `packet_items_immutable_delete` BEFORE DELETE ON `packet_items`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'packet items are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `receipts_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `receipts_immutable_delete` BEFORE DELETE ON `receipts`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `handoffs_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `handoffs_immutable_delete` BEFORE DELETE ON `handoffs`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'handoffs are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `handoff_lifecycle_events_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `handoff_lifecycle_events_immutable_delete` BEFORE DELETE ON `handoff_lifecycle_events`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'handoff lifecycle events are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `handoff_answers_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `handoff_answers_immutable_delete` BEFORE DELETE ON `handoff_answers`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'handoff answers are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `handoff_receipts_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `handoff_receipts_immutable_delete` BEFORE DELETE ON `handoff_receipts`
WHEN COALESCE((SELECT `status` FROM `projects` WHERE `id` = OLD.`project_id`), '') != 'deleting'
BEGIN SELECT RAISE(ABORT, 'handoff receipts are immutable'); END;
