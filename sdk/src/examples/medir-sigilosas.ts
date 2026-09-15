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
  deriveStealthKeys,
  generateStealthAddress,
  checkStealthAddress,
} from "../StealthAddress";

// Frase de prueba pública: solo sirve para medir, no custodia fondos.
const MNEMONIC = "test test test test test test test test test test test junk";

const REPETITIONS = Number(process.argv[2] || 200);
const WARMUP = 20;

function average(fn: () => void): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < REPETITIONS; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6 / REPETITIONS;
}

const keys = deriveStealthKeys(MNEMONIC, "alice");
const payment = generateStealthAddress(keys.metaAddress);

const results = {
  "Derivación de claves y metadirección": average(() => deriveStealthKeys(MNEMONIC, "alice")),
  "Verificación de dirección sigilosa": average(() =>
    checkStealthAddress(
      payment,
      keys.viewing.privateKey,
      keys.spending.publicKey,
      keys.spending.privateKey
    )
  ),
  "Generación de dirección sigilosa": average(() => generateStealthAddress(keys.metaAddress)),
};

console.log(`Promedios sobre ${REPETITIONS} repeticiones (tras ${WARMUP} de calentamiento):`);
for (const [label, ms] of Object.entries(results)) {
  console.log(`  ${label}: ${ms.toFixed(2)} ms`);
}
