/**
 * Ciclo completo de un alias registrado por la vía privada: recibir y enviar.
 *
 * 1. La emisora envía fondos a @incognito por dentro de la reserva.
 * 2. @incognito los envía a @bob.
 *
 * Ambas transferencias salen por retransmisor, de modo que ninguna billetera
 * pública firma nada. Combinado con un registro publicado por Relay Adapt, el
 * alias recibe y envía sin que su dueño aparezca en la cadena en ningún momento.
 *
 * Uso:
 *   ts-node src/examples/ciclo-incognito.ts
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";
import { NetworkName } from "@railgun-community/shared-models";
import { refreshReceivePOIsForWallet } from "@railgun-community/wallet";

import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC;
const MNEMONIC_A = process.env.MNEMONIC_A;
const MNEMONIC_INCOGNITO = process.env.MNEMONIC_INCOGNITO;
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const MAX_FEE = 200_000n;
const DATA_DIR =
  process.env.RAILGUN_DATA_DIR ||
  path.join(require("os").homedir(), ".stealth-aliases");

async function main() {
  if (!RPC_URL || !MNEMONIC_A || !MNEMONIC_INCOGNITO) {
    throw new Error("Faltan POLYGON_RPC, MNEMONIC_A o MNEMONIC_INCOGNITO en .env");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new AliasRegistryClient(provider);
  const railgun = new RailgunService({
    networkName: NetworkName.Polygon,
    rpcUrl: RPC_URL,
    dataDir: DATA_DIR,
    debug: false,
  });

  const hashes: string[] = [];

  try {
    await railgun.initialize();

    // ── 1. La emisora le envía a @incognito ──────────────────────────────
    console.log("\n━━━ 1. alice envía a @incognito ━━━\n");
    await railgun.getOrCreateWallet(MNEMONIC_A, "alice");
    const destinoIncognito = await registry.resolveRailgun("incognito");
    console.log(`  @incognito → ${destinoIncognito.slice(0, 40)}...`);
    hashes.push(
      await railgun.privateTransferViaBroadcaster(USDC, 200_000n, destinoIncognito, MAX_FEE)
    );

    // ── 2. @incognito le envía a @bob ────────────────────────────────────
    console.log("\n━━━ 2. @incognito envía a @bob ━━━\n");
    const wallet = await railgun.getOrCreateWallet(MNEMONIC_INCOGNITO, "incognito");

    // La nota recibida hereda la validación de las notas que la originaron; basta
    // con consultar su estado para que el cliente la reconozca como gastable.
    await refreshReceivePOIsForWallet(railgun.getTxidVersion(), NetworkName.Polygon, wallet.id);
    await railgun.refreshWalletBalances();

    const spendable = await railgun.getBalance(USDC, true);
    console.log(`  Saldo gastable de @incognito: ${ethers.formatUnits(spendable, 6)} USDC`);

    const destinoBob = await registry.resolveRailgun("bob");
    hashes.push(
      await railgun.privateTransferViaBroadcaster(USDC, 10_000n, destinoBob, MAX_FEE)
    );

    console.log("\n━━━ Ciclo completo ━━━");
    console.log(`  alice → @incognito : ${hashes[0]}`);
    console.log(`  @incognito → @bob  : ${hashes[1]}`);
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
