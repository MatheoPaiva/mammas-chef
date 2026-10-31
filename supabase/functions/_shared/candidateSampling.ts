export function hashStringToInt(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildSampleOffsets(totalCount: number, pageSize: number, desiredRows: number, seed: string): number[] {
  if (totalCount <= 0 || pageSize <= 0 || desiredRows <= 0) return [];
  if (totalCount <= desiredRows) return [0];

  const windowCount = Math.max(1, Math.ceil(desiredRows / pageSize));
  const maxOffset = Math.max(0, totalCount - pageSize);
  const offsets = new Set<number>();

  for (let index = 0; index < windowCount; index += 1) {
    const segmentStart = Math.floor((index * totalCount) / windowCount);
    const segmentEnd = Math.max(segmentStart, Math.floor(((index + 1) * totalCount) / windowCount) - pageSize);
    const jitterRange = Math.max(0, segmentEnd - segmentStart);
    const jitter = jitterRange > 0 ? hashStringToInt(`${seed}:${index}`) % (jitterRange + 1) : 0;
    offsets.add(Math.min(maxOffset, segmentStart + jitter));
  }

  let guard = 0;
  while (offsets.size < windowCount && guard < windowCount * 3) {
    offsets.add(hashStringToInt(`${seed}:fallback:${guard}`) % (maxOffset + 1));
    guard += 1;
  }

  return [...offsets].sort((a, b) => a - b);
}
