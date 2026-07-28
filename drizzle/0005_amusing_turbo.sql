ALTER TABLE `governance_events` ADD `prior_status` text;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `new_status` text;--> statement-breakpoint
ALTER TABLE `governance_events` ADD `affected_mechanism_id` text REFERENCES mechanisms(id);--> statement-breakpoint
ALTER TABLE `governance_events` ADD `rollback_of_event_id` text;--> statement-breakpoint
ALTER TABLE `mechanisms` ADD `source_finding_id` text REFERENCES findings(id);
--> statement-breakpoint
CREATE TRIGGER `reasoning_node_versions_immutable_update`
BEFORE UPDATE ON `reasoning_node_versions`
BEGIN
  SELECT RAISE(ABORT, 'reasoning node versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `reasoning_node_versions_immutable_delete`
BEFORE DELETE ON `reasoning_node_versions`
BEGIN
  SELECT RAISE(ABORT, 'reasoning node versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `finding_versions_immutable_update`
BEFORE UPDATE ON `finding_versions`
BEGIN
  SELECT RAISE(ABORT, 'finding versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `finding_versions_immutable_delete`
BEFORE DELETE ON `finding_versions`
BEGIN
  SELECT RAISE(ABORT, 'finding versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `mechanism_versions_immutable_update`
BEFORE UPDATE ON `mechanism_versions`
BEGIN
  SELECT RAISE(ABORT, 'mechanism versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `mechanism_versions_immutable_delete`
BEFORE DELETE ON `mechanism_versions`
BEGIN
  SELECT RAISE(ABORT, 'mechanism versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `governance_events_immutable_update`
BEFORE UPDATE ON `governance_events`
BEGIN
  SELECT RAISE(ABORT, 'governance events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `governance_events_immutable_delete`
BEFORE DELETE ON `governance_events`
BEGIN
  SELECT RAISE(ABORT, 'governance events are immutable');
END;
