// lmsrOdds.js
// Cálculo de probabilidades tipo LMSR para mercado binario YES/NO
// usando b y las cantidades qYes, qNo (que en tu caso son yesSupply y noSupply).

export function computeLmsrBinaryOdds({ b, qYes, qNo }) {
  const B = Number(b) || 0;
  const Qy = Number(qYes) || 0;
  const Qn = Number(qNo) || 0;

  if (B <= 0) {
    return {
      yesProb: 0.5,
      noProb: 0.5,
      yesPct: 50,
      noPct: 50,
    };
  }

  // p_yes = exp(qY/b) / (exp(qY/b) + exp(qN/b))
  const y = Math.exp(Qy / B);
  const n = Math.exp(Qn / B);
  const denom = y + n;

  if (!Number.isFinite(denom) || denom <= 0) {
    return {
      yesProb: 0.5,
      noProb: 0.5,
      yesPct: 50,
      noPct: 50,
    };
  }

  const pYes = y / denom;
  const pNo = 1 - pYes;

  return {
    yesProb: pYes,
    noProb: pNo,
    yesPct: Math.round(pYes * 100),
    noPct: Math.round(pNo * 100),
  };
}
