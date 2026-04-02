function buildConfirmedFilter() {
  return {
    $or: [{ creationStatus: "confirmed" }, { creationStatus: { $exists: false } }],
  };
}

function buildActiveMarketFilter(now = new Date()) {
  return {
    $and: [
      buildConfirmedFilter(),
      { enabled: true },
      { isResolved: { $ne: true } },
      { isActive: true },
      { endDate: { $gt: now } },
    ],
  };
}

function buildClosedMarketFilter(now = new Date()) {
  return {
    $and: [
      buildConfirmedFilter(),
      { enabled: true },
      {
        $or: [{ isResolved: true }, { isActive: false }, { endDate: { $lte: now } }],
      },
    ],
  };
}

function buildListedMarketFilter() {
  return {
    $and: [
      buildConfirmedFilter(),
      { enabled: true },
      {
        $or: [{ isActive: true }, { isResolved: true }],
      },
    ],
  };
}

function normalizeMarketState(raw) {
  const value = String(raw || "listed").trim().toLowerCase();
  if (value === "active") return "active";
  if (value === "closed") return "closed";
  return "listed";
}

function buildMarketStateFilter(state, now = new Date()) {
  const normalized = normalizeMarketState(state);
  if (normalized === "active") return buildActiveMarketFilter(now);
  if (normalized === "closed") return buildClosedMarketFilter(now);
  return buildListedMarketFilter();
}

module.exports = {
  buildActiveMarketFilter,
  buildClosedMarketFilter,
  buildListedMarketFilter,
  buildMarketStateFilter,
  normalizeMarketState,
};
