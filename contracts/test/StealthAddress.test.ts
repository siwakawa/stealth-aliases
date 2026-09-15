import { expect } from "chai";
import { ethers } from "ethers";

import {
  checkStealthAddress,
  deriveStealthKeys,
  generateStealthAddress,
} from "../../sdk/src/StealthAddress";
import reference from "./fixtures/erc5564-vectors.json";

/**
 * Direcciones sigilosas del kit de desarrollo.
 *
 * Los vectores de referencia se generaron con @scopelift/stealth-address-sdk,
 * la implementación de los autores de ERC-5564. Coincidir con ella es lo que
 * hace que una billetera de terceros pueda pagar a una metadirección registrada
 * y que el receptor reconozca el pago.
 */
describe("Direcciones sigilosas", function () {
  const mnemonic = "test test test test test test test test test test test junk";

  describe("Compatibilidad con la implementación de referencia de ERC-5564", function () {
    for (const [i, v] of reference.vectors.entries()) {
      it(`deriva la misma dirección, clave efímera y etiqueta de vista (vector ${i + 1})`, function () {
        const generated = generateStealthAddress(v.stealthMetaAddress, ethers.getBytes(v.ephemeralPrivateKey));
        expect(generated.stealthAddress).to.equal(v.stealthAddress);
        expect(ethers.hexlify(generated.ephemeralPublicKey)).to.equal(v.ephemeralPublicKey);
        expect(generated.viewTag).to.equal(Number(v.viewTag));
      });

      it(`reconoce el pago y obtiene la misma clave privada sigilosa (vector ${i + 1})`, function () {
        const meta = ethers.getBytes(v.stealthMetaAddress);
        const announcement = {
          stealthAddress: v.stealthAddress,
          ephemeralPublicKey: ethers.getBytes(v.ephemeralPublicKey),
          viewTag: Number(v.viewTag),
        };
        const result = checkStealthAddress(
          announcement,
          ethers.getBytes(v.viewingPrivateKey),
          meta.slice(0, 33),
          ethers.getBytes(v.spendingPrivateKey)
        );
        expect(result.isOurs).to.equal(true);
        expect(ethers.hexlify(result.stealthPrivateKey!)).to.equal(v.stealthPrivateKey);
      });
    }
  });

  describe("Derivación determinística de claves", function () {
    it("la misma frase y el mismo alias producen siempre las mismas claves", function () {
      const a = deriveStealthKeys(mnemonic, "alice");
      const b = deriveStealthKeys(mnemonic, "alice");
      expect(ethers.hexlify(a.metaAddress)).to.equal(ethers.hexlify(b.metaAddress));
      expect(ethers.hexlify(a.spending.privateKey)).to.equal(ethers.hexlify(b.spending.privateKey));
    });

    it("aliases distintos obtienen metadirecciones distintas", function () {
      const alice = deriveStealthKeys(mnemonic, "alice");
      const bob = deriveStealthKeys(mnemonic, "bob");
      expect(ethers.hexlify(alice.metaAddress)).to.not.equal(ethers.hexlify(bob.metaAddress));
    });

    it("el alias se normaliza como en el contrato", function () {
      const upper = deriveStealthKeys(mnemonic, "ALICE");
      const lower = deriveStealthKeys(mnemonic, "alice");
      expect(ethers.hexlify(upper.metaAddress)).to.equal(ethers.hexlify(lower.metaAddress));
    });

    it("la metadirección pone la clave de gasto primero, como fija ERC-5564", function () {
      const keys = deriveStealthKeys(mnemonic, "alice");
      expect(ethers.hexlify(keys.metaAddress.slice(0, 33))).to.equal(ethers.hexlify(keys.spending.publicKey));
      expect(ethers.hexlify(keys.metaAddress.slice(33))).to.equal(ethers.hexlify(keys.viewing.publicKey));
    });

    it("con las claves reconstruidas se puede cobrar un pago a la metadirección", function () {
      const published = deriveStealthKeys(mnemonic, "alice").metaAddress;
      const payment = generateStealthAddress(published);

      // El receptor reconstruye sus claves a partir de la frase, sin estado guardado.
      const recovered = deriveStealthKeys(mnemonic, "alice");
      const result = checkStealthAddress(
        payment,
        recovered.viewing.privateKey,
        recovered.spending.publicKey,
        recovered.spending.privateKey
      );

      expect(result.isOurs).to.equal(true);
      expect(new ethers.Wallet(ethers.hexlify(result.stealthPrivateKey!)).address).to.equal(payment.stealthAddress);
    });
  });
});
