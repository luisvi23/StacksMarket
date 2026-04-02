import React from "react";

const Privacy = () => {
  const updatedAt = "February 18, 2026";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Last updated: {updatedAt}
        </p>

        <div className="mt-6 space-y-6 text-sm text-gray-700 dark:text-gray-300 leading-6">
          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              1. Overview
            </h2>
            <p className="mt-2">
              Stacks Market provides a prediction market interface and related services. This
              policy explains what information we collect, how we use it, and your choices.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              2. Information We Collect
            </h2>
            <p className="mt-2">We may collect the following categories of data:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Wallet address and authentication/session data.</li>
              <li>Market activity data (orders, trade history, watchlist, comments).</li>
              <li>Technical data (IP address, browser type, device data, logs, diagnostics).</li>
              <li>Cookies/local storage data used for session, preferences, and security.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              3. How We Use Data
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Operate the platform and process wallet-based authentication.</li>
              <li>Provide product features (markets, comments, profile, admin moderation).</li>
              <li>Detect abuse, fraud, suspicious activity, and security incidents.</li>
              <li>Improve product performance, reliability, and user experience.</li>
              <li>Comply with legal obligations and enforce platform policies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              4. Data Sharing
            </h2>
            <p className="mt-2">
              We may share data with infrastructure and analytics providers that help us run the
              service (for example hosting, CDN, monitoring, and wallet connectivity providers).
              We may also disclose data if required by law or to protect our rights and users.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              5. Blockchain Transparency
            </h2>
            <p className="mt-2">
              Transactions submitted on-chain are public and can be viewed by anyone on blockchain
              explorers. On-chain data cannot be deleted or modified by StacksMarket.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              6. Data Retention
            </h2>
            <p className="mt-2">
              We retain data for as long as needed to operate the service, resolve disputes,
              comply with legal obligations, and enforce our agreements. We may anonymize or delete
              data when no longer required.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              7. Security
            </h2>
            <p className="mt-2">
              We use reasonable administrative and technical safeguards, but no online system is
              completely secure. You are responsible for protecting your wallet credentials and
              device security.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              8. Your Choices
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>You can disconnect your wallet at any time.</li>
              <li>You can clear browser data (cookies/local storage) from your device settings.</li>
              <li>You can request support regarding account-related questions.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              9. Contact
            </h2>
            <p className="mt-2">
              For privacy inquiries, contact us via our official channels linked in the footer
              (X, Discord, or GitHub).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Privacy;

