CREATE TABLE `avatars` (
	`account_id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
