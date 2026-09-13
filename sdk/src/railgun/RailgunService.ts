/**
 * Servicio de integración con Railgun
 *
 * Implementación real usando @railgun-community/wallet v10.8.6
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
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
  gasEstimateForUnprovenCrossContractCalls,
  balanceForERC20Token,
  refreshBalances,
  refreshReceivePOIsForWallet,
  generatePOIsForWallet,
  calculateBroadcasterFeeERC20Amount,
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
  getEVMGasTypeForTransaction,
  BroadcasterConnectionStatus,
  type FeeTokenDetails,
  type SelectedBroadcaster,
} from "@railgun-community/shared-models";

import {
  WakuBroadcasterClient,
  BroadcasterTransaction,
} from "@railgun-community/waku-broadcaster-client-node";

import { ethers, type ContractTransaction } from "ethers";
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const leveldown = require("leveldown");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

/**
 * Configuración de red para Railgun
 */
/** Redes en las que Railgun está desplegado y el servicio puede operar. */
export type SupportedNetwork = "Ethereum" | "Polygon" | "Arbitrum" | "BNB_Chain";

export interface RailgunConfig {
  networkName: SupportedNetwork;
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
  private broadcasterConnectionLogged = false;
  // El motor de Railgun y su base de datos son globales al proceso: una segunda
  // instancia no puede iniciarlos.
  private static engineRunning = false;
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
    if (RailgunService.engineRunning) {
      throw new Error(
        "El motor de Railgun ya fue iniciado por otra instancia de RailgunService en este proceso."
      );
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
    // Nodos de Prueba de Inocencia, tomados de POI_NODE_URLS (separados por coma).
    // Sin al menos uno alcanzable, las notas blindadas nunca salen del estado
    // pendiente y los fondos no se pueden gastar, sin error visible. Son
    // servicios comunitarios que pueden desaparecer, de modo que la lista se
    // configura por entorno y no se fija en el código.
    const poiNodeURLs = (process.env.POI_NODE_URLS || "")
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (poiNodeURLs.length === 0) {
      throw new Error(
        "POI_NODE_URLS no configurado en el .env. Sin un nodo de Prueba de " +
          "Inocencia alcanzable los fondos blindados no llegan a ser gastables."
      );
    }

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
    const networkConfig = NETWORK_CONFIG[this.networkName];
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
      `Cargando provider para ${this.networkName} (chainId: ${chainId})...`
    );
    await loadProvider(fallbackConfig, this.networkName);

    this.isInitialized = true;
    RailgunService.engineRunning = true;
    console.log("✓ Railgun Engine inicializado");
  }

  /**
   * Detiene el engine de Railgun
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;
    // La red de retransmisores mantiene conexiones abiertas que sostienen vivo el
    // bucle de eventos: sin cerrarla, el proceso no termina aunque el flujo haya
    // concluido.
    try {
      if (WakuBroadcasterClient.isStarted()) {
        await WakuBroadcasterClient.stop();
        console.log("✓ Desconectado de la red de retransmisores");
      }
    } catch (e: any) {
      console.warn(`⚠ No se pudo cerrar la red de retransmisores: ${e.message}`);
    } finally {
      await stopRailgunEngine();
      this.isInitialized = false;
      RailgunService.engineRunning = false;
      console.log("✓ Railgun Engine detenido");
    }
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

    const chain = this.getChain();

    // El bloque de creación solo acota el descifrado de las notas propias: el
    // árbol de Merkle se sincroniza completo igual. Una semilla recién generada
    // no puede tener notas anteriores, así que basta con empezar cerca del bloque
    // actual. Una semilla importada sí puede tenerlas: acotarla dejaría fuera sus
    // fondos, de modo que se descifra el árbol entero.
    let creationBlockNumbers: { [key: string]: number } | undefined;
    if (!mnemonic) {
      const currentBlock = await this.provider.getBlockNumber();
      creationBlockNumbers = { [this.networkName]: Math.max(0, currentBlock - 100) };
    }

    console.log(
      creationBlockNumbers
        ? `Creando wallet Railgun nueva (notas desde bloque ${creationBlockNumbers[this.networkName]})...`
        : "Importando wallet Railgun (se buscan notas en todo el árbol)..."
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
  private getTxidVersion(): TXIDVersion {
    const networkConfig = NETWORK_CONFIG[this.networkName];
    return networkConfig.supportsV3
      ? TXIDVersion.V3_PoseidonMerkle
      : TXIDVersion.V2_PoseidonMerkle;
  }

  /**
   * Obtiene la Chain para la red configurada
   */
  private getChain(): Chain {
    const networkConfig = NETWORK_CONFIG[this.networkName];
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
      this.networkName,
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
    // Una nota recibida hereda la validación de las que la originaron, pero el
    // cliente no la considera gastable hasta consultar su estado.
    await refreshReceivePOIsForWallet(this.getTxidVersion(), this.networkName, this.walletInfo.id);
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
    const networkConfig = NETWORK_CONFIG[this.networkName];

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
      this.networkName,
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
      this.networkName,
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
   * Genera las Pruebas de Inocencia de las notas propias que las necesitan, para
   * que el vuelto de una operación privada vuelva a ser gastable.
   */
  private async unlockChangeNotes(): Promise<void> {
    if (!this.walletInfo) return;
    try {
      await refreshBalances(this.getChain(), [this.walletInfo.id]);
      await generatePOIsForWallet(this.networkName, this.walletInfo.id);
      await refreshBalances(this.getChain(), [this.walletInfo.id]);
    } catch (e: any) {
      // No es fatal: la operación ya se confirmó. El vuelto se habilitará cuando
      // se generen las pruebas en una sesión posterior.
      console.warn(`⚠ No se pudieron generar las pruebas del vuelto: ${e.message}`);
    }
  }

  /**
   * Conecta a la red de retransmisores y devuelve el mejor disponible para un token.
   *
   * Los retransmisores se anuncian por una red Waku; el descubrimiento es
   * asincrónico y puede no arrojar ninguno. `trustedFeeSigner` vacío significa
   * aceptar cotizaciones de cualquier operador: el retransmisor no puede desviar
   * fondos ---la prueba fija destino y monto--- de modo que el riesgo se limita a
   * un sobreprecio, comparable antes de generar la prueba.
   */
  private async findBroadcaster(
    tokenAddress: string,
    timeoutMs: number = 60_000,
    useRelayAdapt: boolean = false
  ): Promise<SelectedBroadcaster> {
    const chain = this.getChain();

    if (!WakuBroadcasterClient.isStarted()) {
      console.log("Conectando a la red de retransmisores...");
      await WakuBroadcasterClient.start(
        chain,
        { trustedFeeSigner: "" },
        (_chain: Chain, status: BroadcasterConnectionStatus) => {
          if (status === BroadcasterConnectionStatus.Connected && !this.broadcasterConnectionLogged) {
            this.broadcasterConnectionLogged = true;
            console.log("✓ Conectado a la red de retransmisores");
          }
        }
      );
    }

    const hasta = Date.now() + timeoutMs;
    while (Date.now() < hasta) {
      const elegido = WakuBroadcasterClient.findBestBroadcaster(
        chain,
        tokenAddress,
        useRelayAdapt
      );
      if (elegido) {
        console.log(`✓ Retransmisor: ${elegido.railgunAddress.slice(0, 30)}...`);
        console.log(`  comisión por unidad de gas: ${elegido.tokenFee.feePerUnitGas}`);
        return elegido;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }

    throw new Error(
      `No se encontró ningún retransmisor para ${tokenAddress} en ${timeoutMs / 1000} s. ` +
        `Sin retransmisor la transferencia debe emitirse desde la billetera pública.`
    );
  }


  /**
   * Entrega a la cadena una invocación ya preparada, a través de Relay Adapt y
   * de un retransmisor.
   *
   * Realiza la vía privada del canal de envío: el contrato de destino observa
   * como `msg.sender` la dirección del contrato Relay Adapt, no la del usuario,
   * y quien firma y publica la transacción es el retransmisor. Ninguna billetera
   * del usuario aparece en la cadena.
   *
   * @param preparedCall - Invocación lista para enviar (destino y datos)
   * @param feeTokenAddress - Token con el que se paga al retransmisor
   * @param maxFee - Comisión máxima aceptada, en unidades mínimas del token
   */
  async sendViaRelayAdapt(
    preparedCall: ContractTransaction,
    feeTokenAddress: string,
    maxFee?: bigint
  ): Promise<string> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const txidVersion = this.getTxidVersion();
    const chain = this.getChain();

    await refreshBalances(chain, [this.walletInfo.id]);

    // El retransmisor debe declarar soporte de Relay Adapt: es él quien invoca
    // ese contrato, y no todos lo ofrecen.
    const broadcaster = await this.findBroadcaster(feeTokenAddress, 60_000, true);

    const feeTokenDetails: FeeTokenDetails = {
      tokenAddress: broadcaster.tokenAddress,
      feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
    };

    const evmGasType = getEVMGasTypeForTransaction(this.networkName, false);
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 30_000_000_000n;

    // Relay Adapt ejecuta la invocación envuelta dentro de su propia
    // transacción, de modo que el límite debe cubrir ambas.
    const minGasLimit = 3_000_000n;

    const originalGasDetails = {
      evmGasType,
      gasEstimate: minGasLimit,
      gasPrice,
    } as TransactionGasDetails;

    console.log("Estimando gas de la invocación envuelta...");
    const gasEstimateResponse = await gasEstimateForUnprovenCrossContractCalls(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      [], // no se desblinda nada: la invocación no mueve fondos
      [],
      [], // ni se vuelve a blindar
      [],
      [preparedCall],
      originalGasDetails,
      feeTokenDetails,
      false, // sendWithPublicWallet
      minGasLimit
    );

    const transactionGasDetails = {
      evmGasType,
      gasEstimate: gasEstimateResponse.gasEstimate,
      gasPrice,
    } as TransactionGasDetails;

    const fee = calculateBroadcasterFeeERC20Amount(feeTokenDetails, transactionGasDetails);
    console.log(`  comisión del retransmisor: ${ethers.formatUnits(fee.amount, 6)}`);

    if (maxFee !== undefined && fee.amount > maxFee) {
      throw new Error(
        `La comisión (${ethers.formatUnits(fee.amount, 6)}) supera el máximo aceptado ` +
          `(${ethers.formatUnits(maxFee, 6)}). No se envía.`
      );
    }
    const spendable = await this.getBalance(feeTokenAddress, true);
    if (spendable < fee.amount) {
      throw new Error(
        `Saldo gastable insuficiente para la comisión: hay ` +
          `${ethers.formatUnits(spendable, 6)} y se necesitan ${ethers.formatUnits(fee.amount, 6)}.`
      );
    }

    const broadcasterFeeERC20AmountRecipient: RailgunERC20AmountRecipient = {
      tokenAddress: fee.tokenAddress,
      amount: fee.amount,
      recipientAddress: broadcaster.railgunAddress,
    };

    console.log("Generando prueba ZK...");
    const t0 = Date.now();
    await generateCrossContractCallsProof(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      [],
      [],
      [],
      [],
      [preparedCall],
      broadcasterFeeERC20AmountRecipient,
      false,
      gasPrice,
      minGasLimit,
      (progress: number, status: string) => {
        process.stdout.write(`\r  Prueba ZK: ${(progress * 100).toFixed(0)}% - ${status}`);
      }
    );
    console.log("");
    console.log(`✓ Prueba ZK generada en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const populated = await populateProvedCrossContractCalls(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      [],
      [],
      [],
      [],
      [preparedCall],
      broadcasterFeeERC20AmountRecipient,
      false,
      gasPrice,
      transactionGasDetails
    );

    console.log("Entregando la invocación al retransmisor...");
    const broadcasterTx = await BroadcasterTransaction.create(
      txidVersion,
      populated.transaction.to as string,
      populated.transaction.data as string,
      broadcaster.railgunAddress,
      broadcaster.tokenFee.feesID,
      chain,
      populated.nullifiers ?? [],
      gasPrice,
      true, // useRelayAdapt
      populated.preTransactionPOIsPerTxidLeafPerList ?? {}
    );

    const hash = await broadcasterTx.send();
    console.log(`✓ Publicada por el retransmisor: ${hash}`);

    console.log("Esperando confirmación en cadena...");
    const receipt = await this.provider.waitForTransaction(hash, 1, 180_000);
    if (!receipt) {
      throw new Error(`La transacción ${hash} no se confirmó en 180 s.`);
    }
    if (receipt.status !== 1) {
      throw new Error(`La transacción ${hash} revirtió en cadena.`);
    }
    console.log(`✓ Confirmada en el bloque ${receipt.blockNumber}`);

    // Gastar una nota devuelve el resto como una nota nueva, y esa nota no es
    // gastable hasta tener su Prueba de Inocencia. A diferencia de un blindaje,
    // cuya validación decide el proveedor de listas, la de una nota surgida de una
    // transferencia la genera el propio cliente: sin este paso el vuelto queda
    // inmovilizado hasta que alguien la solicite.
    await this.unlockChangeNotes();
    return hash;
  }

  /**
   * Transferencia privada emitida a través de un retransmisor.
   *
   * A diferencia de privateTransfer, la transacción no la firma ni la publica el
   * emisor: se la entrega cifrada a un retransmisor, que paga el gas en el token
   * nativo y se cobra dentro de la reserva, en el token transferido. El emisor no
   * necesita el token nativo y su dirección pública no aparece en la cadena.
   */
  async privateTransferViaBroadcaster(
    tokenAddress: string,
    amount: bigint,
    recipientRailgunAddress: string,
    maxFee?: bigint
  ): Promise<string> {
    this.ensureInitialized();
    if (!this.walletInfo) throw new Error("No hay wallet cargada");

    const txidVersion = this.getTxidVersion();
    const chain = this.getChain();

    console.log("Sincronizando estado antes del transfer...");
    await refreshBalances(chain, [this.walletInfo.id]);

    const broadcaster = await this.findBroadcaster(tokenAddress);

    const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
      { tokenAddress, amount, recipientAddress: recipientRailgunAddress },
    ];

    const feeTokenDetails: FeeTokenDetails = {
      tokenAddress: broadcaster.tokenAddress,
      feePerUnitGas: BigInt(broadcaster.tokenFee.feePerUnitGas),
    };

    // Con retransmisor el protocolo exige transacciones de tipo 1: la prueba se
    // compromete a un precio de gas único (overallBatchMinGasPrice), que el
    // esquema de tarifa variable del tipo 2 no permite fijar.
    const evmGasType = getEVMGasTypeForTransaction(this.networkName, false);
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 30_000_000_000n;

    const originalGasDetails = {
      evmGasType,
      gasEstimate: 2_000_000n,
      gasPrice,
    } as TransactionGasDetails;

    console.log("Estimando gas para transferencia privada...");
    const gasEstimateResponse = await gasEstimateForUnprovenTransfer(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      undefined,
      erc20AmountRecipients,
      [],
      originalGasDetails,
      feeTokenDetails,
      false // sendWithPublicWallet
    );

    const transactionGasDetails = {
      evmGasType,
      gasEstimate: gasEstimateResponse.gasEstimate,
      gasPrice,
    } as TransactionGasDetails;

    const fee = calculateBroadcasterFeeERC20Amount(
      feeTokenDetails,
      transactionGasDetails
    );
    console.log(
      `  comisión del retransmisor: ${ethers.formatUnits(fee.amount, 6)} ` +
        `(sobre un envío de ${ethers.formatUnits(amount, 6)})`
    );

    // La cotización proviene de un operador no autenticado, de modo que la
    // comisión se valida antes de comprometerla en la prueba: una vez generada,
    // el importe queda fijado dentro del lote.
    if (maxFee !== undefined && fee.amount > maxFee) {
      throw new Error(
        `La comisión del retransmisor (${ethers.formatUnits(fee.amount, 6)}) supera ` +
          `el máximo aceptado (${ethers.formatUnits(maxFee, 6)}). No se envía.`
      );
    }
    if (fee.amount > amount) {
      console.warn(
        `⚠ La comisión (${ethers.formatUnits(fee.amount, 6)}) supera al monto ` +
          `transferido: el costo de red no depende de cuánto se envíe.`
      );
    }

    // La comisión se descuenta del mismo saldo blindado, de modo que hace falta
    // cubrir monto y comisión juntos.
    const spendable = await this.getBalance(tokenAddress, true);
    if (spendable < amount + fee.amount) {
      throw new Error(
        `Saldo gastable insuficiente: hay ${ethers.formatUnits(spendable, 6)} y se ` +
          `necesitan ${ethers.formatUnits(amount + fee.amount, 6)} ` +
          `(${ethers.formatUnits(amount, 6)} de envío más la comisión).`
      );
    }

    // Generar la prueba lleva varios segundos; si la cotización vence entre medio,
    // el retransmisor la rechaza recién al recibirla.
    const segundosDeVigencia = broadcaster.tokenFee.expiration - Date.now() / 1000;
    if (segundosDeVigencia < 60) {
      throw new Error(
        `La cotización del retransmisor vence en ${Math.max(0, segundosDeVigencia).toFixed(0)} s, ` +
          `margen insuficiente para generar la prueba. Reintentá.`
      );
    }

    const broadcasterFeeERC20AmountRecipient: RailgunERC20AmountRecipient = {
      tokenAddress: fee.tokenAddress,
      amount: fee.amount,
      recipientAddress: broadcaster.railgunAddress,
    };

    const overallBatchMinGasPrice = gasPrice;

    console.log("Generando prueba ZK...");
    const t0 = Date.now();
    await generateTransferProof(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      this.encryptionKey,
      false,
      undefined,
      erc20AmountRecipients,
      [],
      broadcasterFeeERC20AmountRecipient,
      false, // sendWithPublicWallet
      overallBatchMinGasPrice,
      (progress: number, status: string) => {
        process.stdout.write(`\r  Prueba ZK: ${(progress * 100).toFixed(0)}% - ${status}`);
      }
    );
    console.log("");
    console.log(`✓ Prueba ZK generada en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const transferResponse = await populateProvedTransfer(
      txidVersion,
      this.networkName,
      this.walletInfo.id,
      false,
      undefined,
      erc20AmountRecipients,
      [],
      broadcasterFeeERC20AmountRecipient,
      false, // sendWithPublicWallet
      overallBatchMinGasPrice,
      transactionGasDetails
    );

    console.log("Entregando la transacción al retransmisor...");
    const broadcasterTx = await BroadcasterTransaction.create(
      txidVersion,
      transferResponse.transaction.to as string,
      transferResponse.transaction.data as string,
      broadcaster.railgunAddress,
      broadcaster.tokenFee.feesID,
      chain,
      transferResponse.nullifiers ?? [],
      overallBatchMinGasPrice,
      false, // useRelayAdapt
      transferResponse.preTransactionPOIsPerTxidLeafPerList ?? {}
    );

    const hash = await broadcasterTx.send();
    console.log(`✓ Publicada por el retransmisor: ${hash}`);

    // El retransmisor devuelve el hash apenas la difunde; que haya quedado
    // confirmada, y con éxito, es otra cosa.
    console.log("Esperando confirmación en cadena...");
    const receipt = await this.provider.waitForTransaction(hash, 1, 180_000);
    if (!receipt) {
      throw new Error(
        `La transacción ${hash} no se confirmó en 180 s. Puede confirmarse más tarde: ` +
          `verificá en un explorador antes de reintentar, para no gastar dos veces.`
      );
    }
    if (receipt.status !== 1) {
      throw new Error(`La transacción ${hash} revirtió en cadena.`);
    }
    console.log(`✓ Confirmada en el bloque ${receipt.blockNumber}`);

    // Gastar una nota devuelve el resto como una nota nueva, y esa nota no es
    // gastable hasta tener su Prueba de Inocencia. A diferencia de un blindaje,
    // cuya validación decide el proveedor de listas, la de una nota surgida de una
    // transferencia la genera el propio cliente: sin este paso el vuelto queda
    // inmovilizado hasta que alguien la solicite.
    await this.unlockChangeNotes();
    return hash;
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
    sendingWallet: ethers.Signer
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
      this.networkName,
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
      this.networkName,
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
      this.networkName,
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
    const from = await sendingWallet.getAddress();
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
    return NETWORK_CONFIG[this.networkName]?.proxyContract || "";
  }

  /**
   * Obtiene información de la red configurada
   */
  getNetworkInfo(): {
    name: SupportedNetwork;
    chainId: number;
    proxyContract: string;
  } {
    const config = NETWORK_CONFIG[this.networkName];
    return {
      name: this.config.networkName,
      chainId: config?.chain?.id || 0,
      proxyContract: config?.proxyContract || "",
    };
  }

  // === Helpers privados ===

  /** Traduce la red configurada al identificador del protocolo. */
  private get networkName(): NetworkName {
    return this.config.networkName as NetworkName;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        "Railgun no está inicializado. Llama a initialize() primero."
      );
    }
  }
}
