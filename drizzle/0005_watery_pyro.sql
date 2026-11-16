CREATE TABLE `room_progress` (
	`room_id` text PRIMARY KEY NOT NULL,
	`best_streak` integer DEFAULT 0 NOT NULL,
	`goal_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
