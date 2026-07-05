import { api } from '../api.js';

export class Dashboard {
  constructor(root) {
    this.root = root;
    this.load();
  }

  async load() {
    this.root.innerHTML = `
      <h1 class="page-title">控制台</h1>
      <p class="page-subtitle">Knowledge Core 数据总览</p>
      <div class="stat-grid" id="stats">加载中...</div>
      <div class="card">
        <h3 style="margin-bottom:12px">数据集分布</h3>
        <div id="ds-stats">加载中...</div>
      </div>`;

    try {
      const s = await api('/api/stats');
      document.getElementById('stats').innerHTML = `
        <div class="stat-card"><div class="stat-label">文档总数</div><div class="stat-value">${s.totalDocuments}</div></div>
        <div class="stat-card"><div class="stat-label">切片总数</div><div class="stat-value">${s.totalChunks}</div></div>
        <div class="stat-card"><div class="stat-label">已嵌入</div><div class="stat-value">${s.readyChunks}</div></div>
        <div class="stat-card"><div class="stat-label">今日查询</div><div class="stat-value">${s.todayQueries}</div></div>
        <div class="stat-card"><div class="stat-label">历史查询</div><div class="stat-value">${s.totalQueries}</div></div>`;

      document.getElementById('ds-stats').innerHTML = `<table class="table">
        <thead><tr><th>数据集</th><th>文档</th><th>切片</th></tr></thead>
        <tbody>${s.datasetStats.map(d => `<tr><td>${d.name}</td><td>${d.docCount}</td><td>${d.chunkCount}</td></tr>`).join('')}</tbody>
      </table>`;
    } catch (err) {
      document.getElementById('stats').innerHTML = `<div class="card">加载失败: ${err.message}</div>`;
    }
  }
}
