export type Permission =
  | 'dashboard:view'
  | 'chat:use'
  | 'kg:view'
  | 'documents:read'
  | 'documents:write'
  | 'datasets:read'
  | 'datasets:manage'
  | 'agents:manage'
  | 'models:manage'
  | 'skills:manage'
  | 'settings:manage'
  | 'users:manage'
  | 'roles:manage';

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard:view': '控制台',
  'chat:use': '法律助手',
  'kg:view': '知识图谱',
  'documents:read': '文档浏览',
  'documents:write': '文档管理',
  'datasets:read': '知识库',
  'datasets:manage': '知识库管理',
  'agents:manage': '智能体管理',
  'models:manage': '模型管理',
  'skills:manage': 'Skills 管理',
  'settings:manage': '参数配置',
  'users:manage': '用户管理',
  'roles:manage': '角色管理',
};

export const PERMISSION_GROUPS: Array<{ key: string; title: string; permissions: Permission[] }> = [
  { key: 'basic', title: '基础功能', permissions: ['dashboard:view', 'chat:use', 'kg:view'] },
  { key: 'docs', title: '文档与知识库', permissions: ['documents:read', 'documents:write', 'datasets:read'] },
  { key: 'config', title: '系统配置', permissions: ['agents:manage', 'models:manage', 'skills:manage', 'settings:manage', 'datasets:manage'] },
  { key: 'admin', title: '权限管理', permissions: ['users:manage', 'roles:manage'] },
];

export const MENU_PERMISSIONS: Record<string, Permission> = {
  '/': 'dashboard:view',
  '/agents': 'agents:manage',
  '/models': 'models:manage',
  '/skills': 'skills:manage',
  '/documents': 'documents:read',
  '/datasets': 'datasets:read',
  '/chat': 'chat:use',
  '/kg': 'kg:view',
  '/settings': 'settings:manage',
  '/users': 'users:manage',
};

export function hasPermission(userPermissions: readonly string[] | undefined, permission: Permission): boolean {
  if (!userPermissions) return false;
  return userPermissions.includes(permission);
}

export function hasAnyPermission(userPermissions: readonly string[] | undefined, permissions: Permission[]): boolean {
  if (!permissions || permissions.length === 0) return true;
  return permissions.some(p => hasPermission(userPermissions, p));
}

export const ROUTE_ACCESS: Record<string, Permission[]> = {
  '/': ['dashboard:view'],
  '/agents': ['agents:manage', 'datasets:read', 'datasets:manage'],
  '/models': ['models:manage'],
  '/skills': ['skills:manage'],
  '/documents': ['documents:read'],
  '/datasets': ['datasets:read'],
  '/chat': ['chat:use'],
  '/kg': ['kg:view'],
  '/settings': ['settings:manage'],
  '/users': ['users:manage', 'roles:manage'],
};

export function canAccessPath(userPermissions: readonly string[] | undefined, path: string): boolean {
  const key = Object.keys(ROUTE_ACCESS).find(k =>
    k === '/' ? path === '/' : path.startsWith(k),
  );
  if (!key) return true;
  return hasAnyPermission(userPermissions, ROUTE_ACCESS[key]);
}

export function canManageUsers(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'users:manage');
}

export function canManageRoles(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'roles:manage');
}

export function canWriteDocuments(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'documents:write');
}

export function canUseDatasets(userPermissions: readonly string[] | undefined): boolean {
  return hasAnyPermission(userPermissions, ['datasets:read', 'datasets:manage']);
}

export function canManageDatasets(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'datasets:manage');
}

export function canManageAgents(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'agents:manage');
}

/** 智能体功能：管理员(agents:manage) 或 可用库权限(datasets:read/manage，owner 建自己的) */
export function canUseAgents(userPermissions: readonly string[] | undefined): boolean {
  return hasAnyPermission(userPermissions, ['agents:manage', 'datasets:read', 'datasets:manage']);
}

export function canManageModels(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'models:manage');
}

export function canManageSkills(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'skills:manage');
}

export function canManageSettings(userPermissions: readonly string[] | undefined): boolean {
  return hasPermission(userPermissions, 'settings:manage');
}
