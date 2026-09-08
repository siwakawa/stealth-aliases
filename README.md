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
| `AliasRegistryV2` | Polygon Mainnet | `0x690BEA9b3420C961A2f490197fd92CeCA586F36d` | **En uso** |
| `AliasRegistry` (v1) | Polygon Mainnet | `0x0A8Fadf827a6e937C33C40c78017063168eaC76D` | Histórico |

`AliasRegistryV2` es el contrato vigente: agrega la dirección Railgun del receptor, sin la cual no es posible enrutar una transferencia privada. La v1 almacenaba únicamente la metadirección sigilosa y se conserva solo como referencia histórica.

## Estructura

```
├── contracts/          # Smart contracts (Hardhat)
│   ├── src/
│   │   ├── AliasRegistry.sol      # v1 (histórico)
│   │   └── AliasRegistryV2.sol    # vigente
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

## Estándares

- [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) - Stealth Addresses
- [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) - Stealth Meta-Address Registry

## Licencia

MIT
