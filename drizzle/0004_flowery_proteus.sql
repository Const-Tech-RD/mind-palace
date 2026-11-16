CREATE TABLE `placements` (
	`room_id` text NOT NULL,
	`instance` text NOT NULL,
	`slot` text,
	`variant` text,
	`hidden` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`room_id`, `instance`)
);
