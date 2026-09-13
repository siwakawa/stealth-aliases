import { ethers, type ContractTransaction } from "ethers";
import type { RailgunService } from "./railgun/RailgunService";

/**
 * Vía por la que una operación del usuario llega a la cadena.
 *
 * Es la estrategia del patrón homónimo. Sus realizaciones deciden quién firma y
 * paga cada operación y, con ello, si el origen queda expuesto. Quien la usa
 * ---el contexto, `AliasApp`--- delega en ella sin saber cuál recibió.
 *
 * Las dos vías pagan de maneras incompatibles: una con gas desde una billetera
 * pública, otra con una comisión en fondos blindados. Para que las firmas sean
 * idénticas, la fuente de pago se fija al construir cada canal y no viaja con
 * las operaciones.
 */
export interface SendChannel {
  /** Entrega una invocación preparada, como un registro de alias. */
  send(preparedCall: ContractTransaction): Promise<string>;

  /** Transfiere fondos blindados a una dirección privada dentro de la reserva. */
  transfer(token: string, amount: bigint, recipient: string): Promise<string>;
}

/** Vías que el usuario puede elegir. */
export type Via = "direct" | "private";

/**
 * Vía directa: la billetera pública del usuario firma y paga el gas.
 * Su dirección queda en la cadena como emisor de cada transacción y, en un
 * registro, como `registrant` del evento.
 */
export class DirectChannel implements SendChannel {
  constructor(
    private readonly railgun: RailgunService,
    private readonly signer: ethers.Signer
  ) {}

  async send(preparedCall: ContractTransaction): Promise<string> {
    const tx = await this.signer.sendTransaction(preparedCall);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`La transacción ${tx.hash} revirtió en cadena.`);
    }
    return tx.hash;
  }

  transfer(token: string, amount: bigint, recipient: string): Promise<string> {
    return this.railgun.privateTransfer(token, amount, recipient, this.signer);
  }
}

/**
 * Vía privada: un retransmisor firma y publica, y cobra una comisión en fondos
 * blindados. Un registro viaja envuelto en una llamada del contrato Relay Adapt,
 * que es lo que el contrato de destino observa como `msg.sender`; una
 * transferencia no necesita envoltura. Ninguna billetera del usuario aparece en
 * la cadena.
 *
 * La comisión de un registro se paga en `feeToken`; la de una transferencia, en
 * el mismo token que se transfiere. `maxFee` acota ambas.
 */
export class PrivateChannel implements SendChannel {
  constructor(
    private readonly railgun: RailgunService,
    private readonly feeToken: string,
    private readonly maxFee?: bigint
  ) {}

  send(preparedCall: ContractTransaction): Promise<string> {
    return this.railgun.sendViaRelayAdapt(preparedCall, this.feeToken, this.maxFee);
  }

  transfer(token: string, amount: bigint, recipient: string): Promise<string> {
    return this.railgun.privateTransferViaBroadcaster(token, amount, recipient, this.maxFee);
  }
}

export interface ChannelOptions {
  railgun: RailgunService;
  /** Billetera pública; la vía directa la exige. */
  signer?: ethers.Signer;
  /** Token de la comisión de los registros por la vía privada. */
  feeToken: string;
  maxFee?: bigint;
}

/**
 * Construye el canal que corresponde a la vía elegida.
 *
 * Es el único punto donde se decide entre las dos realizaciones: de aquí en
 * adelante, el contexto trabaja contra `SendChannel`.
 */
export function createChannel(via: Via, options: ChannelOptions): SendChannel {
  switch (via) {
    case "direct":
      if (!options.signer) {
        throw new Error("La vía directa necesita una billetera pública que firme y pague el gas.");
      }
      return new DirectChannel(options.railgun, options.signer);
    case "private":
      return new PrivateChannel(options.railgun, options.feeToken, options.maxFee);
  }
}
