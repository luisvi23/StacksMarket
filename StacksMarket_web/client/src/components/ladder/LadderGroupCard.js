// LadderGroupCard.js — Compact card for listing ladder groups on Home / category pages
// Props:
//   group: {
//     _id, groupId, title, rungs (array), totalVolume, closeTime, status
//   }

import React from "react";
import { Link } from "react-router-dom";
import { FaClock, FaChartBar } from "react-icons/fa";
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

const timeRemaining = (ts) => {
  if (!ts) return "—";
  const end = new Date(Number(ts) * 1000);
  if (Number.isNaN(end.getTime())) return "—";
  const diff = end - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const ProbPill = ({ label, pct }) => {
  const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
  const bg =
    clamped >= 66
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      : clamped >= 34
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${bg}`}>
      <span className="truncate max-w-[80px]">{label}</span>
      <span>{clamped.toFixed(0)}%</span>
    </span>
  );
};

// ------------------- Component -------------------

const LadderGroupCard = ({ group }) => {
  if (!group) return null;

  const topRungs = (group.rungs || [])
    .filter((r) => !r.isResolved)
    .sort((a, b) => Number(b.threshold || 0) - Number(a.threshold || 0))
    .slice(0, 3);

  const rungCount = (group.rungs || []).length;
  const isResolved = String(group.status || "").toLowerCase() === "resolved";

  return (
    <Link
      to={`/ladder/${group.groupId ?? group._id}`}
      className="block group"
      aria-label={`View ladder market: ${group.title}`}
    >
      <div className="bg-white dark:bg-[#0b1220] border border-gray-200 dark:border-[#1f2937] rounded-2xl p-4 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md transition-all duration-150">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug line-clamp-2 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
            {group.title || "Ladder Market"}
          </h3>
          {isResolved && (
            <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Resolved
            </span>
          )}
        </div>

        {/* Top 3 rungs */}
        {topRungs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {topRungs.map((r) => (
              <ProbPill
                key={r.marketId ?? r._id}
                label={r.label || `#${r.threshold}`}
                pct={r.probability ?? 50}
              />
            ))}
          </div>
        )}

        {/* Footer meta */}
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <FaChartBar className="w-3 h-3" />
              {rungCount} {rungCount === 1 ? "rung" : "rungs"}
            </span>
            {group.totalVolume != null && Number(group.totalVolume) > 0 && (
              <span>{formatVolume(group.totalVolume)}</span>
            )}
          </div>

          {group.closeTime && (
            <span className="flex items-center gap-1">
              <FaClock className="w-3 h-3" />
              {timeRemaining(group.closeTime)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default LadderGroupCard;
