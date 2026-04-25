# CryptoStatements.xyz

Create official-looking PDF crypto account statements from Subscan-style blockchain data.

This first version is intentionally simple and beginner-friendly:
- Single-page UI
- Mock statement data (no live Subscan API yet)
- Statement preview + accounting check
- Downloadable PDF output

## Getting Started

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## What is implemented

1. **Landing + form page**
   - Network
   - Wallet address
   - Token symbol
   - Start date / end date
   - Mock scenario toggle (activity vs no activity)
2. **Statement preview**
   - Account details
   - Activity summary
   - Daily transaction rows
   - "No Activity During Month" for empty periods
3. **Mock data service**
   - Activity scenario: Feb 1-28, 2025
   - No activity scenario: Jun 1-30, 2022
4. **PDF generation**
   - First page: statement header + summary + notes
   - Detail page: daily grouped lines by date/type
5. **Subscan integration placeholders**
   - TODO comments in `lib/mock-statement-service.ts`

## Project structure

- `app/page.tsx` - One-page app UI orchestration
- `components/statement-form.tsx` - Input form
- `components/statement-preview.tsx` - Statement preview cards/tables
- `lib/mock-statement-service.ts` - Mock data and scenario logic
- `lib/statement-calculations.ts` - Summary/accounting calculations
- `lib/pdf-generator.ts` - jsPDF output
- `types/statement.ts` - Shared TypeScript models

## Deploy on Vercel

Push to GitHub and import this repository into Vercel for one-click deployment.
