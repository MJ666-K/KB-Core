export function rrfFusion(
  listA: ReadonlyArray<readonly [string, number]>,
  listB: ReadonlyArray<readonly [string, number]>,
  k: number = 60,
): Array<[string, number]> {
  const scores = new Map<string, number>();

  const rankedA = [...listA].sort((a, b) => b[1] - a[1]);
  const rankedB = [...listB].sort((a, b) => b[1] - a[1]);

  for (let i = 0; i < rankedA.length; i++) {
    const id = rankedA[i]![0];
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }
  for (let i = 0; i < rankedB.length; i++) {
    const id = rankedB[i]![0];
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}
