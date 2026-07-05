import { api } from '../api.js';

export class Table {
  constructor(container, { columns, fetch, actions }) {
    this.container = container;
    this.columns = columns;
    this.fetch = fetch;
    this.actions = actions || [];
    this.limit = 50;
    this.offset = 0;
    this.total = 0;
  }

  async render() {
    const { items, total } = await this.fetch(this.limit, this.offset);
    this.total = total;
    this.container.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'table';

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const col of this.columns) {
      const th = document.createElement('th');
      th.textContent = col.label;
      tr.appendChild(th);
    }
    if (this.actions.length) {
      const th = document.createElement('th');
      th.textContent = '操作';
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const item of items) {
      const row = document.createElement('tr');
      for (const col of this.columns) {
        const td = document.createElement('td');
        td.innerHTML = col.render ? col.render(item) : (item[col.key] ?? '');
        row.appendChild(td);
      }
      if (this.actions.length) {
        const td = document.createElement('td');
        for (const act of this.actions) {
          const btn = document.createElement('button');
          btn.className = `btn btn-sm btn-${act.variant || 'ghost'}`;
          btn.textContent = act.label;
          btn.style.marginRight = '4px';
          btn.onclick = () => act.onClick(item);
          td.appendChild(btn);
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this.container.appendChild(table);

    // Pagination
    const pag = document.createElement('div');
    pag.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:12px;font-size:12px;color:var(--muted)';
    pag.innerHTML = `<span>${this.offset + 1}-${Math.min(this.offset + this.limit, total)} / ${total}</span>`;
    const prev = document.createElement('button');
    prev.className = 'btn btn-sm btn-ghost';
    prev.textContent = '上一页';
    prev.disabled = this.offset === 0;
    prev.onclick = () => { this.offset = Math.max(0, this.offset - this.limit); this.render(); };
    const next = document.createElement('button');
    next.className = 'btn btn-sm btn-ghost';
    next.textContent = '下一页';
    next.disabled = this.offset + this.limit >= total;
    next.onclick = () => { this.offset += this.limit; this.render(); };
    pag.appendChild(prev);
    pag.appendChild(next);
    this.container.appendChild(pag);
  }
}
