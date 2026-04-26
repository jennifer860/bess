import { toUnixSecondsForChain } from "@/lib/chain-timestamp";
import { buildStatementSummary } from "@/lib/statement-calculations";
import {
  fetchBalanceHistory,
  fetchCurrentEvmBalanceWei,
  fetchEvmNftTransfers,
  fetchEvmTokenTransfers,
  fetchEvmTxList,
  fetchV2Extrinsics,
  fetchV2RewardSlashForStatementPeriod,
  fetchV2Transfers,
  resolveEvmBlockWindow,
  resolveSubstrateBlockWindow,
} from "@/lib/subscan-client";
import type { StatementData, StatementInput, StatementLine } from "@/types/statement";

const TOKEN_DECIMALS = 1e18;

function startOfDayUnix(dateString: string) {
  return Math.floor(new Date(`${dateString}T00:00:00Z`).getTime() / 1000);
}

function endOfDayUnix(dateString: string) {
  return Math.floor(new Date(`${dateString}T23:59:59Z`).getTime() / 1000);
}

function weiToTokenAmount(value: number) {
  return value / TOKEN_DECIMALS;
}

const WEI_PER_TOKEN = BigInt("1000000000000000000");

/** Sum of wei integer strings; avoids float overflow on GLMR-scale balances. */
function weiBigIntToGlmr(wei: bigint) {
  if (wei === BigInt(0)) return 0;
  const intPart = wei / WEI_PER_TOKEN;
  const frac = wei % WEI_PER_TOKEN;
  return Number(intPart) + Number(frac) / Number(TOKEN_DECIMALS);
}

function parseRewardWeiString(raw: string | undefined) {
  if (raw == null) return BigInt(0);
  const t = raw.trim();
  if (t === "") {
    return BigInt(0);
  }
  if (t.includes(".") || t.includes("e") || t.includes("E")) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) {
      return BigInt(Math.round(n * Number(TOKEN_DECIMALS)));
    }
    return BigInt(0);
  }
  if (!/^\d+$/.test(t)) {
    return BigInt(0);
  }
  try {
    return BigInt(t);
  } catch {
    return BigInt(0);
  }
}

function toIsoDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function isInRange(unixSeconds: number, startUnix: number, endUnix: number) {
  return unixSeconds >= startUnix && unixSeconds <= endUnix;
}

function parseTokenWithDecimals(rawValue: string, decimalsRaw: string) {
  const value = Number(rawValue || "0");
  const decimals = Number(decimalsRaw || "18");
  return value / 10 ** decimals;
}

type DayAccumulator = {
  incoming: number;
  outgoing: number;
  fees: number;
  txCount: number;
};

export async function getLiveStatementFromSubscan(
  input: StatementInput,
  apiKey: string,
): Promise<StatementData> {
  if (input.network !== "Moonbeam") {
    throw new Error("Live mode currently supports Moonbeam first. Keep using mock mode for other networks.");
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(input.walletAddress.trim())) {
    throw new Error("Live Moonbeam mode requires a valid 0x EVM wallet address (42 characters).");
  }

  const startUnix = startOfDayUnix(input.startDate);
  const endUnix = endOfDayUnix(input.endDate);

  const [substrateBlockWindow, evmBlockWindow] = await Promise.all([
    resolveSubstrateBlockWindow(input, apiKey),
    resolveEvmBlockWindow(input, apiKey),
  ]);

  const [currentBalanceWei, balanceHistory, transfers, rewards, extrinsics, evmTxs, erc20Txs, nftTxs] =
    await Promise.all([
      fetchCurrentEvmBalanceWei(input, apiKey),
      fetchBalanceHistory(input, apiKey),
      fetchV2Transfers(input, apiKey, substrateBlockWindow),
      fetchV2RewardSlashForStatementPeriod(input, apiKey, startUnix, endUnix, substrateBlockWindow),
      fetchV2Extrinsics(input, apiKey, substrateBlockWindow),
      fetchEvmTxList(input, apiKey, evmBlockWindow),
      fetchEvmTokenTransfers(input, apiKey, evmBlockWindow),
      fetchEvmNftTransfers(input, apiKey, evmBlockWindow),
    ]);

  const wallet = input.walletAddress.toLowerCase();

  const dayBuckets = new Map<string, DayAccumulator>();
  const detailLines: StatementLine[] = [];

  for (const transfer of transfers) {
    const timestamp = toUnixSecondsForChain(transfer.block_timestamp);
    if (!isInRange(timestamp, startUnix, endUnix)) continue;
    if (transfer.success === false) continue;

    const date = toIsoDate(timestamp);
    const day = dayBuckets.get(date) ?? { incoming: 0, outgoing: 0, fees: 0, txCount: 0 };
    const amount = Number(transfer.amount_v2 ?? transfer.amount ?? "0");
    const from = (transfer.from ?? "").toLowerCase();
    const to = (transfer.to ?? "").toLowerCase();
    const fromEvm = (transfer.from_account_display?.evm_address ?? "").toLowerCase();
    const toEvm = (transfer.to_account_display?.evm_address ?? "").toLowerCase();

    const userIsRecipient = to === wallet || toEvm === wallet;
    const userIsSender = from === wallet || fromEvm === wallet;
    if (!userIsRecipient && !userIsSender) continue;

    if (userIsRecipient && amount > 0) day.incoming += amount;
    if (userIsSender && amount > 0) day.outgoing += amount;
    day.txCount += 1;
    dayBuckets.set(date, day);
  }

  for (const ext of extrinsics) {
    const timestamp = toUnixSecondsForChain(ext.block_timestamp);
    if (!isInRange(timestamp, startUnix, endUnix)) continue;
    if (ext.success === false) continue;

    const date = toIsoDate(timestamp);
    const day = dayBuckets.get(date) ?? { incoming: 0, outgoing: 0, fees: 0, txCount: 0 };
    day.fees += Number(ext.fee_used ?? ext.fee ?? "0");
    day.txCount += 1;
    dayBuckets.set(date, day);
  }

  for (const [date, day] of [...dayBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (day.incoming > 0) {
      detailLines.push({
        date,
        category: "Incoming Transfers",
        amount: weiToTokenAmount(day.incoming),
        direction: "in",
        txCount: day.txCount,
      });
    }
    if (day.outgoing > 0) {
      detailLines.push({
        date,
        category: "Outgoing Transfers",
        amount: weiToTokenAmount(day.outgoing),
        direction: "out",
        txCount: day.txCount,
      });
    }
    if (day.fees > 0) {
      detailLines.push({
        date,
        category: "Fees",
        amount: weiToTokenAmount(day.fees),
        direction: "out",
        txCount: day.txCount,
      });
    }
  }

  /** Already filtered in `fetchV2RewardSlashForStatementPeriod` to the statement window. */
  const rewardsInPeriod = rewards;
  const rewardByDate = new Map<string, bigint>();
  for (const reward of rewardsInPeriod) {
    const date = toIsoDate(toUnixSecondsForChain(reward.block_timestamp));
    rewardByDate.set(
      date,
      (rewardByDate.get(date) ?? BigInt(0)) + parseRewardWeiString(reward.amount),
    );
  }
  for (const [date, amountWei] of [...rewardByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    detailLines.push({
      date,
      category: "Reward Income",
      amount: weiBigIntToGlmr(amountWei),
      direction: "in",
      txCount: rewardsInPeriod.filter(
        (row) => toIsoDate(toUnixSecondsForChain(row.block_timestamp)) === date,
      ).length,
    });
  }

  const addCountOnlyCategory = (
    date: string,
    category: StatementLine["category"],
    count: number,
    notes?: string,
  ) => {
    if (count <= 0) return;
    detailLines.push({
      date,
      category,
      amount: 0,
      direction: "out",
      txCount: count,
      notes,
    });
  };

  const evmTxByDate = new Map<string, number>();
  for (const tx of evmTxs) {
    const ts = toUnixSecondsForChain(tx.timeStamp);
    if (!isInRange(ts, startUnix, endUnix)) continue;
    const date = toIsoDate(ts);
    evmTxByDate.set(date, (evmTxByDate.get(date) ?? 0) + 1);
  }
  for (const [date, count] of evmTxByDate) addCountOnlyCategory(date, "EVM Transactions", count);

  const erc20ByDate = new Map<string, { count: number; amount: number }>();
  for (const tx of erc20Txs) {
    const ts = toUnixSecondsForChain(tx.timeStamp);
    if (!isInRange(ts, startUnix, endUnix)) continue;
    const date = toIsoDate(ts);
    const row = erc20ByDate.get(date) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += parseTokenWithDecimals(tx.value, tx.tokenDecimal);
    erc20ByDate.set(date, row);
  }
  for (const [date, row] of erc20ByDate) {
    detailLines.push({
      date,
      category: "ERC-20 Transfers",
      amount: row.amount,
      direction: "in",
      txCount: row.count,
      notes: "Amount shown in source token units (not normalized to GLMR).",
    });
  }

  const nftByDate = new Map<string, number>();
  for (const tx of nftTxs) {
    const ts = toUnixSecondsForChain(tx.timeStamp);
    if (!isInRange(ts, startUnix, endUnix)) continue;
    const date = toIsoDate(ts);
    nftByDate.set(date, (nftByDate.get(date) ?? 0) + 1);
  }
  for (const [date, count] of nftByDate) {
    addCountOnlyCategory(date, "EVM Transactions", count, "Includes NFT transfer activity.");
  }

  const extrinsicByDate = new Map<string, { proxy: number; other: number }>();
  for (const ext of extrinsics) {
    const ts = toUnixSecondsForChain(ext.block_timestamp);
    if (!isInRange(ts, startUnix, endUnix)) continue;
    if (ext.success === false) continue;
    const date = toIsoDate(ts);
    const row = extrinsicByDate.get(date) ?? { proxy: 0, other: 0 };
    if ((ext.call_module ?? "").toLowerCase() === "proxy") row.proxy += 1;
    else row.other += 1;
    extrinsicByDate.set(date, row);
  }
  for (const [date, row] of extrinsicByDate) {
    addCountOnlyCategory(date, "Proxy", row.proxy);
    addCountOnlyCategory(date, "Extrinsics", row.other);
  }

  const transferCountByDate = new Map<string, number>();
  for (const transfer of transfers) {
    const ts = toUnixSecondsForChain(transfer.block_timestamp);
    if (!isInRange(ts, startUnix, endUnix)) continue;
    const from = (transfer.from ?? "").toLowerCase();
    const to = (transfer.to ?? "").toLowerCase();
    const fromEvm = (transfer.from_account_display?.evm_address ?? "").toLowerCase();
    const toEvm = (transfer.to_account_display?.evm_address ?? "").toLowerCase();
    if (from !== wallet && fromEvm !== wallet && to !== wallet && toEvm !== wallet) continue;
    const date = toIsoDate(ts);
    transferCountByDate.set(date, (transferCountByDate.get(date) ?? 0) + 1);
  }
  for (const [date, count] of transferCountByDate) addCountOnlyCategory(date, "Transfers", count);

  const sortedHistory = [...balanceHistory].sort((a, b) => a.date.localeCompare(b.date));
  const startBalanceRaw = sortedHistory.find((row) => row.date >= input.startDate)?.balance ?? sortedHistory[0]?.balance;
  const endBalanceRaw =
    [...sortedHistory].reverse().find((row) => row.date <= input.endDate)?.balance ?? sortedHistory.at(-1)?.balance;
  const beginningBalance = startBalanceRaw ? weiToTokenAmount(Number(startBalanceRaw)) : 0;
  const endingBalance = endBalanceRaw ? weiToTokenAmount(Number(endBalanceRaw)) : weiToTokenAmount(currentBalanceWei);

  const summary = buildStatementSummary(beginningBalance, detailLines);
  summary.endingBalance = endingBalance;
  summary.accountingCheckPassed =
    Math.abs(
      summary.beginningBalance +
        summary.incomingTransfers +
        summary.rewardIncome -
        summary.outgoingTransfers -
        summary.fees -
        summary.endingBalance,
    ) < 0.000001;

  return {
    ...input,
    generatedAt: new Date().toISOString(),
    accountLabel: "Primary Wallet",
    networkHost: `${input.network.toLowerCase()}.subscan.io`,
    summary,
    detailLines: detailLines.sort((a, b) =>
      a.date === b.date ? a.category.localeCompare(b.category) : a.date.localeCompare(b.date),
    ),
    notes: [
      "Live data source: Subscan balance history + transfers + staking rewards (v2 reward_slash, same data as Reward tab / Download all, paged newest-first then filtered by date) + extrinsics + EVM activity.",
      substrateBlockWindow
        ? `Substrate block window (v2 transfers/extrinsics): ${substrateBlockWindow.from}–${substrateBlockWindow.to} (from /api/scan/block — not EVM block height).`
        : "Could not resolve a Substrate block range from dates; v2 transfers/extrinsics use unbounded paging (slower, may be incomplete for very active accounts).",
      evmBlockWindow
        ? `EVM block window (txlist/tokentx): ${evmBlockWindow.from}–${evmBlockWindow.to} (getblocknobytime).`
        : "Could not resolve an EVM block range; Etherscan-style lists use unbounded paging.",
      "Beginning/ending balances are taken from Subscan balance history snapshots for the selected dates.",
      sortedHistory.length
        ? `Balance snapshots returned from ${sortedHistory[0].date} to ${sortedHistory[sortedHistory.length - 1].date}.`
        : "No balance history snapshots were returned for this wallet and period.",
      `Fetched records: transfers=${transfers.length}, rewards=${rewards.length}, extrinsics=${extrinsics.length}, evmTx=${evmTxs.length}, erc20=${erc20Txs.length}, nft=${nftTxs.length}.`,
    ],
  };
}
