import { api } from '../api.js';
import { openModal, toast } from '../components/modal.js';
import { Table } from '../components/table.js';

export class Skills {
  constructor(root) {
    this.root = root;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <h1 class="page-title">Skill 管理</h1>
      <p class="page-subtitle">Skill 是 Agent 的高级任务单元，含 LLM 指令和工具白名单</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="new-btn">+ 新建 Skill</button>
      </div>
      <div class="card" id="table"></div>`;

    this.table = new Table(document.getElementById('table'), {
      columns: [
        { key: 'name', label: '标识' },
        { key: 'displayName', label: '显示名' },
        { key: 'description', label: '描述', render: s => s.description.slice(0, 50) + '...' },
        { label: '工具', render: s => (s.tools || []).map(t => `<span class="chip">${t}</span>`).join('') || '<span class="chip">无</span>' },
        { key: 'version', label: '版本' },
        { label: '状态', render: s => s.enabled ? `<span class="chip success">启用</span>` : `<span class="chip">禁用</span>` },
      ],
      fetch: async () => { const r = await api('/api/skills'); return { items: r.skills, total: r.skills.length }; },
      actions: [
        { label: '编辑', onClick: s => this.edit(s.name) },
        { label: '禁用', variant: 'danger', onClick: s => this.disable(s.name) },
      ],
    });
    await this.table.render();
    document.getElementById('new-btn').onclick = () => this.edit(null);
  }

  async edit(name) {
    let data = name ? await api(`/api/skills/${name}`) : null;
    data = data?.skill || { name: '', displayName: '', description: '', tools: [], parameters: {}, instructions: '', enabled: true };

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-field"><label>标识</label><input id="f-name" value="${data.name}" ${name ? 'disabled' : ''}></div>
      <div class="form-field"><label>显示名</label><input id="f-displayName" value="${data.displayName}"></div>
      <div class="form-field"><label>描述（给 LLM 看）</label><textarea id="f-desc">${data.description}</textarea></div>
      <div class="form-field"><label>工具白名单 (逗号分隔，可选: search_knowledge, get_document, get_chunk, list_documents, summarize_text)</label><input id="f-tools" value="${(data.tools || []).join(', ')}"></div>
      <div class="form-field"><label>参数 JSON Schema (JSON 字符串)</label><textarea id="f-params">${JSON.stringify(data.parameters || {}, null, 2)}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field"><label>Instructions (Markdown)</label><textarea id="f-inst" style="min-height:300px">${data.instructions}</textarea></div>
        <div class="form-field"><label>预览</label><div id="f-preview" style="min-height:300px;border:1px solid var(--border);border-radius:6px;padding:12px;overflow:auto"></div></div>
      </div>`;

    openModal({
      title: name ? `编辑: ${data.displayName}` : '新建 Skill',
      body,
      onSave: async () => {
        let params;
        try { params = JSON.parse(body.querySelector('#f-params').value); }
        catch { throw new Error('参数 JSON 格式错误'); }
        const payload = {
          name: body.querySelector('#f-name').value.trim(),
          displayName: body.querySelector('#f-displayName').value.trim(),
          description: body.querySelector('#f-desc').value,
          tools: body.querySelector('#f-tools').value.split(',').map(s => s.trim()).filter(Boolean),
          parameters: params,
          instructions: body.querySelector('#f-inst').value,
          enabled: data.enabled,
        };
        if (name) await api(`/api/skills/${name}`, { method: 'PUT', json: payload });
        else await api('/api/skills', { method: 'POST', json: payload });
        toast('已保存');
        this.table.render();
      },
    });

    // Live md preview
    const preview = body.querySelector('#f-preview');
    const inst = body.querySelector('#f-inst');
    const updatePreview = () => {
      preview.innerHTML = simpleMd(inst.value);
    };
    inst.addEventListener('input', updatePreview);
    updatePreview();
  }

  async disable(name) {
    if (!confirm(`确认禁用 "${name}"?`)) return;
    await api(`/api/skills/${name}`, { method: 'DELETE' });
    toast('已禁用');
    this.table.render();
  }
}

function simpleMd(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}
