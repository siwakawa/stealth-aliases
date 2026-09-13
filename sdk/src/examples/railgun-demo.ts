/**
 * Demo end-to-end: la emisora envía USDC a un alias de forma privada
 *
 * Cada participante usa su propia billetera EVM y su propia billetera Railgun:
 * el receptor registra su alias desde su dirección, no desde la de la emisora.
 * De lo contrario ambos registros saldrían de la misma dirección y un
 * observador podría vincular la transferencia con los dos aliases.
 *
 * Flujo completo:
 * 1. Crear una wallet Railgun para cada participante
 * 2. Registrar ambos aliases en AliasRegistry, cada uno desde su billetera
 * 3. La emisora blinda USDC en la reserva privada de Railgun (shield)
 * 4. La emisora resuelve el alias del receptor → dirección Railgun
 * 5. Transfiere USDC dentro de la reserva (transferencia privada con ZK-proof)
 * 6. El receptor verifica su balance
 *
 * Uso:
 *   ts-node src/examples/railgun-demo.ts                        # solo registro de aliases
 *   ts-node src/examples/railgun-demo.ts --shield                # + blindaje de USDC
 *   ts-node src/examples/railgun-demo.ts --shield --transfer     # flujo completo
 *   ts-node src/examples/railgun-demo.ts --transfer --via privada  # por retransmisor
 *
 * `--via` elige el canal (directa por omisión). Registro y transferencia se
 * delegan en AliasApp, que opera contra el canal sin saber cuál es.
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";

import { AliasApp } from "../AliasApp";
import { AliasRegistryClient } from "../AliasRegistryClient";
import { RailgunService } from "../railgun/RailgunService";
import { createChannel, type Via } from "../SendChannel";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MNEMONIC_A = process.env.MNEMONIC_A;
const MNEMONIC_B = process.env.MNEMONIC_B;
// Segunda billetera EVM: el receptor registra su propio alias desde ella, de modo
// que el registro no quede vinculado a la dirección que paga la transferencia.
const PRIVATE_KEY_B = process.env.PRIVATE_KEY_B;
// Los aliases son inmutables: si ya están tomados hay que usar otros.
const ALIAS_A = process.env.ALIAS_A || "alice";
const ALIAS_B = process.env.ALIAS_B || "bob";

// USDC en Polygon (6 decimales)
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
// Tope de comisión aceptado por la vía privada: 0,2 USDC
const MAX_FEE = 200_000n;

// Directorio para datos persistentes de Railgun
const DATA_DIR =
  process.env.RAILGUN_DATA_DIR ||
  path.join(require("os").homedir(), ".stealth-aliases");

/** Cronometra una operación y reporta cuánto tardó. */
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`  ⏱ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}

/**
 * Espera a que las notas blindadas pasen a estado gastable.
 *
 * Railgun no permite gastar una nota recién blindada hasta que el sistema de
 * Proof of Innocence la valida: el saldo total la incluye, pero el gastable no.
 * Recargar la billetera fuerza un refresco de balances y de pruebas POI.
 */
async function waitForSpendableBalance(
  railgun: RailgunService,
  mnemonic: string,
  label: string,
  token: string,
  minimum: bigint,
  maxMs: number = 900_000
): Promise<bigint> {
  const deadline = Date.now() + maxMs;
  let spendable = await railgun.getBalance(token, true);
  let attempt = 0;
  while (spendable < minimum && Date.now() < deadline) {
    attempt++;
    console.log(
      `  POI pendiente (intento ${attempt}): gastable ${ethers.formatUnits(spendable, 6)}, ` +
        `se necesitan ${ethers.formatUnits(minimum, 6)}. Refrescando...`
    );
    await timed("refresco de balances y pruebas POI", () =>
      railgun.getOrCreateWallet(mnemonic, label)
    );
    spendable = await railgun.getBalance(token, true);
  }
  return spendable;
}

/**
 * Al apagar el motor pueden quedar refrescos de POI en vuelo que encuentran la
 * base de datos ya cerrada. Es una carrera de apagado, no un fallo del flujo:
 * se ignora sólo después de haber iniciado el apagado, y sólo para ese error.
 */
let shuttingDown = false;
process.on("unhandledRejection", (reason: unknown) => {
  const message = String((reason as Error)?.message ?? reason);
  if (shuttingDown && /Database is not open|Failed to refresh POIs/.test(message)) {
    return;
  }
  console.error(`Rechazo no manejado: ${message}`);
  process.exitCode = 1;
});

async function main() {
  const args = process.argv.slice(2);
  const doShield = args.includes("--shield");
  const doTransfer = args.includes("--transfer");
  // --via privada entrega las operaciones a un retransmisor en lugar de emitirlas
  // desde la billetera pública: el gas lo adelanta él y se cobra dentro de la
  // reserva, de modo que la dirección del participante no aparece en la cadena.
  const viaArg = args.includes("--via") ? args[args.indexOf("--via") + 1] : "directa";
  const vias: Record<string, Via> = { directa: "direct", privada: "private" };
  const via = vias[viaArg];
  if (!via) throw new Error(`Vía desconocida: ${viaArg} (directa|privada)`);

  // Resultado real de cada etapa: el resumen final informa lo que ocurrió,
  // no lo que se pidió por línea de comandos.
  let shieldOk = false;
  let transferOk = false;

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log(`  Demo: @${ALIAS_A} envía USDC a @${ALIAS_B} (privado, Railgun)`);
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (!RPC_URL) throw new Error("POLYGON_RPC no configurado en .env");
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY no configurado en .env");
  if (!MNEMONIC_A) throw new Error("MNEMONIC_A no configurado en .env");
  if (!MNEMONIC_B) throw new Error("MNEMONIC_B no configurado en .env");
  if (!PRIVATE_KEY_B) throw new Error("PRIVATE_KEY_B no configurado en .env");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PARTE 1: Setup
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("━━━ PARTE 1: Setup ━━━\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  console.log(`Red: Polygon (chainId: ${network.chainId})`);
  console.log(`Wallet pública de ${ALIAS_A}: ${signer.address}`);

  const registry = new AliasRegistryClient(provider);

  // El receptor usa su propia billetera para registrar su alias. Si ambos
  // registros salieran de la misma dirección, un observador podría vincular la
  // transferencia con los dos aliases desde un explorador de bloques.
  const signerB = new ethers.Wallet(PRIVATE_KEY_B, provider);
  console.log(`Wallet pública de ${ALIAS_B}: ${signerB.address}`);
  console.log(`AliasRegistry: ${registry.getContractAddress()}\n`);

  // Railgun service
  const railgun = new RailgunService({
    networkName: "Polygon",
    rpcUrl: RPC_URL,
    dataDir: DATA_DIR,
    debug: false,
  });

  // Cada participante opera con su propia billetera pública; el canal que se
  // construye depende solo de la vía elegida.
  const appFor = (participantSigner: ethers.Wallet) =>
    new AliasApp(
      registry,
      railgun,
      createChannel(via, { railgun, signer: participantSigner, feeToken: USDC_ADDRESS, maxFee: MAX_FEE })
    );

  try {
    await railgun.initialize();
    console.log("");

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 2: Crear wallets y registrar aliases
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("━━━ PARTE 2: Wallets Railgun + registro de aliases ━━━\n");

    // Wallet Railgun de la emisora
    const walletA = await railgun.getOrCreateWallet(MNEMONIC_A, ALIAS_A);
    console.log(`  ${ALIAS_A} Railgun: ${walletA.railgunAddress.slice(0, 40)}...`);

    // Wallet Railgun del receptor: mnemónico propio, distinto del de la emisora
    const walletB = await railgun.getOrCreateWallet(MNEMONIC_B, ALIAS_B);
    console.log(`  ${ALIAS_B} Railgun: ${walletB.railgunAddress.slice(0, 40)}...\n`);

    // Balance privado inicial del receptor (su wallet es la activa, recién creada).
    // Se guarda para verificar la recepción al final del flujo.
    const initialBalanceB = await railgun.getBalance(USDC_ADDRESS);

    // La emisora registra su alias desde su propia billetera, o lo reutiliza si
    // ya lo hizo: que pague desde la dirección que registró su alias es el
    // comportamiento esperado, y su participación es visible igual porque paga el gas.
    if (!(await registry.isRegistered(ALIAS_A))) {
      console.log(`Registrando @${ALIAS_A} (vía ${viaArg})...`);
      await railgun.getOrCreateWallet(MNEMONIC_A, ALIAS_A);
      const hash = await appFor(signer).registerAlias(ALIAS_A);
      console.log(`  ✓ @${ALIAS_A} registrada (tx: ${hash})`);
    } else {
      const registeredAddressA = await registry.resolveRailgun(ALIAS_A);
      if (registeredAddressA !== walletA.railgunAddress) {
        throw new Error(
          `@${ALIAS_A} ya está tomada y apunta a otra dirección Railgun. ` +
            `Elegí otro alias con ALIAS_A en el .env.`
        );
      }
      console.log(`  @${ALIAS_A} ya registrada, apunta a esta billetera`);
    }

    // El receptor registra el suyo desde SU billetera. Este es el punto del
    // cambio: si ambos registros salieran de la misma dirección, un observador
    // podría vincular la transferencia con los dos aliases.
    if (!(await registry.isRegistered(ALIAS_B))) {
      console.log(`Registrando @${ALIAS_B} (vía ${viaArg})...`);
      await railgun.getOrCreateWallet(MNEMONIC_B, ALIAS_B);
      const hash = await appFor(signerB).registerAlias(ALIAS_B);
      console.log(`  ✓ @${ALIAS_B} registrado (tx: ${hash})`);
    } else {
      const registeredAddressB = await registry.resolveRailgun(ALIAS_B);
      if (registeredAddressB !== walletB.railgunAddress) {
        throw new Error(
          `@${ALIAS_B} ya está tomado y apunta a otra dirección Railgun. ` +
            `Elegí otro alias con ALIAS_B en el .env.`
        );
      }
      console.log(`  @${ALIAS_B} ya registrado, apunta a esta billetera`);
    }

    // Verificar resolución
    console.log("\nVerificando aliases on-chain:");
    const infoA = await registry.getAliasInfo(ALIAS_A);
    console.log(`  @${ALIAS_A} → ${infoA.railgunAddress.slice(0, 30)}...`);
    const infoB = await registry.getAliasInfo(ALIAS_B);
    console.log(`  @${ALIAS_B} → ${infoB.railgunAddress.slice(0, 30)}...`);

    // Balances iniciales
    // Volver a la wallet de la emisora: crear la del receptor la dejó como wallet
    // activa, así que sin este reload el balance de abajo sería el del receptor.
    await railgun.getOrCreateWallet(MNEMONIC_A, ALIAS_A);
    const balanceA = await railgun.getBalance(USDC_ADDRESS);
    console.log(`\n  Balance privado de ${ALIAS_A}: ${ethers.formatUnits(balanceA, 6)} USDC`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 3: Shield (blindaje de USDC)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (doShield) {
      console.log(`\n━━━ PARTE 3: ${ALIAS_A} blinda USDC en Railgun ━━━\n`);

      // Recargar la wallet de la emisora (la del receptor sobreescribió walletInfo)
      await railgun.getOrCreateWallet(MNEMONIC_A, ALIAS_A);

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
        const spendable = await railgun.getBalance(USDC_ADDRESS, true);
        console.log(`  Balance privado de ${ALIAS_A}: ${ethers.formatUnits(newBalance, 6)} USDC`);
        console.log(`  De los cuales gastables: ${ethers.formatUnits(spendable, 6)} USDC`);
        if (spendable < newBalance) {
          console.log(
            "  (la diferencia está pendiente de validación POI; se espera antes de transferir)"
          );
        }
        shieldOk = true;
      } else {
        console.log("  Sin USDC público para blindar.");
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PARTE 4: transferencia privada de la emisora al alias del receptor
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (doTransfer) {
      console.log(`\n━━━ PARTE 4: ${ALIAS_A} envía a @${ALIAS_B} (transferencia privada) ━━━\n`);

      // Asegurar que estamos con la wallet de la emisora
      await railgun.getOrCreateWallet(MNEMONIC_A, ALIAS_A);

      // Sincronización incremental medida por separado: refrescar balances
      // recorre el árbol de Merkle sin tocar las pruebas POI, de modo que el
      // tiempo informado corresponde sólo al escaneo.
      await timed("sincronización incremental del árbol de Merkle", () =>
        railgun.refreshWalletBalances()
      );

      // 1. Resolver el alias del receptor on-chain
      console.log(`  Resolviendo @${ALIAS_B} en el contrato...`);
      const railgunAddressB = await registry.resolveRailgun(ALIAS_B);
      console.log(`  @${ALIAS_B} → ${railgunAddressB.slice(0, 40)}...`);

      // 2. Verificar balance de la emisora. Lo que importa no es el saldo total
      // sino el gastable: una nota recién blindada figura en el total pero no
      // puede gastarse hasta que Proof of Innocence la valida.
      const transferAmount = 10_000n; // 0.01 USDC
      const totalBalance = await railgun.getBalance(USDC_ADDRESS);
      console.log(`  Balance privado de ${ALIAS_A}: ${ethers.formatUnits(totalBalance, 6)} USDC (total)`);

      // Con retransmisor la comisión sale del mismo saldo blindado, así que se
      // espera un margen por encima del monto. El servicio verifica el importe
      // exacto una vez que conoce la cotización.
      const minimoRequerido = via === "private" ? transferAmount * 10n : transferAmount;
      const currentBalance = await waitForSpendableBalance(
        railgun,
        MNEMONIC_A,
        ALIAS_A,
        USDC_ADDRESS,
        minimoRequerido
      );
      console.log(`  Gastable: ${ethers.formatUnits(currentBalance, 6)} USDC`);

      if (currentBalance >= minimoRequerido) {
        console.log(`  Transfiriendo ${ethers.formatUnits(transferAmount, 6)} USDC a @${ALIAS_B}...\n`);

        // 3. Transferencia privada (genera ZK-proof), por el canal elegido
        const txHash = await timed(`transferencia completa (vía ${viaArg})`, () =>
          appFor(signer).sendToAlias(ALIAS_B, USDC_ADDRESS, transferAmount)
        );
        console.log(`\n  ✓ Transferencia completada: ${txHash}`);
        transferOk = true;

        // 4. Verificar balances finales
        console.log("\n  Balances finales:");
        // Reescanear antes de leer: sin esto el saldo informado es el anterior
        // a la transferencia, porque la nota de vuelto todavía no se detectó.
        await railgun.refreshWalletBalances();
        const finalA = await railgun.getBalance(USDC_ADDRESS);
        console.log(`    ${ALIAS_A}: ${ethers.formatUnits(finalA, 6)} USDC`);

        // 5. El receptor verifica su balance: cargar su wallet y confirmar la recepción
        console.log(`\n  Verificando recepción en la wallet de ${ALIAS_B}...`);
        await railgun.getOrCreateWallet(MNEMONIC_B, ALIAS_B); // recarga + refreshBalances
        const finalB = await railgun.getBalance(USDC_ADDRESS);
        const deltaB = finalB - initialBalanceB;
        console.log(
          `    ${ALIAS_B}: ${ethers.formatUnits(finalB, 6)} USDC (recibió +${ethers.formatUnits(deltaB, 6)})`
        );
        if (deltaB >= transferAmount) {
          console.log(`    ✓ ${ALIAS_B} recibió la transferencia privada`);
        } else {
          console.log(
            `    ⚠ La nota (UTXO) de ${ALIAS_B} puede seguir en scan/POI-pending; reintentá más tarde`
          );
        }
      } else {
        console.log(
          "  Saldo spendable insuficiente. Si recién blindaste, la nota sigue " +
            "pendiente de validación POI: reintentá más tarde con --transfer."
        );
      }
    }

    // Limpiar
    shuttingDown = true;
    await railgun.shutdown();
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
    try {
      shuttingDown = true;
      await railgun.shutdown();
    } catch {}
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RESUMEN
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                      RESUMEN                             ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`  ✓ Wallets Railgun creadas (@${ALIAS_A} y @${ALIAS_B})`);
  console.log(`  ✓ Aliases registrados on-chain, cada uno desde su billetera EVM`);
  console.log(`  ✓ Resolución: @${ALIAS_B} → dirección Railgun (on-chain)`);
  if (doShield) {
    console.log(
      shieldOk
        ? "  ✓ Shield: USDC blindado en reserva privada"
        : "  ✗ Shield: no se completó"
    );
  }
  if (doTransfer) {
    console.log(
      transferOk
        ? `  ✓ Transfer: @${ALIAS_A} → @${ALIAS_B} con prueba ZK (privado)`
        : `  ✗ Transfer: no se completó`
    );
  }
  console.log("╚════════════════════════════════════════════════════════════╝");
}

// La red de retransmisores deja descriptores abiertos que sobreviven a su
// cierre, de modo que el proceso no termina por sí solo. Se sale explícitamente
// una vez completado el flujo.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
