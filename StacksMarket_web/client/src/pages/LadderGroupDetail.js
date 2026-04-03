// LadderGroupDetail.js — Full page view for a ladder group
// Route: /ladder/:groupId

import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "react-query";
import axios from "../setupAxios";
import { BACKEND_URL } from "../contexts/Bakendurl";
import LadderGroupView from "../components/ladder/LadderGroupView";
import LoadingSpinner from "../components/common/LoadingSpinner";
import { FaArrowLeft } from "react-icons/fa";
import { formatStx, stxToUstx } from "../utils/stx";
import {
  buyYesBySatsAuto,
  buyNoBySatsAuto,
  ensureWalletSigner,
  getQuoteYesBySats,
  getQuoteNoBySats,
} from "../contexts/stacks/marketClient";
import { useAuth } from "../contexts/AuthContext";
import toast from "react-hot-toast";

// ------------------- Trade Modal -------------------

const TradeModal = ({ marketId, side, onClose, userAddress }) => {
  const [stxAmount, setStxAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [quotingLoading, setQuotingLoading] = useState(false);
  const [tradeLoading, setTradeLoading] = useState(false);

  const USTX_PER_STX = 1_000_000;

  const handleQuote = async () => {
    const ustx = Math.round(Number(stxAmount) * USTX_PER_STX);
    if (!Number.isFinite(ustx) || ustx <= 0) {
      toast.error("Enter a valid STX amount");
      return;
    }
    setQuotingLoading(true);
    try {
      const fn = side === "YES" ? getQuoteYesBySats : getQuoteNoBySats;
      const result = await fn(marketId, ustx);
      setQuote(result);
    } catch (err) {
      toast.error(err?.message || "Quote failed");
    } finally {
      setQuotingLoading(false);
    }
  };

  const handleTrade = async () => {
    const ustx = Math.round(Number(stxAmount) * USTX_PER_STX);
    if (!Number.isFinite(ustx) || ustx <= 0) {
      toast.error("Enter a valid STX amount");
      return;
    }
    setTradeLoading(true);
    try {
      await ensureWalletSigner(userAddress);
      const fn = side === "YES" ? buyYesBySatsAuto : buyNoBySatsAuto;
      await fn(marketId, ustx);
      toast.success(`Buy ${side} order submitted!`);
      onClose();
    } catch (err) {
      if (err?.message !== "User cancelled") {
        toast.error(err?.message || "Trade failed");
      }
    } finally {
      setTradeLoading(false);
    }
  };

  const sideColor = side === "YES" ? "emerald" : "rose";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#0f172a] rounded-2xl shadow-xl w-full max-w-sm border border-gray-200 dark:border-[#1f2937]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#1f2937]">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Buy{" "}
            <span
              className={
                side === "YES"
                  ? "text-emerald-500"
                  : "text-rose-500"
              }
            >
              {side}
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount (STX)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              className="input w-full"
              placeholder="e.g. 10"
              value={stxAmount}
              onChange={(e) => {
                setStxAmount(e.target.value);
                setQuote(null);
              }}
            />
          </div>

          {quote && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>Estimated shares</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {quote?.shares ?? "—"}
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleQuote}
              disabled={quotingLoading || !stxAmount}
              className="flex-1 btn-outline btn-sm disabled:opacity-50"
            >
              {quotingLoading ? "Quoting..." : "Get Quote"}
            </button>
            <button
              onClick={handleTrade}
              disabled={tradeLoading || !stxAmount}
              className={`flex-1 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 ${
                side === "YES"
                  ? "bg-emerald-500 hover:bg-emerald-600"
                  : "bg-rose-500 hover:bg-rose-600"
              }`}
            >
              {tradeLoading ? "Submitting..." : `Buy ${side}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------- Page -------------------

const LadderGroupDetail = () => {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [tradeModal, setTradeModal] = useState(null); // { marketId, side }

  const {
    data,
    isLoading,
    error,
  } = useQuery(
    ["ladder-group", groupId],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/ladder/groups/${groupId}`);
      return res.data;
    },
    {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    }
  );

  const group = data?.group ?? null;
  const rungs = data?.rungs ?? [];

  const handleBuy = (marketId, side) => {
    if (!user) {
      toast.error("Please connect your wallet to trade");
      return;
    }
    setTradeModal({ marketId, side });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 dark:text-red-400 font-medium mb-4">
            {error?.response?.data?.message || error?.message || "Failed to load ladder group"}
          </p>
          <Link to="/" className="btn-outline btn-sm">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-6 transition-colors"
        >
          <FaArrowLeft className="w-3 h-3" />
          Back to Markets
        </Link>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <LadderGroupView
            group={group}
            rungs={rungs}
            loading={false}
            onBuy={handleBuy}
          />
        )}
      </div>

      {/* Trade Modal */}
      {tradeModal && (
        <TradeModal
          marketId={tradeModal.marketId}
          side={tradeModal.side}
          userAddress={user?.walletAddress}
          onClose={() => setTradeModal(null)}
        />
      )}
    </div>
  );
};

export default LadderGroupDetail;
