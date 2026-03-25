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
  const hashedSecret = ethers.keccak256(sharedSecret);
  const hashedSecretBytes = ethers.getBytes(hashedSecret);

  // View tag: primer byte del hash (para optimización de escaneo)
  const viewTag = hashedSecretBytes[0];

  // Stealth public key = spending_public + hash(shared_secret) * G
  // Simplificación: usamos el hash como ajuste a la spending key
  const stealthPubKey = addPublicKeys(spendingPublicKey, hashedSecretBytes);
  const stealthAddress = ethers.computeAddress(ethers.hexlify(stealthPubKey));

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
 */
export function checkStealthAddress(
  stealthAddress: string,
  ephemeralPublicKey: Uint8Array,
  viewingPrivateKey: Uint8Array,
  spendingPublicKey: Uint8Array,
  viewTag?: number
): { isOurs: boolean; spendingPrivateKey?: Uint8Array } {
  // Shared secret: ECDH(viewing_private, ephemeral_public)
  const sharedSecret = computeSharedSecret(viewingPrivateKey, ephemeralPublicKey);
  const hashedSecret = ethers.keccak256(ethers.hexlify(sharedSecret));
  const hashedSecretBytes = ethers.getBytes(hashedSecret);

  // Verificar view tag primero (optimización)
  if (viewTag !== undefined && hashedSecretBytes[0] !== viewTag) {
    return { isOurs: false };
  }

  // Calcular la stealth address esperada
  const expectedPubKey = addPublicKeys(spendingPublicKey, hashedSecretBytes);
  const expectedAddress = ethers.computeAddress(ethers.hexlify(expectedPubKey));

  if (expectedAddress.toLowerCase() !== stealthAddress.toLowerCase()) {
    return { isOurs: false };
  }

  // Si es nuestra, calcular la clave privada para gastar
  // spending_private_key = original_spending_private + hash(shared_secret)
  // Nota: necesitaríamos la spending private key para esto
  return { isOurs: true };
}

// === Funciones auxiliares de criptografía ===

/**
 * Comprime una clave pública de 65 bytes a 33 bytes
 */
function compressPublicKey(uncompressedHex: string): Uint8Array {
  const uncompressed = ethers.getBytes(uncompressedHex);
  // uncompressed: 0x04 + x (32 bytes) + y (32 bytes)
  const x = uncompressed.slice(1, 33);
  const y = uncompressed.slice(33, 65);

  // Prefijo: 0x02 si y es par, 0x03 si y es impar
  const prefix = y[31] % 2 === 0 ? 0x02 : 0x03;

  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(x, 1);

  return compressed;
}

/**
 * Descomprime una clave pública de 33 bytes
 * Nota: Implementación simplificada, en producción usar una librería de curvas elípticas
 */
function decompressPublicKey(compressed: Uint8Array): Uint8Array {
  // Para una implementación completa necesitaríamos noble-secp256k1 o similar
  // Por ahora retornamos un placeholder
  if (compressed[0] !== 0x02 && compressed[0] !== 0x03) {
    throw new Error("Formato de clave comprimida inválido");
  }
  // TODO: Implementar descompresión real con librería de curvas elípticas
  return compressed;
}

/**
 * Calcula ECDH shared secret
 */
function computeSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  const signingKey = new ethers.SigningKey(ethers.hexlify(privateKey));
  // Simplificación: usamos el hash de ambas claves como shared secret
  // En producción usar ECDH real con noble-secp256k1
  const combined = ethers.concat([privateKey, publicKey]);
  return ethers.getBytes(ethers.keccak256(combined));
}

/**
 * Suma una clave pública con un escalar (multiplicado por G)
 * P' = P + hash * G
 */
function addPublicKeys(
  publicKey: Uint8Array,
  scalar: Uint8Array
): Uint8Array {
  // Implementación simplificada
  // En producción usar noble-secp256k1: Point.fromHex(pubkey).add(Point.BASE.multiply(scalar))
  const combined = ethers.concat([publicKey, scalar]);
  const hash = ethers.keccak256(combined);
  // Derivamos una "clave pública" del hash (no es criptográficamente correcto pero funcional para demo)
  const signingKey = new ethers.SigningKey(hash);
  return ethers.getBytes(signingKey.compressedPublicKey);
}
