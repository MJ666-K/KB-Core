CREATE TYPE "public"."dataset_kind" AS ENUM('document', 'kg');--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "kg_node_id" varchar(128);--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "kind" "dataset_kind" DEFAULT 'document' NOT NULL;--> statement-breakpoint
CREATE INDEX "chunk_kg_node_idx" ON "chunks" USING btree ("kg_node_id");