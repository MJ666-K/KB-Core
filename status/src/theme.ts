import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const SHARED_TOKEN = {
  colorPrimary: '#1a56db',
  colorSuccess: '#16a34a',
  colorWarning: '#d97706',
  colorError: '#dc2626',
  colorInfo: '#1a56db',
  fontFamily: FONT_FAMILY,
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  controlHeight: 36,
  fontSize: 14,
  wireframe: false,
} as const;

/** 全局 Ant Design 主题 —— 与 index.css 设计令牌保持一致 */
export function createAntdTheme(isDark: boolean): ThemeConfig {
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      ...SHARED_TOKEN,
      ...(isDark
        ? {
            colorBgBase: '#0f172a',
            colorBgContainer: '#1e293b',
            colorBgLayout: '#0f172a',
            colorBgElevated: '#1e293b',
            colorBorder: '#334155',
            colorBorderSecondary: '#283548',
            colorText: '#f1f5f9',
            colorTextSecondary: '#94a3b8',
            colorTextTertiary: '#64748b',
            colorTextQuaternary: '#475569',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.24)',
            boxShadowSecondary: '0 4px 12px 0 rgba(0, 0, 0, 0.32)',
          }
        : {
            colorBgBase: '#eef1f6',
            colorBgContainer: '#ffffff',
            colorBgLayout: '#eef1f6',
            colorBorder: '#e2e8f0',
            colorBorderSecondary: '#eef0f3',
            colorText: '#1e293b',
            colorTextSecondary: '#64748b',
            colorTextTertiary: '#94a3b8',
            colorTextQuaternary: '#cbd5e1',
            boxShadow: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
            boxShadowSecondary: '0 4px 12px 0 rgba(15, 23, 42, 0.06)',
          }),
    },
    components: {
      Layout: {
        siderBg: '#0f172a',
        headerBg: isDark ? '#1e293b' : '#ffffff',
        bodyBg: isDark ? '#0f172a' : '#eef1f6',
        headerHeight: 60,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemColor: 'rgba(255, 255, 255, 0.72)',
        darkItemSelectedBg: '#1a56db',
        darkItemSelectedColor: '#ffffff',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
        darkItemHoverColor: '#ffffff',
        itemBorderRadius: 8,
        itemMarginInline: 8,
        itemHeight: 40,
        iconSize: 16,
        iconMarginInlineEnd: 10,
      },
      Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        controlHeight: 36,
        borderRadius: 8,
      },
      Input: {
        controlHeight: 36,
        borderRadius: 8,
        activeBorderColor: '#1a56db',
        hoverBorderColor: isDark ? '#3b82f6' : '#93c5fd',
      },
      Select: {
        controlHeight: 36,
        borderRadius: 8,
      },
      Table: {
        headerBg: isDark ? '#172033' : '#f8fafc',
        headerColor: isDark ? '#f1f5f9' : '#1e293b',
        rowHoverBg: isDark ? '#283548' : '#f8fafc',
        headerSplitColor: isDark ? '#283548' : '#eef0f3',
        borderColor: isDark ? '#283548' : '#eef0f3',
        borderRadius: 8,
      },
      Card: {
        borderRadiusLG: 12,
        boxShadowTertiary: isDark
          ? '0 1px 2px 0 rgba(0, 0, 0, 0.24)'
          : '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        paddingLG: 20,
      },
      Modal: {
        borderRadiusLG: 12,
      },
      Statistic: {
        titleFontSize: 13,
        contentFontSize: 26,
      },
      Tag: {
        borderRadiusSM: 6,
      },
      Collapse: {
        borderRadiusLG: 8,
      },
      Tabs: {
        inkBarColor: '#1a56db',
      },
    },
  };
}

/** @deprecated 使用 createAntdTheme */
export const theme = createAntdTheme(false);
