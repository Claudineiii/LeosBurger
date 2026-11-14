import { randomUUID } from "node:crypto";
import type {
  CobrancaCriada,
  EstadoCobranca,
  EventoCobranca,
  ProvedorPagamentos,
} from "./contrato.js";

export type CenarioSimulacao =
  | "PENDENTE"
  | "PAGO"
  | "FALHOU"
  | "RECUSADO"
  | "EXPIRADO"
  | "TARDIO"
  | "DUPLICADO";

export class SimuladorPagamentos implements ProvedorPagamentos {
  private readonly cobrancas = new Map<string, CobrancaCriada>();

  constructor(ambiente = process.env.NODE_ENV) {
    if (ambiente === "production") {
      throw new Error("SIMULADOR_PAGAMENTOS_PROIBIDO_EM_PRODUCAO");
    }
  }

  async criarCobranca(input: {
    tentativaId: string;
  }): Promise<CobrancaCriada> {
    const existente = this.cobrancas.get(input.tentativaId);
    if (existente) return existente;
    const cobranca: CobrancaCriada = {
      identificador: input.tentativaId,
      estado: "PENDENTE",
      transacao: null,
    };
    this.cobrancas.set(input.tentativaId, cobranca);
    return cobranca;
  }

  async consultarCobranca(identificador: string) {
    return this.cobrancas.get(identificador) ?? null;
  }

  normalizarEvento(input: unknown): EventoCobranca {
    if (!input || typeof input !== "object") {
      throw new Error("EVENTO_PAGAMENTO_INVALIDO");
    }
    const evento = input as Partial<EventoCobranca>;
    if (
      typeof evento.idEvento !== "string" ||
      typeof evento.identificadorCobranca !== "string" ||
      !evento.idEvento ||
      !evento.identificadorCobranca ||
      !["PENDENTE", "PAGO", "FALHOU", "RECUSADO", "EXPIRADO"].includes(
        String(evento.estado),
      )
    ) {
      throw new Error("EVENTO_PAGAMENTO_INVALIDO");
    }
    const ocorridoEm = evento.ocorridoEm instanceof Date
      ? evento.ocorridoEm
      : new Date(String(evento.ocorridoEm ?? ""));
    if (Number.isNaN(ocorridoEm.getTime())) {
      throw new Error("EVENTO_PAGAMENTO_INVALIDO");
    }
    return {
      idEvento: evento.idEvento,
      identificadorCobranca: evento.identificadorCobranca,
      identificadorTransacao:
        typeof evento.identificadorTransacao === "string"
          ? evento.identificadorTransacao
          : null,
      estado: evento.estado as EstadoCobranca,
      ocorridoEm,
    };
  }

  async criarEvento(input: {
    tentativaId: string;
    cenario: CenarioSimulacao;
    dataEvento?: Date;
    idEvento?: string;
  }): Promise<EventoCobranca[]> {
    const cenario: EstadoCobranca =
      input.cenario === "TARDIO" || input.cenario === "DUPLICADO"
        ? "PAGO"
        : input.cenario;
    const evento: EventoCobranca = {
      idEvento: input.idEvento ?? randomUUID(),
      identificadorCobranca: input.tentativaId,
      identificadorTransacao: cenario === "PAGO" ? `sim-${input.tentativaId}` : null,
      estado: cenario,
      ocorridoEm: input.dataEvento ?? new Date(),
    };
    const cobrancaAtual = this.cobrancas.get(input.tentativaId);
    if (cobrancaAtual) {
      this.cobrancas.set(input.tentativaId, {
        ...cobrancaAtual,
        estado: cenario,
        transacao: evento.identificadorTransacao,
      });
    }
    const primeiro = this.normalizarEvento(evento);
    return input.cenario === "DUPLICADO"
      ? [primeiro, { ...primeiro }]
      : [primeiro];
  }
}
