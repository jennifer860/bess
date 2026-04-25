export type TransactionCategory =
  | "Incoming Transfers"
  | "Reward Income"
  | "Outgoing Transfers"
  | "Fees"
  | "Extrinsics"
  | "ERC-20 Transfers"
  | "EVM Transactions"
  | "Transfers"
  | "Proxy";

export type StatementLine = {
  date: string;
  category: TransactionCategory;
  amount: number;
  direction: "in" | "out";
  txCount: number;
  notes?: string;
};

export type StatementInput = {
  network: string;
  walletAddress: string;
  tokenSymbol: string;
  startDate: string;
  endDate: string;
};

export type StatementSummary = {
  beginningBalance: number;
  incomingTransfers: number;
  rewardIncome: number;
  outgoingTransfers: number;
  fees: number;
  totalActivity: number;
  endingBalance: number;
  accountingCheckPassed: boolean;
};

export type StatementData = StatementInput & {
  generatedAt: string;
  accountLabel: string;
  networkHost: string;
  summary: StatementSummary;
  detailLines: StatementLine[];
  notes: string[];
};
