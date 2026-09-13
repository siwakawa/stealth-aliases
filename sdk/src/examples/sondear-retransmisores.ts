/**
 * Sondeo de retransmisores disponibles para Polygon.
 *
 * Antes de construir sobre esta dependencia conviene comprobar que existe: los
 * retransmisores son nodos independientes que se anuncian por una red Waku, y
 * su disponibilidad no está garantizada. El precedente es el agregador de
 * Pruebas de Inocencia, cuya desaparición dejó fondos inmovilizados.
 *
 * No envía ninguna transacción ni gasta gas: solo se conecta, escucha y lista.
 * Así se midió la oferta en Polygon: un único retransmisor para USDC nativo
 * frente a más de diez para USDC.e.
 *
 * Uso:
 *   ts-node src/examples/sondear-retransmisores.ts
 *
 * Nota sobre módulos: el paquete es ESM puro y el SDK compila a CommonJS. Node
 * >= 22.12 resuelve el `require()` de un grafo ESM sin await de nivel superior,
 * que es el caso de este paquete; se verificó que compila y corre bajo la
 * configuración `"module": "commonjs"` del proyecto.
 */

import { config } from "dotenv";
import * as path from "path";
import {
  NetworkName,
  ChainType,
  BroadcasterConnectionStatus,
  type Chain,
  type SelectedBroadcaster,
} from "@railgun-community/shared-models";
import { WakuBroadcasterClient } from "@railgun-community/waku-broadcaster-client-node";

config({ path: path.join(__dirname, "../../../contracts/.env") });

// USDC nativo de Polygon. Ojo: no es el mismo token que USDC.e (puenteado,
// 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174), que es el que la mayoría de los
// retransmisores cotiza.
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const CHAIN: Chain = { type: ChainType.EVM, id: 137 };
const ESPERA_MS = 90_000;

async function main() {
  console.log("Conectando a la red Waku para descubrir retransmisores...\n");

  const t0 = Date.now();
  const seg = () => ((Date.now() - t0) / 1000).toFixed(0);

  let estado: BroadcasterConnectionStatus | undefined;

  await WakuBroadcasterClient.start(
    CHAIN,
    {
      // El campo es obligatorio en el tipo pero no hay un valor canónico. Una
      // cadena vacía es falsy y desactiva el filtro por firmante de confianza:
      // se aceptan las cotizaciones de todos los retransmisores. Es lo que
      // hacen las propias pruebas del paquete. Fijar aquí una dirección 0zk
      // restringe la búsqueda a ese firmante y a quienes coticen dentro de su
      // banda de variación, y para el USDC nativo eso deja cero resultados.
      trustedFeeSigner: "",
    },
    // La firma es (chain, status), no (status). El status es un enum numérico.
    (_chain: Chain, nuevo: BroadcasterConnectionStatus) => {
      if (nuevo !== estado) {
        estado = nuevo;
        console.log(
          `  [${seg()} s] estado: ${BroadcasterConnectionStatus[nuevo]}`
        );
      }
    }
  );

  // El descubrimiento es asincrónico: los retransmisores se anuncian por la red
  // y hay que darles tiempo a aparecer.
  const hasta = Date.now() + ESPERA_MS;
  let mejor: SelectedBroadcaster | undefined;

  while (Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, 10_000));

    const todos: SelectedBroadcaster[] =
      WakuBroadcasterClient.findAllBroadcastersForChain(CHAIN, false) ?? [];
    const paraUSDC: SelectedBroadcaster[] =
      WakuBroadcasterClient.findBroadcastersForToken(CHAIN, USDC, false) ?? [];
    mejor = WakuBroadcasterClient.findBestBroadcaster(CHAIN, USDC, false);

    console.log(
      `  [${seg()} s] conexiones: ${await WakuBroadcasterClient.getLightPushPeerCount()}` +
        ` | cotizaciones (todos los tokens): ${todos.length}` +
        ` | direcciones distintas: ${new Set(todos.map((b) => b.railgunAddress)).size}` +
        ` | que aceptan USDC: ${paraUSDC.length}`
    );

    if (mejor) {
      const expiraEn = ((mejor.tokenFee.expiration - Date.now()) / 1000).toFixed(0);
      console.log("\n  Mejor retransmisor para USDC:");
      console.log(`      dirección Railgun : ${mejor.railgunAddress}`);
      console.log(`      comisión/gas      : ${BigInt(mejor.tokenFee.feePerUnitGas)}`);
      console.log(`      feesID            : ${mejor.tokenFee.feesID}`);
      console.log(`      billeteras libres : ${mejor.tokenFee.availableWallets}`);
      console.log(`      fiabilidad        : ${mejor.tokenFee.reliability}`);
      console.log(`      cotización expira : en ${expiraEn} s`);
      break;
    }
  }

  if (!mejor) {
    console.log(
      "\n  No apareció ningún retransmisor para USDC en Polygon dentro de la ventana."
    );
    console.log(
      "    Sin retransmisor disponible, la transferencia debe emitirse desde la"
    );
    console.log("    billetera pública, que es lo que hace la demostración actual.");
  }

  await WakuBroadcasterClient.stop();
}

// NetworkName se importa para dejar explícito que CHAIN corresponde a
// NETWORK_CONFIG[NetworkName.Polygon].chain.
void NetworkName;

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
