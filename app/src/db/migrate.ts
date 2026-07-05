import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';
import { logger } from '../utils/logger';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** 启动时执行 src/db/migrations 下 Drizzle 迁移（含 drizzle-kit generate 产物） */
export async function runMigrations(): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  logger.info(`[Migration] Running Drizzle migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  logger.info('[Migration] Drizzle migrations complete');
}
