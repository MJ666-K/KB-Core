import { renderSidebar } from './components/sidebar.js';
import { Dashboard } from './pages/dashboard.js';
import { Agents } from './pages/agents.js';
import { Models } from './pages/models.js';
import { Skills } from './pages/skills.js';
import { Documents } from './pages/documents.js';
import { DocDetail } from './pages/doc-detail.js';
import { Chat } from './pages/chat.js';

const routes = [
  { pattern: /^\/?$/, page: Dashboard },
  { pattern: /^\/agents\/?$/, page: Agents },
  { pattern: /^\/models\/?$/, page: Models },
  { pattern: /^\/skills\/?$/, page: Skills },
  { pattern: /^\/documents\/?$/, page: Documents },
  { pattern: /^\/documents\/(.+)\/?$/, page: DocDetail },
  { pattern: /^\/chat\/?$/, page: Chat },
];

function matchRoute() {
  const hash = (location.hash || '').slice(1) || '/';
  for (const r of routes) {
    const m = hash.match(r.pattern);
    if (m) return { Page: r.page, params: m.slice(1) };
  }
  return { Page: Dashboard, params: [] };
}

function root() {
  const app = document.getElementById('app');
  app.className = 'layout';

  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar-wrap';
  sidebar.innerHTML = renderSidebar();
  app.appendChild(sidebar);

  const main = document.createElement('main');
  main.className = 'main';
  main.id = 'main';
  app.appendChild(main);
}

function render() {
  const { Page, params } = matchRoute();
  const main = document.getElementById('main');
  main.innerHTML = '';
  new Page(main, params);

  // Update active sidebar
  for (const el of document.querySelectorAll('.sidebar-item')) {
    el.classList.remove('active');
  }
  const currentHash = (location.hash || '').slice(1) || '/';
  for (const el of document.querySelectorAll('.sidebar-item')) {
    const h = el.getAttribute('data-href') || '';
    if (h === currentHash || (h === '/' && currentHash === '/') ||
        (h !== '/' && currentHash.startsWith(h))) {
      el.classList.add('active');
    }
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  root();
  render();
});
