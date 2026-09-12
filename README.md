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
│             │      address         │  viewing (33) +  │
└─────────────┘                      │  spending (33)   │
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
| `AliasRegistry` | Polygon Mainnet | `0x690BEA9b3420C961A2f490197fd92CeCA586F36d` | **En uso** |
| `AliasRegistry` (v1) | Polygon Mainnet | `0x0A8Fadf827a6e937C33C40c78017063168eaC76D` | Histórico |

`AliasRegistry` es el contrato vigente: agrega la dirección Railgun del receptor, sin la cual no es posible enrutar una transferencia privada. La v1 almacenaba únicamente la metadirección sigilosa y se conserva solo como referencia histórica.

## Estructura

```
├── contracts/          # Smart contracts (Hardhat)
│   ├── src/
│   │   ├── AliasRegistry.sol      # v1 (histórico)
│   │   └── AliasRegistry.sol    # vigente
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
import { AliasRegistryClient, generateStealthAddress } from "@tesina/alias-sdk";
import { ethers } from "ethers";

// Conectar
const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
const registry = new AliasRegistryClient(provider);

// Resolver alias
const metaAddress = await registry.resolve("bob");

// Generar dirección de pago única
const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress(metaAddress);

// Enviar fondos a stealthAddress (vía Railgun para privacidad)
```

## Demostración de extremo a extremo (línea de comandos)

El flujo privado completo `@alice` → `@bob` se ejecuta **desde la terminal** con el SDK
(no hay interfaz web). Los pasos son:

1. Crear las billeteras Railgun de Alice y Bob.
2. Registrar ambos aliases on-chain en `AliasRegistry`.
3. Alice **blinda** USDC en la reserva privada de Railgun (*shield*).
4. Alice resuelve `@bob` → dirección Railgun del receptor.
5. Alice **transfiere** USDC a Bob dentro de la reserva (transferencia privada con prueba ZK).
6. Bob carga su billetera y **verifica la recepción**.

### Requisitos

- Una wallet pública con **USDC y MATIC** (para gas) en Polygon mainnet.
- Variables en `contracts/.env` (ver `contracts/.env.example`):

  | Variable | Uso |
  |----------|-----|
  | `PRIVATE_KEY` | Wallet pública que paga gas y hace el *shield* |
  | `MNEMONIC_A` | Semilla de la billetera Railgun de Alice (remitente) |
  | `MNEMONIC_B` | Semilla de la billetera Railgun de Bob (receptor) |
  | `POLYGON_RPC` | RPC de Polygon (opcional, hay un default público) |

### Ejecución

```bash
cd sdk
npm install

# Solo registro de aliases (@alice, @bob) on-chain
npm run demo:railgun

# + blindar USDC en la reserva de Railgun
npm run demo:railgun -- --shield

# Flujo completo: registro + shield + transferencia privada @alice → @bob
npm run demo:railgun -- --shield --transfer
```

> La primera corrida descarga los artefactos ZK y sincroniza el *merkletree*, por lo que
> puede tardar varios minutos.

### Corrida confirmada on-chain

El flujo completo se validó en Polygon mainnet. Los hashes verificables y el detalle del
obstáculo de POI (*Proof of Innocence*) que hubo que resolver están en
[`POI_INVESTIGATION.md`](./POI_INVESTIGATION.md):

| Operación | Hash | Bloque |
|-----------|------|--------|
| Registro `@alice` | `0xc864fc5f…` | 86.593.146 |
| Registro `@bob` | `0xe61d9f81…` | 86.593.150 |
| Transferencia privada (0,01 USDC) | `0x3cc8c3ebe675…7f19db59` | 86.744.133 |

> **Nota de privacidad:** en esta demostración las tres transacciones se emiten desde una
> misma billetera pública, lo que permite a un observador vincularlas entre sí. Es un
> artefacto del script (una sola wallet por simplicidad); un uso real requiere billeteras
> separadas por participante.

## Estándares

- [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Addresses
- [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) - Stealth Meta-Address Registry

## Licencia

MIT
