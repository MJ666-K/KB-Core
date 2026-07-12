import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { ensureKgReady, withSession } from './client';
import { ingestKgData } from './ingest';
import { logger } from '../utils/logger';

const DEFAULT_KG_DATA_PATH = path.resolve(process.cwd(), './data/kg-data.json');

/** 启动时：Neo4j 图谱为空则自动入库默认 kg-data.json */
export async function seedKgIfEmpty(): Promise<void> {
  if (!config.kgEnabled) {
    logger.info('[Seed] KG disabled, skip kg seed');
    return;
  }

  try {
    await ensureKgReady();
    const total = await withSession(async (session) => {
      const r = await session.run('MATCH (n) RETURN count(n) AS cnt');
      return Number(r.records[0]?.get('cnt') ?? 0);
    });

    if (total > 0) {
      logger.info('[Seed] KG already has data, skip kg-data seed', { total });
      return;
    }

    if (!fs.existsSync(DEFAULT_KG_DATA_PATH)) {
      logger.warn('[Seed] KG empty but kg-data.json not found', { path: DEFAULT_KG_DATA_PATH });
      return;
    }

    logger.info('[Seed] KG empty, ingesting default kg-data.json...');
    await ingestKgData(DEFAULT_KG_DATA_PATH);
    logger.info('[Seed] KG seed complete');
  } catch (e) {
    logger.warn('[Seed] KG seed skipped', { err: (e as Error).message });
  }
}
