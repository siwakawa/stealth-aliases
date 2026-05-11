/**
 * Servicio de integración con Railgun
 *
 * Implementación real usando @railgun-community/wallet v10.4.0
 * para operaciones privadas (shield, transfer) en redes EVM.
 */

import {
  startRailgunEngine,
  stopRailgunEngine,
  loadProvider,
  createRailgunWallet,
  loadWalletByID,
  getRailgunAddress,
  walletForID,
  awaitWalletScan,
  setOnUTXOMerkletreeScanCallback,
  populateShield,
  getShieldPrivateKeySignatureMessage,
  gasEstimateForShield,
  generateTransferProof,
  populateProvedTransfer,
  gasEstimateForUnprovenTransfer,
  balanceForERC20Token,
  refreshBalances,
  ArtifactStore,
} from "@railgun-community/wallet";

import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  NETWORK_CONFIG,
  type FallbackProviderJsonConfig,
  type RailgunERC20AmountRecipient,
  type TransactionGasDetails,
  type MerkletreeScanUpdateEvent,
  type RailgunWalletInfo,
  type Chain,
  ChainType,
} from "@railgun-community/shared-models";

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const leveldown = require("leveldown");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

/**
 * Configuración de red para Railgun
 */
export interface RailgunConfig {
  networkName: NetworkName;
  rpcUrl: string;
  dataDir: string;
  debug?: boolean;
  skipMerkletreeScans?: boolean;
}

/**
 * Información de wallet Railgun
 */
export interface WalletInfo {
  id: string;
  railgunAddress: string;
  mnemonic?: string;
}

/**
 * Servicio de integración real con Railgun
 */
export class RailgunService {
  private config: RailgunConfig;
  private isInitialized: boolean = false;
  private walletInfo?: WalletInfo;
  private encryptionKey: string;
  private provider: ethers.JsonRpcProvider;
  private skipScans: boolean;

  constructor(config: RailgunConfig, encryptionKey?: string) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.skipScans = config.skipMerkletreeScans ?? false;
    // Encryption key para cifrar la wallet en la DB
    this.encryptionKey =
      encryptionKey ||
      ethers.keccak256(ethers.toUtf8Bytes("stealth-aliases-demo")).slice(2);
  }

  /**
   * Inicializa el engine de Railgun con LevelDB y ArtifactStore reales
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("Railgun ya está inicializado");
      return;
    }

    const debug = this.config.debug ?? false;

    // 1. Crear directorio de datos
    const dataDir = this.config.dataDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 2. Crear ArtifactStore con filesystem
    const artifactsDir = path.join(dataDir, "artifacts");
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const artifactStore = new ArtifactStore(
      // get: lee un artefacto del disco
      async (artifactPath: string) => {
        const fullPath = path.join(artifactsDir, artifactPath);
        if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath);
        }
        return null;
      },
      // store: guarda un artefacto en disco
      // dir = "artifacts-v2.1/1x1", artifactPath = "artifacts-v2.1/1x1/vkey.json"
      // El archivo se guarda en artifactsDir/artifactPath (dir es solo para crear el directorio)
      async (dir: string, artifactPath: string, item: string | Uint8Array) => {
        const fullDir = path.join(artifactsDir, dir);
        if (!fs.existsSync(fullDir)) {
          fs.mkdirSync(fullDir, { recursive: true });
        }
        const fullPath = path.join(artifactsDir, artifactPath);
        fs.writeFileSync(fullPath, Buffer.from(item));
      },
      // exists: verifica si un artefacto existe
      async (artifactPath: string) => {
        return fs.existsSync(path.join(artifactsDir, artifactPath));
      }
    );

    // 3. Crear instancia LevelDB
    const dbPath = path.join(dataDir, "railgun.db");
    const db = leveldown(dbPath);

    // 4. Iniciar el engine
    console.log("Inicializando Railgun Engine...");
    const poiNodeURLs = ["https://ppoi-agg.horsewithsixlegs.xyz"];

    await startRailgunEngine(
      "stealthaliases", // walletSource (max 16 chars, lowercase)
      db as any,         // LevelDOWN compatible
      debug,             // shouldDebug
      artifactStore,     // para descargar prover keys
      false,             // useNativeArtifacts (false para Node.js)
      false,             // skipMerkletreeScans (debe ser false para POI)
      poiNodeURLs,       // Proof of Innocence node URLs
      [],                // customPOILists
      true               // verboseScanLogging
    );

    // 5. Configurar groth16 prover (snarkjs) para generación de ZK proofs
    const { getEngine } = require(
      path.join(__dirname, "../../node_modules/@railgun-community/wallet/dist/services/railgun/core/engine.js")
    );
    getEngine().prover.setSnarkJSGroth16(snarkjs.groth16);

    // 6. Callback para progreso del scan (después de iniciar el engine)
    setOnUTXOMerkletreeScanCallback(
      (scanData: MerkletreeScanUpdateEvent) => {
        if (debug) {
          const pct = ((scanData.progress ?? 0) * 100).toFixed(1);
          console.log(
            `  Scan UTXO: ${pct}% (chain ${scanData.chain?.id})`
          );
        }
      }
    );

    // 6. Cargar provider para la red configurada
    const networkConfig = NETWORK_CONFIG[this.config.networkName];
    const chainId = networkConfig.chain.id;

    const fallbackConfig: FallbackProviderJsonConfig = {
      chainId,
      providers: [
        {
          provider: this.config.rpcUrl,
          priority: 1,
          weight: 2,
        },
      ],
    };

    console.log(
      `Cargando provider para ${this.config.networkName} (chainId: ${chainId})...`
    );
    await loadProvider(fallbackConfig, this.config.networkName);

    this.isInitialized = true;
    console.log("✓ Railgun Engine inicializado");
  }

  /**
   * Detiene el engine de Railgun
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;
    await stopRailgunEngine();
    this.isInitialized = false;
    console.log("✓ Railgun Engine detenido");
  }

  /**
   * Crea una nueva wallet de Railgun
   */
  async createWallet(mnemonic?: string): Promise<WalletInfo> {
    this.ensureInitialized();

    const walletMnemonic =
      mnemonic || ethers.Wallet.createRandom().mnemonic?.phrase;
    if (!walletMnemonic) {
      throw new Error("No se pudo generar el mnemonic");
    }

    // Usar un block number reciente para evitar scan desde genesis
    const currentBlock = await this.provider.getBlockNumber();
    const chain = this.getChain();

    // Empezar a scanear desde 100 bloques atrás (~3 min en Polygon)
    const creationBlockNumbers: { [key: string]: number } = {
      [this.config.networkName]: Math.max(0, currentBlock - 100),
    };

    console.log(
      `Creando wallet Railgun (scan desde bloque ${creationBlockNumbers[this.config.networkName]})...`
    );
    const walletResponse = await createRailgunWallet(
      this.encryptionKey,
      walletMnemonic,
      creationBlockNumbers
    );

    const railgunAddress =
      getRailgunAddress(walletResponse.id) ?? walletResponse.railgunAddress;

    this.walletInfo = {
      id: walletResponse.id,
      railgunAddress,
      mnemonic: walletMnemonic,
    };

    // Sincronizar merkletree (refreshBalances dispara scanContractHistory)
    if (!this.skipScans) {
      console.log("Sincronizando merkletree...");
      await refreshBalances(chain, [walletResponse.id]);
      console.log("✓ Sync completado");
    }

    console.log(`✓ Wallet creada: ${railgunAddress.slice(0, 30)}...`);
    return this.walletInfo;
  }

  /**
   * Crea o carga una wallet según si ya existe en disco.
   * Persiste el wallet ID en un archivo JSON para reutilizarlo.
   */
  async getOrCreateWallet(
    mnemonic: string,
    label: string = "default"
  ): Promise<WalletInfo> {
    this.ensureInitialized();

    const walletFile = path.join(this.config.dataDir, `wallet-${label}.json`);

    // Si ya existe, cargar por ID
    if (fs.existsSync(walletFile)) {
      const saved = JSON.parse(fs.readFileSync(walletFile, "utf8"));
      console.log(`Cargando wallet "${label}" (${saved.id.slice(0, 16)}...)...`);
      try {
        return await this.loadWallet(saved.id);
      } catch {
        console.log("⚠ No se pudo cargar, recreando...");
      }
    }

    // Crear nueva y guardar
    const walletInfo = await this.createWallet(mnemonic);
    fs.writeFileSync(
      walletFile,
      JSON.stringify({ id: walletInfo.id, label, railgunAddress: walletInfo.railgunAddress }, null, 2)
    );
    console.log(`Wallet "${label}" guardada en ${walletFile}`);
    return walletInfo;
  }

  /**
   * Carga una wallet existente por ID
   */
  async loadWallet(walletId: string): Promise<WalletInfo> {
    this.ensureInitialized();

    const walletResponse = await loadWalletByID(
      this.encryptionKey,
      walletId,
      false // no es view-only
    );

    const railgunAddress =
      getRailgunAddress(walletResponse.id) ?? walletResponse.railgunAddress;

    this.walletInfo = {
      id: walletResponse.id,
      railgunAddress,
    };

    const chain = this.getChain();
    if (!this.skipScans) {
      console.log("Sincronizando merkletree...");
      await refreshBalances(chain, [walletResponse.id]);
      const w = walletForID(walletResponse.id);
      await w.refreshPOIsForAllTXIDVersions(chain);
      console.log("✓ Sync completado");
    }

    console.log(`✓ Wallet cargada: ${railgunAddress.slice(0, 30)}...`);
    return this.walletInfo;
  }

  /**
   * Obtiene la dirección Railgun de la wallet
   */
  getRailgunAddress(): string {
    if (!this.walletInfo) {
      throw new Error("No hay wallet cargada");
    }
    return this.walletInfo.railgunAddress;
  }

  /**
   * Obtiene el TXIDVersion apropiado para la red configurada
   */
  getTxidVersion(): TXIDVersion {
    const networkConfig = NETWORK_CONFIG[this.config.networkName];
    return networkConfig.supportsV3
      ? TXIDVersion.V3_PoseidonMerkle
      : TXIDVersion.V2_PoseidonMerkle;
  }

  /**
   * Obtiene la Chain para la red configurada
   */
  getChain(): Chain {
    const networkConfig = NETWORK_CONFIG[this.config.networkName];
    return { type: ChainType.EVM, id: networkConfig.chain.id };
  }

  /**
   * Consulta el balance privado de un token ERC-20
   */
  async getBalance(tokenAddress: string, onlySpendable: boolean = false): Promise<bigint> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const wallet = walletForID(this.walletInfo.id);
    const txidVersion = this.getTxidVersion();

    return balanceForERC20Token(
      txidVersion,
      wallet,
      this.config.networkName,
      tokenAddress,
      onlySpendable
    );
  }

  /**
   * Refresca los balances de la wallet
   */
  async refreshWalletBalances(): Promise<void> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const chain = this.getChain();
    await refreshBalances(chain, [this.walletInfo.id]);
  }

  /**
   * Espera a que el scan del merkletree termine para la wallet actual
   */
  async waitForScan(timeoutMs: number = 300_000): Promise<void> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const chain = this.getChain();
    await Promise.race([
      awaitWalletScan(this.walletInfo.id, chain),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Scan timeout")), timeoutMs)
      ),
    ]);
  }

  /**
   * Blindaje (shield) de tokens ERC-20 hacia la reserva privada
   *
   * @param tokenAddress - Dirección del token ERC-20
   * @param amount - Cantidad a blindar (en unidades mínimas)
   * @param fromWallet - Wallet que envía los tokens
   */
  async shieldTokens(
    tokenAddress: string,
    amount: bigint,
    fromWallet: ethers.Wallet
  ): Promise<string> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const txidVersion = this.getTxidVersion();
    const networkConfig = NETWORK_CONFIG[this.config.networkName];

    // 1. Derivar shield private key (firmar mensaje y usar hash como clave)
    const signatureMessage = getShieldPrivateKeySignatureMessage();
    const signature = await fromWallet.signMessage(signatureMessage);
    // La shield private key es el keccak256 de la firma, como 32 bytes hex
    const shieldPrivateKey = ethers.keccak256(signature).slice(2); // sin 0x prefix

    // 2. Aprobar tokens al proxy contract de Railgun
    const proxyContract = networkConfig.proxyContract;
    console.log(`Aprobando tokens al contrato Railgun (${proxyContract.slice(0, 10)}...)...`);

    const erc20Abi = [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
    ];
    const tokenContract = new ethers.Contract(
      tokenAddress,
      erc20Abi,
      fromWallet
    );

    const currentAllowance = await tokenContract.allowance(
      fromWallet.address,
      proxyContract
    );
    if (currentAllowance < amount) {
      const approveTx = await tokenContract.approve(proxyContract, amount);
      await approveTx.wait();
      console.log(`✓ Aprobación confirmada: ${approveTx.hash}`);
    }

    // 3. Construir el recipient
    const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
      {
        tokenAddress,
        amount,
        recipientAddress: this.walletInfo.railgunAddress,
      },
    ];

    // 4. Estimar gas
    console.log("Estimando gas para shield...");
    const gasEstimate = await gasEstimateForShield(
      txidVersion,
      this.config.networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      [],
      fromWallet.address
    );

    // 5. Obtener gas details
    const feeData = await this.provider.getFeeData();
    const gasDetails: TransactionGasDetails = {
      evmGasType: EVMGasType.Type2,
      gasEstimate: gasEstimate.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas ?? 30000000000n,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1500000000n,
    };

    // 6. Popular transacción de shield
    console.log("Generando transacción de shield...");
    const shieldResponse = await populateShield(
      txidVersion,
      this.config.networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      [],
      gasDetails
    );

    // 7. Enviar transacción
    console.log("Enviando transacción de shield...");
    const tx = await fromWallet.sendTransaction(shieldResponse.transaction);
    console.log(`✓ Shield TX enviada: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✓ Shield confirmado en bloque ${receipt?.blockNumber}`);

    return tx.hash;
  }

  /**
   * Transferencia privada dentro de Railgun
   *
   * @param tokenAddress - Dirección del token
   * @param amount - Cantidad a transferir (en unidades mínimas)
   * @param recipientRailgunAddress - Dirección Railgun del receptor (0zk...)
   * @param sendingWallet - Wallet para enviar la TX (paga gas)
   */
  async privateTransfer(
    tokenAddress: string,
    amount: bigint,
    recipientRailgunAddress: string,
    sendingWallet: ethers.Wallet
  ): Promise<string> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const txidVersion = this.getTxidVersion();
    const chain = this.getChain();

    // 1. Doble refreshBalances justo antes del flujo de transfer
    console.log("Sincronizando estado antes del transfer...");
    await refreshBalances(chain, [this.walletInfo.id]);
    await refreshBalances(chain, [this.walletInfo.id]);

    // 2. Construir recipient (se reutiliza idéntico en estimate/proof/populate)
    const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
      {
        tokenAddress,
        amount,
        recipientAddress: recipientRailgunAddress,
      },
    ];

    // 3. Obtener gas details
    const feeData = await this.provider.getFeeData();
    const originalGasDetails: TransactionGasDetails = {
      evmGasType: EVMGasType.Type2,
      gasEstimate: 2_000_000n,
      maxFeePerGas: feeData.maxFeePerGas ?? 30000000000n,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1500000000n,
    };

    // 4. Estimar gas
    console.log("Estimando gas para transferencia privada...");
    const gasEstimateResponse = await gasEstimateForUnprovenTransfer(
      txidVersion,
      this.config.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      undefined, // memoText
      erc20AmountRecipients,
      [],        // nftAmountRecipients
      originalGasDetails,
      undefined, // feeTokenDetails (sin broadcaster)
      true       // sendWithPublicWallet
    );

    // 5. Gas details finales + overallBatchMinGasPrice (consistente en proof y populate)
    const transactionGasDetails: TransactionGasDetails = {
      evmGasType: EVMGasType.Type2,
      gasEstimate: gasEstimateResponse.gasEstimate,
      maxFeePerGas: feeData.maxFeePerGas ?? 30000000000n,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1500000000n,
    };
    const overallBatchMinGasPrice = (transactionGasDetails as any).maxFeePerGas;

    // 6. Generar prueba ZK
    console.log("Generando prueba ZK...");
    const startTime = Date.now();

    await generateTransferProof(
      txidVersion,
      this.config.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      false,     // showSenderAddressToRecipient
      undefined, // memoText
      erc20AmountRecipients,
      [],        // nftAmountRecipients
      undefined, // broadcasterFeeERC20AmountRecipient
      true,      // sendWithPublicWallet
      overallBatchMinGasPrice,
      (progress: number, status: string) => {
        const pct = (progress * 100).toFixed(0);
        process.stdout.write(`\r  Prueba ZK: ${pct}% - ${status}`);
      }
    );
    console.log("");

    const proofTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ Prueba ZK generada en ${proofTime}s`);

    // 7. Popular transacción (mismos parámetros exactos que generateTransferProof)
    console.log("Generando transacción con prueba...");
    const transferResponse = await populateProvedTransfer(
      txidVersion,
      this.config.networkName,
      this.walletInfo.id,
      false,     // showSenderAddressToRecipient
      undefined, // memoText
      erc20AmountRecipients,
      [],        // nftAmountRecipients
      undefined, // broadcasterFeeERC20AmountRecipient
      true,      // sendWithPublicWallet
      overallBatchMinGasPrice,
      transactionGasDetails
    );

    // 8. Validar con provider.call antes de enviar (no gasta gas)
    console.log("Validando transacción...");
    const from = sendingWallet.address;
    try {
      await this.provider.call({
        from,
        to: transferResponse.transaction.to,
        data: transferResponse.transaction.data,
        value: transferResponse.transaction.value ?? 0n,
      });
      console.log("✓ Validación OK");
    } catch (callError: any) {
      console.error("✗ Validación falló (la TX revertiría on-chain):");
      console.error("  ", callError.message?.slice(0, 200));
      throw new Error("Transfer revertiría on-chain. No se envía.");
    }

    // 9. Enviar transacción
    console.log("Enviando transferencia privada...");
    const tx = await sendingWallet.sendTransaction(
      transferResponse.transaction
    );
    console.log(`✓ Transfer TX enviada: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✓ Transferencia confirmada en bloque ${receipt?.blockNumber}`);

    return tx.hash;
  }

  /**
   * Obtiene el contrato proxy de Railgun para esta red
   */
  getRailgunProxyContract(): string {
    return NETWORK_CONFIG[this.config.networkName]?.proxyContract || "";
  }

  /**
   * Obtiene información de la red configurada
   */
  getNetworkInfo(): {
    name: NetworkName;
    chainId: number;
    proxyContract: string;
  } {
    const config = NETWORK_CONFIG[this.config.networkName];
    return {
      name: this.config.networkName,
      chainId: config?.chain?.id || 0,
      proxyContract: config?.proxyContract || "",
    };
  }

  // === Helpers privados ===

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        "Railgun no está inicializado. Llama a initialize() primero."
      );
    }
  }
}

/**
 * Direcciones de contratos Railgun en diferentes redes
 */
export const RAILGUN_CONTRACTS = {
  [NetworkName.Ethereum]: {
    proxy: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
    relay: "0x4025ee6512dbbda97049bcf5aa5d38c54af6be8a",
  },
  [NetworkName.Polygon]: {
    proxy: "0x19b620929f97b7b990801496c3b361ca5def8c71",
    relay: "0xc7ffa542736321a3dd69246d73987566a5486968",
  },
  [NetworkName.BNBChain]: {
    proxy: "0x590162bf4b50f6576a459b75309ee21d92178a10",
    relay: "0x753f0f9ba003dda95eb9284533cf5b0f19e441dc",
  },
  [NetworkName.Arbitrum]: {
    proxy: "0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9",
    relay: "0x5ad95c537b002770a39dea342c4bb2b68b1497aa",
  },
};
