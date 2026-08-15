import type { Permission } from '../../auth/permission-registry';
import { ALL_PERMISSIONS } from '../../auth/permission-registry';
import {
  FENGQIAO_MAIN_ROUTER_BODY,
  FENGQIAO_MEDIATION_AGENT_PROMPT,
  FENGQIAO_CORPORATE_AGENT_PROMPT,
  FENGQIAO_GENERAL_AGENT_PROMPT,
} from '../../agent/fengqiao-rules';

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
      'dashboard:view', 'chat:use', 'kg:view', 'documents:read', 'documents:write',
      'agents:manage', 'models:manage', 'skills:manage', 'settings:manage',
    ],
  },
  {
    key: 'user',
    label: '普通用户',
    description: '可使用法律助手，只读浏览文档',
    isSystem: true,
    permissions: ['chat:use', 'kg:view', 'documents:read'],
  }
];

/** 预设智能体（依赖 PRESET_MODELS + datasets） */
export const PRESET_AGENTS: PresetAgent[] = [
  {
    name: 'router',
    displayName: '路由智能体',
    description: '枫桥智诉主调度：按民商双轨路由到调解/企业/通用子智能体。',
    systemPrompt: FENGQIAO_MAIN_ROUTER_BODY,
    modelName: 'qwen-turbo',
    datasetNames: [],
    skillNames: [],
    personality: '高效、精准',
  },
  {
    name: 'general',
    displayName: '通用法律助手',
    description: '通用法律知识问答，适用于所有非特定领域的法律问题、法条查询、一般法律咨询。',
    systemPrompt: FENGQIAO_GENERAL_AGENT_PROMPT,
    modelName: 'qwen-max',
    datasetNames: ['default', 'legal'],
    skillNames: [],
    personality: '专业、准确、简洁',
  },
  {
    name: 'mediation',
    displayName: '基层调解助手',
    description: '枫桥调解轨：邻里纠纷、婚姻家庭、劳动争议、物业矛盾、工伤赔偿等基层矛盾纠纷化解。',
    systemPrompt: FENGQIAO_MEDIATION_AGENT_PROMPT,
    modelName: 'deepseek-v4-pro',
    datasetNames: ['default', 'legal'],
    skillNames: ['mediation-advisor', 'compare', 'multihop'],
    personality: '温和、耐心、务实',
  },
  {
    name: 'corporate',
    displayName: '企业法务顾问',
    description: '枫桥企业合规轨：合同审查、股权设计、劳动用工合规、账款催收、公司治理与合规风控。',
    systemPrompt: FENGQIAO_CORPORATE_AGENT_PROMPT,
    modelName: 'deepseek-v4-pro',
    datasetNames: ['default', 'legal'],
    skillNames: ['multihop', 'compare'],
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
