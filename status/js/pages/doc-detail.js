import { api } from '../api.js';
import { toast } from '../components/modal.js';

export class DocDetail {
  constructor(root, params) {
    this.root = root;
    this.id = params[0];
    this.chunks = [];
    this.original = '';
    this.activeChunk = null;
    this.load();
  }

  async load() {
    try {
      const [docRes, chunksRes] = await Promise.all([
        api(`/api/documents/${this.id}`),
        api(`/api/documents/${this.id}/chunks`),
      ]);
      this.doc = docRes.document;
      this.chunks = chunksRes.chunks.filter(c => c.childIndexWithinParent !== null)
        .sort((a, b) => a.startOffset - b.startOffset);

      const origRes = await fetch(`/api/documents/${this.id}/content`);
      this.original = await origRes.text();

      this.render();
    } catch (err) {
      this.root.innerHTML = `<div class="card">加载失败: ${err.message}</div>`;
    }
  }

  render() {
    this.root.innerHTML = `
      <h1 class="page-title">${this.doc.title}</h1>
      <p class="page-subtitle">
        <span class="chip">${this.doc.status}</span>
        <span class="chip">${this.doc.datasetName}</span>
        ${this.chunks.length} 切片 · ${(this.doc.fileSize / 1024).toFixed(1)} KB
      </p>

      <div class="collapsible-header" id="cfg-toggle">▶ 切片配置</div>
      <div class="collapsible-body" id="cfg-body">
        <div class="card" style="font-size:12px;color:var(--muted)">
          切片参数（仅展示，修改后需重切割）：
          <div style="margin-top:8px">
            <code>parentChunkIndex / childIndexWithinParent: ${this.chunks.length > 0 ? '已生成' : '无'}</code>
            <br><code>平均 token 数: ${this.chunks.length ? Math.round(this.chunks.reduce((s, c) => s + c.tokenCount, 0) / this.chunks.length) : 0}</code>
          </div>
        </div>
      </div>

      <div class="doc-viewer" style="margin-top:16px">
        <div class="doc-original" id="original"></div>
        <div class="doc-chunks" id="chunks"></div>
      </div>`;

    document.getElementById('cfg-toggle').onclick = () => {
      document.getElementById('cfg-body').classList.toggle('open');
    };

    // Render original with highlights
    const original = document.getElementById('original');
    let html = '';
    let cursor = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const start = c.startOffset ?? cursor;
      const end = c.endOffset ?? start;
      if (start > cursor) html += this.esc(this.original.slice(cursor, start));
      html += `<mark data-chunk-idx="${i}" id="chunk-${i}">${this.esc(this.original.slice(start, end))}</mark>`;
      cursor = end;
    }
    if (cursor < this.original.length) html += this.esc(this.original.slice(cursor));
    original.innerHTML = html;

    // Render chunk list
    const chunkList = document.getElementById('chunks');
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const card = document.createElement('div');
      card.className = 'chunk-card';
      card.innerHTML = `
        <div class="chunk-meta">
          idx=${c.parentChunkIndex}.${c.childIndexWithinParent}
          · tokens=${c.tokenCount}
          · ${c.embeddingStatus}
          · #${c.id.slice(0, 8)}
        </div>
        <div class="chunk-text">${c.content.slice(0, 220)}${c.content.length > 220 ? '...' : ''}</div>`;
      card.onclick = () => {
        for (const el of chunkList.children) el.classList.remove('active');
        card.classList.add('active');
        const mark = original.querySelector(`#chunk-${i}`);
        if (mark) { mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); original.querySelectorAll('mark').forEach(m => m.style.background = '#fef08a'); mark.style.background = '#fbbf24'; }
      };
      chunkList.appendChild(card);
    }

    // Click mark → select chunk
    for (const mark of original.querySelectorAll('mark')) {
      mark.onclick = () => {
        const idx = Number(mark.dataset.chunkIdx);
        chunkList.children[idx].click();
      };
    }
  }

  esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
