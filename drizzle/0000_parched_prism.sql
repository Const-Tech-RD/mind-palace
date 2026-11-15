CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`room_id` text,
	`room_source` text,
	`classified_at` text,
	`sdk_session_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_message_at` text
);
--> statement-breakpoint
CREATE INDEX `chats_room_idx` ON `chats` (`room_id`);--> statement-breakpoint
CREATE INDEX `chats_last_message_idx` ON `chats` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `goal_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`room_id` text NOT NULL,
	`local_day` text NOT NULL,
	`counted` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goal_completions_room_day_idx` ON `goal_completions` (`room_id`,`local_day`);--> statement-breakpoint
CREATE INDEX `goal_completions_project_idx` ON `goal_completions` (`project_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`tokens_in` integer,
	`tokens_out` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_chat_idx` ON `messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_chats` (
	`project_id` text NOT NULL,
	`chat_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `chat_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_chats_chat_idx` ON `project_chats` (`chat_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`room_id` text NOT NULL,
	`origin_chat_id` text,
	`state` text DEFAULT 'suggested' NOT NULL,
	`next_step` text,
	`last_activity_at` text,
	`snoozed_until` text,
	`reminders_sent` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`origin_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `projects_room_state_idx` ON `projects` (`room_id`,`state`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`due_at` text NOT NULL,
	`sent_at` text,
	`message` text,
	`action` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminders_project_idx` ON `reminders` (`project_id`);--> statement-breakpoint
CREATE INDEX `reminders_due_idx` ON `reminders` (`due_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
