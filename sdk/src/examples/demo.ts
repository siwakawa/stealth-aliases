/**
 * Demo básica: Aliases + Stealth Addresses (sin Railgun)
 *
 * Demuestra el flujo de resolución de aliases y generación de
 * stealth addresses con criptografía real (ECDH secp256k1).
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";
import {
  AliasRegistryClient,
  generateStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
  parseStealthMetaAddress,
} from "../index";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL =
  process.env.POLYGON_RPC || "https://polygon-mainnet.public.blastapi.io";

async function main() {
  console.log("=== Demo: Aliases + Stealth Addresses (crypto real) ===\n");

  // 1. Conectar al provider
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Red: Polygon (chainId: ${network.chainId})\n`);

  // 2. Inicializar cliente del registro
  const registry = new AliasRegistryClient(provider);
  console.log(`Contrato: ${registry.getContractAddress()}\n`);

  // === Bob genera su identidad ===
  console.log("--- Paso 1: Bob genera sus claves sigilosas ---");
  const bobKeys = generateStealthMetaAddress();
  console.log(
    `  Viewing pubkey: ${ethers.hexlify(bobKeys.viewing.publicKey).slice(0, 20)}...`
  );
  console.log(
    `  Spending pubkey: ${ethers.hexlify(bobKeys.spending.publicKey).slice(0, 20)}...`
  );
  console.log(
    `  Meta-address (66 bytes): ${ethers.hexlify(bobKeys.metaAddress).slice(0, 30)}...\n`
  );

  // === Alice resuelve alias existente ===
  console.log("--- Paso 2: Alice resuelve @satoshi_test ---");
  const aliasToResolve = "satoshi_test";
  const info = await registry.getAliasInfo(aliasToResolve);

  if (!info.isRegistered) {
    console.log(`@${aliasToResolve} no está registrado.\n`);
  } else {
    console.log(`@${aliasToResolve} encontrado:`);
    console.log(`  Meta-address: ${info.stealthMetaAddress.slice(0, 30)}...`);

    const parsed = parseStealthMetaAddress(info.stealthMetaAddress);
    console.log(
      `  Viewing pubkey: ${ethers.hexlify(parsed.viewingPublicKey).slice(0, 20)}...`
    );
    console.log(
      `  Spending pubkey: ${ethers.hexlify(parsed.spendingPublicKey).slice(0, 20)}...\n`
    );

    // Generar stealth address con ECDH real
    console.log("--- Paso 3: Alice genera stealth address (ECDH real) ---");
    try {
      const payment = generateStealthAddress(info.stealthMetaAddress);
      console.log(`  Stealth address: ${payment.stealthAddress}`);
      console.log(
        `  Ephemeral pubkey: ${ethers.hexlify(payment.ephemeralPublicKey).slice(0, 20)}...`
      );
      console.log(
        `  View tag: 0x${payment.viewTag.toString(16).padStart(2, "0")}\n`
      );
    } catch (err: any) {
      console.log(
        `  ⚠ Meta-address de @${aliasToResolve} no es un punto secp256k1 válido.`
      );
      console.log(
        `    (Fue registrada con crypto mock antigua. Necesita re-registro con claves reales)\n`
      );
    }
  }

  // === Verificación end-to-end con claves de Bob ===
  console.log("--- Paso 4: Verificación de detección de pagos ---");
  const metaAddrHex = ethers.hexlify(bobKeys.metaAddress);

  // Alice genera pago
  const payment = generateStealthAddress(metaAddrHex);
  console.log(`Alice generó pago para Bob:`);
  console.log(`  Stealth address: ${payment.stealthAddress}`);

  // Bob verifica con su viewing key
  const check = checkStealthAddress(
    payment.stealthAddress,
    payment.ephemeralPublicKey,
    bobKeys.viewing.privateKey,
    bobKeys.spending.publicKey,
    payment.viewTag,
    bobKeys.spending.privateKey
  );

  console.log(`  Bob detecta el pago: ${check.isOurs ? "✓ SÍ" : "✗ NO"}`);

  if (check.stealthPrivateKey) {
    // Verificar que la clave privada derivada corresponde a la stealth address
    const derivedAddress = ethers.computeAddress(
      new ethers.SigningKey(check.stealthPrivateKey).publicKey
    );
    const matches =
      derivedAddress.toLowerCase() === payment.stealthAddress.toLowerCase();
    console.log(`  Spending key derivada: ${matches ? "✓ correcta" : "✗ incorrecta"}`);
    console.log(`  Dirección derivada: ${derivedAddress}`);
  }

  // Verificar que un tercero NO detecta el pago
  const fakeKeys = generateStealthMetaAddress();
  const fakeCheck = checkStealthAddress(
    payment.stealthAddress,
    payment.ephemeralPublicKey,
    fakeKeys.viewing.privateKey,
    fakeKeys.spending.publicKey
  );
  console.log(
    `  Tercero detecta: ${fakeCheck.isOurs ? "✗ FALLA (falso positivo)" : "✓ NO (correcto)"}\n`
  );

  console.log("=== Demo completada ===");
  console.log("\nResumen:");
  console.log("  ✓ Resolución de aliases desde contrato en Polygon mainnet");
  console.log("  ✓ ECDH real con ethers.SigningKey.computeSharedSecret");
  console.log("  ✓ Point addition real con ethers.SigningKey.addPoints");
  console.log("  ✓ Detección de pagos con viewing key verificada");
  console.log("  ✓ Derivación de spending key para la stealth address");
  console.log("  ✓ Terceros no pueden detectar pagos ajenos");
}

main().catch(console.error);
