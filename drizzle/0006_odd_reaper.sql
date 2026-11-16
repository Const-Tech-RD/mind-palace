CREATE TABLE `area_suggestions` (
	`area` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`dismissed_at` text NOT NULL,
	`dismissed_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`area` text NOT NULL,
	`accent` integer NOT NULL,
	`cell_x` integer NOT NULL,
	`cell_y` integer NOT NULL,
	`signature` text NOT NULL,
	`classifier` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_area_unique` ON `rooms` (`area`);--> statement-breakpoint
ALTER TABLE `chats` ADD `area` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `area_name` text;--> statement-breakpoint
-- Dynamic rooms: the placeholder Coding room, Music studio and Art workshop are gone.
-- Their chats, projects and goals go back to the Mail room; the classifier tags their area later.
UPDATE `chats` SET `room_id` = 'mailroom' WHERE `room_id` IN ('coding', 'music', 'art');--> statement-breakpoint
UPDATE `projects` SET `room_id` = 'mailroom' WHERE `room_id` IN ('coding', 'music', 'art');--> statement-breakpoint
UPDATE `goal_completions` SET `room_id` = 'mailroom' WHERE `room_id` IN ('coding', 'music', 'art');--> statement-breakpoint
DELETE FROM `placements` WHERE `room_id` IN ('coding', 'music', 'art');--> statement-breakpoint
DELETE FROM `room_progress` WHERE `room_id` IN ('coding', 'music', 'art');--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('palace.seen.coding', 'palace.seen.music', 'palace.seen.art');
