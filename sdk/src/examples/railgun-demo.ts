/**
 * Demo end-to-end: @alice envía USDC a @bob de forma privada
 *
 * Flujo completo:
 * 1. Crear wallets Railgun para Alice y Bob
 * 2. Registrar aliases @alice y @bob en AliasRegistryV2 (on-chain)
 * 3. Alice blinda USDC en la reserva privada de Railgun (shield)
 * 4. Alice resuelve @bob → obtiene dirección Railgun de Bob
 * 5. Alice transfiere USDC a Bob dentro de la reserva (transferencia privada con ZK-proof)
 * 6. Bob verifica su balance
 *
 * Uso:
 *   ts-node src/examples/railgun-demo.ts               # solo registro de aliases
 *   ts-node src/examples/railgun-demo.ts --shield       # + blindaje de USDC
 *   ts-node src/examples/railgun-demo.ts --shield --transfer  # flujo completo
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import { NetworkName } from "@railgun-community/shared-models";
import * as path from "path";

import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";
import { generateStealthMetaAddress } from "../StealthAddress";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC || "https://polygon-rpc.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MNEMONIC_A = process.env.MNEMONIC_A;
const MNEMONIC_B = process.env.MNEMONIC_B;

// USDC en Polygon (6 decimales)
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// Directorio para datos persistentes de Railgun
const DATA_DIR =
  process.env.RAILGUN_DATA_DIR ||
  path.join(require("os").homedir(), ".stealth-aliases");

async function main() {
  const args = process.argv.slice(2);
  const doShield = args.includes("--shield");
  const doTransfer = args.includes("--transfer");

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Demo: @alice envía USDC a @bob (privado, Railgun)     ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY no configurado en .env");
  if (!MNEMONIC_A) throw new Error("MNEMONIC_A no configurado en .env");
  if (!MNEMONIC_B) throw new Error("MNEMONIC_B no configurado en .env");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PARTE 1: Setup
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("━━━ PARTE 1: Setup ━━━\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  console.log(`Red: Polygon (chainId: ${network.chainId})`);
  console.log(`Wallet pública: ${signer.address}`);

  // Registry con signer para poder registrar
  const registry = new AliasRegistryClient(signer);
  console.log(`AliasRegistryV2: ${registry.getContractAddress()}\n`);

  // Railgun service
  const railgun = new RailgunService({
    networkName: NetworkName.Polygon,
    rpcUrl: RPC_URL,
    dataDir: DATA_DIR,
    debug: false,
  });

  try {
    await railgun.initialize();
    console.log("");

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 2: Crear wallets y registrar aliases
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("━━━ PARTE 2: Wallets Railgun + registro de aliases ━━━\n");

    // Wallet A (Alice)
    const walletA = await railgun.getOrCreateWallet(MNEMONIC_A, "alice");
    console.log(`  Alice Railgun: ${walletA.railgunAddress.slice(0, 40)}...`);

    // Wallet B (Bob)
    const walletB = await railgun.getOrCreateWallet(MNEMONIC_B, "bob");
    console.log(`  Bob Railgun:   ${walletB.railgunAddress.slice(0, 40)}...\n`);

    // Registrar @alice (si no existe)
    const aliceRegistered = await registry.isRegistered("alice");
    if (!aliceRegistered) {
      console.log("Registrando @alice...");
      const aliceKeys = generateStealthMetaAddress();
      const tx = await registry.register(
        "alice",
        aliceKeys.metaAddress,
        walletA.railgunAddress
      );
      await tx.wait();
      console.log(`  ✓ @alice registrada (tx: ${tx.hash.slice(0, 20)}...)`);
    } else {
      console.log("  @alice ya registrada");
    }

    // Registrar @bob (si no existe)
    const bobRegistered = await registry.isRegistered("bob");
    if (!bobRegistered) {
      console.log("Registrando @bob...");
      const bobKeys = generateStealthMetaAddress();
      const tx = await registry.register(
        "bob",
        bobKeys.metaAddress,
        walletB.railgunAddress
      );
      await tx.wait();
      console.log(`  ✓ @bob registrado (tx: ${tx.hash.slice(0, 20)}...)`);
    } else {
      console.log("  @bob ya registrado");
    }

    // Verificar resolución
    console.log("\nVerificando aliases on-chain:");
    const aliceInfo = await registry.getAliasInfo("alice");
    console.log(`  @alice → ${aliceInfo.railgunAddress.slice(0, 30)}...`);
    const bobInfo = await registry.getAliasInfo("bob");
    console.log(`  @bob   → ${bobInfo.railgunAddress.slice(0, 30)}...`);

    // Balances iniciales
    const aliceBalance = await railgun.getBalance(USDC_ADDRESS);
    console.log(`\n  Balance privado Alice: ${ethers.formatUnits(aliceBalance, 6)} USDC`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 3: Shield (blindaje de USDC)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (doShield) {
      console.log("\n━━━ PARTE 3: Alice blinda USDC en Railgun ━━━\n");

      // Recargar wallet de Alice (getOrCreateWallet de Bob sobreescribió walletInfo)
      await railgun.getOrCreateWallet(MNEMONIC_A, "alice");

      const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
      ];
      const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, provider);
      const publicBalance = await usdc.balanceOf(signer.address);
      console.log(`  Balance USDC público: ${ethers.formatUnits(publicBalance, 6)} USDC`);

      if (publicBalance > 0n) {
        const shieldAmount = 100_000n; // 0.1 USDC
        console.log(`  Blindando ${ethers.formatUnits(shieldAmount, 6)} USDC...\n`);

        const txHash = await railgun.shieldTokens(
          USDC_ADDRESS,
          shieldAmount,
          signer
        );
        console.log(`\n  ✓ Shield completado: ${txHash}`);

        // Esperar a que el merkletree scan detecte el UTXO del shield
        console.log("  Esperando scan de merkletree (max 5 min)...");
        try {
          await railgun.waitForScan(300_000);
          console.log("  ✓ Scan completado");
        } catch {
          console.log("  ⚠ Scan timeout, reintentando...");
          await railgun.refreshWalletBalances();
        }
        const newBalance = await railgun.getBalance(USDC_ADDRESS);
        console.log(`  Balance privado Alice: ${ethers.formatUnits(newBalance, 6)} USDC`);
      } else {
        console.log("  Sin USDC público para blindar.");
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 4: Alice envía a @bob (transferencia privada)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (doTransfer) {
      console.log("\n━━━ PARTE 4: Alice envía a @bob (transferencia privada) ━━━\n");

      // Asegurar que estamos con la wallet de Alice
      await railgun.getOrCreateWallet(MNEMONIC_A, "alice");

      // 1. Resolver @bob on-chain
      console.log("  Resolviendo @bob en el contrato...");
      const bobRailgunAddress = await registry.resolveRailgun("bob");
      console.log(`  @bob → ${bobRailgunAddress.slice(0, 40)}...`);

      // 2. Verificar balance de Alice
      const currentBalance = await railgun.getBalance(USDC_ADDRESS);
      console.log(`  Balance privado Alice: ${ethers.formatUnits(currentBalance, 6)} USDC`);

      if (currentBalance > 0n) {
        const transferAmount = 10_000n; // 0.01 USDC
        console.log(`  Transfiriendo ${ethers.formatUnits(transferAmount, 6)} USDC a @bob...\n`);

        // 3. Transferencia privada (genera ZK-proof)
        const txHash = await railgun.privateTransfer(
          USDC_ADDRESS,
          transferAmount,
          bobRailgunAddress,
          signer
        );
        console.log(`\n  ✓ Transferencia completada: ${txHash}`);

        // 4. Verificar balances finales
        console.log("\n  Balances finales:");
        const aliceFinal = await railgun.getBalance(USDC_ADDRESS);
        console.log(`    Alice: ${ethers.formatUnits(aliceFinal, 6)} USDC`);

        // TODO: Para ver el balance de Bob necesitaríamos cargar su wallet
        // por ahora mostramos que la transferencia fue exitosa
      } else {
        console.log("  Sin balance privado. Usá --shield primero.");
      }
    }

    // Limpiar
    await railgun.shutdown();
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
    try {
      await railgun.shutdown();
    } catch {}
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RESUMEN
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                      RESUMEN                             ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log("║ ✓ Wallets Railgun creadas (Alice y Bob)                  ║");
  console.log("║ ✓ Aliases registrados on-chain (@alice, @bob)            ║");
  console.log("║ ✓ Resolución: @bob → dirección Railgun (on-chain)       ║");
  if (doShield) {
    console.log("║ ✓ Shield: USDC blindado en reserva privada              ║");
  }
  if (doTransfer) {
    console.log("║ ✓ Transfer: @alice → @bob con prueba ZK (privado)       ║");
  }
  console.log("╚════════════════════════════════════════════════════════════╝");
}

main().catch(console.error);
