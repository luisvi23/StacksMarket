// tests/bootstrap.ts
// Cargador ultra-tolerante para entornos donde la factory/sbtc pueden no estar.
// No falla si ya existen o si el runner no expone estos métodos.

import { simnet } from "./helpers";

try {
  // Si tu helper expone loadProject, úsalo (no siempre está).
  (simnet as any).loadProject?.(process.cwd());
} catch (e) {
  // Silencioso: no es crítico.
  console.log("[bootstrap] loadProject no disponible (ok)");
}

// Si tu test-runner tuviera API para desplegar contratos manualmente, sería aquí.
// Lo dejamos en try/catch para que no reviente en runners sin esa API.
try {
  (simnet as any).deployContract?.("market-factory", "contracts/market-factory.clar", (simnet as any).deployer ?? undefined);
} catch {}
try {
  (simnet as any).deployContract?.("sbtc", "contracts/sbtc.clar", (simnet as any).deployer ?? undefined);
} catch {}
