import { expect } from "chai";
import { ethers } from "hardhat";

import { AliasApp } from "../../sdk/src/AliasApp";
import { AliasRegistryClient } from "../../sdk/src/AliasRegistryClient";
import {
  createChannel,
  DirectChannel,
  PrivateChannel,
  type SendChannel,
} from "../../sdk/src/SendChannel";

/**
 * Estrategia y contexto del kit de desarrollo contra el contrato local.
 *
 * El servicio de Railgun se reemplaza por un doble que registra las llamadas:
 * lo que se prueba es a quién delega cada pieza, no la maquinaria del protocolo.
 */
describe("Canal de envío y AliasApp", function () {
  const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
  const railgunAlice = "0zk1qy" + "a".repeat(121);
  const railgunBob = "0zk1qy" + "b".repeat(121);

  let registryAddress: string;
  let chainId: number;

  function fakeRailgun(railgunAddress: string) {
    const calls: { method: string; args: unknown[] }[] = [];
    const record =
      (method: string) =>
      async (...args: unknown[]) => {
        calls.push({ method, args });
        return "0x" + "f".repeat(64);
      };
    return {
      calls,
      getRailgunAddress: () => railgunAddress,
      privateTransfer: record("privateTransfer"),
      privateTransferViaBroadcaster: record("privateTransferViaBroadcaster"),
      sendViaRelayAdapt: record("sendViaRelayAdapt"),
    };
  }

  function clientFor(runner: any) {
    return new AliasRegistryClient(runner, registryAddress, chainId);
  }

  beforeEach(async function () {
    const registry = await (await ethers.getContractFactory("AliasRegistry")).deploy();
    await registry.waitForDeployment();
    registryAddress = await registry.getAddress();
    chainId = Number((await ethers.provider.getNetwork()).chainId);
  });

  describe("Selección de la estrategia", function () {
    it("construye el canal que corresponde a cada vía", async function () {
      const [signer] = await ethers.getSigners();
      const railgun = fakeRailgun(railgunAlice) as any;
      const options = { railgun, signer: signer as any, feeToken: USDC };
      expect(createChannel("direct", options)).to.be.instanceOf(DirectChannel);
      expect(createChannel("private", options)).to.be.instanceOf(PrivateChannel);
    });

    it("rechaza la vía directa sin billetera pública", async function () {
      const railgun = fakeRailgun(railgunAlice) as any;
      expect(() => createChannel("direct", { railgun, feeToken: USDC })).to.throw(/billetera pública/);
    });
  });

  describe("Vía directa", function () {
    it("registra desde la billetera del usuario, que queda como registrante", async function () {
      const [signer] = await ethers.getSigners();
      const railgun = fakeRailgun(railgunAlice) as any;
      const client = clientFor(ethers.provider);
      const app = new AliasApp(client, railgun, createChannel("direct", { railgun, signer: signer as any, feeToken: USDC }));

      const hash = await app.registerAlias("alice");

      const registry = await ethers.getContractAt("AliasRegistry", registryAddress);
      const receipt = await ethers.provider.getTransactionReceipt(hash);
      const event = registry.interface.parseLog(receipt!.logs[0])!;
      expect(event.args.registrant).to.equal(signer.address);
      expect(await client.resolveRailgun("alice")).to.equal(railgunAlice);
    });

    it("transfiere firmando con la billetera pública", async function () {
      const [signer] = await ethers.getSigners();
      const railgun = fakeRailgun(railgunAlice);
      const channel = createChannel("direct", { railgun: railgun as any, signer: signer as any, feeToken: USDC });

      await channel.transfer(USDC, 10_000n, railgunBob);

      expect(railgun.calls).to.have.length(1);
      expect(railgun.calls[0].method).to.equal("privateTransfer");
      expect(railgun.calls[0].args.slice(0, 3)).to.deep.equal([USDC, 10_000n, railgunBob]);
      expect(railgun.calls[0].args[3]).to.equal(signer);
    });
  });

  describe("Vía privada", function () {
    it("entrega el registro a Relay Adapt con la comisión en el token indicado", async function () {
      const railgun = fakeRailgun(railgunAlice);
      const client = clientFor(ethers.provider);
      const app = new AliasApp(client, railgun as any, createChannel("private", { railgun: railgun as any, feeToken: USDC, maxFee: 200_000n }));

      await app.registerAlias("alice");

      expect(railgun.calls).to.have.length(1);
      const [call, feeToken, maxFee] = railgun.calls[0].args as any[];
      expect(railgun.calls[0].method).to.equal("sendViaRelayAdapt");
      expect(call.to).to.equal(registryAddress);
      expect(feeToken).to.equal(USDC);
      expect(maxFee).to.equal(200_000n);
    });

    it("transfiere por retransmisor, sin billetera pública", async function () {
      const railgun = fakeRailgun(railgunAlice);
      const channel = createChannel("private", { railgun: railgun as any, feeToken: USDC, maxFee: 200_000n });

      await channel.transfer(USDC, 10_000n, railgunBob);

      expect(railgun.calls[0].method).to.equal("privateTransferViaBroadcaster");
      expect(railgun.calls[0].args).to.deep.equal([USDC, 10_000n, railgunBob, 200_000n]);
    });
  });

  describe("Contexto", function () {
    it("envía a un alias delegando en el canal que recibió, sea cual sea", async function () {
      const [signer] = await ethers.getSigners();
      const railgunB = fakeRailgun(railgunBob) as any;
      const client = clientFor(ethers.provider);
      await new AliasApp(client, railgunB, createChannel("direct", { railgun: railgunB, signer: signer as any, feeToken: USDC })).registerAlias("bob");

      const received: unknown[][] = [];
      const recordingChannel: SendChannel = {
        send: async () => "0x",
        transfer: async (...args) => {
          received.push(args);
          return "0x";
        },
      };
      const app = new AliasApp(client, fakeRailgun(railgunAlice) as any, recordingChannel);

      await app.sendToAlias("bob", USDC, 10_000n);

      expect(received).to.deep.equal([[USDC, 10_000n, railgunBob]]);
    });

    it("no envía a un alias sin registrar", async function () {
      const app = new AliasApp(clientFor(ethers.provider), fakeRailgun(railgunAlice) as any, {
        send: async () => "0x",
        transfer: async () => {
          throw new Error("no debería transferir");
        },
      });
      await expectRejection(app.sendToAlias("nadie", USDC, 1n), /no está registrado/);
    });

    it("no registra un segundo alias sobre la misma billetera, que los vincularía", async function () {
      const [signer] = await ethers.getSigners();
      const railgun = fakeRailgun(railgunAlice) as any;
      const app = new AliasApp(clientFor(ethers.provider), railgun, createChannel("direct", { railgun, signer: signer as any, feeToken: USDC }));

      await app.registerAlias("alice");
      await expectRejection(app.registerAlias("alice2"), /ya recibe los pagos de @alice/);
    });
  });
});

async function expectRejection(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise;
  } catch (e: any) {
    expect(e.message).to.match(pattern);
    return;
  }
  expect.fail("se esperaba un error");
}
