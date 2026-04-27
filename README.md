# BESS (Blockchain Explorer Simple Statement)

BESS is a hackathon project that turns raw Moonbeam wallet activity into clear, bank-style GLMR account statements.

Instead of manually piecing together explorer pages, users can enter a wallet + date range, generate a reconciled preview, and download a professional PDF statement in one flow.

## Problem

Blockchain explorers are powerful but not statement-friendly. For most users, it is hard to quickly answer:

- What was my beginning and ending balance for this period?
- What came in, what went out, and what was paid in fees?
- Can I export this in a format that looks like a real statement?

## Solution

BESS provides a simple statement builder that:

- Pulls live Moonbeam data server-side from Subscan
- Normalizes activity into statement-ready categories
- Computes summary totals and an accounting check
- Exports a polished PDF with summary + daily details

## Demo flow

1. Enter Moonbeam wallet address, start date, and end date
2. Generate statement preview
3. Review account summary and daily transaction details
4. Confirm accounting check status (pass/fail)
5. Download statement PDF

## Where we landed (hackathon outcome)

- **Built and deployable:** end-to-end app on Next.js with Vercel-ready config
- **Moonbeam-first live mode:** GLMR statement generation from Subscan data
- **Data coverage:** balance history, transfers, reward/slash, extrinsics, EVM tx, ERC-20 transfers, NFT transfer activity
- **Quality checks:** summary reconciliation and explicit accounting check output
- **Usable output:** preview UI plus downloadable statement PDF

For implementation notes and follow-up ideas, see `docs/progress.md`.

## Impact

- Makes Moonbeam wallet activity understandable to non-technical users
- Reduces manual reconciliation work for reporting and review
- Demonstrates a practical bridge between on-chain data and familiar financial documents

## Tech stack

- `next` 16
- `react` 19
- `typescript`
- `tailwindcss` 4
- `jspdf` + `jspdf-autotable`
- `@polkadot/api`

## Getting started

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
SUBSCAN_API_KEY=your_subscan_key_here
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Available scripts

- `npm run dev` - start local dev server
- `npm run build` - build production bundle
- `npm run start` - run production server
- `npm run lint` - run ESLint
- `npm run debug:subscan` - debug Subscan balance behavior
- `npm run debug:system-account` - debug Moonbeam system account totals

## Project structure

- `app/page.tsx` - main UI and request flow
- `app/api/statement/route.ts` - server API endpoint for live statement generation
- `components/statement-form.tsx` - statement input form
- `components/statement-preview.tsx` - preview tables and PDF action
- `lib/subscan-statement-service.ts` - live statement assembly and reconciliation logic
- `lib/subscan-client.ts` - Subscan API client helpers and pagination
- `lib/pdf-generator.ts` - statement PDF creation
- `lib/statement-calculations.ts` - summary math and accounting checks
- `types/statement.ts` - shared TypeScript models

## Deployment

Deploy on Vercel by connecting this repository and setting `SUBSCAN_API_KEY` in project environment variables.
