// tests/07_invariants_stress_multi_markets_v5.test.ts
import { describe, it, expect } from "vitest";
import {
  MARKET, SBTC, Cl,
  addr, U as toU, principal as toP,
  view, callOk, logHeader, logSection, log, logQuote,
  unwrapQuote, cvToUint, printMarketState, sbtcBalance
} from "./helpers";

/**
 * IMPORTANT
 * Make sure MARKET points to "market-factory-v5-2" and SBTC to "sbtc-v3".
 * If your helpers allow overriding, uncomment:
 *   (globalThis as any).setMarketContract?.("market-factory-v5-2");
 *   (globalThis as any).setSbtcContract?.("sbtc-v3");
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";

// Some helpers local to this test
function getCV(res: any) {
  return res && typeof res === "object" && "result" in res ? res.result : res;
}

function getUnit(sender: string) {
  // v5 doesn't expose get-unit; default UNIT is 100, so fallback to 100 if view fails
  try {
    const r = view(MARKET, "get-unit", [], sender); // if present (future-proof)
    return cvToUint(getCV(r));
  } catch {
    return 100;
  }
}

function ensureSolvent(m: number, winner: "YES" | "NO", d: string) {
  const ys   = cvToUint(getCV(view(MARKET, "get-yes-supply", [toU(m)], d)));
  const ns   = cvToUint(getCV(view(MARKET, "get-no-supply",  [toU(m)], d)));
  const pool = cvToUint(getCV(view(MARKET, "get-pool",       [toU(m)], d)));
  const UNIT = getUnit(d);
  const need = BigInt(winner === "YES" ? ys : ns) * BigInt(UNIT);
  if (BigInt(pool) < need) {
    const shortfall = Number(need - BigInt(pool));
    // Top-up ADMIN and add-liquidity until pool >= need
    callOk(SBTC,   "mint",           [toU(shortfall), toP(ADMIN)], d);
    callOk(MARKET, "add-liquidity",  [toU(m), toU(shortfall)],     ADMIN);
  }
}

describe("07 - v5 invariants (fixed-b, pre-balance check) & multi-market stress + redemption", () => {
  it("Happy path on two markets, fixed-b invariant, strict slippage (u732), redemption math (UNIT), withdraw-surplus", () => {
    logHeader(
      "07 - v5 invariants & stress (m=21, m=22)",
      "Pool grows on buys, add-liquidity does not change b, strict slippage u732, redemption = shares * UNIT, and surplus withdrawal."
    );

    // ======== Setup addresses ========
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");
    const w5 = addr("wallet_5");

    // ======== Market 21 ========
    const M1   = 21;
    const LIQ1 = 180_000;

    // fund users for buys and admin for seed
    [w1, w2, w3, w4, w5].forEach(w =>
      callOk(SBTC, "mint", [toU(1_000_000), toP(w)], d)
    );
    callOk(SBTC, "mint", [toU(LIQ1), toP(ADMIN)], d);
    callOk(MARKET, "create-market", [toU(M1), toU(LIQ1)], ADMIN);

    const quoteY1 = (amt: number) => view(MARKET, "quote-buy-yes", [toU(M1), toU(amt)], d);
    const quoteN1 = (amt: number) => view(MARKET, "quote-buy-no",  [toU(M1), toU(amt)], d);

    const poolBeforeAfter: number[] = [];
    const poolNow = () => cvToUint(getCV(view(MARKET, "get-pool", [toU(M1)], d)));

    const buyAuto = (who: string, side: "YES"|"NO", amt: number) => {
      const q = unwrapQuote((side === "YES" ? quoteY1(amt) : quoteN1(amt)).result);
      logQuote(side, amt, q);
      const p0 = poolNow();
      callOk(
        MARKET,
        side === "YES" ? "buy-yes-auto" : "buy-no-auto",
        [toU(M1), toU(amt), toU(1_000_000), toU(q.total)],
        who,
        `${who} ${side} Δ=${amt}`
      );
      const p1 = poolNow();
      poolBeforeAfter.push(p0, p1);
      // pool must be non-decreasing (buys bring base into pool)
      expect(p1).toBeGreaterThanOrEqual(p0);
      printMarketState(M1, d);
    };

    buyAuto(w1, "YES",  6000);
    buyAuto(w2, "NO",   4000);
    buyAuto(w3, "YES", 10000);
    buyAuto(w4, "NO",   7500);
    buyAuto(w5, "YES",  8000);
    buyAuto(w1, "NO",   3000);
    buyAuto(w2, "YES",  5500);
    buyAuto(w3, "NO",   2500);
    buyAuto(w4, "YES",  4000);
    buyAuto(w5, "NO",   4500);

    // add-liquidity keeps b fixed in v5
    const b1    = cvToUint(getCV(view(MARKET, "get-b",    [toU(M1)], d)));
    const pool1 = poolNow();
    const addAmt = 25_000;
    if (sbtcBalance(ADMIN) < addAmt) callOk(SBTC, "mint", [toU(addAmt), toP(ADMIN)], d);
    callOk(MARKET, "add-liquidity", [toU(M1), toU(addAmt)], ADMIN);
    const b2    = cvToUint(getCV(view(MARKET, "get-b",    [toU(M1)], d)));
    const pool2 = poolNow();
    expect(b2).toBe(b1);
    expect(pool2).toBe(pool1 + addAmt);

    // ======== Market 22 ========
    const M2   = 22;
    const LIQ2 = 90_000;

    callOk(SBTC, "mint", [toU(LIQ2), toP(ADMIN)], d);
    [w1, w2, w3].forEach(w => callOk(SBTC, "mint", [toU(200_000), toP(w)], d));
    callOk(MARKET, "create-market", [toU(M2), toU(LIQ2)], ADMIN);

    const q2Y = (amt: number) => view(MARKET, "quote-buy-yes", [toU(M2), toU(amt)], d);
    const q2N = (amt: number) => view(MARKET, "quote-buy-no",  [toU(M2), toU(amt)], d);

    // YES 7000 by w1
    {
      const q = unwrapQuote(q2Y(7000).result); logQuote("YES", 7000, q);
      callOk(MARKET, "buy-yes-auto", [toU(M2), toU(7000), toU(1_000_000), toU(q.total)], w1, "m22 w1 YES 7000");
      printMarketState(M2, d);
    }
    // NO 6000 by w2
    {
      const q = unwrapQuote(q2N(6000).result); logQuote("NO", 6000, q);
      callOk(MARKET, "buy-no-auto", [toU(M2), toU(6000), toU(1_000_000), toU(q.total)], w2, "m22 w2 NO 6000");
      printMarketState(M2, d);
    }
    // Strict slippage (force u732): pass max-cost = quote.total - 1
    {
      const q = unwrapQuote(q2Y(6000).result); logQuote("YES", 6000, q);
      const r = (globalThis as any).simnet.callPublicFn(
        MARKET, "buy-yes-auto",
        [toU(M2), toU(6000), toU(1_000_000), toU(q.total - 1)],
        w3
      );
      expect(r.result.type).toBe("err");
      expect(cvToUint(r.result.value)).toBe(732);
      printMarketState(M2, d);
    }

    // Resolve "NO" with solvency check (on-chain will assert; pre-topup if needed)
    ensureSolvent(M2, "NO", d);
    callOk(MARKET, "resolve", [toU(M2), Cl.stringAscii("NO")], ADMIN);

    // Winner = w2 (NO). Redeem: payout must equal shares * UNIT
    const UNIT = getUnit(d);
    const balNo = cvToUint(getCV(view(MARKET, "get-no-balance", [toU(M2), toP(w2)], w2)));
    const redeem = (globalThis as any).simnet.callPublicFn(MARKET, "redeem", [toU(M2)], w2);
    expect(redeem.result.type).toBe("ok");
    const payout = cvToUint(redeem.result.value);
    expect(payout).toBe(balNo * UNIT);

    // After the sole NO holder redeems, withdraw-surplus should drain pool to 0
    callOk(MARKET, "withdraw-surplus", [toU(M2)], ADMIN);
    const poolM2 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M2)], d)));
    expect(poolM2).toBe(0);
  });

  it("Edge case: insufficient wallet balance pre-check should raise u760", () => {
    logSection("Edge: insufficient wallet balance (ERR-NO-WALLET-BAL u760)");

    const d  = addr("deployer");
    const w6 = addr("wallet_6"); // intentionally do NOT mint enough to w6

    const M3   = 23;
    const LIQ3 = 50_000;

    // Seed admin and create a new market
    callOk(SBTC, "mint", [toU(LIQ3), toP(ADMIN)], d);
    callOk(MARKET, "create-market", [toU(M3), toU(LIQ3)], ADMIN);

    // Give w6 only a tiny balance (less than the total quote)
    callOk(SBTC, "mint", [toU(10), toP(w6)], d);

    // Ask for a quote that will definitely cost more than 10 units
    const q = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M3), toU(1_000)], d).result);
    log("Expected total (>>10):", q.total);

    // Now try to buy with max-cost set to the quote (so no slippage error),
    // but wallet balance is not enough -> should hit ERR-NO-WALLET-BAL (u760)
    const r = (globalThis as any).simnet.callPublicFn(
      MARKET, "buy-yes-auto",
      [toU(M3), toU(1_000), toU(1_000_000), toU(q.total)],
      w6
    );
    expect(r.result.type).toBe("err");
    expect(cvToUint(r.result.value)).toBe(760);  // u760: ERR-NO-WALLET-BAL
  });
});
