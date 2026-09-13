import { ethers, type ContractTransaction } from "ethers";
import type { RailgunService } from "./railgun/RailgunService";

/**
 * Canal por el que una invocación preparada llega a la cadena.
 *
 * Realiza el patrón estrategia: quien registra un alias programa contra esta
 * interfaz y elige la realización sin que su lógica cambie. El secreto de cada
 * realización es el mecanismo de entrega y, con él, si el origen de quien
 * invoca queda expuesto.
 *
 * Las dos vías pagan de maneras incompatibles ---una con gas desde una billetera
 * pública, otra con una comisión en fondos blindados---. Para que `send` tenga la
 * misma firma en ambas, la fuente de pago se fija al construir cada canal y no
 * viaja con la invocación.
 */
export interface SendChannel {
  /** Entrega la invocación y devuelve el hash de la transacción confirmada. */
  send(preparedCall: ContractTransaction): Promise<string>;
}

/**
 * Vía directa: firma y publica la invocación desde la billetera del registrante.
 * Su dirección queda en la cadena como emisor de la transacción y, en el caso de
 * un registro, como `registrant` del evento.
 */
export class DirectChannel implements SendChannel {
  constructor(private readonly signer: ethers.Signer) {}

  async send(preparedCall: ContractTransaction): Promise<string> {
    const tx = await this.signer.sendTransaction(preparedCall);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`La transacción ${tx.hash} revirtió en cadena.`);
    }
    return tx.hash;
  }
}

/**
 * Vía privada: envuelve la invocación en una llamada del contrato Relay Adapt y
 * la entrega a un retransmisor. El contrato de destino observa como `msg.sender`
 * la dirección de Relay Adapt, y quien firma es el retransmisor: ninguna
 * billetera del registrante aparece en la cadena.
 *
 * Paga con una comisión en fondos blindados de la billetera cargada en el
 * servicio, en el token indicado.
 */
export class RelayAdaptChannel implements SendChannel {
  constructor(
    private readonly railgun: RailgunService,
    private readonly feeTokenAddress: string,
    private readonly maxFee?: bigint
  ) {}

  send(preparedCall: ContractTransaction): Promise<string> {
    return this.railgun.sendViaRelayAdapt(
      preparedCall,
      this.feeTokenAddress,
      this.maxFee
    );
  }
}
