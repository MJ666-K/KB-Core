import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from '../../auth/permissions';

const GROUP_CLASS: Record<string, string> = {
  '基础': 'basic',
  '文档': 'docs',
  '配置': 'config',
  '管理': 'admin',
};

interface Props {
  permissions: string[];
  compact?: boolean;
}

export default function PermissionGroupDisplay({ permissions, compact = false }: Props) {
  const set = new Set(permissions);

  return (
    <div className={`kc-perm-display ${compact ? 'is-compact' : ''}`}>
      {PERMISSION_GROUPS.map(group => {
        const active = group.permissions.filter(p => set.has(p));
        if (active.length === 0) return null;
        const groupClass = GROUP_CLASS[group.title] ?? 'default';
        return (
          <div key={group.title} className={`kc-perm-display-group kc-perm-display-group--${groupClass}`}>
            <span className="kc-perm-display-label">{group.title}</span>
            <div className="kc-perm-display-items">
              {active.map(p => (
                <span key={p} className="kc-perm-display-item">{PERMISSION_LABELS[p as Permission]}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
