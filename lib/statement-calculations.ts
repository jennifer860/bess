import type { StatementData, StatementLine, StatementSummary } from "@/types/statement";

function sumBy(lines: StatementLine[], category: StatementLine["category"]): number {
  return lines
    .filter((line) => line.category === category)
    .reduce((total, line) => total + line.amount, 0);
}

export function buildStatementSummary(
  beginningBalance: number,
  detailLines: StatementLine[],
): StatementSummary {
  const incomingTransfers = sumBy(detailLines, "Incoming Transfers");
  const rewardIncome = sumBy(detailLines, "Reward Income");
  const outgoingTransfers = sumBy(detailLines, "Outgoing Transfers");
  const fees = sumBy(detailLines, "Fees");

  const additions = incomingTransfers + rewardIncome;
  const subtractions = outgoingTransfers + fees;
  const endingBalance = beginningBalance + additions - subtractions;
  const totalActivity = additions + subtractions;

  return {
    beginningBalance,
    incomingTransfers,
    rewardIncome,
    outgoingTransfers,
    fees,
    totalActivity,
    endingBalance,
    accountingCheckPassed:
      Math.abs(beginningBalance + additions - subtractions - endingBalance) < 0.000001,
  };
}

export function formatAmount(value: number, tokenSymbol: string) {
  const minDigits = 6;
  const maxDigits = 6;
  if (value < 0) {
    const abs = Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    return `(${abs}) ${tokenSymbol}`;
  }
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  })} ${tokenSymbol}`;
}

export function hasNoActivity(statement: StatementData) {
  return statement.detailLines.length === 0;
}
