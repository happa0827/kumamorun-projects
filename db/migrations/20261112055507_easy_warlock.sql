ALTER TABLE `family_invites` ADD `id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `family_invites_id_unique` ON `family_invites` (`id`);--> statement-breakpoint
ALTER TABLE `progress` ADD `evolved_on` text;