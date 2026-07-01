import type { QueryAgent } from './query-agent';

let agentInstance: QueryAgent | null = null;

export function setAgent(agent: QueryAgent): void {
  agentInstance = agent;
}

export function getAgent(): QueryAgent | null {
  return agentInstance;
}
