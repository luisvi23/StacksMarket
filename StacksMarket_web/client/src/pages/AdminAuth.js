import React, { useState, useEffect } from "react";
import axios from "../setupAxios";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  authenticate,
  getWalletAddress,
  logoutWallet,
} from "../utils/stacksConnect";
import { BACKEND_URL } from "../contexts/Bakendurl";

const AdminAuth = () => {
  const navigate = useNavigate();
  const { authenticateWithToken } = useAuth();
  const [walletAddress, setWalletAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [error, setError] = useState("");
  const [isWalletConnected, setIsWalletConnected] = useState(false);

  useEffect(() => {
    const address = getWalletAddress();
    if (address) {
      setWalletAddress(address);
      setIsWalletConnected(true);
    } else {
      setWalletAddress("");
      setIsWalletConnected(false);
    }
  }, []);

  const handleConnectWallet = async () => {
    setError("");
    try {
      const address = await authenticate();
      if (address) {
        setWalletAddress(address);
        setIsWalletConnected(true);
      }
    } catch (err) {
      setError(
        err?.message ||
          "No compatible wallet extension detected. Please install Leather or Xverse to continue."
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const url =
        mode === "login"
          ? `${BACKEND_URL}/api/auth/admin-login`
          : `${BACKEND_URL}/api/auth/admin-register`;
      const res = await axios.post(url, { walletAddress });
      const { token } = res.data;
      await authenticateWithToken(token);
      navigate("/admin");
    } catch (err) {
      setError(err.response?.data?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-lg shadow-soft p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Admin {mode === "login" ? "Login" : "Registration"}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Authenticate with your wallet address.
        </p>
        {isWalletConnected ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1 flex justify-between items-center">
                Wallet Address
                <span className="ml-2 px-2 py-0.5 text-xs rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  Connected
                </span>
              </label>
              <input
                type="text"
                value={walletAddress}
                disabled
                className="input w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed"
              />
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                ? "Login as Admin"
                : "Register as Admin"}
            </button>
          </form>
        ) : (
          <button onClick={handleConnectWallet} className="btn-primary w-full">
            Connect Wallet
          </button>
        )}
        <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          {mode === "login" ? (
            <>
              Don’t have admin access?
              <button
                onClick={() => setMode("register")}
                className="ml-1 text-primary-600 dark:text-primary-400"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already an admin?
              <button
                onClick={() => setMode("login")}
                className="ml-1 text-primary-600 dark:text-primary-400"
              >
                Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAuth;
