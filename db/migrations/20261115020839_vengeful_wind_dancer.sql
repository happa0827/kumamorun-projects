CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`email` text,
	`account_id` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`notified_at` integer,
	CONSTRAINT "contact_messages_category" CHECK("contact_messages"."category" IN ('question', 'bug', 'idea', 'other'))
);
--> statement-breakpoint
CREATE INDEX `contact_messages_time` ON `contact_messages` (`created_at`);