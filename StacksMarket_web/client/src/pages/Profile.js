import React, { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useQuery } from "react-query";
import axios from "../setupAxios";
import PollCard from "../components/polls/PollCard";
import LoadingSpinner from "../components/common/LoadingSpinner";
import { BACKEND_URL } from "../contexts/Bakendurl";
import { getWalletStxBalance } from "../contexts/stacks/marketClient";
import { formatStx } from "../utils/stx";

const Profile = () => {
  const { user } = useAuth();

  // On-chain STX balance — runs in parallel with dashboard query
  const [walletBalanceUstx, setWalletBalanceUstx] = useState(null);
  useEffect(() => {
    if (!user?.walletAddress) return;
    getWalletStxBalance(user.walletAddress).then(setWalletBalanceUstx).catch(() => {});
  }, [user?.walletAddress]);

  // Single consolidated server call: savedPolls + redeemableTrades + trades history
  const { data: dashboard, isLoading: loadingDashboard } = useQuery(
    ["user-dashboard"],
    async () => (await axios.get(`${BACKEND_URL}/api/users/me/dashboard`)).data,
    { enabled: !!user, staleTime: 30 * 1000 }
  );

  const saved = dashboard?.savedPolls || [];
  const redeemableTrades = dashboard?.redeemableTrades || [];
  const myTrades = dashboard?.trades || [];

  // Traded polls filter state
  const [tradeFilter, setTradeFilter] = useState("Active");

  // Derive unique polls from trades
  const tradedPolls = useMemo(() => {
    const map = {};
    myTrades.forEach((t) => {
      const p = t.poll;
      if (!p || !p._id) return;
      if (!map[p._id]) map[p._id] = p;
    });
    return Object.values(map);
  }, [myTrades]);

  const filteredTradedPolls = useMemo(() => {
    const now = new Date();
    switch (tradeFilter) {
      case "Active":
        return tradedPolls.filter((p) => {
          if (p.isResolved) return false;
          const end = p.endDate ? new Date(p.endDate) : null;
          return !end || end > now; // no endDate → treat as active
        });
      case "Ended":
        return tradedPolls.filter((p) => {
          if (p.isResolved) return false;
          const end = p.endDate ? new Date(p.endDate) : null;
          return end && end <= now;
        });
      case "Resolved":
        return tradedPolls.filter((p) => p.isResolved);
      default:
        return tradedPolls;
    }
  }, [tradeFilter, tradedPolls]);

  const getTradeOptionLabel = (trade) => {
    const idx = Number(trade?.optionIndex);
    if (!Number.isInteger(idx) || idx < 0) return "-";
    const optionText = trade?.poll?.options?.[idx]?.text;
    if (optionText) return optionText;
    if (idx === 0) return "Yes";
    if (idx === 1) return "No";
    return `Option ${idx + 1}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-300 overflow-hidden">
            {user?.avatar && (
              <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-all">
              {user?.username}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Balance: {walletBalanceUstx != null ? formatStx(walletBalanceUstx) : "..."}
            </div>
          </div>
        </div>

        {/* Trades to Redeem */}
        {(redeemableTrades.length > 0 || loadingDashboard) && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              Trades to Redeem
            </h2>
            {loadingDashboard ? (
              <LoadingSpinner />
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {redeemableTrades.map((item) => {
                  const optionLabel =
                    item.pollOptions?.[item.winningOption]?.text ||
                    (item.winningOption === 0 ? "Yes" : item.winningOption === 1 ? "No" : `Option ${item.winningOption + 1}`);
                  return (
                    <div key={item.pollId} className="flex items-center justify-between py-3 gap-4">
                      <div className="min-w-0">
                        <Link
                          to={`/poll/${item.pollId}`}
                          className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block"
                        >
                          {item.pollTitle}
                        </Link>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Won on{" "}
                          <span className="text-emerald-600 font-semibold">{optionLabel}</span>
                          {" · "}{item.totalShares} shares
                        </span>
                      </div>
                      <Link
                        to={`/poll/${item.pollId}`}
                        className="flex-shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md transition"
                      >
                        Redeem
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Saved Polls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Saved Polls
          </h2>
          {loadingDashboard ? (
            <LoadingSpinner />
          ) : saved.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No saved polls yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {saved.map((p) => (
                <PollCard key={p._id} poll={p} />
              ))}
            </div>
          )}
        </div>

        {/* Traded Polls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Traded Polls
            </h2>
            <div className="inline-flex bg-gray-100 dark:bg-gray-700 rounded-md p-1">
              {["Active", "Ended", "Resolved"].map((t) => (
                <button
                  key={t}
                  onClick={() => setTradeFilter(t)}
                  className={`px-3 py-1 text-sm ${
                    tradeFilter === t ? "bg-white dark:bg-gray-800 shadow" : "bg-transparent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {loadingDashboard ? (
            <LoadingSpinner />
          ) : filteredTradedPolls.length === 0 ? (
            <p className="text-sm text-gray-500">No traded polls found for this filter.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTradedPolls.map((p) => (
                <PollCard key={p._id} poll={p} />
              ))}
            </div>
          )}
        </div>

        {/* Trade History */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            My Trades History
          </h2>
          {loadingDashboard ? (
            <LoadingSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Poll</th>
                    <th className="py-2 pr-4">Side</th>
                    <th className="py-2 pr-4">Option</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {myTrades.map((t) => (
                    <tr key={t._id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {t.poll?.title || "-"}
                      </td>
                      <td className={`py-2 pr-4 ${t.type === "buy" ? "text-emerald-600" : "text-red-500"}`}>
                        {t.type.toUpperCase()}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {getTradeOptionLabel(t)}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{t.amount}</td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">{t.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Profile;
