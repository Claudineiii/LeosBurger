# LEOSBurger — Pacote de documentação para desenvolvimento com agentes

**Projeto:** LEOSBurger  
**Repositório local informado:** `C:/LeosBurger`  
**Idioma dos documentos:** português  
**Status:** fundação do backend validada; APIs de negócio ainda serão implementadas gradualmente.

## Como usar este pacote

1. Leia `01_ESTADO_ATUAL.md` para saber o que já existe e o que foi validado.
2. Leia `02_ARQUITETURA_E_INFRAESTRUTURA.md` para entender a organização técnica.
3. Leia `03_REGRAS_DE_NEGOCIO.md` antes de propor qualquer mudança de comportamento.
4. Leia `04_MODELO_DE_DADOS_E_INTEGRIDADE.md` antes de alterar Prisma, migrations ou banco.
5. Leia `05_PLANO_DE_APIS.md` para distinguir endpoints planejados dos implementados.
6. Leia `06_TESTES.md` antes de executar testes ou migrations de teste.
7. Leia `06_PADRAO_DAS_ROTAS_API.md` ao verificar ou criar rotas HTTP.
8. Use `AGENTS.md` na raiz como instrução persistente para agentes que trabalhem no repositório.

## Regra de ouro

A documentação descreve decisões e estado conhecidos, mas **não substitui a inspeção do código real**. Antes de alterar o projeto, o agente deve verificar `git status`, os últimos commits, `package.json`, `prisma/schema.prisma`, migrations, `src/` e `tests/`. Se o código contradisser este pacote, não corrigir silenciosamente: informar a divergência e pedir decisão quando ela afetar arquitetura, regras de negócio ou dados.

## Índice

- `AGENTS.md` — instruções para agentes de código.
- `01_ESTADO_ATUAL.md` — tecnologias, arquivos e validações já realizadas.
- `02_ARQUITETURA_E_INFRAESTRUTURA.md` — arquitetura lógica e ambiente local.
- `03_REGRAS_DE_NEGOCIO.md` — escopo e regras aprovadas.
- `04_MODELO_DE_DADOS_E_INTEGRIDADE.md` — tabelas, relações e invariantes.
- `05_PLANO_DE_APIS.md` — plano de endpoints por domínio; não é implementação.
- `06_TESTES.md` — configuração e execução de testes com proteção do banco.
- `06_PADRAO_DAS_ROTAS_API.md` — convenções verificadas para implementar e testar rotas.

## Convenções deste pacote

- **Implementado/validado:** observado no histórico recente do projeto.
- **Planejado:** decisão de escopo ou próxima etapa, ainda não necessariamente codificada.
- **A confirmar no código:** detalhe que precisa ser verificado no repositório atual.
- Os nomes das tabelas e domínios são em português.
- Não usar React/JSX.
- Não atualizar Prisma para a versão 7 sem decisão explícita.
