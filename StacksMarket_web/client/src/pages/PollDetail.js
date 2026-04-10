// PollDetail.js (v11-bias) — PARTE 1/2
// ✅ Estilo Polymarket (panel derecho: Buy/Sell + Yes/No pills + Amount + presets + To win)
// ✅ BUY = presupuesto en STX (quote-buy-*-by-sats + buy-*-auto)
// ✅ SELL = shares (quote-sell-* + sell-*-auto)

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "react-query";
import axios from "../setupAxios";
import LoadingSpinner from "../components/common/LoadingSpinner";
import { FaChartLine, FaClock } from "react-icons/fa";
import Redeem from "../components/layout/Redeem";
import { BACKEND_URL } from "../contexts/Bakendurl";
import { formatStx, stxToUstx, ustxToStxString, USTX_PER_STX } from "../utils/stx";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import CommentsSection from "../components/comments/CommentsSection";
import toast from "react-hot-toast";
import {
  getMarketSnapshot,
  getUserClaimable,
  getQuoteSellYes,
  getQuoteSellNo,
  getQuoteYesBySats,
  getQuoteNoBySats,
  buyYesBySatsAuto,
  buyNoBySatsAuto,
  sellYesAuto,
  sellNoAuto,
  redeem as redeemOnChain,
  ensureWalletSigner,
  waitForTx,
  getWalletStxBalance,
} from "../contexts/stacks/marketClient";
import { computeLmsrBinaryOdds } from "../components/common/lsmrOdds";

// ---------- UI: NumberInput con clamp min/max ----------
const NumberInput = ({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  placeholder = "0",
  disabled = false,
  className = "",
  readOnly = false,
}) => {
  const parse = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const roundInt = (n) => Math.round(n);

  const clamp = (n) => {
    let x = n;
    if (typeof max === "number") x = Math.min(x, max);
    if (typeof min === "number") x = Math.max(x, min);
    return x;
  };

  const handleChange = (raw) => {
    if (readOnly || disabled) return;
    if (raw === "") {
      onChange("");
      return;
    }
    const n = roundInt(parse(raw));
    const clamped = clamp(n);
    onChange(String(clamped));
  };

  const inc = () => {
    if (readOnly || disabled) return;
    const current = value === "" ? 0 : parse(value || 0);
    onChange(String(clamp(current + step)));
  };

  const dec = () => {
    if (readOnly || disabled) return;
    const current = value === "" ? 0 : parse(value || 0);
    onChange(String(clamp(current - step)));
  };

  return (
    <div className={`number-wrap ${disabled ? "opacity-60" : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className={`input number-input ${className}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        readOnly={readOnly}
      />
      <div className="number-steps">
        <button
          type="button"
          className="number-step"
          aria-label="Increase"
          onClick={inc}
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3">
            <path
              d="M6 14l6-6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
        <button
          type="button"
          className="number-step"
          aria-label="Decrease"
          onClick={dec}
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3">
            <path
              d="M6 10l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

// ---------- Helpers de unidades ----------
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

const unwrapClarity = (r) => r?.value ?? r?.okay ?? r;

const getFieldFromTuple = (tup, key) => {
  if (!tup) return null;
  const base = tup?.value ?? tup;
  if (base?.value && typeof base.value === "object" && key in base.value)
    return base.value[key];
  if (base && typeof base === "object" && key in base) return base[key];
  return null;
};

const getNestedField = (tup, path) => {
  let cur = tup?.value ?? tup;
  for (const k of path) {
    if (cur == null) return null;
    cur = cur?.value?.[k] ?? cur?.[k];
  }
  return cur;
};

const getAnyFieldFromTuple = (tup, keys) => {
  for (const k of keys) {
    const v = getFieldFromTuple(tup, k);
    if (v != null) return v;
  }
  return null;
};

const mapToNumber = (r) => {
  const v = unwrapClarity(r);
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);

  if (typeof v === "string") {
    const s = v.startsWith("u") ? v.slice(1) : v;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  if (typeof v === "object") {
    if (typeof v.value === "bigint") return Number(v.value);
    if (typeof v.value === "number") return v.value;

    if (typeof v.value === "string") {
      const s = v.value.startsWith("u") ? v.value.slice(1) : v.value;
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }

    if (typeof v.toString === "function") {
      const s0 = v.toString();
      const s = typeof s0 === "string" && s0.startsWith("u") ? s0.slice(1) : s0;
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }
  }

  return 0;
};

const cvToString = (r) => {
  const v = unwrapClarity(r);
  if (v == null) return "";
  if (typeof v === "string") return v;

  if (typeof v === "object") {
    if (typeof v.value === "string") return v.value;
    if (typeof v.value?.value === "string") return v.value.value;
  }

  try {
    return String(v?.value ?? v);
  } catch {
    return "";
  }
};

const mapToBool = (r) => {
  const v = unwrapClarity(r);
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  if (typeof v === "object" && v != null) {
    if (typeof v.value === "boolean") return v.value;
    if (typeof v.type === "number") {
      if (v.type === 3) return true;
      if (v.type === 4) return false;
    }
  }
  return false;
};

const parseProbability = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  }
  return null;
};


const formatEndInZones = (iso) => {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { utc: "", ny: "" };
    const utc = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    const ny = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return { utc, ny };
  } catch {
    return { utc: "", ny: "" };
  }
};

const TRADE_SYNC_QUEUE_KEY = "trade-sync-queue-v1";

const getTradeSyncQueue = () => {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(TRADE_SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const setTradeSyncQueue = (jobs) => {
  try {
    if (typeof window === "undefined") return;
    if (!jobs?.length) {
      window.localStorage.removeItem(TRADE_SYNC_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(TRADE_SYNC_QUEUE_KEY, JSON.stringify(jobs));
  } catch {}
};

const upsertTradeSyncJob = (job) => {
  if (!job?.intentId) return;
  const jobs = getTradeSyncQueue();
  const next = [
    ...jobs.filter((j) => !(j.intentId === job.intentId && j.kind === job.kind)),
    { ...job, updatedAt: Date.now() },
  ];
  setTradeSyncQueue(next);
};

const removeTradeSyncJob = ({ intentId, kind }) => {
  if (!intentId) return;
  const next = getTradeSyncQueue().filter((j) => {
    if (j.intentId !== intentId) return true;
    if (!kind) return false;
    return j.kind !== kind;
  });
  setTradeSyncQueue(next);
};

const makeClientOperationId = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

// ---------- Contract error mapping ----------
const CONTRACT_ERROR_MAP = {
  100: "Market is not open",
  703: "Invalid liquidity parameter",
  704: "Invalid amount",
  706: "Admin-only operation",
  712: "Market is insolvent — cannot resolve",
  720: "Market is paused",
  721: "Market not initialized",
  732: "Price moved too much (slippage) — try again",
  760: "Insufficient wallet balance",
  770: "You have no shares to sell",
  771: "Insufficient pool liquidity",
  772: "Refund calculation error",
  780: "Bias already locked",
  781: "Cannot set bias after trading started",
  782: "Invalid bias percentage",
  783: "Trade amount too large for current pool — try a smaller amount",
  784: "Market expired — trading is closed",
  786: "Deprecated parameter",
};
const mapContractError = (msg) => {
  if (!msg) return msg;
  const match = String(msg).match(/\(err u(\d+)\)/);
  if (!match) return msg;
  return CONTRACT_ERROR_MAP[Number(match[1])] || msg;
};

const buildBackendSyncPendingError = () => {
  const err = new Error(
    "Transaction confirmed on-chain, but backend sync is pending. We will retry automatically."
  );
  err.code = "BACKEND_SYNC_PENDING";
  return err;
};

// ---------- Componente principal ----------
export default function PollDetail() {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const normalizeWalletAddress = (address) =>
    String(address || "")
      .trim()
      .toLowerCase();

  const ensureWalletSessionMatchesSigner = async () => {
    const connectedSigner = await ensureWalletSigner();
    if (!connectedSigner) throw new Error("Wallet not connected");
    if (!user) throw new Error("Please sign in to trade");

    const sessionWallet = normalizeWalletAddress(user?.walletAddress);
    const signerWallet = normalizeWalletAddress(connectedSigner);
    if (sessionWallet && sessionWallet === signerWallet) return connectedSigner;

    logout();
    throw new Error(
      "Connected wallet does not match your session. Please re-login with the active wallet."
    );
  };

  // ✅ BUY = budget (STX)
  const [budget, setBudget] = useState("10");
  // ✅ SELL = amount (shares)
  const [amount, setAmount] = useState("");

  // Binario: 0 = YES, 1 = NO
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [tradeMode, setTradeMode] = useState("buy"); // buy | sell
  const [orderKind] = useState("market"); // UI placeholder (como Polymarket)

  const [contractLoading, setContractLoading] = useState(false);
  const [contractData, setContractData] = useState({
    outcome: "",
    status: "",
    paused: false,
    closeTime: 0,
    tradingOpenNow: false,
    pool: 0,
    yesSupply: 0,
    noSupply: 0,
    b: 0,
    qYesEff: 0,
    qNoEff: 0,
    optionBalance: { yes: 0, no: 0 },
    claimable: 0,
    winningShares: 0,
    canRedeem: false,
  });

  const [liveTrades, setLiveTrades] = useState([]);

  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [sellMaxShares, setSellMaxShares] = useState(null);

  const [walletBalanceUstx, setWalletBalanceUstx] = useState(0);

  const [chartRange, setChartRange] = useState("All");
  const [detailTab, setDetailTab] = useState("comments");

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(i);
  }, []);

  const [refreshKey, setRefreshKey] = useState(0);

  const RECENT_POLLS_KEY = "stacksmarket_recent_polls";
  const [recentPolls, setRecentPolls] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_POLLS_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    if (!user?.walletAddress) return;
    getWalletStxBalance(user.walletAddress).then(setWalletBalanceUstx);
  }, [user?.walletAddress]);

  // Debounce separado
  const [debouncedBudget, setDebouncedBudget] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBudget(budget), 300);
    return () => clearTimeout(t);
  }, [budget]);

  const [debouncedAmount, setDebouncedAmount] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedAmount(amount), 300);
    return () => clearTimeout(t);
  }, [amount]);

  // Datos del mercado (backend)
  const { data, isLoading, error } = useQuery(
    ["poll-detail", id],
    async () => (await axios.get(`${BACKEND_URL}/api/polls/${id}`)).data,
    { staleTime: 60 * 1000 }
  );

  const poll = data?.poll || data;

  const [isSaved, setIsSaved] = useState(false);
  useEffect(() => {
    setIsSaved(Boolean(poll?.isSaved));
  }, [poll?.isSaved]);

  // Track recently visited polls in localStorage
  useEffect(() => {
    if (!poll?._id || !poll?.title) return;
    const entry = { _id: poll._id, title: poll.title, image: poll.image || null };
    setRecentPolls((prev) => {
      const filtered = prev.filter((p) => p._id !== poll._id);
      const next = [entry, ...filtered].slice(0, 6);
      try { localStorage.setItem(RECENT_POLLS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [poll?._id]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const flushTradeSyncQueue = async () => {
      const jobs = getTradeSyncQueue();
      if (!jobs.length) return;

      for (const job of jobs) {
        if (cancelled) return;
        if (!job?.intentId || !job?.kind) continue;

        try {
          if (job.kind === "finalize_success") {
            await axios.post(`${BACKEND_URL}/api/trades/intents/${job.intentId}/finalize`, {
              txId: job.txId,
              chainStatus: "success",
            });
            removeTradeSyncJob({ intentId: job.intentId, kind: job.kind });
          } else if (job.kind === "finalize_failed") {
            await axios.post(`${BACKEND_URL}/api/trades/intents/${job.intentId}/finalize`, {
              txId: job.txId || undefined,
              chainStatus: "failed",
              failureReason: job.failureReason || "Transaction failed before backend sync",
            });
            removeTradeSyncJob({ intentId: job.intentId, kind: job.kind });
          }
        } catch (err) {
          const status = err?.response?.status;
          if (status === 404 || status === 409) {
            removeTradeSyncJob({ intentId: job.intentId, kind: job.kind });
          }
        }
      }
    };

    flushTradeSyncQueue();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const maxTradeUstx =
    Number.isFinite(Number(contractData?.maxTrade)) && Number(contractData.maxTrade) > 0
      ? Number(contractData.maxTrade)
      : typeof poll?.maxTradeLimit === "number" && poll.maxTradeLimit > 0
        ? poll.maxTradeLimit
        : null;
  const maxTradeStx =
    maxTradeUstx != null ? maxTradeUstx / USTX_PER_STX : null;

  const setBudgetCapped = (raw) => {
    const s = String(raw ?? "");
    const n = Number(s);
    if (!Number.isFinite(n)) {
      setBudget(s);
      return;
    }
    const capped = maxTradeStx != null ? Math.min(n, maxTradeStx) : n;
    setBudget(String(capped));
  };

  const getOptionImg = (opt, idx) => {
    if (opt?.image) return opt.image;
    if (poll?.category === "Sports") {
      if (idx === 0) return poll?.team1?.logo || poll?.image;
      if (idx === 1) return poll?.team2?.logo || poll?.image;
    }
    return poll?.image || "";
  };

  // Probabilidades LMSR on-chain (usando effectiveQ si existe)
  const { yesPct: yesPctOnChain, noPct: noPctOnChain } = useMemo(() => {
    const qYes =
      Number(contractData.qYesEff) > 0 || Number(contractData.qNoEff) > 0
        ? contractData.qYesEff
        : contractData.yesSupply;

    const qNo =
      Number(contractData.qYesEff) > 0 || Number(contractData.qNoEff) > 0
        ? contractData.qNoEff
        : contractData.noSupply;

    return computeLmsrBinaryOdds({
      b: contractData.b,
      qYes,
      qNo,
    });
  }, [
    contractData.b,
    contractData.yesSupply,
    contractData.noSupply,
    contractData.qYesEff,
    contractData.qNoEff,
  ]);

  // Display odds (percentage)
  const displayOdds = useMemo(() => {
    const hasOnChain =
      Number(contractData.b) > 0 &&
      Number(contractData.qYesEff + contractData.qNoEff) > 0 &&
      Number.isFinite(yesPctOnChain) &&
      Number.isFinite(noPctOnChain) &&
      yesPctOnChain > 0 &&
      noPctOnChain > 0;

    if (hasOnChain) {
      const y = Math.max(0, Math.min(100, Math.round(yesPctOnChain)));
      const n = Math.max(0, Math.min(100, 100 - y));
      return { yes: y, no: n, source: "onchain" };
    }

    const by = Number(poll?.options?.[0]?.percentage);
    const bn = Number(poll?.options?.[1]?.percentage);
    if (Number.isFinite(by) && Number.isFinite(bn) && by + bn > 0) {
      const sum = by + bn;
      const y = Math.max(0, Math.min(100, Math.round((by / sum) * 100)));
      const n = Math.max(0, Math.min(100, 100 - y));
      return { yes: y, no: n, source: "backend" };
    }

    const iy = Number(poll?.options?.[0]?.impliedProbability);
    const in_ = Number(poll?.options?.[1]?.impliedProbability);
    if (Number.isFinite(iy) && Number.isFinite(in_) && iy + in_ > 0) {
      const sum = iy + in_;
      const y = Math.max(0, Math.min(100, Math.round((iy / sum) * 100)));
      const n = Math.max(0, Math.min(100, 100 - y));
      return { yes: y, no: n, source: "backend-implied" };
    }

    return { yes: 50, no: 50, source: "fallback" };
  }, [
    contractData.b,
    contractData.qYesEff,
    contractData.qNoEff,
    yesPctOnChain,
    noPctOnChain,
    poll,
  ]);

  const isResolvedOnChain =
    (contractData?.status || "").toString().toLowerCase() === "resolved";
  const isResolved = poll?.isResolved || isResolvedOnChain;
  const hasOnChainMarket = Number.isFinite(Number(poll?.marketId));
  const isPaused = hasOnChainMarket ? !!contractData?.paused : false;
  const closeTimeMsOnChain =
    Number(contractData?.closeTime) > 0 ? Number(contractData.closeTime) * 1000 : null;
  const tradingOpenNowOnChain = !!contractData?.tradingOpenNow;

  const { utc: endUtc, ny: endNy } = formatEndInZones(poll?.endDate);

  // sincronizar trades desde backend
  useEffect(() => {
    const completedOnly = (data?.tradeHistory || []).filter(
      (t) => String(t?.status || "").toLowerCase() === "completed"
    );
    setLiveTrades(completedOnly);
  }, [data?.tradeHistory]);

  // estado global del mercado (pausado)
  const { data: marketStatus } = useQuery(
    ["market-status"],
    async () => (await axios.get(`${BACKEND_URL}/api/market/status`)).data,
    { staleTime: 10 * 1000 }
  );

  const { data: holdersData, isLoading: loadingHolders } = useQuery(
    ["poll-holders", id],
    async () => (await axios.get(`${BACKEND_URL}/api/polls/${id}/holders`)).data,
    { enabled: detailTab === "holders", staleTime: 30 * 1000 }
  );
  const isMarketPaused = hasOnChainMarket ? !!contractData?.paused : !!marketStatus?.paused;

  // ended por hora
  const isEnded = useMemo(() => {
    if (!poll) return false;
    if (isResolved) return true;
    if (hasOnChainMarket) {
      if (isPaused) return false;
      if (closeTimeMsOnChain != null) return closeTimeMsOnChain <= now;
      return !tradingOpenNowOnChain;
    }
    try {
      const endTs = new Date(poll.endDate).getTime();
      if (!Number.isFinite(endTs)) return false;
      return endTs <= now;
    } catch {
      return false;
    }
  }, [poll, isResolved, now, hasOnChainMarket, isPaused, closeTimeMsOnChain, tradingOpenNowOnChain]);

  // ---------- Lectura on-chain periódica ----------
  useEffect(() => {
    let mounted = true;
    let intervalId;

    async function fetchContract() {
      if (!poll?.marketId) return;
      const marketId = Number(poll.marketId);
      if (!Number.isFinite(marketId)) return;

      setContractLoading(true);
      try {
        const [snapRes, userClaimableRes] = await Promise.all([
          getMarketSnapshot(marketId),
          user?.walletAddress
            ? getUserClaimable(marketId, user.walletAddress).catch(() => null)
            : Promise.resolve(null),
        ]);
        const snap = unwrapClarity(snapRes);
        const userClaimable = userClaimableRes ? unwrapClarity(userClaimableRes) : null;

        const pool = mapToNumber(getFieldFromTuple(snap, "pool"));
        const outcome = cvToString(getFieldFromTuple(snap, "outcome"));
        const marketStatusStr = cvToString(getFieldFromTuple(snap, "status"));
        const paused = mapToBool(getFieldFromTuple(snap, "paused"));
        const closeTime = mapToNumber(getFieldFromTuple(snap, "closeTime"));
        const tradingOpenNow = mapToBool(getFieldFromTuple(snap, "tradingOpenNow"));
        const yesSupply = mapToNumber(getFieldFromTuple(snap, "yesSupply"));
        const noSupply = mapToNumber(getFieldFromTuple(snap, "noSupply"));
        const b = mapToNumber(getFieldFromTuple(snap, "b"));
        const qYes = mapToNumber(getFieldFromTuple(snap, "qYes"));
        const qNo = mapToNumber(getFieldFromTuple(snap, "qNo"));
        const rYes = mapToNumber(getFieldFromTuple(snap, "rYes"));
        const rNo = mapToNumber(getFieldFromTuple(snap, "rNo"));
        const maxTrade = mapToNumber(getFieldFromTuple(snap, "maxTrade"));
        const yesBalance = mapToNumber(
          getAnyFieldFromTuple(userClaimable, ["yesBalance", "yesBal"])
        );
        const noBalance = mapToNumber(
          getAnyFieldFromTuple(userClaimable, ["noBalance", "noBal"])
        );
        const claimable = mapToNumber(getFieldFromTuple(userClaimable, "claimable"));
        const winningShares = mapToNumber(getFieldFromTuple(userClaimable, "winningShares"));
        const canRedeem = mapToBool(getFieldFromTuple(userClaimable, "canRedeem"));

        const qYesEff =
          (Number.isFinite(qYes) ? qYes : 0) + (Number.isFinite(rYes) ? rYes : 0);
        const qNoEff =
          (Number.isFinite(qNo) ? qNo : 0) + (Number.isFinite(rNo) ? rNo : 0);

        if (mounted) {
          setContractData({
            outcome,
            status: marketStatusStr,
            paused: !!paused,
            closeTime: Number.isFinite(closeTime) ? closeTime : 0,
            tradingOpenNow: !!tradingOpenNow,
            pool,
            yesSupply,
            noSupply,
            b,
            qYesEff: Number.isFinite(qYesEff) ? qYesEff : 0,
            qNoEff: Number.isFinite(qNoEff) ? qNoEff : 0,
            maxTrade: Number.isFinite(maxTrade) ? maxTrade : 0,
            optionBalance: {
              yes: Number.isFinite(yesBalance) ? yesBalance : 0,
              no: Number.isFinite(noBalance) ? noBalance : 0,
            },
            claimable: Number.isFinite(claimable) ? claimable : 0,
            winningShares: Number.isFinite(winningShares) ? winningShares : 0,
            canRedeem: !!canRedeem,
          });
        }
      } catch {
        // silencio
      } finally {
        if (mounted) setContractLoading(false);
      }
    }

    if (!poll?.marketId) return;

    fetchContract();
    intervalId = setInterval(fetchContract, 15000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [poll?.marketId, user?.walletAddress, refreshKey]);

  // ---------- Trades del usuario & posiciones ----------
  const userTrades = useMemo(() => {
    if (!user || !liveTrades) return [];
    return liveTrades.filter(
      (t) => t.user === user._id || (t.user && t.user._id === user._id)
    );
  }, [user, liveTrades]);

  const userPositions = useMemo(() => {
    if (!user || !poll?.options) return [];
    const n = poll.options.length;
    const yesBal = Math.max(
      0,
      Math.floor(Number(contractData?.optionBalance?.yes) || 0)
    );
    const noBal = Math.max(
      0,
      Math.floor(Number(contractData?.optionBalance?.no) || 0)
    );

    return Array.from({ length: n }, (_v, idx) => {
      const buys = userTrades.filter(
        (t) => t.type === "buy" && t.optionIndex === idx && t.status === "completed"
      );
      const totalCostUstx = buys.reduce((sum, t) => sum + (Number(t.totalValue) || 0), 0);
      const totalShares = buys.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      const avgPriceUstxPerShare = totalShares > 0 ? totalCostUstx / totalShares : 0;
      return {
        netShares: idx === 0 ? yesBal : idx === 1 ? noBal : 0,
        totalCostUstx,
        avgPriceUstxPerShare,
      };
    });
  }, [user, poll?.options, userTrades, contractData?.optionBalance?.yes, contractData?.optionBalance?.no]);

  const selectedPosition =
    poll?.options && userPositions[selectedOptionIndex]
      ? userPositions[selectedOptionIndex]
      : { netShares: 0, avgPriceUstxPerShare: 0 };

  const maxSellShares = useMemo(() => {
    const net = Math.max(0, Math.floor(selectedPosition?.netShares || 0));
    if (sellMaxShares == null) return net;
    return Math.max(0, Math.min(net, sellMaxShares));
  }, [selectedPosition?.netShares, sellMaxShares]);

  useEffect(() => {
    if (tradeMode !== "sell") return;
    const current = Math.round(Number(amount) || 0);
    if (Number.isFinite(current) && current > maxSellShares) {
      setAmount(String(maxSellShares));
    }
  }, [tradeMode, amount, maxSellShares]);

  useEffect(() => {
    let cancelled = false;

    async function computeSellMaxShares() {
      if (tradeMode !== "sell") {
        setSellMaxShares(null);
        return;
      }
      if (!poll?.marketId) {
        setSellMaxShares(null);
        return;
      }
      if (!maxTradeUstx || maxTradeUstx <= 0) {
        setSellMaxShares(null);
        return;
      }

      const pos = userPositions[selectedOptionIndex];
      const maxHoldings = Math.max(0, Math.floor(pos?.netShares || 0));
      if (maxHoldings <= 0) {
        setSellMaxShares(0);
        return;
      }

      const marketId = Number(poll.marketId);
      const isYes = selectedOptionIndex === 0;
      const quoteFn = isYes ? getQuoteSellYes : getQuoteSellNo;

      const getProceeds = async (amt) => {
        const qr = await quoteFn(marketId, amt);
        const qv = unwrapClarity(qr);
        const proceeds = normalizeUInt(getFieldFromTuple(qv, "proceeds"));
        return Number.isFinite(proceeds) ? proceeds : null;
      };

      try {
        const proceedsMax = await getProceeds(maxHoldings);
        if (!cancelled && proceedsMax != null && proceedsMax <= maxTradeUstx) {
          setSellMaxShares(maxHoldings);
          return;
        }

        let lo = 1;
        let hi = maxHoldings;
        let best = 0;
        let guard = 0;

        while (lo <= hi && guard < 24) {
          guard += 1;
          const mid = Math.floor((lo + hi) / 2);
          const proceeds = await getProceeds(mid);
          if (proceeds == null) {
            hi = mid - 1;
            continue;
          }
          if (proceeds <= maxTradeUstx) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        if (!cancelled) setSellMaxShares(best);
      } catch {
        if (!cancelled) setSellMaxShares(null);
      }
    }

    computeSellMaxShares();
    return () => {
      cancelled = true;
    };
  }, [
    tradeMode,
    poll?.marketId,
    maxTradeUstx,
    selectedOptionIndex,
    userPositions,
  ]);

  // ---------- Quote (BUY by STX / SELL by shares) ----------
  useEffect(() => {
    if (!poll?.marketId) return;

    if (isEnded || isResolved || isMarketPaused) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    const marketId = Number(poll.marketId);
    const isYes = selectedOptionIndex === 0;

    let cancelled = false;

    async function fetchQuote() {
      setQuoteLoading(true);
      setQuoteError(null);

      try {
        if (tradeMode === "buy") {
          const budUstx = stxToUstx(debouncedBudget);
          if (!Number.isFinite(budUstx) || budUstx <= 0) {
            setQuote(null);
            setQuoteError(null);
            setQuoteLoading(false);
            return;
          }
          if (maxTradeUstx != null && budUstx > maxTradeUstx) {
            setQuote(null);
            setQuoteError(
              `Max trade is ${ustxToStxString(maxTradeUstx, { maxDecimals: 6 })} STX per tx`
            );
            setQuoteLoading(false);
            return;
          }

          // quote-by-budget (uSTX) => { shares, quote: { cost, feeProtocol, feeLP, total } }
          const qr = isYes
            ? await getQuoteYesBySats(marketId, budUstx)
            : await getQuoteNoBySats(marketId, budUstx);

          const qv = unwrapClarity(qr);

          const shares = normalizeUInt(getNestedField(qv, ["shares"])) || 0;

          const cost = normalizeUInt(getNestedField(qv, ["quote", "cost"]));
          const feeProtocol = normalizeUInt(getNestedField(qv, ["quote", "feeProtocol"]));
          const feeLP = normalizeUInt(getNestedField(qv, ["quote", "feeLP"]));
          const total = normalizeUInt(getNestedField(qv, ["quote", "total"]));

          const perShareUstx = shares > 0 && total != null ? total / shares : null;

          if (!cancelled) setQuote({ shares, cost, feeProtocol, feeLP, total, perShareUstx });
          return;
        }

        // SELL
        const amtNum = Math.round(Number(debouncedAmount));
        if (!Number.isFinite(amtNum) || amtNum <= 0) {
          setQuote(null);
          setQuoteError(null);
          setQuoteLoading(false);
          return;
        }

        const maxSell = maxSellShares;

        if (maxSell <= 0) {
          setQuote(null);
          setQuoteError("You have no shares to sell for this option");
          setQuoteLoading(false);
          return;
        }

        if (amtNum > maxSell) {
          setQuote(null);
          setQuoteError(`Max sell is ${maxSell} shares`);
          setQuoteLoading(false);
          return;
        }

        const qr = isYes
          ? await getQuoteSellYes(marketId, amtNum)
          : await getQuoteSellNo(marketId, amtNum);

        const qv = unwrapClarity(qr);

        const feeProtocol = normalizeUInt(getFieldFromTuple(qv, "feeProtocol"));
        const feeLP = normalizeUInt(getFieldFromTuple(qv, "feeLP"));
        const total = normalizeUInt(getFieldFromTuple(qv, "total"));
        const proceeds = normalizeUInt(getFieldFromTuple(qv, "proceeds"));

        const perShareUstx = amtNum > 0 && total != null ? total / amtNum : null;

        if (!cancelled) {
          if (maxTradeUstx != null && Number.isFinite(total) && total > maxTradeUstx) {
            setQuote(null);
            setQuoteError(
              `Max trade is ${ustxToStxString(maxTradeUstx, { maxDecimals: 6 })} STX per tx`
            );
            setQuoteLoading(false);
            return;
          }
          setQuote({
            shares: amtNum,
            cost: proceeds,
            feeProtocol,
            feeLP,
            total,
            perShareUstx,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err?.message || String(err));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [
    poll?.marketId,
    selectedOptionIndex,
    tradeMode,
    debouncedBudget,
    debouncedAmount,
    maxTradeUstx,
    isEnded,
    isResolved,
    isMarketPaused,
    refreshKey,
  ]);

  const quoteFeesTotal =
    (normalizeUInt(quote?.feeProtocol) || 0) + (normalizeUInt(quote?.feeLP) || 0);

  const sharesFromQuote = Number(quote?.shares) || 0;

  const potentialWinUstx =
    tradeMode === "buy" ? sharesFromQuote * USTX_PER_STX : 0;
  const budgetUstx = stxToUstx(budget);
  const budgetStxDisplay = Number.isFinite(budgetUstx)
    ? ustxToStxString(budgetUstx, { maxDecimals: 6 })
    : "0";
  const buyTotalUstx =
    tradeMode === "buy" && Number.isFinite(quote?.total) ? Number(quote.total) : null;
  const buyTotalStxDisplay =
    buyTotalUstx != null ? ustxToStxString(buyTotalUstx, { maxDecimals: 6 }) : null;

  // ---------- Save / watchlist ----------
  const saveMutation = useMutation(
    async () => {
      if (!user) throw new Error("Please sign in to save markets");
      if (!poll?._id) throw new Error("Missing poll id");
      return (await axios.post(`${BACKEND_URL}/api/polls/${poll._id}/save`)).data;
    },
    {
      onSuccess: (res) => {
        toast.success(res?.message || "Updated watchlist");
        setIsSaved(res.saved);
        queryClient.invalidateQueries(["user-dashboard"]);
        queryClient.setQueriesData(
          { predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("home-") },
          (old) => {
            if (!old?.polls) return old;
            return { ...old, polls: old.polls.map((p) => String(p._id) === String(poll?._id) ? { ...p, isSaved: res.saved } : p) };
          }
        );
      },
      onError: (err) =>
        toast.error(err?.response?.data?.message || err.message || "Save failed"),
    }
  );

  const runOnChainTradeWithIntent = async ({ intentPayload, executeTx }) => {
    const clientOperationId = makeClientOperationId();
    const intentRes = await axios.post(`${BACKEND_URL}/api/trades/intents`, {
      ...intentPayload,
      clientOperationId,
    });

    const intentId = intentRes?.data?.trade?._id;
    if (!intentId) throw new Error("Failed to create trade intent");

    let txId = null;

    try {
      const txResult = await executeTx();
      txId = txResult?.txId || txResult?.tx_id || txResult?.txid || null;
      if (!txId) throw new Error("No txId");

      const attachPromise = axios
        .post(`${BACKEND_URL}/api/trades/intents/${intentId}/attach-tx`, { txId })
        .catch((attachErr) => {
          const status = attachErr?.response?.status;
          if (status && status < 500) throw attachErr;
        });

      await Promise.all([attachPromise, waitForTx(txId)]);

      try {
        const finalizedRes = await axios.post(
          `${BACKEND_URL}/api/trades/intents/${intentId}/finalize`,
          { txId, chainStatus: "success" }
        );
        removeTradeSyncJob({ intentId, kind: "finalize_success" });
        return finalizedRes.data;
      } catch (syncErr) {
        const status = syncErr?.response?.status;
        if (status && status < 500) throw syncErr;
        upsertTradeSyncJob({ intentId, kind: "finalize_success", txId });
        throw buildBackendSyncPendingError();
      }
    } catch (err) {
      if (err?.code === "BACKEND_SYNC_PENDING") throw err;

      const errMsg = String(err?.message || "");
      const shouldMarkFailed = !txId || errMsg.includes("Transaction failed");

      if (shouldMarkFailed) {
        try {
          await axios.post(`${BACKEND_URL}/api/trades/intents/${intentId}/finalize`, {
            txId: txId || undefined,
            chainStatus: "failed",
            failureReason: errMsg || "Hiro transaction failed",
          });
          removeTradeSyncJob({ intentId, kind: "finalize_failed" });
        } catch (finalizeFailErr) {
          const status = finalizeFailErr?.response?.status;
          if (!status || status >= 500) {
            upsertTradeSyncJob({
              intentId,
              kind: "finalize_failed",
              txId: txId || undefined,
              failureReason: errMsg || "Hiro transaction failed",
            });
          }
        }
      }

      throw err;
    }
  };

  // ---------- Trade mutation ----------
  const tradeMutation = useMutation(
    async () => {
      const side = tradeMode; // buy|sell
      const isYes = selectedOptionIndex === 0;

      if (!user) throw new Error("Please sign in to trade");
      if (!poll?.marketId) throw new Error("Missing marketId");
      const marketId = Number(poll.marketId);
      await ensureWalletSessionMatchesSigner();

      if (isEnded) throw new Error("Market is closed for new trades");
      if (!quote || quote.total == null) throw new Error("Missing quote");

      // ---------- BUY (budget STX) ----------
      if (side === "buy") {
        const budUstx = stxToUstx(budget);
        if (!Number.isFinite(budUstx) || budUstx <= 0) {
          throw new Error("Invalid amount (STX)");
        }
        if (!sharesFromQuote || sharesFromQuote <= 0) {
          throw new Error("Amount too low for any shares");
        }
        if (maxTradeUstx != null && budUstx > maxTradeUstx) {
          throw new Error(
            `Max trade is ${ustxToStxString(maxTradeUstx, { maxDecimals: 6 })} STX per tx`
          );
        }

        let probForDb = (isYes ? displayOdds.yes : displayOdds.no) / 100;
        let postYesPct = null;
        let postNoPct = null;

        if (!Number.isFinite(probForDb) || probForDb < 0 || probForDb > 1) {
          throw new Error("Invalid implied probability");
        }

        const totalValueUstx = normalizeUInt(quote.total);
        if (!Number.isFinite(totalValueUstx) || totalValueUstx < 0) {
          throw new Error("Invalid quote total");
        }
        const userUstx = normalizeUInt(quote.cost);
        const feeProtocolUstx = normalizeUInt(quote.feeProtocol);
        const feeLPUstx = normalizeUInt(quote.feeLP);

        const intentPayload = {
          pollId: id,
          type: "buy",
          optionIndex: selectedOptionIndex,
          amount: sharesFromQuote,     // shares compradas exactas
          price: probForDb,           // 0–1
          totalValue: totalValueUstx, // uSTX gastados reales
          userSats: userUstx,
          totalSats: totalValueUstx,
          feeProtocol: feeProtocolUstx,
          feeLP: feeLPUstx,
          orderType: "market",
        };

        const saved = await runOnChainTradeWithIntent({
          intentPayload,
          executeTx: async () =>
            isYes ? buyYesBySatsAuto(marketId, budUstx) : buyNoBySatsAuto(marketId, budUstx),
        });

        if (poll?.options?.length === 2) {
          try {
            const snapRes = await getMarketSnapshot(marketId);
            const snap = unwrapClarity(snapRes);

            const yesSupply = mapToNumber(getFieldFromTuple(snap, "yesSupply"));
            const noSupply = mapToNumber(getFieldFromTuple(snap, "noSupply"));
            const b = mapToNumber(getFieldFromTuple(snap, "b"));
            const rYes = mapToNumber(getFieldFromTuple(snap, "rYes"));
            const rNo = mapToNumber(getFieldFromTuple(snap, "rNo"));

            const qYesEff =
              (Number.isFinite(yesSupply) ? yesSupply : 0) + (Number.isFinite(rYes) ? rYes : 0);
            const qNoEff =
              (Number.isFinite(noSupply) ? noSupply : 0) + (Number.isFinite(rNo) ? rNo : 0);

            const { yesPct: yPct, noPct: nPct } = computeLmsrBinaryOdds({
              b,
              qYes: qYesEff,
              qNo: qNoEff,
            });

            if (Number.isFinite(yPct) && Number.isFinite(nPct)) {
              postYesPct = Math.max(0, Math.min(100, Math.round(yPct)));
              postNoPct = Math.max(0, Math.min(100, 100 - postYesPct));
            }
          } catch {
            // fallback a displayOdds
          }
        }

        if (postYesPct != null && postNoPct != null) {
          try {
            await axios.patch(`${BACKEND_URL}/api/polls/${id}/odds`, {
              yesPct: postYesPct,
              noPct: postNoPct,
            });
          } catch {}
        }

        return saved;
      }

      // ---------- SELL (shares) ----------
      const amt = Math.round(Number(amount) || 0);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount");

      const maxSell = maxSellShares;
      if (maxSell <= 0) throw new Error("You have no shares to sell for this option");

      if (amt > maxSell) {
        throw new Error(`Max sell is ${maxSell} shares`);
      }

      let probForDb = (isYes ? displayOdds.yes : displayOdds.no) / 100;
      if (!Number.isFinite(probForDb) || probForDb < 0 || probForDb > 1) {
        throw new Error("Invalid implied probability");
      }

      const totalUstx = normalizeUInt(quote.total);
      if (!Number.isFinite(totalUstx) || totalUstx < 0) throw new Error("Invalid quote total");
      if (maxTradeUstx != null && totalUstx > maxTradeUstx) {
        throw new Error(
          `Max trade is ${ustxToStxString(maxTradeUstx, { maxDecimals: 6 })} STX per tx`
        );
      }
      const userUstx = normalizeUInt(quote.cost);
      const feeProtocolUstx = normalizeUInt(quote.feeProtocol);
      const feeLPUstx = normalizeUInt(quote.feeLP);

      const intentPayload = {
        pollId: id,
        type: "sell",
        optionIndex: selectedOptionIndex,
        amount: amt,
        price: probForDb,
        totalValue: totalUstx,
        userSats: userUstx,
        totalSats: totalUstx,
        feeProtocol: feeProtocolUstx,
        feeLP: feeLPUstx,
        orderType: "market",
      };

      const saved = await runOnChainTradeWithIntent({
        intentPayload,
        executeTx: async () => (isYes ? sellYesAuto(marketId, amt) : sellNoAuto(marketId, amt)),
      });
      return saved;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["poll-detail", id]);
        queryClient.invalidateQueries(["trades", id]);
        queryClient.invalidateQueries({ queryKey: ["polls"], exact: false });
        queryClient.invalidateQueries(["user-dashboard"]);

        setAmount("");
        setRefreshKey((k) => k + 1);
        toast.success("Trade placed");
      },
      onError: (err) => {
        const status = err?.response?.status;
        const raw = err?.response?.data?.message || err.message || "Trade failed";
        const message = mapContractError(raw);
        if (status === 403) logout();
        toast.error(message);
      },
    }
  );

  // ---------- Redeem ----------
  const redeemMutation = useMutation(
    async () => {
      if (!poll?.marketId) throw new Error("Missing marketId");
      await ensureWalletSessionMatchesSigner();
      const marketId = Number(poll.marketId);

      const tx = await redeemOnChain(marketId);
      const txId = tx?.txId || tx?.tx_id || tx?.txid || null;
      if (!txId) throw new Error("No txId for redeem");

      await waitForTx(txId);

      // Backend persistence is async best-effort; on-chain confirmation is source of truth.
      axios
        .post(`${BACKEND_URL}/api/trades/redeem`, { pollId: id, txid: txId })
        .catch(() => {});

      return { txId };
    },
    {
      onSuccess: () => {
        toast.success("Redeemed on-chain");
        setRefreshKey((k) => k + 1);
        queryClient.invalidateQueries(["poll-detail", id]);
        queryClient.invalidateQueries(["trades", id]);
        queryClient.invalidateQueries(["user-dashboard"]);
      },
      onError: (err) => {
        const status = err?.response?.status;
        const raw = err?.response?.data?.message || err.message || "Redeem failed";
        const message = mapContractError(raw);
        if (status === 403) logout();
        toast.error(message);
      },
    }
  );

  // ---------- Loading / error ----------
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !poll) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Failed to load poll
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const timeRemainingLabel = (() => {
    try {
      const endTs = new Date(poll.endDate).getTime();
      const diff = endTs - now;
      if (!Number.isFinite(diff) || diff <= 0) return "Ended";
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (days > 0) return `${days}d left`;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours > 0) return `${hours}h left`;
      const mins = Math.floor(diff / (1000 * 60));
      return `${mins}m left`;
    } catch {
      return "";
    }
  })();

  const userHasAnyPosition =
    userPositions && userPositions.some((p) => p.netShares > 0);

  const userBalanceUstx = walletBalanceUstx > 0 ? walletBalanceUstx : 0;

  const userBalanceStxLabel =
    userBalanceUstx > 0 ? formatStx(userBalanceUstx) : "";

  // -------------------- JSX (PARTE 2/2 continúa en el siguiente mensaje) --------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="w-full flex-1 min-w-0 flex items-start sm:items-center gap-4">
              <div className="header-thumb header-thumb--lg">
                {poll.image ? (
                  <img
                    src={poll.image}
                    alt={poll.title}
                    className="w-full h-full object-cover rounded-md"
                  />
                ) : (
                  <div className="w-full h-full rounded-md bg-gray-200 dark:bg-gray-700" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="pill">{poll.category}</span>
                  {poll.subCategory && <span className="pill">{poll.subCategory}</span>}
                </div>

                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 text-balance">
                  {poll.title}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a href={`/poll/${poll._id}`} className="btn-outline btn-sm" title="Market link">
                    Market link
                  </a>

                  <button
                    className="btn-outline btn-sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={!user || saveMutation.isLoading}
                    title={!user ? "Sign in to save" : isSaved ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    {saveMutation.isLoading ? "…" : isSaved ? "Remove from watchlist" : "Add to watchlist"}
                  </button>
                </div>
              </div>
            </div>

            <div className="w-full sm:w-auto shrink-0 text-left sm:text-right">
              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-start sm:justify-end gap-2">
                <FaClock className="w-4 h-4" />
                <span>{timeRemainingLabel}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-start sm:justify-end gap-2">
                <FaChartLine className="w-4 h-4" />
                <span>{poll.totalVolume != null ? formatStx(poll.totalVolume) : "0 STX"}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Ends</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                UTC: <span className="text-gray-900 dark:text-gray-100">{endUtc}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                New York (ET): <span className="text-gray-900 dark:text-gray-100">{endNy}</span>
              </div>

              {contractLoading && (
                <div className="mt-2 text-[10px] text-gray-400">Reading on-chain…</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="order-2 lg:order-1 lg:col-span-2 space-y-6">
          {/* Chart */}
          {poll?.options?.length > 0 && (
            <div className="section-card p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Price history (implied probabilities)
                </span>

                <div className="tabs sm:ml-auto overflow-x-auto max-w-full">
                  {["Day", "Week", "Month", "Year", "All"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setChartRange(r)}
                      className={`tab ${chartRange === r ? "tab-active" : ""}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>

              </div>

              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={(() => {
                      const all = (liveTrades.length ? liveTrades : data?.tradeHistory) || [];
                      if (!all.length) return [];

                      const nowTs = now;
                      let minTime = 0;
                      const oneDay = 24 * 60 * 60 * 1000;

                      switch (chartRange) {
                        case "Day":
                          minTime = nowTs - oneDay;
                          break;
                        case "Week":
                          minTime = nowTs - 7 * oneDay;
                          break;
                        case "Month":
                          minTime = nowTs - 30 * oneDay;
                          break;
                        case "Year":
                          minTime = nowTs - 365 * oneDay;
                          break;
                        case "All":
                        default:
                          minTime = 0;
                      }

                      const filtered = all.filter((t) => {
                        const ts = new Date(t.createdAt).getTime();
                        return ts >= minTime;
                      });
                      if (!filtered.length) return [];

                      const grouped = {};
                      filtered
                        .slice()
                        .reverse()
                        .forEach((t) => {
                          const minute = new Date(t.createdAt);
                          minute.setSeconds(0, 0);
                          const key = minute.toISOString();
                          if (!grouped[key]) grouped[key] = [];
                          grouped[key].push(t);
                        });

                      const binarySeedYes =
                        poll.options.length === 2 &&
                        Number.isFinite(Number(displayOdds?.yes))
                          ? Math.max(0, Math.min(1, Number(displayOdds.yes) / 100))
                          : null;
                      const binarySeedNo =
                        binarySeedYes != null ? Math.max(0, Math.min(1, 1 - binarySeedYes)) : null;
                      const lastPrice = Array.from({ length: poll.options.length }, (_v, idx) => {
                        if (poll.options.length === 2 && binarySeedYes != null && binarySeedNo != null) {
                          return idx === 0 ? binarySeedYes : binarySeedNo;
                        }
                        return 0.5;
                      });
                      const firstTrade = filtered
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a?.createdAt).getTime() - new Date(b?.createdAt).getTime()
                        )
                        .find((t) => parseProbability(t?.price) != null);

                      if (firstTrade && poll.options.length === 2) {
                        const idx =
                          typeof firstTrade.optionIndex === "number"
                            ? firstTrade.optionIndex
                            : Number(firstTrade.optionIndex);
                        const p = parseProbability(firstTrade?.price);
                        if (p != null) {
                          if (idx === 0) {
                            lastPrice[0] = p;
                            lastPrice[1] = 1 - p;
                          } else if (idx === 1) {
                            lastPrice[1] = p;
                            lastPrice[0] = 1 - p;
                          }
                        }
                      }

                      const points = [];
                      points.push(
                        poll.options.reduce(
                          (acc, _opt, idx) => {
                            const p = lastPrice[idx] ?? 0.5;
                            acc[`o${idx}`] = Math.round(p * 100);
                            return acc;
                          },
                          { time: "Start" }
                        )
                      );
                      const keys = Object.keys(grouped).sort();

                      keys.forEach((k) => {
                        const tradesAt = grouped[k];
                        const seen = new Set();

                        tradesAt.forEach((t) => {
                          const idx = typeof t.optionIndex === "number" ? t.optionIndex : -1;
                          if (idx < 0 || idx >= poll.options.length) return;
                          const p = parseProbability(t.price);
                          if (p != null) {
                            lastPrice[idx] = p;
                            seen.add(idx);
                          }
                        });

                        if (poll.options.length === 2) {
                          if (seen.has(0) && !seen.has(1)) lastPrice[1] = 1 - lastPrice[0];
                          else if (seen.has(1) && !seen.has(0)) lastPrice[0] = 1 - lastPrice[1];
                        }

                        const point = {
                          time: new Date(k).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        };

                        poll.options.forEach((opt, idx) => {
                          const p = lastPrice[idx] ?? 0.5;
                          point[`o${idx}`] = Math.round(p * 100);
                        });

                        points.push(point);
                      });

                      // Ensure the chart ends at the current displayed odds (binary markets).
                      if (poll.options.length === 2) {
                        const currentYes = Math.max(
                          0,
                          Math.min(100, Math.round(Number(displayOdds?.yes)))
                        );
                        const currentNo = Math.max(
                          0,
                          Math.min(100, Math.round(Number(displayOdds?.no)))
                        );

                        if (Number.isFinite(currentYes) && Number.isFinite(currentNo)) {
                          const last = points[points.length - 1] || null;
                          const lastYes = Number(last?.o0);
                          const lastNo = Number(last?.o1);

                          if (lastYes !== currentYes || lastNo !== currentNo) {
                            points.push({ time: "Now", o0: currentYes, o1: currentNo });
                          }
                        }
                      }

                      return points;
                    })()}
                    margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#1f2937",
                        border: "1px solid #374151",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(val) => [`${val}%`]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                    {poll.options.map((opt, idx) => (
                      <Line
                        key={idx}
                        type="monotone"
                        dataKey={`o${idx}`}
                        name={opt.text}
                        stroke={
                          ["#3B82F6", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899"][idx % 6]
                        }
                        dot={false}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Positions summary */}
          {user && userHasAnyPosition && (
            <div className="section-card p-4">
              <h4 className="section-title mb-3">Your positions</h4>
              <div className="space-y-2">
                {poll.options.map((opt, idx) => {
                  const pos = userPositions[idx];
                  if (!pos || pos.netShares <= 0) return null;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm border border-gray-100 dark:border-gray-700 rounded-md px-3 py-2"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{opt.text}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Avg entry: {formatStx(pos.avgPriceUstxPerShare, { minDecimals: 6, maxDecimals: 6 })} / share
                        </span>
                      </div>

                      <div className="text-right">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{pos.netShares} shares</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          Payout if wins: {formatStx(pos.netShares * USTX_PER_STX)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolution */}
          <div className="section-card p-4">
            <h4 className="section-title mb-2">Resolution</h4>
            {poll.resolutionLink && (
              <a
                href={poll.resolutionLink}
                className="text-sm text-primary-600 dark:text-primary-400 underline"
              >
                {poll.resolutionLink}
              </a>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
              {poll.description ||
                poll.resolutionNote ||
                "The market will be resolved based on the linked source."}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center justify-center sm:justify-between mt-6 mb-3">
            <div className="tabs overflow-x-auto max-w-full">
              <button
                className={`tab ${detailTab === "comments" ? "tab-active" : ""}`}
                onClick={() => setDetailTab("comments")}
              >
                Comments
              </button>
              <button
                className={`tab ${detailTab === "holders" ? "tab-active" : ""}`}
                onClick={() => setDetailTab("holders")}
              >
                Top holders
              </button>
              <button
                className={`tab ${detailTab === "txs" ? "tab-active" : ""}`}
                onClick={() => setDetailTab("txs")}
              >
                Transactions
              </button>
            </div>
          </div>

          {detailTab === "comments" && <CommentsSection pollId={poll._id} />}

          {detailTab === "holders" && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Top holders</h3>
              {loadingHolders ? (
                <LoadingSpinner />
              ) : !holdersData?.holders?.length ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No holders yet.</p>
              ) : (() => {
                const yesLabel = holdersData.options?.[0]?.text || "Yes";
                const noLabel  = holdersData.options?.[1]?.text || "No";
                const yesHolders = holdersData.holders
                  .filter((h) => h.optionIndex === 0)
                  .sort((a, b) => b.netShares - a.netShares);
                const noHolders = holdersData.holders
                  .filter((h) => h.optionIndex === 1)
                  .sort((a, b) => b.netShares - a.netShares);
                const maxRows = Math.max(yesHolders.length, noHolders.length);

                const HolderCol = ({ holders, label, colorClass }) => (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between pb-2 mb-1 border-b border-gray-100 dark:border-gray-700">
                      <span className={`text-sm font-semibold ${colorClass}`}>{label}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">Shares</span>
                    </div>
                    {holders.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 py-2">No holders</p>
                    ) : (
                      holders.map((h, i) => {
                        const rawName = h.username || h.walletAddress || "Unknown";
                        const name = rawName;
                        return (
                          <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xs text-gray-400 dark:text-gray-500 w-5 text-right shrink-0">{i + 1}</span>
                              <span className="text-sm text-gray-800 dark:text-gray-200 font-mono break-all">{name}</span>
                            </div>
                            <span className={`text-sm font-semibold shrink-0 ml-4 ${colorClass}`}>{h.netShares.toLocaleString()}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                );

                return (
                  <div className="flex flex-col gap-6">
                    <HolderCol holders={yesHolders} label={yesLabel} colorClass="text-emerald-600 dark:text-emerald-400" />
                    <HolderCol holders={noHolders} label={noLabel} colorClass="text-red-500 dark:text-red-400" />
                  </div>
                );
              })()}
            </div>
          )}

          {detailTab === "txs" && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Recent Trades
              </h3>
              {liveTrades.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No trades yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="py-2 pr-4">Time</th>
                        <th className="py-2 pr-4">Side</th>
                        <th className="py-2 pr-4">Option</th>
                        <th className="py-2 pr-4">Amount (shares)</th>
                        <th className="py-2 pr-4">Price (probability)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveTrades.slice(0, 15).map((t) => {
                        const p = parseProbability(t.price);
                        const pLabel = p != null ? `${(p * 100).toFixed(2)}%` : "-";

                        return (
                          <tr
                            key={t._id || `${t.createdAt}-${t.optionIndex}-${t.amount}-${t.type}`}
                            className="border-t border-gray-100 dark:border-gray-700"
                          >
                            <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                              {new Date(t.createdAt).toLocaleString()}
                            </td>
                            <td
                              className={`py-2 pr-4 font-semibold ${
                                (t.type || "").toLowerCase() === "sell"
                                  ? "text-red-500"
                                  : "text-emerald-600"
                              }`}
                            >
                              {(t.type || "").toUpperCase()}
                            </td>
                            <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                              {poll.options[t.optionIndex]?.text || t.optionIndex}
                            </td>
                            <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{t.amount}</td>
                            <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{pLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column (Polymarket-like trade card) */}
        <div className="order-1 lg:order-2 lg:col-span-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-4 sm:p-5 lg:sticky lg:top-24">
            {isResolved ? (
              <Redeem
                contractData={contractData}
                user={user}
                userTrades={userTrades}
                poll={poll}
                isEnded={isEnded}
                redeemMutation={redeemMutation}
              />
            ) : isMarketPaused ? (
              <div className="text-center">
                <h3 className="section-title">Market paused</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  Market paused, check back soon.
                </p>
              </div>
            ) : isEnded ? (
              <div className="text-center">
                <h3 className="section-title">Market closed</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  Trading is closed. Waiting for final resolution.
                </p>
              </div>
            ) : (
              <>
                {/* Top row: Buy/Sell + Market selector (static) */}
                <div className="flex items-center justify-between mb-3">
                  <div className="tabs">
                    <button
                      className={`tab ${tradeMode === "buy" ? "tab-active" : ""}`}
                      onClick={() => setTradeMode("buy")}
                    >
                      Buy
                    </button>
                    <button
                      className={`tab ${tradeMode === "sell" ? "tab-active" : ""}`}
                      onClick={() => setTradeMode("sell")}
                    >
                      Sell
                    </button>
                  </div>

                  <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <span>Market</span>
                    <span className="opacity-60">▾</span>
                  </div>
                </div>

                {/* Yes/No price pills */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button
                    onClick={() => setSelectedOptionIndex(0)}
                    className={`rounded-lg px-4 py-3 text-sm font-semibold border ${
                      selectedOptionIndex === 0
                        ? "bg-emerald-500/90 text-white border-emerald-500"
                        : "bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    Yes <span className="ml-1 opacity-90">{displayOdds.yes}%</span>
                  </button>

                  <button
                    onClick={() => setSelectedOptionIndex(1)}
                    className={`rounded-lg px-4 py-3 text-sm font-semibold border ${
                      selectedOptionIndex === 1
                        ? "bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200"
                        : "bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    No <span className="ml-1 opacity-90">{displayOdds.no}%</span>
                  </button>
                </div>

                {/* Amount section */}
                <div className="mb-4">
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Amount
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {userBalanceStxLabel ? `Balance ${userBalanceStxLabel}` : ""}
                      </div>
                    </div>

                    {/* Big number like Polymarket */}
                    <div className="text-right">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {tradeMode === "buy" ? "You pay (est.)" : "Shares"}
                      </div>
                      <div className="text-4xl font-semibold text-gray-900 dark:text-gray-100 leading-none">
                        {tradeMode === "buy"
                          ? `${buyTotalStxDisplay ?? budgetStxDisplay}`
                          : `${Math.round(Number(amount) || 0)}`}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {tradeMode === "buy"
                          ? `Budget ${budgetStxDisplay} STX`
                          : "shares"}
                      </div>
                    </div>
                  </div>

                  {tradeMode === "buy" ? (
                    <>
                      <NumberInput
                        value={budget}
                        onChange={setBudgetCapped}
                        step={1}
                        min={0}
                        className="w-full"
                      />
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          onClick={() =>
                            setBudgetCapped(String((Number(budget) || 0) + 1))
                          }
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          onClick={() =>
                            setBudgetCapped(String((Number(budget) || 0) + 10))
                          }
                        >
                          +10
                        </button>
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          onClick={() =>
                            setBudgetCapped(String((Number(budget) || 0) + 100))
                          }
                        >
                          +100
                        </button>
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                            onClick={() =>
                              setBudgetCapped(
                                userBalanceUstx > 0
                                  ? String(Math.floor(userBalanceUstx / USTX_PER_STX))
                                  : "0"
                              )
                            }
                        >
                          Max
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <NumberInput
                        value={amount}
                        onChange={setAmount}
                        step={1}
                        min={0}
                        max={maxSellShares}
                        className="w-full"
                      />
                      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                        Max sell: {maxSellShares} shares
                      </div>
                    </>
                  )}
                </div>

                {/* To win + Avg price (Polymarket style) */}
                {tradeMode === "buy" ? (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-sm text-gray-600 dark:text-gray-300">To win</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          Avg. Price{" "}
                          {quote?.perShareUstx != null
                            ? formatStx(quote.perShareUstx, { minDecimals: 6, maxDecimals: 6 })
                            : "—"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-4xl font-semibold text-emerald-500 leading-none">
                          {ustxToStxString(potentialWinUstx, { maxDecimals: 6 })}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">STX</div>
                      </div>
                    </div>

                    <div className="mt-3 border-t border-gray-200 dark:border-gray-700" />
                    {quoteError && (
                      <div className="mt-2 text-[11px] text-red-500">Quote error: {quoteError}</div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mb-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-sm text-gray-600 dark:text-gray-300">You receive</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          Avg. Price{" "}
                          {quote?.perShareUstx != null
                            ? formatStx(quote.perShareUstx, { minDecimals: 6, maxDecimals: 6 })
                            : "—"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-4xl font-semibold text-gray-900 dark:text-gray-100 leading-none">
                          {quote?.total != null ? ustxToStxString(quote.total, { maxDecimals: 6 }) : "—"}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">STX</div>
                      </div>
                    </div>
                    {quoteError && (
                      <div className="mt-2 text-[11px] text-red-500">Quote error: {quoteError}</div>
                    )}
                  </div>
                )}

                {/* Main action */}
                <button
                  onClick={() => tradeMutation.mutate()}
                  disabled={
                    tradeMutation.isLoading ||
                    isResolved ||
                    isEnded ||
                    isMarketPaused ||
                    (tradeMode === "buy" &&
                      (!Number.isFinite(budgetUstx) ||
                        budgetUstx <= 0 ||
                        sharesFromQuote <= 0 ||
                        (maxTradeUstx != null && budgetUstx > maxTradeUstx))) ||
                    (tradeMode === "sell" &&
                      (!amount ||
                        Number(amount) <= 0 ||
                        !selectedPosition ||
                        selectedPosition.netShares <= 0 ||
                        maxSellShares <= 0 ||
                        (maxTradeUstx != null &&
                          Number.isFinite(quote?.total) &&
                          quote.total > maxTradeUstx)))
                  }
                  className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {tradeMutation.isLoading
                    ? "Placing order..."
                    : tradeMode === "buy"
                    ? `Buy ${selectedOptionIndex === 0 ? "Yes" : "No"}`
                    : `Sell ${selectedOptionIndex === 0 ? "Yes" : "No"}`}
                </button>

                {/* Small helper line */}
                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {tradeMode === "buy"
                    ? "Each winning share pays 1 STX. Payout equals shares."
                    : "Proceeds depend on current market price."}
                </div>

                {quoteLoading && (
                  <div className="mt-2 text-[11px] text-gray-400">Calculating quote…</div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Recently visited */}
        {(() => {
          const others = recentPolls.filter((m) => m._id !== id);
          if (others.length === 0) return null;
          return (
            <div className="order-3 hidden lg:block lg:order-3 lg:col-span-1">
              <div className="mt-6 section-card p-4 sticky top-[calc(24px+520px)]">
                <h4 className="section-title mb-3">Recently visited</h4>
                <div className="space-y-3">
                  {others.slice(0, 5).map((m) => (
                    <a key={m._id} href={`/poll/${m._id}`} className="flex items-center gap-3 group">
                      <div className="w-8 h-8 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden flex-shrink-0">
                        {m.image && <img src={m.image} alt="" className="w-full h-full object-cover rounded" />}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 group-hover:underline line-clamp-2 leading-tight">
                        {m.title}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
