import React from "react";

const Learn = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          Learn
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Quick guide to using Stacks Market.
        </p>

        <div className="mt-6 space-y-6 text-sm text-gray-700 dark:text-gray-300 leading-6">
          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              1. What is Stacks Market?
            </h2>
            <p className="mt-2">
              Stacks Market is a prediction market platform where users trade on event outcomes
              using STX on Stacks.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              2. Connect Your Wallet
            </h2>
            <p className="mt-2">
              Click <span className="font-medium">Connect Wallet</span> and connect with Xverse or
              Leather. On mobile, choose your wallet app and continue in its in-app browser.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              3. Buy and Sell Shares
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Select a market and choose an outcome (Yes/No).</li>
              <li>Enter amount (budget or shares depending on mode).</li>
              <li>Review quote and fees before confirming the transaction.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              4. Market Resolution and Redeem
            </h2>
            <p className="mt-2">
              After market resolution, winning shares can be redeemed. If a market is closed and
              unresolved, trading is disabled until final settlement.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              5. Key Risks
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Market risk: you can lose the full amount used in a trade.</li>
              <li>Smart contract and blockchain risk.</li>
              <li>Wallet/security risk if your device or keys are compromised.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              6. Need More Help?
            </h2>
            <p className="mt-2">
              Check the GitBook, Discord, and GitHub links in the footer for documentation,
              announcements, and support updates.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Learn;

