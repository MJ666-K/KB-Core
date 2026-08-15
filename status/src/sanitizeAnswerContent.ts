/**
 * 回答展示前的清理层。
 *
 * 职责：
 * 1. 去掉系统级冗余提示（界面已有统一免责声明）。
 * 2. 防御性清除 LLM 偶发泄露的系统内部信息：函数调用 JSON、tool_calls、
 *    权限键值对（如 documents:write）、snake_case 内部标识（如 search_knowledge）、
 *    编排日志行（如 "[Agent] 迭代 1 → 调用 X 工具"）。
 *
 * 设计原则：代码块感知。只对"内部转储型"代码块整体删除，对合法代码块（mermaid/
 * 语言代码）原样保留；对正文做窄而安全的清理，避免误伤正常法律/业务文本。
 */

/** 已知权限键（与后端 auth/permission-registry 保持一致） */
const PERMISSION_KEYS = [
  'dashboard:view', 'chat:use', 'kg:view',
  'documents:read', 'documents:write',
  'agents:manage', 'models:manage', 'skills:manage',
  'settings:manage', 'users:manage', 'roles:manage',
];

/** snake_case 内部标识（在正文中出现即可安全删除，不是自然语言词汇） */
const SNAKE_INTERNAL_IDS = [
  'search_knowledge', 'call_agent', 'list_documents',
  'add_document', 'delete_document', 'get_chunk', 'multihop',
];

const DISCLAIMER_PATTERNS = [
  /^未检索到相关法律条文[。.]?\s*$/gm,
  /^以下回答未基于知识库检索[，,].*?请咨询专业律师[。.]?\s*$/gm,
  /^知识库检索未获得可用法律条文[。.]?\s*$/gm,
];

/** 内部转储型代码块的判定关键词 */
const INTERNAL_DUMP_SIGNATURE = /(?:\btool_calls\b|"function"\s*:|"arguments"\s*:|"type"\s*:\s*"function"|\bfunction_call\b)/;

/** 编排日志行（如 "[Agent] 迭代 1"、"调用 search_knowledge 工具"、"Skill xxx 返回"） */
const LOG_LINE_PATTERNS: RegExp[] = [
  /^\s*\[(Agent|Skill|Tool|MainAgent|Hook|WS)\b[^\]]*\]/,
  /^\s*迭代\s*\d+/,
  /^\s*(调用|进入第|路由到|子智能体|Skill\s+["“].*["”]\s*已完成)/,
  /^\s*(tool_call_start|tool_call_end|thinking_start|answer_start|result_end)\b/,
];

/** 内联函数调用 JSON：{"name":"...","arguments":{...}} */
const INLINE_FN_CALL_JSON = /\{[^{}]*?"name"\s*:\s*"[^"]+"[^{}]*?"arguments"\s*:\s*\{[^{}]*\}[^{}]*?\}/gs;

/** OpenAI function 定义形：{"type":"function","function":{...}} */
const FN_DEF_JSON = /\{\s*"type"\s*:\s*"function"\s*,\s*"function"\s*:\s*\{[\s\S]*?\}\s*\}/g;

import { mapCodeFences } from './codeFence';

function cleanProse(text: string): string {
  let out = text;

  // 1. 整段函数调用 JSON（多行）优先处理
  out = out.replace(INLINE_FN_CALL_JSON, '');
  out = out.replace(FN_DEF_JSON, '');

  // 2. 权限键值对 token
  for (const key of PERMISSION_KEYS) {
    out = out.replace(new RegExp(`\\b${key.replace(':', '\\:')}\\b`, 'g'), '');
  }

  // 3. snake_case 内部标识（裸写或反引号包裹）
  for (const id of SNAKE_INTERNAL_IDS) {
    out = out.replace(new RegExp(`\`${id}\``, 'g'), '');
    out = out.replace(new RegExp(`\\b${id}\\b`, 'g'), '');
  }

  // 4. tool_calls / function_call 字样（非代码上下文）
  out = out.replace(/\b(tool_calls|function_call)\b/g, '');

  // 5. 编排日志行（整行删除）
  out = out.split('\n').filter(line => !LOG_LINE_PATTERNS.some(re => re.test(line))).join('\n');

  // 6. 知识图谱内部占位符（Skill 误输出时兜底清除）
  out = out.replace(/\{\{kg:[^}]+\}\}/g, '');
  out = out.replace(/\{\{chunk:[^}]+\}\}/g, '');

  return out;
}

function cleanCodeBlock(code: string, fence: string): string {
  // 合法的语言代码块（mermaid / 编程语言示例）保留
  const lang = (fence || '').toLowerCase();
  const isLangBlock = /^(mermaid|flowchart|graph|javascript|js|typescript|ts|python|py|java|go|rust|c|cpp|sql|bash|sh|json|yaml|html|css|shell|text|plaintext)$/i.test(lang)
    && !INTERNAL_DUMP_SIGNATURE.test(code);

  if (isLangBlock) return code;

  // 内部转储型代码块 → 整体删除
  if (INTERNAL_DUMP_SIGNATURE.test(code)) return '';

  // 既非已知语言、又不含转储特征（如无语言标注的代码）→ 保留，交由渲染层判断
  return code;
}

function collapseEmpty(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeAnswerContent(content: string): string {
  if (!content) return content;

  let text = content;
  for (const re of DISCLAIMER_PATTERNS) {
    text = text.replace(re, '');
  }

  return collapseEmpty(mapCodeFences(text, cleanProse, cleanCodeBlock));
}
