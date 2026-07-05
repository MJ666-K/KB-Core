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
  { title: '基础', permissions: ['dashboard:view', 'chat:use'] },
  { title: '文档', permissions: ['documents:read', 'documents:write'] },
  { title: '配置', permissions: ['agents:manage', 'models:manage', 'skills:manage', 'settings:manage'] },
  { title: '管理', permissions: ['users:manage', 'roles:manage'] },
];

export const MENU_PERMISSIONS: Record<string, Permission> = {
  '/': 'dashboard:view',
  '/agents': 'agents:manage',
  '/models': 'models:manage',
  '/skills': 'skills:manage',
  '/documents': 'documents:read',
  '/chat': 'chat:use',
  '/settings': 'settings:manage',
  '/users': 'users:manage',
};

export function hasPermission(userPermissions: readonly string[] | undefined, permission: Permission): boolean {
  if (!userPermissions) return false;
  return userPermissions.includes(permission);
}

export function hasAnyPermission(userPermissions: readonly string[] | undefined, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(userPermissions, p));
}

export const ROUTE_ACCESS: Record<string, Permission[]> = {
  '/': ['dashboard:view'],
  '/agents': ['agents:manage'],
  '/models': ['models:manage'],
  '/skills': ['skills:manage'],
  '/documents': ['documents:read'],
  '/chat': ['chat:use'],
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
