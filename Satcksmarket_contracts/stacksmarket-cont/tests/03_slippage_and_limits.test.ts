import { describe, it, expect } from "vitest";
import {
  U, principal, addr, cvToUint,
  logHeader, logSection, callOk, view, unwrapQuote,
  printBalances, printMarketState, getSelfPrincipal, MARKET, SBTC
} from "./helpers";

/**
 * DESCRIPTION
 * In m=12:
 * - Set max-trade=1000.
 * - A buy-yes of 5000 fails with u722 (per-trade limit).
 * - A buy-yes-auto with total-1 fails with u732 (slippage too tight).
 * - Logs TXs, state and basic balances.
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);

describe("03 - slippage & max-trade", () => {
  it("Rejects trade > max (u722) and too-tight slippage (u732)", () => {
    logHeader("03 - slippage & max-trade",
      "In m=12, set max-trade=1000; a buy-yes 5000 fails u722; then a slippage guard total-1 fails u732.");

    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const M  = 12;
    const LIQ = 80_000;

    // --- Seed & create ---
    logSection("Seed & create");
    callOk(SBTC, "mint", [toU(LIQ), toP(ADMIN)], d);
    callOk(SBTC, "mint", [toU(1_000_000), toP(w1)], d);
    callOk(MARKET, "create-market", [toU(M), toU(LIQ)], ADMIN);
    const SELF = getSelfPrincipal();
    printBalances("after create", [ADMIN, w1, SELF]);
    printMarketState(M, d);

    // --- Limit ---
    logSection("Set max-trade=1000");
    callOk(MARKET, "set-max-trade", [toU(M), toU(1_000)], ADMIN);

    // --- Oversized -> u722 ---
    logSection("Oversized buy -> u722");
    const big = (globalThis as any).simnet.callPublicFn(MARKET, "buy-yes", [toU(M), toU(5_000)], w1);
    expect(big.result.type).toBe("err");
    expect(cvToUint(big.result.value)).toBe(722);

    // --- Slippage tight -> u732 ---
    logSection("Slippage tight -> u732");
    const q = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M), toU(1_000)], w1));
    const tight = (globalThis as any).simnet.callPublicFn(
      MARKET, "buy-yes-auto",
      [toU(M), toU(1_000), toU(1_000_000), toU(q.total - 1)], w1
    );
    expect(tight.result.type).toBe("err");
    expect(cvToUint(tight.result.value)).toBe(732);

    printMarketState(M, d);
  });
});
