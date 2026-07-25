CREATE TABLE `kv_store` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`input` text DEFAULT '[]' NOT NULL,
	`output` text DEFAULT '[]' NOT NULL,
	`process` text DEFAULT '' NOT NULL,
	`negative` text DEFAULT '' NOT NULL,
	`criteria` text DEFAULT '' NOT NULL,
	`fewshot` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metag` (
	`field_key` text PRIMARY KEY NOT NULL,
	`intent` text,
	`dims` text DEFAULT '[]' NOT NULL,
	`schema` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
