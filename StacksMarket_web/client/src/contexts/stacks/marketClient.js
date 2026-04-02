// marketClient.js (UPDATED for market-factory-v16 + buy-by-budget quotes)
// - CONTRACT_NAME updated
// - Added quote-buy-yes-by-sats / quote-buy-no-by-sats read-only wrappers (budget in uSTX)
// - Added buyYesBySatsAuto / buyNoBySatsAuto helpers (uses quote-by-budget -> buy-*-auto)
// - Added nested tuple helpers for quote nesting
//
// NOTE: No changes to PollDetail required yet; PollDetail can keep using getQuoteYes/No for shares.
//       When you switch UI to STX input, you'll call getQuoteYesBySats/getQuoteNoBySats or buy*BySatsAuto.

import {
  uintCV,
  principalCV,
  stringAsciiCV,
  fetchCallReadOnlyFunction,
  PostConditionMode,
  Pc,
  serializeCV,
} from "@stacks/transactions";
import { openContractCall } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import axios from "axios";
import { authenticate, getWalletAddress, getLiveWalletAddress, notifyWalletMismatch, isWalletInAppBrowser, hasInAppHint, isMobileBrowser } from "../../utils/stacksConnect";
import { BACKEND_URL } from "../../contexts/Bakendurl";

// ------------------- CONFIG -------------------
const NETWORK_NAME = (process.env.REACT_APP_STACKS_NETWORK || "mainnet").toLowerCase();
const CONTRACT_ADDRESS =
  process.env.REACT_APP_CONTRACT_ADDRESS || "SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA";
const CONTRACT_NAME = process.env.REACT_APP_CONTRACT_NAME || "market-factory-v20-bias";

const APP_DETAILS = {
  name: "StacksMarket",
  icon: "https://imglink.io/i/139bee27-a14b-4e2d-99c3-3b05d9cb6e53.png",
};

const network = NETWORK_NAME === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

// Debug flag
let MARKET_CLIENT_DEBUG = false;
const _loggedReadFunctions = new Set();
const _polledTxs = new Set();

export function setMarketClientDebug(v = false) {
  MARKET_CLIENT_DEBUG = !!v;
}

// ------------------- AUTH HELPER -------------------
async function ensureWalletAuth() {
  // Leather mobile webview: request() API is broken (hangs forever).
  // Always route through authenticate() so it can enforce WalletConnect.
  const leatherMobileWebview =
    isMobileBrowser() &&
    !isWalletInAppBrowser() &&
    !hasInAppHint() &&
    typeof window !== "undefined" &&
    Boolean(window.LeatherProvider);

  let address = getWalletAddress();
  if (!address || leatherMobileWebview) address = await authenticate();

  // Pre-transaction safety check: verify Leather's live address matches the cached one.
  // If the user switched wallets in Leather without logging out of the app, abort early.
  // Skip this check whenever Leather's mobile provider is present: window.LeatherProvider
  // .request() hangs on Leather mobile regardless of whether it was detected as in-app
  // browser (via UA) or external browser (leatherMobileWebview).
  const isLeatherMobile =
    isMobileBrowser() &&
    typeof window !== "undefined" &&
    Boolean(window.LeatherProvider);
  if (address && !isLeatherMobile) {
    const liveAddress = await getLiveWalletAddress();
    if (liveAddress && liveAddress !== address) {
      notifyWalletMismatch();
      throw new Error("WALLET_MISMATCH");
    }
  }

  if (address) {
    try {
      await axios.post(`${BACKEND_URL}/api/auth/wallet-login`, {
        walletAddress: address,
      });
    } catch (err) {
      if (MARKET_CLIENT_DEBUG) console.error("❌ Wallet login failed:", err);
    }
  }
  return address;
}

export async function ensureWalletSigner(expectedAddress = "") {
  const connected = await ensureWalletAuth();
  if (!connected) throw new Error("Wallet not connected");
  if (expectedAddress && String(expectedAddress).trim() !== connected) {
    throw new Error("Connected signer does not match authenticated user");
  }
  return connected;
}

// ------------------- INTERNAL HELPERS -------------------
async function contractCall({
  functionName,
  functionArgs = [],
  postConditionMode = PostConditionMode.Allow,
  postConditions = [],
  quoteData = null,
}) {
  await ensureWalletAuth();

  // Leather mobile (in-app or external): openContractCall() with PostConditionMode.Deny
  // hangs — the wallet tx sheet never opens. Xverse mobile handles Deny correctly.
  const isLeatherMobile =
    isMobileBrowser() &&
    typeof window !== "undefined" &&
    Boolean(window.LeatherProvider);
  if (isLeatherMobile) {
    postConditionMode = PostConditionMode.Allow;
    postConditions = [];
  }

  const argsDump = (functionArgs || []).map((a) => {
    try {
      if (a && typeof a === "object") {
        return {
          type: a.type,
          value:
            typeof a.value === "object" && a.value !== null
              ? JSON.stringify(a.value)
              : String(a.value),
        };
      }
      return String(a);
    } catch {
      return String(a);
    }
  });

  if (MARKET_CLIENT_DEBUG && quoteData) {
    const getField = (tup, key) => {
      if (!tup) return undefined;
      const base = tup?.value ?? tup;
      if (base?.value && typeof base.value === "object" && key in base.value)
        return base.value[key];
      if (base && typeof base === "object" && key in base) return base[key];
      return undefined;
    };
    const toStr = (x) => {
      if (x == null) return undefined;
      const v = x.value !== undefined ? x.value : x;
      try {
        return typeof v === "bigint" ? v.toString() : String(v);
      } catch {
        return undefined;
      }
    };

    console.log("📊 Quote Data for Contract Call:", {
      functionName,
      argsDump,
      quoteDetails: {
        cost: toStr(getField(quoteData, "cost")),
        proceeds: toStr(getField(quoteData, "proceeds")),
        total: toStr(getField(quoteData, "total")),
        feeProtocol: toStr(getField(quoteData, "feeProtocol")),
        feeLP: toStr(getField(quoteData, "feeLP")),
        walletA: toStr(getField(quoteData, "walletA")),
        walletB: toStr(getField(quoteData, "walletB")),
      },
    });
  }

  return new Promise((resolve, reject) => {
    try {
      openContractCall({
        network,
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName,
        functionArgs,
        appDetails: APP_DETAILS,
        postConditionMode,
        postConditions,
        onFinish: (data) => {
          if (MARKET_CLIENT_DEBUG)
            console.log(`✅ Tx finished ${functionName}:`, data);
          resolve(data);
        },
        onCancel: () => {
          if (MARKET_CLIENT_DEBUG)
            console.warn(`⚠️ User cancelled ${functionName}`);
          reject(new Error("User cancelled"));
        },
      });
    } catch (err) {
      reject(err);
    }
  });
}

const getContractPrincipalId = () => `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`;
const USTX_PER_STX = 1_000_000;
const toPcAmount = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid post-condition amount: ${amount}`);
  return String(Math.round(n));
};

const buildBuyPostConditions = (maxCostUstx) => [
  // User cannot send more STX than the already-slippage-capped maxCost.
  Pc.origin().willSendLte(toPcAmount(maxCostUstx)).ustx(),
  // Contract sends out fees during buys; cap total contract STX outflow conservatively.
  Pc.principal(getContractPrincipalId()).willSendLte(toPcAmount(maxCostUstx)).ustx(),
];

const buildSellPostConditions = ({ minProceedsUstx, maxContractOutUstx }) => {
  const pcs = [];
  const contractPc = Pc.principal(getContractPrincipalId());

  // Contract must send at least this much STX overall (recipient-agnostic; user min is still enforced on-chain).
  pcs.push(contractPc.willSendGte(toPcAmount(minProceedsUstx)).ustx());

  if (maxContractOutUstx != null) {
    // In deny mode, keep an upper bound that won't break on favorable price movement.
    pcs.push(contractPc.willSendLte(toPcAmount(maxContractOutUstx)).ustx());
  }

  return pcs;
};

async function contractRead({ functionName, functionArgs = [] }) {
  const senderAddress = getWalletAddress() || CONTRACT_ADDRESS;

  try {
    const result = await fetchCallReadOnlyFunction({
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName,
      functionArgs,
      network,
      senderAddress,
    });

    if (MARKET_CLIENT_DEBUG && !_loggedReadFunctions.has(functionName)) {
      console.log(`📖 ${functionName} result:`, result);
      _loggedReadFunctions.add(functionName);
    }

    return result;
  } catch (err) {
    if (MARKET_CLIENT_DEBUG) {
      console.warn(`❌ Error reading ${functionName}:`, {
        message: err?.message || err,
        functionName,
        functionArgs,
        senderAddress,
      });
    }
    throw err;
  }
}

// ------------------- SMALL HELPERS (UINT + TUPLES) -------------------
const normalizeUInt = (v) => {
  try {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string") {
      const s = v.startsWith("u") ? v.slice(1) : v;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "object") {
      if (typeof v.value === "bigint") return Number(v.value);
      if (typeof v.value === "number") return v.value;
      if (typeof v.value === "string") {
        const s = v.value.startsWith?.("u") ? v.value.slice(1) : v.value;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
      const s = v.toString?.();
      if (typeof s === "string") {
        const t = s.startsWith("u") ? s.slice(1) : s;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      }
    }
  } catch {}
  return null;
};

const unwrapClarity = (cv) => cv?.value ?? cv?.okay ?? cv;

const getFieldFromTuple = (tup, key) => {
  if (!tup) return null;
  const base = tup?.value ?? tup;
  if (base?.value && typeof base.value === "object" && key in base.value)
    return base.value[key];
  if (base && typeof base === "object" && key in base) return base[key];
  return null;
};

// NEW: nested tuple path helper
const getNestedField = (tup, path) => {
  let cur = tup?.value ?? tup;
  for (const k of path) {
    if (cur == null) return null;
    cur = cur?.value?.[k] ?? cur?.[k];
  }
  return cur;
};

// ------------------- WRITE FUNCTIONS (MARKET) -------------------

// Create a market
export async function createMarket(marketId, initialLiquidity) {
  const marketIdNum = Number(marketId);
  const initialLiquidityNum = Number(initialLiquidity);

  if (!Number.isFinite(marketIdNum) || !Number.isFinite(initialLiquidityNum)) {
    throw new Error(
      `Invalid marketId or initialLiquidity: marketId=${marketId}, initialLiquidity=${initialLiquidity}`
    );
  }
  if (marketIdNum <= 0 || initialLiquidityNum <= 0) {
    throw new Error(
      `Invalid values: marketId=${marketIdNum}, initialLiquidity=${initialLiquidityNum}`
    );
  }

  const marketIdInt = Math.floor(marketIdNum);
  const initialLiquidityInt = Math.round(initialLiquidityNum);

  return contractCall({
    functionName: "create-market",
    functionArgs: [uintCV(marketIdInt), uintCV(initialLiquidityInt)],
  });
}

/**
 * set initial market bias (pricing prior)
 * Contract: (set-market-bias (m uint) (p-yes uint))
 * p-yes: % entero (1..99).
 */
export async function setMarketBias(marketId, pYes) {
  const m = Math.floor(Number(marketId));
  const p = Math.floor(Number(pYes));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(p)) throw new Error("Invalid pYes");
  const pc = Math.max(1, Math.min(99, p));

  return contractCall({
    functionName: "set-market-bias",
    functionArgs: [uintCV(m), uintCV(pc)],
  });
}

/**
 * Reset market bias to neutral (rY=0, rN=0).
 * Only allowed when yes-supply == 0 and no-supply == 0.
 */
export async function resetMarketBias(marketId) {
  const m = Math.floor(Number(marketId));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");

  return contractCall({
    functionName: "reset-market-bias",
    functionArgs: [uintCV(m)],
  });
}

// ------------------- SLIPPAGE HELPERS -------------------
const DEFAULT_SLIPPAGE_BPS = 100; // 1.00%

const applySlippageUp = (n, bps = DEFAULT_SLIPPAGE_BPS, minExtra = 1) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.ceil(x * (1 + bps / 10000)) + minExtra;
};

const applySlippageDown = (n, bps = DEFAULT_SLIPPAGE_BPS, minExtra = 1) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.floor(x * (1 - bps / 10000)) - minExtra);
};

// ------------------- AUTO BUY (4 ARGS) -------------------
export async function buyYesAuto(
  marketId,
  amount,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  await ensureWalletAuth();

  const m = Math.floor(Number(marketId));
  const a = Math.round(Number(amount));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(a) || a <= 0) throw new Error("Invalid amount");

  const quote = await getQuoteYes(m, a);
  const quoteResult = unwrapClarity(quote);

  const totalNum = normalizeUInt(getFieldFromTuple(quoteResult, "total"));
  if (totalNum == null || !Number.isFinite(totalNum))
    throw new Error("quote.total missing");

  const maxCost = applySlippageUp(totalNum, slippageBps, 2);
  if (maxCost == null) throw new Error("maxCost invalid");

  let targetCap = maxCost;
  try {
    const who = getWalletAddress();
    if (who) {
      const spentRes = await getSpent(m, who);
      const spentCv = unwrapClarity(spentRes);
      const spent = normalizeUInt(spentCv);
      if (Number.isFinite(spent)) targetCap = spent + maxCost;
    }
  } catch {}

  return contractCall({
    functionName: "buy-yes-auto",
    functionArgs: [uintCV(m), uintCV(a), uintCV(targetCap), uintCV(maxCost)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildBuyPostConditions(maxCost),
    quoteData: quoteResult,
  });
}

export async function buyNoAuto(
  marketId,
  amount,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  await ensureWalletAuth();

  const m = Math.floor(Number(marketId));
  const a = Math.round(Number(amount));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(a) || a <= 0) throw new Error("Invalid amount");

  const quote = await getQuoteNo(m, a);
  const quoteResult = unwrapClarity(quote);

  const totalNum = normalizeUInt(getFieldFromTuple(quoteResult, "total"));
  if (totalNum == null || !Number.isFinite(totalNum))
    throw new Error("quote.total missing");

  const maxCost = applySlippageUp(totalNum, slippageBps, 2);
  if (maxCost == null) throw new Error("maxCost invalid");

  let targetCap = maxCost;
  try {
    const who = getWalletAddress();
    if (who) {
      const spentRes = await getSpent(m, who);
      const spentCv = unwrapClarity(spentRes);
      const spent = normalizeUInt(spentCv);
      if (Number.isFinite(spent)) targetCap = spent + maxCost;
    }
  } catch {}

  return contractCall({
    functionName: "buy-no-auto",
    functionArgs: [uintCV(m), uintCV(a), uintCV(targetCap), uintCV(maxCost)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildBuyPostConditions(maxCost),
    quoteData: quoteResult,
  });
}

// ------------------- NEW: AUTO BUY BY SATS -------------------
// 1) read-only quote-buy-*-by-sats => shares + quote.total (uSTX)
// 2) execute buy-*-auto with those shares
export async function buyYesBySatsAuto(
  marketId,
  budgetSats,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  await ensureWalletAuth();

  const m = Math.floor(Number(marketId));
  const budget = Math.round(Number(budgetSats));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid budget");

  const q = await getQuoteYesBySats(m, budget);
  const qv = unwrapClarity(q);

  const shares = normalizeUInt(getNestedField(qv, ["shares"]));
  if (!shares || shares <= 0) throw new Error("Budget too low (0 shares)");

  const total = normalizeUInt(getNestedField(qv, ["quote", "total"]));
  if (total == null) throw new Error("quote.total missing");

  const maxCost = applySlippageUp(total, slippageBps, 2);
  if (maxCost == null) throw new Error("maxCost invalid");

  let targetCap = maxCost;
  try {
    const who = getWalletAddress();
    if (who) {
      const spentRes = await getSpent(m, who);
      const spentCv = unwrapClarity(spentRes);
      const spent = normalizeUInt(spentCv);
      if (Number.isFinite(spent)) targetCap = spent + maxCost;
    }
  } catch {}

  // pass nested quote tuple for logs
  const quoteData = getNestedField(qv, ["quote"]) ?? qv;

  return contractCall({
    functionName: "buy-yes-auto",
    functionArgs: [uintCV(m), uintCV(shares), uintCV(targetCap), uintCV(maxCost)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildBuyPostConditions(maxCost),
    quoteData,
  });
}

export async function buyNoBySatsAuto(
  marketId,
  budgetSats,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  await ensureWalletAuth();

  const m = Math.floor(Number(marketId));
  const budget = Math.round(Number(budgetSats));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("Invalid budget");

  const q = await getQuoteNoBySats(m, budget);
  const qv = unwrapClarity(q);

  const shares = normalizeUInt(getNestedField(qv, ["shares"]));
  if (!shares || shares <= 0) throw new Error("Budget too low (0 shares)");

  const total = normalizeUInt(getNestedField(qv, ["quote", "total"]));
  if (total == null) throw new Error("quote.total missing");

  const maxCost = applySlippageUp(total, slippageBps, 2);
  if (maxCost == null) throw new Error("maxCost invalid");

  let targetCap = maxCost;
  try {
    const who = getWalletAddress();
    if (who) {
      const spentRes = await getSpent(m, who);
      const spentCv = unwrapClarity(spentRes);
      const spent = normalizeUInt(spentCv);
      if (Number.isFinite(spent)) targetCap = spent + maxCost;
    }
  } catch {}

  const quoteData = getNestedField(qv, ["quote"]) ?? qv;

  return contractCall({
    functionName: "buy-no-auto",
    functionArgs: [uintCV(m), uintCV(shares), uintCV(targetCap), uintCV(maxCost)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildBuyPostConditions(maxCost),
    quoteData,
  });
}

// ------------------- AUTO SELL (3 ARGS) -------------------
export async function sellYesAuto(
  marketId,
  amount,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  const m = Math.floor(Number(marketId));
  const a = Math.round(Number(amount));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(a) || a <= 0) throw new Error("Invalid amount");

  const quote = await getQuoteSellYes(m, a);
  const quoteResult = unwrapClarity(quote);

  const totalNum = normalizeUInt(getFieldFromTuple(quoteResult, "total"));
  if (totalNum == null || !Number.isFinite(totalNum))
    throw new Error("quote.total missing");
  const minProceeds = applySlippageDown(totalNum, slippageBps, 2);
  if (minProceeds == null) throw new Error("minProceeds invalid");

  return contractCall({
    functionName: "sell-yes-auto",
    functionArgs: [uintCV(m), uintCV(a), uintCV(minProceeds)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildSellPostConditions({
      minProceedsUstx: minProceeds,
    }),
    quoteData: quoteResult,
  });
}

export async function sellNoAuto(
  marketId,
  amount,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  const m = Math.floor(Number(marketId));
  const a = Math.round(Number(amount));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(a) || a <= 0) throw new Error("Invalid amount");

  const quote = await getQuoteSellNo(m, a);
  const quoteResult = unwrapClarity(quote);

  const totalNum = normalizeUInt(getFieldFromTuple(quoteResult, "total"));
  if (totalNum == null || !Number.isFinite(totalNum))
    throw new Error("quote.total missing");
  const minProceeds = applySlippageDown(totalNum, slippageBps, 2);
  if (minProceeds == null) throw new Error("minProceeds invalid");

  return contractCall({
    functionName: "sell-no-auto",
    functionArgs: [uintCV(m), uintCV(a), uintCV(minProceeds)],
    postConditionMode: PostConditionMode.Deny,
    postConditions: buildSellPostConditions({
      minProceedsUstx: minProceeds,
    }),
    quoteData: quoteResult,
  });
}

// ------------------- RESOLUTION / REDEEM -------------------
export async function resolveMarket(marketId, result) {
  return contractCall({
    functionName: "resolve",
    functionArgs: [uintCV(marketId), stringAsciiCV(result)], // "YES" | "NO"
  });
}

export async function redeem(marketId) {
  await ensureWalletAuth();
  const m = Math.floor(Number(marketId));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  const who = getWalletAddress();
  if (!who) throw new Error("Wallet not connected");

  const outRes = await getOutcome(m);
  const outUnwrapped = unwrapClarity(outRes);
  const outcome = String(outUnwrapped?.value ?? outUnwrapped ?? "").toUpperCase();

  const balRes =
    outcome === "YES" ? await getYesBalance(m, who) : await getNoBalance(m, who);
  const balanceShares = normalizeUInt(unwrapClarity(balRes)) ?? 0;
  const payoutUstx = Math.round(balanceShares * USTX_PER_STX);

  return contractCall({
    functionName: "redeem",
    functionArgs: [uintCV(m)],
    postConditionMode: PostConditionMode.Deny,
    postConditions:
      payoutUstx > 0
        ? [Pc.principal(getContractPrincipalId()).willSendEq(toPcAmount(payoutUstx)).ustx()]
        : [],
  });
}

export async function withdrawSurplus(marketId) {
  return contractCall({
    functionName: "withdraw-surplus",
    functionArgs: [uintCV(marketId)],
  });
}

export async function getWithdrawableSurplus(marketId) {
  const res = await contractRead({
    functionName: "get-withdrawable-surplus",
    functionArgs: [uintCV(marketId)],
  });
  const v = unwrapClarity(res);
  return {
    outcome: getFieldFromTuple(v, "outcome")?.value ?? getFieldFromTuple(v, "outcome") ?? "",
    pool: normalizeUInt(getFieldFromTuple(v, "pool")) ?? 0,
    reserve: normalizeUInt(getFieldFromTuple(v, "reserve")) ?? 0,
    withdrawable: normalizeUInt(getFieldFromTuple(v, "withdrawable")) ?? 0,
    winningSupplyPending: normalizeUInt(getFieldFromTuple(v, "winningSupplyPending")) ?? 0,
    raw: res,
  };
}

// ------------------- MARKET MANAGEMENT -------------------
export async function setFees(protocolBps, lpBps) {
  return contractCall({
    functionName: "set-fees",
    functionArgs: [uintCV(protocolBps), uintCV(lpBps)],
  });
}

export async function setFeeRecipients(walletA, walletB, lp) {
  return contractCall({
    functionName: "set-fee-recipients",
    functionArgs: [
      principalCV(walletA),
      principalCV(walletB),
      principalCV(lp),
    ],
  });
}

export async function setProtocolSplit(pctA, pctB) {
  return contractCall({
    functionName: "set-protocol-split",
    functionArgs: [uintCV(pctA), uintCV(pctB)],
  });
}

export async function lockfees() {
  return contractCall({
    functionName: "lock-fees-config",
  });
}

// limitUstx: max total per trade (uSTX)
export async function setMaxTrade(marketId, limitUstx) {
  const m = Math.floor(Number(marketId));
  const l = Math.round(Number(limitUstx));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(l) || l <= 0) throw new Error("Invalid limitUstx");

  return contractCall({
    functionName: "set-max-trade",
    functionArgs: [uintCV(m), uintCV(l)],
  });
}

// closeTimeSec: unix timestamp (seconds, UTC). Use 0 to clear.
export async function setMarketCloseTime(marketId, closeTimeSec) {
  const m = Math.floor(Number(marketId));
  const t = Math.round(Number(closeTimeSec));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(t) || t < 0) throw new Error("Invalid closeTime");

  return contractCall({
    functionName: "set-market-close-time",
    functionArgs: [uintCV(m), uintCV(t)],
    postConditionMode: PostConditionMode.Deny,
  });
}

export async function pauseMarket(marketId) {
  return contractCall({
    functionName: "pause",
    functionArgs: [uintCV(marketId)],
    postConditionMode: PostConditionMode.Deny,
  });
}

export async function unpauseMarket(marketId) {
  return contractCall({
    functionName: "unpause",
    functionArgs: [uintCV(marketId)],
    postConditionMode: PostConditionMode.Deny,
  });
}

// Legacy wrappers
export async function pause(marketId) {
  return pauseMarket(marketId);
}
export async function unpause(marketId) {
  return unpauseMarket(marketId);
}
export async function maxtrade(marketId, maxtradeamount) {
  return setMaxTrade(marketId, maxtradeamount);
}

// ------------------- READ-ONLY GETTERS -------------------

// Effective Q = supply real + bias (rYes/rNo)
export async function getEffectiveQ(marketId) {
  const [ysRes, nsRes, rYesRes, rNoRes] = await Promise.all([
    getYesSupply(marketId),
    getNoSupply(marketId),
    getRYes(marketId),
    getRNo(marketId),
  ]);

  const yesSupply = normalizeUInt(ysRes?.value ?? ysRes) ?? 0;
  const noSupply = normalizeUInt(nsRes?.value ?? nsRes) ?? 0;

  const rYes = normalizeUInt(rYesRes?.value ?? rYesRes) ?? 0;
  const rNo = normalizeUInt(rNoRes?.value ?? rNoRes) ?? 0;

  return {
    qYes: yesSupply + rYes,
    qNo: noSupply + rNo,
    yesSupply,
    noSupply,
    rYes,
    rNo,
  };
}

// Market snapshot (single read-only call)
export async function getMarketSnapshot(marketId) {
  return contractRead({
    functionName: "get-market-snapshot",
    functionArgs: [uintCV(marketId)],
  });
}

// Pool size
export async function getPool(marketId) {
  return contractRead({
    functionName: "get-pool",
    functionArgs: [uintCV(marketId)],
  });
}

// LMSR b
export async function getB(marketId) {
  return contractRead({
    functionName: "get-b",
    functionArgs: [uintCV(marketId)],
  });
}

// Status
export async function getStatus(marketId) {
  return contractRead({
    functionName: "get-status",
    functionArgs: [uintCV(marketId)],
  });
}

export async function getCloseTime(marketId) {
  return contractRead({
    functionName: "get-close-time",
    functionArgs: [uintCV(marketId)],
  });
}

export async function isTradingOpenNow(marketId) {
  return contractRead({
    functionName: "is-trading-open-now",
    functionArgs: [uintCV(marketId)],
  });
}

// Outcome
export async function getOutcome(marketId) {
  return contractRead({
    functionName: "get-outcome",
    functionArgs: [uintCV(marketId)],
  });
}

// Initialized?
export async function getInitialized(marketId) {
  return contractRead({
    functionName: "get-initialized",
    functionArgs: [uintCV(marketId)],
  });
}

// Supplies
export async function getYesSupply(marketId) {
  return contractRead({
    functionName: "get-yes-supply",
    functionArgs: [uintCV(marketId)],
  });
}

export async function getNoSupply(marketId) {
  return contractRead({
    functionName: "get-no-supply",
    functionArgs: [uintCV(marketId)],
  });
}

// Bias terms
export async function getRYes(marketId) {
  return contractRead({
    functionName: "get-r-yes",
    functionArgs: [uintCV(marketId)],
  });
}

export async function getRNo(marketId) {
  return contractRead({
    functionName: "get-r-no",
    functionArgs: [uintCV(marketId)],
  });
}

export async function getBiasLocked(marketId) {
  return contractRead({
    functionName: "get-bias-locked-ro",
    functionArgs: [uintCV(marketId)],
  });
}

// Balances
export async function getYesBalance(marketId, principal) {
  return contractRead({
    functionName: "get-yes-balance",
    functionArgs: [uintCV(marketId), principalCV(principal)],
  });
}

export async function getNoBalance(marketId, principal) {
  return contractRead({
    functionName: "get-no-balance",
    functionArgs: [uintCV(marketId), principalCV(principal)],
  });
}

export async function getUserClaimable(marketId, principal) {
  return contractRead({
    functionName: "get-user-claimable",
    functionArgs: [uintCV(marketId), principalCV(principal)],
  });
}

// Cap / Spent
export async function getCap(marketId, principal) {
  return contractRead({
    functionName: "get-cap",
    functionArgs: [uintCV(marketId), principalCV(principal)],
  });
}

export async function getSpent(marketId, principal) {
  return contractRead({
    functionName: "get-spent",
    functionArgs: [uintCV(marketId), principalCV(principal)],
  });
}

// Quotes (by shares)
export async function getQuoteYes(marketId, amount) {
  return contractRead({
    functionName: "quote-buy-yes",
    functionArgs: [uintCV(marketId), uintCV(amount)],
  });
}

export async function getQuoteNo(marketId, amount) {
  return contractRead({
    functionName: "quote-buy-no",
    functionArgs: [uintCV(marketId), uintCV(amount)],
  });
}

// NEW: Quotes (by uSTX budget)
export async function getQuoteYesBySats(marketId, budgetSats) {
  return contractRead({
    functionName: "quote-buy-yes-by-sats",
    functionArgs: [uintCV(marketId), uintCV(budgetSats)],
  });
}

export async function getQuoteNoBySats(marketId, budgetSats) {
  return contractRead({
    functionName: "quote-buy-no-by-sats",
    functionArgs: [uintCV(marketId), uintCV(budgetSats)],
  });
}

// Sell quotes
export async function getQuoteSellYes(marketId, amount) {
  return contractRead({
    functionName: "quote-sell-yes",
    functionArgs: [uintCV(marketId), uintCV(amount)],
  });
}

export async function getQuoteSellNo(marketId, amount) {
  return contractRead({
    functionName: "quote-sell-no",
    functionArgs: [uintCV(marketId), uintCV(amount)],
  });
}

// ------------------- TX POLLING (via backend proxy) -------------------
const STACKS_PROXY_API = `${BACKEND_URL}/api/stacks`;

// Returns the STX balance of a wallet address in uSTX (microsatoshis).
export async function getWalletStxBalance(address) {
  if (!address) return 0;
  try {
    const res = await axios.get(`${STACKS_PROXY_API}/account/${address}`);
    const raw = res.data?.balance;
    if (!raw) return 0;
    // Hiro returns balance as hex string e.g. "0x000...3b9aca00"
    return parseInt(raw, 16);
  } catch {
    return 0;
  }
}

export async function pollTx(txId, interval = 5000, maxAttempts = 60) {
  if (MARKET_CLIENT_DEBUG && !_polledTxs.has(txId)) {
    console.log(`⏱️ Polling tx: ${txId}`);
    _polledTxs.add(txId);
  }

  // Use a shorter interval for the first few attempts so fast confirmations
  // are caught quickly, then fall back to the standard interval.
  const FAST_INTERVAL = 1000;
  const FAST_ATTEMPTS = 8;

  for (let i = 0; i < maxAttempts; i++) {
    const waitMs = i < FAST_ATTEMPTS ? FAST_INTERVAL : interval;
    let res;
    try {
      res = await axios.get(`${STACKS_PROXY_API}/tx/${txId}`);
    } catch (err) {
      const statusCode = err?.response?.status;
      if (statusCode === 404) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
    const status = res.data.tx_status;
    const result = res.data.tx_result;

    if (status === "success") {
      if (MARKET_CLIENT_DEBUG) console.log("✅ Transaction confirmed:", res.data);
      return res.data;
    }

    if (
      status === "abort_by_response" ||
      status === "abort_by_post_condition" ||
      status === "failed"
    ) {
      console.error("❌ Transaction failed:", { status, result, ...res.data });
      throw new Error(
        `Transaction failed ❌ (${status}): ${result?.repr || result}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new Error(
    `Transaction ${txId} not confirmed after ${maxAttempts} attempts`
  );
}

// ------------------- TX WAIT VIA WEBSOCKET (with polling fallback) -------------------
const HIRO_WS_URL =
  NETWORK_NAME === "mainnet"
    ? "wss://api.mainnet.hiro.so/"
    : "wss://api.testnet.hiro.so/";

const TX_FAILED_STATUSES = new Set([
  "abort_by_response",
  "abort_by_post_condition",
  "failed",
]);

async function waitForTxViaWebSocket(txId, timeoutMs) {
  const { connectWebSocketClient } = await import("@stacks/blockchain-api-client");

  return new Promise(async (resolve, reject) => {
    let client = null;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      try { client?.webSocket?.close(); } catch {}
      fn(value);
    };

    const timer = setTimeout(() => {
      settle(reject, new Error("WebSocket timeout waiting for tx confirmation"));
    }, timeoutMs);

    try {
      client = await connectWebSocketClient(HIRO_WS_URL);

      // Subscribe first, then check current status to avoid race condition
      // where tx confirms between subscription setup and HTTP check.
      await client.subscribeTxUpdates(txId, (event) => {
        const status = String(event?.tx_status || "").toLowerCase();
        if (status === "success") {
          clearTimeout(timer);
          settle(resolve, event);
        } else if (TX_FAILED_STATUSES.has(status)) {
          clearTimeout(timer);
          const repr = event?.tx_result?.repr || event?.tx_result || status;
          settle(reject, new Error(`Transaction failed (${status}): ${repr}`));
        }
        // pending → keep waiting
      });

      // Check if already confirmed before the subscription fired
      try {
        const res = await axios.get(`${STACKS_PROXY_API}/tx/${txId}`);
        const status = String(res.data?.tx_status || "").toLowerCase();
        if (status === "success") {
          clearTimeout(timer);
          settle(resolve, res.data);
        } else if (TX_FAILED_STATUSES.has(status)) {
          clearTimeout(timer);
          const repr = res.data?.tx_result?.repr || res.data?.tx_result || status;
          settle(reject, new Error(`Transaction failed (${status}): ${repr}`));
        }
      } catch {
        // 404 = still in mempool, WS will notify when confirmed — ignore
      }
    } catch (err) {
      clearTimeout(timer);
      settle(reject, err);
    }
  });
}

/**
 * Wait for a Stacks transaction to confirm.
 * Uses WebSocket push for instant notification; falls back to polling if WS fails.
 */
export async function waitForTx(txId, timeoutMs = 300000) {
  if (MARKET_CLIENT_DEBUG) console.log(`⚡ waitForTx: ${txId}`);
  try {
    const result = await waitForTxViaWebSocket(txId, timeoutMs);
    if (MARKET_CLIENT_DEBUG) console.log("✅ waitForTx confirmed via WebSocket:", txId);
    return result;
  } catch (wsErr) {
    // If it's a real tx failure (not a WS connection error), re-throw immediately
    if (
      wsErr?.message?.includes("Transaction failed") ||
      wsErr?.message?.includes("abort_by")
    ) {
      throw wsErr;
    }
    if (MARKET_CLIENT_DEBUG)
      console.warn("⚠️ WebSocket failed, falling back to polling:", wsErr?.message);
    return pollTx(txId);
  }
}

// ------------------- EXPORTS FOR INTERNAL UTILITIES (OPTIONAL) -------------------
export const __marketClientInternals = {
  normalizeUInt,
  unwrapClarity,
  getFieldFromTuple,
  getNestedField,
};
