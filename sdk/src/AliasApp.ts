import { ethers } from "ethers";
import { AliasRegistryClient } from "./AliasRegistryClient";
import type { RailgunService } from "./railgun/RailgunService";
import type { SendChannel } from "./SendChannel";
import { deriveStealthKeys } from "./StealthAddress";

/**
 * Operaciones que el sistema ofrece al usuario: registrar un alias y enviarle
 * fondos a otro. Realiza el módulo InterfazUsuario del diseño.
 *
 * Es el contexto del patrón estrategia: recibe un `SendChannel` ya elegido y le
 * delega la entrega de cada operación sin saber cuál es. Si el origen queda
 * expuesto se decide una sola vez, al construir el canal.
 */
export class AliasApp {
  /**
   * @param mnemonic - frase de recuperación del usuario, de la que se derivan
   * las claves sigilosas de cada alias que registre.
   */
  constructor(
    private readonly registry: AliasRegistryClient,
    private readonly railgun: RailgunService,
    private readonly channel: SendChannel,
    private readonly mnemonic: string
  ) {}

  /**
   * Registra un alias que recibe en la billetera Railgun cargada en el servicio.
   *
   * Rechaza el registro si esa billetera ya recibe los pagos de otro alias:
   * resolver ambos bastaría para vincularlos, por más que el registro se emita
   * por la vía privada.
   */
  async registerAlias(alias: string): Promise<string> {
    if (await this.registry.isRegistered(alias)) {
      throw new Error(`@${alias} ya está registrado.`);
    }

    const destination = this.railgun.getRailgunAddress();
    const linked = await this.registry.aliasesPointingTo(destination);
    if (linked.length > 0) {
      throw new Error(
        `Esta billetera ya recibe los pagos de @${linked.join(", @")}: ` +
          `registrar otro alias con ella los vincularía.`
      );
    }

    // Las claves sigilosas se derivan de la frase de recuperación y del alias:
    // no hay nada que guardar, y quien conserva la frase puede reconstruirlas.
    const keys = deriveStealthKeys(this.mnemonic, alias);
    const call = await this.registry.populateRegister(alias, keys.metaAddress, destination);
    return this.channel.send(call);
  }

  /**
   * Comprueba que la metadirección registrada para un alias sea la que se deriva
   * de esta frase de recuperación, es decir, que sus claves son recuperables.
   */
  async ownsStealthMetaAddress(alias: string): Promise<boolean> {
    const { stealthMetaAddress } = await this.registry.resolve(alias);
    const derived = ethers.hexlify(deriveStealthKeys(this.mnemonic, alias).metaAddress);
    return stealthMetaAddress.toLowerCase() === derived.toLowerCase();
  }

  /** Resuelve el alias del destinatario y le transfiere fondos dentro de la reserva. */
  async sendToAlias(alias: string, token: string, amount: bigint): Promise<string> {
    if (!(await this.registry.isRegistered(alias))) {
      throw new Error(`@${alias} no está registrado.`);
    }
    const recipient = await this.registry.resolveRailgun(alias);
    return this.channel.transfer(token, amount, recipient);
  }
}
