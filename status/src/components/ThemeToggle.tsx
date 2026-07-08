import { Button, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../theme/ThemeContext';

export function ThemeToggle({ className }: { className?: string }) {
  const { isDark, toggle } = useTheme();

  return (
    <Tooltip title={isDark ? '切换亮色' : '切换暗色'}>
      <Button
        type="text"
        className={className}
        icon={isDark ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={isDark ? '切换亮色主题' : '切换暗色主题'}
      />
    </Tooltip>
  );
}
