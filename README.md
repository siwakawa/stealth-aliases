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
| `AliasRegistry` | Polygon Mainnet | `0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d` | **En uso** |

Verificado en [Polygonscan](https://polygonscan.com/address/0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d) y en Sourcify,
con coincidencia exacta de runtime y de creación.

Cada alias guarda dos datos de recepción: la metadirección sigilosa ERC-5564 ---clave de gasto en los primeros
33 bytes y clave de visualización en los 33 siguientes, según fija el estándar--- y la dirección Railgun del
receptor, que es la que enruta efectivamente la transferencia privada.

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
import {
  AliasRegistryClient,
  DirectChannel,
  RelayAdaptChannel,
  RailgunService,
  generateStealthMetaAddress,
} from "@tesina/alias-sdk";

const registry = new AliasRegistryClient(provider);

// Resolver un alias a la dirección Railgun que recibe los pagos
const destino = await registry.resolveRailgun("bob");

// Registrar: la invocación se prepara una sola vez...
const keys = generateStealthMetaAddress();
const call = await registry.populateRegister("carol", keys.metaAddress, railgunAddress);

// ...y se entrega por el canal elegido.
await new DirectChannel(signer).send(call);                  // expone al registrante
await new RelayAdaptChannel(railgun, USDC, maxFee).send(call); // no lo expone
```

`SendChannel` es la interfaz común (patrón estrategia). La fuente de pago se fija al
construir cada canal: una billetera pública en la vía directa, el token de la comisión
del retransmisor en la privada.

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

npm run demo:railgun                                    # registra @alice y @bob
npm run demo:railgun -- --shield                        # + blinda USDC
npm run demo:railgun -- --shield --transfer             # + transfiere @alice → @bob
npm run demo:railgun -- --transfer --broadcaster        # la transferencia sale por retransmisor

npx ts-node src/examples/transferencia-inversa.ts [--broadcaster]   # @bob → @alice
npx ts-node src/examples/registro-privado.ts [alias]                # registro por Relay Adapt
npx ts-node src/examples/ciclo-incognito.ts                         # @alice → @incognito → @bob
npx ts-node src/examples/verificar-enlazabilidad.ts                 # quién registró cada alias
```

> La primera corrida descarga los artefactos ZK y sincroniza el árbol de Merkle (minutos).
> Los fondos recién blindados no son gastables durante una hora; los recibidos por
> transferencia privada, sí.

### Corridas confirmadas on-chain

Vía directa (cada participante con su propia billetera pública):

| Operación | Bloque | Hash |
|-----------|--------|------|
| Registro `@alice` | 93.699.091 | `0xf41ef261f4d5cf4bb2481f46cf723fc3a8b1199228687c607aa7a0ea1664bc8f` |
| Registro `@bob` | 93.699.095 | `0x195170453dc72db3755e11158d1c3ecee7034b18fe8cd9efe3f45cabdee7f42c` |
| Blindaje | 93.699.109 | `0xbf0556c0d1f81b0be759835e21f752f1b77aa61d1254b7a543b978a4fe062e63` |
| Transferencia `@alice` → `@bob` | 93.699.157 | `0x9fadaa20b591ccd35009fd619e54bf21481b30a8e140b760778cc15f4da8e71f` |
| Transferencia `@bob` → `@alice` | 93.708.054 | `0x9427743fec2d11f5474b9405b12eb2015937e5ffe09a0a5a0d1cf6ce610f296b` |

Vía privada (firma el retransmisor; ninguna billetera de los participantes aparece):

| Operación | Bloque | Hash | Comisión |
|-----------|--------|------|----------|
| Transferencia `@alice` → `@bob` | 93.707.013 | `0x09ba4ef23e93b76ed0f40a373284671123a2ea96e2003bbdc157c45529bcb3fb` | 0,057 USDC |
| Transferencia `@alice` → `@bob` | 93.708.093 | `0x7811811c6931edc54fb203f15693157d498741f9f12a64d426de03c6bc540273` | 0,065 USDC |
| Registro `@incognito` (Relay Adapt) | 93.729.407 | `0x90288009ae78895ae8d795b9bb609d3acb6a6635c6ce87c94389b2904e4cd549` | 0,119 USDC |
| Transferencia `@alice` → `@incognito` | 93.729.491 | `0xd90611aff42ab7ead59b830f983ce74e916f0db9b476ee85b33f0ef1215a76db` | 0,059 USDC |
| Transferencia `@incognito` → `@bob` | 93.729.508 | `0xf88183f5a9d9f70c665b2ab62051d96548789f2638e42ebdd5b7af5feb01e4bf` | 0,056 USDC |

En el registro de `@incognito`, el campo `registrant` del evento es el contrato Relay
Adapt (`0xF82d00fC51F730F42A00F85E74895a2849ffF2Dd`) y el firmante es el retransmisor. Lo
único que sigue siendo público es el blindaje: expone a quien deposita. El diagnóstico
completo está en [`DEMO_ENLAZABILIDAD.md`](./DEMO_ENLAZABILIDAD.md).

## Estándares

- [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Addresses
- [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) - Stealth Meta-Address Registry

## Licencia

MIT
