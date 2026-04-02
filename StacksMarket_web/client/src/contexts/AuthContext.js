import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import axios from "../setupAxios";
import toast from "react-hot-toast";
import { BACKEND_URL } from "./Bakendurl";
import { logoutWallet, subscribeToAccountChanges, setWalletMismatchHandler } from "../utils/stacksConnect";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(
    localStorage.getItem("stacksmarket-token")
  );
  const refreshPromiseRef = useRef(null);
  const logoutRef = useRef(null);

  const isRefreshRequest = (url = "") =>
    String(url || "").toLowerCase().includes("/auth/refresh");

  // Configure axios defaults
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common["Authorization"];
    }
  }, [token]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error?.config || {};
        const is401 = error?.response?.status === 401;
        if (!is401 || !token) return Promise.reject(error);

        // Never try to refresh when /refresh itself failed.
        if (originalRequest?.skipAuthRefresh || isRefreshRequest(originalRequest?.url)) {
          logout();
          return Promise.reject(error);
        }

        // Only retry each request once.
        if (originalRequest._retry) {
          logout();
          return Promise.reject(error);
        }
        originalRequest._retry = true;

        const refreshed = await refreshToken();
        if (refreshed.success) {
          const newToken = localStorage.getItem("stacksmarket-token");
          if (newToken) {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
            return axios.request(originalRequest); // retry original request once
          }
        }

        logout();
        return Promise.reject(error);
      }
    );

    return () => axios.interceptors.response.eject(interceptor);
  }, [token]);

  // Keep logoutRef current so the account-change listener always calls the latest logout
  useEffect(() => {
    logoutRef.current = logout;
  });

  // Register handler so marketClient can trigger logout on wallet mismatch at transaction time
  useEffect(() => {
    setWalletMismatchHandler(() => {
      toast("Wallet changed — please reconnect.", { icon: "⚠️" });
      logoutRef.current?.();
    });
    return () => setWalletMismatchHandler(null);
  }, []);

  // Detect Leather account switch and force re-login
  useEffect(() => {
    const walletAddress = user?.walletAddress;
    if (!walletAddress) return;

    const unsubscribe = subscribeToAccountChanges((newAddress) => {
      if (newAddress === walletAddress) return;
      toast("Wallet account changed — please reconnect.", { icon: "⚠️" });
      logoutRef.current?.();
    });

    return unsubscribe;
  }, [user?.walletAddress]);

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await axios.get(`${BACKEND_URL}/api/auth/me`);
          setUser(response.data);
        } catch (error) {
          console.error("Auth check failed:", error);
          logout();
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [token]);

  const loginWithWallet = async (walletAddress) => {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/auth/wallet-login`,
        {
          walletAddress,
        }
      );
      const { token: newToken, user: userData } = response.data;

      setToken(newToken);
      setUser(userData);
      localStorage.setItem("stacksmarket-token", newToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;

      toast.success("Wallet connected!");
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || "Wallet login failed";
      toast.error(message);
      logoutWallet(); // disconnect wallet so state stays consistent
      return { success: false, error: message };
    }
  };

  const login = async (credentials) => {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/auth/login`,
        credentials
      );
      const { token: newToken, user: userData } = response.data;

      setToken(newToken);
      setUser(userData);
      localStorage.setItem("stacksmarket-token", newToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;

      toast.success("Login successful!");
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || "Login failed";
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const register = async (userData) => {
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/auth/register`,
        userData
      );
      const { token: newToken, user: userInfo } = response.data;

      setToken(newToken);
      setUser(userInfo);
      localStorage.setItem("stacksmarket-token", newToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;

      toast.success("Registration successful!");
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || "Registration failed";
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("stacksmarket-token");
    delete axios.defaults.headers.common["Authorization"];
    logoutWallet(); // clear wallet session too
    toast.success("Logged out successfully");
  };

  const updateProfile = async (profileData) => {
    try {
      const response = await axios.put(
        `${BACKEND_URL}/api/auth/profile`,
        profileData
      );
      setUser(response.data.user);
      toast.success("Profile updated successfully");
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || "Profile update failed";
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const refreshToken = async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    refreshPromiseRef.current = (async () => {
      try {
        const response = await axios.post(
          `${BACKEND_URL}/api/auth/refresh`,
          null,
          { skipAuthRefresh: true }
        );
        const { token: newToken, user: userData } = response.data;

        setToken(newToken);
        setUser(userData);
        localStorage.setItem("stacksmarket-token", newToken);
        axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;

        return { success: true };
      } catch (error) {
        console.error("Token refresh failed:", error);
        return { success: false };
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  };

  // Allow external flows (e.g., admin auth) to set token directly
  const authenticateWithToken = async (newToken) => {
    try {
      axios.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
      setToken(newToken);
      localStorage.setItem("stacksmarket-token", newToken);
      // axios.defaults will be updated automatically by useEffect
      const me = await axios.get(`${BACKEND_URL}/api/auth/me`);
      setUser(me.data);
      return { success: true };
    } catch (err) {
      console.error("authenticateWithToken failed:", err);
      logout();
      return { success: false };
    }
  };

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    login,
    register,
    logout,
    updateProfile,
    refreshToken,
    authenticateWithToken,
    loginWithWallet,
    token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
