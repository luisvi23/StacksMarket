import React from "react";
import { Link } from "react-router-dom";
import {
  FaXTwitter,
  FaDiscord,
  FaGithub,
} from "react-icons/fa6";
import { FaBookOpen, FaTelegram } from "react-icons/fa";
import logo from "../../assets/imgs/icon_trans.png";

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-gray-300 border-t border-gray-800">
      {/* Top Row */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 py-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left: Brand */}
          <div className="flex items-center gap-3">
            <img src={logo} alt="StacksMarket" className="w-7 h-7 rounded-full" />
            <div className="text-lg font-semibold text-white">Stacks Market Inc.</div>
            <span className="text-sm text-gray-400">© {new Date().getFullYear()}</span>
          </div>

          {/* Center: Links (nav) */}
          <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 md:order-none order-3 justify-start md:justify-center">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Use</Link>
            <Link to="/learn" className="hover:text-white transition-colors">Learn</Link>
            <Link to="/faq" className="hover:text-white transition-colors">FAQ</Link>
          </nav>

          {/* Right: Social / External */}
          <div className="flex items-center gap-5">
            <a
              href="https://bitcoin-world.gitbook.io/bitcoin-world/"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-primary-300 transition-colors"
              aria-label="Gitbook"
            >
              <FaBookOpen size={20} />
            </a>
            <a
              href="https://github.com/bitcoinworldapp/bitcoin-world-app"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-primary-300 transition-colors"
              aria-label="GitHub"
            >
              <FaGithub size={22} />
            </a>
            <a
              href="https://x.com/StacksMarketApp"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-primary-300 transition-colors"
              aria-label="X (Twitter)"
            >
              <FaXTwitter size={20} />
            </a>
            <a
              href="https://discord.gg/N8YRrbEqSQ"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-primary-300 transition-colors"
              aria-label="Discord"
            >
              <FaDiscord size={22} />
            </a>
            <a
              href="https://t.me/stxmarketapp"
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-[#229ED9] transition-colors"
              aria-label="Telegram"
            >
              <FaTelegram size={22} />
            </a>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-800">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            {/* Left: mini brand + socials (only mobile like Kairos) */}
            <div className="flex items-center gap-3 md:hidden">
              <img src={logo} alt="StacksMarket" className="w-6 h-6 rounded-full" />
              <span className="text-sm text-gray-400">
                © {new Date().getFullYear()} StacksMarket. All rights reserved.
              </span>
            </div>

            {/* Right: legal copy (desktop) */}
            <div className="hidden md:block text-sm text-gray-400">
              © {new Date().getFullYear()} Stacks Market Inc. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
