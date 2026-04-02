import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FaSearch,
  FaSun,
  FaMoon,
  FaUser,
  FaSignOutAlt,
  FaTimes,
} from "react-icons/fa";
import {
  authenticate,
  getWalletAddress,
  shouldUseInAppMobileStrategy,
} from "../../utils/stacksConnect";
import toast from "react-hot-toast";
import { useTheme } from "../../contexts/ThemeContext";
import SearchModal from "../search/SearchModal";
import logo from "../../assets/imgs/icon_trans.png";
import { useAuth } from "../../contexts/AuthContext";

const Navbar = () => {
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { user, loginWithWallet, logout, isAdmin } = useAuth();

  const [showSearchModal, setShowSearchModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [showMobileWalletPicker, setShowMobileWalletPicker] = useState(false);

  useEffect(() => {
    const address = getWalletAddress();
    if (address) {
      setWalletAddress(address);
      // Only login if not already authenticated with this wallet
      if (!user || user.walletAddress !== address) {
        loginWithWallet(address);
      }
    }
  }, [loginWithWallet, user]);

  const handleConnectWallet = async () => {
    if (shouldUseInAppMobileStrategy()) {
      setShowMobileWalletPicker(true);
      return;
    }
    try {
      const address = await authenticate();
      if (address) {
        setWalletAddress(address);
        await loginWithWallet(address);
      }
    } catch (err) {
      toast.error(
        err?.message ||
          "No compatible wallet extension detected. Please install Leather or Xverse to continue."
      );
    }
  };

  const handleChooseMobileWallet = async (wallet) => {
    setShowMobileWalletPicker(false);
    try {
      const address = await authenticate({ mobileWallet: wallet });
      if (address) {
        setWalletAddress(address);
        await loginWithWallet(address);
      }
    } catch (err) {
      toast.error(
        err?.message ||
          "No compatible wallet extension detected. Please install Leather or Xverse to continue."
      );
    }
  };

  const handleDisconnect = () => {
    logout();
    setWalletAddress("");
    navigate("/");
  };

  const truncateAddress = (address) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Show BNS name as-is; truncate if it's a raw wallet address
  const displayName = () => {
    const name = user?.username;
    if (name && !name.startsWith("SP") && !name.startsWith("ST")) return name;
    if (name && (name.startsWith("SP") || name.startsWith("ST"))) return truncateAddress(name);
    return truncateAddress(walletAddress);
  };

  return (
    <>
      <nav className="bg-white dark:bg-gray-800 shadow-soft border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* === LOGO CIRCULAR (no se corta) === */}
            <Link
              to="/"
              className="flex items-center space-x-2 min-w-0"
              aria-label="Stacks Market"
            >
              <div className="logo-badge w-8 h-8 p-[2px] sm:w-10 sm:h-10 sm:p-[3px]">
                <img
                  src={logo}
                  alt="StacksMarket Logo"
                  className="w-full h-full rounded-full object-contain"
                  draggable="false"
                />
              </div>
              <span
                className={`text-lg sm:text-xl font-bold truncate max-w-[150px] sm:max-w-none ${
                  isDark ? "text-white" : "text-stacks-500"
                }`}
              >
                Stacks Market
              </span>
            </Link>

            {/* Search (desktop) */}
            <div className="hidden md:flex flex-1 max-w-lg mx-8">
              <div className="relative w-full">
                <input
                  type="text"
                  placeholder="Search polls..."
                  className="input pl-10 pr-4 w-full"
                  onClick={() => setShowSearchModal(true)}
                  readOnly
                />
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </div>
            </div>

            {/* Right actions */}
            <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
              <button
                onClick={() => setShowSearchModal(true)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Open search"
              >
                <FaSearch className="w-5 h-5" />
              </button>

              <button
                onClick={toggleTheme}
                className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                aria-label="Toggle theme"
              >
                {isDark ? (
                  <FaSun className="w-5 h-5" />
                ) : (
                  <FaMoon className="w-5 h-5" />
                )}
              </button>

              {/* Auth */}
              {walletAddress ? (
                <div className="flex items-center space-x-2 sm:space-x-3">
                  {isAdmin && (
                    <Link
                      to="/admin"
                      className="btn-outline btn-sm inline-flex"
                    >
                      Admin
                    </Link>
                  )}

                  <Link
                    to="/profile"
                    className="flex items-center space-x-2 p-2 sm:p-0 text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    <FaUser className="w-4 h-4" />
                    <span className="hidden sm:block">
                      {displayName()}
                    </span>
                  </Link>
                  <button
                    onClick={handleDisconnect}
                    className="flex items-center space-x-2 p-2 sm:p-0 text-gray-700 dark:text-gray-300 hover:text-danger-600 dark:hover:text-danger-400 transition-colors"
                  >
                    <FaSignOutAlt className="w-4 h-4" />
                    <span className="hidden sm:block">Logout</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-3">
                  {/* Nada de Admin Login visible para el público */}
                  <button
                    onClick={handleConnectWallet}
                    className="btn-primary px-2.5 py-2 text-[11px] leading-none whitespace-nowrap md:px-4 md:py-2 md:text-sm"
                  >
                    Connect Wallet
                  </button>
                </div>
              )}


              {/*
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Toggle menu"
              >
                {showMobileMenu ? (
                  <FaTimes className="w-5 h-5" />
                ) : (
                  <FaBars className="w-5 h-5" />
                )}
              </button>
              */}
            </div>
          </div>
        </div>

        {/* Category Navigation */}
        {/*
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-8 overflow-x-auto scrollbar-hide py-3">
              {categories.map((category) => (
                <Link
                  key={category.name}
                  to={category.path}
                  className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActiveCategory(category.path)
                      ? "bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        */}

      </nav>

      {showMobileWalletPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-soft p-4">
            <button
              onClick={() => setShowMobileWalletPicker(false)}
              className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close wallet picker"
            >
              <FaTimes className="w-4 h-4" />
            </button>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Choose wallet app
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              We will open the selected app and continue connection there.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <button
                onClick={() => handleChooseMobileWallet("xverse")}
                className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-400 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <img
                    src="https://explorer-api.walletconnect.com/v3/logo/md/785e20ef-c68c-4a85-6cb9-053443871e00?projectId=ea99b8504109ea3a4e0f746f6ada8ba9"
                    alt="Xverse"
                    className="w-9 h-9 rounded-lg"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Xverse</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Recommended</div>
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleChooseMobileWallet("leather")}
                className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-400 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <img
                    src="https://explorer-api.walletconnect.com/v3/logo/md/0153454e-9313-4441-b6cf-838e3d023000?projectId=ea99b8504109ea3a4e0f746f6ada8ba9"
                    alt="Leather"
                    className="w-9 h-9 rounded-lg"
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Leather</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Open app</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      <SearchModal
        isOpen={showSearchModal}
        onClose={() => setShowSearchModal(false)}
      />
    </>
  );
};

export default Navbar;
