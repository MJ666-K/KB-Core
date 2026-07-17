export interface ToolContext {
  datasetId: string;
  datasetIds?: readonly string[];
  userId?: string;
  queryLogId?: string;
  events?: import('@features/chat/agent/types').EventStream;
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: readonly string[];
  default?: unknown;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
}

export interface Tool<TParams = Record<string, unknown>, TData = unknown> {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: readonly string[];
  };
  execute(params: TParams, ctx: ToolContext): Promise<TData>;
}
