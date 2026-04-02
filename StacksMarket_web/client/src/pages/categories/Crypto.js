import React, { useMemo, useState } from "react";
import { useQuery } from "react-query";
import axios from "../../setupAxios";
import PollCard from "../../components/polls/PollCard";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import { FaFilter } from "react-icons/fa";
import { BACKEND_URL } from "../../contexts/Bakendurl";

const CRYPTOS = [
  {
    name: "Stacks",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "Ethereum",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "Solana",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "Cardano",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "BNB",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "Chainlink",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
  {
    name: "Polygon",
    logo: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400",
  },
];

const Crypto = () => {
  const [timeframe, setTimeframe] = useState("all"); // all | hourly | daily | monthly
  const [selectedCrypto, setSelectedCrypto] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      category: "Crypto",
      page: currentPage,
      limit: 12,
      sort: "createdAt",
      order: "desc",
    });
    if (timeframe !== "all") p.append("timeframe", timeframe);
    if (selectedCrypto !== "All") p.append("cryptoName", selectedCrypto);
    return p;
  }, [timeframe, selectedCrypto, currentPage]);

  const {
    data: pollsData,
    isLoading,
    error,
  } = useQuery(
    ["polls", "Crypto", timeframe, selectedCrypto, currentPage],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/polls?${params}`);
      return res.data;
    },
    { keepPreviousData: true, staleTime: 60 * 1000 }
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Crypto
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Markets on major cryptocurrencies
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Side navigation */}
        <aside className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-4">
            <div className="flex items-center gap-2 mb-3 text-gray-700 dark:text-gray-300">
              <FaFilter />
              <span className="font-semibold">Timeframe</span>
            </div>
            <div className="space-y-2">
              {[
                { key: "all", label: "All" },
                { key: "hourly", label: "Hourly" },
                { key: "daily", label: "Daily" },
                { key: "monthly", label: "Monthly" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTimeframe(t.key);
                    setCurrentPage(1);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm border ${
                    timeframe === t.key
                      ? "border-primary-400 bg-stacks-500 dark:bg-stacks-900/40 text-gray-900 dark:text-gray-100"
                      : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <span>{t.label}</span>
                  <span className="text-xs opacity-70">
                    {pollsData?.pagination?.total ||
                      pollsData?.polls?.length ||
                      0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-4">
            <div className="font-semibold mb-3 text-gray-700 dark:text-gray-300">
              Crypto
            </div>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
              <button
                onClick={() => {
                  setSelectedCrypto("All");
                  setCurrentPage(1);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm border ${
                  selectedCrypto === "All"
                    ? "border-primary-400 bg-stacks-500 dark:bg-stacks-900/40 text-gray-900 dark:text-gray-100"
                    : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-gray-300" />
                <span>All</span>
              </button>
              {CRYPTOS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => {
                    setSelectedCrypto(c.name);
                    setCurrentPage(1);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm border ${
                    selectedCrypto === c.name
                      ? "border-primary-400 bg-yellow-600 dark:bg-primary-950/40 text-gray-900 dark:text-gray-100"
                      : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  <img
                    src={c.logo}
                    alt={c.name}
                    className="w-5 h-5 rounded-full"
                  />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Right: Grid 3 per row */}
        <div className="lg:col-span-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-gray-600 dark:text-gray-400">
              Failed to load polls.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {pollsData?.polls?.map((p) => (
                  <PollCard
                    key={p._id}
                    poll={{ ...p, cryptoName: p.cryptoName || selectedCrypto }}
                  />
                ))}
              </div>
              {pollsData?.pagination?.totalPages > 1 && (
                <div className="flex justify-center mt-8">
                  <nav className="flex items-center space-x-2">
                    <button
                      onClick={() => setCurrentPage((c) => Math.max(1, c - 1))}
                      disabled={!pollsData.pagination.hasPrev}
                      className="btn-outline btn-sm disabled:opacity-50"
                    >
                      Previous
                    </button>
                    {Array.from(
                      { length: pollsData.pagination.totalPages },
                      (_, i) => i + 1
                    )
                      .filter(
                        (page) =>
                          page === 1 ||
                          page === pollsData.pagination.totalPages ||
                          Math.abs(page - currentPage) <= 2
                      )
                      .map((page, idx, arr) => (
                        <React.Fragment key={page}>
                          {idx > 0 && arr[idx - 1] !== page - 1 && (
                            <span className="px-2 text-gray-500">...</span>
                          )}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`btn-sm ${
                              page === currentPage
                                ? "btn-primary"
                                : "btn-outline"
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      ))}
                    <button
                      onClick={() => setCurrentPage((c) => c + 1)}
                      disabled={!pollsData.pagination.hasNext}
                      className="btn-outline btn-sm disabled:opacity-50"
                    >
                      Next
                    </button>
                  </nav>
                </div>
              )}
              {pollsData?.polls?.length === 0 && (
                <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                  No polls found.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Crypto;
