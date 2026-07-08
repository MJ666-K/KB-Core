import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';
import { logger } from '../utils/logger';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

type JournalEntry = { tag: string; when: number };

type Journal = { entries: JournalEntry[] };

/** 表/列已存在但 journal 未记录时，补写 drizzle 迁移记录（避免 42P07 duplicate_table） */
async function baselineDriftedMigrations(): Promise<void> {
  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows: appliedRows } = await pool.query<{ hash: string }>(
    'SELECT hash FROM drizzle.__drizzle_migrations',
  );
  const applied = new Set(appliedRows.map((r) => r.hash));

  const journalPath = join(migrationsFolder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;

  for (const entry of journal.entries) {
    const sqlPath = join(migrationsFolder, `${entry.tag}.sql`);
    const hash = createHash('sha256').update(readFileSync(sqlPath)).digest('hex');
    if (applied.has(hash)) continue;

    const alreadyApplied = await isMigrationAlreadyApplied(entry.tag);
    if (!alreadyApplied) continue;

    await pool.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when],
    );
    applied.add(hash);
    logger.warn(`[Migration] Baslined ${entry.tag} (schema already present, journal was missing)`);
  }
}

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [table],
  );
  return rows[0]?.exists ?? false;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    ) AS exists`,
    [table, column],
  );
  return rows[0]?.exists ?? false;
}

async function isMigrationAlreadyApplied(tag: string): Promise<boolean> {
  switch (tag) {
    case '0001_tearful_roughhouse':
      return tableExists('agents');
    case '0002_tsvector_and_parent_fk':
      return columnExists('chunks', 'tsv');
    case '0003_traceability_tables':
      return tableExists('split_configs');
    default:
      return false;
  }
}

/** 启动时执行 src/db/migrations 下 Drizzle 迁移（含 drizzle-kit generate 产物） */
export async function runMigrations(): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await baselineDriftedMigrations();
  logger.info(`[Migration] Running Drizzle migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  logger.info('[Migration] Drizzle migrations complete');
}
