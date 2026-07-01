-- Step 42: 流程回溯相关表（split_configs / test_suites / test_cases / test_runs / query_annotations）

CREATE TABLE IF NOT EXISTS split_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  parent_id uuid,
  config jsonb NOT NULL,
  parent_tokens integer NOT NULL,
  child_tokens integer NOT NULL,
  overlap_tokens integer NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  dataset_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text NOT NULL,
  expected_keywords jsonb NOT NULL DEFAULT '[]',
  expected_citations jsonb NOT NULL DEFAULT '[]',
  skill text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
  config_snapshot jsonb NOT NULL,
  results jsonb NOT NULL,
  passed integer NOT NULL,
  total integer NOT NULL,
  pass_rate numeric(5,4) NOT NULL,
  avg_latency_ms integer,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS query_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_log_id uuid NOT NULL UNIQUE,
  accurate text NOT NULL,
  citation_accurate text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
