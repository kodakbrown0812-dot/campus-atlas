ALTER TABLE `findings` ADD `authority_state` text DEFAULT 'proposed' NOT NULL;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `prior_return_condition` text;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `new_return_condition` text;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `prior_expires_at` text;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `new_expires_at` text;