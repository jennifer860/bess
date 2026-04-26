# CryptoStatements.xyz Progress

## Current status

The app is live on Vercel and connected to GitHub. It supports:

- Single-page statement builder UI
- Mock and live data source modes
- Statement preview with accounting check
- PDF export in statement format
- CryptoStatements branding and metadata

## What has been implemented

### UI and UX

- Form inputs: network, wallet address, token symbol, start date, end date
- Data source selector: `Mock Data` or `Live Subscan API`
- Wallet input updated for full 42-character EVM addresses (no shortened defaults)
- Clear error messaging for API and validation failures

### Mock mode

- Two mock scenarios:
  - Activity scenario (Feb 2025)
  - No activity scenario (Jun 2022)
- Preview and PDF both use the same typed statement model

### Live Subscan mode (Moonbeam-first)

- API key stays server-side in `SUBSCAN_API_KEY`
- Uses live endpoints for:
  - Balance history snapshots
  - Transfers
  - Reward/slash data
  - Extrinsics/fees/proxy activity
  - EVM transactions
  - ERC-20 transfers
  - EVM NFT transfer stream (counted as EVM activity)
- Pagination added to avoid Subscan `offset` limit errors

### Deployment and project setup

- Repo: `jennifer860/bess`
- Vercel project relinked to `bess`
- Production alias currently points to: `https://bess-nine.vercel.app`

## Known limitations / next steps

1. **Cross-check totals against explorer UI**
   - Validate category math against Moonbeam/Subscan for several wallets and periods.
2. **Reward model refinement**
   - Confirm all reward-like events needed for accounting classification.
3. **Category normalization**
   - Improve handling of mixed units (e.g. ERC-20 token decimals vs native GLMR).
4. **Performance**
   - Add caching and bounded pagination windows for very active wallets.
5. **Auditability**
   - Add downloadable CSV/source transaction appendix in PDF.

## Operational note

- Keep `.env.local` out of git (already ignored).
- If API key was ever shared in chat, rotate it in Subscan and update Vercel env vars.
