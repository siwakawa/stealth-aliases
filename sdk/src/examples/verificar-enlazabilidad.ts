/**
 * Verifica, leyendo únicamente la cadena, que los dos aliases de la demostración
 * fueron registrados desde direcciones EVM distintas y apuntan a direcciones
 * Railgun distintas.
 *
 * Es la evidencia de que la transferencia privada no es vinculable a ambos
 * aliases mediante una consulta a un explorador de bloques. Ver
 * DEMO_ENLAZABILIDAD.md en la raíz del repositorio.
 *
 * Uso:
 *   ts-node src/examples/verificar-enlazabilidad.ts
 */

import { ethers } from "ethers";
import { config } from "dotenv";
import * as path from "path";

config({ path: path.join(__dirname, "../../../contracts/.env") });

const RPC_URL = process.env.POLYGON_RPC;
const REGISTRY = "0x3957987D2Fb35d4ca17D4Fcba29E576Fb586Fa9B";
const ALIAS_A = process.env.ALIAS_A || "alice";
const ALIAS_B = process.env.ALIAS_B || "bob";

// El contrato se desplegó después de este bloque; acota el rango de logs para
// no pedirle al RPC un barrido de toda la historia de la red.
const DESDE = 93_745_500;

const ABI = [
  "event AliasRegistered(bytes32 indexed aliasHash, string alias_, bytes stealthMetaAddress, string railgunAddress, address indexed registrant)",
  "function resolveRailgun(string) view returns (string)",
];

interface Registro {
  registrant: string;
  bloque: number;
  tx: string;
  railgun: string;
}

async function main() {
  if (!RPC_URL) throw new Error("POLYGON_RPC no configurado en .env");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contrato = new ethers.Contract(REGISTRY, ABI, provider);

  const registros: Record<string, Registro> = {};

  for (const alias of [ALIAS_A, ALIAS_B]) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(alias));
    const logs = await contrato.queryFilter(
      contrato.filters.AliasRegistered(hash),
      DESDE,
      "latest"
    );

    if (logs.length === 0) {
      console.log(`@${alias}: sin evento de registro`);
      continue;
    }

    const log = logs[logs.length - 1] as ethers.EventLog;
    registros[alias] = {
      registrant: log.args.registrant,
      bloque: log.blockNumber,
      tx: log.transactionHash,
      railgun: await contrato.resolveRailgun(alias),
    };

    const r = registros[alias];
    console.log(`@${alias}`);
    console.log(`  registrado por : ${r.registrant}`);
    console.log(`  bloque         : ${r.bloque}`);
    console.log(`  transacción    : ${r.tx}`);
    console.log(
      `  railgun        : ${r.railgun.slice(0, 30)}... (${r.railgun.length} caracteres)`
    );
  }

  const a = registros[ALIAS_A];
  const b = registros[ALIAS_B];
  if (!a || !b) {
    console.log("\nFaltan registros: no se puede emitir veredicto.");
    return;
  }

  const mismoRegistrante =
    a.registrant.toLowerCase() === b.registrant.toLowerCase();
  const mismaRailgun = a.railgun === b.railgun;

  console.log("\n--- veredicto ---");
  console.log(
    mismoRegistrante
      ? "✗ Mismo registrante: la transferencia sigue siendo vinculable a ambos aliases"
      : "✓ Registrantes distintos"
  );
  console.log(
    mismaRailgun
      ? "✗ Misma dirección Railgun en ambos aliases"
      : "✓ Direcciones Railgun distintas"
  );

  if (mismoRegistrante || mismaRailgun) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
