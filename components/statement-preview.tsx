import { formatAmount, hasNoActivity } from "@/lib/statement-calculations";
import type { StatementData } from "@/types/statement";

type StatementPreviewProps = {
  statement: StatementData | null;
};

export function StatementPreview({ statement }: StatementPreviewProps) {
  if (!statement) {
    return (
      <section className="rounded-2xl border border-dashed border-bess-ink/25 bg-bess-mist/50 p-6 text-bess-ink/70">
        Generate a statement to preview account summary and transaction detail pages.
      </section>
    );
  }

  const summaryRows = [
    ["Beginning Balance", statement.summary.beginningBalance],
    ["Incoming Transfers", statement.summary.incomingTransfers],
    ["Reward Income", statement.summary.rewardIncome],
    ["Outgoing Transfers", statement.summary.outgoingTransfers],
    ["Fees", statement.summary.fees],
    ["Total Activity", statement.summary.totalActivity],
    ["Ending Balance", statement.summary.endingBalance],
  ];

  return (
    <section className="rounded-2xl border border-bess-ink/10 bg-white p-6 shadow-sm">
      <div className="border-b border-bess-ink/10 pb-4">
        <h2 className="text-xl font-semibold text-bess-ink">Statement Preview</h2>
        <p className="mt-1 text-sm text-bess-ink/75">
          {statement.network} ({statement.networkHost}) | {statement.startDate} to {statement.endDate}
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-bess-ink/10 p-4">
          <h3 className="text-base font-semibold text-bess-ink">Account Details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-bess-ink/60">Wallet</dt>
              <dd className="break-all text-right text-bess-ink">{statement.walletAddress}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-bess-ink/60">Token</dt>
              <dd className="text-right text-bess-ink">{statement.tokenSymbol}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-bess-ink/60">Account Label</dt>
              <dd className="text-right text-bess-ink">{statement.accountLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-bess-ink/10 p-4">
          <h3 className="text-base font-semibold text-bess-ink">Accounting Check</h3>
          <p
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
              statement.summary.accountingCheckPassed
                ? "bg-bess-blue/15 text-bess-blue"
                : "bg-red-100 text-red-700"
            }`}
          >
            {statement.summary.accountingCheckPassed ? "Passed" : "Failed"}
          </p>
          <p className="mt-3 text-sm text-bess-ink/75">
            Beginning balance + additions - subtractions = ending balance
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bess-ink text-left text-bess-mist">
              <th className="px-3 py-2 font-medium">Account Activity Summary</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map(([label, value]) => (
              <tr key={label} className="border-b border-bess-ink/10">
                <td className="px-3 py-2 text-bess-ink/80">{label}</td>
                <td className="px-3 py-2 text-right font-medium text-bess-ink">
                  {formatAmount(Number(value), statement.tokenSymbol)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-bess-ink/10">
        <div className="border-b border-bess-ink/10 px-4 py-3">
          <h3 className="text-base font-semibold text-bess-ink">Daily Transaction Details</h3>
        </div>
        {hasNoActivity(statement) ? (
          <p className="px-4 py-5 text-sm font-medium text-bess-ink/80">No Activity During Month</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-bess-mist text-bess-ink">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Direction</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Tx Count</th>
                </tr>
              </thead>
              <tbody>
                {statement.detailLines.map((line, index) => (
                  <tr key={`${line.date}-${line.category}-${index}`} className="border-t border-bess-ink/10">
                    <td className="px-3 py-2 text-bess-ink/80">{line.date}</td>
                    <td className="px-3 py-2 text-bess-ink/80">{line.category}</td>
                    <td className="px-3 py-2 text-bess-ink/80">
                      {line.direction === "in" ? "Addition" : "Subtraction"}
                    </td>
                    <td className="px-3 py-2 text-right text-bess-ink">
                      {formatAmount(line.amount, statement.tokenSymbol)}
                    </td>
                    <td className="px-3 py-2 text-right text-bess-ink/80">{line.txCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
