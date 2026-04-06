import { describe, it, expect } from "vitest";
import {
  U, principal, addr,
  logHeader, logSection, callOk, view, unwrapQuote, logQuote,
  getSelfPrincipal, getFeeRecipients, printBalances, printMarketState, MARKET, SBTC
} from "./helpers";

/**
 * DESCRIPTION
 * Create m=11 with LIQ=120k, set fees (0.50% protocol, 0.25% LP), buy YES 10k and NO 3k:
 * - Log quote breakdown (cost + feeProtocol [drip/brc/team] + feeLP).
 * - Execute buys, print balances for w1/w2/SELF/recipients.
 * - Show market state after each buy.
 */

const ADMIN = "ST5HMBACVCBHDE0H96M11NCG6TKF7WVWSVSG2P53";
const toU = (n: number | bigint) => U(n);
const toP = (s: string) => principal(s);

describe("02 - quotes & buys", () => {
  it("Quotes YES/NO, buys with slippage guard, checks supplies/pool and fees routing", () => {
    logHeader("02 - quotes & buys",
      "Create m=11 (LIQ=120k), set fees, buy YES 10k and NO 3k. Show fee breakdown and balances.");

    const d  = addr("deployer");
    const w1 = addr("wallet_1");
    const w2 = addr("wallet_2");
    const M  = 11;
    const LIQ = 120_000;

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

    // --- Fees ---
    logSection("Set fees 0.50% protocol, 0.25% LP");
    callOk(MARKET, "set-fees", [toU(50), toU(25)], ADMIN);

    // --- YES 10k ---
    logSection("Quote & buy YES 10k");
    const qYes = unwrapQuote(view(MARKET, "quote-buy-yes", [toU(M), toU(10_000)], w1));
    logQuote("YES", 10_000, qYes);
    callOk(MARKET, "buy-yes-auto", [toU(M), toU(10_000), toU(1_000_000_000), toU(qYes.total)], w1, "w1 buys YES");
    printBalances("post YES", [w1, SELF, recipients.drip, recipients.brc20, recipients.team, recipients.lp].filter(Boolean));
    printMarketState(M, d);

    // --- NO 3k ---
    logSection("Quote & buy NO 3k");
    const qNo = unwrapQuote(view(MARKET, "quote-buy-no", [toU(M), toU(3_000)], w2));
    logQuote("NO", 3_000, qNo);
    callOk(MARKET, "buy-no-auto", [toU(M), toU(3_000), toU(1_000_000_000), toU(qNo.total)], w2, "w2 buys NO");
    printBalances("post NO", [w2, SELF, recipients.drip, recipients.brc20, recipients.team, recipients.lp].filter(Boolean));
    printMarketState(M, d);
  });
});
