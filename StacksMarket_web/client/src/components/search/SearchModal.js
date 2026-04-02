import React, { useState, useEffect } from "react";
import { useQuery } from "react-query";
import { Link } from "react-router-dom";
import { FaTimes, FaSearch, FaClock, FaChartLine } from "react-icons/fa";
import axios from "../../setupAxios";
import { BACKEND_URL } from "../../contexts/Bakendurl";
import { formatStx } from "../../utils/stx";

const SearchModal = ({ isOpen, onClose }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Search query
  const { data: searchResults, isLoading } = useQuery(
    ["search", debouncedSearchTerm],
    async () => {
      if (!debouncedSearchTerm.trim()) return { polls: [] };
      const response = await axios.get(
        `${BACKEND_URL}/api/polls?search=${debouncedSearchTerm}&limit=10`
      );
      return response.data;
    },
    {
      enabled: !!debouncedSearchTerm.trim(),
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };

  const handleResultClick = () => {
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Search Polls
            </h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <FaTimes className="w-5 h-5" />
            </button>
          </div>

          {/* Search Input */}
          <div className="relative mb-6">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search for polls, topics, or categories..."
              className="input pl-10 pr-4 text-lg"
              autoFocus
            />
            <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          </div>

          {/* Search Results */}
          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            {!debouncedSearchTerm.trim() ? (
              <div className="text-center py-8">
                <FaSearch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  Start typing to search for polls
                </p>
              </div>
            ) : isLoading ? (
              <div className="text-center py-8">
                <div className="spinner w-8 h-8 mx-auto mb-4"></div>
                <p className="text-gray-500 dark:text-gray-400">Searching...</p>
              </div>
            ) : searchResults?.polls?.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 dark:text-gray-400">
                  No polls found for "{debouncedSearchTerm}"
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {searchResults?.polls?.map((poll) => (
                  <Link
                    key={poll._id}
                    to={`/poll/${poll._id}`}
                    onClick={handleResultClick}
                    className="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-start space-x-3">
                      {poll.image && (
                        <img
                          src={poll.image}
                          alt={poll.title}
                          className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {poll.title}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {poll.description}
                        </p>
                        <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
                          <span className="flex items-center space-x-1">
                            <FaChartLine className="w-3 h-3" />
                            <span>{poll.category}</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <FaClock className="w-3 h-3" />
                            <span>
                              {new Date(poll.endDate).toLocaleDateString()}
                            </span>
                          </span>
                          {poll.totalVolume > 0 && (
                            <span>{formatStx(poll.totalVolume)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick Categories */}
          {!debouncedSearchTerm.trim() && (
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Popular Categories
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  "Politics",
                  "Crypto",
                  "Tech",
                  "Sports",
                  "Economy",
                  "World",
                ].map((category) => (
                  <button
                    key={category}
                    onClick={() => setSearchTerm(category)}
                    className="text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {category}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
