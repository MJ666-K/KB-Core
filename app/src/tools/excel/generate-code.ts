import type { Tool, ToolContext } from '../types';
import { getDuckDBService } from '../../analyze/duckdb-service';
import { db } from '../../db/client';
import { excelProfiles } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { LLMService } from '../../llm/llm-service';
import { logger } from '../../utils/logger';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

interface GenerateCodeParams {
  profileId: string;
  question: string;
}

interface GenerateCodeResult {
  success: boolean;
  code?: string;
  output?: string;
  error?: string;
}

// 生成 Python 分析代码
async function generatePythonCode(
  tableName: string,
  columns: Array<{ name: string; type: string }>,
  question: string
): Promise<string> {
  const llm = new LLMService();

  const schemaDesc = columns.map(c => `- ${c.name} (${c.type})`).join('\n');

  const prompt = `你是一个数据分析专家。根据用户问题生成 Python 代码来分析 DuckDB 数据库。

表结构：
表名: ${tableName}
列信息:
${schemaDesc}

用户问题: ${question}

要求：
1. 使用 duckdb 库连接数据库
2. 使用 pandas 进行数据分析
3. 返回完整可执行的 Python 代码
4. 代码必须包含: import duckdb, import pandas as pd
5. 数据库文件路径: ./data/duckdb/excel_xxx.duckdb
6. 最后打印分析结果

示例代码结构:
\`\`\`python
import duckdb
import pandas as pd

# 连接数据库
conn = duckdb.connect('./data/duckdb/excel_xxx.duckdb')

# 查询数据
df = conn.execute("SELECT ...").fetchdf()

# 分析
result = df.groupby('列名').agg({'金额': 'sum'})
print(result)

conn.close()
\`\`\`

用户问题: ${question}

请返回完整的 Python 代码（不要 markdown 标记）：`;

  const response = await llm.chat({
    messages: [{ role: 'user', content: prompt }],
  });

  let code = response.content || '';
  
  // 清理 markdown 标记
  code = code.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim();

  return code;
}

// 执行 Python 代码
async function executePythonCode(code: string): Promise<{ output: string; error?: string }> {
  const tempFile = join(process.cwd(), 'temp_analysis.py');
  
  try {
    // 写入临时文件
    writeFileSync(tempFile, code, 'utf-8');

    // 执行 Python
    return new Promise((resolve) => {
      const python = spawn('python3', [tempFile], {
        cwd: process.cwd(),
        timeout: 30000, // 30秒超时
      });

      let output = '';
      let error = '';

      python.stdout.on('data', (data) => {
        output += data.toString();
      });

      python.stderr.on('data', (data) => {
        error += data.toString();
      });

      python.on('close', (code) => {
        // 清理临时文件
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }

        if (code === 0) {
          resolve({ output: output.trim() });
        } else {
          resolve({ output: '', error: error || `Exit code: ${code}` });
        }
      });

      python.on('error', (err) => {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
        resolve({ output: '', error: err.message });
      });
    });

  } catch (err) {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
    throw err;
  }
}

export const generateCodeTool: Tool<GenerateCodeParams, GenerateCodeResult> = {
  name: 'generate_code',
  description: '生成并执行 Python 代码来分析 Excel 数据。适用于复杂分析任务。',
  parameters: {
    type: 'object',
    properties: {
      profileId: {
        type: 'string',
        description: 'Excel Profile ID',
      },
      question: {
        type: 'string',
        description: '分析需求，例如："找出销售额前10的产品"',
      },
    },
    required: ['profileId', 'question'],
  },

  async execute(params: GenerateCodeParams, _ctx: ToolContext): Promise<GenerateCodeResult> {
    const { profileId, question } = params;

    logger.info('[Excel Code] 开始生成代码:', { profileId, question });

    try {
      // 获取 Profile
      const profile = await db.query.excelProfiles.findFirst({
        where: eq(excelProfiles.id, profileId),
      });

      if (!profile) {
        return { success: false, error: 'Profile not found' };
      }

      const sheets = profile.sheets as Array<{
        duckdbTable: string;
        documentId: string;
        columns: Array<{ name: string; type: string }>;
      }>;

      const tableName = sheets[0]!.duckdbTable;
      const columns = sheets[0]!.columns;

      // 生成代码
      logger.info('[Excel Code] 生成 Python 代码...');
      const code = await generatePythonCode(tableName, columns, question);
      logger.info('[Excel Code] 代码生成完成');

      // 执行代码
      logger.info('[Excel Code] 执行代码...');
      const { output, error } = await executePythonCode(code);

      if (error) {
        logger.error('[Excel Code] 执行失败:', error);
        return { success: false, code, error };
      }

      logger.info('[Excel Code] 执行完成');
      return { success: true, code, output };

    } catch (err) {
      logger.error('[Excel Code] 失败:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : '代码生成失败',
      };
    }
  },
};
