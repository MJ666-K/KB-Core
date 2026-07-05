import { PERMISSION_GROUPS, PERMISSION_LABELS } from '../../auth/permissions';

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
        return (
          <div key={group.title} className="kc-perm-display-group">
            <span className="kc-perm-display-label">{group.title}</span>
            <div className="kc-perm-display-items">
              {active.map(p => (
                <span key={p} className="kc-perm-display-item">{PERMISSION_LABELS[p]}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
