-- Manual migration: adds models table, agents table, skill_definitions table

CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_url TEXT,
  api_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  temperature REAL NOT NULL DEFAULT 0.2,
  max_tokens INTEGER NOT NULL DEFAULT 2048,
  top_k INTEGER DEFAULT 0,
  top_p REAL DEFAULT 0.9,
  frequency_penalty REAL DEFAULT 0,
  presence_penalty REAL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert preset models (safe for re-run)
INSERT INTO models (name, display_name, provider, model_id, temperature, max_tokens, top_k, top_p, frequency_penalty, presence_penalty) VALUES
('qwen-turbo', 'Qwen Turbo', 'qwen', 'qwen-turbo', 0.1, 512, 0, 0.9, 0, 0),
('qwen-plus', 'Qwen Plus', 'qwen', 'qwen-plus', 0.2, 2048, 0, 0.9, 0, 0),
('qwen-max', 'Qwen Max', 'qwen', 'qwen-max', 0.3, 4096, 0, 0.9, 0, 0),
('deepseek-v4', 'DeepSeek V4', 'deepseek', 'deepseek-v4', 0.2, 4096, 0, 0.9, 0, 0),
('deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'deepseek-v4-pro', 0.3, 8192, 0, 0.9, 0, 0)
ON CONFLICT (name) DO NOTHING;

-- Fix existing deepseek-v4-pro model if it has wrong model_id (should be deepseek-v4-pro)
UPDATE models 
SET model_id = 'deepseek-v4-pro', updated_at = NOW()
WHERE name = 'deepseek-v4-pro' AND model_id != 'deepseek-v4-pro';

CREATE TABLE IF NOT EXISTS skill_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  tools TEXT[] NOT NULL DEFAULT '{}',
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  instructions TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model_id UUID NOT NULL REFERENCES models(id),
  dataset_ids TEXT[] NOT NULL DEFAULT '{}',
  skill_names TEXT[] DEFAULT '{}',
  personality TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration for existing installs: add model_id to agents table if needed
DO $$
BEGIN
  -- Add model_id column UUID if not exists
  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='agents' AND column_name='model_id') THEN
    ALTER TABLE agents ADD COLUMN model_id UUID;
  END IF;

  -- Migrate existing agents: link to qwen-max
  UPDATE agents SET model_id = (SELECT id FROM models WHERE name = 'qwen-max')
  WHERE model_id IS NULL;

  -- Make model_id NOT NULL after data migration
  ALTER TABLE agents ALTER COLUMN model_id SET NOT NULL;

  -- Add FK constraint if not present
  IF NOT EXISTS (SELECT FROM information_schema.table_constraints WHERE constraint_name='agents_model_id_fkey') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_model_id_fkey FOREIGN KEY (model_id) REFERENCES models(id);
  END IF;

  -- Drop old model column
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name='agents' AND column_name='model') THEN
    ALTER TABLE agents DROP COLUMN model;
  END IF;
END $$;
