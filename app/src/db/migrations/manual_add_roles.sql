-- 可配置角色与权限

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roles_key_idx ON roles (key);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions (role_id);

-- 移除 users.role 的枚举约束，改为引用 roles.key
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 种子角色（若不存在）
INSERT INTO roles (key, label, description, is_system) VALUES
  ('superadmin', '超级管理员', '拥有系统全部权限，可管理用户与角色', true),
  ('admin', '管理员', '可管理知识库、智能体、模型与系统参数', true),
  ('user', '普通用户', '可使用法律助手，只读浏览文档', true),
  ('analyst', '分析师', '可使用法律助手并进行深度文档检索', false),
  ('editor', '内容编辑', '可上传与管理文档，不可修改系统配置', false)
ON CONFLICT (key) DO NOTHING;

-- 超级管理员：全部权限
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('dashboard:view'), ('chat:use'), ('documents:read'), ('documents:write'),
  ('agents:manage'), ('models:manage'), ('skills:manage'), ('settings:manage'),
  ('users:manage'), ('roles:manage')
) AS p(permission)
WHERE r.key = 'superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES
  ('dashboard:view'), ('chat:use'), ('documents:read'), ('documents:write'),
  ('agents:manage'), ('models:manage'), ('skills:manage'), ('settings:manage')
) AS p(permission)
WHERE r.key = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES ('chat:use'), ('documents:read')) AS p(permission)
WHERE r.key = 'user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES ('dashboard:view'), ('chat:use'), ('documents:read')) AS p(permission)
WHERE r.key = 'analyst'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES ('chat:use'), ('documents:read'), ('documents:write')) AS p(permission)
WHERE r.key = 'editor'
ON CONFLICT DO NOTHING;

UPDATE users SET role = 'superadmin' WHERE role = 'admin' AND username = 'admin' AND EXISTS (
  SELECT 1 FROM roles WHERE key = 'superadmin'
);
