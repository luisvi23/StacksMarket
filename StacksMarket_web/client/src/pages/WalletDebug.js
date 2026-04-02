import React, { useEffect, useRef, useState } from "react";
import { isMobileBrowser, isWalletInAppBrowser, hasInAppHint } from "../utils/stacksConnect";
import { serializeCV, uintCV } from "@stacks/transactions";

const CONTRACT_ADDRESS = "SP3N5CN0PE7YRRP29X7K9XG22BT861BRS5BN8HFFA";
const CONTRACT_NAME = "market-factory-v20-bias";

const sniffProviders = () => {
  if (typeof window === "undefined") return {};
  return {
    LeatherProvider: typeof window.LeatherProvider,
    StacksProvider: typeof window.StacksProvider,
    XverseProviders: typeof window.XverseProviders,
    "XverseProviders.StacksProvider": typeof window.XverseProviders?.StacksProvider,
    "XverseProviders.BitcoinProvider": typeof window.XverseProviders?.BitcoinProvider,
    BlockstackProvider: typeof window.BlockstackProvider,
  };
};

const Row = ({ label, value, good, bad }) => {
  const color =
    good !== undefined
      ? value === good
        ? "text-green-400 font-bold"
        : "text-red-400"
      : bad !== undefined && value === bad
      ? "text-red-400"
      : "text-gray-300";
  return (
    <div className="flex justify-between py-1 border-b border-gray-700 text-sm">
      <span className="text-gray-500 mr-4">{label}</span>
      <span className={color}>{String(value)}</span>
    </div>
  );
};

export default function WalletDebug() {
  const [providers, setProviders] = useState({});
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(null);
  const msgCount = useRef(0);

  const isInMobileWalletContext =
    isWalletInAppBrowser() ||
    hasInAppHint() ||
    (isMobileBrowser() &&
      typeof window !== "undefined" &&
      Boolean(window.LeatherProvider || window.StacksProvider ||
        (window.XverseProviders && window.XverseProviders.StacksProvider)));

  useEffect(() => {
    setProviders(sniffProviders());

    // Listen for ALL window messages — the legacy provider API responds via postMessage
    const onMsg = (evt) => {
      msgCount.current += 1;
      const n = msgCount.current;
      let data;
      try { data = JSON.stringify(evt.data, null, 2); } catch { data = String(evt.data); }
      setLogs((prev) => [
        { msg: `📨 window.message #${n} origin="${evt.origin}"\n${data}`, type: "msg", ts: Date.now() + n },
        ...prev,
      ]);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const addLog = (msg, type = "info") =>
    setLogs((prev) => [
      { msg: typeof msg === "object" ? JSON.stringify(msg, null, 2) : String(msg), type, ts: Date.now() },
      ...prev,
    ]);

  const runTest = async (label, fn) => {
    setRunning(label);
    addLog(`▶ ${label}`, "info");
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT after 8s")), 8000)),
      ]);
      addLog(`✅ OK: ${JSON.stringify(result)}`, "ok");
    } catch (err) {
      addLog(`❌ ERROR: ${err?.message || String(err)}`, "error");
    } finally {
      setRunning(null);
    }
  };

  // ── Test helpers ──────────────────────────────────────────────
  const dummyArg = serializeCV(uintCV(1));

  // Standard request() — we already know this hangs; now with 8s timeout
  const testRequestObject = () =>
    runTest("LeatherProvider.request stx_callContract {method,params}", () =>
      window.LeatherProvider.request({ method: "stx_callContract", params: {
        contractAddress: CONTRACT_ADDRESS, contractName: CONTRACT_NAME,
        functionName: "get-market", functionArgs: [dummyArg],
        postConditionMode: "allow", postConditions: [], network: "mainnet",
      }})
    );

  // Legacy transactionRequest — the method Leather mobile likely expects
  const testTransactionRequestLegacy = () =>
    runTest("LeatherProvider.transactionRequest (legacy direct object)", () => {
      const provider = window.LeatherProvider || window.StacksProvider;
      if (typeof provider?.transactionRequest !== "function")
        throw new Error("transactionRequest not a function");
      return provider.transactionRequest({
        txType: "contract_call",
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-market",
        functionArgs: [dummyArg],
        postConditionMode: 0x01, // Allow
        postConditions: [],
        network: "mainnet",
        appDetails: { name: "Stacks Market", icon: "https://www.stacksmarket.app/logo192.png" },
      });
    });

  // StacksProvider.request — separate provider object, might behave differently
  const testStacksProviderRequest = () =>
    runTest("StacksProvider.request stx_callContract", () => {
      if (!window.StacksProvider?.request)
        throw new Error("StacksProvider.request not found");
      return window.StacksProvider.request({ method: "stx_callContract", params: {
        contractAddress: CONTRACT_ADDRESS, contractName: CONTRACT_NAME,
        functionName: "get-market", functionArgs: [dummyArg],
        postConditionMode: "allow", postConditions: [], network: "mainnet",
      }});
    });

  // StacksProvider.transactionRequest — legacy path via StacksProvider
  const testStacksProviderTxReq = () =>
    runTest("StacksProvider.transactionRequest (legacy)", () => {
      if (typeof window.StacksProvider?.transactionRequest !== "function")
        throw new Error("StacksProvider.transactionRequest not a function");
      return window.StacksProvider.transactionRequest({
        txType: "contract_call",
        contractAddress: CONTRACT_ADDRESS,
        contractName: CONTRACT_NAME,
        functionName: "get-market",
        functionArgs: [dummyArg],
        postConditionMode: 0x01,
        postConditions: [],
        network: "mainnet",
        appDetails: { name: "Stacks Market", icon: "https://www.stacksmarket.app/logo192.png" },
      });
    });

  // List StacksProvider methods
  const testStacksProviderMethods = () =>
    runTest("StacksProvider available methods", async () => {
      if (!window.StacksProvider) throw new Error("StacksProvider not found");
      return { methods: Object.keys(window.StacksProvider).filter(k => typeof window.StacksProvider[k] === "function") };
    });

  const btnCls = "px-3 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed w-full";

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-xl font-bold">Wallet Debug v2</h1>

        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-gray-300 mb-2">Detection flags</h2>
          <Row label="isMobileBrowser()" value={isMobileBrowser()} good={true} />
          <Row label="isWalletInAppBrowser()" value={isWalletInAppBrowser()} />
          <Row label="hasInAppHint()" value={hasInAppHint()} />
          <Row label="isInMobileWalletContext" value={isInMobileWalletContext} good={true} />
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-gray-300 mb-2">User Agent</h2>
          <p className="text-xs text-gray-400 break-all">{navigator?.userAgent}</p>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="font-semibold text-gray-300 mb-2">window providers</h2>
          {Object.entries(providers).map(([k, v]) => (
            <Row key={k} label={k} value={v} good="object" bad="undefined" />
          ))}
        </div>

        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
          <h2 className="font-semibold text-gray-300 mb-2">Tests (todos con timeout 8s)</h2>

          <p className="text-xs text-yellow-400">── StacksProvider ──</p>
          <button className={`${btnCls} bg-blue-700 hover:bg-blue-800`} disabled={!!running} onClick={testStacksProviderMethods}>
            {running === "StacksProvider available methods" ? "..." : "List StacksProvider methods"}
          </button>
          <button className={`${btnCls} bg-indigo-700 hover:bg-indigo-800`} disabled={!!running} onClick={testStacksProviderRequest}>
            {running === "StacksProvider.request stx_callContract" ? "..." : "StacksProvider.request stx_callContract"}
          </button>
          <button className={`${btnCls} bg-violet-700 hover:bg-violet-800`} disabled={!!running} onClick={testStacksProviderTxReq}>
            {running === "StacksProvider.transactionRequest (legacy)" ? "..." : "StacksProvider.transactionRequest (legacy) ★"}
          </button>

          <p className="text-xs text-yellow-400 pt-2">── LeatherProvider ──</p>
          <button className={`${btnCls} bg-emerald-700 hover:bg-emerald-800`} disabled={!!running} onClick={testTransactionRequestLegacy}>
            {running === "LeatherProvider.transactionRequest (legacy direct object)" ? "..." : "LeatherProvider.transactionRequest (legacy) ★"}
          </button>
          <button className={`${btnCls} bg-gray-600 hover:bg-gray-700`} disabled={!!running} onClick={testRequestObject}>
            {running?.includes("stx_callContract {method") ? "..." : "LeatherProvider.request (modern, esperamos TIMEOUT)"}
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400">
          <p>📨 Escuchando window.message events en tiempo real (aparecen arriba al recibir)</p>
        </div>

        {logs.length > 0 && (
          <div className="bg-black rounded-lg p-4 space-y-1 max-h-[60vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-semibold text-gray-300 text-sm">Output</h2>
              <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setLogs([])}>clear</button>
            </div>
            {logs.map((l) => (
              <pre key={l.ts} className={`text-xs whitespace-pre-wrap break-all ${
                l.type === "ok" ? "text-green-400" :
                l.type === "error" ? "text-red-400" :
                l.type === "msg" ? "text-yellow-300" : "text-gray-400"
              }`}>{l.msg}</pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
