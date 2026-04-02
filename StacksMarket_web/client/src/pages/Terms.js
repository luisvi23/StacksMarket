import React from "react";

const Terms = () => {
  const updatedAt = "February 18, 2026";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          Terms of Use
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Last updated: {updatedAt}
        </p>

        <div className="mt-6 space-y-6 text-sm text-gray-700 dark:text-gray-300 leading-6">
          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              1. Acceptance of Terms
            </h2>
            <p className="mt-2">
              By accessing or using StacksMarket, you agree to these Terms. If you do not agree,
              do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              2. Eligibility and Compliance
            </h2>
            <p className="mt-2">
              You are responsible for ensuring that your use of StacksMarket is legal in your
              jurisdiction. You must comply with all applicable laws and regulations.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              3. Wallet and Account Responsibility
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>You control your wallet and private keys.</li>
              <li>Transactions authorized from your wallet are your responsibility.</li>
              <li>
                StacksMarket cannot recover private keys, reverse confirmed on-chain transactions,
                or restore losses caused by compromised wallets.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              4. Market Risk Disclosure
            </h2>
            <p className="mt-2">
              Prediction markets involve substantial risk, including complete loss of funds. Prices
              and outcomes may be volatile. Nothing on StacksMarket is investment, legal, or tax
              advice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              5. Prohibited Conduct
            </h2>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Attempting to exploit bugs, manipulate markets, or abuse platform systems.</li>
              <li>Using bots/scripts in ways that harm platform integrity or availability.</li>
              <li>Posting unlawful, abusive, or fraudulent content.</li>
              <li>Violating sanctions or other regulatory restrictions.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              6. Service Availability
            </h2>
            <p className="mt-2">
              StacksMarket may be modified, suspended, or discontinued at any time. We do not
              guarantee uninterrupted or error-free operation.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              7. Intellectual Property
            </h2>
            <p className="mt-2">
              The StacksMarket interface, branding, and related materials are protected by
              applicable intellectual property laws. Unauthorized use is prohibited.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              8. Disclaimers and Limitation of Liability
            </h2>
            <p className="mt-2">
              The service is provided "as is" and "as available" without warranties of any kind.
              To the maximum extent permitted by law, StacksMarket is not liable for indirect,
              incidental, consequential, or punitive damages arising from your use of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              9. Changes to Terms
            </h2>
            <p className="mt-2">
              We may update these Terms from time to time. Continued use after updates means you
              accept the revised Terms.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Terms;

