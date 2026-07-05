/** 数据集 name → 中文显示名 */
export const datasetLabels: Record<string, string> = {
  legal: '法律',
  default: '默认',
};

export function datasetDisplayName(name: string): string {
  return datasetLabels[name] ?? name;
}
