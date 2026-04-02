import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "react-query";
import { FaCheckCircle } from "react-icons/fa";
import axios from "../setupAxios";
import PollCard from "../components/polls/PollCard";
import LoadingSpinner from "../components/common/LoadingSpinner";
import { BACKEND_URL } from "../contexts/Bakendurl";

const PAGE_SIZE = 24;

export default function ClosedMarkets() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery(
    ["closed-markets", page],
    async () => {
      const res = await axios.get(
        `${BACKEND_URL}/api/polls?marketState=closed&page=${page}&limit=${PAGE_SIZE}&sort=createdAt&order=desc`
      );
      return res.data;
    },
    {
      keepPreviousData: true,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    }
  );

  const polls = Array.isArray(data?.polls) ? data.polls : [];
  const pagination = data?.pagination || {};

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10">
        <div className="flex items-center justify-between mb-8 gap-3">
          <div className="flex items-center space-x-3">
            <FaCheckCircle className="w-6 h-6 text-blue-500" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Closed Markets
            </h1>
          </div>
          <Link to="/" className="btn-outline btn-sm">
            Back to Home
          </Link>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            <div className="grid gap-6 grid-cols-1 sm:[grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
              {polls.map((poll) => (
                <PollCard key={poll._id} poll={poll} compact />
              ))}
              {polls.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No closed markets found.
                </p>
              )}
            </div>

            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center space-x-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!pagination.hasPrev}
                  className="btn-outline btn-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Page {pagination.currentPage} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination.hasNext}
                  className="btn-outline btn-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
