// ladderClient.js — Contract interaction for ladder/scalar markets (v21)
// Mirrors the patterns established in marketClient.js

import {
  uintCV,
  stringAsciiCV,
  fetchCallReadOnlyFunction,
  PostConditionMode,
} from "@stacks/transactions";
import { openContractCall } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import {
  authenticate,
  getWalletAddress,
  isMobileBrowser,
} from "../../utils/stacksConnect";

// ------------------- CONFIG -------------------
const NETWORK_NAME = (process.env.REACT_APP_STACKS_NETWORK || "mainnet").toLowerCase();
const CONTRACT_ADDRESS =
  process.env.REACT_APP_CONTRACT_ADDRESS || "SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA";
const CONTRACT_NAME = process.env.REACT_APP_CONTRACT_NAME || "market-factory-v21-testnet-bias";

const APP_DETAILS = {
  name: "StacksMarket",
  icon: "https://imglink.io/i/139bee27-a14b-4e2d-99c3-3b05d9cb6e53.png",
};

const network = NETWORK_NAME === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

// ------------------- INTERNAL HELPERS -------------------

async function ladderContractCall({ functionName, functionArgs = [] }) {
  // Honour the same mobile Leather workaround as marketClient.js
  const isLeatherMobile =
    isMobileBrowser() &&
    typeof window !== "undefined" &&
    Boolean(window.LeatherProvider);

  let postConditionMode = PostConditionMode.Allow;
  let postConditions = [];

  if (isLeatherMobile) {
    postConditionMode = PostConditionMode.Allow;
    postConditions = [];
  }

  // Ensure wallet is connected (same pattern as marketClient's ensureWalletAuth)
  let address = getWalletAddress();
  if (!address || isLeatherMobile) {
    address = await authenticate();
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
        onFinish: (data) => resolve(data),
        onCancel: () => reject(new Error("User cancelled")),
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function ladderContractRead({ functionName, functionArgs = [] }) {
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
    return result;
  } catch (err) {
    console.warn(`[ladderClient] Error reading ${functionName}:`, err?.message || err);
    throw err;
  }
}

// ------------------- CLARITY VALUE HELPERS -------------------

const normalizeUInt = (v) => {
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
  }
  return null;
};

const unwrapOk = (cv) => {
  // Handles {type: 'ok', value: ...} or plain value
  if (cv?.type === "ok" || cv?.type === 7) return cv.value ?? cv;
  return cv;
};

const getField = (tup, key) => {
  if (!tup) return null;
  const base = tup?.value ?? tup;
  if (base?.value && typeof base.value === "object" && key in base.value)
    return base.value[key];
  if (base && typeof base === "object" && key in base) return base[key];
  return null;
};

const parseStringField = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v?.value && typeof v.value === "string") return v.value;
  return String(v?.value ?? v ?? "");
};

const parseBool = (v) => {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (v?.value !== undefined) return Boolean(v.value);
  return Boolean(v);
};

// ------------------- READ-ONLY FUNCTIONS -------------------

/**
 * Fetches metadata for a ladder group.
 * Returns a plain JS object with: groupId, title, resolutionSource, closeTime, status
 */
export async function getLadderGroupInfo(groupId) {
  const result = await ladderContractRead({
    functionName: "get-ladder-group-info",
    functionArgs: [uintCV(Number(groupId))],
  });

  const inner = unwrapOk(result);
  if (!inner) return null;

  // If the contract returns (some {...}) or (ok (some {...}))
  const data = inner?.value ?? inner;
  if (!data) return null;

  return {
    groupId: Number(groupId),
    title: parseStringField(getField(data, "title")),
    resolutionSource: parseStringField(getField(data, "source")),
    closeTime: normalizeUInt(getField(data, "closeTime")),
    resolved: parseBool(getField(data, "resolved")),
  };
}

/**
 * Fetches info for a single rung (binary market within a ladder group).
 * Returns a plain JS object with: marketId, groupId, label, isResolved, outcome
 */
export async function getRungInfo(marketId) {
  const result = await ladderContractRead({
    functionName: "get-rung-info",
    functionArgs: [uintCV(Number(marketId))],
  });

  const inner = unwrapOk(result);
  if (!inner) return null;

  const data = inner?.value ?? inner;
  if (!data) return null;

  return {
    marketId: Number(marketId),
    groupId: normalizeUInt(getField(data, "group")),
    label: parseStringField(getField(data, "label")),
    isRung: parseBool(getField(data, "isRung")),
  };
}

/**
 * Returns true if the given marketId belongs to a ladder rung.
 */
export async function isRung(marketId) {
  const result = await ladderContractRead({
    functionName: "is-rung",
    functionArgs: [uintCV(Number(marketId))],
  });

  return parseBool(unwrapOk(result));
}

// ------------------- ADMIN TRANSACTION FUNCTIONS -------------------

/**
 * Creates a new ladder group on-chain.
 * Contract: (create-ladder-group (g uint) (title string-ascii 200) (source string-ascii 200) (close-time uint))
 */
export async function createLadderGroup(groupId, title, source, closeTime) {
  const g = Math.floor(Number(groupId));
  const ct = Math.floor(Number(closeTime));

  if (!Number.isFinite(g) || g <= 0) throw new Error("Invalid groupId");
  if (!Number.isFinite(ct) || ct < 0) throw new Error("Invalid closeTime");

  return ladderContractCall({
    functionName: "create-ladder-group",
    functionArgs: [
      uintCV(g),
      stringAsciiCV(String(title).slice(0, 200)),
      stringAsciiCV(String(source || "").slice(0, 200)),
      uintCV(ct),
    ],
  });
}

/**
 * Adds a rung to an existing ladder group.
 * Contract: (add-rung (g uint) (m uint) (label string-ascii 50) (initial-liquidity uint))
 */
export async function addRung(groupId, marketId, label, initialLiquidity) {
  const g = Math.floor(Number(groupId));
  const m = Math.floor(Number(marketId));
  const liq = Math.round(Number(initialLiquidity));

  if (!Number.isFinite(g) || g <= 0) throw new Error("Invalid groupId");
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");
  if (!Number.isFinite(liq) || liq <= 0) throw new Error("Invalid initialLiquidity");

  const lbl = String(label || "").slice(0, 50);

  return ladderContractCall({
    functionName: "add-rung",
    functionArgs: [
      uintCV(g),
      uintCV(m),
      stringAsciiCV(lbl),
      uintCV(liq),
    ],
  });
}

/**
 * Resolves an entire ladder group.
 * Contract: (resolve-ladder-group (g uint))
 */
export async function resolveLadderGroup(groupId) {
  const g = Math.floor(Number(groupId));

  if (!Number.isFinite(g) || g <= 0) throw new Error("Invalid groupId");

  return ladderContractCall({
    functionName: "resolve-ladder-group",
    functionArgs: [uintCV(g)],
  });
}

/**
 * Resolves a single rung after the group has been resolved.
 * Contract: (resolve-rung (m uint) (outcome string-ascii 3))
 */
export async function resolveRung(marketId, outcome) {
  const m = Math.floor(Number(marketId));
  if (!Number.isFinite(m) || m <= 0) throw new Error("Invalid marketId");

  const out = String(outcome || "").toUpperCase().slice(0, 3);
  if (out !== "YES" && out !== "NO") throw new Error("Invalid outcome — expected 'YES' or 'NO'");

  return ladderContractCall({
    functionName: "resolve-rung",
    functionArgs: [uintCV(m), stringAsciiCV(out)],
  });
}

