/**
 * Subscan `block_timestamp` is usually Unix seconds, but some paths return 13-digit ms.
 * Etherscan-style EVM `timeStamp` is seconds as a string/number.
 */
export function toUnixSecondsForChain(ts: string | number | undefined): number {
  const n = Number(ts ?? 0);
  if (!Number.isFinite(n) || n === 0) return 0;
  if (n > 1_000_000_000_000) return Math.floor(n / 1000);
  return Math.floor(n);
}
