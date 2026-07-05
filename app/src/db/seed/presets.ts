import type { Permission } from '../../auth/permission-registry';
import { ALL_PERMISSIONS } from '../../auth/permission-registry';

export interface PresetDataset {
  name: string;
  description?: string;
}

export interface PresetModel {
  name: string;
  displayName: string;
  provider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  topK?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface PresetRole {
  key: string;
  label: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
}

export interface PresetAgent {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  modelName: string;
  datasetNames: string[];
  skillNames: string[];
  personality: string;
}

/** 基础数据集 */
export const PRESET_DATASETS: PresetDataset[] = [
  { name: 'default', description: '默认知识库' },
  { name: 'legal', description: '法律文档库' },
];

/** 预设 LLM 模型（原 manual_add_agents_and_skills.sql） */
export const PRESET_MODELS: PresetModel[] = [
  { name: 'qwen-turbo', displayName: 'Qwen Turbo', provider: 'qwen', modelId: 'qwen-turbo', temperature: 0.1, maxTokens: 512 },
  { name: 'qwen-plus', displayName: 'Qwen Plus', provider: 'qwen', modelId: 'qwen-plus', temperature: 0.2, maxTokens: 2048 },
  { name: 'qwen-max', displayName: 'Qwen Max', provider: 'qwen', modelId: 'qwen-max', temperature: 0.3, maxTokens: 4096 },
  { name: 'deepseek-v4', displayName: 'DeepSeek V4', provider: 'deepseek', modelId: 'deepseek-v4', temperature: 0.2, maxTokens: 4096 },
  { name: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'deepseek', modelId: 'deepseek-v4-pro', temperature: 0.3, maxTokens: 8192 },
];

/** 预设角色与权限（原 manual_add_roles.sql） */
export const PRESET_ROLES: PresetRole[] = [
  {
    key: 'superadmin',
    label: '超级管理员',
    description: '拥有系统全部权限，可管理用户与角色',
    isSystem: true,
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: 'admin',
    label: '管理员',
    description: '可管理知识库、智能体、模型与系统参数',
    isSystem: true,
    permissions: [
      'dashboard:view', 'chat:use', 'documents:read', 'documents:write',
      'agents:manage', 'models:manage', 'skills:manage', 'settings:manage',
    ],
  },
  {
    key: 'user',
    label: '普通用户',
    description: '可使用法律助手，只读浏览文档',
    isSystem: true,
    permissions: ['chat:use', 'documents:read'],
  }
];

/** 预设智能体（依赖 PRESET_MODELS + datasets） */
export const PRESET_AGENTS: PresetAgent[] = [
  {
    name: 'router',
    displayName: '路由智能体',
    description: '快速判断用户意图，分发到对应的领域专家智能体。',
    systemPrompt: '你是路由智能体。根据用户问题快速判断应交给哪个领域专家处理，直接调用对应 agent。',
    modelName: 'qwen-turbo',
    datasetNames: [],
    skillNames: [],
    personality: '高效、精准',
  },
  {
    name: 'general',
    displayName: '通用法律助手',
    description: '通用法律知识问答，适用于所有非特定领域的法律问题、法条查询、一般法律咨询。',
    systemPrompt: '你是「通用法律助手」。基于知识库中的法律文档，为用户提供准确的法律问答。回答时精确引用法律名称和条款编号。如果知识库中没有相关内容，诚实说明。',
    modelName: 'qwen-max',
    datasetNames: ['default', 'legal'],
    skillNames: [],
    personality: '专业、准确、简洁',
  },
  {
    name: 'mediation',
    displayName: '基层调解助手',
    description: '专注于劳动争议、调解仲裁、工伤赔偿、工资福利、劳动合同解除等劳动者权益问题。',
    systemPrompt: '你是「基层调解助手」，专门处理劳动者与用人单位之间的纠纷咨询。重点使用《劳动法》《劳动合同法》《劳动争议调解仲裁法》《社会保险法》等。回答时明确引用法条，给出可操作的调解建议。优先保护劳动者合法权益。',
    modelName: 'deepseek-v4-pro',
    datasetNames: ['legal'],
    skillNames: [],
    personality: '温和、耐心、务实',
  },
  {
    name: 'corporate',
    displayName: '企业法务顾问',
    description: '专注于公司法务、合同审查、公司治理、股权架构、合规风控等企业端法律问题。',
    systemPrompt: '你是「企业法务顾问」，为企业提供合规和公司治理方面的法律建议。重点使用《公司法》《民法典》合同编等。回答时关注企业端的合规要求和风险防范，给出具体的操作建议。注意：你的建议不构成正式法律意见。',
    modelName: 'deepseek-v4-pro',
    datasetNames: ['legal'],
    skillNames: [],
    personality: '严谨、前瞻、风险导向',
  },
  {
    name: 'executor',
    displayName: '工具执行智能体',
    description: '执行具体的工具调用和结果整理，如知识库检索、文档查询、摘要生成等。',
    systemPrompt: '你是工具执行智能体。根据指令执行工具调用，整理并返回结构化结果。',
    modelName: 'qwen-plus',
    datasetNames: ['default', 'legal'],
    skillNames: [],
    personality: '高效、结构化',
  },
];
