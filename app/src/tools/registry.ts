import type { Tool } from './types';
import type { FunctionDefinition } from '../llm/llm-service';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined { return this.tools.get(name); }
  has(name: string): boolean { return this.tools.has(name); }

  toFunctionDefinitions(): FunctionDefinition[] {
    return [...this.tools.values()].map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  list(): Array<{ name: string; description: string }> {
    return [...this.tools.values()].map(t => ({ name: t.name, description: t.description }));
  }
}
