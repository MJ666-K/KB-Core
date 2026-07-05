import { wsConnect } from '../api.js';
import { toast } from '../components/modal.js';

export class Chat {
  constructor(root) {
    this.root = root;
    this.history = [];
    this.ws = null;
    this.pendingTools = new Map();
    this.render();
    this.connect();
  }

  render() {
    this.root.innerHTML = `
      <h1 class="page-title">智能问答</h1>
      <p class="page-subtitle">主 Agent 自动根据问题意图路由到合适的子智能体</p>

      <div class="chat-container">
        <div class="chat-messages" id="messages"></div>
        <div class="collapsible-header" id="advanced-toggle">▶ 高级参数</div>
        <div class="collapsible-body" id="advanced">
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px,1fr));gap:8px;margin-bottom:8px">
            <div><label style="font-size:11px;color:var(--muted)">topK</label><input id="p-topk" type="number" value="5" min="1" max="50" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px"></div>
            <div><label style="font-size:11px;color:var(--muted)">maxIterations</label><input id="p-iter" type="number" value="5" min="1" max="10" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px"></div>
            <div><label style="font-size:11px;color:var(--muted)">temperature</label><input id="p-temp" type="number" step="0.1" value="0.2" min="0" max="1" style="width:100%;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px"></div>
          </div>
        </div>
        <div class="chat-input-box">
          <input class="chat-input" id="input" placeholder="输入法律问题...">
          <button class="btn btn-primary" id="send">发送</button>
        </div>
      </div>`;

    document.getElementById('advanced-toggle').onclick = () =>
      document.getElementById('advanced').classList.toggle('open');

    document.getElementById('send').onclick = () => this.send();
    document.getElementById('input').onkeydown = (e) => { if (e.key === 'Enter') this.send(); };
  }

  connect() {
    this.ws = wsConnect(
      (data) => this.handleMsg(data),
      () => {
        toast('WebSocket 断开');
        setTimeout(() => this.connect(), 2000);
      },
    );
  }

  send() {
    const input = document.getElementById('input');
    const q = input.value.trim();
    if (!q || this.ws.readyState !== WebSocket.OPEN) return;
    input.value = '';

    this.appendUser(q);
    this.curAgentMsg = this.startAgentMsg();

    this.ws.send(JSON.stringify({
      type: 'query',
      question: q,
      options: {
        history: this.history.slice(-20),
        topK: Number(document.getElementById('p-topk').value) || 5,
        maxIterations: Number(document.getElementById('p-iter').value) || 5,
      },
    }));
  }

  appendUser(q) {
    const m = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'chat-msg user';
    el.innerHTML = `<div class="bubble">${this.esc(q)}</div>`;
    m.appendChild(el);
    this.history.push({ role: 'user', content: q });
    m.scrollTop = m.scrollHeight;
  }

  startAgentMsg() {
    const m = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'chat-msg agent';
    el.innerHTML = `
      <div class="event-line"><span class="spinner">⏳</span> 思考中...</div>
      <div class="events"></div>
      <div class="answer-text"></div>
      <div class="citations"></div>
      <div class="meta" style="font-size:11px;color:var(--muted);margin-top:8px"></div>`;
    m.appendChild(el);
    m.scrollTop = m.scrollHeight;
    return el;
  }

  handleMsg(d) {
    if (!this.curAgentMsg) return;
    const events = this.curAgentMsg.querySelector('.events');
    const answer = this.curAgentMsg.querySelector('.answer-text');
    const meta = this.curAgentMsg.querySelector('.meta');

    switch (d.type) {
      case 'thought_start':
        events.innerHTML = `<div class="event-line"><span class="spinner">💭</span> 思考中...</div>`;
        break;
      case 'thought_token':
        if (d.token) {
          let thoughtLine = events.querySelector('.thought-line');
          if (!thoughtLine) {
            thoughtLine = document.createElement('div');
            thoughtLine.className = 'thought-line';
            thoughtLine.style.cssText = 'font-size:12px;color:var(--text-muted);padding:4px 8px;margin:4px 0';
            events.appendChild(thoughtLine);
          }
          thoughtLine.textContent += d.token;
        }
        break;
      case 'thought_end':
        break;
      case 'action': {
        const key = `${d.name}-${Date.now()}`;
        this.pendingTools.set(key, d.name);
        const line = `<div class="event-line" id="ev-${key}"><span class="spinner">🔧</span> 调用 ${d.name}</div>`;
        events.insertAdjacentHTML('beforeend', line);
        break;
      }
      case 'action_end': {
        for (const [key, name] of this.pendingTools) {
          if (name === d.name) {
            const lineEl = events.querySelector(`#ev-${key}`);
            if (lineEl) lineEl.innerHTML = `<span class="done">✅</span> ${d.name} 完成`;
            this.pendingTools.delete(key);
            break;
          }
        }
        break;
      }
      case 'answer_start':
        break;
      case 'answer_token':
        answer.insertAdjacentText('beforeend', d.token);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        break;
      case 'answer_end':
        break;
      case 'result':
        this.finishAgentMsg(d);
        break;
      case 'error':
        answer.innerHTML += `<div style="color:var(--danger)">❌ ${this.esc(d.error)}</div>`;
        this.curAgentMsg = null;
        break;
      case 'retrieval_results':
        this.handleRetrievalResults(d.results, d.action);
        break;
    }
  }

  handleRetrievalResults(results, action) {
    if (!this.curAgentMsg || !results || results.length === 0) return;

    let retrievalsDiv = this.curAgentMsg.querySelector('.retrievals');
    if (!retrievalsDiv) {
      retrievalsDiv = document.createElement('div');
      retrievalsDiv.className = 'retrievals';
      retrievalsDiv.style.cssText = 'margin:12px 0;padding:10px;background:var(--bg-light);border-radius:6px;font-size:13px';
      retrievalsDiv.innerHTML = `<div style="font-weight:600;margin-bottom:8px;color:var(--text)">📚 召回的相关文本 (${action})</div>`;
      this.curAgentMsg.insertBefore(retrievalsDiv, this.curAgentMsg.querySelector('.answer-text'));
    }

    const retrievals = results.map((r, idx) => {
      const truncated = r.text.length > 300 ? r.text.slice(0, 300) + '...' : r.text;
      return `
        <div style="margin:8px 0;padding:8px;background:var(--bg-lighter);border-left:3px solid var(--primary);border-radius:4px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">
            📄 ${this.esc(r.documentTitle || '未知')} · ${this.esc(r.chunkId.slice(0, 8))}... · 相关度: ${(r.score * 100).toFixed(1)}%
          </div>
          <div style="font-size:12px;line-height:1.5;color:var(--text)">
            ${this.esc(truncated)}
          </div>
        </div>
      `;
    }).join('');

    retrievalsDiv.innerHTML += retrievals;
  }

  finishAgentMsg(d) {
    if (!this.curAgentMsg) return;
    const cites = this.curAgentMsg.querySelector('.citations');
    const meta = this.curAgentMsg.querySelector('.meta');
    const events = this.curAgentMsg.querySelector('.events');
    events.innerHTML = '';

    if (d.citations && d.citations.length > 0) {
      cites.innerHTML = `<div style="font-weight:600;margin-bottom:6px">📎 引用 (${d.citations.length})</div>` +
        d.citations.map(c => `<div class="cite">[${c.score.toFixed(2)}] <b>${this.esc(c.documentTitle || '未知')}</b>: ${this.esc(c.excerpt.slice(0, 120))}</div>`).join('');
    }

    meta.textContent = `⏱ ${d.latencyMs}ms · ${d.termination} · ${d.citations?.length || 0} 引用`;
    this.history.push({ role: 'assistant', content: d.answer });
    this.curAgentMsg = null;
  }

  esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}
