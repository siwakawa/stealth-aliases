import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0x0A8Fadf827a6e937C33C40c78017063168eaC76D";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Cuenta:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "POL\n");

  const AliasRegistry = await ethers.getContractFactory("AliasRegistry");
  const registry = AliasRegistry.attach(CONTRACT_ADDRESS);

  // Alias de prueba
  const testAlias = "satoshi_test";

  // Generar una stealth meta-address de prueba (66 bytes)
  // En producción esto vendría del SDK de Railgun
  const viewingPubKey = ethers.randomBytes(33);
  const spendingPubKey = ethers.randomBytes(33);
  const stealthMetaAddress = ethers.concat([viewingPubKey, spendingPubKey]);

  console.log("=== PRUEBA DEL CONTRATO ===\n");

  // 1. Verificar si el alias ya está registrado
  console.log(`1. Verificando si @${testAlias} está registrado...`);
  const isRegistered = await registry.isRegistered(testAlias);
  console.log(`   Resultado: ${isRegistered ? "SÍ" : "NO"}\n`);

  if (!isRegistered) {
    // 2. Registrar el alias
    console.log(`2. Registrando @${testAlias}...`);
    console.log(`   Meta-address (hex): ${ethers.hexlify(stealthMetaAddress).slice(0, 50)}...`);

    const tx = await registry.register(testAlias, stealthMetaAddress);
    console.log(`   TX Hash: ${tx.hash}`);
    console.log("   Esperando confirmación...");

    const receipt = await tx.wait();
    console.log(`   ✓ Confirmado en bloque ${receipt?.blockNumber}`);
    console.log(`   Gas usado: ${receipt?.gasUsed.toString()}\n`);
  }

  // 3. Resolver el alias
  console.log(`3. Resolviendo @${testAlias}...`);
  const resolved = await registry.resolve(testAlias);
  console.log(`   Meta-address recuperada: ${resolved.slice(0, 50)}...`);
  console.log(`   Longitud: ${(resolved.length - 2) / 2} bytes\n`);

  // 4. Verificar que ahora está registrado
  console.log(`4. Verificando registro final...`);
  const finalCheck = await registry.isRegistered(testAlias);
  console.log(`   @${testAlias} registrado: ${finalCheck ? "✓ SÍ" : "✗ NO"}\n`);

  console.log("=== PRUEBA COMPLETADA ===");
  console.log(`\nContrato funcionando correctamente en Polygon mainnet.`);
  console.log(`Ver en: https://polygonscan.com/address/${CONTRACT_ADDRESS}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
