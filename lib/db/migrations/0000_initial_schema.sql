CREATE TABLE "ar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"drink_id" text NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bars" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"kind" text DEFAULT 'venue' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"neighborhood" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bars_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "displays" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"type" text NOT NULL,
	"placement" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"drink_id" text,
	"media_path" text,
	"offer_title" text,
	"offer_details" text,
	"offer_ends_at" timestamp with time zone,
	"event_starts_at" timestamp with time zone,
	"artist_name" text,
	"artist_bar_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drinks" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'signature' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_photo_url" text,
	"cleaned_photo_url" text,
	"model_glb_url" text,
	"model_usdz_url" text,
	"real_height_cm" real,
	"thumbnail_url" text,
	"generation_status" text DEFAULT 'none' NOT NULL,
	"generation_progress" integer DEFAULT 0 NOT NULL,
	"meshy_task_id" text,
	"generation_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_version" (
	"bar_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"display_id" text,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"placement" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "recovery_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"display_id" text,
	"qr_code_id" text,
	"visitor_hash" text NOT NULL,
	"claim_day" text NOT NULL,
	"confirmation_code" text NOT NULL,
	"display_title" text NOT NULL,
	"offer_title" text NOT NULL,
	"spot_label" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"qr_code_id" text,
	"display_id" text,
	"visitor_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"name" text NOT NULL,
	"reference_image_url" text NOT NULL,
	"physical_width_meters" numeric(7, 5) DEFAULT '0.1' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"password_reset_hash" text,
	"password_reset_expires_at" timestamp with time zone,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "photo_cleanups" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"drink_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"source_photo_path" text NOT NULL,
	"cleaned_photo_path" text,
	"source_size" integer NOT NULL,
	"cleaned_size" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_cleanup_limits" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ar_events" ADD CONSTRAINT "ar_events_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_events" ADD CONSTRAINT "ar_events_drink_id_drinks_id_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_drink_id_drinks_id_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_artist_bar_id_bars_id_fk" FOREIGN KEY ("artist_bar_id") REFERENCES "public"."bars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_version" ADD CONSTRAINT "menu_version_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_cards" ADD CONSTRAINT "table_cards_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_cleanups" ADD CONSTRAINT "photo_cleanups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_cleanups" ADD CONSTRAINT "photo_cleanups_drink_id_drinks_id_fk" FOREIGN KEY ("drink_id") REFERENCES "public"."drinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_cleanup_limits" ADD CONSTRAINT "photo_cleanup_limits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "displays_bar_idx" ON "displays" USING btree ("bar_id");--> statement-breakpoint
CREATE INDEX "displays_artist_idx" ON "displays" USING btree ("artist_bar_id");--> statement-breakpoint
CREATE INDEX "qr_codes_bar_idx" ON "qr_codes" USING btree ("bar_id");--> statement-breakpoint
CREATE INDEX "redemptions_bar_time_idx" ON "redemptions" USING btree ("bar_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "redemptions_once_per_day" ON "redemptions" USING btree ("display_id","visitor_hash","claim_day");--> statement-breakpoint
CREATE INDEX "scans_bar_time_idx" ON "scans" USING btree ("bar_id","created_at");--> statement-breakpoint
CREATE INDEX "photo_cleanups_owner_drink" ON "photo_cleanups" USING btree ("owner_id","drink_id");