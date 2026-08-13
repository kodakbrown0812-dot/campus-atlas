INSERT INTO `projects` (
	`id`,
	`workspace_id`,
	`name`,
	`description`,
	`owner_actor_id`,
	`visibility`,
	`status`,
	`schema_version`,
	`legacy_project_key`,
	`metadata`,
	`created_at`,
	`updated_at`
)
SELECT
	'sports',
	'slice6a-local',
	'Sports Engine',
	'Canonical Slice 6A browser proof',
	'cody',
	'private',
	'active',
	17,
	NULL,
	'{}',
	'2026-07-29 04:46:15',
	'2026-07-29 04:46:15'
WHERE NOT EXISTS (
	SELECT 1 FROM `projects` WHERE `id` = 'sports'
);
