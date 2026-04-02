import { describe, it, expect } from "vitest";
import {
  U, principal, addr, cvToUint, logHeader, logSection, callOk, view, unwrapQuote, Cl, log,
  printBalances, printMarketState, getSelfPrincipal, getFeeRecipients, MARKET, SBTC
} from "./helpers";

/**
 * DESCRIPTION
 * In m=13:
 * - YES (w1) and NO (w2) buys.
 * - Resolve => YES (with on-chain solvency check).
 * - Winner (w1) redeems at UNIT-per-share; pool decreases exactly by payout.
 * - If winning supply is 0, admin can withdraw-surplus.
 * - Logs: TXs, quotes, balances (w1, w2, SELF, recipients) and market state before/after.
 *
 * NOTE: Contracts have UNIT = 100 (6 decimals scale). So payout = shares * 100.
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);
const strAscii = (Cl as any).stringAscii ? (s: string) => (Cl as any).stringAscii(s) : (s: string) => (Cl as any).stringAsciiCV(s);

describe("04 - resolve, redeem at UNIT and withdraw-surplus", () => {
  it("YES wins; winner redeems at UNIT; pool decreases by payout; surplus withdraw when winner supply = 0", () => {
    logHeader("04 - resolve & redeem & surplus",
      "In m=13 buy YES/NO, resolve YES, winner redeems (UNIT per share), then withdraw surplus if no winning supply remains.");

    const d  = addr("deployer");
    const w1 = addr("wallet_1"); // YES
    const w2 = addr("wallet_2"); // NO
    const M  = 13;

    // IMPORTANT: With UNIT=100, ensure pool >= YES_shares * 100 at resolve.
    // Use LIQ big enough, or small share buys. We choose LIQ=200_000 and YES=1_000 (payout=100_000).
    const LIQ = 200_000;

    // --- Seed & create ---
    logSection("Seed & create");
    callOk(SBTC, "mint", [toU(LIQ), toP(ADMIN)], d);
    callOk(SBTC, "mint", [toU(1_000_000), toP(w1)], d);
    callOk(SBTC, "mint", [toU(1_000_000), toP(w2)], d);
    callOk(MARKET, "create-market", [toU(M), toU(LIQ)], ADMIN);

    const SELF = getSelfPrincipal();
    const recipients = getFeeRecipients();
    printBalances("after create", [ADMIN, w1, w2, SELF, recipients.drip, recipients.brc20, recipients.team, recipients.lp].filter(Boolean));
    printMarketState(M, d);

    // --- Pre-resolution buys ---
    logSection("Pre-resolution buys");
    const qY = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M), toU(1_000)], w1));  // YES = 1k shares
    callOk(MARKET, "buy-yes-auto", [toU(M), toU(1_000), toU(1_000_000_000), toU(qY.total)], w1, "w1 YES");
    const qN = unwrapQuote(view(MARKET, "quote-buy-no", [toU(M), toU(600)], w2));     // NO  = 600 shares
    callOk(MARKET, "buy-no-auto", [toU(M), toU(600), toU(1_000_000_000), toU(qN.total)], w2, "w2 NO");
    printBalances("post-buys", [w1, w2, SELF, recipients.drip, recipients.brc20, recipients.team, recipients.lp].filter(Boolean));
    const before = printMarketState(M, d);

    // --- Resolve YES (solvency check applies: pool >= YES_supply * UNIT) ---
    logSection("Resolve => YES");
    callOk(MARKET, "resolve", [toU(M), strAscii("YES")], ADMIN);

    // --- Winner redeem ---
    logSection("Winner redeem (w1)");
    const yesBal = cvToUint(view(MARKET, "get-yes-balance", [toU(M), toP(w1)], w1).result);
    expect(yesBal).toBeGreaterThan(0);

    const redeem = (globalThis as any).simnet.callPublicFn(MARKET, "redeem", [toU(M)], w1);
    expect(redeem.result.type).toBe("ok");
    const payout = cvToUint(redeem.result.value);
    // UNIT = 100 in the contract, so payout must be shares * 100
    expect(payout).toBe(yesBal * 100);

    printBalances("post-redeem", [w1, SELF]);
    const after = printMarketState(M, d);
    expect(after.pool).toBe(before.pool - payout);

    // --- Loser cannot redeem ---
    logSection("Loser tries to redeem (must fail)");
    const lose = (globalThis as any).simnet.callPublicFn(MARKET, "redeem", [toU(M)], w2);
    expect(lose.result.type).toBe("err");

    // --- Surplus ---
    logSection("Withdraw-surplus if no YES remaining");
    const ys = cvToUint(view(MARKET, "get-yes-supply", [toU(M)], d).result);
    if (ys === 0) {
      const wd = (globalThis as any).simnet.callPublicFn(MARKET, "withdraw-surplus", [toU(M)], ADMIN);
      expect(wd.result.type).toBe("ok");
      printBalances("post-withdraw", [ADMIN, SELF]);
      printMarketState(M, d);
    }
  });
});
