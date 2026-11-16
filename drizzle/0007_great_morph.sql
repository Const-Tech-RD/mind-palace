CREATE TABLE `chat_digests` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`through_message_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_files` (
	`chat_id` text NOT NULL,
	`path` text NOT NULL,
	`edits` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `path`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `milestone_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`milestone_id` text,
	`title` text NOT NULL,
	`after_id` text,
	`evidence` text NOT NULL,
	`evidence_ref` text,
	`done_on` text,
	`answered` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestone_proposals_project_idx` ON `milestone_proposals` (`project_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`done_on` text,
	`evidence` text NOT NULL,
	`evidence_ref` text,
	`edited` integer DEFAULT false NOT NULL,
	`status_by_user` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestones_project_idx` ON `milestones` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `sweep_dismissals` (
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `chat_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `cwd` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `git_root` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `folder_source` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `swept_at` text;