ALTER TABLE products ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE looks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE products SET position = -rowid;
--> statement-breakpoint
UPDATE looks SET position = -rowid;
