/**
 * Línea de comandos del sistema de aliases.
 *
 * El usuario elige la vía con `--via`. El programa construye el canal que le
 * corresponde y se lo entrega a `AliasApp`, que registra y envía sin saber cuál
 * recibió: la elección se toma en un único lugar, `createChannel`.
 *
 * Uso:
 *   npm run alias -- register <alias>          --wallet <nombre> --via direct|private
 *   npm run alias -- send <alias> <amount>     --wallet <nombre> --via direct|private
 *   npm run alias -- shield <amount>           --wallet <nombre>
 *   npm run alias -- balance                   --wallet <nombre>
 *   npm run alias -- verify-meta <alias>       --wallet <nombre>
 *
 * Billeteras, definidas en contracts/.env:
 *   alice      MNEMONIC_A y PRIVATE_KEY
 *   bob        MNEMONIC_B y PRIVATE_KEY_B
 *   incognito  MNEMONIC_INCOGNITO, sin billetera pública: solo opera por la vía privada
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as os from "os";
import * as path from "path";

import { AliasApp } from "./AliasApp";
import { AliasRegistryClient } from "./AliasRegistryClient";
import { RailgunService } from "./railgun/RailgunService";
import { createChannel, type Via } from "./SendChannel";

config({ path: path.join(__dirname, "../../contracts/.env") });

// USDC nativo de Polygon (6 decimales)
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
// Tope de comisión aceptado por la vía privada: 0,2 USDC
const MAX_FEE = 200_000n;
const DATA_DIR = process.env.RAILGUN_DATA_DIR || path.join(os.homedir(), ".stealth-aliases");

const WALLETS: Record<string, { mnemonic: string; privateKey?: string }> = {
  alice: { mnemonic: "MNEMONIC_A", privateKey: "PRIVATE_KEY" },
  bob: { mnemonic: "MNEMONIC_B", privateKey: "PRIVATE_KEY_B" },
  incognito: { mnemonic: "MNEMONIC_INCOGNITO" },
};

const VIAS: Via[] = ["direct", "private"];

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

let shuttingDown = false;
process.on("unhandledRejection", (reason: unknown) => {
  const message = String((reason as Error)?.message ?? reason);
  // Refrescos de POI en vuelo que encuentran la base ya cerrada al apagar.
  if (shuttingDown && /Database is not open|Failed to refresh POIs/.test(message)) return;
  console.error(`Rechazo no manejado: ${message}`);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rpcUrl = required(process.env.POLYGON_RPC, "POLYGON_RPC no configurado en .env");

  const walletName = required(option(args, "wallet"), "Falta --wallet <alice|bob|incognito>");
  const profile = WALLETS[walletName];
  if (!profile) throw new Error(`Billetera desconocida: ${walletName}`);
  const mnemonic = required(process.env[profile.mnemonic], `${profile.mnemonic} no configurado en .env`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const privateKey = profile.privateKey ? process.env[profile.privateKey] : undefined;
  const signer = privateKey ? new ethers.Wallet(privateKey, provider) : undefined;

  const railgun = new RailgunService({ networkName: "Polygon", rpcUrl, dataDir: DATA_DIR });

  try {
    await railgun.initialize();
    await railgun.getOrCreateWallet(mnemonic);

    switch (command) {
      case "register":
      case "send": {
        const via = required(option(args, "via"), "Falta --via <direct|private>") as Via;
        if (!VIAS.includes(via)) throw new Error(`Vía desconocida: ${via} (direct|private)`);

        const channel = createChannel(via, { railgun, signer, feeToken: USDC, maxFee: MAX_FEE });
        const app = new AliasApp(new AliasRegistryClient(provider), railgun, channel, mnemonic);

        const t0 = Date.now();
        const hash =
          command === "register"
            ? await app.registerAlias(required(args[1], "Falta el alias"))
            : await app.sendToAlias(
                required(args[1], "Falta el alias"),
                USDC,
                ethers.parseUnits(required(args[2], "Falta el monto"), 6)
              );
        console.log(`\n✓ ${command === "register" ? "Registrado" : "Enviado"} por la vía ${via}: ${hash}`);
        console.log(`  ⏱ ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        break;
      }

      case "shield": {
        // El blindaje es público por naturaleza: no hay vía que elegir.
        if (!signer) throw new Error(`La billetera ${walletName} no tiene billetera pública para blindar.`);
        const amount = ethers.parseUnits(required(args[1], "Falta el monto"), 6);
        console.log(`\n✓ Blindado: ${await railgun.shieldTokens(USDC, amount, signer)}`);
        break;
      }

      case "verify-meta": {
        // No requiere canal: solo lee el registro y deriva las claves localmente.
        const alias = required(args[1], "Falta el alias");
        const app = new AliasApp(new AliasRegistryClient(provider), railgun, createChannel("private", { railgun, feeToken: USDC }), mnemonic);
        const owns = await app.ownsStealthMetaAddress(alias);
        console.log(`\n  @${alias}: ${owns ? "la metadirección registrada se deriva de esta frase" : "la metadirección registrada NO se deriva de esta frase"}`);
        break;
      }

      case "balance": {
        await railgun.refreshWalletBalances();
        const total = await railgun.getBalance(USDC);
        const spendable = await railgun.getBalance(USDC, true);
        console.log(`\n  ${walletName}: ${ethers.formatUnits(total, 6)} USDC (${ethers.formatUnits(spendable, 6)} gastables)`);
        break;
      }

      default:
        throw new Error("Comandos: register, send, shield, balance, verify-meta");
    }
  } finally {
    shuttingDown = true;
    await railgun.shutdown();
  }
}

// La red de retransmisores deja descriptores abiertos que sostienen el proceso.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  });
