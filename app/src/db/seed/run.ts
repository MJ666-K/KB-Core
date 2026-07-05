import { eq } from 'drizzle-orm';
import { db } from '../client';
import { agents, datasets, models, rolePermissions, roles } from '../schema';
import { seedSuperAdmin } from '../../auth/service';
import { invalidateRoleCache } from '../../auth/role-service';
import { logger } from '../../utils/logger';
import {
  PRESET_AGENTS,
  PRESET_DATASETS,
  PRESET_MODELS,
  PRESET_ROLES,
} from './presets';
import { seedSkillsFromFiles } from './skills';

/** 幂等写入基础数据集 */
export async function seedDatasets(): Promise<void> {
  for (const preset of PRESET_DATASETS) {
    await db.insert(datasets).values({
      name: preset.name,
      description: preset.description,
    }).onConflictDoNothing();
  }
  logger.info(`[Seed] datasets ensured (${PRESET_DATASETS.length})`);
}

/** 幂等写入预设模型 */
export async function seedModels(): Promise<void> {
  for (const m of PRESET_MODELS) {
    await db.insert(models).values({
      name: m.name,
      displayName: m.displayName,
      provider: m.provider,
      modelId: m.modelId,
      temperature: m.temperature,
      maxTokens: m.maxTokens,
      topK: m.topK ?? 0,
      topP: m.topP ?? 0.9,
      frequencyPenalty: m.frequencyPenalty ?? 0,
      presencePenalty: m.presencePenalty ?? 0,
    }).onConflictDoUpdate({
      target: models.name,
      set: {
        displayName: m.displayName,
        provider: m.provider,
        modelId: m.modelId,
        temperature: m.temperature,
        maxTokens: m.maxTokens,
        updatedAt: new Date(),
      },
    });
  }
  logger.info(`[Seed] models ensured (${PRESET_MODELS.length})`);
}

/** 幂等写入预设角色与权限（缺失项补全，不删用户自定义权限） */
export async function seedPresetRoles(): Promise<void> {
  for (const preset of PRESET_ROLES) {
    let role = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (!role) {
      [role] = await db.insert(roles).values({
        key: preset.key,
        label: preset.label,
        description: preset.description,
        isSystem: preset.isSystem,
      }).returning();
    } else {
      await db.update(roles).set({
        label: preset.label,
        description: preset.description,
        isSystem: preset.isSystem,
        updatedAt: new Date(),
      }).where(eq(roles.id, role.id));
    }

    for (const permission of preset.permissions) {
      await db.insert(rolePermissions).values({
        roleId: role!.id,
        permission,
      }).onConflictDoNothing();
    }
  }

  invalidateRoleCache();
  logger.info(`[Seed] roles ensured (${PRESET_ROLES.length})`);
}

/** 幂等写入预设智能体 */
export async function seedAgents(): Promise<void> {
  const allDs = await db.select({ id: datasets.id, name: datasets.name }).from(datasets);
  const dsByName = new Map(allDs.map(d => [d.name, d.id]));
  const modelsList = await db.select({ id: models.id, name: models.name }).from(models);
  const modelByName = new Map(modelsList.map(m => [m.name, m.id]));

  let upserted = 0;
  for (const a of PRESET_AGENTS) {
    const modelId = modelByName.get(a.modelName);
    if (!modelId) {
      logger.warn(`[Seed] model ${a.modelName} not found, skipping agent ${a.name}`);
      continue;
    }

    const datasetIds = a.datasetNames
      .map(name => dsByName.get(name))
      .filter((id): id is string => !!id);

    await db.insert(agents).values({
      name: a.name,
      displayName: a.displayName,
      description: a.description,
      systemPrompt: a.systemPrompt,
      modelId,
      datasetIds,
      skillNames: a.skillNames,
      personality: a.personality,
    }).onConflictDoUpdate({
      target: agents.name,
      set: {
        displayName: a.displayName,
        description: a.description,
        systemPrompt: a.systemPrompt,
        modelId,
        datasetIds,
        skillNames: a.skillNames,
        personality: a.personality,
        updatedAt: new Date(),
      },
    });
    upserted++;
  }

  logger.info(`[Seed] agents ensured (${upserted})`);
}

/**
 * 启动时基础数据初始化（与 Drizzle schema 迁移分离）
 * 可重复执行，幂等补全缺失项
 */
export async function runBaseSeed(): Promise<void> {
  logger.info('[Seed] Running base data seed...');
  await seedDatasets();
  await seedModels();
  await seedPresetRoles();
  await seedSuperAdmin();
  await seedSkillsFromFiles();
  await seedAgents();
  logger.info('[Seed] Base data seed complete');
}
