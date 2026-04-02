import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { FaFilter, FaBookmark, FaSearch } from 'react-icons/fa';
import axios from '../../setupAxios';
import PollCard from '../../components/polls/PollCard';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { BACKEND_URL } from "../../contexts/Bakendurl";

const Politics = () => {
  const [selectedSubCategory, setSelectedSubCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const subCategories = [
    'All', 'Trump-Putin', 'Trump Presidency', 'Trade War', 'Israel Ukraine', 
    'Inflation', 'AI Geopolitics GPT-5', 'Texas', 'Redistricting', 'Epstein', 
    'Jerome Powell', 'Earn 4%', 'Fed Rates'
  ];

  // Fetch polls for Politics category
  const { data: pollsData, isLoading, error } = useQuery(
    ['polls', 'Politics', selectedSubCategory, searchTerm, currentPage],
    async () => {
      const params = new URLSearchParams({
        category: 'Politics',
        page: currentPage,
        limit: 12
      });
      
      if (selectedSubCategory !== 'All') {
        params.append('subCategory', selectedSubCategory);
      }
      
      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await axios.get(`${BACKEND_URL}/api/polls?${params}`);
      return response.data;
    },
    {
      keepPreviousData: true,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  const handleSubCategoryChange = (subCategory) => {
    setSelectedSubCategory(subCategory);
    setCurrentPage(1);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Error Loading Polls
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
            Politics
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Trade on political events, elections, and policy decisions
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
                  placeholder="Search politics polls..."
                  className="input pl-10 pr-4 w-full"
                />
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </form>
            </div>

            {/* Sub-category filter */}
            <div className="flex items-center space-x-2">
              <FaFilter className="text-gray-400" />
              <select
                value={selectedSubCategory}
                onChange={(e) => handleSubCategoryChange(e.target.value)}
                className="input"
              >
                {subCategories.map((subCategory) => (
                  <option key={subCategory} value={subCategory}>
                    {subCategory}
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
                  
                  {Array.from({ length: pollsData.pagination.totalPages }, (_, i) => i + 1)
                    .filter(page => 
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
                              ? 'btn-primary'
                              : 'btn-outline'
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
                  No polls found
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Try adjusting your search or filter criteria.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Politics;
