// tests/helpers.ts
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { Cl as Clarity } from "@stacks/transactions";

// simnet inyectado por el environment de clarinet-vitest
export const simnet: any = (globalThis as any).simnet;

// Exporta Cl para que los tests puedan usar Cl.uint, Cl.principal, etc.
export { Clarity as Cl };

// ---------- LOG UNIFICADO ----------
const LOG_FILE = "tests/run.log";
if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, "");

export function log(line: string) {
  const msg = line.endsWith("\n") ? line : line + "\n";
  process.stdout.write(msg);
  appendFileSync(LOG_FILE, msg);
}
export function logHeader(title: string, desc?: string) {
  const bar = "—".repeat(96);
  log(`\n${bar}\n${title}\n${bar}\n`);
  if (desc) log(`📝 ${desc}\n`);
}
export function logSection(title: string) {
  log(`\n▶ ${title}\n`);
}

// ---------- ADDR CON ALIAS ----------
/**
 * Devuelve dirección por índice (0,1,2,...) o por nombre:
 *  - "deployer", "wallet_1"... (nativos del simnet)
 *  - alias: "w1".."w10", "admin" (-> deployer), "lp"(w5), "team"(w6), "drip"(w7), "brc"(w8)
 */
export function addr(index: number | string): string {
  const accounts: Map<string, string> = simnet.getAccounts();

  // Índice numérico
  if (typeof index === "number") {
    const keys = Array.from(accounts.keys());
    const key = keys[index];
    if (!key) throw new Error(`Cuenta con indice ${index} no encontrada`);
    return accounts.get(key)!;
  }

  // String con alias
  const raw = String(index).trim().toLowerCase();

  // nativos
  if (accounts.has(raw)) return accounts.get(raw)!;

  // alias comunes
  const aliasMap: Record<string, string> = {
    admin: "deployer",
    lp: "w5",
    team: "w6",
    drip: "w7",
    brc: "w8",
  };
  const aliased = aliasMap[raw] ?? raw;

  // "wN" -> "wallet_N"
  const wMatch = /^w(\d+)$/.exec(aliased);
  if (wMatch) {
    const walletKey = `wallet_${wMatch[1]}`;
    const v = accounts.get(walletKey);
    if (v) return v;
  }

  // fallback: quizá ya es "wallet_N"
  const direct = accounts.get(aliased);
  if (direct) return direct;

  throw new Error(`Cuenta no encontrada: ${index}`);
}

// ---------- CONVERSORES CV ----------
export function cvToUint(cv: any): number {
  if (!cv) throw new Error("cvToUint: valor vacio");
  if (cv.type === "ok") return cvToUint(cv.value);
  if (cv.type === "uint") return Number(cv.value);
  if (cv.result) return cvToUint(cv.result);
  if (cv.value?.type === "uint") return Number(cv.value.value);
  throw new Error(`cvToUint: tipo inesperado ${cv.type}`);
}
export function cvToAscii(cv: any): string {
  const unwrap = (x: any): any => (x?.type === "ok" ? x.value : x);
  const v = unwrap(cv.result ?? cv.value ?? cv);
  if (v?.type === "string-ascii") return v.value as string;
  if (typeof v === "string") return v;
  throw new Error(`cvToAscii: tipo inesperado ${JSON.stringify(cv)}`);
}

// Atajos cómodos
export const U = (n: number | bigint) => Clarity.uint(n as any);
export const B = (b: boolean) => Clarity.bool(b as any);

// Atajo: principal desde string ST...
export function principal(address: string) {
  return Clarity.principal(address);
}

// ---------- QUOTES helpers robustos ----------
export function unwrapQuote(res: any) {
  const root = res?.result ?? res;
  let v: any = root?.value ?? root?.data ?? root;
  if (v?.type === "tuple" && v?.value) v = v.value;
  if (v?.data && (v.data.total || v.data.cost)) v = v.data;

  const pick = (k: string) => {
    const f = v?.[k];
    const val = f?.value ?? f;
    if (val === undefined) {
      throw new Error(`Quote missing ${k}: ${JSON.stringify(root)}`);
    }
    return Number(val);
  };

  return {
    cost:        pick("cost"),
    feeProtocol: pick("feeProtocol"),
    feeLP:       pick("feeLP"),
    walletA:     pick("walletA"),
    walletB:     pick("walletB"),
    total:       pick("total"),
  };
}
export function quoteTotal(res: any): number {
  return unwrapQuote(res).total;
}
export function logQuote(side: "YES" | "NO", amount: number, q: ReturnType<typeof unwrapQuote>) {
  log(`💬 Quote ${side} Δ=${amount}: cost=${q.cost}, feeProtocol=${q.feeProtocol} (walletA=${q.walletA}, walletB=${q.walletB}), feeLP=${q.feeLP}, TOTAL=${q.total}`);
}

// ---------- Azúcar para llamadas ----------
export function callOk(contract: string, fn: string, args: any[], sender: string, note?: string) {
  const r = simnet.callPublicFn(contract, fn, args, sender);
  const tag = note ? ` (${note})` : "";
  if (r.result.type === "ok") {
    log(`✅ TX ${contract}::${fn}${tag} by ${sender}\n   ↳ ok: ${prettyCV(r.result.value)}`);
  } else {
    log(`❌ TX ${contract}::${fn}${tag} by ${sender}\n   ↳ err: ${prettyCV(r.result.value)}`);
  }
  return r;
}
export function callRaw(contract: string, fn: string, args: any[], sender: string, note?: string) {
  const r = simnet.callPublicFn(contract, fn, args, sender);
  const tag = note ? ` (${note})` : "";
  log(`↪  TX ${contract}::${fn}${tag} by ${sender}\n   ↳ result: ${JSON.stringify(r.result)}`);
  return r;
}
export function view(contract: string, fn: string, args: any[] = [], caller: string = addr("admin")) {
  return simnet.callReadOnlyFn(contract, fn, args, caller);
}

// ---------- Estado & Balances ----------
export const MARKET = "market-factory-v21-testnet-bias";
export const SBTC   = "sbtc-v3";

// helpers.ts
export function sbtcBalance(who: string): number {
  // usar siempre caller estándar para la view, no el propio 'who'
  const res = view(SBTC, "get-balance", [principal(who)], addr("admin")).result;
  return cvToUint(res);
}

export function getSelfPrincipal(): string {
  const res = view(MARKET, "get-self", [], addr("admin")).result;
  // puede venir como principal en cv.result.value.value
  // simnet imprime diferente según versión, pero la API real devuelve principal
  const val = (res as any).value ?? (res as any);
  // best effort: intenta extraer directamente
  return (val?.value as string) || (val as string);
}
export function getFeeRecipients(): { drip: string, brc20: string, team: string, lp: string, locked: boolean } {
  const t = view(MARKET, "get-fee-recipients", [], addr("admin")).result;
  const v = (t as any).value ?? (t as any).data ?? t;
  const g = (k: string) => v[k]?.value ?? v[k];
  return {
    drip: String(g("drip")),
    brc20: String(g("brc20")),
    team: String(g("team")),
    lp: String(g("lp")),
    locked: Boolean((v["locked"]?.value ?? v["locked"])),
  };
}
export function printMarketState(m: number, caller = addr("admin")) {
  const pool = cvToUint(view(MARKET, "get-pool", [U(m)], caller).result);
  const ys   = cvToUint(view(MARKET, "get-yes-supply", [U(m)], caller).result);
  const ns   = cvToUint(view(MARKET, "get-no-supply",  [U(m)], caller).result);
  log(`📊 State m=${m}: pool=${pool}, YES-supply=${ys}, NO-supply=${ns}`);
  return { pool, ys, ns };
}
export function printBalances(tag: string, who: string[]) {
  const lines = who.map(a => `${a}=${sbtcBalance(a)}`).join(" | ");
  log(`💰 Balances ${tag}: ${lines}`);
}
export function prettyCV(cv: any): string {
  try {
    if (!cv) return "null";
    if (cv.type === "uint") return `${cv.value}u`;
    if (cv.type === "bool") return cv.value ? "true" : "false";
    if (cv.type === "ok" || cv.type === "err") return JSON.stringify(cv);
    if (cv.type === "tuple") return JSON.stringify(cv.value);
    if (cv.type === "principal") return String(cv.value);
    return JSON.stringify(cv);
  } catch {
    return String(cv);
  }
}
// helpers.ts
