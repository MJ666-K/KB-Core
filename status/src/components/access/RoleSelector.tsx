import { SafetyCertificateOutlined } from '@ant-design/icons';
import PermissionGroupDisplay from './PermissionGroupDisplay';

export interface RoleOption {
  key: string;
  label: string;
  description: string;
  permissions: string[];
}

interface Props {
  roles: RoleOption[];
  value?: string;
  onChange?: (key: string) => void;
}

export default function RoleSelector({ roles, value, onChange }: Props) {
  const selected = roles.find(r => r.key === value);

  return (
    <div className="kc-role-selector">
      <div className="kc-role-selector__list">
        {roles.map(role => {
          const active = role.key === value;
          return (
            <button
              key={role.key}
              type="button"
              className={`kc-role-selector__card${active ? ' is-active' : ''}`}
              onClick={() => onChange?.(role.key)}
            >
              <div className="kc-role-selector__card-icon">
                <SafetyCertificateOutlined />
              </div>
              <div className="kc-role-selector__card-body">
                <span className="kc-role-selector__card-label">{role.label}</span>
                <code className="kc-role-selector__card-key">{role.key}</code>
                {role.description && (
                  <span className="kc-role-selector__card-desc">{role.description}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="kc-role-selector__preview">
          <div className="kc-role-selector__preview-head">
            <span className="kc-role-selector__preview-title">权限预览</span>
            <span className="kc-role-selector__preview-count">{selected.permissions.length} 项</span>
          </div>
          <PermissionGroupDisplay permissions={selected.permissions} compact />
        </div>
      )}
    </div>
  );
}
