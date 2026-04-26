"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { StatementData } from "@/types/statement";
import { formatAmount } from "@/lib/statement-calculations";

function groupLinesByDate(statement: StatementData) {
  const grouped = new Map<string, StatementData["detailLines"]>();

  for (const line of statement.detailLines) {
    const list = grouped.get(line.date) ?? [];
    list.push(line);
    grouped.set(line.date, list);
  }

  return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function downloadStatementPdf(statement: StatementData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("BESS - Blockchain Explorer Simple Statement", margin, 54);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("100 Ledger Avenue, Suite 1200", margin, 72);
  doc.text("Wilmington, DE 19801, United States", margin, 86);
  doc.text(`Generated: ${new Date(statement.generatedAt).toLocaleString()}`, margin, 100);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Crypto Account Statement", pageWidth - margin, 54, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Statement Period: ${statement.startDate} to ${statement.endDate}`, pageWidth - margin, 72, {
    align: "right",
  });
  doc.text(`Network: ${statement.network} (${statement.networkHost})`, pageWidth - margin, 86, {
    align: "right",
  });
  doc.text(`Wallet: ${statement.walletAddress}`, pageWidth - margin, 100, { align: "right" });

  autoTable(doc, {
    startY: 128,
    head: [["Account Activity Summary", "Amount"]],
    body: [
      ["Beginning Balance", formatAmount(statement.summary.beginningBalance, statement.tokenSymbol)],
      ["Incoming Transfers", formatAmount(statement.summary.incomingTransfers, statement.tokenSymbol)],
      ["Reward Income", formatAmount(statement.summary.rewardIncome, statement.tokenSymbol)],
      ["Outgoing Transfers", formatAmount(statement.summary.outgoingTransfers, statement.tokenSymbol)],
      ["Fees", formatAmount(statement.summary.fees, statement.tokenSymbol)],
      ["Total Activity", formatAmount(statement.summary.totalActivity, statement.tokenSymbol)],
      ["Ending Balance", formatAmount(statement.summary.endingBalance, statement.tokenSymbol)],
    ],
    styles: { font: "helvetica", fontSize: 10 },
    headStyles: { fillColor: [42, 41, 43], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 14
      : 360,
    head: [["Notes"]],
    body: statement.notes.map((note) => [note]),
    styles: { font: "helvetica", fontSize: 9 },
    headStyles: { fillColor: [37, 105, 206], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Daily Transaction Details", margin, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  if (statement.detailLines.length === 0) {
    doc.text("No Activity During Month", margin, 74);
  } else {
    for (const [date, lines] of groupLinesByDate(statement)) {
      autoTable(doc, {
        startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
          ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 10
          : 62,
        head: [[`Date: ${date}`, "Type", "Direction", "Amount", "Tx Count", "Notes"]],
        body: lines.map((line) => [
          "",
          line.category,
          line.direction === "in" ? "Addition" : "Subtraction",
          formatAmount(line.amount, statement.tokenSymbol),
          line.txCount.toString(),
          line.notes ?? "",
        ]),
        styles: { font: "helvetica", fontSize: 9 },
        headStyles: { fillColor: [42, 41, 43], textColor: 255 },
        margin: { left: margin, right: margin },
      });
    }
  }

  const fileName = `crypto-statement-${statement.network.toLowerCase()}-${statement.startDate}-to-${statement.endDate}.pdf`;
  doc.save(fileName);
}
