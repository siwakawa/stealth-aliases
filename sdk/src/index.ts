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

// Integración con Railgun
export { RailgunService } from "./railgun/RailgunService";
export type { RailgunConfig } from "./railgun/RailgunService";

// Re-export de ethers para conveniencia
export { ethers } from "ethers";
