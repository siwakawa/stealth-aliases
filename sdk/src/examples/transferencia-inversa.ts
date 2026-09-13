/**
 * Transferencia privada en sentido inverso: del receptor a la emisora.
 *
 * La demostración principal recorre el flujo de @alice a @bob. Este programa
 * ejerce el camino contrario para comprobar que la resolución por alias y la
 * transferencia funcionan en ambas direcciones, y para reunir más de una
 * medición de cada operación.
 *
 * Uso:
 *   ts-node src/examples/transferencia-inversa.ts             # vía billetera pública
 *   ts-node src/examples/transferencia-inversa.ts --broadcaster
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";
import { NetworkName } from "@railgun-community/shared-models";

import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC;
const PRIVATE_KEY_B = process.env.PRIVATE_KEY_B;
const MNEMONIC_B = process.env.MNEMONIC_B;
const ALIAS_A = process.env.ALIAS_A || "alice";
const ALIAS_B = process.env.ALIAS_B || "bob";

const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const DATA_DIR =
  process.env.RAILGUN_DATA_DIR ||
  path.join(require("os").homedir(), ".stealth-aliases");

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`  ⏱ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}

async function main() {
  const viaBroadcaster = process.argv.slice(2).includes("--broadcaster");

  if (!RPC_URL) throw new Error("POLYGON_RPC no configurado en .env");
  if (!PRIVATE_KEY_B) throw new Error("PRIVATE_KEY_B no configurado en .env");
  if (!MNEMONIC_B) throw new Error("MNEMONIC_B no configurado en .env");

  console.log(
    `\n━━━ ${ALIAS_B} envía a @${ALIAS_A}` +
      `${viaBroadcaster ? " (vía retransmisor)" : " (billetera pública)"} ━━━\n`
  );

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signerB = new ethers.Wallet(PRIVATE_KEY_B, provider);
  const registry = new AliasRegistryClient(provider);

  const railgun = new RailgunService({
    networkName: NetworkName.Polygon,
    rpcUrl: RPC_URL,
    dataDir: DATA_DIR,
    debug: false,
  });

  try {
    await railgun.initialize();
    await railgun.getOrCreateWallet(MNEMONIC_B, ALIAS_B);

    const total = await railgun.getBalance(USDC_ADDRESS);
    const spendable = await railgun.getBalance(USDC_ADDRESS, true);
    console.log(`  Saldo de ${ALIAS_B}: ${ethers.formatUnits(total, 6)} USDC`);
    console.log(`  Gastable: ${ethers.formatUnits(spendable, 6)} USDC\n`);

    const amount = 5_000n; // 0.005 USDC
    if (spendable < amount) {
      console.log(
        `  Saldo gastable insuficiente. Las notas recibidas pueden seguir ` +
          `pendientes de validación POI; reintentá más tarde.`
      );
      return;
    }

    const destino = await registry.resolveRailgun(ALIAS_A);
    console.log(`  @${ALIAS_A} → ${destino.slice(0, 40)}...`);
    console.log(`  Transfiriendo ${ethers.formatUnits(amount, 6)} USDC...\n`);

    const hash = await timed(
      viaBroadcaster ? "transferencia vía retransmisor" : "transferencia completa",
      () =>
        viaBroadcaster
          ? railgun.privateTransferViaBroadcaster(USDC_ADDRESS, amount, destino)
          : railgun.privateTransfer(USDC_ADDRESS, amount, destino, signerB)
    );

    console.log(`\n  ✓ Transferencia completada: ${hash}`);
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
  } finally {
    await railgun.shutdown();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
