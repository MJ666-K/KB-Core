-- 扩展角色：superadmin / admin / user

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin', 'admin', 'user'));

UPDATE users SET role = 'superadmin'
WHERE role = 'admin' AND username = 'admin';
