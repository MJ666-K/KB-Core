ALTER TABLE "chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;--> statement-breakpoint
CREATE INDEX "chunk_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_parent_id_fkey";--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
