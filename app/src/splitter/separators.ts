/**
 * 多级分隔符（按优先级降序）。
 * - L0: 段落（换行 \n）
 * - L1: 句号「。」
 *
 * 不再使用「第X编/章/节/条」「（一）款项」等法律结构作为切分点，
 * 改为通用的段落 → 句号两级切分。不使用其他符号或空格。
 * 法律结构（编/章/节/条）仍由 StructureIndex 识别为 metadata，但不注入 chunk 文本。
 *
 * 每级内部是数组（保留 splitBySeparators 的同级别多分隔符 API 形态）。
 */
export const LEGAL_LEVELS: ReadonlyArray<ReadonlyArray<string | RegExp>> = [
  ['\n'],
  ['。'],
];

export const PERIOD = '。';

// 向后兼容：旧代码用 SEPARATOR_LEVELS 名字直接读
export const SEPARATOR_LEVELS: ReadonlyArray<ReadonlyArray<string | RegExp>> = LEGAL_LEVELS;
