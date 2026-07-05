import { pgTable, uuid, text, timestamp, boolean, primaryKey, index } from 'drizzle-orm/pg-core';

/** 可配置角色（key 作为 users.role 外键引用） */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  description: text('description').notNull().default(''),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('roles_key_idx').on(table.key),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id')
    .references(() => roles.id, { onDelete: 'cascade' })
    .notNull(),
  permission: text('permission').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permission] }),
  index('role_permissions_role_idx').on(table.roleId),
]);
