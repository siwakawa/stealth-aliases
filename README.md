# Stealth Aliases

Sistema de aliases legibles (@bob) para transacciones privadas sobre Railgun.

## Descripción

Este proyecto permite registrar aliases humanos que resuelven a stealth meta-addresses, habilitando pagos privados donde:
- El remitente solo conoce el alias (no la dirección real)
- Cada pago usa una dirección única (unlinkable)
- Solo el receptor puede detectar y gastar los fondos

## Arquitectura

```
┌─────────────┐     resolve(@bob)     ┌──────────────────┐
│   Alice     │ ───────────────────►  │  AliasRegistry   │
│  (sender)   │                       │    (on-chain)    │
└─────────────┘                       └────────┬─────────┘
       │                                       │
       │                              stealth meta-address
       │                                       │
       ▼                                       ▼
┌─────────────┐  generate stealth    ┌──────────────────┐
│    SDK      │ ◄─────────────────── │   66 bytes:      │
│             │      address         │  spending (33) + │
└─────────────┘                      │  viewing (33)    │
       │                             └──────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│                    Railgun Protocol                      │
│            (private transfer with ZK proofs)            │
└─────────────────────────────────────────────────────────┘
```

## Contratos Desplegados

| Contrato | Red | Dirección | Estado |
|----------|-----|-----------|--------|
| `AliasRegistry` | Polygon Mainnet | `0x3957987D2Fb35d4ca17D4Fcba29E576Fb586Fa9B` | **En uso** (bloque 93.745.539) |

Verificado en [Polygonscan](https://polygonscan.com/address/0x3957987D2Fb35d4ca17D4Fcba29E576Fb586Fa9B) y en Sourcify,
con coincidencia exacta de runtime y de creación.

Cada alias guarda dos datos de recepción: la metadirección sigilosa ERC-5564 ---clave de gasto en los primeros
33 bytes y clave de visualización en los 33 siguientes, según fija el estándar--- y la dirección Railgun del
receptor, que es la que enruta efectivamente la transferencia privada.

Las claves sigilosas de cada alias se derivan de la frase de recuperación (rutas endurecidas
`m/5564'/<índice del alias>'/{0',1'}`, con el índice tomado de `keccak256` del alias
normalizado), así que se reconstruyen sin guardar nada. La derivación de direcciones coincide con
la implementación de referencia de ERC-5564 (`@scopelift/stealth-address-sdk`), contra cuyos
vectores se prueba (`contracts/test/fixtures/erc5564-vectors.json`).

## Estructura

```
├── contracts/          # Smart contracts (Hardhat)
│   ├── src/
│   │   └── AliasRegistry.sol
│   ├── test/
│   └── scripts/
│
└── sdk/               # TypeScript SDK
    └── src/
        ├── AliasRegistryClient.ts
        ├── StealthAddress.ts
        └── examples/
```

## Quick Start

### Contracts

```bash
cd contracts
npm install
npm test              # Run tests
npm run compile       # Compile
```

### SDK

```bash
cd sdk
npm install
npm test              # Run demo
```

## Uso del SDK

```typescript
import { AliasApp, AliasRegistryClient, RailgunService, createChannel } from "@tesina/alias-sdk";

const railgun = new RailgunService({ networkName: "Polygon", rpcUrl, dataDir });
await railgun.initialize();
await railgun.getOrCreateWallet(mnemonic, "alice");

// La vía se elige una sola vez: "direct" firma con la billetera pública,
// "private" entrega las operaciones a un retransmisor.
const channel = createChannel(via, { railgun, signer, feeToken: USDC, maxFee });
const app = new AliasApp(new AliasRegistryClient(provider), railgun, channel);

await app.registerAlias("carol");
await app.sendToAlias("bob", USDC, 10_000n);
```

El diseño aplica dos patrones de Gamma et al.:

- **Estrategia.** `SendChannel` es la interfaz (`send` para invocaciones preparadas,
  `transfer` para transferencias); `DirectChannel` y `PrivateChannel`, sus realizaciones.
  `AliasApp` es el contexto: registra y envía sin saber qué canal recibió. `createChannel`
  es el único punto donde se elige, a partir de la vía que indica el usuario.
- **Fachada.** `RailgunService` es el único módulo que importa el SDK de Railgun; ni los
  canales ni los programas nombran tipos del protocolo.

## Demostración (línea de comandos)

Todo corre desde la terminal sobre Polygon mainnet, con fondos reales.

### Requisitos

Variables en `contracts/.env` (ver `contracts/.env.example`). Nada de esto va en el código.

| Variable | Uso |
|----------|-----|
| `POLYGON_RPC` | RPC de Polygon |
| `POI_NODE_URLS` | Agregadores de Pruebas de Inocencia, separados por coma |
| `PRIVATE_KEY` | Billetera pública de Alice: registra `@alice` y blinda |
| `PRIVATE_KEY_B` | Billetera pública de Bob: registra `@bob` |
| `MNEMONIC_A` | Billetera Railgun de Alice |
| `MNEMONIC_B` | Billetera Railgun de Bob |
| `MNEMONIC_INCOGNITO` | Billetera Railgun de `@incognito`, sin historia pública |

La vía directa necesita POL para el gas. La vía por retransmisor no: paga una comisión
en USDC desde el saldo blindado.

### Ejecución

```bash
cd sdk && npm install

# Operaciones sueltas: el usuario elige la billetera y la vía
npm run alias -- register <alias>       --wallet alice --via direct|private
npm run alias -- send bob 0.01          --wallet alice --via direct|private
npm run alias -- shield 0.1             --wallet alice
npm run alias -- balance                --wallet bob
npm run alias -- verify-meta alice      --wallet alice

# Recorrido completo @alice → @bob, con verificación de la recepción
npm run demo:railgun                                    # registra @alice y @bob
npm run demo:railgun -- --shield --transfer             # + blinda y transfiere
npm run demo:railgun -- --transfer --via private        # la transferencia sale por retransmisor

npx ts-node src/examples/verificar-enlazabilidad.ts     # quién registró cada alias
npx ts-node src/examples/medir-sigilosas.ts             # tiempos de direcciones sigilosas
npx ts-node src/diagnostico/sondear-retransmisores.ts   # oferta de retransmisores en Polygon
```

Las billeteras `alice` y `bob` tienen contraparte pública; `incognito` no, de modo que
solo opera por la vía privada. `register` rechaza un alias nuevo sobre una billetera que
ya recibe los pagos de otro, porque resolver ambos bastaría para vincularlos.

> La primera corrida descarga los artefactos ZK y sincroniza el árbol de Merkle (minutos).
> Los fondos recién blindados no son gastables durante una hora; los recibidos por
> transferencia privada se habilitan entre segundos y un par de minutos después.

### Corridas confirmadas on-chain

Todas sobre el contrato `0x3957987D2Fb35d4ca17D4Fcba29E576Fb586Fa9B`.

Vía directa (cada participante con su propia billetera pública):

| Operación | Bloque | Hash | Gas |
|-----------|--------|------|-----|
| Registro `@alice` | 93.745.585 | `0x10ba9beea6354ac52c2888a80fdae93b56226cc3d3be2ffab092464756d25927` | 249.167 |
| Registro `@bob` | 93.745.593 | `0xeb1d778c9046f2a4b5ffcee8d1b39d3e7b2a1859a63ca034fffc7ccfdfa5ccaf` | 248.375 |
| Blindaje (demo) | 93.746.765 | `0xda796ad6025c6be4b77816e492017bf973647c5fefff1eea72a6ab8abdd8d244` | 848.434 |
| Transferencia `@alice` → `@bob` (demo) | 93.746.781 | `0xbf0f9d41174e29ac3e4eb7b99e60921b1491fa2e1b6747cb0092b578d8fe21c5` | 1.387.531 |
| Transferencia `@bob` → `@alice` (`--via direct`) | 93.746.817 | `0x510169f4002dd2bfbe24d494c8a72467b6165eae3dcf02c4628b5baf142f94af` | 1.365.881 |

Vía privada (firma el retransmisor; ninguna billetera de los participantes aparece):

| Operación | Bloque | Hash | Comisión |
|-----------|--------|------|----------|
| Registro `@incognito` (Relay Adapt) | 93.745.618 | `0xa90b408e01dd2516ecaab5c25fffac51b015b126a1ace79d945d0ddd0ada16f1` | 0,121 USDC |
| Transferencia `@alice` → `@bob` (`--via private`) | 93.746.860 | `0xc418212125abbaf9006b2d73677ca4b557bd1e1db5aa46b541b65192ece85f0b` | 0,056 USDC |
| Transferencia `@alice` → `@incognito` | 93.746.892 | `0x6f840666e89092b71455070d2aa45e199ce82e730af79728e969d991112688b8` | 0,058 USDC |
| Transferencia `@incognito` → `@bob` | 93.746.938 | `0xe1317e879e5be13fbfb5b011d0d74a15b01ff09e29a5a02e228000e77f2b32c9` | 0,059 USDC |

`npm run alias -- verify-meta <alias> --wallet <nombre>` confirma que la metadirección registrada
se deriva de la frase de recuperación; las tres coinciden, y con la frase de otro participante no.

En el registro de `@incognito`, el campo `registrant` del evento es el contrato Relay
Adapt (`0xF82d00fC51F730F42A00F85E74895a2849ffF2Dd`) y el firmante es el retransmisor. Lo
único que sigue siendo público es el blindaje: expone a quien deposita. El diagnóstico
completo está en [`DEMO_ENLAZABILIDAD.md`](./DEMO_ENLAZABILIDAD.md).

## Estándares

- [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Addresses
- [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) - Stealth Meta-Address Registry

## Licencia

MIT
