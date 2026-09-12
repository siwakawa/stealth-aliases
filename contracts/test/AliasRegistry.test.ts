import { expect } from "chai";
import { ethers } from "hardhat";
import { AliasRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AliasRegistry", function () {
  let registry: AliasRegistry;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  // Metadirección de ejemplo, en el orden que fija ERC-5564:
  // 66 bytes = clave de gasto (33) + clave de visualización (33)
  const sampleSpendingKey = "0x02" + "a".repeat(64);
  const sampleViewingKey = "0x03" + "b".repeat(64);
  const sampleMetaAddress = ethers.concat([
    sampleSpendingKey,
    sampleViewingKey,
  ]);

  // Dirección Railgun de ejemplo
  // Dirección Railgun de longitud realista (~127 caracteres). Usar una más corta
  // subestima el gas de registro: el argumento viaja como calldata y se almacena.
  const sampleRailgunAddress =
    "0zk1qy5tef39l30rlr05mvpzdfqglzqygm24qfrl" +
    "x8x0mq9v5n7k2j4h6g8f0d3s5a7q9w1e3r5t7y9u1i3o5p7a9s1d3f5g7h9j1k3l5";

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    const AliasRegistry = await ethers.getContractFactory("AliasRegistry");
    registry = await AliasRegistry.deploy();
  });

  describe("Registro de aliases", function () {
    it("debería registrar un alias válido con ambas direcciones", async function () {
      await expect(
        registry.connect(alice).register("alice", sampleMetaAddress, sampleRailgunAddress)
      )
        .to.emit(registry, "AliasRegistered")
        .withArgs(
          await registry.getAliasHash("alice"),
          "alice",
          sampleMetaAddress,
          sampleRailgunAddress,
          alice.address
        );

      expect(await registry.isRegistered("alice")).to.be.true;
    });

    it("debería normalizar aliases a minúsculas", async function () {
      await registry.connect(alice).register("ALICE", sampleMetaAddress, sampleRailgunAddress);

      const [meta, rk] = await registry.resolve("alice");
      expect(meta).to.equal(sampleMetaAddress);
      expect(rk).to.equal(sampleRailgunAddress);

      const [meta2, rk2] = await registry.resolve("Alice");
      expect(meta2).to.equal(sampleMetaAddress);
      expect(rk2).to.equal(sampleRailgunAddress);
    });

    it("debería permitir números y guiones bajos", async function () {
      await registry.connect(alice).register("alice_123", sampleMetaAddress, sampleRailgunAddress);
      expect(await registry.isRegistered("alice_123")).to.be.true;
    });

    it("debería rechazar aliases muy cortos", async function () {
      await expect(
        registry.connect(alice).register("ab", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: longitud invalida");
    });

    it("debería rechazar aliases muy largos", async function () {
      const longAlias = "a".repeat(33);
      await expect(
        registry.connect(alice).register(longAlias, sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: longitud invalida");
    });

    it("debería rechazar aliases que empiezan con _", async function () {
      await expect(
        registry.connect(alice).register("_alice", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: no puede empezar con _");
    });

    it("debería rechazar aliases que terminan con _", async function () {
      await expect(
        registry.connect(alice).register("alice_", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: no puede terminar con _");
    });

    it("debería rechazar caracteres especiales", async function () {
      await expect(
        registry.connect(alice).register("alice@bob", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");

      await expect(
        registry.connect(alice).register("alice.eth", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");

      await expect(
        registry.connect(alice).register("alice-bob", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: caracter no permitido");
    });

    it("debería rechazar metadirecciones de longitud incorrecta", async function () {
      const shortMeta = "0x" + "aa".repeat(32);
      const longMeta = "0x" + "aa".repeat(70);

      await expect(
        registry.connect(alice).register("alice", shortMeta, sampleRailgunAddress)
      ).to.be.revertedWith("Metadireccion: debe ser 66 bytes");

      await expect(
        registry.connect(alice).register("alice", longMeta, sampleRailgunAddress)
      ).to.be.revertedWith("Metadireccion: debe ser 66 bytes");
    });

    it("debería rechazar registro duplicado", async function () {
      await registry.connect(alice).register("alice", sampleMetaAddress, sampleRailgunAddress);

      await expect(
        registry.connect(bob).register("alice", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: ya registrado");

      await expect(
        registry.connect(bob).register("ALICE", sampleMetaAddress, sampleRailgunAddress)
      ).to.be.revertedWith("Alias: ya registrado");
    });
  });

  describe("Validación de dirección Railgun", function () {
    it("debería rechazar dirección Railgun vacía", async function () {
      await expect(
        registry.connect(alice).register("alice", sampleMetaAddress, "")
      ).to.be.revertedWith("Railgun: longitud invalida");
    });

    it("debería rechazar dirección Railgun muy corta", async function () {
      await expect(
        registry.connect(alice).register("alice", sampleMetaAddress, "0zk")
      ).to.be.revertedWith("Railgun: longitud invalida");
    });

    it("debería rechazar dirección que no empiece con 0zk", async function () {
      await expect(
        registry.connect(alice).register("alice", sampleMetaAddress, "0x1234567890abcdef")
      ).to.be.revertedWith("Railgun: debe empezar con 0zk");
    });

    it("debería aceptar dirección Railgun válida", async function () {
      const longRailgunAddr = "0zk" + "a".repeat(125);
      await registry.connect(alice).register("alice", sampleMetaAddress, longRailgunAddr);
      expect(await registry.isRegistered("alice")).to.be.true;
    });
  });

  describe("Resolución de aliases", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("alice", sampleMetaAddress, sampleRailgunAddress);
    });

    it("debería resolver un alias con ambas direcciones", async function () {
      const [meta, rk] = await registry.resolve("alice");
      expect(meta).to.equal(sampleMetaAddress);
      expect(rk).to.equal(sampleRailgunAddress);
    });

    it("debería resolver solo la dirección Railgun", async function () {
      const rk = await registry.resolveRailgun("alice");
      expect(rk).to.equal(sampleRailgunAddress);
    });

    it("debería retornar vacío para alias inexistente", async function () {
      const [meta, rk] = await registry.resolve("nonexistent");
      expect(meta).to.equal("0x");
      expect(rk).to.equal("");
    });

    it("debería resolver por hash", async function () {
      const hash = await registry.getAliasHash("alice");
      const [meta, rk] = await registry.resolveByHash(hash);
      expect(meta).to.equal(sampleMetaAddress);
      expect(rk).to.equal(sampleRailgunAddress);
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

  describe("Formato de la metadirección (ERC-5564)", function () {
    it("debería preservar el orden de claves: gasto primero, visualización después", async function () {
      // El estándar fija la clave de gasto en los primeros 33 bytes. El registro
      // guarda la metadirección como una secuencia opaca, de modo que quien la
      // construye es responsable del orden; esta prueba impide que se invierta
      // sin que nadie lo note, que fue exactamente lo que ocurrió una vez.
      await registry.connect(alice).register("formato", sampleMetaAddress, sampleRailgunAddress);

      const [meta] = await registry.resolve("formato");
      expect(ethers.dataLength(meta)).to.equal(66);
      expect(ethers.dataSlice(meta, 0, 33)).to.equal(sampleSpendingKey);
      expect(ethers.dataSlice(meta, 33, 66)).to.equal(sampleViewingKey);
    });
  });

  describe("Casos de borde", function () {
    it("debería manejar alias de longitud mínima (3)", async function () {
      await registry.connect(alice).register("abc", sampleMetaAddress, sampleRailgunAddress);
      expect(await registry.isRegistered("abc")).to.be.true;
    });

    it("debería manejar alias de longitud máxima (32)", async function () {
      const maxAlias = "a".repeat(32);
      await registry.connect(alice).register(maxAlias, sampleMetaAddress, sampleRailgunAddress);
      expect(await registry.isRegistered(maxAlias)).to.be.true;
    });

    it("debería manejar alias solo con números", async function () {
      await registry.connect(alice).register("123", sampleMetaAddress, sampleRailgunAddress);
      expect(await registry.isRegistered("123")).to.be.true;
    });

    it("debería manejar guión bajo en el medio", async function () {
      await registry.connect(alice).register("a_b_c", sampleMetaAddress, sampleRailgunAddress);
      expect(await registry.isRegistered("a_b_c")).to.be.true;
    });
  });

  describe("Gas estimation", function () {
    it("debería registrar con gas razonable", async function () {
      const tx = await registry.connect(alice).register("alice", sampleMetaAddress, sampleRailgunAddress);
      const receipt = await tx.wait();

      console.log("Gas usado para registro:", receipt?.gasUsed.toString());

      // V2 usa más gas que V1 por el campo string adicional. El umbral se fija
      // sobre una dirección Railgun de longitud realista: con el dato de ejemplo
      // truncado que se usaba antes, el registro medía unas 191.000 unidades y el
      // umbral no reflejaba el costo real en la red (236.567 medidas en Polygon).
      expect(receipt?.gasUsed).to.be.lessThan(250000n);
    });
  });
});
