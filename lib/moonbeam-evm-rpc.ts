/**
 * Moonbeam: statement bookends need **archival** native balance. Subscan’s Etherscan-style
 * `balance` / `balancehistory` often return **current** GLMR, so two different blocks still match
 * today’s wallet balance. The reliable source is public JSON-RPC: `eth_getBlockByNumber` +
 * `eth_getBalance` at a resolved block.
 */

const DEFAULT_MOONBEAM_HTTPS_RPC = "https://rpc.api.moonbeam.network";

export function getMoonbeamPublicRpcUrl() {
  return (typeof process !== "undefined" && process.env.MOONBEAM_RPC_URL?.trim()) || DEFAULT_MOONBEAM_HTTPS_RPC;
}

type JsonRpcRes<T> = { result?: T; error?: { message: string; code?: number } };

async function jsonRpc(rpc: string, method: string, params: unknown[]) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} HTTP ${res.status}`);
  }
  const json = (await res.json()) as JsonRpcRes<unknown>;
  if (json.error) {
    throw new Error(json.error.message ?? "RPC error");
  }
  return json.result;
}

export async function ethBlockNumberFromRpc(rpc: string) {
  const h = (await jsonRpc(rpc, "eth_blockNumber", [])) as string;
  if (typeof h !== "string" || !h.startsWith("0x")) {
    return null;
  }
  return Number.parseInt(h, 16);
}

export async function ethGetBlockTimestampSecondsFromRpc(rpc: string, blockNumber: number) {
  const blockHex = "0x" + BigInt(Math.max(0, Math.floor(blockNumber))).toString(16);
  const block = (await jsonRpc(rpc, "eth_getBlockByNumber", [blockHex, false])) as
    | { timestamp?: string }
    | null
    | undefined;
  if (!block || typeof block.timestamp !== "string") {
    return null;
  }
  return Number.parseInt(block.timestamp, 16);
}

/**
 * Largest EVM block **b** with `block(b).timestamp < targetUnix` (second granularity).
 * Matches “getblocknobytime … closest: before” for `targetUnix` as an instant in UTC.
 */
export async function evmLargestBlockBeforeUnixSecond(rpc: string, targetUnix: number) {
  const latestN = await ethBlockNumberFromRpc(rpc);
  if (latestN == null || !Number.isFinite(latestN) || latestN < 0) {
    return null;
  }

  const tsAtLatest = await ethGetBlockTimestampSecondsFromRpc(rpc, latestN);
  if (tsAtLatest == null) {
    return null;
  }
  if (tsAtLatest < targetUnix) {
    return latestN;
  }

  let lo = 0;
  let hi = latestN;
  const ts0 = await ethGetBlockTimestampSecondsFromRpc(rpc, lo);
  if (ts0 == null || ts0 >= targetUnix) {
    return null;
  }

  const minPlausible = targetUnix >= 1_500_000_000 ? 25_000 : 0;

  while (lo < hi) {
    const m = Math.floor((lo + hi + 1) / 2);
    const tsm = await ethGetBlockTimestampSecondsFromRpc(rpc, m);
    /**
     * **Pruned** nodes often return `null` for `eth_getBlockByNumber` on middle heights. Treating
     * that as “go lower” was shrinking the search to genesis-area blocks (e.g. 10) and then using
     * the balance at block 10 — wrong ~10 GLMR bookends. If we can’t read a **recent** `m`, give up
     * and let the caller use Subscan `getblocknobytime` instead.
     */
    if (tsm == null) {
      if (m > 50_000) {
        return null;
      }
      hi = m - 1;
      continue;
    }
    if (tsm < targetUnix) {
      lo = m;
    } else {
      hi = m - 1;
    }
  }

  if (minPlausible > 0 && lo < minPlausible) {
    return null;
  }
  return lo;
}

const WEI_PER_GLMR = BigInt("1000000000000000000");

function glmrFromWeiHex(hex: string) {
  const t = (hex || "").trim();
  if (t === "" || t === "0x" || t === "0X") {
    return 0;
  }
  let dec: string;
  try {
    dec = BigInt(t.startsWith("0x") || t.startsWith("0X") ? t : `0x${t}`).toString(10);
  } catch {
    return 0;
  }
  if (!/^\d+$/.test(dec)) {
    return 0;
  }
  const w = BigInt(dec);
  if (w === BigInt(0)) {
    return 0;
  }
  const intPart = w / WEI_PER_GLMR;
  const frac = w % WEI_PER_GLMR;
  return Number(intPart) + Number(frac) / 1e18;
}

export async function ethGetBalanceGlmrAtEvmBlockFromRpc(
  rpc: string,
  evmAddressLower: string,
  evmBlockNumber: number,
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddressLower)) {
    return 0;
  }
  const blockHex = "0x" + BigInt(Math.max(0, Math.floor(evmBlockNumber))).toString(16);
  const res = (await jsonRpc(rpc, "eth_getBalance", [evmAddressLower, blockHex])) as string;
  if (typeof res !== "string" || !res.startsWith("0x")) {
    return 0;
  }
  return glmrFromWeiHex(res);
}
