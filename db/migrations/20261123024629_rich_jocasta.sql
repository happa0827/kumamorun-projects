CREATE TABLE `approvals` (
	`account_id` text PRIMARY KEY NOT NULL,
	`approved_at` integer NOT NULL,
	`approved_by` text,
	`note` text
);
--> statement-breakpoint
-- 既存アカウントの移行（docs/demo-edition.md）。今使っている人は完全版のままにする。
-- このマイグレーションが本番に流れる時点（公開の時点）のアカウントすべてに、1回だけ行を入れる。
INSERT INTO `approvals` (`account_id`, `approved_at`, `approved_by`, `note`)
SELECT `id`, unixepoch() * 1000, NULL, '既存の利用者'
FROM `user`
WHERE `id` NOT IN (SELECT `account_id` FROM `approvals`);
