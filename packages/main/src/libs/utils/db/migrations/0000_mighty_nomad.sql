CREATE TABLE
	`kv_store` (
		`key` text PRIMARY KEY NOT NULL,
		`value` text NOT NULL,
		`updated_at` text DEFAULT CURRENT_TIMESTAMP
	);

--> statement-breakpoint
CREATE INDEX `idx_kv_store_updated_at` ON `kv_store` (`updated_at`);

--> statement-breakpoint
CREATE TABLE
	`capabilities` (
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
CREATE INDEX `idx_capabilities_updated_at` ON `capabilities` (`updated_at`);

--> statement-breakpoint
CREATE TABLE
	`metag` (
		`field_key` text PRIMARY KEY NOT NULL,
		`intent` text,
		`dims` text DEFAULT '[]' NOT NULL,
		`schema` text,
		`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
		`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
	);

--> statement-breakpoint
CREATE INDEX `idx_metag_updated_at` ON `metag` (`updated_at`);

--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS "kv_store_fts" USING fts5 ("key");

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "kv_store_after_insert" AFTER INSERT ON "kv_store" BEGIN
INSERT INTO
	"kv_store_fts" ("key")
VALUES
	(new."key");

END;

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "kv_store_after_update" AFTER
UPDATE OF "key" ON "kv_store" BEGIN
UPDATE "kv_store_fts"
SET
	"key" = new."key"
WHERE
	"key" = old."key";

END;

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "kv_store_after_delete" AFTER DELETE ON "kv_store" BEGIN
DELETE FROM "kv_store_fts"
WHERE
	"key" = old."key";

END;