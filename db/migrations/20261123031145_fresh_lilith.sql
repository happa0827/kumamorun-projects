CREATE TABLE `character_releases` (
	`version` text PRIMARY KEY NOT NULL,
	`published_at` integer NOT NULL,
	`published_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `character_releases_time` ON `character_releases` (`published_at`);