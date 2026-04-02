import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "react-query";
import { FaCheckCircle, FaPlayCircle } from "react-icons/fa";
import axios from "../setupAxios";
import PollCard from "../components/polls/PollCard";
import LoadingSpinner from "../components/common/LoadingSpinner";
import logo from "../assets/imgs/sm-logo-white.png";
import { BACKEND_URL } from "../contexts/Bakendurl";

const PAGE_SIZE = 24;

const Home = () => {
  const [marketTab, setMarketTab] = useState("active");
  const [activePage, setActivePage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);

  const { data: pollsData, isLoading: pollsLoading } = useQuery(
    ["home-active-polls", activePage],
    async () => {
      const response = await axios.get(
        `${BACKEND_URL}/api/polls?marketState=active&page=${activePage}&limit=${PAGE_SIZE}&sort=createdAt&order=desc`
      );
      return response.data;
    },
    {
      keepPreviousData: true,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  );

  const { data: closedPollsData, isLoading: closedPollsLoading } = useQuery(
    ["home-closed-polls", closedPage],
    async () => {
      const response = await axios.get(
        `${BACKEND_URL}/api/polls?marketState=closed&page=${closedPage}&limit=${PAGE_SIZE}&sort=createdAt&order=desc`
      );
      return response.data;
    },
    {
      enabled: marketTab === "closed",
      keepPreviousData: true,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  );

  const sortByNewest = (list = []) =>
    [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const activePolls = sortByNewest(pollsData?.polls || []);
  const closedPolls = sortByNewest(closedPollsData?.polls || []);
  const visiblePolls = marketTab === "active" ? activePolls : closedPolls;
  const tabLoading = marketTab === "active" ? pollsLoading : closedPollsLoading;
  const activePagination = pollsData?.pagination || {};
  const closedPagination = closedPollsData?.pagination || {};
  const activeHasPagination = Number(activePagination.totalPages) > 1;
  const closedHasPagination = Number(closedPagination.totalPages) > 1;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <section className="py-14">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10">
          <div className="mb-8">
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setMarketTab("active")}
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-t-xl border border-b-0 text-sm font-semibold transition-colors ${
                  marketTab === "active"
                    ? "bg-white dark:bg-[#0f172a] border-gray-200 dark:border-[#334155] text-gray-900 dark:text-white shadow-[0_-2px_0_0_#38bdf8_inset]"
                    : "bg-gray-100 dark:bg-[#111827] border-gray-200 dark:border-[#1f2937] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                }`}
              >
                <FaPlayCircle className="w-4 h-4 text-emerald-500" />
                Active Markets
              </button>
              <button
                type="button"
                onClick={() => setMarketTab("closed")}
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-t-xl border border-b-0 text-sm font-semibold transition-colors ${
                  marketTab === "closed"
                    ? "bg-white dark:bg-[#0f172a] border-gray-200 dark:border-[#334155] text-gray-900 dark:text-white shadow-[0_-2px_0_0_#38bdf8_inset]"
                    : "bg-gray-100 dark:bg-[#111827] border-gray-200 dark:border-[#1f2937] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
                }`}
              >
                <FaCheckCircle className="w-4 h-4 text-blue-500" />
                Closed Markets
              </button>
            </div>

            <div className="border border-gray-200 dark:border-[#1f2937] rounded-b-2xl rounded-tr-2xl bg-white dark:bg-[#0b1220] px-5 py-5">
              <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-[#1f2937]">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {marketTab === "active" ? "Active Markets" : "Closed Markets"}
                </h2>
                <Link
                  to="/trending"
                  className="text-gray-500 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white font-medium"
                >
                  View All ->
                </Link>
              </div>

              {tabLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <div className="mt-5 grid gap-6 grid-cols-1 sm:[grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
                  {visiblePolls.map((poll) => (
                    <PollCard key={poll._id} poll={poll} compact={marketTab === "closed"} />
                  ))}
                  {visiblePolls.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-300">
                      {marketTab === "active"
                        ? "No active markets right now."
                        : "No closed markets right now."}
                    </p>
                  )}
                </div>
              )}

              {!tabLoading && marketTab === "active" && activeHasPagination && (
                <div className="mt-6 flex justify-center items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                    disabled={!activePagination.hasPrev}
                    className="btn-outline btn-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500 dark:text-slate-300">
                    Page {activePagination.currentPage} / {activePagination.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePage((p) => p + 1)}
                    disabled={!activePagination.hasNext}
                    className="btn-outline btn-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}

              {!tabLoading && marketTab === "closed" && closedHasPagination && (
                <div className="mt-6 flex justify-center items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setClosedPage((p) => Math.max(1, p - 1))}
                    disabled={!closedPagination.hasPrev}
                    className="btn-outline btn-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500 dark:text-slate-300">
                    Page {closedPagination.currentPage} / {closedPagination.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setClosedPage((p) => p + 1)}
                    disabled={!closedPagination.hasNext}
                    className="btn-outline btn-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-stacks-700 via-stacks-600 to-stacks-500 text-white">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 py-16 md:py-20">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div
                className="rounded-full bg-white/5 ring-1 ring-white/30 p-[4px] overflow-hidden"
                style={{ width: 64, height: 64 }}
              >
                <img
                  src={logo}
                  alt="StacksMarket Logo"
                  className="w-full h-full rounded-full object-contain"
                  draggable="false"
                />
              </div>
            </div>

            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Welcome to <span className="text-stacks-200">Stacks Market</span>
            </h1>
            <p className="text-xl md:text-2xl mb-8 text-stacks-100 max-w-3xl mx-auto">
              The world's STX premier prediction marketplace. Trade on the future
              with confidence.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/trending"
                className="btn bg-white text-primary-700 hover:bg-gray-100 px-8 py-3 text-lg font-semibold"
              >
                Start Trading
              </Link>
              <Link
                to="/learn"
                className="btn border-2 border-white text-white hover:bg-white hover:text-primary-700 px-8 py-3 text-lg font-semibold"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-100 dark:bg-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Ready to Start Trading?
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            Join Stacks Market today and start making predictions on the world's
            most important events.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/trending" className="btn-primary btn-lg">
              Browse Markets
            </Link>
            <Link to="/learn" className="btn-outline btn-lg">
              Learn How It Works
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
