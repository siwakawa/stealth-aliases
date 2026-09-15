import { ethers } from "ethers";

/**
 * Módulo DireccionesSigilosas del diseño.
 *
 * Exporta sus tres operaciones ---generarClaves, derivarSigilosa y
 * compruebaPropiedad--- como deriveStealthKeys, generateStealthAddress y
 * checkStealthAddress. El resto del archivo es interno.
 */

/** Metadirección ERC-5564 descompuesta: clave de gasto primero, como fija el estándar. */
interface StealthMetaAddress {
  spendingPublicKey: Uint8Array; // 33 bytes (secp256k1 comprimida)
  viewingPublicKey: Uint8Array; // 33 bytes (secp256k1 comprimida)
}

/** Par de claves sigilosas. */
export interface StealthKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 33 bytes comprimida
}

/** ClavesSigilosas: los dos pares de un alias y la metadirección que los publica. */
export interface StealthKeys {
  viewing: StealthKeyPair;
  spending: StealthKeyPair;
  metaAddress: Uint8Array;
}

/** AnuncioSigiloso: lo que el remitente publica junto al pago. */
export interface StealthAnnouncement {
  stealthAddress: string;
  ephemeralPublicKey: Uint8Array;
  viewTag: number;
}

/** Comprobación: si el pago es del receptor y, si aportó su clave de gasto, la clave sigilosa. */
export interface StealthCheck {
  isOurs: boolean;
  stealthPrivateKey?: Uint8Array;
}

// Propósito propio para las rutas de derivación de claves sigilosas, distinto
// de los que usan Ethereum (44') y Railgun (44'/1984', 420'/1984').
const STEALTH_PURPOSE = 5564;

/**
 * Normaliza un alias igual que el contrato: mayúsculas ASCII a minúsculas.
 */
function normalizeAlias(alias: string): string {
  return alias.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Índice de derivación de un alias: los primeros 31 bits de keccak256 del alias
 * normalizado, de modo que cada alias tiene claves propias y se recuperan sin
 * guardar ningún estado.
 */
function aliasIndex(alias: string): number {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(normalizeAlias(alias)));
  return parseInt(hash.slice(2, 10), 16) & 0x7fffffff;
}

function keyPairAt(mnemonic: string, path: string): StealthKeyPair {
  const node = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
  return {
    privateKey: ethers.getBytes(node.privateKey),
    publicKey: ethers.getBytes(node.signingKey.compressedPublicKey),
  };
}

/**
 * Deriva las claves sigilosas de un alias a partir de la frase de recuperación.
 *
 * Rutas endurecidas m/5564'/<índice del alias>'/0' (gasto) y .../1'
 * (visualización). La misma frase y el mismo alias producen siempre las mismas
 * claves, así que quien conserva la frase puede reconstruirlas y cobrar lo que
 * llegue a la metadirección publicada. Aliases distintos obtienen metadirecciones
 * distintas, que por lo tanto no se vinculan entre sí.
 */
export function deriveStealthKeys(mnemonic: string, alias: string): StealthKeys {
  const base = `m/${STEALTH_PURPOSE}'/${aliasIndex(alias)}'`;
  const spending = keyPairAt(mnemonic, `${base}/0'`);
  const viewing = keyPairAt(mnemonic, `${base}/1'`);

  const metaAddress = new Uint8Array(66);
  metaAddress.set(spending.publicKey, 0);
  metaAddress.set(viewing.publicKey, 33);

  return { viewing, spending, metaAddress };
}

/**
 * Parsea una stealth meta-address de 66 bytes
 */
function parseStealthMetaAddress(
  metaAddress: Uint8Array | string
): StealthMetaAddress {
  const bytes =
    typeof metaAddress === "string"
      ? ethers.getBytes(metaAddress)
      : metaAddress;

  if (bytes.length !== 66) {
    throw new Error(`Meta-address debe ser 66 bytes, recibido: ${bytes.length}`);
  }

  return {
    spendingPublicKey: bytes.slice(0, 33),
    viewingPublicKey: bytes.slice(33, 66),
  };
}

/**
 * Genera una stealth address para un pago específico
 * Implementación según ERC-5564
 *
 * @param metaAddress - La stealth meta-address del receptor
 * @param ephemeralPrivateKey - Clave efímera del remitente (opcional, se genera si no se provee)
 * @returns La stealth address y datos necesarios para el receptor
 */
export function generateStealthAddress(
  metaAddress: Uint8Array | string,
  ephemeralPrivateKey?: Uint8Array
): StealthAnnouncement {
  const { viewingPublicKey, spendingPublicKey } =
    parseStealthMetaAddress(metaAddress);

  // Generar clave efímera si no se provee
  const ephPrivKey = ephemeralPrivateKey || ethers.randomBytes(32);
  const ephSigningKey = new ethers.SigningKey(ephPrivKey);
  const ephPubKey = ethers.getBytes(ephSigningKey.compressedPublicKey);

  // Shared secret: ECDH(ephemeral_private, viewing_public)
  const sharedSecret = computeSharedSecret(ephPrivKey, viewingPublicKey);

  // Hash del shared secret
  const hashedSecret = ethers.keccak256(ethers.hexlify(sharedSecret));
  const hashedSecretBytes = ethers.getBytes(hashedSecret);

  // View tag: primer byte del hash (para optimización de escaneo)
  const viewTag = hashedSecretBytes[0];

  // Stealth public key = spending_public + hash(shared_secret) * G
  const stealthPubKey = addPublicKeys(spendingPublicKey, hashedSecretBytes);
  // computeAddress necesita clave no comprimida
  const stealthAddress = ethers.computeAddress(
    ethers.SigningKey.computePublicKey(ethers.hexlify(stealthPubKey), false)
  );

  return {
    stealthAddress,
    ephemeralPublicKey: ephPubKey,
    viewTag,
  };
}

/**
 * Comprueba si un anuncio sigiloso corresponde al receptor.
 *
 * @param announcement - Dirección sigilosa, clave pública efímera y etiqueta de vista
 * @param viewingPrivateKey - Clave privada de visualización del receptor
 * @param spendingPublicKey - Clave pública de gasto del receptor
 * @param spendingPrivateKey - Clave privada de gasto; si se aporta, se deriva la
 *   clave sigilosa que permite disponer de los fondos
 */
export function checkStealthAddress(
  announcement: StealthAnnouncement,
  viewingPrivateKey: Uint8Array,
  spendingPublicKey: Uint8Array,
  spendingPrivateKey?: Uint8Array
): StealthCheck {
  const { stealthAddress, ephemeralPublicKey, viewTag } = announcement;

  // Shared secret: ECDH(viewing_private, ephemeral_public)
  const sharedSecret = computeSharedSecret(viewingPrivateKey, ephemeralPublicKey);
  const hashedSecret = ethers.keccak256(ethers.hexlify(sharedSecret));
  const hashedSecretBytes = ethers.getBytes(hashedSecret);

  // Verificar view tag primero (optimización: descarta 255/256 de los anuncios)
  if (hashedSecretBytes[0] !== viewTag) {
    return { isOurs: false };
  }

  // Calcular la stealth address esperada: P_stealth = P_spending + hash(S) * G
  const expectedPubKey = addPublicKeys(spendingPublicKey, hashedSecretBytes);
  const expectedAddress = ethers.computeAddress(
    ethers.SigningKey.computePublicKey(ethers.hexlify(expectedPubKey), false)
  );

  if (expectedAddress.toLowerCase() !== stealthAddress.toLowerCase()) {
    return { isOurs: false };
  }

  // Si es nuestra y tenemos la spending private key, derivar la clave privada de la stealth address
  // stealth_private = spending_private + hash(shared_secret) mod n
  if (spendingPrivateKey) {
    const stealthPrivKey = addPrivateKeys(spendingPrivateKey, hashedSecretBytes);
    return { isOurs: true, stealthPrivateKey: stealthPrivKey };
  }

  return { isOurs: true };
}

// Orden de la curva secp256k1
const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

// === Funciones auxiliares de criptografía ===


/**
 * Secreto compartido ECDH, codificado como punto comprimido (33 bytes).
 *
 * ERC-5564 no fija cómo se codifica el punto antes de hashearlo. Se usa el punto
 * comprimido porque es lo que hace la implementación de referencia de los autores
 * del estándar (@scopelift/stealth-address-sdk); con otra codificación, las
 * direcciones derivadas no serían reconocibles por las billeteras que la usan.
 */
function computeSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const signingKey = new ethers.SigningKey(ethers.hexlify(privateKey));
  // computeSharedSecret devuelve el punto sin comprimir (04 || x || y)
  const sharedPoint = signingKey.computeSharedSecret(ethers.hexlify(publicKey));
  return ethers.getBytes(ethers.SigningKey.computePublicKey(sharedPoint, true));
}

/**
 * Suma una clave pública con un escalar multiplicado por G
 * P' = P + scalar * G
 * Implementación real usando ethers.SigningKey.addPoints
 */
function addPublicKeys(
  publicKey: Uint8Array,
  scalar: Uint8Array
): Uint8Array {
  // scalar * G = tweak point (derivar clave pública del escalar)
  const tweakSigningKey = new ethers.SigningKey(ethers.hexlify(scalar));
  const tweakPubKey = tweakSigningKey.compressedPublicKey;
  // P_stealth = P + scalar*G (point addition real sobre secp256k1)
  const result = ethers.SigningKey.addPoints(
    ethers.hexlify(publicKey),
    tweakPubKey,
    true // comprimido
  );
  return ethers.getBytes(result);
}

/**
 * Suma dos claves privadas módulo el orden de secp256k1
 * result = (a + b) mod n
 */
function addPrivateKeys(a: Uint8Array, b: Uint8Array): Uint8Array {
  const aBig = BigInt(ethers.hexlify(a));
  const bBig = BigInt(ethers.hexlify(b));
  const result = (aBig + bBig) % SECP256K1_ORDER;
  // Convertir a 32 bytes con padding de ceros
  const hex = result.toString(16).padStart(64, "0");
  return ethers.getBytes("0x" + hex);
}
