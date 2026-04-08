// LadderGroupDetail.js — PollDetail-style page for ladder/scalar markets
// Route: /ladder/:groupId

import React, { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "react-query";
import axios from "../setupAxios";
import { BACKEND_URL } from "../contexts/Bakendurl";
import { FaArrowLeft, FaClock, FaChartBar } from "react-icons/fa";
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
import {
  getQuoteYesBySats,
  getQuoteNoBySats,
  getQuoteSellYes,
  getQuoteSellNo,
  buyYesBySatsAuto,
  buyNoBySatsAuto,
  sellYesAuto,
  sellNoAuto,
  getUserClaimable,
  ensureWalletSigner,
  getWalletStxBalance,
  waitForTx,
} from "../contexts/stacks/marketClient";
import { useAuth } from "../contexts/AuthContext";
import { USTX_PER_STX, ustxToStxString, formatStx } from "../utils/stx";
import CommentsSection from "../components/comments/CommentsSection";
import LoadingSpinner from "../components/common/LoadingSpinner";
import toast from "react-hot-toast";

// ------------------- Constants -------------------

const RUNG_COLORS = [
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f87171", // rose
  "#a78bfa", // violet
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
];

// ------------------- Helpers -------------------

const kFormat = (n) => {
  const x = Number(n || 0);
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (x >= 1_000) return (x / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return x.toString();
};

const formatVolume = (ustx) => {
  const n = Number(ustx || 0);
  // kFormat for compact display, same as LadderGroupCard/LadderGroupView
  const stx = n / USTX_PER_STX;
  if (stx >= 1_000_000) return (stx / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M STX";
  if (stx >= 1_000)     return (stx / 1_000).toFixed(1).replace(/\.0$/, "") + "k STX";
  return ustxToStxString(n, { maxDecimals: 2 }) + " STX";
};

const parseDate = (ts) => {
  if (!ts) return null;
  const n = Number(ts);
  if (Number.isFinite(n) && n < 1e12) return new Date(n * 1000);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatCloseDate = (ts) => {
  const d = parseDate(ts);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const timeRemaining = (ts) => {
  const end = parseDate(ts);
  if (!end) return "—";
  const diff = end - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatChartTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const sortRungs = (rungs = []) =>
  [...rungs].sort((a, b) => Number(b.threshold || 0) - Number(a.threshold || 0));

// ------------------- Debounce hook -------------------

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
}

// ------------------- Sub-components -------------------

const OutcomeBadge = ({ outcome }) => {
  const isYes = String(outcome || "").toUpperCase() === "YES";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        isYes
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
      }`}
    >
      {isYes ? "YES" : "NO"}
    </span>
  );
};

const ProbBar = ({ pct }) => {
  const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 rounded-full h-1.5 overflow-hidden flex">
        <div className="bg-sky-500 h-full transition-all" style={{ width: `${clamped}%` }} />
        <div className="bg-gray-200 dark:bg-gray-600 h-full flex-1" />
      </div>
      <span className="text-sm font-semibold text-gray-900 dark:text-white w-10 text-right">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
};

// ------------------- Clarity unwrap helpers (same pattern as PollDetail) -------------------

const unwrapClarity = (r) => r?.value ?? r?.okay ?? r;

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

const getNestedField = (tup, path) => {
  let cur = tup?.value ?? tup;
  for (const k of path) {
    if (cur == null) return null;
    cur = cur?.value?.[k] ?? cur?.[k];
  }
  return cur;
};

// ------------------- Trade Panel (right column) -------------------
// Layout identical to PollDetail's trade card

const TradePanel = ({ selectedRung, selectedSide, onSideChange, user, onTradeSuccess }) => {
  const [tradeMode, setTradeMode] = useState("buy");
  const [budget, setBudget] = useState("");
  const [sellShares, setSellShares] = useState("");
  const debouncedBudget = useDebounce(budget, 500);
  const debouncedSellShares = useDebounce(sellShares, 500);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [userShares, setUserShares] = useState({ yes: 0, no: 0 });
  const [walletBalanceUstx, setWalletBalanceUstx] = useState(0);

  // Fetch wallet STX balance (same as PollDetail)
  useEffect(() => {
    if (!user?.walletAddress) return;
    getWalletStxBalance(user.walletAddress)
      .then((b) => setWalletBalanceUstx(Number.isFinite(b) ? b : 0))
      .catch(() => {});
  }, [user?.walletAddress]);

  // Reset on rung change
  useEffect(() => {
    setBudget("");
    setSellShares("");
    setQuote(null);
    setQuoteError(null);
    setUserShares({ yes: 0, no: 0 });
  }, [selectedRung?.marketId]);

  // Fetch on-chain share balance for sell mode
  useEffect(() => {
    if (tradeMode !== "sell" || !selectedRung || !user?.walletAddress) return;
    let cancelled = false;
    getUserClaimable(Number(selectedRung.marketId), user.walletAddress)
      .then((r) => {
        if (cancelled) return;
        const v = unwrapClarity(r);
        const yes = normalizeUInt(getNestedField(v, ["yesBalance"])) ??
                    normalizeUInt(getNestedField(v, ["yesBal"])) ?? 0;
        const no  = normalizeUInt(getNestedField(v, ["noBalance"])) ??
                    normalizeUInt(getNestedField(v, ["noBal"])) ?? 0;
        setUserShares({ yes: Math.max(0, Math.floor(yes)), no: Math.max(0, Math.floor(no)) });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tradeMode, selectedRung?.marketId, user?.walletAddress]);

  // Auto-quote BUY
  useEffect(() => {
    if (tradeMode !== "buy" || !selectedRung || !debouncedBudget) {
      setQuote(null); setQuoteError(null); return;
    }
    const ustx = Math.round(Number(debouncedBudget) * USTX_PER_STX);
    if (!Number.isFinite(ustx) || ustx <= 0) { setQuote(null); return; }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const fn = selectedSide === "YES" ? getQuoteYesBySats : getQuoteNoBySats;
    fn(Number(selectedRung.marketId), ustx)
      .then((r) => {
        if (cancelled) return;
        const qv = unwrapClarity(r);
        const shares    = normalizeUInt(getNestedField(qv, ["shares"])) ?? 0;
        const total     = normalizeUInt(getNestedField(qv, ["quote", "total"])) ?? ustx;
        const perShare  = shares > 0 ? total / shares : null;
        setQuote({ shares, total, perShareUstx: perShare });
      })
      .catch((e) => { if (!cancelled) setQuoteError(e?.message || "Quote failed"); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [tradeMode, selectedRung, selectedSide, debouncedBudget]);

  // Auto-quote SELL
  useEffect(() => {
    if (tradeMode !== "sell" || !selectedRung || !debouncedSellShares) {
      setQuote(null); setQuoteError(null); return;
    }
    const amt = Math.round(Number(debouncedSellShares));
    if (!Number.isFinite(amt) || amt <= 0) { setQuote(null); return; }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const fn = selectedSide === "YES" ? getQuoteSellYes : getQuoteSellNo;
    fn(Number(selectedRung.marketId), amt)
      .then((r) => {
        if (cancelled) return;
        const qv        = unwrapClarity(r);
        const total     = normalizeUInt(getNestedField(qv, ["total"])) ?? 0;
        const perShare  = amt > 0 ? total / amt : null;
        setQuote({ shares: amt, total, perShareUstx: perShare });
      })
      .catch((e) => { if (!cancelled) setQuoteError(e?.message || "Quote failed"); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [tradeMode, selectedRung, selectedSide, debouncedSellShares]);

  const maxSellShares = selectedSide === "YES" ? userShares.yes : userShares.no;

  const handleTrade = async () => {
    if (!user) { toast.error("Connect your wallet to trade"); return; }
    setTradeLoading(true);
    let txData;
    const action = tradeMode === "buy" ? "Buy" : "Sell";
    try {
      await ensureWalletSigner(user.walletAddress);
      if (tradeMode === "buy") {
        const ustx = Math.round(Number(budget) * USTX_PER_STX);
        if (!Number.isFinite(ustx) || ustx <= 0) throw new Error("Enter a valid STX amount");
        const fn = selectedSide === "YES" ? buyYesBySatsAuto : buyNoBySatsAuto;
        txData = await fn(Number(selectedRung.marketId), ustx);
        setBudget("");
      } else {
        const amt = Math.round(Number(sellShares));
        if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter number of shares");
        if (amt > maxSellShares) throw new Error(`Max sell: ${maxSellShares} shares`);
        const fn = selectedSide === "YES" ? sellYesAuto : sellNoAuto;
        txData = await fn(Number(selectedRung.marketId), amt);
        setSellShares("");
      }
      setQuote(null);
    } catch (err) {
      if (err?.message !== "User cancelled") toast.error(err?.message || "Trade failed");
      setTradeLoading(false);
      return;
    }

    // Wallet confirmed broadcast — unblock UI immediately
    setTradeLoading(false);

    const txId = txData?.txId;
    if (!txId) {
      // Fallback: no txId returned (shouldn't happen)
      toast.success(`${action} ${selectedSide} submitted!`);
      onTradeSuccess?.();
      return;
    }

    // Show persistent loading toast while waiting for blockchain confirmation
    const pendingToastId = toast.loading(`Transaction sent — waiting for confirmation...`);

    try {
      await waitForTx(txId);
      toast.dismiss(pendingToastId);
      toast.success(`${action} ${selectedSide} confirmed!`);
      onTradeSuccess?.();
    } catch (err) {
      toast.dismiss(pendingToastId);
      if (err?.message?.includes("not confirmed after")) {
        toast.error("Transaction is taking longer than expected. Check your wallet.");
      } else {
        toast.error(err?.message || "Transaction failed");
      }
      // Refresh data anyway — tx may still have gone through
      onTradeSuccess?.();
    }
  };

  // Derived display values — identical chain to PollDetail
  const sharesFromQuote  = tradeMode === "buy" ? Number(quote?.shares) || 0 : 0;
  const potentialWinUstx = sharesFromQuote * USTX_PER_STX;
  const budgetUstx       = Math.round(Number(budget) * USTX_PER_STX) || 0;
  const buyTotalUstx     = tradeMode === "buy" && Number.isFinite(quote?.total) ? Number(quote.total) : null;
  const budgetStxDisplay = ustxToStxString(budgetUstx, { maxDecimals: 6 });
  const buyTotalStxDisplay = buyTotalUstx != null ? ustxToStxString(buyTotalUstx, { maxDecimals: 6 }) : null;
  const userBalanceStxLabel = walletBalanceUstx > 0 ? formatStx(walletBalanceUstx) : "";

  if (!selectedRung) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-4 sm:p-5 lg:sticky lg:top-24">
        <div className="flex flex-col items-center justify-center min-h-[160px] text-center">
          <FaChartBar className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click <strong>Buy YES</strong> or <strong>Buy NO</strong> on a rung to trade
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-4 sm:p-5 lg:sticky lg:top-24">
      {/* Top row: Buy/Sell tabs + "Market ▾" — identical to PollDetail */}
      <div className="flex items-center justify-between mb-3">
        <div className="tabs">
          <button
            className={`tab ${tradeMode === "buy" ? "tab-active" : ""}`}
            onClick={() => { setTradeMode("buy"); setQuote(null); setBudget(""); }}
          >
            Buy
          </button>
          <button
            className={`tab ${tradeMode === "sell" ? "tab-active" : ""}`}
            onClick={() => { setTradeMode("sell"); setQuote(null); setSellShares(""); }}
          >
            Sell
          </button>
        </div>
        <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
          <span>Market</span>
          <span className="opacity-60">▾</span>
        </div>
      </div>

      {/* Yes/No pills — identical to PollDetail */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => onSideChange("YES")}
          className={`rounded-lg px-4 py-3 text-sm font-semibold border ${
            selectedSide === "YES"
              ? "bg-emerald-500/90 text-white border-emerald-500"
              : "bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700"
          }`}
        >
          Yes{" "}
          <span className="ml-1 opacity-90">
            {selectedRung.probability != null ? `${Math.round(selectedRung.probability)}%` : ""}
          </span>
        </button>
        <button
          onClick={() => onSideChange("NO")}
          className={`rounded-lg px-4 py-3 text-sm font-semibold border ${
            selectedSide === "NO"
              ? "bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200"
              : "bg-gray-100 dark:bg-gray-700/50 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700"
          }`}
        >
          No{" "}
          <span className="ml-1 opacity-90">
            {selectedRung.noProbability != null ? `${Math.round(selectedRung.noProbability)}%` : ""}
          </span>
        </button>
      </div>

      {/* Amount section — identical to PollDetail */}
      <div className="mb-4">
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Amount</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {userBalanceStxLabel ? `Balance ${userBalanceStxLabel}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {tradeMode === "buy" ? "You pay (est.)" : "Shares"}
            </div>
            <div className="text-4xl font-semibold text-gray-900 dark:text-gray-100 leading-none">
              {tradeMode === "buy"
                ? (buyTotalStxDisplay ?? budgetStxDisplay)
                : `${Math.round(Number(sellShares) || 0)}`}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {tradeMode === "buy" ? `Budget ${budgetStxDisplay} STX` : "shares"}
            </div>
          </div>
        </div>

        {tradeMode === "buy" ? (
          <>
            <input
              type="number"
              min="0"
              step="1"
              className="input w-full"
              placeholder="0"
              value={budget}
              onChange={(e) => { setBudget(e.target.value); setQuote(null); }}
            />
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[1, 10, 100].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => setBudget(String((Number(budget) || 0) + n))}
                >
                  +{n}
                </button>
              ))}
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() =>
                  setBudget(
                    walletBalanceUstx > 0
                      ? String(Math.floor(walletBalanceUstx / USTX_PER_STX))
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
            <input
              type="number"
              min="0"
              step="1"
              max={maxSellShares}
              className="input w-full"
              placeholder="0"
              value={sellShares}
              onChange={(e) => { setSellShares(e.target.value); setQuote(null); }}
            />
            <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
              Max sell: {maxSellShares} shares
            </div>
          </>
        )}
      </div>

      {/* To win / You receive — identical to PollDetail */}
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

      {/* Action button — btn-primary identical to PollDetail */}
      <button
        onClick={handleTrade}
        disabled={
          tradeLoading ||
          (tradeMode === "buy"
            ? !Number.isFinite(budgetUstx) || budgetUstx <= 0 || sharesFromQuote <= 0
            : !sellShares || Number(sellShares) <= 0 || maxSellShares <= 0)
        }
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {tradeLoading
          ? "Placing order..."
          : tradeMode === "buy"
          ? `Buy ${selectedSide === "YES" ? "Yes" : "No"}`
          : `Sell ${selectedSide === "YES" ? "Yes" : "No"}`}
      </button>

      {/* Helper text */}
      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        {tradeMode === "buy"
          ? "Each winning share pays 1 STX. Payout equals shares."
          : "Proceeds depend on current market price."}
      </div>

      {quoteLoading && (
        <div className="mt-2 text-[11px] text-gray-400">Calculating quote…</div>
      )}
    </div>
  );
};

// ------------------- Main Page -------------------

const LadderGroupDetail = () => {
  const { groupId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedRung, setSelectedRung] = useState(null);
  const [selectedSide, setSelectedSide] = useState("YES");
  const [hoveredRow, setHoveredRow] = useState(null);
  const [chartRange, setChartRange] = useState("All");
  const [detailTab, setDetailTab] = useState("comments");

  const RECENT_LADDER_KEY = "stacksmarket_recent_ladder";
  const [recentGroups, setRecentGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_LADDER_KEY) || "[]"); } catch { return []; }
  });

  // ---- Data ----
  const { data, isLoading, error } = useQuery(
    ["ladder-group", groupId],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/ladder/groups/${groupId}`);
      return res.data;
    },
    { staleTime: 10_000, refetchInterval: 15_000, refetchOnWindowFocus: true }
  );

  const { data: tradesData } = useQuery(
    ["ladder-group-trades", groupId],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/ladder/groups/${groupId}/trades`);
      return res.data;
    },
    { staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: false }
  );

  const { data: holdersData, isLoading: loadingHolders } = useQuery(
    ["ladder-group-holders", groupId],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/ladder/groups/${groupId}/holders`);
      return res.data;
    },
    { enabled: detailTab === "holders", staleTime: 30_000, refetchOnWindowFocus: false }
  );

  const group = data ?? null;
  const rungs = useMemo(() => sortRungs(data?.rungs ?? []), [data?.rungs]);
  const isResolved = group?.status === "resolved" || String(group?.status || "").toLowerCase() === "resolved";

  const totalVolume = useMemo(
    () => (data?.rungs || []).reduce((s, r) => s + Number(r.volume || 0), 0),
    [data?.rungs]
  );

  // Track recently visited ladder groups in localStorage
  useEffect(() => {
    if (!group?.groupId || !group?.title) return;
    const entry = { groupId: group.groupId, title: group.title, image: group.image || null };
    setRecentGroups((prev) => {
      const filtered = prev.filter((g) => g.groupId !== group.groupId);
      const next = [entry, ...filtered].slice(0, 6);
      try { localStorage.setItem(RECENT_LADDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [group?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Chart data ----
  const chartData = useMemo(() => {
    const trades = (tradesData?.trades || []).filter((t) => t.yesPct != null);
    if (!trades.length) return [];

    const now = Date.now();
    const oneDay = 86_400_000;
    let minTime = 0;
    if (chartRange === "Day") minTime = now - oneDay;
    else if (chartRange === "Week") minTime = now - 7 * oneDay;
    else if (chartRange === "Month") minTime = now - 30 * oneDay;
    else if (chartRange === "Year") minTime = now - 365 * oneDay;

    const filtered = trades.filter((t) => new Date(t.createdAt).getTime() >= minTime);
    if (!filtered.length) return [];

    // Group by minute
    const byMinute = {};
    filtered.forEach((t) => {
      const min = new Date(t.createdAt);
      min.setSeconds(0, 0);
      const key = min.getTime();
      if (!byMinute[key]) byMinute[key] = { time: key };
      byMinute[key][t.marketId] = t.yesPct;
    });

    const sorted = Object.values(byMinute).sort((a, b) => a.time - b.time);
    if (!sorted.length) return sorted;

    // Forward-fill: each rung carries its last known value to the current time
    // so the line always extends to "now" (same as Polymarket).
    const rungIds = [...new Set(filtered.map((t) => t.marketId))];
    const lastKnown = {};
    sorted.forEach((point) => {
      rungIds.forEach((id) => {
        if (point[id] != null) lastKnown[id] = point[id];
        else if (lastKnown[id] != null) point[id] = lastKnown[id];
      });
    });

    // Append a "now" point so the line reaches the right edge of the chart
    const nowMin = new Date();
    nowMin.setSeconds(0, 0);
    const nowKey = nowMin.getTime();
    if (sorted[sorted.length - 1].time < nowKey) {
      const nowPoint = { time: nowKey };
      rungIds.forEach((id) => { if (lastKnown[id] != null) nowPoint[id] = lastKnown[id]; });
      sorted.push(nowPoint);
    }

    return sorted;
  }, [tradesData, chartRange]);

  // ---- Handlers ----
  const handleBuyClick = (rung, side) => {
    if (!user) { toast.error("Connect your wallet to trade"); return; }
    setSelectedRung(rung);
    setSelectedSide(side);
  };

  // ---- Error ----
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 dark:text-red-400 font-medium mb-4">
            {error?.response?.data?.message || error?.message || "Failed to load ladder group"}
          </p>
          <Link to="/" className="btn-outline btn-sm">Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* ---- Header ---- */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <FaArrowLeft className="w-3 h-3" />
            Back to Markets
          </Link>

          {isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700">
                  {group?.image && (
                    <img src={group.image} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="pill">Scalar</span>
                    {isResolved && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Resolved
                      </span>
                    )}
                  </div>
                  <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {group?.title || "Ladder Market"}
                  </h1>
                  {group?.resolutionSource && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                      Source: <span className="font-medium text-gray-700 dark:text-slate-200">{group.resolutionSource}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-left sm:text-right space-y-1">
                {group?.closeTime && (
                  <div className="flex items-center justify-start sm:justify-end gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <FaClock className="w-3.5 h-3.5" />
                    <span>{timeRemaining(group.closeTime)} left</span>
                  </div>
                )}
                {totalVolume > 0 && (
                  <div className="flex items-center justify-start sm:justify-end gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <FaChartBar className="w-3.5 h-3.5" />
                    <span>{formatVolume(totalVolume)}</span>
                  </div>
                )}
                {group?.closeTime && (
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    Closes: <span className="text-gray-700 dark:text-slate-200">{formatCloseDate(group.closeTime)}</span>
                  </p>
                )}
                {isResolved && group?.finalValue != null && (
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    Final value:{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{group.finalValue}</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Content ---- */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="order-2 lg:order-1 lg:col-span-2 space-y-6">
          {/* Probability chart */}
          <div className="bg-white dark:bg-[#0b1220] rounded-2xl border border-gray-200 dark:border-[#1f2937] p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                Probability history (YES %)
              </span>
              <div className="tabs sm:ml-auto">
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

            <div className="w-full h-64">
              {isLoading ? (
                <div className="h-full bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-gray-400 dark:text-slate-500">No trade history yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatChartTime}
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
                      labelFormatter={(v) => formatChartTime(v)}
                      formatter={(val, name) => [`${val}%`, name]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      formatter={(val) => {
                        const rung = rungs.find((r) => String(r.marketId) === String(val));
                        return rung?.label || val;
                      }}
                    />
                    {rungs.map((rung, i) => (
                      <Line
                        key={rung.marketId}
                        type="monotone"
                        dataKey={rung.marketId}
                        stroke={RUNG_COLORS[i % RUNG_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        name={rung.marketId}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Rung table */}
          <div className="bg-white dark:bg-[#0b1220] rounded-2xl border border-gray-200 dark:border-[#1f2937] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-[#111827]">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      Outcome
                    </th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      Probability
                    </th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      Volume
                    </th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      Trade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? [1, 2, 3].map((i) => (
                        <tr key={i} className="border-t border-gray-100 dark:border-gray-700 animate-pulse">
                          {[1, 2, 3, 4].map((j) => (
                            <td key={j} className="py-3 px-4">
                              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : rungs.map((rung, i) => {
                        const isSelected = selectedRung?.marketId === rung.marketId;
                        const isHovered = hoveredRow === rung.marketId;
                        const resolved = rung.isResolved;

                        return (
                          <tr
                            key={rung.marketId}
                            onMouseEnter={() => setHoveredRow(rung.marketId)}
                            onMouseLeave={() => setHoveredRow(null)}
                            className={`border-t border-gray-100 dark:border-gray-700/50 transition-colors ${
                              isSelected
                                ? "bg-sky-50 dark:bg-sky-900/10"
                                : isHovered
                                ? "bg-gray-50/80 dark:bg-white/[0.03]"
                                : ""
                            }`}
                          >
                            {/* Label */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-block w-3 h-3 rounded-full shrink-0"
                                  style={{
                                    background: RUNG_COLORS[i % RUNG_COLORS.length],
                                    boxShadow: `0 0 0 2px ${RUNG_COLORS[i % RUNG_COLORS.length]}33`,
                                  }}
                                />
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  {rung.label || `Threshold ${rung.threshold}`}
                                </span>
                              </div>
                            </td>

                            {/* Probability */}
                            <td className="py-3 px-4">
                              {resolved ? (
                                <OutcomeBadge outcome={rung.outcome} />
                              ) : (
                                <ProbBar pct={rung.probability ?? 50} />
                              )}
                            </td>

                            {/* Volume */}
                            <td className="py-3 px-4 text-gray-600 dark:text-slate-300">
                              {rung.volume != null ? formatVolume(rung.volume) : "—"}
                            </td>

                            {/* Trade */}
                            <td className="py-3 px-4">
                              <div className="flex justify-end gap-2">
                                {resolved ? (
                                  <OutcomeBadge outcome={rung.outcome} />
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleBuyClick(rung, "YES")}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ${
                                        isSelected && selectedSide === "YES"
                                          ? "bg-emerald-600 text-white ring-2 ring-emerald-500"
                                          : "bg-emerald-500 hover:bg-emerald-600 text-white"
                                      }`}
                                    >
                                      Buy YES
                                    </button>
                                    <button
                                      onClick={() => handleBuyClick(rung, "NO")}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 ${
                                        isSelected && selectedSide === "NO"
                                          ? "bg-gray-700 border-gray-700 text-white ring-2 ring-gray-500"
                                          : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                                      }`}
                                    >
                                      Buy NO
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                  {!isLoading && rungs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-gray-400 dark:text-slate-500">
                        No rungs in this ladder group yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resolution info */}
          {(group?.resolutionSource || isResolved) && (
            <div className="bg-white dark:bg-[#0b1220] rounded-2xl border border-gray-200 dark:border-[#1f2937] p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Resolution</h3>
              {group?.resolutionSource && (
                <p className="text-sm text-gray-600 dark:text-slate-300">{group.resolutionSource}</p>
              )}
              {isResolved && group?.finalValue != null && (
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">
                  Final value:{" "}
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {group.finalValue}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* ---- Tabs: Comments / Top holders / Transactions ---- */}
          <div>
            <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
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

            {detailTab === "comments" && group?.commentPollId && (
              <CommentsSection pollId={group.commentPollId} />
            )}
            {detailTab === "comments" && !group?.commentPollId && !isLoading && (
              <p className="text-sm text-gray-500 dark:text-gray-400 px-1">Comments unavailable.</p>
            )}

            {detailTab === "holders" && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Top holders</h3>
                {loadingHolders ? (
                  <LoadingSpinner />
                ) : !holdersData?.holders?.length ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No holders yet.</p>
                ) : (() => {
                  const yesHolders = holdersData.holders
                    .filter((h) => h.optionIndex === 0)
                    .sort((a, b) => b.netShares - a.netShares);
                  const noHolders = holdersData.holders
                    .filter((h) => h.optionIndex === 1)
                    .sort((a, b) => b.netShares - a.netShares);

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
                          const name = h.username || h.walletAddress || "Unknown";
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
                      <HolderCol holders={yesHolders} label="YES" colorClass="text-emerald-600 dark:text-emerald-400" />
                      <HolderCol holders={noHolders} label="NO" colorClass="text-red-500 dark:text-red-400" />
                    </div>
                  );
                })()}
              </div>
            )}

            {detailTab === "txs" && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Trades</h3>
                {!tradesData?.trades?.length ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No trades yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400">
                          <th className="py-2 pr-4">Time</th>
                          <th className="py-2 pr-4">Side</th>
                          <th className="py-2 pr-4">Option</th>
                          <th className="py-2 pr-4">Rung</th>
                          <th className="py-2 pr-4">Amount (shares)</th>
                          <th className="py-2 pr-4">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...tradesData.trades].reverse().slice(0, 30).map((t, i) => {
                          const pLabel = t.price != null ? `${(t.price * 100).toFixed(2)}%` : "—";
                          const isBuy = (t.type || "").toLowerCase() !== "sell";
                          return (
                            <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                              <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                                {new Date(t.createdAt).toLocaleString()}
                              </td>
                              <td className={`py-2 pr-4 font-semibold ${isBuy ? "text-emerald-600" : "text-red-500"}`}>
                                {(t.type || "buy").toUpperCase()}
                              </td>
                              <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                                {t.optionIndex === 0 ? "YES" : "NO"}
                              </td>
                              <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                                {t.label || `#${t.marketId}`}
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
        </div>

        {/* Right column — Trade panel + Recently visited */}
        <div className="order-1 lg:order-2 lg:col-span-1">
          <TradePanel
            selectedRung={selectedRung}
            selectedSide={selectedSide}
            onSideChange={setSelectedSide}
            user={user}
            onTradeSuccess={() => {
              queryClient.invalidateQueries(["ladder-group", groupId]);
              queryClient.invalidateQueries(["ladder-group-trades", groupId]);
              queryClient.invalidateQueries(["ladder-group-holders", groupId]);
            }}
          />

          {/* Recently visited ladder groups */}
          {(() => {
            const others = recentGroups.filter((g) => g.groupId !== Number(groupId));
            if (others.length === 0) return null;
            return (
              <div className="mt-6 section-card p-4 hidden lg:block">
                <h4 className="section-title mb-3">Recently visited</h4>
                <div className="space-y-3">
                  {others.slice(0, 5).map((g) => (
                    <a key={g.groupId} href={`/ladder/${g.groupId}`} className="flex items-center gap-3 group">
                      <div className="w-8 h-8 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden flex-shrink-0">
                        {g.image && <img src={g.image} alt="" className="w-full h-full object-cover rounded" />}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 group-hover:underline line-clamp-2 leading-tight">
                        {g.title}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default LadderGroupDetail;
