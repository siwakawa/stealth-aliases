// Cliente para el contrato AliasRegistry
export { AliasRegistryClient, DEPLOYMENTS } from "./AliasRegistryClient";
export type { AliasInfo } from "./AliasRegistryClient";

// Utilidades de stealth addresses
export {
  generateKeyPair,
  generateStealthMetaAddress,
  deriveStealthKeys,
  normalizeAlias,
  parseStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
} from "./StealthAddress";
export type { StealthMetaAddress, StealthKeyPair } from "./StealthAddress";

// Canales de envío (estrategia) y operaciones de usuario (contexto)
export { DirectChannel, PrivateChannel, createChannel } from "./SendChannel";
export type { SendChannel, Via, ChannelOptions } from "./SendChannel";
export { AliasApp } from "./AliasApp";

// Integración con Railgun
export { RailgunService } from "./railgun/RailgunService";
export type { RailgunConfig, SupportedNetwork } from "./railgun/RailgunService";

// Re-export de ethers para conveniencia
export { ethers } from "ethers";
