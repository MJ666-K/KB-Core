import { api } from '../api.js';
import { toast } from '../components/modal.js';
import { Table } from '../components/table.js';

export class Documents {
  constructor(root) {
    this.root = root;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <h1 class="page-title">文档管理</h1>
      <p class="page-subtitle">上传法律文档 · 查看入库状态 · 切片管理</p>

      <div class="card">
        <input type="file" id="file-input" style="display:none" multiple accept=".txt,.md">
        <div class="upload-zone" id="upload-zone">
          <div style="font-size:32px">📄</div>
          <div>点击或拖拽上传文件 (.txt, .md)</div>
        </div>
      </div>

      <div class="toolbar">
        <input id="search" placeholder="搜索标题..." style="padding:6px 12px;border:1px solid var(--border);border-radius:6px;min-width:200px">
        <select id="status-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px">
          <option value="">所有状态</option>
          <option value="ready">就绪</option>
          <option value="pending">等待中</option>
          <option value="failed">失败</option>
        </select>
        <select id="dataset-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:6px">
          <option value="">所有数据集</option>
        </select>
      </div>

      <div class="card"><div id="table"></div></div>`;

    // Load datasets for filter
    const ds = await api('/api/datasets');
    const df = document.getElementById('dataset-filter');
    for (const d of ds.datasets) {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = d.name;
      df.appendChild(opt);
    }

    this.table = new Table(document.getElementById('table'), {
      columns: [
        { label: '标题', render: d => `<a href="#/documents/${d.id}" style="color:var(--primary);text-decoration:none">${d.title}</a>` },
        { key: 'datasetName', label: '数据集' },
        { label: '状态', render: d => {
          const colors = { ready: 'success', failed: 'primary' };
          return `<span class="chip ${colors[d.status] || ''}">${d.status}</span>`;
        }},
        { label: '大小', render: d => `${(d.fileSize / 1024).toFixed(1)} KB` },
        { label: '切片', render: d => `<span class="chip">${d.chunkCount}</span>` },
        { label: '入库时间', render: d => new Date(d.createdAt).toLocaleString() },
      ],
      fetch: async () => {
        const search = document.getElementById('search').value;
        const status = document.getElementById('status-filter').value;
        const datasetId = document.getElementById('dataset-filter').value;
        const qs = [search && `search=${encodeURIComponent(search)}`, status && `status=${status}`, datasetId && `datasetId=${datasetId}`, 'limit=50'].filter(Boolean).join('&');
        const r = await api(`/api/documents?${qs}`);
        return { items: r.documents, total: r.documents.length };
      },
      actions: [
        { label: '查看', onClick: d => location.hash = `#/documents/${d.id}` },
        { label: '重切割', onClick: d => this.reingest(d) },
        { label: '删除', variant: 'danger', onClick: d => this.del(d.id) },
      ],
    });
    await this.table.render();

    // Upload
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    zone.onclick = () => input.click();
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag'); };
    zone.ondragleave = () => zone.classList.remove('drag');
    zone.ondrop = async (e) => { e.preventDefault(); zone.classList.remove('drag'); await this.upload(e.dataTransfer.files); };
    input.onchange = async () => { if (input.files.length) await this.upload(input.files); };

    // Filters
    document.getElementById('search').oninput = () => this.table.render();
    document.getElementById('status-filter').onchange = () => this.table.render();
    document.getElementById('dataset-filter').onchange = () => this.table.render();
  }

  async upload(files) {
    const datasetId = document.getElementById('dataset-filter').value ||
      (await api('/api/datasets')).datasets.find(d => d.name === 'legal')?.id || '';
    const datasetName = (await api('/api/datasets')).datasets.find(d => d.id === datasetId)?.name || 'legal';

    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('dataset', datasetName);
      try {
        await api('/ingest', { method: 'POST', body: fd });
        toast(`已上传: ${file.name}`);
      } catch (err) { toast(`${file.name}: ${err.message}`, 'error'); }
    }
    setTimeout(() => this.table.render(), 1000);
  }

  async reingest(doc) {
    if (!confirm(`确认重切割 "${doc.title}"?`)) return;
    try {
      await api(`/api/documents/${doc.id}/reingest`, { method: 'POST' });
      toast('已加入队列');
      this.table.render();
    } catch (err) { toast(err.message, 'error'); }
  }

  async del(id) {
    if (!confirm('确认删除?')) return;
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      toast('已删除');
      this.table.render();
    } catch (err) { toast(err.message, 'error'); }
  }
}
