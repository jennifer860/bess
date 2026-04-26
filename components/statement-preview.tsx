import { formatAmount, hasNoActivity } from "@/lib/statement-calculations";
import type { StatementData } from "@/types/statement";

type StatementPreviewProps = {
  statement: StatementData | null;
};

export function StatementPreview({ statement }: StatementPreviewProps) {
  if (!statement) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-600">
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
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-semibold text-slate-900">Statement Preview</h2>
        <p className="mt-1 text-sm text-slate-600">
          {statement.network} ({statement.networkHost}) | {statement.startDate} to {statement.endDate}
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">Account Details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Wallet</dt>
              <dd className="break-all text-right font-mono text-slate-900">{statement.walletAddress}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Token</dt>
              <dd className="text-right text-slate-900">{statement.tokenSymbol}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Account Label</dt>
              <dd className="text-right text-slate-900">{statement.accountLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">Accounting Check</h3>
          <p
            className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
              statement.summary.accountingCheckPassed
                ? "bg-emerald-100 text-emerald-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {statement.summary.accountingCheckPassed ? "Passed" : "Failed"}
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Beginning balance + additions - subtractions = ending balance
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-900 text-left text-white">
              <th className="px-3 py-2 font-medium">Account Activity Summary</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map(([label, value]) => (
              <tr key={label} className="border-b border-slate-200">
                <td className="px-3 py-2 text-slate-700">{label}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-900">
                  {formatAmount(Number(value), statement.tokenSymbol)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">Daily Transaction Details</h3>
        </div>
        {hasNoActivity(statement) ? (
          <p className="px-4 py-5 text-sm font-medium text-slate-700">No Activity During Month</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
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
                  <tr key={`${line.date}-${line.category}-${index}`} className="border-t border-slate-200">
                    <td className="px-3 py-2 text-slate-700">{line.date}</td>
                    <td className="px-3 py-2 text-slate-700">{line.category}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {line.direction === "in" ? "Addition" : "Subtraction"}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-900">
                      {formatAmount(line.amount, statement.tokenSymbol)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">{line.txCount}</td>
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
