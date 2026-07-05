import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',
    colorBgBase: '#f5f5f5',
    colorBgContainer: '#ffffff',
    colorBorder: '#d9d9d9',
    colorText: '#000000e0',
    colorTextSecondary: '#00000073',
    colorTextTertiary: '#00000045',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    borderRadius: 6,
    controlHeight: 32,
    fontSize: 14,
    wireframe: false,
  },
  components: {
    Layout: {
      siderBg: '#001529',
      headerBg: '#fff',
      bodyBg: '#f5f5f5',
    },
    Menu: {
      darkItemBg: '#001529',
      darkItemColor: '#ffffffa6',
      darkItemSelectedBg: '#1677ff',
      darkItemSelectedColor: '#fff',
      darkItemHoverBg: 'transparent',
      iconSize: 16,
      iconMarginInlineEnd: 10,
    },
    Button: {
      primaryShadow: '0 2px 0 rgba(5, 145, 255, 0.1)',
    },
    Table: {
      headerBg: '#fafafa',
      headerColor: '#000000e0',
      rowHoverBg: '#f5f5f5',
      headerSplitColor: '#f0f0f0',
      borderColor: '#f0f0f0',
    },
    Card: {
      boxShadowTertiary: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
    },
    Statistic: {
      titleFontSize: 14,
      contentFontSize: 24,
    },
  },
};
