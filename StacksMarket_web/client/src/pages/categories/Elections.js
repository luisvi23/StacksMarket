import React, { useState } from 'react';
import { useQuery } from 'react-query';
import axios from '../../setupAxios';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { BACKEND_URL } from "../../contexts/Bakendurl";

const Elections = () => {
  const [currentPage, setCurrentPage] = useState(1);

  const { data: pollsData, isLoading, error } = useQuery(
    ['polls', 'Elections', currentPage],
    async () => {
      const params = new URLSearchParams({ category: 'Elections', page: currentPage, limit: 12 });
      const res = await axios.get(`${BACKEND_URL}/api/polls?${params}`);
      return res.data;
    },
    { keepPreviousData: true, staleTime: 5 * 60 * 1000 }
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Elections</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">Global elections, candidates and outcomes</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : error ? (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400">Failed to load polls.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pollsData?.polls?.map((p) => (
                <div key={p._id} className="card-hover p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{p.country || 'Country'}</div>
                    {p.countryFlag && (
                      <img src={p.countryFlag} alt={p.country} className="w-6 h-4 object-cover rounded" />
                    )}
                  </div>
                  <h3 className="text-gray-900 dark:text-gray-100 font-medium mb-4">{p.title}</h3>
                  <div className="space-y-2">
                    {(p.candidates || []).map((c, idx) => (
                      <div key={idx} className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-8 relative overflow-hidden">
                        <div className="absolute inset-0 flex items-center px-2">
                          <div className="flex items-center gap-2">
                            {c.image && <img src={c.image} alt={c.name} className="w-6 h-6 rounded-full object-cover" />}
                            <span className="text-xs sm:text-sm text-gray-900 dark:text-gray-100">{c.name}</span>
                          </div>
                          <span className="ml-auto text-xs sm:text-sm text-gray-900 dark:text-gray-100 font-semibold">{c.percentage || 0}%</span>
                        </div>
                        <div className="bg-primary-600 h-8" style={{ width: `${c.percentage || 0}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
          </>
        )}
      </div>
    </div>
  );
};

export default Elections;
