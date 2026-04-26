"use client";

import { MOONBEAM_EARLIEST_STATEMENT_DATE } from "@/lib/chain-constants";
import type { StatementInput } from "@/types/statement";

type StatementFormProps = {
  value: StatementInput;
  isLoading: boolean;
  onChange: (next: StatementInput) => void;
  onGenerate: () => void;
};

const NETWORK_OPTIONS = ["Moonbeam", "Astar", "Polkadot", "Kusama"];

export function StatementForm({ value, isLoading, onChange, onGenerate }: StatementFormProps) {
  return (
    <section className="w-full min-w-0 rounded-2xl border border-bess-ink/10 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-bess-ink">Build Statement</h2>
      <p className="mt-1 text-sm text-bess-ink/75">Fill the details below. Data is loaded from the live Subscan API.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-bess-ink">
          Network
          <select
            className="rounded-lg border border-bess-ink/20 bg-white px-3 py-2 text-bess-ink"
            value={value.network}
            onChange={(event) => onChange({ ...value, network: event.target.value })}
          >
            {NETWORK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-bess-ink">
          Token Symbol
          <input
            className="rounded-lg border border-bess-ink/20 px-3 py-2 text-bess-ink"
            value={value.tokenSymbol}
            onChange={(event) => onChange({ ...value, tokenSymbol: event.target.value.toUpperCase() })}
            placeholder="GLMR"
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1 text-sm text-bess-ink md:col-span-2">
          Wallet Address
          <input
            className="w-full min-w-0 rounded-lg border border-bess-ink/20 px-3 py-2 font-mono text-sm text-bess-ink"
            value={value.walletAddress}
            onChange={(event) => onChange({ ...value, walletAddress: event.target.value })}
            placeholder="0x54d91ff83f48837a113ef60db336e3b3cc05a6c1"
            maxLength={42}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-bess-ink">
          Start Date
          <input
            type="date"
            className="rounded-lg border border-bess-ink/20 px-3 py-2 text-bess-ink"
            value={value.startDate}
            min={value.network === "Moonbeam" ? MOONBEAM_EARLIEST_STATEMENT_DATE : undefined}
            onChange={(event) => onChange({ ...value, startDate: event.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-bess-ink">
          End Date
          <input
            type="date"
            className="rounded-lg border border-bess-ink/20 px-3 py-2 text-bess-ink"
            value={value.endDate}
            min={value.network === "Moonbeam" ? MOONBEAM_EARLIEST_STATEMENT_DATE : undefined}
            onChange={(event) => onChange({ ...value, endDate: event.target.value })}
          />
        </label>
      </div>

      <button
        type="button"
        className="mt-6 rounded-lg bg-bess-ink px-5 py-2.5 text-sm font-medium text-bess-mist hover:bg-bess-ink/90"
        onClick={onGenerate}
        disabled={isLoading}
      >
        {isLoading ? "Loading..." : "Generate Preview"}
      </button>
    </section>
  );
}
