// Cliente para el contrato AliasRegistry
export { AliasRegistryClient, DEPLOYMENTS } from "./AliasRegistryClient";
export type { AliasInfo } from "./AliasRegistryClient";

// Utilidades de stealth addresses
export {
  generateKeyPair,
  generateStealthMetaAddress,
  parseStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
} from "./StealthAddress";
export type { StealthMetaAddress, StealthKeyPair } from "./StealthAddress";

// Canales de envío: vía directa y vía privada (Relay Adapt)
export { DirectChannel, RelayAdaptChannel } from "./SendChannel";
export type { SendChannel } from "./SendChannel";

// Integración con Railgun
export { RailgunService } from "./railgun/RailgunService";
export type { RailgunConfig } from "./railgun/RailgunService";

// Re-export de ethers para conveniencia
export { ethers } from "ethers";
