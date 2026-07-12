CREATE TABLE "excel_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_ids" uuid[] NOT NULL,
	"dataset_id" uuid,
	"file_count" integer NOT NULL,
	"file_names" text[] NOT NULL,
	"sheets" jsonb NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"merged_duckdb_table" text,
	"business_context" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "excel_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"content" text NOT NULL,
	"pivot_table_ids" uuid[] DEFAULT '{}' NOT NULL,
	"insights" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pivot_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"visualization" jsonb,
	"sql" text NOT NULL,
	"source_sheets" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
