"use client";

import { useState } from "react";
import { StatementForm } from "@/components/statement-form";
import { StatementPreview } from "@/components/statement-preview";
import { getMockStatementData } from "@/lib/mock-statement-service";
import { downloadStatementPdf } from "@/lib/pdf-generator";
import type { StatementData, StatementInput } from "@/types/statement";

const ACTIVITY_PERIOD = { startDate: "2025-02-01", endDate: "2025-02-28" };
const NO_ACTIVITY_PERIOD = { startDate: "2022-06-01", endDate: "2022-06-30" };

const DEFAULT_INPUT: StatementInput = {
  network: "Moonbeam",
  walletAddress: "0x49A5...8aC2",
  tokenSymbol: "GLMR",
  ...ACTIVITY_PERIOD,
};

export default function Home() {
  const [input, setInput] = useState<StatementInput>(DEFAULT_INPUT);
  const [scenario, setScenario] = useState<"activity" | "no-activity">("activity");
  const [statement, setStatement] = useState<StatementData | null>(
    getMockStatementData(DEFAULT_INPUT, "activity"),
  );

  function handleScenarioChange(nextScenario: "activity" | "no-activity") {
    const period = nextScenario === "activity" ? ACTIVITY_PERIOD : NO_ACTIVITY_PERIOD;
    setScenario(nextScenario);
    setInput((prev) => ({ ...prev, ...period }));
  }

  function handleGeneratePreview() {
    setStatement(getMockStatementData(input, scenario));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <header className="mb-8 rounded-2xl bg-slate-900 px-6 py-8 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">CryptoStatements.xyz</p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">Blockchain Account Statement Builder</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-200 md:text-base">
            Generate professional crypto account statement previews and export bank-statement-style PDFs
            from Subscan-style data. This first version uses mock data only.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            <StatementForm
              value={input}
              scenario={scenario}
              onChange={setInput}
              onScenarioChange={handleScenarioChange}
              onGenerate={handleGeneratePreview}
            />

            <button
              type="button"
              className="w-full rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-500"
              onClick={() => {
                if (statement) {
                  downloadStatementPdf(statement);
                }
              }}
            >
              Download Statement PDF
            </button>
          </div>

          <StatementPreview statement={statement} />
        </div>
      </main>
    </div>
  );
}
