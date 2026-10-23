# Sprint 02 — Tratamento centralizado de erros

**Estado:** Concluída segundo o estado conhecido; verificar antes de alterar.

## Objetivo
Manter um formato consistente de erro sem expor detalhes internos e sem confiar em `statusCode` arbitrário.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Ler `src/plugins/erros.ts`, o registro em `src/app.ts` e `docs/06_PADRAO_DAS_ROTAS_API.md`.
2. Executar os testes existentes de erro e confirmar o formato das respostas.
3. Verificar erros de validação Zod, erros HTTP reconhecidos, rota inexistente, exceção inesperada e erro de serialização.
4. Não criar outro plugin nem duplicar a lógica central.
5. Se encontrar falha, registrar um caso reproduzível e corrigir somente o necessário.

## Arquivos envolvidos
- ``src/plugins/erros.ts`, `src/app.ts`, `tests/api/erros.test.ts`, `docs/06_PADRAO_DAS_ROTAS_API.md``

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
- [ ] Erros esperados têm status e formato consistentes; falhas inesperadas viram 500 genérico; detalhes internos ficam no log; testes passam.

## O que esta sprint ensina
Códigos HTTP, erros de validação, tratamento centralizado e segurança de mensagens.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
