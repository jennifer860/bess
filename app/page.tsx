"use client";

import Image from "next/image";
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
  walletAddress: "0x54d91ff83f48837a113ef60db336e3b3cc05a6c1",
  tokenSymbol: "GLMR",
  ...ACTIVITY_PERIOD,
};

export default function Home() {
  const [input, setInput] = useState<StatementInput>(DEFAULT_INPUT);
  const [source, setSource] = useState<"mock" | "live">("mock");
  const [scenario, setScenario] = useState<"activity" | "no-activity">("activity");
  const [statement, setStatement] = useState<StatementData | null>(
    getMockStatementData(DEFAULT_INPUT, "activity"),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleScenarioChange(nextScenario: "activity" | "no-activity") {
    const period = nextScenario === "activity" ? ACTIVITY_PERIOD : NO_ACTIVITY_PERIOD;
    setScenario(nextScenario);
    setInput((prev) => ({ ...prev, ...period }));
  }

  async function handleGeneratePreview() {
    setErrorMessage(null);

    if (source === "mock") {
      setStatement(getMockStatementData(input, scenario));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { statement?: StatementData; error?: string };

      if (!response.ok || !payload.statement) {
        throw new Error(payload.error ?? "Failed to generate live statement.");
      }

      setStatement(payload.statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <header className="mb-8 rounded-2xl bg-slate-900 px-6 py-8 text-white shadow-lg">
          <div className="inline-flex rounded-lg bg-black/30 p-2">
            <Image
              src="/cryptostatements-logo.png"
              alt="CryptoStatements.xyz logo"
              width={430}
              height={80}
              priority
              className="h-auto w-[280px] md:w-[360px]"
            />
          </div>
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
              source={source}
              isLoading={isLoading}
              onChange={setInput}
              onSourceChange={setSource}
              onScenarioChange={handleScenarioChange}
              onGenerate={handleGeneratePreview}
            />

            {errorMessage ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}

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
