"use client";

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { StatementData } from "@/types/statement";
import { formatPdfAmount } from "@/lib/statement-calculations";

type JsPdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

function getFinalY(doc: jsPDF): number | undefined {
  return (doc as JsPdfWithAutoTable).lastAutoTable?.finalY;
}

const LOGO_W_PT = 92;
const LOGO_H_PT = (LOGO_W_PT * 193) / 1024;
const LOGO_Y_OFFSET_PT = -6;

async function fetchLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/cryptostatements-logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function drawLogo(doc: jsPDF, logoDataUrl: string | null, margin: number) {
  if (!logoDataUrl) return;
  try {
    doc.addImage(logoDataUrl, "PNG", margin, margin + LOGO_Y_OFFSET_PT, LOGO_W_PT, LOGO_H_PT);
  } catch {
    /* optional */
  }
}

function groupLinesByDate(statement: StatementData) {
  const grouped = new Map<string, StatementData["detailLines"]>();

  for (const line of statement.detailLines) {
    const list = grouped.get(line.date) ?? [];
    list.push(line);
    grouped.set(line.date, list);
  }

  return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export async function downloadStatementPdf(statement: StatementData) {
  const logo = await fetchLogoDataUrl();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();

  drawLogo(doc, logo, margin);
  const headerTop = margin + LOGO_H_PT + 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("100 Ledger Avenue, Suite 1200", margin, headerTop);
  doc.text("Wilmington, DE 19801, United States", margin, headerTop + 14);
  doc.text(`Generated: ${new Date(statement.generatedAt).toLocaleString()}`, margin, headerTop + 28);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Crypto Account Statement", pageWidth - margin, margin + 8, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Statement Period: ${statement.startDate} to ${statement.endDate}`, pageWidth - margin, margin + 26, {
    align: "right",
  });
  doc.text(`Network: ${statement.network} (${statement.networkHost})`, pageWidth - margin, margin + 40, {
    align: "right",
  });

  const walletBlockWidth = Math.min(pageWidth - 2 * margin - 100, 280);
  const walletLines = doc.splitTextToSize(`Wallet: ${statement.walletAddress}`, walletBlockWidth);
  let rightY = margin + 54;
  doc.text(walletLines, pageWidth - margin, rightY, { align: "right" });
  rightY += walletLines.length * 12 + 2;
  doc.text(`Token: ${statement.tokenSymbol}`, pageWidth - margin, rightY, { align: "right" });

  const tableStartY = Math.max(headerTop + 40, rightY + 24);

  const continuationLogo = (data: { pageNumber: number; doc: jsPDF }) => {
    if (data.pageNumber > 1) {
      drawLogo(data.doc, logo, margin);
    }
  };

  autoTable(doc, {
    startY: tableStartY,
    head: [["Account Activity Summary", "Amount"]],
    body: [
      ["Beginning Balance", formatPdfAmount(statement.summary.beginningBalance)],
      ["Incoming Transfers", formatPdfAmount(statement.summary.incomingTransfers)],
      ["Reward Income", formatPdfAmount(statement.summary.rewardIncome)],
      ["Outgoing Transfers", formatPdfAmount(-Math.abs(statement.summary.outgoingTransfers))],
      ["Fees", formatPdfAmount(-Math.abs(statement.summary.fees))],
      ["Total Activity", formatPdfAmount(statement.summary.totalActivity)],
      ["Ending Balance", formatPdfAmount(statement.summary.endingBalance)],
    ],
    styles: { font: "helvetica", fontSize: 10 },
    headStyles: { fillColor: [42, 41, 43], textColor: 255 },
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "right" },
    },
    margin: { left: margin, right: margin },
    didDrawPage: continuationLogo,
  });

  autoTable(doc, {
    startY: (getFinalY(doc) ?? tableStartY) + 14,
    head: [["Notes"]],
    body: statement.notes.map((note) => [note]),
    styles: { font: "helvetica", fontSize: 9 },
    headStyles: { fillColor: [37, 105, 206], textColor: 255 },
    margin: { left: margin, right: margin },
    didDrawPage: continuationLogo,
  });

  doc.addPage();
  drawLogo(doc, logo, margin);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  const dailyTitleY = margin + LOGO_H_PT + 6;
  doc.text("Daily Transaction Details", margin, dailyTitleY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  if (statement.detailLines.length === 0) {
    doc.text("No Activity During Month", margin, dailyTitleY + 18);
  } else {
    const groups = groupLinesByDate(statement);
    const body: string[][] = [];
    const drawSeparatorAboveRow: boolean[] = [];
    let rowIdx = 0;
    for (const [, lines] of groups) {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        drawSeparatorAboveRow.push(rowIdx > 0 && i === 0);
        body.push([
          i === 0 ? line.date : "",
          line.category,
          line.direction === "in" ? "Addition" : "Subtraction",
          formatPdfAmount(line.direction === "out" ? -Math.abs(line.amount) : line.amount),
          String(line.txCount),
        ]);
        rowIdx += 1;
      }
    }

    autoTable(doc, {
      startY: dailyTitleY + 14,
      head: [["Date", "Type", "Direction", "Amount", "Tx Count"]],
      body,
      showHead: "everyPage",
      styles: { font: "helvetica", fontSize: 9 },
      headStyles: { fillColor: [42, 41, 43], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 72 },
        1: { cellWidth: "auto" },
        2: { cellWidth: 72 },
        3: { halign: "right", cellWidth: 88 },
        4: { halign: "right", cellWidth: 48 },
      },
      margin: { left: margin, right: margin },
      didDrawPage: continuationLogo,
      willDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 0) return;
        const idx = data.row.index;
        if (!drawSeparatorAboveRow[idx]) return;
        const d = data.doc;
        const y = data.cell.y;
        d.setDrawColor(210, 210, 210);
        d.setLineWidth(0.5);
        d.line(margin, y, pageWidth - margin, y);
      },
    });
  }

  const fileName = `crypto-statement-${statement.network.toLowerCase()}-${statement.startDate}-to-${statement.endDate}.pdf`;
  doc.save(fileName);
}
