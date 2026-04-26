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
      return payload.result;
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

export async function fetchCurrentEvmBalanceWei(input: StatementInput, apiKey: string) {
  const result = await callEtherscanLike<string>(input.network, apiKey, {
    module: "account",
    action: "balance",
    address: input.walletAddress,
    tag: "latest",
  });

  return Number(result);
}

export async function fetchEvmTxList(input: StatementInput, apiKey: string) {
  // Subscan enforces a max offset; fetch in pages.
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const all: EvmTx[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await callEtherscanLike<EvmTx[]>(input.network, apiKey, {
      module: "account",
      action: "txlist",
      address: input.walletAddress,
      startblock: "0",
      endblock: "99999999",
      page: String(page),
      offset: String(PAGE_SIZE),
      sort: "asc",
    });

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

  return data.history ?? [];
}

async function fetchV2Paged<T>(
  input: StatementInput,
  apiKey: string,
  path: string,
  listField: string,
  extraBody: Record<string, unknown> = {},
): Promise<T[]> {
  const ROW = 100;
  const MAX_PAGES = 50;
  const all: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = (await callSubscanPost<Record<string, unknown>>(input.network, apiKey, path, {
      address: input.walletAddress,
      row: ROW,
      page,
      order: "asc",
      ...extraBody,
    })) as Record<string, unknown>;

    const rows = (data[listField] as T[] | undefined) ?? [];
    if (!rows.length) {
      break;
    }

    all.push(...rows);
    if (rows.length < ROW) {
      break;
    }
  }

  return all;
}

export async function fetchV2Transfers(input: StatementInput, apiKey: string) {
  return fetchV2Paged<V2Transfer>(input, apiKey, "/api/v2/scan/transfers", "transfers", {
    include_total: false,
  });
}

export async function fetchV2Extrinsics(input: StatementInput, apiKey: string) {
  return fetchV2Paged<V2Extrinsic>(input, apiKey, "/api/v2/scan/extrinsics", "extrinsics");
}

export async function fetchV2RewardSlash(input: StatementInput, apiKey: string) {
  return fetchV2Paged<V2RewardSlash>(
    input,
    apiKey,
    "/api/v2/scan/account/reward_slash",
    "list",
    { category: "Reward" },
  );
}

export async function fetchEvmTokenTransfers(input: StatementInput, apiKey: string) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const all: EvmTokenTransfer[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await callEtherscanLike<EvmTokenTransfer[]>(input.network, apiKey, {
      module: "account",
      action: "tokentx",
      address: input.walletAddress,
      startblock: "0",
      endblock: "99999999",
      page: String(page),
      offset: String(PAGE_SIZE),
      sort: "asc",
    });

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

export async function fetchEvmNftTransfers(input: StatementInput, apiKey: string) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 20;
  const all: EvmTokenTransfer[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await callEtherscanLike<EvmTokenTransfer[]>(input.network, apiKey, {
      module: "account",
      action: "tokennfttx",
      address: input.walletAddress,
      startblock: "0",
      endblock: "99999999",
      page: String(page),
      offset: String(PAGE_SIZE),
      sort: "asc",
    });

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
