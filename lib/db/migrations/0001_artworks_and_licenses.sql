CREATE TABLE "artwork_licenses" (
	"id" text PRIMARY KEY NOT NULL,
	"artwork_id" text NOT NULL,
	"artist_bar_id" text NOT NULL,
	"venue_bar_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"display_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" text PRIMARY KEY NOT NULL,
	"artist_bar_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"medium" text DEFAULT 'image' NOT NULL,
	"media_path" text NOT NULL,
	"model_glb_path" text,
	"model_usdz_path" text,
	"real_height_cm" real,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"license_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'listed' NOT NULL,
	"original_work_attested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "displays" ADD COLUMN "artwork_id" text;--> statement-breakpoint
ALTER TABLE "artwork_licenses" ADD CONSTRAINT "artwork_licenses_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_licenses" ADD CONSTRAINT "artwork_licenses_artist_bar_id_bars_id_fk" FOREIGN KEY ("artist_bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_licenses" ADD CONSTRAINT "artwork_licenses_venue_bar_id_bars_id_fk" FOREIGN KEY ("venue_bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_licenses" ADD CONSTRAINT "artwork_licenses_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_artist_bar_id_bars_id_fk" FOREIGN KEY ("artist_bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artwork_licenses_artist_idx" ON "artwork_licenses" USING btree ("artist_bar_id");--> statement-breakpoint
CREATE INDEX "artwork_licenses_venue_idx" ON "artwork_licenses" USING btree ("venue_bar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_licenses_once_per_venue" ON "artwork_licenses" USING btree ("artwork_id","venue_bar_id");--> statement-breakpoint
CREATE INDEX "artworks_artist_idx" ON "artworks" USING btree ("artist_bar_id");--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE set null ON UPDATE no action;