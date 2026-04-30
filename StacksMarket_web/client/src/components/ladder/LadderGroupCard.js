// LadderGroupCard.js — Compact card for listing ladder groups on Home / category pages
// Styled to match PollCard appearance

import React from "react";
import { Link } from "react-router-dom";
import { FaClock, FaChartLine, FaChevronRight } from "react-icons/fa";
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
  return kFormat(stx);
};

const parseDate = (ts) => {
  if (!ts) return null;
  const n = Number(ts);
  if (Number.isFinite(n) && n < 1e12) return new Date(n * 1000);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatEndAt = (ts) => {
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

// Same palette as LadderGroupDetail chart lines
const RUNG_COLORS = [
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#10B981", // emerald
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F97316", // orange
];

const ProbPill = ({ label, pct, color }) => {
  const clamped = Math.max(0, Math.min(100, Number(pct || 0)));

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{
        backgroundColor: `${color}18`,
        color: color,
        border: `1px solid ${color}30`,
      }}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="truncate max-w-[80px]">{label}</span>
      <span className="opacity-80">{clamped.toFixed(0)}%</span>
    </span>
  );
};

// ------------------- Component -------------------

const LadderGroupCard = ({ group }) => {
  if (!group) return null;

  // Sort all rungs by descending probability (same order as chart/table in LadderGroupDetail)
  const allRungsSorted = (group.rungs || [])
    .slice()
    .sort((a, b) => Number(b.probability ?? 0) - Number(a.probability ?? 0));

  // Show top 3 non-resolved rungs, but keep their original index for color mapping
  const topRungs = allRungsSorted
    .map((r, idx) => ({ ...r, _colorIdx: idx }))
    .filter((r) => !r.isResolved)
    .slice(0, 3);

  const rungCount = (group.rungs || []).length;
  const isResolved = String(group.status || "").toLowerCase() === "resolved";

  return (
    <Link
      to={`/ladder/${group.groupId ?? group._id}`}
      className="block group"
      aria-label={`View ladder market: ${group.title}`}
    >
      <div className="card-hover p-4 md:p-5 h-full">
        <div className="flex flex-col h-full">
          {/* Title row — matches PollCard layout */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0">
                {group.image && (
                  <img src={group.image} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="max-h-14 overflow-hidden">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">
                  {group.title || "Categorical Market"}
                </h3>
              </div>
            </div>
            {isResolved && (
              <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Resolved
              </span>
            )}
          </div>

          {/* Meta row — matches PollCard */}
          <div className="mb-4 mt-3 space-y-1 text-[13px] text-gray-600 dark:text-gray-300 w-full">
            {group.closeTime && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 w-full">
                <span className="inline-flex items-center gap-2">
                  <FaClock className="w-3.5 h-3.5 opacity-80" />
                  Ends at {formatEndAt(group.closeTime)}
                  <span className="ml-2 text-gray-400 dark:text-gray-500">
                    ({timeRemaining(group.closeTime)})
                  </span>
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 w-full">
              <span className="inline-flex items-center gap-2">
                <FaChartLine className="w-3.5 h-3.5 opacity-80" />
                Vol. STX {formatVolume(group.totalVolume || 0)}
              </span>
              <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500">
                {rungCount} {rungCount === 1 ? "rung" : "rungs"}
              </span>
            </div>
          </div>

          {/* Top 3 rungs — unique to ladder */}
          {topRungs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {topRungs.map((r) => (
                <ProbPill
                  key={r.marketId ?? r._id}
                  label={r.label}
                  pct={r.probability ?? 50}
                  color={RUNG_COLORS[r._colorIdx % RUNG_COLORS.length]}
                />
              ))}
            </div>
          )}

          {/* Footer — matches PollCard */}
          <div className="mt-auto pt-2 flex items-center justify-end text-[12px] text-gray-400 dark:text-gray-500">
            <span>See All Options</span>
            <FaChevronRight className="w-3 h-3 ml-1" />
          </div>
        </div>
      </div>
    </Link>
  );
};

export default LadderGroupCard;
