CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`item_name` text NOT NULL,
	`price` integer NOT NULL,
	`purchased_at` integer NOT NULL,
	CONSTRAINT "purchases_price_positive" CHECK("purchases"."price" >= 1)
);
--> statement-breakpoint
CREATE INDEX `purchases_account_time` ON `purchases` (`account_id`,`purchased_at`);--> statement-breakpoint
CREATE TABLE `shop` (
	`account_id` text PRIMARY KEY NOT NULL,
	`items_json` text NOT NULL,
	`notify_emails_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
