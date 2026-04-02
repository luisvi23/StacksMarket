import React from "react";
import { Link } from "react-router-dom";
import { FaHome } from "react-icons/fa";
import logo from "../assets/imgs/sm-logo-orange.png";

const NotFound = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-8">
          <img src={logo} alt="StacksMarket Logo" className="w-24 h-24" />
        </div>
        <h1 className="text-6xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          404
        </h1>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Page Not Found
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto">
          The page you're looking for doesn't exist. It might have been moved,
          deleted, or you entered the wrong URL.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/"
            className="btn-primary inline-flex items-center space-x-2"
          >
            <FaHome className="w-4 h-4" />
            <span>Go Home</span>
          </Link>
          <button onClick={() => window.history.back()} className="btn-outline">
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
