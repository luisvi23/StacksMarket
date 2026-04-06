import { describe, it, expect } from "vitest";
import { U, principal, addr, cvToUint, logHeader, callOk, view, unwrapQuote } from "./helpers";

const MARKET = "market-factory-v5-2";
const SBTC   = "sbtc-v3";
const ADMIN  = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";

const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);

describe("05 - pause/unpause and add-liquidity keeps b fixed", () => {
  it("pause -> buy fails (u720); unpause -> buy ok; add-liquidity increases pool and keeps b fixed", () => {
    logHeader("05 - pause & add-liquidity");

    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const M  = 14;
    const LIQ = 100_000;

    // seed & create
    callOk(SBTC, "mint", [toU(LIQ + 50_000), toP(ADMIN)], d);
    callOk(SBTC, "mint", [toU(1_000_000), toP(w1)], d);
    callOk(MARKET, "create-market", [toU(M), toU(LIQ)], ADMIN);

    // pause
    callOk(MARKET, "pause", [toU(M)], ADMIN);

    // paused buy attempt -> u720
    const tryBuy = (globalThis as any).simnet.callPublicFn(MARKET, "buy-yes", [toU(M), toU(1000)], w1);
    expect(tryBuy.result.type).toBe("err");
    expect(cvToUint(tryBuy.result.value)).toBe(720);

    // unpause and buy auto
    callOk(MARKET, "unpause", [toU(M)], ADMIN);
    const q = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M), toU(1000)], w1));
    callOk(MARKET, "buy-yes-auto", [toU(M), toU(1000), toU(1_000_000_000), toU(q.total)], w1);

    // add-liquidity -> pool up and b unchanged (only allowed while market is open)
    const b1    = cvToUint(view(MARKET, "get-b",    [toU(M)], d).result);
    const pool1 = cvToUint(view(MARKET, "get-pool", [toU(M)], d).result);

    callOk(MARKET, "add-liquidity", [toU(M), toU(50_000)], ADMIN);

    const b2    = cvToUint(view(MARKET, "get-b",    [toU(M)], d).result);
    const pool2 = cvToUint(view(MARKET, "get-pool", [toU(M)], d).result);

    expect(b2).toBe(b1);                // b is fixed
    expect(pool2).toBe(pool1 + 50_000); // pool += amount
  });
});
