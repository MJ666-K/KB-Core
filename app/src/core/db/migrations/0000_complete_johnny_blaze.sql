CREATE TYPE "public"."document_status" AS ENUM('pending', 'parsing', 'chunking', 'embedding', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."embedding_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingest_stage" AS ENUM('parse', 'chunk', 'embed');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "agent_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_log_id" uuid,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_iterations" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"parent_id" uuid,
	"parent_chunk_index" integer NOT NULL,
	"child_index_within_parent" integer,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1024),
	"embedding_status" "embedding_status" DEFAULT 'pending' NOT NULL,
	"scope" text DEFAULT 'platform' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "datasets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"doc_type" text DEFAULT 'general' NOT NULL,
	"source_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"content_hash" text,
	"file_size" integer NOT NULL,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"error_msg" text,
	"embedding_model" text,
	"scope" text DEFAULT 'platform' NOT NULL,
	"owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"stage" "ingest_stage" NOT NULL,
	"status" "ingest_status" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"dataset_id" uuid,
	"answer" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_document_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunk_parent_idx" ON "chunks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "chunk_dataset_idx" ON "chunks" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chunk_doc_parent_child_uniq" ON "chunks" USING btree ("document_id","parent_chunk_index","child_index_within_parent");