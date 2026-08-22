import { eq } from 'drizzle-orm';
import { db } from '../client';
import { agents, datasets, models, rolePermissions, roles, users } from '../schema';
import { seedSuperAdmin } from '../../auth/service';
import { invalidateRoleCache } from '../../auth/role-service';
import { SUPERADMIN_ROLE_KEY } from '../../auth/permission-registry';
import { logger } from '../../utils/logger';
import {
  PRESET_AGENTS,
  PRESET_DATASETS,
  PRESET_MODELS,
  PRESET_ROLES,
} from './presets';
import { seedSkillsFromFiles } from './skills';

/** 查询系统超管 id（预设库/智能体的默认 owner） */
async function findSuperAdminId(): Promise<string | null> {
  const owner = await db.query.users.findFirst({ where: eq(users.role, SUPERADMIN_ROLE_KEY) });
  return owner?.id ?? null;
}

/** 幂等写入基础数据集（owner=超管，visibility 来自 preset，默认 public） */
export async function seedDatasets(): Promise<void> {
  const ownerId = await findSuperAdminId();
  if (!ownerId) {
    logger.warn('[Seed] superadmin not found, skipping datasets (run seedSuperAdmin first)');
    return;
  }
  for (const preset of PRESET_DATASETS) {
    await db.insert(datasets).values({
      name: preset.name,
      description: preset.description,
      ownerId,
      visibility: preset.visibility ?? 'public',
    }).onConflictDoNothing({ target: [datasets.ownerId, datasets.name] });
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

/** 幂等写入预设角色与权限（仅首次创建；已存在角色不覆盖用户修改） */
export async function seedPresetRoles(): Promise<void> {
  let created = 0;
  for (const preset of PRESET_ROLES) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (existing) continue;

    const [role] = await db.insert(roles).values({
      key: preset.key,
      label: preset.label,
      description: preset.description,
      isSystem: preset.isSystem,
    }).returning();

    if (preset.permissions.length > 0) {
      await db.insert(rolePermissions).values(
        preset.permissions.map(permission => ({ roleId: role!.id, permission })),
      ).onConflictDoNothing();
    }
    created++;
  }

  invalidateRoleCache();
  logger.info(`[Seed] roles ensured (${PRESET_ROLES.length}, created ${created})`);
}

/** 为已存在的内置角色补全缺失的预设权限（只增不删，不覆盖用户自定义） */
export async function ensurePresetRolePermissions(): Promise<void> {
  let added = 0;
  for (const preset of PRESET_ROLES) {
    const existing = await db.query.roles.findFirst({ where: eq(roles.key, preset.key) });
    if (!existing) continue;

    const current = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, existing.id));
    const currentSet = new Set(current.map(p => p.permission));
    const missing = preset.permissions.filter(p => !currentSet.has(p));
    if (missing.length === 0) continue;

    await db.insert(rolePermissions).values(
      missing.map(permission => ({ roleId: existing.id, permission })),
    ).onConflictDoNothing();
    added += missing.length;
    logger.info(`[Seed] role ${preset.key}: added permissions ${missing.join(', ')}`);
  }

  if (added > 0) invalidateRoleCache();
}

/** 幂等写入预设智能体（owner=超管，visibility 默认 public） */
export async function seedAgents(): Promise<void> {
  const ownerId = await findSuperAdminId();
  if (!ownerId) {
    logger.warn('[Seed] superadmin not found, skipping agents');
    return;
  }
  // 仅查超管名下的库（name 在该 owner 下唯一）
  const allDs = await db.select({ id: datasets.id, name: datasets.name })
    .from(datasets)
    .where(eq(datasets.ownerId, ownerId));
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
      ownerId,
      visibility: a.visibility ?? 'public',
    }).onConflictDoUpdate({
      target: [agents.ownerId, agents.name],
      set: {
        displayName: a.displayName,
        description: a.description,
        systemPrompt: a.systemPrompt,
        modelId,
        datasetIds,
        skillNames: a.skillNames,
        personality: a.personality,
        visibility: a.visibility ?? 'public',
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
 *
 * 顺序：先建角色 → 补权限 → 建超管 → 建库/智能体（需 owner）
 */
export async function runBaseSeed(): Promise<void> {
  logger.info('[Seed] Running base data seed...');
  await seedPresetRoles();
  await ensurePresetRolePermissions();
  await seedSuperAdmin();
  await seedDatasets();
  await seedModels();
  await seedSkillsFromFiles();
  await seedAgents();
  logger.info('[Seed] Base data seed complete');
}
