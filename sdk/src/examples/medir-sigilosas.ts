/**
 * Medición de las operaciones de direcciones sigilosas.
 *
 * Son cómputo local puro, sin red, de modo que se pueden promediar sobre muchas
 * repeticiones. Respalda las tres primeras filas de la tabla de tiempos de la
 * tesina.
 *
 * Uso:
 *   ts-node src/examples/medir-sigilosas.ts [repeticiones]
 */

import {
  generateStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
} from "../StealthAddress";

const REPETITIONS = Number(process.argv[2] || 200);
const WARMUP = 20;

function average(fn: () => void): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < REPETITIONS; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / REPETITIONS;
}

const keys = generateStealthMetaAddress();
const payment = generateStealthAddress(keys.metaAddress);

const results = {
  "Generación de metadirección": average(() => generateStealthMetaAddress()),
  "Verificación de dirección sigilosa": average(() =>
    checkStealthAddress(
      payment.stealthAddress,
      payment.ephemeralPublicKey,
      keys.viewing.privateKey,
      keys.spending.publicKey,
      payment.viewTag,
      keys.spending.privateKey
    )
  ),
  "Generación de dirección sigilosa": average(() => generateStealthAddress(keys.metaAddress)),
};

console.log(`Promedios sobre ${REPETITIONS} repeticiones (tras ${WARMUP} de calentamiento):`);
for (const [label, ms] of Object.entries(results)) {
  console.log(`  ${label}: ${ms.toFixed(2)} ms`);
}
