import { AliasRegistryClient } from "./AliasRegistryClient";
import type { RailgunService } from "./railgun/RailgunService";
import type { SendChannel } from "./SendChannel";
import { generateStealthMetaAddress } from "./StealthAddress";

/**
 * Operaciones que el sistema ofrece al usuario: registrar un alias y enviarle
 * fondos a otro. Realiza el módulo InterfazUsuario del diseño.
 *
 * Es el contexto del patrón estrategia: recibe un `SendChannel` ya elegido y le
 * delega la entrega de cada operación sin saber cuál es. Si el origen queda
 * expuesto se decide una sola vez, al construir el canal.
 */
export class AliasApp {
  constructor(
    private readonly registry: AliasRegistryClient,
    private readonly railgun: RailgunService,
    private readonly channel: SendChannel
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

    // La metadirección sigilosa se publica por compatibilidad con ERC-5564; el
    // flujo de pago del prototipo no la usa, de modo que sus claves privadas no
    // se conservan.
    const keys = generateStealthMetaAddress();
    const call = await this.registry.populateRegister(alias, keys.metaAddress, destination);
    return this.channel.send(call);
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
