#!/usr/bin/env node
/**
 * Local Subscan balance_history probe — no deploy. Compare to your expected numbers.
 *
 * Usage (PowerShell, from repo root):
 *   $env:SUBSCAN_API_KEY="your_key"
 *   node scripts/debug-subscan-balance.mjs
 *
 * Or with Node 20+:
 *   node --env-file=.env.local scripts/debug-subscan-balance.mjs
 *
 * Edit DEFAULT_ADDRESS / dates below or pass args:
 *   node scripts/debug-subscan-balance.mjs 0xYour... 2023-01-30 2023-01-31 2023-02-01 2023-03-01
 */

const DEFAULT_ADDRESS = "0x54d91ff83f48837a113ef60db336e3b3cc05a6c1";
const WEI = 10n ** 18n;

function parseBalanceGlmr(raw) {
  if (raw == null) return { n: 0, err: "null" };
  let t = String(raw).trim();
  if (!t) return { n: 0, err: "empty" };
  t = t.replace(/,/g, "").replace(/[\s_']/g, "");
  if (t.startsWith("0x") || t.startsWith("0X")) {
    try {
      const w = BigInt(t);
      return { n: Number(w) / Number(WEI), err: null };
    } catch (e) {
      return { n: 0, err: String(e) };
    }
  }
  if (t.includes(".") || /[eE]/.test(t)) {
    const n = Number(t);
    return { n: Number.isFinite(n) ? n : 0, err: Number.isFinite(n) ? null : "bad decimal" };
  }
  if (!/^\d+$/.test(t)) return { n: 0, err: "not digits" };
  try {
    const w = BigInt(t);
    return { n: Number(w) / Number(WEI), err: null };
  } catch {
    return { n: 0, err: "bigint" };
  }
}

async function fetchRangeRaw(address, start, end, apiKey) {
  const res = await fetch("https://moonbeam.api.subscan.io/api/scan/account/balance_history", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ address: address.trim().toLowerCase(), start, end }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.code !== 0) {
    throw new Error(`Subscan code ${json.code}: ${json.message}`);
  }
  return json;
}

async function fetchRange(address, start, end, apiKey) {
  const json = await fetchRangeRaw(address, start, end, apiKey);
  return json.data?.history ?? [];
}

async function main() {
  const apiKey = process.env.SUBSCAN_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set SUBSCAN_API_KEY (or use: node --env-file=.env.local scripts/debug-subscan-balance.mjs)");
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const address = argv[0]?.startsWith("0x") ? argv[0] : DEFAULT_ADDRESS;
  const dates =
    argv.length > 1 && !argv[1].startsWith("0x")
      ? argv.slice(1)
      : ["2023-01-30", "2023-01-31", "2023-02-01", "2023-02-28", "2023-03-01"];

  console.log("Address:", address);
  console.log("Expected beginning (your ref) for period starting 2023-02-01: ~172231.7442 GLMR");
  console.log("(Statement uses EOD **before** first day = row 2023-01-31 for Subscan daily snapshots.)\n");

  for (const d of dates) {
    const raw = await fetchRangeRaw(address, d, d, apiKey);
    const rows = raw.data?.history ?? [];
    const row = rows.find((r) => String(r.date).slice(0, 10) === d) ?? rows[0];
    if (!row) {
      console.log(`${d}: no row returned (code=${raw.code}, message=${raw.message}, history=${rows.length})`);
      continue;
    }
    const { n, err } = parseBalanceGlmr(row.balance);
    console.log(`${d}  raw=${JSON.stringify(row.balance)}  parsed=${n.toFixed(6)} GLMR${err ? `  [${err}]` : ""}`);
  }

  console.log("\n--- wide range (same as API statement pre-enrich) ---");
  const wide = await fetchRange(address, "2023-01-31", "2023-03-01", apiKey);
  console.log(`rows: ${wide.length}`);
  for (const r of wide.slice(0, 5)) {
    const { n } = parseBalanceGlmr(r.balance);
    console.log(`  ${r.date} -> ${n.toFixed(4)}`);
  }
  if (wide.length > 5) console.log(`  ... +${wide.length - 5} more`);

  console.log("\n--- full wallet window from your CSV timeframe ---");
  const longRaw = await fetchRangeRaw(address, "2022-07-17", "2025-02-28", apiKey);
  const longRows = longRaw.data?.history ?? [];
  console.log(`code=${longRaw.code} message=${longRaw.message} rows=${longRows.length}`);
  if (longRows.length) {
    const first = longRows[0];
    const last = longRows[longRows.length - 1];
    const pFirst = parseBalanceGlmr(first.balance).n;
    const pLast = parseBalanceGlmr(last.balance).n;
    console.log(`first=${first.date} parsed=${pFirst.toFixed(6)} raw=${JSON.stringify(first.balance)}`);
    console.log(`last=${last.date} parsed=${pLast.toFixed(6)} raw=${JSON.stringify(last.balance)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
