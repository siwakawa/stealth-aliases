import { ethers, Contract, Provider, Signer } from "ethers";
import AliasRegistryABI from "./abi/AliasRegistry.json";

// Direcciones del contrato desplegado
export const DEPLOYMENTS: Record<number, string> = {
  137: "0xEee312ACa2dCdCF372eDD5CE6D58419F6459bA9d", // Polygon Mainnet
};

export interface AliasInfo {
  alias: string;
  stealthMetaAddress: string;
  railgunAddress: string;
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
      this.signer = providerOrSigner as Signer;
      this.provider = this.signer.provider!;
    } else {
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
   * Registra un alias con su stealth meta-address y dirección Railgun
   */
  async register(
    alias: string,
    stealthMetaAddress: Uint8Array | string,
    railgunAddress: string
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error("Se necesita un signer para registrar");
    }

    const metaBytes =
      typeof stealthMetaAddress === "string"
        ? stealthMetaAddress
        : ethers.hexlify(stealthMetaAddress);

    const tx = await this.contract.register(alias, metaBytes, railgunAddress);
    await tx.wait();
    return tx;
  }

  /**
   * Resuelve un alias a su stealth meta-address y dirección Railgun
   */
  async resolve(alias: string): Promise<{ stealthMetaAddress: string; railgunAddress: string }> {
    const [stealthMetaAddress, railgunAddress] = await this.contract.resolve(alias);
    return { stealthMetaAddress, railgunAddress };
  }

  /**
   * Resuelve un alias a su dirección Railgun únicamente
   */
  async resolveRailgun(alias: string): Promise<string> {
    return this.contract.resolveRailgun(alias);
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
    let railgunAddress = "";

    if (isRegistered) {
      const data = await this.resolve(alias);
      stealthMetaAddress = data.stealthMetaAddress;
      railgunAddress = data.railgunAddress;
    }

    return {
      alias,
      stealthMetaAddress,
      railgunAddress,
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
