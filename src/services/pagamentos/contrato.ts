export type EstadoCobranca =
  | "PENDENTE"
  | "PAGO"
  | "FALHOU"
  | "RECUSADO"
  | "EXPIRADO";

export type CobrancaCriada = {
  identificador: string;
  estado: EstadoCobranca;
  transacao: string | null;
};

export type EventoCobranca = {
  idEvento: string;
  identificadorCobranca: string;
  identificadorTransacao: string | null;
  estado: EstadoCobranca;
  ocorridoEm: Date;
};

export interface ProvedorPagamentos {
  criarCobranca(input: {
    pedidoId: string;
    tentativaId: string;
    valor: string;
    metodo: "PIX" | "CREDITO" | "DEBITO" | "DINHEIRO";
    idempotencyKey: string;
  }): Promise<CobrancaCriada>;
  consultarCobranca(identificador: string): Promise<CobrancaCriada | null>;
  normalizarEvento(input: unknown): EventoCobranca;
}
