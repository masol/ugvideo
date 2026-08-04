CREATE INDEX "idx_kv_store_updated_at" ON "kv_store" ("updated_at");

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