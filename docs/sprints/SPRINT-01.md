# Sprint 01 — Fundação da aplicação

**Estado:** Concluída segundo o estado conhecido; verificar antes de alterar.

## Objetivo

A aplicação Fastify inicia, `GET /health` responde e o ambiente de teste consegue executar testes automatizados.

## Antes de começar

1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md`, `docs/06_PADRAO_DAS_ROTAS_API.md`, `MAPA.md`quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo

1. Inspecionar `package.json`, `tsconfig.json`, `src/app.ts`, `src/server.ts` e configuração do Vitest.
2. Confirmar que `src/app.ts` monta a aplicação sem abrir a porta e que `src/server.ts` é responsável pela inicialização.
3. Executar o build e a suíte de testes existentes.
4. Conferir a rota `GET /health` e seu teste; não recriar o que já existe.
5. Registrar qualquer diferença entre a documentação e o repositório antes de seguir.

## Arquivos envolvidos

- ``src/app.ts`, `src/server.ts`, `src/routes/health.ts`, configuração de testes`

Os caminhos são indicativos. Confirme a estrutura real antes de criar arquivos e reutilize os existentes quando apropriado.

## Como validar

Execute primeiro o teste específico da rota ou funcionalidade, depois a suíte completa e o build. Comandos conhecidos:

```bash
npm test -- --run
npm run build
git diff --check
```

Confira `package.json` antes de usar um comando específico de teste. Não contorne a proteção do banco de testes.

## Critérios de conclusão

- [ ] Build e testes passam; rota de saúde retorna sucesso e JSON esperado; nenhum segredo versionado.

## O que esta sprint ensina

Fastify, separação entre criação da aplicação e inicialização do servidor, testes HTTP.

## Delegação opcional ao agente de código

Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir

- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
