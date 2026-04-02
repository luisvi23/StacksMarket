import React from "react";

const faqs = [
  {
    question: "What is StacksMarket?",
    answer:
      "StacksMarket is a prediction market where you buy and sell outcome shares (Yes/No) using STX on Stacks.",
  },
  {
    question: "How are prices calculated?",
    answer:
      "Market prices are dynamic and move with trading activity. In binary markets, Yes and No implied probabilities update as users trade.",
  },
  {
    question: "What does one share pay if I win?",
    answer:
      "Each winning share pays 1 STX at resolution. If your outcome loses, those shares have no payout.",
  },
  {
    question: "When can I trade a market?",
    answer:
      "You can trade while a market is open, not paused, and before its configured close time. After close, trading is disabled until resolution.",
  },
  {
    question: "Why does my transaction sometimes take time to appear?",
    answer:
      "Your position is on-chain, but some UI tables depend on indexers/APIs. During congestion or rate limits, history updates can lag behind confirmed on-chain state.",
  },
  {
    question: "Can I sell before a market resolves?",
    answer:
      "Yes. While the market is open, you can sell your shares back to the market and receive current proceeds minus applicable fees.",
  },
  {
    question: "How do fees work?",
    answer:
      "Each trade can include protocol and liquidity-provider fees. You can see the full quote breakdown before confirming a transaction.",
  },
  {
    question: "How do I claim winnings?",
    answer:
      "Once a market is resolved, if you hold winning shares, use Redeem to claim payout to your wallet. If already claimed, no further payout is available.",
  },
];

const FAQ = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-soft p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
          FAQ
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Frequent questions about markets, trades, and payouts.
        </p>

        <div className="mt-6 space-y-5 text-sm text-gray-700 dark:text-gray-300 leading-6">
          {faqs.map((item) => (
            <section key={item.question} className="border border-gray-100 dark:border-gray-700 rounded-lg p-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {item.question}
              </h2>
              <p className="mt-2">{item.answer}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FAQ;
