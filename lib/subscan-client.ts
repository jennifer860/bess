import { toUnixSecondsForChain } from "@/lib/chain-timestamp";
import {
  ethGetBalanceGlmrAtEvmBlockFromRpc,
  evmLargestBlockBeforeUnixSecond,
  getMoonbeamRpcTryList,
} from "@/lib/moonbeam-evm-rpc";
import type { StatementInput } from "@/types/statement";

const NETWORK_TO_API_HOST: Record<string, string> = {
  Moonbeam: "moonbeam.api.subscan.io",
  Astar: "astar.api.subscan.io",
  Polkadot: "polkadot.api.subscan.io",
  Kusama: "kusama.api.subscan.io",
};

type EvmTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasUsed: string;
  isError?: string;
};

type EvmTokenTransfer = {
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
};

type BalanceHistoryItem = {
  date: string;
  balance: string;
  block?: number;
};

type V2Transfer = {
  block_timestamp: number;
  from: string;
  to: string;
  amount_v2?: string;
  amount?: string;
  success?: boolean;
  /** Subscan often keeps 0x on `evm_*` while `from`/`to` are SS58 — match these for unified accounts. */
  from_account_display?: { evm_address?: string; address?: string };
  to_account_display?: { evm_address?: string; address?: string };
};

type V2Extrinsic = {
  block_timestamp: number;
  call_module?: string;
  fee_used?: string;
  fee?: string;
  success?: boolean;
};

type V2RewardSlash = {
  block_timestamp: number;
  amount: string;
  category?: "Reward" | "Slash";
};

const REWARD_SLASH_BODY: Record<string, unknown> = {
  category: "Reward",
};

type EtherscanLikeResponse<T> = {
  status: string;
  message: string;
  result: T;
};

type SubscanResponse<T> = {
  code: number;
  message: string;
  data: T;
};

/** On-chain block span for Subscan `block_range: "from-to"` (v2) and EVM `startblock`/`endblock`. */
export type StatementBlockWindow = { from: number; to: number };

function parseSubscanErrorDetail(result: unknown): string {
  if (typeof result === "string" && result.trim().length > 0) {
    return result;
  }
  if (Array.isArray(result)) {
    return `array(${result.length})`;
  }
  if (result && typeof result === "object") {
    return "structured error payload";
  }
  return "no detail";
}

function getApiHost(network: string) {
  return NETWORK_TO_API_HOST[network] ?? `${network.toLowerCase()}.api.subscan.io`;
}

/** Subscan Etherscan API often returns `"result": null` for empty `txlist` / `tokentx` / `tokennfttx` lists. */
function etherscanListResult<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Min delay before each Subscan HTTP call (per server instance). Subscan’s plan limit is often
 * **5 req/s**; 200ms ≈ 5/s with no headroom, and Vercel runs **multiple** concurrent isolates, each
 * with its own queue — requests from different invocations can interleave and exceed 5/s. Use 400ms
 * (~2.5/s per instance) so that even two warm instances stay near or under the key limit.
 */
const SUBSCAN_MIN_GAP_MS = 400;
/** Exponential backoff base when Subscan returns HTTP 429 (code 20008). */
const RATE_LIMIT_BASE_MS = 1_500;
const RATE_LIMIT_MAX_RETRIES = 6;

let subscanRequestTail: Promise<unknown> = Promise.resolve();

function isRateLimitResponse(status: number, body: string) {
  if (status === 429) return true;
  if (body.includes("20008") && body.toLowerCase().includes("rate")) return true;
  return false;
}

/**
 * One-at-a-time Subscan traffic with a gap between calls and 429 retry/backoff.
 * Avoids bursty `Promise.all` that triggers Subscan "code 20008" limits.
 */
function runSubscanRequest<T>(work: () => Promise<T>): Promise<T> {
  const next = subscanRequestTail.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, SUBSCAN_MIN_GAP_MS));
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        const is429 =
          error instanceof Error &&
          (error.message.includes("(429)") || /20008|rate limit/i.test(error.message));
        if (attempt < RATE_LIMIT_MAX_RETRIES && is429) {
          const backoff = Math.min(30_000, RATE_LIMIT_BASE_MS * 2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        throw error;
      }
    }
  });
  subscanRequestTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function callEtherscanLike<T>(
  network: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<T> {
  return runSubscanRequest(async () => {
    const endpoint = new URL(`https://${getApiHost(network)}/api/scan/evm/etherscan`);
    for (const [key, value] of Object.entries(params)) {
      endpoint.searchParams.set(key, value);
    }

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      if (isRateLimitResponse(response.status, text)) {
        throw new Error(`Subscan request failed (429): ${text}`);
      }
      throw new Error(`Subscan request failed (${response.status}): ${text}`);
    }

    const payload = JSON.parse(text) as EtherscanLikeResponse<T>;
    if (payload.status === "1") {
      return payload.result;
    }

    if (payload.message === "No transactions found") {
      return etherscanListResult(payload.result as unknown[] | null | undefined) as T;
    }

    const detail = parseSubscanErrorDetail(payload.result);
    throw new Error(`Subscan response error: ${payload.message}. Detail: ${detail}`);
  });
}

async function callSubscanPost<T>(
  network: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  return runSubscanRequest(async () => {
    const endpoint = `https://${getApiHost(network)}${path}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      if (isRateLimitResponse(response.status, text)) {
        throw new Error(`Subscan request failed (429): ${text}`);
      }
      throw new Error(`Subscan request failed (${response.status}): ${text}`);
    }

    const payload = JSON.parse(text) as SubscanResponse<T>;
    if (payload.code !== 0) {
      if (payload.code === 20008 || /rate limit/i.test(payload.message)) {
        throw new Error(`Subscan request failed (429): ${text}`);
      }
      throw new Error(`Subscan response error: ${payload.message}`);
    }

    return payload.data;
  });
}

/**
 * Parachain / Substrate block height (Subscan v2 `block_range`, on-chain `block_num` for native
 * modules like staking, transfers). From `/api/scan/block` with `only_head: true`. On EVM+Substrate
 * networks (e.g. Moonbeam) this is **not** the same number as the Ethereum `eth` block.
 */
export async function resolveSubstrateBlockWindow(
  input: StatementInput,
  apiKey: string,
): Promise<StatementBlockWindow | null> {
  const startT = Math.floor(new Date(`${input.startDate}T00:00:00Z`).getTime() / 1000);
  const endT = Math.floor(new Date(`${input.endDate}T23:59:59Z`).getTime() / 1000);
  const [a, b] = await Promise.all([
    substrateBlockNumberAtUnix(input.network, apiKey, startT),
    substrateBlockNumberAtUnix(input.network, apiKey, endT),
  ]);
  if (a == null || b == null) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * Ethereum-style block number for Subscan Etherscan-compatible APIs (`getblocknobytime` for
 * `txlist`, `tokentx`, `startblock`/`endblock`). Do not use for Subscan v2 `block_range`.
 */
export async function resolveEvmBlockWindow(
  input: StatementInput,
  apiKey: string,
): Promise<StatementBlockWindow | null> {
  const startT = Math.floor(new Date(`${input.startDate}T00:00:00Z`).getTime() / 1000);
  const endT = Math.floor(new Date(`${input.endDate}T23:59:59Z`).getTime() / 1000);
  const [a, b] = await Promise.all([
    evmBlockNumberAtUnix(input.network, apiKey, startT),
    evmBlockNumberAtUnix(input.network, apiKey, endT),
  ]);
  if (a == null || b == null) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

function parseBlockNumberFromApiValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  const n = /^0x[0-9a-fA-F]+$/.test(s) ? Number.parseInt(s, 16) : Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pickBlockNumFromScanBlockPayload(data: Record<string, unknown> | null): number | null {
  if (!data) return null;
  const direct = parseBlockNumberFromApiValue(data.block_num ?? data.number);
  if (direct != null) return direct;
  const inner = data.block;
  if (inner && typeof inner === "object") {
    const o = inner as Record<string, unknown>;
    return parseBlockNumberFromApiValue(o.block_num ?? o.number);
  }
  return null;
}

/** Subscan `/api/scan/block` (parachain / substrate block number at `block_timestamp`). */
async function substrateBlockNumberAtUnix(
  network: string,
  apiKey: string,
  unixSeconds: number,
): Promise<number | null> {
  for (const ts of [unixSeconds, unixSeconds * 1000]) {
    try {
      const data = (await callSubscanPost<Record<string, unknown> | null>(network, apiKey, "/api/scan/block", {
        block_timestamp: ts,
        only_head: true,
      })) as Record<string, unknown> | null;
      const n = pickBlockNumFromScanBlockPayload(data);
      if (n != null) return n;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Exact substrate block number at/just before `unixSeconds` via Subscan `/api/scan/block`. */
export async function resolveSubstrateBlockForStatementBookend(
  input: StatementInput,
  apiKey: string,
  unixSeconds: number,
): Promise<number | null> {
  return substrateBlockNumberAtUnix(input.network, apiKey, unixSeconds);
}

/**
 * Etherscan `getblocknobytime` for Moonbeam/Subscan can expect **timestamp in milliseconds**; passing
 * seconds is read as 1970-era time and returns a very low EVM block (e.g. ~10), and `balance&tag=0xa`
 * then both bookends look like ~10 GLMR. Try ms first, then sec; reject tiny blocks for 2020+ times.
 */
export async function evmBlockNumberAtUnix(
  network: string,
  apiKey: string,
  unixSeconds: number,
): Promise<number | null> {
  const isModernEra = unixSeconds >= 1_600_000_000; // after ~2020
  const minPlausibleEvmBlock = 50_000;
  for (const ts of [unixSeconds * 1000, unixSeconds]) {
    try {
      const raw = await callEtherscanLike<string>(network, apiKey, {
        module: "block",
        action: "getblocknobytime",
        timestamp: String(ts),
        closest: "before",
      });
      const n = parseBlockNumberFromApiValue(raw);
      if (n == null || n <= 0) {
        continue;
      }
      if (isModernEra && n < minPlausibleEvmBlock) {
        continue;
      }
      return n;
    } catch {
      /* try other timestamp unit or fail */
    }
  }
  return null;
}

/**
 * Bookend EVM block height. **Subscan `getblocknobytime` (ms)** is the primary source — it matches
 * explorer time→height. Public RPC binary search can collapse to ~10 on **pruned** nodes that
 * return null for `eth_getBlockByNumber` on most heights; we only use RPC when it looks plausible.
 */
export async function resolveEvmBlockForStatementBookend(
  input: StatementInput,
  apiKey: string,
  unixSeconds: number,
): Promise<number | null> {
  const plausible = (b: number | null) =>
    b != null && b > 0 && (unixSeconds < 1_500_000_000 || b >= 25_000);

  if (input.network === "Moonbeam") {
    const fromSubscan = await evmBlockNumberAtUnix(input.network, apiKey, unixSeconds);
    if (plausible(fromSubscan)) {
      return fromSubscan;
    }

    for (const rpc of getMoonbeamRpcTryList()) {
      try {
        const fromRpc = await evmLargestBlockBeforeUnixSecond(rpc, unixSeconds);
        if (plausible(fromRpc)) {
          return fromRpc;
        }
      } catch {
        /* try next endpoint */
      }
    }
    return null;
  }
  return evmBlockNumberAtUnix(input.network, apiKey, unixSeconds);
}

const WEI_PER_GLMR = BigInt("1000000000000000000");

function glmrFromEvmBalanceWeiString(raw: string) {
  let t = (raw || "").trim();
  if (t === "" || t === "0x" || t === "0X") {
    return 0;
  }
  if (t.startsWith("0x") || t.startsWith("0X")) {
    try {
      t = BigInt(t).toString(10);
    } catch {
      return 0;
    }
  }
  if (t === "" || !/^\d+$/.test(t)) {
    return 0;
  }
  try {
    const w = BigInt(t);
    if (w === BigInt(0)) {
      return 0;
    }
    const intPart = w / WEI_PER_GLMR;
    const frac = w % WEI_PER_GLMR;
    return Number(intPart) + Number(frac) / 1e18;
  } catch {
    return 0;
  }
}

export async function fetchCurrentEvmBalanceWei(input: StatementInput, apiKey: string) {
  const result = await callEtherscanLike<string>(input.network, apiKey, {
    module: "account",
    action: "balance",
    address: input.walletAddress,
    tag: "latest",
  });

  return Number(result);
}

/** Subscan’s `EtherscanAccountBalanceParam.tag` (evm_block) expects hex, not a decimal string. */
function evmBlockNumberToEtherscanTag(blockNumber: number) {
  if (!Number.isFinite(blockNumber) || blockNumber < 0) {
    return "latest";
  }
  const n = Math.floor(blockNumber);
  return `0x${n.toString(16)}`;
}

/**
 * Moonbeam: **eth_getBalance** at `evmBlockNumber` via public/override RPC only. Returns `null` on
 * failure (e.g. pruned node, timeout). We do not use Subscan Etherscan balance-at-block here
 * — that API often returns the **current** GLMR, which produced duplicate / wrong bookends.
 */
export async function tryMoonbeamGlmrAtEvmBlockRpc(
  input: StatementInput,
  evmBlockNumber: number,
): Promise<number | null> {
  if (input.network !== "Moonbeam") {
    return null;
  }
  const address = input.walletAddress.trim().toLowerCase();
  for (const rpc of getMoonbeamRpcTryList()) {
    try {
      return await ethGetBalanceGlmrAtEvmBlockFromRpc(rpc, address, evmBlockNumber);
    } catch {
      /* try next public endpoint */
    }
  }
  return null;
}

/**
 * On-chain native at an EVM block via Subscan Etherscan APIs (non-Moonbeam / legacy). For Moonbeam
 * in production we use `balance_history` for statement bookends. Moonbeam bookends do not use
 * this (EVM) path — see `subscan-statement-service`.
 */
export async function fetchEvmNativeGlmrAtEvmBlock(
  input: StatementInput,
  apiKey: string,
  evmBlockNumber: number,
) {
  if (input.network === "Moonbeam") {
    return (await tryMoonbeamGlmrAtEvmBlockRpc(input, evmBlockNumber)) ?? 0;
  }
  const blockno = String(Math.max(0, Math.floor(evmBlockNumber)));
  const address = input.walletAddress.trim().toLowerCase();
  try {
    const h = await callEtherscanLike<string>(input.network, apiKey, {
      module: "account",
      action: "balancehistory",
      address,
      blockno,
    });
    return glmrFromEvmBalanceWeiString(String(h));
  } catch {
    const result = await callEtherscanLike<string>(input.network, apiKey, {
      module: "account",
      action: "balance",
      address,
      tag: evmBlockNumberToEtherscanTag(evmBlockNumber),
    });
    return glmrFromEvmBalanceWeiString(String(result));
  }
}

export async function fetchEvmTxList(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 100;
  const all: EvmTx[] = [];
  const startblock = blockWindow ? String(blockWindow.from) : "0";
  const endblock = blockWindow ? String(blockWindow.to) : "99999999";

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = etherscanListResult(
      await callEtherscanLike<EvmTx[] | null>(input.network, apiKey, {
        module: "account",
        action: "txlist",
        address: input.walletAddress,
        startblock,
        endblock,
        page: String(page),
        offset: String(PAGE_SIZE),
        sort: blockWindow ? "asc" : "desc",
      }),
    );

    if (!batch.length) {
      break;
    }
    all.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

export type BalanceHistoryRange = { start: string; end: string };

/**
 * [Account Balance History](https://support.subscan.io/api-6449744) — on Moonbeam, **daily** UTC
 * snapshots (not block-level). `start` / `end` are YYYY-MM-DD and expand the range you query.
 */
export async function fetchBalanceHistory(
  input: StatementInput,
  apiKey: string,
  range: BalanceHistoryRange | null = null,
) {
  const start = range?.start ?? input.startDate;
  const end = range?.end ?? input.endDate;
  const data = await callSubscanPost<{ history?: BalanceHistoryItem[] }>(
    input.network,
    apiKey,
    "/api/scan/account/balance_history",
    {
      address: input.walletAddress.trim().toLowerCase(),
      start,
      end,
    },
  );

  if (!data || typeof data !== "object") {
    return [];
  }
  return data.history ?? [];
}

const V2_ROW = 100;
const V2_MAX_PAGES_DESC = 100;
const V2_MAX_PAGES_IN_RANGE = 500;
/**
 * Paged "download all" style reward fetch when v2 is not block-scoped. Capped to avoid
 * serverless timeouts (Vercel 300s): paging 1000×400ms is already >5 minutes before other work.
 */
const V2_REWARD_UNBOUNDED_MAX_PAGES = 200;
/** Split a wide v2 `block_range` for reward_slash when a single range returns nothing (H160 + API quirks). */
const REWARD_BLOCK_CHUNK_COUNT = 16;

function splitBlockWindowForRewards(
  range: StatementBlockWindow,
  chunkCount: number = REWARD_BLOCK_CHUNK_COUNT,
): StatementBlockWindow[] {
  const { from, to } = range;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return [range];
  }
  const span = to - from + 1;
  const n = Math.min(chunkCount, Math.max(1, span));
  const step = Math.max(1, Math.ceil(span / n));
  const out: StatementBlockWindow[] = [];
  for (let a = from; a <= to; a += step) {
    out.push({ from: a, to: Math.min(to, a + step - 1) });
  }
  return out;
}

function rewardRowDedupeKey(r: V2RewardSlash) {
  return `${r.block_timestamp}\0${r.amount}`;
}

/**
 * If a single `block_range` returns no reward rows, try smaller substrate windows (Subscan
 * sometimes returns an empty `list` for a wide H160+staking range that succeeds per chunk.
 */
async function fetchV2RewardSlashChunkedInBlockRange(
  input: StatementInput,
  apiKey: string,
  substrateBlockWindow: StatementBlockWindow,
): Promise<V2RewardSlash[]> {
  const chunks = splitBlockWindowForRewards(substrateBlockWindow, REWARD_BLOCK_CHUNK_COUNT);
  if (chunks.length <= 1) {
    return [];
  }
  const merged = new Map<string, V2RewardSlash>();
  for (const range of chunks) {
    const rows = await fetchV2PagedInBlockRange<V2RewardSlash>(
      input,
      apiKey,
      "/api/v2/scan/account/reward_slash",
      "list",
      range,
      REWARD_SLASH_BODY,
    );
    for (const r of rows) {
      merged.set(rewardRowDedupeKey(r), r);
    }
  }
  return [...merged.values()];
}

async function fetchV2PagedInBlockRange<T extends { block_timestamp: number }>(
  input: StatementInput,
  apiKey: string,
  path: string,
  listField: string,
  range: StatementBlockWindow,
  extraBody: Record<string, unknown> = {},
): Promise<T[]> {
  const param = `${range.from}-${range.to}`;
  const all: T[] = [];
  for (let page = 0; page < V2_MAX_PAGES_IN_RANGE; page += 1) {
    const raw = await callSubscanPost<Record<string, unknown> | null>(input.network, apiKey, path, {
      address: input.walletAddress,
      row: V2_ROW,
      page,
      order: "asc",
      block_range: param,
      ...extraBody,
    });
    const data = raw && typeof raw === "object" ? raw : {};
    const list = data[listField];
    const rows = Array.isArray(list) ? (list as T[]) : [];
    if (!rows.length) {
      break;
    }
    all.push(...rows);
    if (rows.length < V2_ROW) {
      break;
    }
  }
  return all;
}

/** Fallback: newest-first; do not pre-stop on "max &lt; start" (Subscan may ignore `order: desc`). */
async function fetchV2PagedNewestFirst<T extends { block_timestamp: number }>(
  input: StatementInput,
  apiKey: string,
  path: string,
  listField: string,
  extraBody: Record<string, unknown> = {},
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 0; page < V2_MAX_PAGES_DESC; page += 1) {
    const raw = await callSubscanPost<Record<string, unknown> | null>(input.network, apiKey, path, {
      address: input.walletAddress,
      row: V2_ROW,
      page,
      order: "desc",
      ...extraBody,
    });
    const data = raw && typeof raw === "object" ? raw : {};
    const list = data[listField];
    const rows = Array.isArray(list) ? (list as T[]) : [];
    if (!rows.length) {
      break;
    }
    all.push(...rows);
    if (rows.length < V2_ROW) {
      break;
    }
  }

  return all;
}

export async function fetchV2Transfers(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  if (blockWindow) {
    return fetchV2PagedInBlockRange<V2Transfer>(input, apiKey, "/api/v2/scan/transfers", "transfers", blockWindow, {
      include_total: false,
    });
  }
  return fetchV2PagedNewestFirst<V2Transfer>(input, apiKey, "/api/v2/scan/transfers", "transfers", {
    include_total: false,
  });
}

export async function fetchV2Extrinsics(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  if (blockWindow) {
    return fetchV2PagedInBlockRange<V2Extrinsic>(input, apiKey, "/api/v2/scan/extrinsics", "extrinsics", blockWindow);
  }
  return fetchV2PagedNewestFirst<V2Extrinsic>(input, apiKey, "/api/v2/scan/extrinsics", "extrinsics");
}

export async function fetchV2RewardSlash(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  if (blockWindow) {
    return fetchV2PagedInBlockRange<V2RewardSlash>(
      input,
      apiKey,
      "/api/v2/scan/account/reward_slash",
      "list",
      blockWindow,
      REWARD_SLASH_BODY,
    );
  }
  return fetchV2PagedNewestFirst<V2RewardSlash>(input, apiKey, "/api/v2/scan/account/reward_slash", "list", REWARD_SLASH_BODY);
}

/**
 * Staking rewards in `[startUnix, endUnix]`. (1) v2 + `block_range` when known, (2) same URL with
 * split `block_range` chunks if the wide list is empty, (3) v2 global paging (newest-first) with
 * early stop when a page is entirely before the statement start + a page cap, (4) v1 fallback
 * with the same rules.
 */
export async function fetchV2RewardSlashForStatementPeriod(
  input: StatementInput,
  apiKey: string,
  startUnix: number,
  endUnix: number,
  substrateBlockWindow: StatementBlockWindow | null = null,
): Promise<V2RewardSlash[]> {
  const inWindow = (r: V2RewardSlash) => {
    const ts = toUnixSecondsForChain(r.block_timestamp);
    return ts >= startUnix && ts <= endUnix;
  };

  const normalized: StatementInput = { ...input, walletAddress: input.walletAddress.trim() };

  if (substrateBlockWindow) {
    const byBlock = await fetchV2PagedInBlockRange<V2RewardSlash>(
      { ...normalized, walletAddress: normalized.walletAddress.toLowerCase() },
      apiKey,
      "/api/v2/scan/account/reward_slash",
      "list",
      substrateBlockWindow,
      REWARD_SLASH_BODY,
    );
    const filtered = byBlock.filter(inWindow);
    if (filtered.length > 0) {
      return filtered;
    }
    const chunked = await fetchV2RewardSlashChunkedInBlockRange(
      { ...normalized, walletAddress: normalized.walletAddress.toLowerCase() },
      apiKey,
      substrateBlockWindow,
    );
    const filteredChunked = chunked.filter(inWindow);
    if (filteredChunked.length > 0) {
      return filteredChunked;
    }
  }

  const v2 = await fetchRewardSlashV2UnboundedPages(
    { ...normalized, walletAddress: normalized.walletAddress.toLowerCase() },
    apiKey,
    startUnix,
    endUnix,
  );
  if (v2.length > 0) {
    return v2;
  }

  try {
    return await fetchRewardSlashV1UnboundedPages(
      { ...normalized, walletAddress: normalized.walletAddress.toLowerCase() },
      apiKey,
      startUnix,
      endUnix,
    );
  } catch {
    return [];
  }
}

/**
 * v2: newest-first pages (default on reward_slash). We stop after **two** consecutive full
 * (100-row) pages whose newest reward is still strictly before the statement start — Subscan
 * order can wobble, so we require two. (Previously we only stopped on a short/empty page, so
 * active accounts could walk ~1000 full pages and exceed serverless time limits.) Hard page cap
 * remains as a backstop. See [v2 list](https://support.subscan.io/api-4231209).
 */
async function fetchRewardSlashV2UnboundedPages(
  input: StatementInput,
  apiKey: string,
  startUnix: number,
  endUnix: number,
): Promise<V2RewardSlash[]> {
  const address = input.walletAddress.trim();
  if (!address) {
    return [];
  }

  const collected: V2RewardSlash[] = [];
  let consecutiveFullPageBeforeStart = 0;

  for (let page = 0; page < V2_REWARD_UNBOUNDED_MAX_PAGES; page += 1) {
    const raw = await callSubscanPost<Record<string, unknown> | null>(input.network, apiKey, "/api/v2/scan/account/reward_slash", {
      address: address.toLowerCase(),
      row: V2_ROW,
      page,
      order: "desc",
      ...REWARD_SLASH_BODY,
    });
    const data = raw && typeof raw === "object" ? raw : {};
    const list = data.list;
    const rows = Array.isArray(list) ? (list as V2RewardSlash[]) : [];
    if (rows.length === 0) {
      break;
    }

    const times = rows.map((row) => toUnixSecondsForChain(row.block_timestamp));
    const maxTs = Math.max(...times);

    for (const row of rows) {
      const ts = toUnixSecondsForChain(row.block_timestamp);
      if (ts >= startUnix && ts <= endUnix) {
        collected.push(row);
      }
    }

    if (rows.length < V2_ROW) {
      break;
    }
    if (rows.length === V2_ROW && maxTs < startUnix) {
      consecutiveFullPageBeforeStart += 1;
      if (consecutiveFullPageBeforeStart >= 2) {
        break;
      }
    } else {
      consecutiveFullPageBeforeStart = 0;
    }
  }

  return collected;
}

/**
 * v1: same as explorer’s legacy [`/api/scan/account/reward_slash`](https://support.subscan.io/api-4193056)
 * when v2 returns no rows in-range (observed in some EVM H160 + staking setups).
 */
async function fetchRewardSlashV1UnboundedPages(
  input: StatementInput,
  apiKey: string,
  startUnix: number,
  endUnix: number,
): Promise<V2RewardSlash[]> {
  const address = input.walletAddress.trim();
  if (!address) {
    return [];
  }

  const collected: V2RewardSlash[] = [];
  let consecutiveFullPageBeforeStart = 0;

  for (let page = 0; page < V2_REWARD_UNBOUNDED_MAX_PAGES; page += 1) {
    const raw = await callSubscanPost<Record<string, unknown> | null>(input.network, apiKey, "/api/scan/account/reward_slash", {
      address: address.toLowerCase(),
      row: V2_ROW,
      page,
      ...REWARD_SLASH_BODY,
    });
    const data = raw && typeof raw === "object" ? raw : {};
    const list = data.list;
    const rows = Array.isArray(list) ? (list as V2RewardSlash[]) : [];
    if (rows.length === 0) {
      break;
    }

    const times = rows.map((r) => toUnixSecondsForChain(r.block_timestamp));
    const maxTs = Math.max(...times);

    for (const row of rows) {
      const ts = toUnixSecondsForChain(row.block_timestamp);
      if (ts >= startUnix && ts <= endUnix) {
        collected.push(row);
      }
    }

    if (rows.length < V2_ROW) {
      break;
    }
    if (rows.length === V2_ROW && maxTs < startUnix) {
      consecutiveFullPageBeforeStart += 1;
      if (consecutiveFullPageBeforeStart >= 2) {
        break;
      }
    } else {
      consecutiveFullPageBeforeStart = 0;
    }
  }

  return collected;
}

export async function fetchEvmTokenTransfers(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 100;
  const all: EvmTokenTransfer[] = [];
  const startblock = blockWindow ? String(blockWindow.from) : "0";
  const endblock = blockWindow ? String(blockWindow.to) : "99999999";

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = etherscanListResult(
      await callEtherscanLike<EvmTokenTransfer[] | null>(input.network, apiKey, {
        module: "account",
        action: "tokentx",
        address: input.walletAddress,
        startblock,
        endblock,
        page: String(page),
        offset: String(PAGE_SIZE),
        sort: blockWindow ? "asc" : "desc",
      }),
    );

    if (!batch.length) {
      break;
    }
    all.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

export async function fetchEvmNftTransfers(
  input: StatementInput,
  apiKey: string,
  blockWindow: StatementBlockWindow | null = null,
) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 100;
  const all: EvmTokenTransfer[] = [];
  const startblock = blockWindow ? String(blockWindow.from) : "0";
  const endblock = blockWindow ? String(blockWindow.to) : "99999999";

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = etherscanListResult(
      await callEtherscanLike<EvmTokenTransfer[] | null>(input.network, apiKey, {
        module: "account",
        action: "tokennfttx",
        address: input.walletAddress,
        startblock,
        endblock,
        page: String(page),
        offset: String(PAGE_SIZE),
        sort: blockWindow ? "asc" : "desc",
      }),
    );

    if (!batch.length) {
      break;
    }
    all.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}
