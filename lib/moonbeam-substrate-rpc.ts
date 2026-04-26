import { ApiPromise, WsProvider } from "@polkadot/api";

const WS_ENDPOINTS = [
  "wss://wss.api.moonbeam.network",
  "wss://moonbeam-rpc.dwellir.com",
];

const WEI_PER_GLMR = BigInt(10) ** BigInt(18);

type MoonbeamAccountTotals = {
  free: number;
  reserved: number;
  total: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __moonbeamApiPromise: Promise<ApiPromise> | undefined;
}

function weiToGlmr(wei: bigint) {
  return Number(wei) / Number(WEI_PER_GLMR);
}

async function createMoonbeamApi() {
  let lastErr: unknown = null;
  for (const ws of WS_ENDPOINTS) {
    try {
      const provider = new WsProvider(ws, 10_000);
      const api = await ApiPromise.create({ provider, noInitWarn: true });
      return api;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not connect Moonbeam substrate RPC.");
}

async function getMoonbeamApi() {
  if (!globalThis.__moonbeamApiPromise) {
    globalThis.__moonbeamApiPromise = createMoonbeamApi();
  }
  return globalThis.__moonbeamApiPromise;
}

/**
 * Native Moonbeam account state at a substrate block.
 * We use `free + reserved` as "total in wallet" (includes staked/locked holdings unlike EVM `eth_getBalance`).
 */
export async function getMoonbeamSystemAccountTotalsAtSubstrateBlock(
  walletAddress: string,
  substrateBlockNumber: number,
): Promise<MoonbeamAccountTotals | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress.trim())) {
    return null;
  }
  if (!Number.isFinite(substrateBlockNumber) || substrateBlockNumber < 0) {
    return null;
  }
  const api = await getMoonbeamApi();
  const blockHash = await api.rpc.chain.getBlockHash(substrateBlockNumber);
  const at = await api.at(blockHash);
  const account = (await at.query.system.account(walletAddress.trim().toLowerCase())) as unknown as {
    data: { toJSON: () => unknown };
  };
  const data = account.data.toJSON() as {
    free?: string | number;
    reserved?: string | number;
  };
  const freeWei = BigInt(data.free ?? 0);
  const reservedWei = BigInt(data.reserved ?? 0);
  return {
    free: weiToGlmr(freeWei),
    reserved: weiToGlmr(reservedWei),
    total: weiToGlmr(freeWei + reservedWei),
  };
}

