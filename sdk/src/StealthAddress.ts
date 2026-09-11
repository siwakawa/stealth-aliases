import { ethers } from "ethers";

/**
 * Stealth Meta-Address según ERC-5564
 * 66 bytes = viewing pubkey (33 compressed) + spending pubkey (33 compressed)
 */
export interface StealthMetaAddress {
  viewingPublicKey: Uint8Array; // 33 bytes (compressed secp256k1)
  spendingPublicKey: Uint8Array; // 33 bytes (compressed secp256k1)
}

/**
 * Par de claves para stealth addresses
 */
export interface StealthKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array; // 33 bytes compressed
}

/**
 * Genera un par de claves aleatorio
 */
export function generateKeyPair(): StealthKeyPair {
  const privateKey = ethers.randomBytes(32);
  const signingKey = new ethers.SigningKey(privateKey);
  const publicKey = ethers.getBytes(signingKey.compressedPublicKey);
  return { privateKey, publicKey };
}

/**
 * Genera una stealth meta-address completa (viewing + spending keys)
 */
export function generateStealthMetaAddress(): {
  viewing: StealthKeyPair;
  spending: StealthKeyPair;
  metaAddress: Uint8Array;
} {
  const viewing = generateKeyPair();
  const spending = generateKeyPair();

  // Concatenar: viewing pubkey (33) + spending pubkey (33) = 66 bytes
  const metaAddress = new Uint8Array(66);
  metaAddress.set(viewing.publicKey, 0);
  metaAddress.set(spending.publicKey, 33);

  return { viewing, spending, metaAddress };
}

/**
 * Parsea una stealth meta-address de 66 bytes
 */
export function parseStealthMetaAddress(
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
    viewingPublicKey: bytes.slice(0, 33),
    spendingPublicKey: bytes.slice(33, 66),
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
): {
  stealthAddress: string;
  ephemeralPublicKey: Uint8Array;
  viewTag: number;
} {
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
 * Verifica si una stealth address nos pertenece (para el receptor)
 *
 * @param stealthAddress - La dirección a verificar
 * @param ephemeralPublicKey - Clave pública efímera del remitente
 * @param viewingPrivateKey - Nuestra clave privada de visualización
 * @param spendingPublicKey - Nuestra clave pública de gasto
 * @param viewTag - View tag para optimización (opcional)
 * @param spendingPrivateKey - Nuestra clave privada de gasto (necesaria para derivar la clave de la stealth address)
 */
export function checkStealthAddress(
  stealthAddress: string,
  ephemeralPublicKey: Uint8Array,
  viewingPrivateKey: Uint8Array,
  spendingPublicKey: Uint8Array,
  viewTag?: number,
  spendingPrivateKey?: Uint8Array
): { isOurs: boolean; stealthPrivateKey?: Uint8Array } {
  // Shared secret: ECDH(viewing_private, ephemeral_public)
  const sharedSecret = computeSharedSecret(viewingPrivateKey, ephemeralPublicKey);
  const hashedSecret = ethers.keccak256(ethers.hexlify(sharedSecret));
  const hashedSecretBytes = ethers.getBytes(hashedSecret);

  // Verificar view tag primero (optimización: descarta 255/256 de los anuncios)
  if (viewTag !== undefined && hashedSecretBytes[0] !== viewTag) {
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
 * Calcula ECDH shared secret (coordenada X del punto compartido)
 * Implementación real usando ethers.SigningKey.computeSharedSecret
 */
function computeSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const signingKey = new ethers.SigningKey(ethers.hexlify(privateKey));
  // computeSharedSecret retorna el punto completo (04 || x || y)
  const sharedPoint = signingKey.computeSharedSecret(
    ethers.hexlify(publicKey)
  );
  // Extraer coordenada X (bytes 1-33, saltando el prefijo 04)
  return ethers.getBytes(sharedPoint).slice(1, 33);
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
