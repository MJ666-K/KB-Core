const items = [
  { path: '/', label: '首页', icon: '📊' },
  { path: '/agents', label: '智能体', icon: '🤖' },
  { path: '/models', label: '模型', icon: '🧠' },
  { path: '/skills', label: 'Skills', icon: '🛠️' },
  { path: '/documents', label: '文档', icon: '📄' },
  { path: '/chat', label: '问答', icon: '💬' },
];

export function renderSidebar() {
  return `<nav class="sidebar">
    <div class="sidebar-brand">⚖ Knowledge Core</div>
    <div class="sidebar-nav">
      ${items.map(i => `
        <a class="sidebar-item" data-href="${i.path}" href="#${i.path}">
          <span>${i.icon}</span><span>${i.label}</span>
        </a>`).join('')}
    </div>
  </nav>`;
}
