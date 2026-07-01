const WS_URL_DEFAULT = process.env.KB_WS_URL ?? 'ws://localhost:3000/ws/query';

export interface WsQueryResult {
  type: 'result';
  answer: string;
  citations: Array<{ chunkId: string; documentId: string; documentTitle: string; excerpt: string; score: number }>;
  steps: Array<{ iteration: number; thought: string; action: string }>;
  toolCalls: Array<{ name: string; kind: string }>;
  latencyMs: number;
  queryLogId: string;
  termination: string;
}

export function wsQuery(question: string, timeoutMs = 120_000, wsUrl = WS_URL_DEFAULT): Promise<WsQueryResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket query timeout'));
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'query', question }));
    };

    ws.onmessage = (ev) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(ev.data)) as WsQueryResult | { type: 'error'; error: string; detail?: unknown };
        ws.close();
        if (data.type === 'error') {
          reject(new Error(data.error + (data.detail ? `: ${JSON.stringify(data.detail)}` : '')));
          return;
        }
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connection error'));
    };
  });
}
