import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import axios from "../../setupAxios";
import PollCard from "../../components/polls/PollCard";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import { BACKEND_URL } from "../../contexts/Bakendurl";

const Trending = () => {
  const [sort, setSort] = useState("volume");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef(null);

  const { data, isLoading, error } = useQuery(
    ["trending"],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/polls/trending?limit=60`);
      return res.data;
    },
    {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  );

  const sorted = useMemo(() => {
    const list = data || [];
    if (sort === "volume")
      return [...list].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0));
    if (sort === "trades")
      return [...list].sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0));
    return list;
  }, [data, sort]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setShowSortMenu(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                Trending
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Most active markets by volume and trades
              </p>
            </div>
            <div className="w-full sm:w-auto" ref={sortRef}>
              <div className="relative w-full sm:w-56">
                <button
                  type="button"
                  className="input w-full text-left flex items-center justify-between"
                  aria-haspopup="listbox"
                  aria-expanded={showSortMenu}
                  onClick={() => setShowSortMenu((prev) => !prev)}
                >
                  <span>{sort === "volume" ? "Sort by Volume" : "Sort by Trades"}</span>
                  <span className="text-gray-400 ml-3">v</span>
                </button>

                {showSortMenu && (
                  <div
                    role="listbox"
                    className="absolute z-30 mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => {
                        setSort("volume");
                        setShowSortMenu(false);
                      }}
                    >
                      Sort by Volume
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => {
                        setSort("trades");
                        setShowSortMenu(false);
                      }}
                    >
                      Sort by Trades
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400">
            Failed to load trending.
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 sm:[grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
            {sorted.map((poll) => (
              <PollCard key={poll._id} poll={poll} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Trending;

