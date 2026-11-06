import { z } from "zod";

const precoAdicionalSchema = z
  .number()
  .finite()
  .min(0)
  .max(99_999_999.99)
  .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8, {
    message: "O preço do adicional deve ter no máximo duas casas decimais.",
  });

export const adicionalConfiguradoSchema = z
  .object({
    id: z.string().uuid(),
    nome: z.string().trim().min(1).max(100),
    preco: precoAdicionalSchema,
    ativo: z.boolean(),
    quantidadeMaxima: z.number().int().min(1).max(100).default(1),
  })
  .strict();

export const adicionaisConfiguradosSchema = z
  .array(adicionalConfiguradoSchema)
  .superRefine((adicionais, contexto) => {
    const ids = new Set<string>();
    adicionais.forEach((adicional, index) => {
      if (ids.has(adicional.id)) {
        contexto.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "O ID do adicional deve ser único no item.",
        });
      }
      ids.add(adicional.id);
    });
  });

export const adicionalSelecionadoSchema = z
  .object({
    id: z.string().uuid(),
    quantidade: z.number().int().min(1).max(100),
  })
  .strict();

export const adicionaisSelecionadosSchema = z
  .array(adicionalSelecionadoSchema)
  .superRefine((selecionados, contexto) => {
    const ids = new Set<string>();
    selecionados.forEach((adicional, index) => {
      if (ids.has(adicional.id)) {
        contexto.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "O mesmo adicional não pode ser enviado mais de uma vez.",
        });
      }
      ids.add(adicional.id);
    });
  });

export type AdicionalConfigurado = z.infer<
  typeof adicionalConfiguradoSchema
>;
export type AdicionalSelecionado = z.infer<
  typeof adicionalSelecionadoSchema
>;

export function lerAdicionaisPublicos(valor: unknown): AdicionalConfigurado[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  const porId = new Map<string, AdicionalConfigurado | null>();
  for (const candidato of valor) {
    const adicional = adicionalConfiguradoSchema.safeParse(candidato);
    if (!adicional.success) {
      continue;
    }

    if (porId.has(adicional.data.id)) {
      porId.set(adicional.data.id, null);
    } else {
      porId.set(adicional.data.id, adicional.data);
    }
  }

  return [...porId.values()].filter(
    (adicional): adicional is AdicionalConfigurado =>
      adicional !== null && adicional.ativo,
  );
}

export function validarSelecaoAdicionais(
  configuracao: unknown,
  selecaoRecebida: unknown,
): Array<AdicionalConfigurado & { quantidade: number }> {
  const selecao = adicionaisSelecionadosSchema.parse(selecaoRecebida);
  const porId = new Map<string, AdicionalConfigurado | null>();
  if (Array.isArray(configuracao)) {
    for (const candidato of configuracao) {
      const resultado = adicionalConfiguradoSchema.safeParse(candidato);
      if (!resultado.success) {
        continue;
      }

      if (porId.has(resultado.data.id)) {
        porId.set(resultado.data.id, null);
      } else {
        porId.set(resultado.data.id, resultado.data);
      }
    }
  }

  return selecao.map(({ id, quantidade }) => {
    const adicional = porId.get(id);
    if (!adicional || !adicional.ativo) {
      throw new Error("ADICIONAL_INDISPONIVEL");
    }
    if (quantidade > adicional.quantidadeMaxima) {
      throw new Error("QUANTIDADE_ADICIONAL_INVALIDA");
    }

    return { ...adicional, quantidade };
  });
}
