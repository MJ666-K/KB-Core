import { Checkbox } from 'antd';
import { CheckOutlined } from '@ant-design/icons';

export interface PermGroup {
  title: string;
  permissions: Array<{ key: string; label: string }>;
}

interface Props {
  groups: PermGroup[];
  value?: string[];
  onChange?: (permissions: string[]) => void;
}

export default function PermissionPicker({ groups, value = [], onChange }: Props) {
  const selected = new Set(value);

  const toggle = (perm: string, checked: boolean) => {
    onChange?.(checked ? [...value, perm] : value.filter(p => p !== perm));
  };

  const toggleGroup = (group: PermGroup, selectAll: boolean) => {
    const keys = group.permissions.map(p => p.key);
    if (selectAll) {
      const merged = new Set([...value, ...keys]);
      onChange?.([...merged]);
    } else {
      const keySet = new Set(keys);
      onChange?.(value.filter(p => !keySet.has(p)));
    }
  };

  const totalCount = groups.reduce((n, g) => n + g.permissions.length, 0);

  return (
    <div className="kc-perm-picker">
      <div className="kc-perm-picker__summary">
        <span>已选 <strong>{value.length}</strong> / {totalCount} 项权限</span>
      </div>
      <div className="kc-perm-picker__grid">
        {groups.map(group => {
          const groupKeys = group.permissions.map(p => p.key);
          const activeCount = groupKeys.filter(k => selected.has(k)).length;
          const allSelected = activeCount === groupKeys.length;
          const someSelected = activeCount > 0 && !allSelected;

          return (
            <div key={group.title} className={`kc-perm-picker__card kc-perm-picker__card--${group.title}`}>
              <div className="kc-perm-picker__card-head">
                <div className="kc-perm-picker__card-title">
                  <span>{group.title}</span>
                  <span className="kc-perm-picker__card-count">{activeCount}/{groupKeys.length}</span>
                </div>
                <button
                  type="button"
                  className="kc-perm-picker__card-toggle"
                  onClick={() => toggleGroup(group, !allSelected)}
                >
                  {allSelected ? '取消全选' : someSelected ? '全选' : '全选'}
                </button>
              </div>
              <div className="kc-perm-picker__card-items">
                {group.permissions.map(p => {
                  const checked = selected.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`kc-perm-picker__item${checked ? ' is-checked' : ''}`}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={e => toggle(p.key, e.target.checked)}
                      />
                      <span className="kc-perm-picker__item-label">{p.label}</span>
                      {checked && <CheckOutlined className="kc-perm-picker__item-check" />}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
