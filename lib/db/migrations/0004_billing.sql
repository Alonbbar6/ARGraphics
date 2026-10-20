CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_slots" (
	"bar_id" text PRIMARY KEY NOT NULL,
	"category_key" text NOT NULL,
	"neighborhood_key" text NOT NULL,
	"category_label" text NOT NULL,
	"neighborhood_label" text NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"bar_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "founding_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "build_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "bars" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drinks" ADD COLUMN "generation_credit_ref" text;--> statement-breakpoint
ALTER TABLE "business_slots" ADD CONSTRAINT "business_slots_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_bar_id_bars_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_slots_claim" ON "business_slots" USING btree ("category_key","neighborhood_key");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_once" ON "credit_ledger" USING btree ("reason","reference");--> statement-breakpoint
CREATE INDEX "credit_ledger_bar_idx" ON "credit_ledger" USING btree ("bar_id");--> statement-breakpoint
ALTER TABLE "bars" ADD CONSTRAINT "bars_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "bars" ADD CONSTRAINT "bars_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "bars" ADD CONSTRAINT "bars_build_credits_nonnegative" CHECK ("bars"."build_credits" >= 0);