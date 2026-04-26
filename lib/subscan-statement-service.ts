import { buildStatementSummary } from "@/lib/statement-calculations";
import { fetchCurrentEvmBalanceWei, fetchEvmTxList } from "@/lib/subscan-client";
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

function toIsoDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
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

  const [currentBalanceWei, transactions] = await Promise.all([
    fetchCurrentEvmBalanceWei(input, apiKey),
    fetchEvmTxList(input, apiKey),
  ]);

  const wallet = input.walletAddress.toLowerCase();
  const startUnix = startOfDayUnix(input.startDate);
  const endUnix = endOfDayUnix(input.endDate);

  const dayBuckets = new Map<string, DayAccumulator>();
  let periodNetWei = 0;
  let afterPeriodNetWei = 0;

  for (const tx of transactions) {
    const timestamp = Number(tx.timeStamp);
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    const value = Number(tx.value || "0");
    const fee = from === wallet ? Number(tx.gasPrice || "0") * Number(tx.gasUsed || "0") : 0;

    let txNet = 0;
    if (to === wallet) {
      txNet += value;
    }
    if (from === wallet) {
      txNet -= value + fee;
    }

    if (timestamp > endUnix) {
      afterPeriodNetWei += txNet;
      continue;
    }

    if (timestamp < startUnix) {
      continue;
    }

    periodNetWei += txNet;

    const date = toIsoDate(timestamp);
    const day = dayBuckets.get(date) ?? { incoming: 0, outgoing: 0, fees: 0, txCount: 0 };
    if (to === wallet && value > 0) {
      day.incoming += value;
    }
    if (from === wallet && value > 0) {
      day.outgoing += value;
    }
    if (fee > 0) {
      day.fees += fee;
    }
    day.txCount += 1;
    dayBuckets.set(date, day);
  }

  const endingBalanceWei = currentBalanceWei - afterPeriodNetWei;
  const beginningBalanceWei = endingBalanceWei - periodNetWei;
  const detailLines: StatementLine[] = [];

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

  const summary = buildStatementSummary(weiToTokenAmount(beginningBalanceWei), detailLines);
  summary.endingBalance = weiToTokenAmount(endingBalanceWei);
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
    detailLines,
    notes: [
      "Live data source: Subscan EVM account endpoints.",
      "Reward Income is temporarily set to 0 until dedicated reward endpoints are integrated.",
      "Beginning/ending balances are estimated from current balance and transaction history in the selected range.",
    ],
  };
}
