import { ethers, Contract, Provider, Signer } from "ethers";
import AliasRegistryABI from "./abi/AliasRegistry.json";

// Direcciones del contrato desplegado
export const DEPLOYMENTS: Record<number, string> = {
  137: "0x3957987D2Fb35d4ca17D4Fcba29E576Fb586Fa9B", // Polygon Mainnet
};

// Bloque anterior al despliegue en cada red: acota la búsqueda de eventos, que
// de otro modo recorrería toda la historia de la cadena.
const DEPLOYMENT_BLOCKS: Record<number, number> = {
  137: 93_745_500,
};

/**
 * Módulo Resolución del diseño: prepararRegistro, resolver, resolverPrivada,
 * registrado y aliasesDe se realizan como populateRegister, resolve,
 * resolveRailgun, isRegistered y aliasesPointingTo.
 */
export class AliasRegistryClient {
  private contract: Contract;
  private provider: Provider;
  private signer?: Signer;
  private fromBlock: number;

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
    this.fromBlock = DEPLOYMENT_BLOCKS[chainId || 137] ?? 0;

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
   * Prepara la invocación de registro sin enviarla.
   *
   * Devuelve la llamada lista para entregar a un canal de envío: la vía directa
   * la firma y publica desde la billetera del registrante, mientras que la vía
   * privada la envuelve en una llamada de Relay Adapt. El contrato ejecuta la
   * misma operación en ambos casos; lo que cambia es qué puede observar un
   * tercero sobre quién la originó.
   */
  async populateRegister(
    alias: string,
    stealthMetaAddress: Uint8Array | string,
    railgunAddress: string
  ): Promise<ethers.ContractTransaction> {
    const metaBytes =
      typeof stealthMetaAddress === "string"
        ? stealthMetaAddress
        : ethers.hexlify(stealthMetaAddress);

    return this.contract.register.populateTransaction(
      alias,
      metaBytes,
      railgunAddress
    );
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
   * Devuelve los aliases registrados que reciben en una dirección Railgun.
   *
   * El contrato no guarda el mapeo inverso, de modo que se reconstruye a partir
   * de los eventos de registro.
   */
  async aliasesPointingTo(railgunAddress: string): Promise<string[]> {
    const events = await this.contract.queryFilter(
      this.contract.filters.AliasRegistered(),
      this.fromBlock,
      "latest"
    );
    return events
      .map((e) => (e as ethers.EventLog).args)
      .filter((args) => args.railgunAddress === railgunAddress)
      .map((args) => args.alias_ as string);
  }
}
