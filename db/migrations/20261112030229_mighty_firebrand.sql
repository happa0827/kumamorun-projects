CREATE TABLE `child_sign_in_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `family_invites` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	CONSTRAINT "family_invites_kind" CHECK("family_invites"."kind" IN ('parent', 'child'))
);
--> statement-breakpoint
CREATE TABLE `members` (
	`account_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`family_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "members_kind" CHECK("members"."kind" IN ('adult', 'parent', 'child')),
	CONSTRAINT "members_family_by_kind" CHECK(("members"."kind" = 'adult') = ("members"."family_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `members_family` ON `members` (`family_id`);