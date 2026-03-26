import { ethers } from "ethers";

/**
 * Stealth Meta-Address: 66 bytes
 * - viewing pubkey: 33 bytes (compressed)
 * - spending pubkey: 33 bytes (compressed)
 */
export interface StealthKeys {
  viewingPrivateKey: string;
  viewingPublicKey: string;
  spendingPrivateKey: string;
  spendingPublicKey: string;
  metaAddress: string; // 66 bytes hex
}

/**
 * Genera un nuevo par de claves sigilosas
 */
export function generateStealthKeys(): StealthKeys {
  // Generar claves de visualización
  const viewingWallet = ethers.Wallet.createRandom();
  const viewingPrivateKey = viewingWallet.privateKey;
  const viewingSigningKey = new ethers.SigningKey(viewingPrivateKey);
  const viewingPublicKey = viewingSigningKey.compressedPublicKey;

  // Generar claves de gasto
  const spendingWallet = ethers.Wallet.createRandom();
  const spendingPrivateKey = spendingWallet.privateKey;
  const spendingSigningKey = new ethers.SigningKey(spendingPrivateKey);
  const spendingPublicKey = spendingSigningKey.compressedPublicKey;

  // Concatenar para formar la meta-address (66 bytes)
  const metaAddress =
    viewingPublicKey + spendingPublicKey.slice(2); // Quitar 0x del segundo

  return {
    viewingPrivateKey,
    viewingPublicKey,
    spendingPrivateKey,
    spendingPublicKey,
    metaAddress,
  };
}

/**
 * Parsea una meta-address en sus componentes
 */
export function parseMetaAddress(metaAddress: string): {
  viewingPublicKey: string;
  spendingPublicKey: string;
} {
  // 66 bytes = 132 hex chars + 2 for "0x" = 134
  if (metaAddress.length !== 134) {
    throw new Error(`Meta-address inválida: esperados 134 chars, recibidos ${metaAddress.length}`);
  }

  return {
    viewingPublicKey: metaAddress.slice(0, 68), // 0x + 66 chars = 33 bytes
    spendingPublicKey: "0x" + metaAddress.slice(68), // 66 chars = 33 bytes
  };
}

/**
 * Genera una stealth address para un pago
 */
export function generateStealthAddress(metaAddress: string): {
  stealthAddress: string;
  ephemeralPublicKey: string;
  viewTag: string;
} {
  const { viewingPublicKey, spendingPublicKey } = parseMetaAddress(metaAddress);

  // Generar clave efímera
  const ephemeralWallet = ethers.Wallet.createRandom();
  const ephemeralSigningKey = new ethers.SigningKey(ephemeralWallet.privateKey);
  const ephemeralPublicKey = ephemeralSigningKey.compressedPublicKey;

  // Shared secret (simplificado para demo)
  const combined = ethers.concat([
    ethers.getBytes(ephemeralWallet.privateKey),
    ethers.getBytes(viewingPublicKey),
  ]);
  const sharedSecret = ethers.keccak256(combined);

  // View tag (primer byte del hash)
  const viewTag = "0x" + sharedSecret.slice(2, 4);

  // Derivar stealth address (simplificado)
  const stealthHash = ethers.keccak256(
    ethers.concat([ethers.getBytes(spendingPublicKey), ethers.getBytes(sharedSecret)])
  );
  const stealthSigningKey = new ethers.SigningKey(stealthHash);
  const stealthAddress = ethers.computeAddress(stealthSigningKey.publicKey);

  return {
    stealthAddress,
    ephemeralPublicKey,
    viewTag,
  };
}

/**
 * Acorta una dirección para mostrar
 */
export function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Acorta una meta-address para mostrar
 */
export function shortenMetaAddress(metaAddress: string): string {
  return `${metaAddress.slice(0, 12)}...${metaAddress.slice(-8)}`;
}
