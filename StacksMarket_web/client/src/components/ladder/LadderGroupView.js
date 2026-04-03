// LadderGroupView.js — Polymarket-style table view for a ladder group
// Props:
//   group: { groupId, title, resolutionSource, closeTime, status, finalValue }
//   rungs: [{ marketId, label, threshold, operator, probability, volume, isResolved, outcome }]
//   onBuy: (marketId, side) => void  — opens trade modal (caller provides this)

import React, { useState } from "react";
import { USTX_PER_STX } from "../../utils/stx";

// ------------------- Helpers -------------------

const kFormat = (n) => {
  const x = Number(n || 0);
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (x >= 1_000) return (x / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return x.toString();
};

const formatVolume = (ustx) => {
  const stx = Number(ustx || 0) / USTX_PER_STX;
  return kFormat(stx) + " STX";
};

const formatCloseDate = (ts) => {
  if (!ts) return "—";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const totalVolume = (rungs = []) => {
  return rungs.reduce((sum, r) => sum + Number(r.volume || 0), 0);
};

// Sort rungs by threshold descending (highest first, like Polymarket)
const sortRungs = (rungs = []) =>
  [...rungs].sort((a, b) => Number(b.threshold || 0) - Number(a.threshold || 0));

// ------------------- Skeleton -------------------

const SkeletonRow = () => (
  <tr className="border-t border-gray-100 dark:border-gray-700 animate-pulse">
    {[1, 2, 3, 4, 5].map((i) => (
      <td key={i} className="py-3 px-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
      </td>
    ))}
  </tr>
);

// ------------------- Outcome Badge -------------------

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

// ------------------- Probability Bar -------------------

const ProbBar = ({ pct }) => {
  const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
  const color =
    clamped >= 66
      ? "bg-emerald-500"
      : clamped >= 34
      ? "bg-amber-400"
      : "bg-rose-500";
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-gray-900 dark:text-white w-10 text-right">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
};

// ------------------- Main Component -------------------

const LadderGroupView = ({ group, rungs = [], loading = false, onBuy }) => {
  const [hoveredRow, setHoveredRow] = useState(null);

  if (!group && !loading) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-slate-400">
        Ladder group not found.
      </div>
    );
  }

  const sorted = sortRungs(rungs);
  const vol = totalVolume(rungs);
  const isResolved = group?.status === "resolved" || String(group?.status || "").toLowerCase() === "resolved";

  return (
    <div className="bg-white dark:bg-[#0b1220] rounded-2xl border border-gray-200 dark:border-[#1f2937] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1f2937]">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {group?.title || "Ladder Market"}
              </h2>
              {isResolved && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  Resolved
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500 dark:text-slate-400">
              {group?.resolutionSource && (
                <span>
                  Source:{" "}
                  <span className="text-gray-700 dark:text-slate-200 font-medium">
                    {group.resolutionSource}
                  </span>
                </span>
              )}
              {group?.closeTime && (
                <span>
                  Closes:{" "}
                  <span className="text-gray-700 dark:text-slate-200 font-medium">
                    {formatCloseDate(group.closeTime)}
                  </span>
                </span>
              )}
              {vol > 0 && (
                <span>
                  Total volume:{" "}
                  <span className="text-gray-700 dark:text-slate-200 font-medium">
                    {formatVolume(vol)}
                  </span>
                </span>
              )}
              {isResolved && group?.finalValue != null && (
                <span>
                  Final value:{" "}
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {group.finalValue}
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Table */}
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
            {loading
              ? [1, 2, 3].map((i) => <SkeletonRow key={i} />)
              : sorted.map((rung) => {
                  const resolved = rung.isResolved;
                  const isHovered = hoveredRow === rung.marketId;

                  return (
                    <tr
                      key={rung.marketId}
                      onMouseEnter={() => setHoveredRow(rung.marketId)}
                      onMouseLeave={() => setHoveredRow(null)}
                      className={`border-t border-gray-100 dark:border-gray-700/50 transition-colors ${
                        isHovered ? "bg-gray-50/80 dark:bg-white/[0.03]" : ""
                      }`}
                    >
                      {/* Label */}
                      <td className="py-3 px-4">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {rung.label || `Threshold ${rung.threshold}`}
                        </span>
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

                      {/* Trade buttons */}
                      <td className="py-3 px-4">
                        <div className="flex justify-end gap-2">
                          {resolved ? (
                            <OutcomeBadge outcome={rung.outcome} />
                          ) : (
                            <>
                              <button
                                onClick={() => onBuy?.(rung.marketId, "YES")}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
                              >
                                Buy YES
                              </button>
                              <button
                                onClick={() => onBuy?.(rung.marketId, "NO")}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1"
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
            {!loading && sorted.length === 0 && (
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
  );
};

export default LadderGroupView;
