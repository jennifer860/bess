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
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })} ${tokenSymbol}`;
}

export function hasNoActivity(statement: StatementData) {
  return statement.detailLines.length === 0;
}
