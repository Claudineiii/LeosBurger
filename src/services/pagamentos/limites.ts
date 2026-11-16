import { createHash, randomUUID } from "node:crypto";

export type OperacaoLimite =
  | "COBRANCA_INICIAL"
  | "SEGUNDA_TENTATIVA"
  | "RECUPERACAO_TOKEN"
  | "SOLICITACAO_CANCELAMENTO"
  | "CONSULTA_ACOMPANHAMENTO";

export type OperacaoCobranca = OperacaoLimite;
type ConfiguracaoLimite = { maximo: number; janelaMs: number };

const janelas = new Map<string, {
  inicio: number;
  janelaMs: number;
  solicitacoes: Set<string>;
}>();

function numeroPositivo(nome: string): number | null {
  const recebido = process.env[nome];
  if (!recebido) return null;
  const valor = Number(recebido);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
}

function configuracao(operacao: OperacaoLimite): ConfiguracaoLimite | null {
  const maximo = numeroPositivo(`PAGAMENTOS_RATE_LIMIT_${operacao}`);
  const janelaSegundos = numeroPositivo("PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS");
  if (maximo !== null && janelaSegundos !== null) {
    return { maximo, janelaMs: janelaSegundos * 1_000 };
  }
  // Testes têm limite alto, isolado por processo; os testes do rate limiter
  // fornecem uma configuração explícita e baixa para validar o bloqueio.
  if (process.env.NODE_ENV === "test") {
    return { maximo: Number.MAX_SAFE_INTEGER, janelaMs: 60_000 };
  }
  if (operacao === "CONSULTA_ACOMPANHAMENTO") {
    return { maximo: 60, janelaMs: 60_000 };
  }
  if (process.env.NODE_ENV !== "production") {
    return { maximo: 60, janelaMs: 60_000 };
  }
  return null;
}

export function verificarConfiguracaoLimitesPagamento() {
  if (process.env.NODE_ENV !== "production") return;
  for (const nome of [
    "PAGAMENTOS_RATE_LIMIT_COBRANCA_INICIAL",
    "PAGAMENTOS_RATE_LIMIT_SEGUNDA_TENTATIVA",
    "PAGAMENTOS_RATE_LIMIT_JANELA_SEGUNDOS",
  ]) {
    if (numeroPositivo(nome) === null) {
      throw new Error(`CONFIGURACAO_OBRIGATORIA:${nome}`);
    }
  }
}

export function limitarCobranca(input: {
  operacao: OperacaoLimite;
  identificador: string;
  idempotencyKey?: string;
  agora?: number;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    input.operacao !== "CONSULTA_ACOMPANHAMENTO"
  ) {
    // O adaptador Redis compartilhado pertence à Sprint 17. Até existir,
    // bloquear escrita financeira em vez de cair para memória por processo.
    throw new Error("RATE_LIMITER_DISTRIBUIDO_INDISPONIVEL");
  }
  const config = configuracao(input.operacao);
  if (!config) throw new Error("LIMITES_PAGAMENTO_NAO_CONFIGURADOS");
  const agora = input.agora ?? Date.now();
  for (const [chaveAntiga, janelaAntiga] of janelas) {
    if (agora - janelaAntiga.inicio >= janelaAntiga.janelaMs) {
      janelas.delete(chaveAntiga);
    }
  }
  const escopo = createHash("sha256")
    .update(`${input.operacao}:${input.identificador}`)
    .digest("hex");
  const chave = `${input.operacao}:${escopo}`;
  const idRequisicao = input.idempotencyKey
    ? createHash("sha256").update(input.idempotencyKey).digest("hex")
    : createHash("sha256").update(randomUUID()).digest("hex");
  let janela = janelas.get(chave);
  if (!janela || agora - janela.inicio >= config.janelaMs) {
    janela = {
      inicio: agora,
      janelaMs: config.janelaMs,
      solicitacoes: new Set<string>(),
    };
    janelas.set(chave, janela);
  }
  if (janela.solicitacoes.has(idRequisicao)) return;
  if (janela.solicitacoes.size >= config.maximo) {
    throw new Error("RATE_LIMIT_PAGAMENTO_EXCEDIDO");
  }
  janela.solicitacoes.add(idRequisicao);
}

export function limparLimitesPagamentoParaTeste() {
  janelas.clear();
}
