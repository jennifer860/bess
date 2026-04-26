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

type EtherscanLikeResponse<T> = {
  status: string;
  message: string;
  result: T;
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

async function callEtherscanLike<T>(
  network: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<T> {
  const endpoint = new URL(`https://${getApiHost(network)}/api/scan/evm/etherscan`);
  for (const [key, value] of Object.entries(params)) {
    endpoint.searchParams.set(key, value);
  }

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Subscan request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as EtherscanLikeResponse<T>;
  if (payload.status === "1") {
    return payload.result;
  }

  if (payload.message === "No transactions found") {
    return payload.result;
  }

  const detail = parseSubscanErrorDetail(payload.result);
  throw new Error(`Subscan response error: ${payload.message}. Detail: ${detail}`);
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
  const result = await callEtherscanLike<EvmTx[]>(input.network, apiKey, {
    module: "account",
    action: "txlist",
    address: input.walletAddress,
    startblock: "0",
    endblock: "99999999",
    page: "1",
    offset: "10000",
    sort: "asc",
  });

  return result;
}
