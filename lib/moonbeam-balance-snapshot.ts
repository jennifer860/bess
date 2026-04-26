import type { StatementInput } from "@/types/statement";
import { resolveEvmBlockForStatementBookend, tryMoonbeamGlmrAtEvmBlockRpc } from "@/lib/subscan-client";

/**
 * First second **after** `YYYY-MM-DD` in UTC (next day 00:00:00). Used with
 * “largest block before this instant” = last block that is still on the given calendar day.
 */
function startOfNextCalendarDayUtcSeconds(yyyyMmDd: string) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

/**
 * One input date → one GLMR number via EVM `eth_getBalance` at a resolved block. On Moonbeam that
 * is **reducible** (MetaMask-style), not total (staked) GLMR. For “total in wallet as of date” use
 * Subscan `balance_history` (see live statement) instead of this helper.
 */
export async function getMoonbeamGlmrAsOfEndOfCalendarDayUtc(
  input: StatementInput,
  apiKey: string,
  calendarDay: string,
): Promise<{ glmr: number | null; evmBlock: number | null }> {
  if (input.network !== "Moonbeam") {
    return { glmr: null, evmBlock: null };
  }
  const endInstant = startOfNextCalendarDayUtcSeconds(calendarDay);
  const evmBlock = await resolveEvmBlockForStatementBookend(input, apiKey, endInstant);
  if (evmBlock == null) {
    return { glmr: null, evmBlock: null };
  }
  const glmr = await tryMoonbeamGlmrAtEvmBlockRpc(input, evmBlock);
  return { glmr, evmBlock };
}
