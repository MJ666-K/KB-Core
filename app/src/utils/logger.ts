import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function log(level: LogLevel, msg: string, data?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[config.logLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const fn = level === 'error' ? console.error : console.log;

  if (data !== undefined) {
    const dataStr = formatLogData(data);
    fn(`${prefix} ${msg} ${dataStr}`);
  } else {
    fn(`${prefix} ${msg}`);
  }
}

function formatLogData(data: unknown, depth = 0): string {
  if (depth > 3) return '[...]';
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    if (data.length > 5) return `[${data.slice(0, 5).map(d => formatLogData(d, depth + 1)).join(', ')}, +${data.length - 5} more]`;
    return `[${data.map(d => formatLogData(d, depth + 1)).join(', ')}]`;
  }
  
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    
    const formatted = entries.map(([k, v]) => {
      const vStr = formatLogData(v, depth + 1);
      return `${k}=${vStr}`;
    });
    
    if (formatted.length > 5) {
      return `{${formatted.slice(0, 5).join(', ')}, +${formatted.length - 5} more}`;
    }
    return `{${formatted.join(', ')}}`;
  }
  
  return String(data);
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};
