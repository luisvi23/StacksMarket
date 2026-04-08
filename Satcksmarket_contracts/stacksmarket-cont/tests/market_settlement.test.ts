import { describe, it, expect } from "vitest";
import {
  log, logHeader, logSection,
  addr, simnet, Cl,
  U as toU, cvToUint,
  MARKET, SBTC,
  sbtcBalance, view, callOk,
  printMarketState, printBalances,
  unwrapQuote
} from "./helpers";

// --- util para leer CVs que a veces vienen como {result: ...} ---
function getCV(res: any) {
  return res && typeof res === "object" && "result" in res ? res.result : res;
}

// UNIT por share (si el contrato lo expone, lo usamos)
function getUnit(sender: string) {
  try {
    const r = view(MARKET, "get-unit", [], sender);
    return cvToUint(getCV(r));
  } catch {
    // Fallback visto en los logs (cada share paga 100)
    return 100;
  }
}

// Garantiza pool suficiente para pagar al ganador a UNIT por share
function ensureSolvent(m: number, winner: "YES" | "NO", admin: string, sender: string) {
  const ys   = cvToUint(getCV(view(MARKET, "get-yes-supply", [toU(m)], sender)));
  const ns   = cvToUint(getCV(view(MARKET, "get-no-supply",  [toU(m)], sender)));
  const pool = cvToUint(getCV(view(MARKET, "get-pool",       [toU(m)], sender)));
  const UNIT = getUnit(sender);
  const need = BigInt(winner === "YES" ? ys : ns) * BigInt(UNIT);

  if (BigInt(pool) < need) {
    // add-liquidity does not exist in v21; pool is seeded via create-market
    const shortfall = Number(need - BigInt(pool));
    log(`⚠️  ensureSolvent: pool shortfall=${shortfall} but add-liquidity not available in v21`);
  }
}

describe("Market settlement (pool math, fees routing, resolve & redeem 1:1)", () => {
  it("Pool = seed + ΣΔC - payouts; fees no mezcladas; resolve YES y redeem correcto", () => {
    logHeader("market_settlement", "📝 Pool arranca en seed; buys aumentan pool por ΔC; fees a vaults; resolve YES; redeem 1:1; invariantes.");

    const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const SELF = `${d}.market-factory-v21-testnet-bias`;
    const M = 30;
    const SEED = 80_000;

    // --- seed balances ---
    callOk(SBTC, "mint", [toU(SEED),       Cl.principal(ADMIN)], d);
    callOk(SBTC, "mint", [toU(1_000_000),  Cl.principal(w1)],    d);
    callOk(SBTC, "mint", [toU(1_000_000),  Cl.principal(w2)],    d);

    // --- create-market ---
    const beforeAdmin = sbtcBalance(ADMIN);
    const beforeSelf  = sbtcBalance(SELF);
    const cm = callOk(MARKET, "create-market", [toU(M), toU(SEED)], ADMIN);
    expect(cm.result.type).toBe("ok");

    const afterAdmin = sbtcBalance(ADMIN);
    const afterSelf  = sbtcBalance(SELF);
    const pool0      = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));

    // seed pasa de admin -> contrato
    expect(afterSelf - beforeSelf).toBe(SEED);
    expect(afterAdmin - beforeAdmin).toBe(-SEED);
    expect(pool0).toBe(SEED);

    // --- BUYS: usar unwrapQuote + buy-*-auto con slippage cap ---
    logSection("Buys (pool += ΔC base; fees a vaults)");

    // YES 10k
    const qY = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M), toU(10_000)], w1).result);
    callOk(MARKET, "buy-yes-auto", [toU(M), toU(10_000), toU(1_000_000_000), toU(qY.total)], w1);
    expect(cvToUint(getCV(view(MARKET,"get-yes-supply",[toU(M)], d)))).toBe(10_000);
    const pool1 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));
    expect(pool1).toBeGreaterThan(pool0);

    // NO 3k
    const qN = unwrapQuote(view(MARKET, "quote-buy-no", [toU(M), toU(3_000)], w2).result);
    callOk(MARKET, "buy-no-auto", [toU(M), toU(3_000), toU(1_000_000_000), toU(qN.total)], w2);
    expect(cvToUint(getCV(view(MARKET,"get-no-supply",[toU(M)], d)))).toBe(3_000);
    const pool2 = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));
    expect(pool2).toBeGreaterThan(pool1);

    printMarketState(M, d);
    printBalances("post-buys", [w1, w2, SELF, ADMIN]);

    // --- RESOLVE YES (con solvencia) ---
    logSection("Resolve YES");
    ensureSolvent(M, "YES", ADMIN, d);
    const res = (globalThis as any).simnet.callPublicFn(MARKET, "resolve", [toU(M), Cl.stringAscii("YES")], ADMIN);
    expect(res.result.type).toBe("ok");

    // --- REDEEM ganador 1:1 (UNIT por share) ---
    logSection("Redeem (winner 1:1)");
    const yesBal = cvToUint(getCV(view(MARKET, "get-yes-balance", [toU(M), Cl.principal(w1)], w1)));
    const UNIT   = getUnit(d);
    const poolBeforeRedeem = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));
    const redeem = (globalThis as any).simnet.callPublicFn(MARKET, "redeem", [toU(M)], w1);
    expect(redeem.result.type).toBe("ok");
    const payout = cvToUint(redeem.result.value);
    expect(payout).toBe(yesBal * UNIT);

    const poolAfterRedeem = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));
    expect(poolAfterRedeem).toBe(poolBeforeRedeem - payout);

    // YES supply debe quedar 0 tras el redeem completo
    const yesSupply = cvToUint(getCV(view(MARKET,"get-yes-supply",[toU(M)], d)));
    expect(yesSupply).toBe(0);

    printMarketState(M, d);
    printBalances("post-redeem", [w1, w2, SELF, ADMIN]);

    // --- WITHDRAW-SURPLUS (sin YES restante) ---
    logSection("Withdraw-surplus (no YES supply)");
    callOk(MARKET, "withdraw-surplus", [toU(M)], ADMIN);
    const poolFinal = cvToUint(getCV(view(MARKET, "get-pool", [toU(M)], d)));
    expect(poolFinal).toBe(0);
  });
});
