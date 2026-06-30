export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  let cn = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) { cn++; continue; }
    if (c >= 0x3400 && c <= 0x4dbf) { cn++; }
  }
  const en = text.length - cn;
  return Math.ceil(cn / 1.5 + en / 4);
}
