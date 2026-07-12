import { Checkbox, Input, Progress } from 'antd';
import { CheckOutlined, SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';

export interface PermItem {
  key: string;
  label: string;
  description?: string;
}

export interface PermGroup {
  key: string;
  title: string;
  permissions: PermItem[];
}

interface Props {
  groups: PermGroup[];
  value?: string[];
  onChange?: (permissions: string[]) => void;
  /** 不可取消的权限（如 superadmin 底线权限） */
  locked?: string[];
}

export default function PermissionPicker({ groups, value = [], onChange, locked = [] }: Props) {
  const [query, setQuery] = useState('');
  const selected = new Set(value);
  const lockedSet = new Set(locked);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups
      .map(group => ({
        ...group,
        permissions: group.permissions.filter(p =>
          p.key.toLowerCase().includes(normalizedQuery)
          || p.label.toLowerCase().includes(normalizedQuery)
          || (p.description ?? '').toLowerCase().includes(normalizedQuery),
        ),
      }))
      .filter(group => group.permissions.length > 0);
  }, [groups, normalizedQuery]);

  const toggle = (perm: string, checked: boolean) => {
    if (lockedSet.has(perm)) return;
    onChange?.(checked ? [...value, perm] : value.filter(p => p !== perm));
  };

  const toggleGroup = (group: PermGroup, selectAll: boolean) => {
    const keys = group.permissions.map(p => p.key);
    const unlockedKeys = keys.filter(k => !lockedSet.has(k));
    if (selectAll) {
      const merged = new Set([...value, ...keys]);
      for (const k of locked) merged.add(k);
      onChange?.([...merged]);
    } else {
      const keySet = new Set(unlockedKeys);
      onChange?.(value.filter(p => !keySet.has(p) || lockedSet.has(p)));
    }
  };

  const totalCount = groups.reduce((n, g) => n + g.permissions.length, 0);
  const percent = totalCount > 0 ? Math.round((value.length / totalCount) * 100) : 0;

  return (
    <div className="kc-perm-picker">
      <div className="kc-perm-picker__toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索权限名称或标识…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="kc-perm-picker__search"
        />
        <div className="kc-perm-picker__summary">
          <span>已选 <strong>{value.length}</strong> / {totalCount} 项</span>
          <Progress
            percent={percent}
            size="small"
            showInfo={false}
            className="kc-perm-picker__progress"
          />
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="kc-perm-picker__empty">没有匹配的权限</div>
      ) : (
        <div className="kc-perm-picker__grid">
          {filteredGroups.map(group => {
            const groupKeys = group.permissions.map(p => p.key);
            const activeCount = groupKeys.filter(k => selected.has(k)).length;
            const allSelected = activeCount === groupKeys.length;
            const someSelected = activeCount > 0 && !allSelected;

            return (
              <div key={group.key} className={`kc-perm-picker__card kc-perm-picker__card--${group.key}`}>
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
                    {allSelected ? '取消全选' : someSelected ? '全选本组' : '全选本组'}
                  </button>
                </div>
                <div className="kc-perm-picker__card-items">
                  {group.permissions.map(p => {
                    const checked = selected.has(p.key) || lockedSet.has(p.key);
                    const isLocked = lockedSet.has(p.key);
                    return (
                      <label
                        key={p.key}
                        className={`kc-perm-picker__item${checked ? ' is-checked' : ''}${isLocked ? ' is-locked' : ''}`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={isLocked}
                          onChange={e => toggle(p.key, e.target.checked)}
                        />
                        <span className="kc-perm-picker__item-body">
                          <span className="kc-perm-picker__item-label">{p.label}</span>
                          {p.description && (
                            <span className="kc-perm-picker__item-desc">{p.description}</span>
                          )}
                          <code className="kc-perm-picker__item-key">{p.key}</code>
                        </span>
                        {checked && <CheckOutlined className="kc-perm-picker__item-check" />}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
