import { describe, it, expect } from "vitest";
import {
  U, principal, addr, cvToUint,
  logHeader, logSection, log, callOk, view, unwrapQuote, logQuote,
  printBalances, printMarketState, getSelfPrincipal, getFeeRecipients, sbtcBalance,
  MARKET, SBTC, Cl
} from "./helpers";

/**
 * DESCRIPCIÓN (complejo con fees, recipients, lock y muchos compradores)
 * - Crea m=20 (LIQ=150k), fija fees (0.6% protocol, 0.2% LP).
 * - Cambia recipients: drip=w7, brc=w8, team=w6, lp=w5.
 * - 6 compras intercaladas (w1..w4) YES/NO con slippage protegido.
 * - Suma las fees de cada QUOTE y al final comprueba que los balances de recipients
 *   han subido EXACTAMENTE lo que corresponde (sumas de drip/brc/team/lp).
 * - lock-fees-config y prueba de que set-fees/set-fee-recipients fallan con u743.
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);

describe("06 - fees/recipients/lock con múltiples compras", () => {
  it("Suma de fees = delta en vaults; lock impide cambios posteriores (u743)", () => {
    logHeader("06 - fees/recipients/lock (múltiples compradores)",
      "Cambia recipients, ejecuta compras múltiples y verifica que las vaults reciben exactamente la suma de fees de las quotes. Luego bloquea y comprueba error u743.");

    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const w3 = addr("wallet_3");
    const w4 = addr("wallet_4");

    const DRIP = addr("drip"); // w7
    const BRC  = addr("brc");  // w8
    const TEAM = addr("team"); // w6
    const LP   = addr("lp");   // w5

    const M  = 20;
    const LIQ = 150_000;

    // --- Seed & create ---
    logSection("Seed & create");
    callOk(SBTC, "mint", [toU(LIQ), toP(ADMIN)], d);
    [w1, w2, w3, w4].forEach(w => callOk(SBTC, "mint", [toU(1_000_000), toP(w)], d));
    callOk(MARKET, "create-market", [toU(M), toU(LIQ)], ADMIN);

    const SELF = getSelfPrincipal();
    printBalances("after create", [ADMIN, w1, w2, w3, w4, SELF, DRIP, BRC, TEAM, LP]);

    // --- Fija fees y recipients ---
    logSection("Set fees & recipients");
    callOk(MARKET, "set-fees", [toU(60), toU(20)], ADMIN); // 0.60% protocol, 0.20% LP
    callOk(MARKET, "set-fee-recipients", [toP(DRIP), toP(BRC), toP(TEAM), toP(LP)], ADMIN);

    printMarketState(M, d);

    // Baselines de balances antes de las compras
    const start = {
      drip: sbtcBalance(DRIP),
      brc:  sbtcBalance(BRC),
      team: sbtcBalance(TEAM),
      lp:   sbtcBalance(LP),
      self: sbtcBalance(SELF),
    };

    // Acumuladores de fees (de quotes)
    let acc = { drip: 0, brc: 0, team: 0, lp: 0, base: 0 };

    // Helper: ejecuta un buy-auto usando quote, suma fees y loguea
    const buyAuto = (who: string, side: "YES" | "NO", delta: number, cap = 1_000_000_000) => {
      const fnQuote = side === "YES" ? "quote-buy-yes" : "quote-buy-no";
      const fnBuy   = side === "YES" ? "buy-yes-auto" : "buy-no-auto";
      const q = unwrapQuote(view(MARKET, fnQuote, [toU(M), toU(delta)], who));
      logQuote(side, delta, q);
      acc.drip += q.drip;
      acc.brc  += q.brc20;
      acc.team += q.team;
      acc.lp   += q.feeLP;
      acc.base += q.cost;

      callOk(MARKET, fnBuy, [toU(M), toU(delta), toU(cap), toU(q.total)], who, `${who} ${side} Δ=${delta}`);
      printBalances(`post ${side} ${delta}`, [who, SELF, DRIP, BRC, TEAM, LP]);
      printMarketState(M, d);
    };

    logSection("Compras múltiples con slippage protegido");
    buyAuto(w1, "YES",  8_000);
    buyAuto(w2, "NO",   5_000);
    buyAuto(w3, "YES", 12_000);
    buyAuto(w4, "NO",   7_500);
    buyAuto(w1, "YES",  4_000);
    buyAuto(w2, "NO",   3_500);

    // Balances después
    const end = {
      drip: sbtcBalance(DRIP),
      brc:  sbtcBalance(BRC),
      team: sbtcBalance(TEAM),
      lp:   sbtcBalance(LP),
      self: sbtcBalance(SELF),
    };

    logSection("Comprobaciones de sumas de fees vs. balances de vaults");
    const dDrip = end.drip - start.drip;
    const dBrc  = end.brc  - start.brc;
    const dTeam = end.team - start.team;
    const dLp   = end.lp   - start.lp;

    log(`Δdrip=${dDrip} vs acc.drip=${acc.drip}`);
    log(`Δbrc =${dBrc}  vs acc.brc =${acc.brc}`);
    log(`Δteam=${dTeam} vs acc.team=${acc.team}`);
    log(`Δlp  =${dLp}   vs acc.lp  =${acc.lp}`);

    expect(dDrip).toBe(acc.drip);
    expect(dBrc).toBe(acc.brc);
    expect(dTeam).toBe(acc.team);
    expect(dLp).toBe(acc.lp);

    // El SELF (pool) debe haber aumentado exactamente por la suma de 'base' (cost LMSR) de todas las compras
    const dSelf = end.self - start.self;
    log(`Δself (pool)=${dSelf} vs acc.base=${acc.base}`);
    expect(dSelf).toBe(acc.base);

    // --- Lock & cambios prohibidos ---
    logSection("Lock fees y cambios prohibidos (u743)");
    callOk(MARKET, "lock-fees-config", [], ADMIN);

    // Intentos de cambiar fees/recipients tras lock -> deben fallar u743
    const t1 = (globalThis as any).simnet.callPublicFn(MARKET, "set-fees", [toU(30), toU(10)], ADMIN);
    const t2 = (globalThis as any).simnet.callPublicFn(MARKET, "set-fee-recipients", [toP(w3), toP(w4), toP(w2), toP(w1)], ADMIN);

    expect(t1.result.type).toBe("err");
    expect(cvToUint(t1.result.value)).toBe(743);

    expect(t2.result.type).toBe("err");
    expect(cvToUint(t2.result.value)).toBe(743);

    log("✅ lock-fees-config impidió cambios posteriores (u743).");
  });
});
