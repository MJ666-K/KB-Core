export type Permission =
  | 'dashboard:view'
  | 'chat:use'
  | 'kg:view'
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
  'kg:view',
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
  'kg:view': '知识图谱',
  'documents:read': '文档浏览',
  'documents:write': '文档管理',
  'agents:manage': '智能体管理',
  'models:manage': '模型管理',
  'skills:manage': 'Skills 管理',
  'settings:manage': '参数配置',
  'users:manage': '用户管理',
  'roles:manage': '角色管理',
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'dashboard:view': '查看控制台与系统数据总览',
  'chat:use': '使用法律助手进行对话咨询',
  'kg:view': '浏览知识图谱、节点详情与关联关系',
  'documents:read': '查看文档库与文档内容',
  'documents:write': '上传、删除与重新嵌入文档',
  'agents:manage': '配置智能体与路由策略',
  'models:manage': '管理 LLM 模型与推理参数',
  'skills:manage': '管理 Agent Skills 任务单元',
  'settings:manage': '修改检索流水线与文本切割参数',
  'users:manage': '创建、编辑与删除用户账号',
  'roles:manage': '创建角色并配置权限策略',
};

export const PERMISSION_GROUPS: Array<{ key: string; title: string; permissions: Permission[] }> = [
  { key: 'basic', title: '基础功能', permissions: ['dashboard:view', 'chat:use', 'kg:view'] },
  { key: 'docs', title: '文档', permissions: ['documents:read', 'documents:write'] },
  { key: 'config', title: '系统配置', permissions: ['agents:manage', 'models:manage', 'skills:manage', 'settings:manage'] },
  { key: 'admin', title: '权限管理', permissions: ['users:manage', 'roles:manage'] },
];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(userPermissions: readonly string[], permission: Permission): boolean {
  return userPermissions.includes(permission);
}

export const SUPERADMIN_ROLE_KEY = 'superadmin';

/** 超级管理员角色不可移除的底线权限（防止锁死系统） */
export const SUPERADMIN_REQUIRED_PERMISSIONS: readonly Permission[] = [
  'users:manage',
  'roles:manage',
];
