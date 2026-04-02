// utils/stacksConnect.js
import {
  connect,
  request,
  getLocalStorage,
  isConnected,
  disconnect,
} from "@stacks/connect";

export const NO_WALLET_EXTENSION_ERROR =
  "No compatible wallet extension detected. Please install Leather or Xverse to continue.";
export const MOBILE_INAPP_OPEN_HINT_ERROR =
  "Open this site inside Xverse/Leather in-app browser and reload to connect.";

const APPROVED_PROVIDER_IDS = [
  "LeatherProvider",
  "XverseProviders.BitcoinProvider",
];
const LEGACY_XVERSE_PROVIDER_ID = "StacksProvider";
const WALLETCONNECT_PROVIDER_ID = "WalletConnectProvider";
const WALLETCONNECT_PROJECT_ID = process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || "";
const MOBILE_CONNECT_MODE = String(
  process.env.REACT_APP_MOBILE_CONNECT_MODE || "inapp-only"
).toLowerCase();
const MOBILE_PREFERRED_WALLET = String(
  process.env.REACT_APP_MOBILE_PREFERRED_WALLET || "xverse"
).toLowerCase();
const DEFAULT_STACKS_NETWORK = "mainnet";
// WalletConnect wallet IDs are wallet-level identifiers (not different per Stacks network).
const DEFAULT_XVERSE_WALLETCONNECT_ID =
  "2a87d74ae02e10bdd1f51f7ce6c4e1cc53cd5f2c0b6b5ad0d7b3007d2b13de7b";
const DEFAULT_LEATHER_WALLETCONNECT_ID =
  "483afe1df1df63daf313109971ff3ef8356ddf1cc4e45877d205eee0b7893a13";
const XVERSE_WALLETCONNECT_ID =
  process.env.REACT_APP_WC_XVERSE_ID ||
  DEFAULT_XVERSE_WALLETCONNECT_ID;
const LEATHER_WALLETCONNECT_ID =
  process.env.REACT_APP_WC_LEATHER_ID ||
  DEFAULT_LEATHER_WALLETCONNECT_ID;
const LEATHER_CUSTOM_WALLET = {
  id: LEATHER_WALLETCONNECT_ID,
  name: "Leather",
  homepage: "https://leather.io",
  image_url: "https://leather.io/favicon.ico",
  mobile_link: process.env.REACT_APP_LEATHER_MOBILE_LINK || "leather://",
  desktop_link: null,
  webapp_link: null,
  app_store:
    process.env.REACT_APP_LEATHER_APP_STORE ||
    "https://apps.apple.com/es/app/leather-bitcoin-defi-wallet/id6499127775?l=en-GB",
  play_store:
    process.env.REACT_APP_LEATHER_PLAY_STORE ||
    "https://play.google.com/store/apps/details?id=io.leather.mobile",
};
const CONNECT_NETWORK =
  String(process.env.REACT_APP_STACKS_NETWORK || DEFAULT_STACKS_NETWORK).toLowerCase() ===
  "testnet"
    ? "testnet"
    : "mainnet";
const XVERSE_BROWSER_DEEPLINK =
  process.env.REACT_APP_XVERSE_BROWSER_DEEPLINK || "xverse://browser?url={url}";
const LEATHER_BROWSER_DEEPLINK =
  process.env.REACT_APP_LEATHER_BROWSER_DEEPLINK || "leather://browser?url={url}";
const LEATHER_BROWSER_DEEPLINKS = String(
  process.env.REACT_APP_LEATHER_BROWSER_DEEPLINKS ||
    "leather://browser?url={url},leatherwallet://browser?url={url},leather://dapp?url={url},leatherwallet://dapp?url={url}"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const XVERSE_APP_STORE =
  process.env.REACT_APP_XVERSE_APP_STORE ||
  "https://apps.apple.com/us/app/xverse-wallet-buy-bitcoin/id1552272513";
const LEATHER_APP_STORE =
  process.env.REACT_APP_LEATHER_APP_STORE ||
  "https://apps.apple.com/es/app/leather-bitcoin-defi-wallet/id6499127775?l=en-GB";
const LEATHER_ENABLE_STORE_FALLBACK =
  String(process.env.REACT_APP_LEATHER_ENABLE_STORE_FALLBACK || "false").toLowerCase() ===
  "true";
const CONNECT_DEBUG =
  String(process.env.REACT_APP_CONNECT_DEBUG || "false").toLowerCase() === "true";
const CONNECT_APP_NAME = process.env.REACT_APP_CONNECT_APP_NAME || "Stacks Market";
const CONNECT_ICON_PATH =
  process.env.REACT_APP_CONNECT_ICON_PATH || "/android-chrome-192x192.png";
const INAPP_HINT_PARAM = "sm_inapp";
const INAPP_WALLET_HINT_PARAM = "sm_wallet";

const logConnect = (...args) => {
  if (!CONNECT_DEBUG) return;
  console.log("[stacksConnect]", ...args);
};

const getByPath = (obj, path) =>
  path.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), obj);

const toAbsoluteUrl = (path) => {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (typeof window === "undefined") return normalized;
  try {
    return new URL(normalized, window.location.origin).toString();
  } catch {
    return normalized;
  }
};

const getConnectAppDetails = () => {
  const icon = toAbsoluteUrl(CONNECT_ICON_PATH);
  return icon ? { name: CONNECT_APP_NAME, icon } : { name: CONNECT_APP_NAME };
};

export const isMobileBrowser = () => {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua);
};

export const isWalletInAppBrowser = () => {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "").toLowerCase();
  if (ua.includes("xverse") || ua.includes("leather")) return true;
  // Leather mobile in-app browser may not include "leather" in its UA but always
  // injects window.LeatherProvider — use that as a secondary detection signal.
  if (isMobileBrowser() && typeof window !== "undefined" && Boolean(window.LeatherProvider)) return true;
  return false;
};

export const hasInAppHint = () => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get(INAPP_HINT_PARAM) === "1";
  } catch {
    return false;
  }
};

const getWalletHint = () => {
  if (typeof window === "undefined") return "";
  try {
    const params = new URLSearchParams(window.location.search || "");
    return normalizeWalletChoice(params.get(INAPP_WALLET_HINT_PARAM) || "");
  } catch {
    return "";
  }
};

const buildBrowserDeepLink = (template, encodedUrl) => {
  if (!template) return "";
  if (template.includes("{url}")) return template.replace("{url}", encodedUrl);
  if (template.includes("?")) return `${template}&url=${encodedUrl}`;
  return `${template}?url=${encodedUrl}`;
};

const normalizeWalletChoice = (wallet) =>
  String(wallet || "").toLowerCase() === "leather" ? "leather" : "xverse";

const getPreferredMobileWallet = () => normalizeWalletChoice(MOBILE_PREFERRED_WALLET);
const getInAppWalletFromUA = () => {
  if (typeof navigator === "undefined") return "";
  const ua = String(navigator.userAgent || "").toLowerCase();
  if (ua.includes("leather")) return "leather";
  if (ua.includes("xverse")) return "xverse";
  return "";
};
const getProviderIdForWallet = (wallet) =>
  normalizeWalletChoice(wallet) === "leather" ? "LeatherProvider" : "XverseProviders.StacksProvider";
const inferWalletFromInstalled = (installed = []) => {
  const installedSet = new Set(installed || []);
  const hasLeather = installedSet.has("LeatherProvider");
  const hasXverse =
    installedSet.has("XverseProviders.StacksProvider") ||
    installedSet.has("XverseProviders.BitcoinProvider") ||
    installedSet.has(LEGACY_XVERSE_PROVIDER_ID);

  if (hasLeather && !hasXverse) return "leather";
  if (hasXverse && !hasLeather) return "xverse";
  return "";
};
const getProviderIdForWalletFromInstalled = (wallet, installed = []) => {
  const normalized = normalizeWalletChoice(wallet);
  const installedSet = new Set(installed || []);
  if (normalized === "leather") {
    if (installedSet.has("LeatherProvider")) return "LeatherProvider";
    return "LeatherProvider";
  }
  // Xverse in-app can expose either XverseProviders.* or legacy StacksProvider.
  if (installedSet.has("XverseProviders.StacksProvider")) return "XverseProviders.StacksProvider";
  if (installedSet.has(LEGACY_XVERSE_PROVIDER_ID)) return LEGACY_XVERSE_PROVIDER_ID;
  if (installedSet.has("XverseProviders.BitcoinProvider")) return "XverseProviders.BitcoinProvider";
  return getProviderIdForWallet(wallet);
};

export const shouldUseInAppMobileStrategy = () =>
  isMobileBrowser() &&
  MOBILE_CONNECT_MODE !== "walletconnect" &&
  !hasInAppHint() &&
  !isWalletInAppBrowser() &&
  detectInstalledApprovedProviders().length === 0;

const openWalletInAppBrowser = (wallet) => {
  if (typeof window === "undefined") return false;
  const currentUrl = window.location.href;
  let targetUrl = currentUrl;
  try {
    const parsed = new URL(currentUrl);
    parsed.searchParams.set(INAPP_HINT_PARAM, "1");
    parsed.searchParams.set(INAPP_WALLET_HINT_PARAM, wallet);
    targetUrl = parsed.toString();
  } catch {
    targetUrl = currentUrl;
  }
  try {
    const parsed = new URL(targetUrl);
    const host = String(parsed.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      logConnect("mobile:deepLinkLaunch:localhostNotReachable", { targetUrl });
    }
  } catch {
    // Ignore URL parsing issues and continue with deep link attempt.
  }
  const encodedUrl = encodeURIComponent(targetUrl);
  if (wallet === "leather" && navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(targetUrl).catch(() => {});
  }
  const templates =
    wallet === "leather"
      ? LEATHER_BROWSER_DEEPLINKS.length
        ? LEATHER_BROWSER_DEEPLINKS
        : [LEATHER_BROWSER_DEEPLINK]
      : [XVERSE_BROWSER_DEEPLINK, "xverse://dapp?url={url}", "xverse://open?url={url}"];
  const targets = templates
    .map((template) => buildBrowserDeepLink(template, encodedUrl))
    .filter(Boolean);
  if (!targets.length) return false;
  const fallbackStore =
    wallet === "leather"
      ? LEATHER_ENABLE_STORE_FALLBACK
        ? LEATHER_APP_STORE
        : ""
      : XVERSE_APP_STORE;
  let fallbackTimer = null;
  let nextAttemptTimer = null;
  const clearFallback = () => {
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (nextAttemptTimer) {
      window.clearTimeout(nextAttemptTimer);
      nextAttemptTimer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", clearFallback);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") clearFallback();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", clearFallback);
  const tryTarget = (index) => {
    if (index >= targets.length) {
      clearFallback();
      if (fallbackStore) window.location.href = fallbackStore;
      return;
    }
    window.location.href = targets[index];
    nextAttemptTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        tryTarget(index + 1);
      }
    }, 650);
  };

  fallbackTimer = window.setTimeout(() => {
    if (document.visibilityState === "visible") {
      clearFallback();
      if (fallbackStore) window.location.href = fallbackStore;
    }
  }, 2600);

  tryTarget(0);
  return true;
};

const detectInstalledApprovedProviders = () => {
  if (typeof window === "undefined") return [];
  const hasDirectApprovedProvider =
    APPROVED_PROVIDER_IDS.some((id) => Boolean(getByPath(window, id))) ||
    Boolean(getByPath(window, LEGACY_XVERSE_PROVIDER_ID));
  // Regular mobile browsers (Safari/Chrome) can expose false-positive globals.
  // If we are not in a wallet in-app browser and have no in-app hint, force
  // empty detection so we follow deep-link flow instead of desktop connect flow.
  if (
    isMobileBrowser() &&
    !isWalletInAppBrowser() &&
    !hasInAppHint() &&
    !hasDirectApprovedProvider
  ) {
    logConnect("detectInstalledApprovedProviders:skipRegularMobileNoHintNoDirectProvider");
    return [];
  }

  const detected = new Set();

  // Direct detection by approved provider IDs.
  for (const id of APPROVED_PROVIDER_IDS) {
    if (getByPath(window, id)) detected.add(id);
  }

  // In regular mobile browsers, ignore legacy globals that can appear without a real provider.
  const allowLegacyFallback = !isMobileBrowser() || isWalletInAppBrowser();
  if (allowLegacyFallback) {
    // Compatibility fallback for legacy Leather providers only.
    if (window.LeatherProvider || window.BlockstackProvider) {
      detected.add("LeatherProvider");
    }
    if (window.StacksProvider) {
      detected.add(LEGACY_XVERSE_PROVIDER_ID);
    }
    if (window.XverseProviders?.BitcoinProvider || window.XverseProviders?.StacksProvider) {
      detected.add("XverseProviders.BitcoinProvider");
    }
  } else {
    logConnect("detectInstalledApprovedProviders:ignoreLegacyOnRegularMobile");
  }

  const result = Array.from(detected);
  logConnect("detectInstalledApprovedProviders", result);
  return result;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const detectInstalledApprovedProvidersWithRetry = async () => {
  // Mobile browsers sometimes inject providers slightly later than desktop.
  const attempts = isWalletInAppBrowser() || hasInAppHint() ? 20 : isMobileBrowser() ? 8 : 1;
  logConnect("providerRetryStart", {
    attempts,
    isMobile: isMobileBrowser(),
    isInApp: isWalletInAppBrowser(),
    hasInAppHint: hasInAppHint(),
    mode: MOBILE_CONNECT_MODE,
  });
  for (let i = 0; i < attempts; i += 1) {
    const installed = detectInstalledApprovedProviders();
    if (installed.length > 0) {
      logConnect("providerRetrySuccess", { attempt: i + 1, installed });
      return installed;
    }
    if (i < attempts - 1) await wait(200);
  }
  logConnect("providerRetryEmpty");
  return [];
};

const hasWalletConnectConfig = () => Boolean(WALLETCONNECT_PROJECT_ID);

let wcModalPatched = false;
let wcModalPatchedForLeather = false;
let universalConnectorModule = null;
let stacksConnectUiModule = null;
const getStacksConnectUi = async () => {
  if (stacksConnectUiModule) return stacksConnectUiModule;
  try {
    const mod = await import("@stacks/connect-ui");
    stacksConnectUiModule = mod || null;
  } catch {
    stacksConnectUiModule = null;
  }
  return stacksConnectUiModule;
};
const getUniversalConnector = async () => {
  if (universalConnectorModule) return universalConnectorModule;
  try {
    const mod = await import("@reown/appkit-universal-connector");
    universalConnectorModule = mod?.UniversalConnector || null;
  } catch {
    universalConnectorModule = null;
  }
  return universalConnectorModule;
};

const patchWalletConnectModalOptions = async () => {
  if (wcModalPatched) return;
  const UniversalConnector = await getUniversalConnector();
  if (!UniversalConnector || typeof UniversalConnector.init !== "function") return;

  const originalInit = UniversalConnector.init.bind(UniversalConnector);
  UniversalConnector.init = async (config) => {
    const connector = await originalInit(config);
    try {
      connector?.appKit?.updateOptions?.({
        includeWalletIds: [XVERSE_WALLETCONNECT_ID],
        featuredWalletIds: [XVERSE_WALLETCONNECT_ID],
        customWallets: [LEATHER_CUSTOM_WALLET],
        allWallets: "HIDE",
        enableWalletGuide: false,
      });
    } catch {
      // If AppKit internals change, we silently keep default behavior.
    }
    return connector;
  };

  wcModalPatched = true;
};

// Options to apply when connecting from Leather mobile browser.
const LEATHER_WC_OPTIONS = {
  includeWalletIds: [],
  featuredWalletIds: [],
  customWallets: [LEATHER_CUSTOM_WALLET],
  allWallets: "HIDE",
  enableWalletGuide: false,
};

// Patch UniversalConnector.prototype.connect — this is called RIGHT before appKit.open(),
// so any createAppKit() reset that happened during init() is already done and cannot
// override our options. Both fresh and cached WC instances use this prototype method.
const patchWalletConnectModalForLeather = async () => {
  if (wcModalPatchedForLeather) return;
  const UniversalConnector = await getUniversalConnector();
  if (!UniversalConnector) return;

  const proto = UniversalConnector.prototype;
  if (proto && typeof proto.connect === "function" && !proto._leatherPatched) {
    const originalConnect = proto.connect;
    proto.connect = async function leatherConnect(...args) {
      try {
        if (this.appKit?.updateOptions) {
          this.appKit.updateOptions(LEATHER_WC_OPTIONS);
        }
      } catch {
        // Silently ignore if AppKit internals change.
      }
      return originalConnect.apply(this, args);
    };
    proto._leatherPatched = true;
  }

  wcModalPatchedForLeather = true;
};

const isUserCancel = (err) => {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === 4001 ||
    msg.includes("user canceled") ||
    msg.includes("user cancelled") ||
    msg.includes("canceled the request") ||
    msg.includes("cancelled the request")
  );
};

const isInvalidParamsError = (err) => {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("invalid parameters") || msg.includes("invalid params");
};
const isRequestNotImplementedError = (err) => {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("`request` function is not implemented") ||
    msg.includes("request function is not implemented") ||
    err?.code === -31000
  );
};
export async function authenticate(options = {}) {
  try {
    const appDetails = getConnectAppDetails();
    logConnect("authenticate:start", {
      options,
      isConnected: isConnected(),
      isMobile: isMobileBrowser(),
      isInApp: isWalletInAppBrowser(),
      network: CONNECT_NETWORK,
      mode: MOBILE_CONNECT_MODE,
    });
    // Leather mobile in-app browser: their request() API hangs forever and
    // transactionRequest() is deprecated. WalletConnect is the only working path.
    const leatherMobileWebview =
      isMobileBrowser() &&
      !isWalletInAppBrowser() &&
      !hasInAppHint() &&
      typeof window !== "undefined" &&
      Boolean(window.LeatherProvider);

    if (leatherMobileWebview && hasWalletConnectConfig()) {
      const connectUi = await getStacksConnectUi();
      const getSelectedId = connectUi?.getSelectedProviderId;
      const currentProvider = typeof getSelectedId === "function" ? getSelectedId() : null;
      const alreadyOnWC = currentProvider === WALLETCONNECT_PROVIDER_ID && isConnected();
      if (alreadyOnWC) {
        logConnect("authenticate:leatherMobile:alreadyOnWC");
        // Re-apply WC provider selection so openContractCall() routes through
        // WalletConnect and not window.LeatherProvider (which hangs on mobile).
        const setSelectedProviderId = connectUi?.setSelectedProviderId;
        if (typeof setSelectedProviderId === "function") {
          setSelectedProviderId(WALLETCONNECT_PROVIDER_ID);
        }
        return getWalletAddress();
      }
      // If the user is connected via the native direct provider (e.g. Leather in-app
      // browser whose UA is not detected by isWalletInAppBrowser), openContractCall()
      // works fine through that provider — do NOT open the WalletConnect modal.
      // Only force WalletConnect when there is no existing session at all (external
      // browser where the WC-bridged LeatherProvider's request() hangs for transactions).
      if (isConnected() && getWalletAddress()) {
        logConnect("authenticate:leatherMobile:alreadyConnectedDirectProvider");
        return getWalletAddress();
      }
      logConnect("authenticate:leatherMobile:forceWalletConnect");
      await patchWalletConnectModalForLeather();
      const setSelectedProviderId = connectUi?.setSelectedProviderId;
      if (typeof setSelectedProviderId === "function") {
        setSelectedProviderId(WALLETCONNECT_PROVIDER_ID);
      }
      await request(
        {
          approvedProviderIds: [WALLETCONNECT_PROVIDER_ID],
          forceWalletSelect: false,
          appDetails,
          walletConnect: {
            projectId: WALLETCONNECT_PROJECT_ID,
            includeWalletIds: [LEATHER_WALLETCONNECT_ID],
            featuredWalletIds: [LEATHER_WALLETCONNECT_ID],
            customWallets: [LEATHER_CUSTOM_WALLET],
            allWallets: "HIDE",
            enableWalletGuide: false,
          },
        },
        "getAddresses",
        { network: CONNECT_NETWORK }
      );
      logConnect("authenticate:leatherMobile:walletconnect:ok");
      return getWalletAddress();
    }

    if (isConnected()) {
      logConnect("authenticate:alreadyConnected");
      return getWalletAddress();
    }

    const installed = await detectInstalledApprovedProvidersWithRetry();
    if (installed.length > 0) {
      const useInAppStyleConnect = isWalletInAppBrowser() || isMobileBrowser();
      logConnect("authenticate:installedProviders", {
        installed,
        useInAppStyleConnect,
        isInApp: isWalletInAppBrowser(),
        isMobile: isMobileBrowser(),
      });
      if (useInAppStyleConnect) {
        const connectUi = await getStacksConnectUi();
        const setSelectedProviderId = connectUi?.setSelectedProviderId;
        const inferredWallet = inferWalletFromInstalled(installed);
        let hintedWallet =
          getWalletHint() || getInAppWalletFromUA() || inferredWallet || getPreferredMobileWallet();
        // In some mobile in-app browsers (notably Leather), URL hints/UA can be stale.
        // If installed providers clearly identify one wallet, trust that signal.
        if (isMobileBrowser() && inferredWallet) {
          hintedWallet = inferredWallet;
        }
        const preferredProviderId = getProviderIdForWalletFromInstalled(hintedWallet, installed);
        if (typeof setSelectedProviderId === "function") {
          setSelectedProviderId(preferredProviderId);
          logConnect("inApp:selectedProvider", {
            hintedWallet,
            preferredProviderId,
          });
        }

        // Prioritize minimal payloads on mobile to avoid "invalid parameters"
        // and avoid opening the wallet sheet twice.
        const walletHint = hintedWallet;
        const mobileFirst = isMobileBrowser();
        const strategies = mobileFirst
          ? [
              { method: "getAddresses", params: undefined, tag: "inApp:getAddresses:noParams" },
              { method: "stx_getAddresses", params: undefined, tag: "inApp:stx_getAddresses:noParams" },
              { method: "getAddresses", params: { network: CONNECT_NETWORK }, tag: "inApp:getAddresses:withNetwork" },
              { method: "stx_getAddresses", params: { network: CONNECT_NETWORK }, tag: "inApp:stx_getAddresses:withNetwork" },
            ]
          : [
              { method: "getAddresses", params: { network: CONNECT_NETWORK }, tag: "inApp:getAddresses:withNetwork" },
              { method: "getAddresses", params: undefined, tag: "inApp:getAddresses:noParams" },
              { method: "stx_getAddresses", params: undefined, tag: "inApp:stx_getAddresses:noParams" },
            ];
        logConnect("inApp:strategy", { walletHint, mobileFirst, count: strategies.length });
        let lastErr = null;
        for (const step of strategies) {
          try {
            logConnect(`${step.tag}:try`);
            if (typeof step.params === "undefined") {
              await request(step.method);
            } else {
              await request(step.method, step.params);
            }
            logConnect(`${step.tag}:ok`);
            lastErr = null;
            break;
          } catch (err) {
            logConnect(`${step.tag}:error`, err);
            lastErr = err;
            if (isRequestNotImplementedError(err)) {
              logConnect("inApp:requestNotImplemented:fallbackConnect", {
                preferredProviderId,
              });
              const fallbackApprovedProviderIds =
                preferredProviderId === LEGACY_XVERSE_PROVIDER_ID
                  ? [LEGACY_XVERSE_PROVIDER_ID, ...APPROVED_PROVIDER_IDS]
                  : [preferredProviderId];
              await connect({
                approvedProviderIds: fallbackApprovedProviderIds,
                network: CONNECT_NETWORK,
                appDetails,
              });
              logConnect("inApp:requestNotImplemented:fallbackConnect:ok");
              lastErr = null;
              break;
            }
            if (!isInvalidParamsError(err)) throw err;
          }
        }
        if (lastErr) throw lastErr;
      } else {
        logConnect("desktop:connect:try");
        const desktopApprovedProviderIds = [];
        if (installed.includes(LEGACY_XVERSE_PROVIDER_ID)) {
          desktopApprovedProviderIds.push(LEGACY_XVERSE_PROVIDER_ID);
        }
        if (installed.includes("XverseProviders.BitcoinProvider")) {
          desktopApprovedProviderIds.push("XverseProviders.BitcoinProvider");
        }
        if (installed.includes("LeatherProvider")) {
          desktopApprovedProviderIds.push("LeatherProvider");
        }
        if (!desktopApprovedProviderIds.length) {
          desktopApprovedProviderIds.push(...APPROVED_PROVIDER_IDS);
        }
        logConnect("desktop:approvedProviderIds", { desktopApprovedProviderIds });
        const likelyXverseDesktop =
          desktopApprovedProviderIds.includes(LEGACY_XVERSE_PROVIDER_ID) ||
          desktopApprovedProviderIds.includes("XverseProviders.BitcoinProvider");
        try {
          if (likelyXverseDesktop) {
            await connect({
              approvedProviderIds: desktopApprovedProviderIds,
              appDetails,
            });
          } else {
            await connect({
              approvedProviderIds: desktopApprovedProviderIds,
              network: CONNECT_NETWORK,
              appDetails,
            });
          }
        } catch (err) {
          if (!isInvalidParamsError(err)) throw err;
          logConnect("desktop:connect:retryWithoutNetwork", {
            message: err?.message,
            code: err?.code,
          });
          await connect({
            approvedProviderIds: desktopApprovedProviderIds,
            appDetails,
          });
        }
        logConnect("desktop:connect:ok");
      }
      logConnect("authenticate:connected");
      return getWalletAddress();
    }

    // Mobile default: in-app browser only, avoids app-to-app redirect loops/404.
    if (isMobileBrowser() && MOBILE_CONNECT_MODE !== "walletconnect") {
      if (!isWalletInAppBrowser() && !hasInAppHint()) {
        const selectedWallet = normalizeWalletChoice(
          options?.mobileWallet || getPreferredMobileWallet()
        );
        logConnect("mobile:deepLinkLaunch", { selectedWallet });
        const launched = openWalletInAppBrowser(selectedWallet);
        // If deep-link launch was triggered, do not show an error toast in the origin browser.
        if (launched) {
          logConnect("mobile:deepLinkLaunch:ok");
          return null;
        }
      }
      const err = new Error(MOBILE_INAPP_OPEN_HINT_ERROR);
      err.code = "MOBILE_INAPP_REQUIRED";
      logConnect("mobile:inAppRequired:error", err);
      throw err;
    }

    // Mobile fallback: use WalletConnect to open installed wallet apps (e.g. Xverse app).
    if (isMobileBrowser() && hasWalletConnectConfig()) {
      logConnect("mobile:walletconnect:try");
      await patchWalletConnectModalOptions();
      const connectUi = await getStacksConnectUi();
      const setSelectedProviderId = connectUi?.setSelectedProviderId;

      // Skip the "WalletConnect" picker in Stacks Connect modal and jump directly to WC flow.
      if (typeof setSelectedProviderId === "function") {
        setSelectedProviderId(WALLETCONNECT_PROVIDER_ID);
      }

      await request(
        {
          approvedProviderIds: [WALLETCONNECT_PROVIDER_ID],
          forceWalletSelect: false,
          appDetails,
          walletConnect: {
            projectId: WALLETCONNECT_PROJECT_ID,
            includeWalletIds: [XVERSE_WALLETCONNECT_ID],
            featuredWalletIds: [XVERSE_WALLETCONNECT_ID],
            customWallets: [LEATHER_CUSTOM_WALLET],
            allWallets: "HIDE",
            enableWalletGuide: false,
          },
        },
        "getAddresses",
        { network: CONNECT_NETWORK }
      );
      logConnect("mobile:walletconnect:ok");
      return getWalletAddress();
    }

    if (isMobileBrowser() && !hasWalletConnectConfig()) {
      const err = new Error(
        "Mobile wallet fallback requires REACT_APP_WALLETCONNECT_PROJECT_ID in client/.env."
      );
      err.code = "WALLETCONNECT_NOT_CONFIGURED";
      logConnect("mobile:walletconnect:notConfigured", err);
      throw err;
    }

    {
      const err = new Error(NO_WALLET_EXTENSION_ERROR);
      err.code = "NO_WALLET_EXTENSION";
      logConnect("noWalletExtension:error", err);
      throw err;
    }
  } catch (err) {
    // Cancel is not an error; return null.
    if (isUserCancel(err)) {
      logConnect("authenticate:userCanceled", {
        message: err?.message,
        code: err?.code,
      });
      return null;
    }
    // Re-throw real errors.
    logConnect("authenticate:error", {
      message: err?.message,
      code: err?.code,
      name: err?.name,
      stack: err?.stack,
    });
    throw err;
  }
}

export function logoutWallet() {
  disconnect();
}

// Queries Leather for the currently active STX address without showing a popup.
// Returns null if the provider is unavailable or the query fails.
export async function getLiveWalletAddress() {
  const provider = window.LeatherProvider;
  if (!provider?.request) return null;
  try {
    const res = await provider.request({ method: "getAddresses" });
    return (
      res?.result?.addresses?.stx?.[0]?.address ||
      res?.addresses?.stx?.[0]?.address ||
      null
    );
  } catch {
    return null;
  }
}

// Called by marketClient when a live address mismatch is detected at transaction time.
let _walletMismatchHandler = null;
export function setWalletMismatchHandler(fn) {
  _walletMismatchHandler = fn || null;
}
export function notifyWalletMismatch() {
  _walletMismatchHandler?.();
}

export function subscribeToAccountChanges(callback) {
  const provider = window.LeatherProvider;
  const cleanups = [];

  // Reuse the shared live-address helper
  const silentQueryAddress = async () => {
    if (!isConnected()) return null;
    return getLiveWalletAddress();
  };

  // --- Primary: provider event listeners (multiple name variants) ---
  if (provider?.on) {
    const handleEvent = (payload) => {
      const addr =
        payload?.addresses?.stx?.[0]?.address ||
        payload?.detail?.addresses?.stx?.[0]?.address ||
        payload?.address;
      if (addr) callback(addr);
    };
    for (const evtName of ["accountChange", "leather_accountChange"]) {
      provider.on(evtName, handleEvent);
      cleanups.push(() => {
        if (typeof provider.removeListener === "function") {
          provider.removeListener(evtName, handleEvent);
        } else if (typeof provider.off === "function") {
          provider.off(evtName, handleEvent);
        }
      });
    }
  }

  // --- Fallback: poll every 5 s (extension popups don't fire focus/blur on the tab) ---
  // Skip on mobile in-app browser: provider.request is not silent there and interferes
  // with pending openContractCall flows (causes post-tx UI freeze on Leather mobile).
  const inApp = isWalletInAppBrowser();
  const pollId = inApp ? null : setInterval(async () => {
    const addr = await silentQueryAddress();
    if (addr) callback(addr);
  }, 5000);
  cleanups.push(() => { if (pollId) clearInterval(pollId); });

  // --- Bonus: immediate check when the tab becomes visible again ---
  // Also skip on mobile in-app: visibilitychange fires when returning from the wallet
  // tx confirmation sheet, and calling provider.request at that moment blocks the UI.
  const onVisible = async () => {
    if (document.visibilityState !== "visible") return;
    if (isWalletInAppBrowser()) return;
    const addr = await silentQueryAddress();
    if (addr) callback(addr);
  };
  document.addEventListener("visibilitychange", onVisible);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));

  return () => cleanups.forEach((fn) => fn());
}

export function getWalletAddress() {
  const userData = getLocalStorage();
  if (userData?.addresses?.stx?.[0]?.address) {
    return userData.addresses.stx[0].address;
  }
  return null;
}
