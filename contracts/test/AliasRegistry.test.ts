import { expect } from "chai";
import { ethers } from "hardhat";
import { AliasRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AliasRegistry", function () {
  let registry: AliasRegistry;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  // Metadirección de ejemplo (66 bytes = 33 spending + 33 viewing)
  // Formato: 0x02/0x03 + 32 bytes X (comprimido)
  const sampleMetaAddress = ethers.concat([
    // Spending pubkey (33 bytes) - ejemplo con prefijo 02
    "0x02" + "a".repeat(64),
    // Viewing pubkey (33 bytes) - ejemplo con prefijo 03
    "0x03" + "b".repeat(64),
  ]);

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const AliasRegistry = await ethers.getContractFactory("AliasRegistry");
    registry = await AliasRegistry.deploy();
  });

  describe("Registro de aliases", function () {
    it("debería registrar un alias válido", async function () {
      await expect(registry.connect(alice).register("alice", sampleMetaAddress))
        .to.emit(registry, "AliasRegistered")
        .withArgs(
          await registry.getAliasHash("alice"),
          "alice",
          sampleMetaAddress,
          alice.address
        );

      expect(await registry.isRegistered("alice")).to.be.true;
    });

    it("debería normalizar aliases a minúsculas", async function () {
      await registry.connect(alice).register("ALICE", sampleMetaAddress);

      // Ambas formas deberían resolver al mismo valor
      expect(await registry.resolve("alice")).to.equal(sampleMetaAddress);
      expect(await registry.resolve("ALICE")).to.equal(sampleMetaAddress);
      expect(await registry.resolve("Alice")).to.equal(sampleMetaAddress);
    });

    it("debería permitir números y guiones bajos", async function () {
      await registry.connect(alice).register("alice_123", sampleMetaAddress);
      expect(await registry.isRegistered("alice_123")).to.be.true;
    });

    it("debería rechazar aliases muy cortos", async function () {
      await expect(
        registry.connect(alice).register("ab", sampleMetaAddress)
      ).to.be.revertedWith("Alias: longitud invalida");
    });

    it("debería rechazar aliases muy largos", async function () {
      const longAlias = "a".repeat(33);
      await expect(
        registry.connect(alice).register(longAlias, sampleMetaAddress)
      ).to.be.revertedWith("Alias: longitud invalida");
    });

    it("debería rechazar aliases que empiezan con _", async function () {
      await expect(
        registry.connect(alice).register("_alice", sampleMetaAddress)
      ).to.be.revertedWith("Alias: no puede empezar con _");
    });

    it("debería rechazar aliases que terminan con _", async function () {
      await expect(
        registry.connect(alice).register("alice_", sampleMetaAddress)
      ).to.be.revertedWith("Alias: no puede terminar con _");
    });

    it("debería rechazar caracteres especiales", async function () {
      await expect(
        registry.connect(alice).register("alice@bob", sampleMetaAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");

      await expect(
        registry.connect(alice).register("alice.eth", sampleMetaAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");

      await expect(
        registry.connect(alice).register("alice-bob", sampleMetaAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");
    });

    it("debería rechazar metadirecciones de longitud incorrecta", async function () {
      const shortMeta = "0x" + "aa".repeat(32); // 32 bytes
      const longMeta = "0x" + "aa".repeat(70); // 70 bytes

      await expect(
        registry.connect(alice).register("alice", shortMeta)
      ).to.be.revertedWith("Metadireccion: debe ser 66 bytes");

      await expect(
        registry.connect(alice).register("alice", longMeta)
      ).to.be.revertedWith("Metadireccion: debe ser 66 bytes");
    });

    it("debería rechazar registro duplicado", async function () {
      await registry.connect(alice).register("alice", sampleMetaAddress);

      await expect(
        registry.connect(bob).register("alice", sampleMetaAddress)
      ).to.be.revertedWith("Alias: ya registrado");

      // También con diferente capitalización
      await expect(
        registry.connect(bob).register("ALICE", sampleMetaAddress)
      ).to.be.revertedWith("Alias: ya registrado");
    });
  });

  describe("Resolución de aliases", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("alice", sampleMetaAddress);
    });

    it("debería resolver un alias existente", async function () {
      const result = await registry.resolve("alice");
      expect(result).to.equal(sampleMetaAddress);
    });

    it("debería retornar bytes vacíos para alias inexistente", async function () {
      const result = await registry.resolve("nonexistent");
      expect(result).to.equal("0x");
    });

    it("debería resolver por hash", async function () {
      const hash = await registry.getAliasHash("alice");
      const result = await registry.resolveByHash(hash);
      expect(result).to.equal(sampleMetaAddress);
    });

    it("debería verificar registro correctamente", async function () {
      expect(await registry.isRegistered("alice")).to.be.true;
      expect(await registry.isRegistered("bob")).to.be.false;
    });

    it("debería verificar registro por hash", async function () {
      const aliceHash = await registry.getAliasHash("alice");
      const bobHash = await registry.getAliasHash("bob");

      expect(await registry.isRegisteredByHash(aliceHash)).to.be.true;
      expect(await registry.isRegisteredByHash(bobHash)).to.be.false;
    });
  });

  describe("Casos de borde", function () {
    it("debería manejar alias de longitud mínima (3)", async function () {
      await registry.connect(alice).register("abc", sampleMetaAddress);
      expect(await registry.isRegistered("abc")).to.be.true;
    });

    it("debería manejar alias de longitud máxima (32)", async function () {
      const maxAlias = "a".repeat(32);
      await registry.connect(alice).register(maxAlias, sampleMetaAddress);
      expect(await registry.isRegistered(maxAlias)).to.be.true;
    });

    it("debería manejar alias solo con números", async function () {
      await registry.connect(alice).register("123", sampleMetaAddress);
      expect(await registry.isRegistered("123")).to.be.true;
    });

    it("debería manejar guión bajo en el medio", async function () {
      await registry.connect(alice).register("a_b_c", sampleMetaAddress);
      expect(await registry.isRegistered("a_b_c")).to.be.true;
    });
  });

  describe("Gas estimation", function () {
    it("debería registrar con gas razonable", async function () {
      const tx = await registry.connect(alice).register("alice", sampleMetaAddress);
      const receipt = await tx.wait();

      console.log("Gas usado para registro:", receipt?.gasUsed.toString());

      // Debería ser menor a 150,000 gas (el entorno de test consume más)
      expect(receipt?.gasUsed).to.be.lessThan(150000n);
    });
  });
});
