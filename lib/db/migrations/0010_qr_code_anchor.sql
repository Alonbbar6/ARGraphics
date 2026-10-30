ALTER TABLE "qr_codes" ADD COLUMN "anchor" text DEFAULT 'qr' NOT NULL;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "qr_width_cm" numeric(5, 2) DEFAULT '4' NOT NULL;