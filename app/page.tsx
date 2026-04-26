"use client";

import Image from "next/image";
import { useState } from "react";
import { StatementForm } from "@/components/statement-form";
import { StatementPreview } from "@/components/statement-preview";
import { downloadStatementPdf } from "@/lib/pdf-generator";
import type { StatementData, StatementInput } from "@/types/statement";

const DEFAULT_INPUT: StatementInput = {
  network: "Moonbeam",
  walletAddress: "0x54d91ff83f48837a113ef60db336e3b3cc05a6c1",
  tokenSymbol: "GLMR",
  startDate: "2025-02-01",
  endDate: "2025-02-28",
};

function parseStatementApiPayload(
  text: string,
  response: Response,
): { statement?: StatementData; error?: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as { statement?: StatementData; error?: string };
    } catch {
      /* fall through to HTML / plain text handling */
    }
  }

  const flat = text.replace(/\s+/g, " ").trim();
  const looksTimeout =
    /error occurred|function.*(duration|limit|timeout)|request timed out|502|503|504|bad gateway|gateway time-out/i.test(
      text,
    ) || [502, 503, 504].includes(response.status);

  if (looksTimeout) {
    throw new Error(
      "The live statement request took too long or the server cut it off (HTML error instead of data). " +
        "This often happens when the API hits the platform’s time limit. Try a shorter date range, " +
        "or increase the serverless `maxDuration` for `/api/statement` in production.",
    );
  }

  const snippet = flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
  throw new Error(
    `The server did not return JSON (${response.status}). ${snippet || "Empty response."}`,
  );
}

export default function Home() {
  const [input, setInput] = useState<StatementInput>(DEFAULT_INPUT);
  const [statement, setStatement] = useState<StatementData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleGeneratePreview() {
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const response = await fetch("/api/statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const raw = await response.text();
      const payload = parseStatementApiPayload(raw, response);

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
    <div className="min-h-screen bg-bess-mist">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <header className="mb-8 rounded-2xl border border-bess-ink/10 bg-bess-mist px-6 py-8 text-bess-ink shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="shrink-0 rounded-xl border border-bess-ink/10 bg-white p-3">
              <Image
                src="/favicon.png"
                alt="BESS logo"
                width={64}
                height={64}
                priority
                className="h-16 w-16"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold md:text-4xl">
                BESS - Blockchain Explorer Simple Statement
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-bess-ink/85 md:text-base">
                Generate professional account statement previews and export bank-style PDFs from
                live Subscan data for your wallet and selected period.
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-4">
            <StatementForm value={input} isLoading={isLoading} onChange={setInput} onGenerate={handleGeneratePreview} />

            {errorMessage ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}

            <button
              type="button"
              className="w-full rounded-lg bg-bess-blue px-5 py-3 text-sm font-medium text-white hover:bg-bess-blue/90"
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
