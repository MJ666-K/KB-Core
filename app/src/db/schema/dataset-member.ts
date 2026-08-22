import { pgTable, uuid, timestamp, pgEnum, primaryKey, index } from 'drizzle-orm/pg-core';
import { datasets } from './dataset';
import { users } from './user';

/** shared 库成员角色：viewer 只读 / editor 读写 / manager 读写+管理 */
export const datasetMemberRoleEnum = pgEnum('dataset_member_role', ['viewer', 'editor', 'manager']);

/**
 * 数据集成员表（ACL）—— 支撑 visibility='shared' 的细粒度共享。
 * private/public 库不依赖此表。
 */
export const datasetMembers = pgTable('dataset_members', {
  datasetId: uuid('dataset_id')
    .references(() => datasets.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  role: datasetMemberRoleEnum('role').notNull().default('viewer'),
  /** 授权人（owner 或 manager） */
  grantedBy: uuid('granted_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.datasetId, t.userId] }),
  index('dataset_member_user_idx').on(t.userId),
]);
