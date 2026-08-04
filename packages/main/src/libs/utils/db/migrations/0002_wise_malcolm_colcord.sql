CREATE INDEX `idx_metag_updated_at` ON `capabilities` (`updated_at`);

--> statement-breakpoint
CREATE INDEX `idx_capabilities_updated_at` ON `metag` (`updated_at`);