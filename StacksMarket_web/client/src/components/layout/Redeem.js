import React from "react";
import { formatStx } from "../../utils/stx";

const num0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function Redeem({
  contractData,
  user,
  userTrades,
  poll,
  isEnded,
  redeemMutation,
}) {
  const isResolved =
    !!poll?.isResolved ||
    (contractData?.status || "").toString().toLowerCase() === "resolved";

  const outcome = (contractData?.outcome || "").toString().toUpperCase().trim();

  const yesBal = num0(contractData?.optionBalance?.yes);
  const noBal = num0(contractData?.optionBalance?.no);
  const claimableUstx = num0(contractData?.claimable);
  const canRedeem = isResolved && !!user && claimableUstx > 0;

  const yesOutstanding = num0(contractData?.yesSupply);
  const noOutstanding = num0(contractData?.noSupply);

  const qYesEff = num0(contractData?.qYesEff);
  const qNoEff = num0(contractData?.qNoEff);
  const hasEff = qYesEff > 0 || qNoEff > 0;

  const virtYes = hasEff ? Math.max(0, qYesEff - yesOutstanding) : 0;
  const virtNo = hasEff ? Math.max(0, qNoEff - noOutstanding) : 0;

  const hasAnyShares = yesBal > 0 || noBal > 0;
  const lost = isResolved && !!user && hasAnyShares && claimableUstx <= 0 && !!outcome;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm text-gray-500">Market Outcome</h3>
        <p className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-1">
          {outcome || ""}
        </p>
      </div>

      <div>
        <h3 className="text-sm text-gray-500 mb-3">Shares</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-600 dark:text-gray-300 font-medium mb-1">
              YES shares outstanding
            </p>
            <p className="text-lg font-semibold">{yesOutstanding}</p>

            <p className="text-sm text-gray-500 mt-1">
              Your YES shares: <span className="text-base font-medium">{yesBal}</span>
            </p>

            {hasEff && (
              <p className="text-[11px] text-gray-500 mt-2">
                Virtual liquidity (YES): {virtYes}
              </p>
            )}
          </div>

          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-600 dark:text-gray-300 font-medium mb-1">
              NO shares outstanding
            </p>
            <p className="text-lg font-semibold">{noOutstanding}</p>

            <p className="text-sm text-gray-500 mt-1">
              Your NO shares: <span className="text-base font-medium">{noBal}</span>
            </p>

            {hasEff && (
              <p className="text-[11px] text-gray-500 mt-2">
                Virtual liquidity (NO): {virtNo}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 text-sm">
        <div>
          <h3 className="text-xs text-gray-500">Total Pool</h3>
          <p className="text-lg font-semibold mt-1">{formatStx(contractData?.pool)}</p>
        </div>
        <div>
          <h3 className="text-xs text-gray-500">Claimable</h3>
          <p className="text-lg font-semibold mt-1">{formatStx(claimableUstx)}</p>
        </div>
      </div>

      {isResolved && outcome && user && (
        <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm">
          <div className="text-gray-600 dark:text-gray-300 font-medium">
            Your payout if you redeem
          </div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">
            {formatStx(claimableUstx)}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            Each winning share pays 1 STX. Payout equals your winning shares.
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
          Your Trades
        </h3>
        {user && Array.isArray(userTrades) && userTrades.length > 0 ? (
          <div className="space-y-3">
            {userTrades.map((t) => (
              <div
                key={t._id}
                className="flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-3 rounded-md"
              >
                <div>
                  <span
                    className={`${
                      (t.type || "").toLowerCase() === "buy"
                        ? "text-green-600"
                        : "text-red-500"
                    } font-semibold`}
                  >
                    {(t.type || "").toUpperCase()}
                  </span>
                  <span className="ml-2 text-sm">- {t.amount}</span>
                  <div className="text-xs text-gray-500">
                    {poll?.options?.[t.optionIndex]?.text || `Option ${t.optionIndex}`}
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {isResolved ? "Resolved" : isEnded ? "Ended" : "Active"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">You have not traded on this market.</p>
        )}
      </div>

      <div>
        {isResolved ? (
          user ? (
            canRedeem ? (
              <button
                onClick={() => redeemMutation.mutate()}
                disabled={redeemMutation.isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-md transition"
              >
                {redeemMutation.isLoading ? "Claiming..." : "Redeem"}
              </button>
            ) : (
              <button className="w-full bg-gray-300 text-gray-700 font-semibold py-2 rounded-md cursor-not-allowed">
                No claimable payout or payout already claimed
              </button>
            )
          ) : (
            <button className="w-full bg-gray-300 text-gray-700 font-semibold py-2 rounded-md cursor-not-allowed">
              Connect wallet to redeem
            </button>
          )
        ) : isEnded ? (
          <button className="w-full bg-gray-300 text-gray-700 font-semibold py-2 rounded-md cursor-not-allowed">
            Ended
          </button>
        ) : null}
      </div>
    </div>
  );
}
