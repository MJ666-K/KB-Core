export type Permission =
  | 'dashboard:view'
  | 'chat:use'
  | 'documents:read'
  | 'documents:write'
  | 'agents:manage'
  | 'models:manage'
  | 'skills:manage'
  | 'settings:manage'
  | 'users:manage'
  | 'roles:manage';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'dashboard:view',
  'chat:use',
  'documents:read',
  'documents:write',
  'agents:manage',
  'models:manage',
  'skills:manage',
  'settings:manage',
  'users:manage',
  'roles:manage',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard:view': '控制台',
  'chat:use': '法律助手',
  'documents:read': '文档浏览',
  'documents:write': '文档管理',
  'agents:manage': '智能体管理',
  'models:manage': '模型管理',
  'skills:manage': 'Skills 管理',
  'settings:manage': '参数配置',
  'users:manage': '用户管理',
  'roles:manage': '角色管理',
};

export const PERMISSION_GROUPS: Array<{ title: string; permissions: Permission[] }> = [
  { title: '基础功能', permissions: ['dashboard:view', 'chat:use'] },
  { title: '文档', permissions: ['documents:read', 'documents:write'] },
  { title: '系统配置', permissions: ['agents:manage', 'models:manage', 'skills:manage', 'settings:manage'] },
  { title: '权限管理', permissions: ['users:manage', 'roles:manage'] },
];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(userPermissions: readonly string[], permission: Permission): boolean {
  return userPermissions.includes(permission);
}

/** superadmin 始终拥有全部权限 */
export const SUPERADMIN_ROLE_KEY = 'superadmin';
