import { describe, it, expect } from "vitest";
import {
  U, principal, addr, cvToUint,
  logHeader, logSection, log,
  callOk, view,
  sbtcBalance, getSelfPrincipal, getFeeRecipients,
  printBalances, printMarketState,
  MARKET, SBTC
} from "./helpers";

/**
 * DESCRIPTION
 * Boot the system by creating a market and validating the initial state:
 * - Mint sBTC for ADMIN (seed) and a user (future buys).
 * - Create market m=1 with LIQ=100_000.
 * - Verify pool==LIQ, b>0, YES/NO supplies == 0.
 * - Log every TX, balances (ADMIN/SELF/user), market state and a final summary.
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);

describe("01 - create-market & initial state", () => {
  it("Creates market, pool = initial liquidity, b > 0, supplies = 0", () => {
    logHeader(
      "01 - create-market & initial state",
      "Seed sBTC, create m=1 with LIQ=100k and check initial invariants."
    );

    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const M  = 1;
    const LIQ = 100_000;

    const recipients = getFeeRecipients();

    // -------- Initial balances
    logSection("Initial balances");
    printBalances("before", [
      ADMIN, w1, d,
      recipients.drip, recipients.brc20, recipients.team, recipients.lp
    ].filter(Boolean));

    // -------- Mint for ADMIN and W1
    logSection("Mint for ADMIN (seed) and W1 (user)");
    callOk(SBTC, "mint", [toU(LIQ), toP(ADMIN)], d);     // ADMIN will provide initial liquidity
    callOk(SBTC, "mint", [toU(1_000_000), toP(w1)], d);  // w1 funds for future buys
    printBalances("post-mint", [ADMIN, w1, d]);

    // -------- Create market m=1
    logSection("Create market m=1");
    const create = callOk(MARKET, "create-market", [toU(M), toU(LIQ)], ADMIN);
    expect(create.result.type).toBe("ok");

    const SELF = getSelfPrincipal();
    log(`SELF principal (contract): ${SELF}`);
    printBalances("post-create", [ADMIN, SELF]); // seed moved to the contract

    // -------- Market state
    logSection("Initial market state");
    const { pool, ys, ns } = printMarketState(M, d);
    expect(pool).toBe(LIQ);

    const b = cvToUint(view(MARKET, "get-b", [toU(M)], d).result);
    log(`b (m=${M}) = ${b}`);
    expect(b).toBeGreaterThan(0);

    expect(ys).toBe(0);
    expect(ns).toBe(0);

    // -------- Final summary
    logSection("Summary");
    log(`ADMIN=${sbtcBalance(ADMIN)} | W1=${sbtcBalance(w1)} | SELF=${sbtcBalance(SELF)} | pool=${pool} | b=${b} | YES=${ys} | NO=${ns}`);
  });
});
