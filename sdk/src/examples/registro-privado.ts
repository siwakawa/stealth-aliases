/**
 * Registro de un alias por la vía privada.
 *
 * La demostración principal registra los aliases directamente desde la billetera
 * del usuario, de modo que su dirección queda en el evento `AliasRegistered`.
 * Este programa recorre la otra vía: envuelve la invocación a `register` en una
 * llamada de Relay Adapt y se la entrega a un retransmisor.
 *
 * El contrato observa entonces como `msg.sender` la dirección del contrato Relay
 * Adapt ---no la del usuario--- y quien firma y publica la transacción es el
 * retransmisor. Ninguna billetera del registrante aparece en la cadena.
 *
 * La dirección que se registra es la de una billetera Railgun propia del alias,
 * sin historia pública. Si apuntara a una dirección ya asociada a otro alias, la
 * resolución la delataría: cualquiera podría consultar ambos aliases y ver que
 * llevan al mismo destino. Ocultar quién registró no sirve de nada si el destino
 * revela al dueño.
 *
 * La comisión del retransmisor la paga otra billetera desde su saldo blindado,
 * dentro de la reserva, de modo que el pago tampoco deja rastro.
 *
 * Uso:
 *   ts-node src/examples/registro-privado.ts [alias]
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";
import { NetworkName } from "@railgun-community/shared-models";

import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";
import { generateStealthMetaAddress } from "../StealthAddress";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC;
const MNEMONIC_A = process.env.MNEMONIC_A; // paga la comisión
const MNEMONIC_INCOGNITO = process.env.MNEMONIC_INCOGNITO; // recibe los pagos del alias
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const MAX_FEE = 200_000n; // 0,2 USDC: tope de comisión aceptado

const DATA_DIR =
  process.env.RAILGUN_DATA_DIR ||
  path.join(require("os").homedir(), ".stealth-aliases");

async function main() {
  const alias = process.argv[2] || "incognito";

  if (!RPC_URL) throw new Error("POLYGON_RPC no configurado en .env");
  if (!MNEMONIC_A) throw new Error("MNEMONIC_A no configurado en .env");
  if (!MNEMONIC_INCOGNITO) throw new Error("MNEMONIC_INCOGNITO no configurado en .env");

  console.log(`\n━━━ Registro privado de @${alias} ━━━\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const registry = new AliasRegistryClient(provider);

  if (await registry.isRegistered(alias)) {
    console.log(`  @${alias} ya está registrado. Elegí otro nombre.`);
    return;
  }

  const railgun = new RailgunService({
    networkName: NetworkName.Polygon,
    rpcUrl: RPC_URL,
    dataDir: DATA_DIR,
    debug: false,
  });

  try {
    await railgun.initialize();

    // Billetera de destino: la que el alias va a resolver.
    const destino = await railgun.getOrCreateWallet(MNEMONIC_INCOGNITO, alias);
    console.log(`  Destino del alias: ${destino.railgunAddress.slice(0, 40)}...`);

    // Comprobar que no coincide con ningún alias ya registrado: si coincidiera,
    // la resolución vincularía ambos aliases y el registro privado sería inútil.
    for (const otro of ["alice", "bob"]) {
      if ((await registry.resolveRailgun(otro)) === destino.railgunAddress) {
        throw new Error(
          `La dirección de destino coincide con la de @${otro}: el alias quedaría vinculado.`
        );
      }
    }
    console.log("  ✓ El destino no coincide con ningún alias registrado\n");

    // Billetera pagadora: carga la sesión y paga la comisión desde su saldo blindado.
    await railgun.getOrCreateWallet(MNEMONIC_A, "alice");

    const spendable = await railgun.getBalance(USDC_ADDRESS, true);
    console.log(`  Saldo gastable: ${ethers.formatUnits(spendable, 6)} USDC\n`);

    // La invocación se prepara igual que en la vía directa; lo único que cambia
    // es por dónde se entrega.
    const keys = generateStealthMetaAddress();
    const preparedCall = await registry.populateRegister(
      alias,
      keys.metaAddress,
      destino.railgunAddress
    );
    console.log(`  Invocación preparada para ${preparedCall.to}`);
    console.log(`  (${(preparedCall.data!.length - 2) / 2} bytes de datos)\n`);

    const hash = await railgun.sendViaRelayAdapt(
      preparedCall,
      USDC_ADDRESS,
      MAX_FEE
    );

    console.log(`\n  ✓ @${alias} registrado: ${hash}`);

    const info = await registry.getAliasInfo(alias);
    console.log(`  Resolución on-chain: ${info.railgunAddress.slice(0, 40)}...`);
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
