import { ethers, Contract, Provider, Signer } from "ethers";
import AliasRegistryABI from "./abi/AliasRegistry.json";

// Direcciones del contrato desplegado
export const DEPLOYMENTS: Record<number, string> = {
  137: "0x0A8Fadf827a6e937C33C40c78017063168eaC76D", // Polygon Mainnet
};

export interface AliasInfo {
  alias: string;
  stealthMetaAddress: string;
  isRegistered: boolean;
}

export class AliasRegistryClient {
  private contract: Contract;
  private provider: Provider;
  private signer?: Signer;

  constructor(
    providerOrSigner: Provider | Signer,
    contractAddress?: string,
    chainId?: number
  ) {
    if ("getAddress" in providerOrSigner) {
      // Es un Signer
      this.signer = providerOrSigner as Signer;
      this.provider = this.signer.provider!;
    } else {
      // Es un Provider
      this.provider = providerOrSigner as Provider;
    }

    const address =
      contractAddress || DEPLOYMENTS[chainId || 137];

    if (!address) {
      throw new Error(`No hay deployment para chainId ${chainId}`);
    }

    this.contract = new Contract(
      address,
      AliasRegistryABI,
      this.signer || this.provider
    );
  }

  /**
   * Registra un alias con su stealth meta-address
   * @param alias - El alias sin @ (ej: "bob")
   * @param stealthMetaAddress - 66 bytes: viewing pubkey (33) + spending pubkey (33)
   */
  async register(
    alias: string,
    stealthMetaAddress: Uint8Array | string
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error("Se necesita un signer para registrar");
    }

    const metaBytes =
      typeof stealthMetaAddress === "string"
        ? stealthMetaAddress
        : ethers.hexlify(stealthMetaAddress);

    const tx = await this.contract.register(alias, metaBytes);
    return tx;
  }

  /**
   * Resuelve un alias a su stealth meta-address
   * @param alias - El alias sin @ (ej: "bob")
   * @returns La stealth meta-address en hex (66 bytes)
   */
  async resolve(alias: string): Promise<string> {
    const result = await this.contract.resolve(alias);
    return result;
  }

  /**
   * Verifica si un alias está registrado
   */
  async isRegistered(alias: string): Promise<boolean> {
    return this.contract.isRegistered(alias);
  }

  /**
   * Obtiene información completa de un alias
   */
  async getAliasInfo(alias: string): Promise<AliasInfo> {
    const isRegistered = await this.isRegistered(alias);
    let stealthMetaAddress = "0x";

    if (isRegistered) {
      stealthMetaAddress = await this.resolve(alias);
    }

    return {
      alias,
      stealthMetaAddress,
      isRegistered,
    };
  }

  /**
   * Calcula el hash de un alias (para lookups directos)
   */
  async getAliasHash(alias: string): Promise<string> {
    return this.contract.getAliasHash(alias);
  }

  /**
   * Obtiene la dirección del contrato
   */
  getContractAddress(): string {
    return this.contract.target as string;
  }
}
