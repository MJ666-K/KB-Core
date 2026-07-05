CREATE TABLE "split_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"config" jsonb NOT NULL,
	"parent_tokens" integer NOT NULL,
	"child_tokens" integer NOT NULL,
	"overlap_tokens" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "split_configs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "test_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dataset_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "test_suites_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"expected_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"passed" integer NOT NULL,
	"total" integer NOT NULL,
	"pass_rate" numeric(5, 4) NOT NULL,
	"avg_latency_ms" integer,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_log_id" uuid NOT NULL,
	"accurate" text NOT NULL,
	"citation_accurate" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "query_annotations_query_log_id_unique" UNIQUE("query_log_id")
);
--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
