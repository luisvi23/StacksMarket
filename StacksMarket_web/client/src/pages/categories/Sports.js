import React, { useState } from "react";
import { useQuery } from "react-query";
import { FaFilter, FaSearch } from "react-icons/fa";
import axios from "../../setupAxios";
import PollCard from "../../components/polls/PollCard";
import LoadingSpinner from "../../components/common/LoadingSpinner";
import { BACKEND_URL } from "../../contexts/Bakendurl";

const Sports = () => {
  const [selectedSport, setSelectedSport] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const sportsSubCategories = [
    "All",
    "Football",
    "Basketball",
    "Baseball",
    "Soccer",
    "Tennis",
    "Golf",
    "Boxing",
    "MMA",
    "Olympics",
  ];

  const { data: pollsData, isLoading, error } = useQuery(
    ["polls", "Sports", selectedSport, searchTerm, currentPage],
    async () => {
      const params = new URLSearchParams({
        category: "Sports",
        page: currentPage,
        limit: 12,
      });

      if (selectedSport !== "All") {
        params.append("subCategory", selectedSport);
      }

      if (searchTerm) {
        params.append("search", searchTerm);
      }

      const res = await axios.get(`${BACKEND_URL}/api/polls?${params}`);
      return res.data;
    },
    {
      keepPreviousData: true,
      staleTime: 5 * 60 * 1000,
    }
  );

  const handleSportChange = (sport) => {
    setSelectedSport(sport);
    setCurrentPage(1);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Error loading sports markets
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Please try again later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Sports
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Trade on matches, tournaments, and sports events
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-8">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <form onSubmit={handleSearch} className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search sports markets..."
                  className="input pl-10 pr-4 w-full"
                />
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </form>
            </div>

            {/* Sport (subCategory) filter */}
            <div className="flex items-center space-x-2">
              <FaFilter className="text-gray-400" />
              <select
                value={selectedSport}
                onChange={(e) => handleSportChange(e.target.value)}
                className="input"
              >
                {sportsSubCategories.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Polls Grid */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {pollsData?.polls?.map((poll) => (
                <PollCard key={poll._id} poll={poll} />
              ))}
            </div>

            {/* Pagination */}
            {pollsData?.pagination && pollsData.pagination.totalPages > 1 && (
              <div className="flex justify-center mt-8">
                <nav className="flex items-center space-x-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={!pollsData.pagination.hasPrev}
                    className="btn-outline btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
                    .map((page, index, array) => (
                      <React.Fragment key={page}>
                        {index > 0 && array[index - 1] !== page - 1 && (
                          <span className="px-2 text-gray-500">...</span>
                        )}
                        <button
                          onClick={() => handlePageChange(page)}
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
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={!pollsData.pagination.hasNext}
                    className="btn-outline btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}

            {/* No results */}
            {pollsData?.polls?.length === 0 && (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  No sports markets found
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Try adjusting your search or sport filter.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Sports;
