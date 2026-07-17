import { describe, it, expect } from 'bun:test';
import { ParentChildSplitter } from '@features/kb/splitter/parent-child-splitter';
import { RecursiveSplitter } from '@features/kb/splitter/recursive-splitter';
import { SEPARATOR_LEVELS } from '@features/kb/splitter/separators';
import { countTokens } from '@features/kb/splitter/token-counter';

const parentConfig = {
  maxChunkSize: 400, overlapSize: 30, minChunkSize: 25,
  lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
};
const childConfig = {
  maxChunkSize: 200, overlapSize: 20, minChunkSize: 25,
  lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
};

describe('StructureIndex & Multi-level splitter', () => {
  it('每条独立成块（多级切分）', () => {
    const s = new RecursiveSplitter({
      maxChunkSize: 40, overlapSize: 5, minChunkSize: 10,
      lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
    });
    const text =
      '\n第一条为了保护民事主体的合法权益，调整民事关系，维护社会和经济秩序，适应中国特色社会主义发展要求，弘扬社会主义核心价值观，根据宪法，制定本法。\n' +
      '第二条民法调整平等主体的自然人、法人和非法人组织之间的人身关系和财产关系。\n' +
      '第三条民事主体的人身权利、财产权利以及其他合法权益受法律保护，任何组织或者个人不得侵犯。';
    const chunks = s.splitRaw(text);
    // 多级切分应让每条独立成 chunk（chunk 数 ≥ 3，overlap 可能合并）
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // 验证：每条都有 chunk 覆盖
    expect(chunks.some(c => c.includes('第一条'))).toBe(true);
    expect(chunks.some(c => c.includes('第二条'))).toBe(true);
    expect(chunks.some(c => c.includes('第三条'))).toBe(true);
  });

  it('无章节的简单法规：metadata 只有 tiao', () => {
    const s = new ParentChildSplitter(
      { maxChunkSize: 30, overlapSize: 5, minChunkSize: 5, lengthFunction: countTokens, separators: SEPARATOR_LEVELS },
      { maxChunkSize: 25, overlapSize: 3, minChunkSize: 5, lengthFunction: countTokens, separators: SEPARATOR_LEVELS },
    );
    const text =
      '\n第一条为保护合同当事人的合法权益，维护社会经济秩序，根据宪法，制定本法。\n' +
      '第二条本法所称合同是民事主体之间设立、变更、终止民事法律关系的协议。';
    const units = s.split(text);
    const children = units.filter(u => !u.isParent);
    expect(children.length).toBeGreaterThanOrEqual(2);
    const tiaoSet = new Set(children.map(c => c.structure?.tiao).filter(Boolean));
    expect(tiaoSet.has('第一条')).toBe(true);
    expect(tiaoSet.has('第二条')).toBe(true);
    // 无章节 → bian/zhang/jie 全空
    for (const c of children) {
      expect(c.structure?.bian).toBeUndefined();
      expect(c.structure?.zhang).toBeUndefined();
      expect(c.structure?.jie).toBeUndefined();
    }
  });

  it('编/章/条结构被正确识别', () => {
    const s = new ParentChildSplitter(
      { maxChunkSize: 30, overlapSize: 5, minChunkSize: 5, lengthFunction: countTokens, separators: SEPARATOR_LEVELS },
      { maxChunkSize: 20, overlapSize: 3, minChunkSize: 5, lengthFunction: countTokens, separators: SEPARATOR_LEVELS },
    );
    const text =
      '\n第一编总　　则\n' +
      '第一章基本规定\n' +
      '第一条为了保护民事主体的合法权益，调整民事关系，制定本法，以规范民事活动。\n' +
      '第二条本法所称民事主体包括自然人、法人和非法人组织。\n' +
      '第二章自然人\n' +
      '第三条自然人从出生时起到死亡时止，具有民事权利能力。\n';
    const units = s.split(text);
    const children = units.filter(u => !u.isParent);
    expect(children.length).toBeGreaterThanOrEqual(3);
    // 至少有一个 child 带 zhang === "第一章"
    const firstChapterChildren = children.filter(c => c.structure?.zhang === '第一章');
    expect(firstChapterChildren.length).toBeGreaterThanOrEqual(1);
    // 至少有一个 child 带 tiao === "第一条"
    const firstTiao = children.filter(c => c.structure?.tiao === '第一条');
    expect(firstTiao.length).toBeGreaterThanOrEqual(1);
    // 所有 child 都在第一编
    for (const c of children) {
      expect(c.structure?.bian).toBe('第一编');
    }
  });

  it('startOffset/endOffset 与 text 等长（无 prefix）', () => {
    const s = new ParentChildSplitter(parentConfig, childConfig);
    const text = '第一编\n第一章\n第一条这是第一条内容。\n第二条这是第二条内容。\n';
    const units = s.split(text);
    const children = units.filter(u => !u.isParent);
    expect(children.length).toBeGreaterThanOrEqual(1);
    for (const c of children) {
      // 去掉 prefix 后：end - start === text.length
      const originalLen = c.endOffset - c.startOffset;
      expect(originalLen).toBe(c.text.length);
    }
  });

  it('非法律文档：按句号切分', () => {
    const s = new RecursiveSplitter({
      maxChunkSize: 8, overlapSize: 0, minChunkSize: 3,
      lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
    });
    const text = '这是第一句。这是第二句！这是第三句？这是第四句；';
    const chunks = s.splitRaw(text);
    // 无 \n → 走句号切分
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some(c => c.includes('！'))).toBe(true);
    expect(chunks.some(c => c.includes('？'))).toBe(true);
  });

  it('多段落文本按换行切分', () => {
    const s = new RecursiveSplitter({
      maxChunkSize: 30, overlapSize: 0, minChunkSize: 5,
      lengthFunction: countTokens, separators: SEPARATOR_LEVELS,
    });
    const text =
      '第八条监护人应当履行监护职责，保护被监护人的人身权利、财产权利以及其他合法权益。\n' +
      '（一）保护被监护人的生命健康、身体自由、情绪情感等人身权益；\n' +
      '（二）管理和保护被监护人的财产利益和合法权益；\n' +
      '（三）代理被监护人实施与其年龄、智力相适应的民事法律行为。';
    const chunks = s.splitRaw(text);
    // 按段落切出多块
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});
