const BASE = '';

export async function api(path, opts = {}) {
  const { method = 'GET', body, json, headers: extraHeaders } = opts;
  const headers = { ...extraHeaders };
  let bodyData = body;

  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyData = JSON.stringify(json);
  }

  const res = await fetch(BASE + path, { method, headers, body: bodyData });

  if (res.status === 204) return null;

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!res.ok) {
    const msg = parsed?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return parsed ?? text;
}

export function wsConnect(onMessage, onError) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/query`);
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onerror = (e) => onError && onError(e);
  return ws;
}
