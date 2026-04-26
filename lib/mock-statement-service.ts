import type { StatementData, StatementInput, StatementLine } from "@/types/statement";
import { buildStatementSummary } from "@/lib/statement-calculations";

const NETWORK_TO_HOST: Record<string, string> = {
  Moonbeam: "moonbeam.subscan.io",
  Astar: "astar.subscan.io",
  Polkadot: "polkadot.subscan.io",
  Kusama: "kusama.subscan.io",
};

/** Feb 2025 activity demo: staking-only rewards, total 3,838.77823 GLMR (sum of lines). */
function getActivityScenarioLines(): StatementLine[] {
  return [
    {
      date: "2025-02-06",
      category: "Reward Income",
      amount: 733.101223,
      direction: "in",
      txCount: 7,
    },
    {
      date: "2025-02-12",
      category: "Reward Income",
      amount: 902.222113,
      direction: "in",
      txCount: 8,
    },
    {
      date: "2025-02-20",
      category: "Reward Income",
      amount: 1000.154894,
      direction: "in",
      txCount: 9,
    },
    {
      date: "2025-02-24",
      category: "Reward Income",
      amount: 1203.3,
      direction: "in",
      txCount: 12,
    },
  ];
}

export function getMockStatementData(
  input: StatementInput,
  scenario: "activity" | "no-activity",
): StatementData {
  const beginningBalance = 574002.932899;
  const detailLines = scenario === "activity" ? getActivityScenarioLines() : [];
  const summary = buildStatementSummary(beginningBalance, detailLines);

  if (scenario === "no-activity") {
    summary.endingBalance = 574002.932899;
    summary.totalActivity = 0;
    summary.accountingCheckPassed = true;
  }

  return {
    ...input,
    generatedAt: new Date().toISOString(),
    accountLabel: "Primary Wallet",
    networkHost: NETWORK_TO_HOST[input.network] ?? `${input.network.toLowerCase()}.subscan.io`,
    summary,
    detailLines,
    notes: [
      "This statement is generated from mock blockchain data for UI and PDF preview testing.",
      "Mock mode does not use the start/end date fields; choose Live Subscan to filter by the selected period.",
      "In production, data should be fetched and reconciled from Subscan endpoints.",
      "All amounts are shown in native token units unless otherwise specified.",
    ],
  };
}

// TODO(next): Replace this function with real Subscan API integration.
// Suggested flow:
// 1) Fetch account transfers and reward events for the selected network + wallet.
// 2) Aggregate raw transactions into daily category lines.
// 3) Run buildStatementSummary(...) and return the same StatementData shape.
