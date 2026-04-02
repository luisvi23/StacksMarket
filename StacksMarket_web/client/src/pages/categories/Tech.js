import React, { useState } from 'react';
import { useQuery } from 'react-query';
import axios from '../../setupAxios';
import { FaFilter, FaSearch } from 'react-icons/fa';
import PollCard from '../../components/polls/PollCard';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { BACKEND_URL } from "../../contexts/Bakendurl";

const Tech = () => {
  const [selectedSubCategory, setSelectedSubCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const subCategories = ['All', 'AI', 'GPT-5', 'Elon Musk', 'Grok', 'Science', 'SpaceX', 'OpenAI', 'MicroStrategy', 'Big Tech', 'TikTok', 'Meta'];

  const { data: pollsData, isLoading, error } = useQuery(
    ['polls', 'Tech', selectedSubCategory, searchTerm, currentPage],
    async () => {
      const params = new URLSearchParams({ category: 'Tech', page: currentPage, limit: 12 });
      if (selectedSubCategory !== 'All') params.append('subCategory', selectedSubCategory);
      if (searchTerm) params.append('search', searchTerm);
      const res = await axios.get(`${BACKEND_URL}/api/polls?${params}`);
      return res.data;
    },
    { keepPreviousData: true, staleTime: 5 * 60 * 1000 }
  );

  const handleSearch = (e) => { e.preventDefault(); setCurrentPage(1); };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Tech</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">AI, big tech, and innovation markets</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 mb-8">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1">
              <form onSubmit={handleSearch} className="relative">
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search tech polls..." className="input pl-10 pr-4 w-full" />
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </form>
            </div>
            <div className="flex items-center space-x-2">
              <FaFilter className="text-gray-400" />
              <select value={selectedSubCategory} onChange={(e) => { setSelectedSubCategory(e.target.value); setCurrentPage(1); }} className="input">
                {subCategories.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : error ? (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400">Failed to load polls.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {pollsData?.polls?.map(p => <PollCard key={p._id} poll={p} />)}
            </div>
            {pollsData?.pagination?.totalPages > 1 && (
              <div className="flex justify-center mt-8">
                <nav className="flex items-center space-x-2">
                  <button onClick={() => setCurrentPage(c => Math.max(1, c - 1))} disabled={!pollsData.pagination.hasPrev} className="btn-outline btn-sm disabled:opacity-50">Previous</button>
                  {Array.from({ length: pollsData.pagination.totalPages }, (_, i) => i + 1)
                    .filter(page => page === 1 || page === pollsData.pagination.totalPages || Math.abs(page - currentPage) <= 2)
                    .map((page, idx, arr) => (
                      <React.Fragment key={page}>
                        {idx > 0 && arr[idx - 1] !== page - 1 && (<span className="px-2 text-gray-500">...</span>)}
                        <button onClick={() => setCurrentPage(page)} className={`btn-sm ${page === currentPage ? 'btn-primary' : 'btn-outline'}`}>{page}</button>
                      </React.Fragment>
                    ))}
                  <button onClick={() => setCurrentPage(c => c + 1)} disabled={!pollsData.pagination.hasNext} className="btn-outline btn-sm disabled:opacity-50">Next</button>
                </nav>
              </div>
            )}
            {pollsData?.polls?.length === 0 && (
              <div className="text-center py-12 text-gray-600 dark:text-gray-400">No polls found.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Tech;
