import { XOConnectProvider, XOConnect } from "xo-connect";
import { BrowserProvider, Contract } from "ethers";

// ABI mínimo del AliasRegistry
const ALIAS_REGISTRY_ABI = [
  "function register(string calldata alias_, bytes calldata stealthMetaAddress) external",
  "function resolve(string calldata alias_) external view returns (bytes memory)",
  "function isRegistered(string calldata alias_) external view returns (bool)",
  "event AliasRegistered(bytes32 indexed aliasHash, string alias_, bytes stealthMetaAddress, address indexed registrant)",
];

// Contrato desplegado
const ALIAS_REGISTRY_ADDRESS = "0x0A8Fadf827a6e937C33C40c78017063168eaC76D";

// RPC de Polygon
const POLYGON_RPC = "https://polygon-mainnet.g.alchemy.com/v2/_q5c1svHrGcF-VZ--ISz-LN2vwrOkDSm";

let xoProvider: XOConnectProvider | null = null;
let ethersProvider: BrowserProvider | null = null;

/**
 * Inicializa el provider de xo-connect
 */
export function initProvider(debug = false): XOConnectProvider {
  if (xoProvider) return xoProvider;

  xoProvider = new XOConnectProvider({
    rpcs: {
      "0x89": POLYGON_RPC, // Polygon
    },
    defaultChainId: "0x89",
    debug,
  });

  return xoProvider;
}

/**
 * Obtiene el provider de ethers
 */
export function getEthersProvider(): BrowserProvider {
  if (!xoProvider) {
    initProvider();
  }
  if (!ethersProvider) {
    ethersProvider = new BrowserProvider(xoProvider!);
  }
  return ethersProvider;
}

/**
 * Conecta la wallet
 */
export async function connectWallet(): Promise<string> {
  const provider = getEthersProvider();
  const signer = await provider.getSigner();
  return signer.getAddress();
}

/**
 * Obtiene el cliente de Beexo
 */
export async function getBeexoClient() {
  return XOConnect.getClient();
}

/**
 * Obtiene el contrato AliasRegistry
 */
export async function getAliasRegistry(readonly = true) {
  const provider = getEthersProvider();

  if (readonly) {
    return new Contract(ALIAS_REGISTRY_ADDRESS, ALIAS_REGISTRY_ABI, provider);
  }

  const signer = await provider.getSigner();
  return new Contract(ALIAS_REGISTRY_ADDRESS, ALIAS_REGISTRY_ABI, signer);
}

/**
 * Verifica si un alias está registrado
 */
export async function isAliasRegistered(alias: string): Promise<boolean> {
  const registry = await getAliasRegistry(true);
  return registry.isRegistered(alias);
}

/**
 * Resuelve un alias a su meta-address
 */
export async function resolveAlias(alias: string): Promise<string | null> {
  const registry = await getAliasRegistry(true);
  const isRegistered = await registry.isRegistered(alias);

  if (!isRegistered) return null;

  return registry.resolve(alias);
}

/**
 * Registra un nuevo alias
 */
export async function registerAlias(
  alias: string,
  stealthMetaAddress: string
): Promise<string> {
  const registry = await getAliasRegistry(false);
  const tx = await registry.register(alias, stealthMetaAddress);
  await tx.wait();
  return tx.hash;
}

export { ALIAS_REGISTRY_ADDRESS };
