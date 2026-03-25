import { ethers } from "ethers";
import { config } from "dotenv";
import {
  AliasRegistryClient,
  generateStealthMetaAddress,
  generateStealthAddress,
  parseStealthMetaAddress,
} from "../index";

config({ path: __dirname + "/../../../contracts/.env" });

const RPC_URL = process.env.POLYGON_RPC || "https://polygon-mainnet.public.blastapi.io";

async function main() {
  console.log("=== Demo: Sistema de Aliases Privados ===\n");

  // 1. Conectar al provider
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Red: ${network.name} (chainId: ${network.chainId})\n`);

  // 2. Inicializar cliente del registro
  const registry = new AliasRegistryClient(provider);
  console.log(`Contrato: ${registry.getContractAddress()}\n`);

  // === ESCENARIO: Bob se registra ===
  console.log("--- Paso 1: Bob genera su identidad ---");

  const bobKeys = generateStealthMetaAddress();
  console.log("Bob generó sus claves:");
  console.log(`  Viewing pubkey: ${ethers.hexlify(bobKeys.viewing.publicKey).slice(0, 20)}...`);
  console.log(`  Spending pubkey: ${ethers.hexlify(bobKeys.spending.publicKey).slice(0, 20)}...`);
  console.log(`  Meta-address (66 bytes): ${ethers.hexlify(bobKeys.metaAddress).slice(0, 30)}...\n`);

  // En un caso real, Bob registraría su alias:
  // const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  // const registryWithSigner = new AliasRegistryClient(signer);
  // await registryWithSigner.register("bob", bobKeys.metaAddress);

  // === ESCENARIO: Alice paga a @satoshi_test (alias que ya existe) ===
  console.log("--- Paso 2: Alice resuelve @satoshi_test ---");

  const aliasToResolve = "satoshi_test";
  const info = await registry.getAliasInfo(aliasToResolve);

  if (!info.isRegistered) {
    console.log(`@${aliasToResolve} no está registrado.\n`);
    return;
  }

  console.log(`@${aliasToResolve} encontrado:`);
  console.log(`  Meta-address: ${info.stealthMetaAddress.slice(0, 30)}...`);

  const parsed = parseStealthMetaAddress(info.stealthMetaAddress);
  console.log(`  Viewing pubkey: ${ethers.hexlify(parsed.viewingPublicKey).slice(0, 20)}...`);
  console.log(`  Spending pubkey: ${ethers.hexlify(parsed.spendingPublicKey).slice(0, 20)}...\n`);

  // === ESCENARIO: Alice genera dirección de pago única ===
  console.log("--- Paso 3: Alice genera stealth address para el pago ---");

  const payment = generateStealthAddress(info.stealthMetaAddress);

  console.log("Alice generó una dirección única para este pago:");
  console.log(`  Stealth address: ${payment.stealthAddress}`);
  console.log(`  Ephemeral pubkey: ${ethers.hexlify(payment.ephemeralPublicKey).slice(0, 20)}...`);
  console.log(`  View tag: 0x${payment.viewTag.toString(16).padStart(2, "0")}\n`);

  console.log("--- Paso 4: Alice envía fondos (simulado) ---");
  console.log(`Alice enviaría USDC a: ${payment.stealthAddress}`);
  console.log("(En producción, esto iría por Railgun para ocultar el monto)\n");

  console.log("--- Paso 5: Publicar datos para el receptor ---");
  console.log("Alice publica en el contrato Announcer (ERC-5564):");
  console.log(`  - Ephemeral pubkey: para que Bob pueda derivar la stealth address`);
  console.log(`  - View tag: 0x${payment.viewTag.toString(16).padStart(2, "0")} (optimiza el escaneo de Bob)`);
  console.log(`  - Stealth address: ${payment.stealthAddress}\n`);

  console.log("--- Paso 6: Bob escanea y detecta el pago ---");
  console.log("Bob escanea los anuncios con su viewing key:");
  console.log("  1. Filtra por view tag (descarta 255/256 de los anuncios)");
  console.log("  2. Recalcula la stealth address con su viewing key");
  console.log("  3. Si coincide, el pago es para él");
  console.log("  4. Deriva la spending key para gastar los fondos\n");

  console.log("=== Demo completada ===");
  console.log("\nEste flujo demuestra cómo los aliases permiten pagos privados:");
  console.log("  - Alice solo conoce @satoshi_test (no la dirección real)");
  console.log("  - Cada pago usa una dirección diferente (unlinkable)");
  console.log("  - Solo Bob puede detectar y gastar los fondos");
}

main().catch(console.error);
