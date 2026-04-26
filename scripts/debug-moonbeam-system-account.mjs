#!/usr/bin/env node
/**
 * Resolve Moonbeam historical account state from chain storage:
 * date -> Subscan substrate block -> block hash -> system.account at hash.
 *
 * Usage:
 *   node --env-file=.env.local scripts/debug-moonbeam-system-account.mjs
 *   node --env-file=.env.local scripts/debug-moonbeam-system-account.mjs 0x54... 2023-02-01
 */

import { ApiPromise, WsProvider } from "@polkadot/api";

const DEFAULT_ADDRESS = "0x54d91ff83f48837a113ef60db336e3b3cc05a6c1";
const DEFAULT_DATE = "2023-02-01";
const SUBSCAN_HOST = "https://moonbeam.api.subscan.io";
const WS_ENDPOINTS = [
  "wss://wss.api.moonbeam.network",
  "wss://moonbeam-rpc.dwellir.com",
];
const WEI = 10n ** 18n;

function addDaysUtc(yyyyMmDd, delta) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function unixStartOfDay(yyyyMmDd) {
  return Math.floor(Date.parse(`${yyyyMmDd}T00:00:00Z`) / 1000);
}

function fmtGlmrFromWei(wei) {
  return (Number(wei) / Number(WEI)).toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

async function fetchSubscanBlockAtUnix(unixSeconds, apiKey) {
  const body = { block_timestamp: unixSeconds, only_head: true };
  const res = await fetch(`${SUBSCAN_HOST}/api/scan/block`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok || json.code !== 0) {
    throw new Error(`Subscan /scan/block failed: HTTP ${res.status} code=${json.code} message=${json.message}`);
  }
  const data = json.data ?? {};
  const n = data.block_num ?? data.number ?? data.block?.block_num ?? data.block?.number;
  const blockNum = Number(n);
  if (!Number.isFinite(blockNum) || blockNum <= 0) {
    throw new Error(`Could not parse block number from Subscan payload: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return blockNum;
}

async function connectMoonbeamApi() {
  for (const ws of WS_ENDPOINTS) {
    try {
      const provider = new WsProvider(ws, 10_000);
      const api = await ApiPromise.create({ provider, noInitWarn: true });
      return { api, ws };
    } catch {
      // try next endpoint
    }
  }
  throw new Error(`Could not connect to any Moonbeam WS endpoint: ${WS_ENDPOINTS.join(", ")}`);
}

async function main() {
  const apiKey = process.env.SUBSCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SUBSCAN_API_KEY missing. Use --env-file=.env.local or set env var.");
  }

  const address = process.argv[2] ?? DEFAULT_ADDRESS;
  const startDate = process.argv[3] ?? DEFAULT_DATE;
  const beginDate = addDaysUtc(startDate, -1); // beginning for period start
  const beginUnix = unixStartOfDay(beginDate);
  const openUnix = unixStartOfDay(startDate);

  console.log(`Address: ${address}`);
  console.log(`Period start date: ${startDate}`);
  console.log(`Beginning convention: balance at end of ${beginDate} (state at ${startDate} 00:00:00Z)\n`);

  const [beginBlock, openBlock] = await Promise.all([
    fetchSubscanBlockAtUnix(beginUnix, apiKey),
    fetchSubscanBlockAtUnix(openUnix, apiKey),
  ]);
  console.log(`Subscan substrate block for ${beginDate} day-close anchor: ${beginBlock}`);
  console.log(`Subscan substrate block for ${startDate} 00:00:00Z: ${openBlock}\n`);

  const { api, ws } = await connectMoonbeamApi();
  console.log(`Connected WS: ${ws}`);
  try {
    const beginHash = await api.rpc.chain.getBlockHash(beginBlock);
    const openHash = await api.rpc.chain.getBlockHash(openBlock);
    const atBegin = await api.at(beginHash);
    const atOpen = await api.at(openHash);

    const beginAcc = await atBegin.query.system.account(address);
    const openAcc = await atOpen.query.system.account(address);

    const show = (label, acc, hash, block) => {
      const data = acc.data.toJSON();
      const free = BigInt(data.free ?? 0);
      const reserved = BigInt(data.reserved ?? 0);
      const frozen = BigInt(data.frozen ?? 0);
      const feeFrozen = BigInt(data.feeFrozen ?? 0);
      const miscFrozen = BigInt(data.miscFrozen ?? 0);
      const totalFreeReserved = free + reserved;
      console.log(`${label}`);
      console.log(`  block: ${block}`);
      console.log(`  hash: ${hash.toString()}`);
      console.log(`  free: ${fmtGlmrFromWei(free)} GLMR`);
      console.log(`  reserved: ${fmtGlmrFromWei(reserved)} GLMR`);
      console.log(`  total (free+reserved): ${fmtGlmrFromWei(totalFreeReserved)} GLMR`);
      console.log(`  frozen: ${fmtGlmrFromWei(frozen)} GLMR`);
      console.log(`  feeFrozen: ${fmtGlmrFromWei(feeFrozen)} GLMR`);
      console.log(`  miscFrozen: ${fmtGlmrFromWei(miscFrozen)} GLMR\n`);
    };

    show("State at day-close anchor (beginning balance convention)", beginAcc, beginHash, beginBlock);
    show("State at start-of-period instant", openAcc, openHash, openBlock);
  } finally {
    await api.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

