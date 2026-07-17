import type { MainAgent } from './main-agent';

let agentInstance: MainAgent | null = null;

export function setAgent(agent: MainAgent): void {
  agentInstance = agent;
}

export function getAgent(): MainAgent | null {
  return agentInstance;
}
