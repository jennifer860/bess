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

/** Space between each Subscan HTTP call (one global queue) to stay under key limits. */
const SUBSCAN_MIN_GAP_MS = 450;
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
 * Map statement dates to on-chain block bounds. Prefer Etherscan-compatible `getblocknobytime` so
 * `startblock`/`endblock` and v2 `block_range` match Moonbeam’s EVM/substrate height. Fall back to
 * `/api/scan/block` (seconds, then ms) if needed.
 */
export async function resolveStatementBlockWindow(
  input: StatementInput,
  apiKey: string,
): Promise<StatementBlockWindow | null> {
  const startT = Math.floor(new Date(`${input.startDate}T00:00:00Z`).getTime() / 1000);
  const endT = Math.floor(new Date(`${input.endDate}T23:59:59Z`).getTime() / 1000);
  const [a, b] = await Promise.all([
    blockNumberAtUnix(input.network, apiKey, startT),
    blockNumberAtUnix(input.network, apiKey, endT),
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

/** Etherscan-like `getblocknobytime` (Subscan supports on Moonbeam), then `/api/scan/block`. */
async function blockNumberAtUnix(network: string, apiKey: string, unixSeconds: number): Promise<number | null> {
  try {
    const raw = await callEtherscanLike<string>(network, apiKey, {
      module: "block",
      action: "getblocknobytime",
      timestamp: String(unixSeconds),
      closest: "before",
    });
    const n = parseBlockNumberFromApiValue(raw);
    if (n != null) return n;
  } catch {
    /* try scan/block */
  }

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

export async function fetchCurrentEvmBalanceWei(input: StatementInput, apiKey: string) {
  const result = await callEtherscanLike<string>(input.network, apiKey, {
    module: "account",
    action: "balance",
    address: input.walletAddress,
    tag: "latest",
  });

  return Number(result);
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

export async function fetchBalanceHistory(input: StatementInput, apiKey: string) {
  const data = await callSubscanPost<{ history?: BalanceHistoryItem[] }>(
    input.network,
    apiKey,
    "/api/scan/account/balance_history",
    {
      address: input.walletAddress,
      start: input.startDate,
      end: input.endDate,
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
      { category: "Reward" },
    );
  }
  return fetchV2PagedNewestFirst<V2RewardSlash>(input, apiKey, "/api/v2/scan/account/reward_slash", "list", {
    category: "Reward",
  });
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
