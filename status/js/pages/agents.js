import { api } from '../api.js';
import { openModal, toast } from '../components/modal.js';
import { Table } from '../components/table.js';

export class Agents {
  constructor(root) {
    this.root = root;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <h1 class="page-title">智能体管理</h1>
      <p class="page-subtitle">配置主 Agent 路由的子智能体 · 每个子智能体有独立的领域、数据集、人设</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="new-btn">+ 新建智能体</button>
        <button class="btn btn-ghost" id="reload-btn">重载配置</button>
      </div>
      <div class="card" id="table"></div>`;

    this.table = new Table(document.getElementById('table'), {
      columns: [
        { key: 'name', label: '标识' },
        { key: 'displayName', label: '显示名' },
        { key: 'model', label: '模型', render: a => `<span class="chip primary">${a.model?.displayName || '未配置'}</span>` },
        { key: 'description', label: '描述', render: a => a.description.slice(0, 60) + (a.description.length > 60 ? '...' : '') },
        { label: '数据集', render: a => `<span class="chip">${a.datasetIds.length}</span>` },
        { label: '状态', render: a => a.enabled ? `<span class="chip success">启用</span>` : `<span class="chip">禁用</span>` },
      ],
      fetch: async () => { const r = await api('/api/agents'); return { items: r.agents, total: r.agents.length }; },
      actions: [
        { label: '编辑', onClick: a => this.edit(a.name) },
        { label: '删除', variant: 'danger', onClick: a => this.del(a.name) },
      ],
    });
    await this.table.render();

    document.getElementById('new-btn').onclick = () => this.edit(null);
    document.getElementById('reload-btn').onclick = async () => {
      try {
        await api('/api/reload', { method: 'POST' });
        toast('配置已重载');
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async edit(name) {
    const [agentData, modelsRes] = await Promise.all([
      name ? api(`/api/agents/${name}`) : Promise.resolve(null),
      api('/api/models'),
    ]);
    const data = agentData?.agent || { name: '', displayName: '', description: '', systemPrompt: '', modelId: '', datasetIds: [], skillNames: [], personality: '', enabled: true };
    const models = modelsRes.models || [];
    const currentModelId = data.modelId || (data.model?.id || '');

    const modelOptions = models.map(m =>
      `<option value="${m.id}" ${m.id === currentModelId ? 'selected' : ''}>${m.displayName} (${m.provider}/${m.modelId}) — T:${m.temperature} M:${m.maxTokens}</option>`
    ).join('');

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-field"><label>标识 (name)</label><input id="f-name" value="${name ? data.name : ''}" ${name ? 'disabled' : ''}></div>
      <div class="form-field"><label>显示名</label><input id="f-displayName" value="${data.displayName || ''}"></div>
      <div class="form-field"><label>描述（给主 Agent 看）</label><textarea id="f-description">${data.description || ''}</textarea></div>
      <div class="form-field"><label>系统 Prompt</label><textarea id="f-sp" style="min-height:160px">${data.systemPrompt || ''}</textarea></div>
      <div class="form-field">
        <label>模型（含配置参数）</label>
        <select id="f-model">
          <option value="">请选择模型</option>
          ${modelOptions}
        </select>
      </div>
      <div class="form-field"><label>数据集 IDs (逗号分隔 UUID)</label><input id="f-ds" value="${(data.datasetIds || []).join(', ')}"></div>
      <div class="form-field"><label>性格描述</label><input id="f-pers" value="${data.personality || ''}"></div>
      <div class="form-field"><label><input type="checkbox" id="f-enabled" ${data.enabled ? 'checked' : ''}> 启用</label></div>`;

    openModal({
      title: name ? `编辑: ${data.displayName}` : '新建智能体',
      body,
      onSave: async () => {
        const payload = {
          name: body.querySelector('#f-name').value.trim(),
          displayName: body.querySelector('#f-displayName').value.trim(),
          description: body.querySelector('#f-description').value,
          systemPrompt: body.querySelector('#f-sp').value,
          modelId: body.querySelector('#f-model').value,
          datasetIds: body.querySelector('#f-ds').value.split(',').map(s => s.trim()).filter(Boolean),
          skillNames: data.skillNames || [],
          personality: body.querySelector('#f-pers').value || null,
          enabled: body.querySelector('#f-enabled').checked,
        };
        if (name) await api(`/api/agents/${name}`, { method: 'PUT', json: payload });
        else await api('/api/agents', { method: 'POST', json: payload });
        toast('已保存');
        this.table.render();
      },
    });
  }

  async del(name) {
    if (!confirm(`确认删除 "${name}"?`)) return;
    try {
      await api(`/api/agents/${name}`, { method: 'DELETE' });
      toast('已删除');
      this.table.render();
    } catch (err) { toast(err.message, 'error'); }
  }
}
