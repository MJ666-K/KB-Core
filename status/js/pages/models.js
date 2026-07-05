import { api } from '../api.js';
import { openModal, toast } from '../components/modal.js';
import { Table } from '../components/table.js';

export class Models {
  constructor(root) {
    this.root = root;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <h1 class="page-title">模型管理</h1>
      <p class="page-subtitle">管理 LLM 模型及其默认推理参数（temperature、maxTokens 等）</p>
      <div class="toolbar">
        <button class="btn btn-primary" id="new-btn">+ 添加模型</button>
      </div>
      <div class="card" id="table"></div>`;

    this.table = new Table(document.getElementById('table'), {
      columns: [
        { key: 'name', label: '标识' },
        { key: 'displayName', label: '显示名' },
        { key: 'provider', label: '提供商' },
        { key: 'modelId', label: '模型 ID' },
        { label: '参数', render: m => `<code>T=${m.temperature} M=${m.maxTokens}${m.topP ? ' topP=' + m.topP : ''}</code>` },
        { label: '自定义 URL', render: m => m.apiUrl ? '✓' : '-' },
        { label: '状态', render: m => m.enabled ? `<span class="chip success">启用</span>` : `<span class="chip">禁用</span>` },
      ],
      fetch: async () => { const r = await api('/api/models'); return { items: r.models, total: r.models.length }; },
      actions: [
        { label: '编辑', onClick: m => this.edit(m.name) },
        { label: '删除', variant: 'danger', onClick: m => this.del(m.name) },
      ],
    });
    await this.table.render();

    document.getElementById('new-btn').onclick = () => this.edit(null);
  }

  async edit(name) {
    const data = name ? (await api(`/api/models/${name}`)).model : { name: '', displayName: '', provider: '', modelId: '', apiUrl: '', apiKey: '', temperature: 0.2, maxTokens: 2048, topK: 0, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0, enabled: true };

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="form-field"><label>标识 (唯一)</label><input id="f-name" value="${data.name}" ${name ? 'disabled' : ''}></div>
      <div class="form-field"><label>显示名</label><input id="f-displayName" value="${data.displayName}"></div>
      <div class="form-field"><label>提供商</label><input id="f-provider" value="${data.provider}" placeholder="qwen, deepseek, openai..."></div>
      <div class="form-field"><label>模型 ID (API 请求用)</label><input id="f-modelId" value="${data.modelId}"></div>
      <div class="form-field"><label>自定义 API URL (可选)</label><input id="f-apiUrl" value="${data.apiUrl || ''}" placeholder="留空使用全局配置"></div>
      <div class="form-field"><label>自定义 API Key (可选)</label><input id="f-apiKey" type="password" value="${data.apiKey || ''}" placeholder="留空使用全局 KEY"></div>
      <hr>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field"><label>Temperature (0-2)</label><input id="f-temp" type="number" step="0.1" min="0" max="2" value="${data.temperature}"></div>
        <div class="form-field"><label>Max Tokens</label><input id="f-max" type="number" min="1" value="${data.maxTokens}"></div>
        <div class="form-field"><label>Top-K (0=关闭)</label><input id="f-topk" type="number" min="0" value="${data.topK || 0}"></div>
        <div class="form-field"><label>Top-P (0-1)</label><input id="f-topp" type="number" step="0.1" min="0" max="1" value="${data.topP || 0.9}"></div>
        <div class="form-field"><label>Freq Penalty (-2 到 2)</label><input id="f-fp" type="number" step="0.1" min="-2" max="2" value="${data.frequencyPenalty || 0}"></div>
        <div class="form-field"><label>Presence Penalty (-2 到 2)</label><input id="f-pp" type="number" step="0.1" min="-2" max="2" value="${data.presencePenalty || 0}"></div>
      </div>
      <div class="form-field"><label><input type="checkbox" id="f-enabled" ${data.enabled ? 'checked' : ''}> 启用</label></div>`;

    openModal({
      title: name ? `编辑: ${data.displayName}` : '添加模型',
      body,
      onSave: async () => {
        const payload = {
          name: body.querySelector('#f-name').value.trim(),
          displayName: body.querySelector('#f-displayName').value.trim(),
          provider: body.querySelector('#f-provider').value.trim(),
          modelId: body.querySelector('#f-modelId').value.trim(),
          apiUrl: body.querySelector('#f-apiUrl').value.trim() || null,
          apiKey: body.querySelector('#f-apiKey').value.trim() || null,
          temperature: parseFloat(body.querySelector('#f-temp').value),
          maxTokens: parseInt(body.querySelector('#f-max').value),
          topK: parseInt(body.querySelector('#f-topk').value) || 0,
          topP: parseFloat(body.querySelector('#f-topp').value) || 0.9,
          frequencyPenalty: parseFloat(body.querySelector('#f-fp').value) || 0,
          presencePenalty: parseFloat(body.querySelector('#f-pp').value) || 0,
          enabled: body.querySelector('#f-enabled').checked,
        };
        if (name) await api(`/api/models/${name}`, { method: 'PUT', json: payload });
        else await api('/api/models', { method: 'POST', json: payload });
        toast('已保存');
        this.table.render();
      },
    });
  }

  async del(name) {
    if (!confirm(`确认删除模型 "${name}"? 请先确保没有智能体使用该模型。`)) return;
    try {
      await api(`/api/models/${name}`, { method: 'DELETE' });
      toast('已删除');
      this.table.render();
    } catch (err) { toast(err.message, 'error'); }
  }
}
