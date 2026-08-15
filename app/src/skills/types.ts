import type { ToolRegistry } from '../tools/registry';
import type { LLMService, Message } from '../llm/llm-service';
import type { HookRegistry } from '../hooks/registry';
import type { RetrievalResult } from '../retrieve/retriever';
import type { Citation, ToolCallRecord } from '../db/schema';
import type { JSONSchemaProperty } from '../tools/types';
import type { EventStream } from '../agent/types';
import { FENGQIAO_SKILL_CONTEXT } from '../agent/fengqiao-rules';

/** SKILL.md frontmatter 解析结果 */
export interface SkillMetadata {
  name: string;
  description: string;
  tools: string[];
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
  };
}

/** Skill 执行上下文 */
export interface SkillContext {
  params: Record<string, unknown>;
  datasetId: string;
  datasetIds?: readonly string[];
  userId?: string;
  queryLogId?: string;
  history?: Message[];
  attachments?: Array<{ filename: string; text: string }>;
  tools: ToolRegistry;
  llm: LLMService;
  hooks: HookRegistry;
  events?: EventStream;
  executeTool(name: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Skill 返回结果 */
export interface SkillResult {
  answer: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
}

/** 运行时加载的 Skill（metadata + 指令正文，全部来自 SKILL.md） */
export interface Skill {
  metadata: SkillMetadata;
  instructions: string;       // SKILL.md 正文（LLM 执行指令）
}

export function formatCitations(results: RetrievalResult[]): Citation[] {
  return results.map(r => ({
    chunkId: r.chunkId, documentId: r.documentId, documentTitle: r.documentTitle,
    excerpt: r.text.slice(0, 200), score: r.score,
  }));
}

export function buildContext(results: RetrievalResult[]): string {
  return results.map((c, i) => {
    const title = c.documentTitle || `检索片段 ${i + 1}`;
    return `${title}\n${c.text}\n[${i + 1}]`;
  }).join('\n\n---\n\n');
}

export function deduplicateChunks(chunks: RetrievalResult[]): RetrievalResult[] {
  const seen = new Set<string>();
  return chunks.filter(c => { if (seen.has(c.chunkId)) return false; seen.add(c.chunkId); return true; });
}

/** 检索无结果时传给 LLM 的 tool 内容（不含任何文档片段） */
export const NO_RETRIEVAL_TOOL_CONTENT = [
  '【检索结果】知识库未找到相关法律条文（空结果）。',
  '',
  '请遵守：',
  '1. 不要将任何知识库文档内容注入回答；',
  '2. 可基于通用法律知识回答用户问题；',
  '3. 不要在回答中说明「未检索到」或重复免责声明（界面已有统一提示）；',
  '4. 不得编造具体法条编号或声称来自知识库。',
].join('\n');

/** 所有 Skill 统一输出格式约束（追加到 system prompt） */
export const OUTPUT_FORMAT_RULES = `
## 输出格式（强制遵守，使用标准 Markdown）

### 结构模板

1. **开篇**（1～2 句）：直接回答用户问题的核心结论，单独成段。
2. **正文分节**：按主题拆分为「一、二、三…」或「## 标题」，每节前空一行。
3. **小结**（可选）：末尾用「## 小结」或单独一段概括要点。

### 加粗规则

- 仅对**小节标题**（如「一、标准工时制度」）和**关键法律名称**加粗：\`**一、xxx**\` 或 \`## 一、xxx\`
- 正文普通叙述**不要**加粗，不要整段加粗
- 禁止连续多句都加粗

### 换行规则

- 每个自然段单独一段，段与段之间**空一行**（双换行）
- 小节标题与正文之间**空一行**
- 有序/无序列表每项**单独一行**，列表前后各空一行
- 禁止把多个小节挤在同一段落里

### 法条引用

- 行内引用：根据《法律名称》第X条规定，"原文或复述"[1]
- 整段引用法条时，先写法律名称与条款编号，再写法条正文，**引用编号 [1] 放在该段正文末尾**，不要放在标题或段首
- 同一句话末尾标注 [1][2]，不要每几个字就标一次

**整段法条引用示例（正确）：**

\`\`\`
《中华人民共和国会计法》第七条

下列事项，应当办理会计手续，进行会计核算：
(一) 款项和有价证券的收付；
(二) 财物的收发、增减和使用；
[1]
\`\`\`

**禁止：** 将 [1] 写在条文标题之前，如 \`[1] 《会计法》第七条\`

### 列表示例

\`\`\`
**一、加班时长限制**

根据《劳动法》第41条规定，……[1]

1. 一般每日不超过1小时
2. 特殊情况下每日不超过3小时
3. 每月不超过36小时

**二、加班费标准**

……
\`\`\`

### 可视化表达（优先于纯文字）

能用图说清楚的内容，**优先用图**，文字作补充说明。前端支持 Mermaid 渲染。

**何时用哪种形式：**

| 场景 | 推荐形式 |
|------|----------|
| 程序/步骤/办案流程 | \`flowchart TD\` 流程图 |
| 适用条件、分支判断、「是否→则」 | \`flowchart TD\` 决策树 |
| 多方交互、通知送达、仲裁诉讼时序 | \`sequenceDiagram\` 时序图 |
| 多维度并列对比（法条差异） | Markdown 表格 |
| 对比 + 适用路径 | 先流程图概括逻辑，再表格列细节 |
| 要点层级、概念从属 | \`flowchart LR\` 或分节列表 |

**Mermaid 写法（必须用 \`\`\`mermaid 代码块）：**

\`\`\`mermaid
flowchart TD
  A["违法解除劳动合同"] --> B{"协商一致?"}
  B -->|是| C["按第36条协商解除"]
  B -->|否| D["可能构成违法解除"]
  D --> E["第87条 双倍赔偿金"]
\`\`\`

- 节点文字含中文、标点时用双引号包裹：\`A["劳动者主张加班费"]\`
- **Mermaid 代码块内禁止写 [1][2] 引用标记**（引用放在图后的文字说明里）
- 流程图放在对应小节内，**前后各空一行**；图后可跟 1～2 句文字解读并标注 [1][2]
- 每个回答至少 0～2 个图：有流程/分支/对比路径时**必须**出图；纯定义型问题可不出图
- 禁止用 ASCII 字符画框线；统一用 Mermaid

### 枫桥智诉业务输出（强制）

**调解类回答**必须包含：
- 开篇共情（若用户有情绪表达）
- 上、中、下三策（上策共赢 / 中策折中 / 下策诉讼底线）
- 「给甲方」「给乙方」两套沟通话术（如适用）

**企业合规类回答**分两种模式（按用户意图二选一，不可混用）：

**模式 A · 低成本合规全景咨询**（用户问「没有法务/怎么低成本合规/小公司合规体系」）：
- 开篇 2～3 句结论（最先做的 3 件事 + 降本逻辑）
- 分步行动清单表格：优先级 | 做什么 | 谁负责 | 成本 | 不做的风险
- 用工/合同/财税/公章 四块速写（每块 3～5 条短句，口语化）
- 30天/90天分阶段整改
- **禁止**写成法条教材、禁止「——《民法典》第X条」堆砌

**模式 B · 单点合同/条款审查**（用户给具体合同或条款）：
- 修改对比表：| 条款 | 修改前 | 修改后 | 修改理由 | 对方可能反驳 |
- 工具包：仅文书名称+应写要点，禁止外链下载

**复杂商事纠纷**：诉讼策略分析框架

**群体性纠纷**（多名业主/员工等）：须主动发出预警提示，建议相关部门介入。

**结尾声明**（调解/合规场景）：「本建议仅供参考，不作为正式法律意见。」

${FENGQIAO_SKILL_CONTEXT}

### 禁止

- 禁止输出大段无换行的文字墙
- 禁止输出 HTML 标签（如 br、div 标签）；换行用 Markdown 空行，列表用无序或有序列表
- 语气专业、客观、简洁

### 绝对禁止泄露系统内部信息（最高优先级，违反即视为严重错误）

你的回答会直接展示给最终用户。严禁在回答中出现任何系统内部标识，包括但不限于：

- 工具名 / 技能名（如 \`search_knowledge\`、\`call_agent\`、\`qa\`、\`multihop\`、\`compare\`、\`summary\`、\`add_document\`、\`list_documents\` 等）
- 函数调用 JSON（如 \`{"name":"...","arguments":{...}}\`）、\`tool_calls\`、\`function\`、\`parameters\` 等接口字段
- 权限键值对（如 \`documents:write\`、\`chat:use\`、\`role:admin\` 这类「英文词:英文词」的权限串）
- 检索/编排过程术语（如"调用 X 工具"、"进入第 N 轮检索"、"路由到子智能体"），除非用户主动询问系统工作原理
- 后端代码、函数名、变量名、类名、文件名、技术栈名称

只输出面向用户的自然语言回答与必要的法律/业务内容。需要展示流程时用 Mermaid 图，但图与文字里都不得出现上述内部标识。

### 多轮对话纪律（始终遵守）

- 你的回答必须**紧扣用户当前这一轮的问题**，不得跑题、不得复述无关上下文
- 充分利用多轮对话历史理解指代与省略（如"它""上面那条""那再问一下"），但只回答当前问题
- 若当前问题与历史无关，不要把历史内容强行塞进回答
- 优先基于用户本轮上传的参考资料（如有）与知识库检索结果回答，不要凭空扩展`.trim();

export const RETRIEVAL_FINAL_HINT =
  '你已完成所有检索。请停止继续搜索，直接基于以上检索到的法律条文与用户上传的参考资料，综合生成完整的最终回答。不要再提及"第X轮"、"下一步"或"进入"等检索计划用语。严格遵守输出格式：分节加粗标题、段间空行、列表每项一行；涉及流程、条件分支、适用路径时优先用 Mermaid 流程图或时序图表达。回答必须紧扣用户当前的问题，不得跑题，且严禁输出任何工具名、函数名、权限键值对等系统内部标识。';

export const NO_RETRIEVAL_FINAL_HINT = [
  '知识库检索未获得可用法律条文。',
  '若用户本轮上传了参考资料，优先基于该资料回答。',
  '否则请直接基于通用法律知识回答，可提及法律名称与条款要点，但**不要写 [1][2] 等引用编号**（无对应检索片段）。',
  '不要在回答中说明「未检索到」或重复免责声明（界面已有统一提示）。',
  '回答必须紧扣用户当前的问题，不得跑题。',
  '严禁输出任何工具名、函数名、权限键值对等系统内部标识。',
  '仍须遵守输出格式：分节、段间空行、列表每项一行；能用流程图/决策树说清楚的，优先用 Mermaid 图表达。',
].join('\n');

export const SYNTHESIS_FINAL_HINT =
  '请基于以上检索到的资料与用户上传的参考资料，紧扣用户当前的问题生成最终回答。标注引用来源。涉及程序步骤、适用条件、多方交互或对比路径时，优先用 Mermaid 流程图/时序图或 Markdown 表格表达，使回答更直观。严禁在回答中输出任何工具名、函数名、权限键值对等系统内部标识。';

export function buildSkillSystemPrompt(instructions: string): string {
  return `${instructions.trim()}\n\n${OUTPUT_FORMAT_RULES}`;
}

export function isEmptyRetrieval(result: unknown): boolean {
  return Array.isArray(result) && result.length === 0;
}

export function isRetrievalResults(result: unknown): result is RetrievalResult[] {
  if (!Array.isArray(result) || result.length === 0) return false;
  const first = result[0];
  return typeof first === 'object' && first !== null &&
    'chunkId' in first && 'text' in first && 'score' in first &&
    'documentId' in first && 'documentTitle' in first;
}

export function formatToolResultContent(result: unknown, toolName: string): string {
  if (toolName === 'search_knowledge' && isEmptyRetrieval(result)) {
    return NO_RETRIEVAL_TOOL_CONTENT;
  }
  if (isRetrievalResults(result)) {
    return buildContext(result);
  }
  return JSON.stringify(result);
}
