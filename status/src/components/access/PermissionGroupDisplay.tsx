import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from '../../auth/permissions';

const GROUP_CLASS: Record<string, string> = {
  basic: 'basic',
  docs: 'docs',
  config: 'config',
  admin: 'admin',
};

interface Props {
  permissions: string[];
  compact?: boolean;
}

export default function PermissionGroupDisplay({ permissions, compact = false }: Props) {
  const set = new Set(permissions);

  const activeCount = permissions.length;
  if (activeCount === 0) {
    return <span className="kc-perm-display-empty">无权限</span>;
  }

  return (
    <div className={`kc-perm-display ${compact ? 'is-compact' : ''}`}>
      {PERMISSION_GROUPS.map(group => {
        const active = group.permissions.filter(p => set.has(p));
        if (active.length === 0) return null;
        const groupClass = GROUP_CLASS[group.key] ?? 'default';
        return (
          <div key={group.key} className={`kc-perm-display-group kc-perm-display-group--${groupClass}`}>
            <span className="kc-perm-display-label">{group.title}</span>
            <div className="kc-perm-display-items">
              {active.map(p => (
                <span key={p} className="kc-perm-display-item" title={p}>
                  {PERMISSION_LABELS[p as Permission]}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
