-- 私有库（多租户）+ 多库多智能体：datasets/agents 多租户化 + dataset_members ACL 表
-- 安全顺序：owner_id 先 nullable 加列 → 回填（owner=超管 + visibility=public 存量行）→ SET NOT NULL
CREATE TYPE "public"."dataset_member_role" AS ENUM('viewer', 'editor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."dataset_visibility" AS ENUM('private', 'shared', 'public');--> statement-breakpoint
CREATE TABLE "dataset_members" (
	"dataset_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "dataset_member_role" DEFAULT 'viewer' NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_members_dataset_id_user_id_pk" PRIMARY KEY("dataset_id","user_id")
);--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_name_unique";--> statement-breakpoint
ALTER TABLE "datasets" DROP CONSTRAINT IF EXISTS "datasets_name_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "visibility" "dataset_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "visibility" "dataset_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "chunk_config" jsonb;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "retrieve_config" jsonb;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
-- 回填存量：owner=超管 + visibility=public（系统级共享库/智能体；全新部署表空则影响 0 行）
UPDATE "agents" SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'superadmin' LIMIT 1), "visibility" = 'public' WHERE "owner_id" IS NULL;--> statement-breakpoint
UPDATE "datasets" SET "owner_id" = (SELECT "id" FROM "users" WHERE "role" = 'superadmin' LIMIT 1), "visibility" = 'public' WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dataset_members" ADD CONSTRAINT "dataset_members_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_members" ADD CONSTRAINT "dataset_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_members" ADD CONSTRAINT "dataset_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_member_user_idx" ON "dataset_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_owner_name_uniq" ON "agents" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "agent_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_visibility_idx" ON "agents" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_owner_name_uniq" ON "datasets" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "dataset_owner_idx" ON "datasets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "dataset_visibility_idx" ON "datasets" USING btree ("visibility");
