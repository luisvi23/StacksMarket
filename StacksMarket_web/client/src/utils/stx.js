export const USTX_PER_STX = 1000000;

export function stxToUstx(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n);
  return rounded * USTX_PER_STX;
}

export function ustxToStxString(ustx, { minDecimals = 0, maxDecimals = 6 } = {}) {
  if (ustx == null) return "-";
  const n = Number(ustx);
  if (!Number.isFinite(n)) return "-";

  const sign = n < 0 ? "-" : "";
  const scaled = Math.round(Math.abs(n));

  const whole = Math.floor(scaled / USTX_PER_STX);
  const frac = scaled % USTX_PER_STX;

  let maxDec = Math.max(minDecimals, maxDecimals);
  maxDec = Math.min(maxDec, 6);

  let fracStr = String(frac).padStart(6, "0");
  if (maxDec < 6) fracStr = fracStr.slice(0, maxDec);

  if (minDecimals > 0) {
    fracStr = fracStr.padEnd(minDecimals, "0");
  } else {
    fracStr = fracStr.replace(/0+$/, "");
  }

  if (!fracStr) return `${sign}${whole}`;
  return `${sign}${whole}.${fracStr}`;
}

export function formatStx(ustx, opts) {
  const v = ustxToStxString(ustx, opts);
  if (v === "-") return v;
  return `${v} STX`;
}
