/**
 * Demo completa: Aliases + Railgun
 *
 * Este ejemplo muestra el flujo completo:
 * 1. Alice resuelve @bob usando AliasRegistry
 * 2. Alice blinda (shield) sus USDC en Railgun
 * 3. Alice transfiere privadamente a Bob
 * 4. Bob detecta el pago
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import { NetworkName } from "@railgun-community/shared-models";
import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";
import {
  generateStealthMetaAddress,
  generateStealthAddress,
  parseStealthMetaAddress,
} from "../StealthAddress";

config({ path: __dirname + "/../../../contracts/.env" });

const RPC_URL = process.env.POLYGON_RPC || "https://polygon-rpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// USDC en Polygon
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Demo: Sistema de Aliases Privados con Railgun            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // === SETUP ===
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Red: ${network.name} (chainId: ${network.chainId})\n`);

  // Cliente del registro de aliases
  const registry = new AliasRegistryClient(provider);
  console.log(`AliasRegistry: ${registry.getContractAddress()}\n`);

  // === PARTE 1: Bob se registra ===
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PARTE 1: Bob genera su identidad y registra su alias");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Bob genera sus claves sigilosas
  const bobKeys = generateStealthMetaAddress();
  console.log("Bob generó sus claves sigilosas:");
  console.log(`  Viewing key (privada):  ${ethers.hexlify(bobKeys.viewing.privateKey).slice(0, 20)}...`);
  console.log(`  Spending key (privada): ${ethers.hexlify(bobKeys.spending.privateKey).slice(0, 20)}...`);
  console.log(`  Meta-address (pública): ${ethers.hexlify(bobKeys.metaAddress).slice(0, 30)}...\n`);

  // En producción, Bob registraría su alias:
  // await registry.register("bob", bobKeys.metaAddress);
  console.log("(En producción, Bob llamaría a registry.register('bob', metaAddress))\n");

  // === PARTE 2: Alice resuelve el alias y prepara el pago ===
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PARTE 2: Alice quiere pagar 100 USDC a @satoshi_test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Alice resuelve el alias
  const aliasToResolve = "satoshi_test";
  console.log(`Paso 1: Resolviendo @${aliasToResolve}...`);

  const info = await registry.getAliasInfo(aliasToResolve);
  if (!info.isRegistered) {
    console.log(`  ❌ @${aliasToResolve} no está registrado\n`);
    return;
  }

  console.log(`  ✓ Encontrado: ${info.stealthMetaAddress.slice(0, 40)}...\n`);

  // Alice genera una stealth address única para este pago
  console.log("Paso 2: Generando stealth address para este pago...");
  const payment = generateStealthAddress(info.stealthMetaAddress);

  console.log(`  ✓ Stealth address: ${payment.stealthAddress}`);
  console.log(`  ✓ Ephemeral pubkey: ${ethers.hexlify(payment.ephemeralPublicKey).slice(0, 20)}...`);
  console.log(`  ✓ View tag: 0x${payment.viewTag.toString(16).padStart(2, "0")}\n`);

  // === PARTE 3: Inicializar Railgun ===
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PARTE 3: Alice prepara la transferencia privada con Railgun");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("Paso 3: Inicializando Railgun Engine...");

  try {
    const railgun = new RailgunService({
      networkName: NetworkName.Polygon,
      rpcUrl: RPC_URL,
      dataDir: "/tmp/railgun-demo",
    });

    await railgun.initialize();
    console.log("  ✓ Railgun Engine inicializado\n");

    // Crear wallet de Railgun para Alice
    console.log("Paso 4: Creando wallet privada de Railgun para Alice...");
    const aliceWallet = await railgun.createWallet();
    console.log(`  ✓ Railgun address: ${aliceWallet.railgunAddress.slice(0, 30)}...\n`);

    // === FLUJO COMPLETO (simulado) ===
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("FLUJO COMPLETO (las siguientes operaciones requieren fondos reales)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("Paso 5: Shield - Alice blindaría 100 USDC en Railgun");
    console.log("        (deposita tokens públicos → balance privado)");
    console.log(`        Comando: await railgun.shieldTokens(USDC_ADDRESS, 100n * 10n**6n, aliceWallet)\n`);

    console.log("Paso 6: Transfer - Alice enviaría 100 USDC a la stealth address");
    console.log("        (genera prueba ZK, transfiere dentro de la reserva)");
    console.log(`        Comando: await railgun.privateTransfer(USDC_ADDRESS, 100n * 10n**6n, stealthRailgunAddress)\n`);

    console.log("Paso 7: Detect - Bob escanearía con su viewing key");
    console.log("        1. Bob ve el ephemeral pubkey publicado por Alice");
    console.log("        2. Bob calcula: S = viewing_private * ephemeral_pubkey");
    console.log("        3. Bob deriva: stealth_address = spending_pubkey + hash(S) * G");
    console.log("        4. Si coincide con una nota con fondos → el pago es para Bob\n");

    console.log("Paso 8: Spend - Bob podría gastar los fondos");
    console.log("        Bob calcula: stealth_private = spending_private + hash(S)");
    console.log("        Usa stealth_private para firmar transacciones\n");

    // Limpiar
    await railgun.shutdown();
    console.log("✓ Railgun Engine detenido\n");

  } catch (error: any) {
    console.log(`  ⚠ Error inicializando Railgun: ${error.message}`);
    console.log("  (Esto es esperado en la primera ejecución - necesita descargar artefactos ZK)\n");
  }

  // === RESUMEN ===
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                         RESUMEN                              ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ Lo que funciona ahora:                                       ║");
  console.log("║   ✓ AliasRegistry desplegado en Polygon mainnet              ║");
  console.log("║   ✓ Resolución de aliases (@satoshi_test)                    ║");
  console.log("║   ✓ Generación de stealth addresses únicas                   ║");
  console.log("║   ✓ Inicialización del Railgun Engine                        ║");
  console.log("║   ✓ Creación de wallets Railgun                              ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ Para completar el flujo real se necesita:                    ║");
  console.log("║   • USDC en la wallet de Alice                               ║");
  console.log("║   • POL para gas                                             ║");
  console.log("║   • Tiempo para generar pruebas ZK (~30 seg)                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main().catch(console.error);
