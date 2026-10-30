ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_display_id_displays_id_fk";
--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "display_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "qr_codes" SET "display_ids" = ARRAY["display_id"] WHERE "display_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" DROP COLUMN "display_id";
