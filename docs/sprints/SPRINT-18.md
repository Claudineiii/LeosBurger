# Sprint 18 — Auditoria final e documentação

**Estado:** Última sprint do backend.

## Objetivo
Confirmar que o backend está consistente, testado e documentado antes da integração final/deploy.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Conferir o estado do Git, arquivos modificados e commits pendentes. Não sobrescrever trabalho não relacionado.
2. Executar build, suíte completa de testes e `git diff --check`; usar scripts existentes no `package.json`.
3. Comparar cada rota real com o OpenAPI e corrigir divergências de contratos, respostas e erros.
4. Revisar `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md`, `docs/07_TESTES.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` conforme a estrutura real.
5. Confirmar que README e documentação de setup descrevem comandos, variáveis necessárias e dependências reais, sem segredos.
6. Verificar que o modelo de oito tabelas e migrações não sofreu alterações não aprovadas.
7. Verificar as regras fixas: JWT sem revogação; prazos de sessão; estados e fluxos; visitante PIX; taxas de entrega; adicionais JSON; cupons sem tabela; sem exclusão física; sem gateway real.
8. Confirmar que cada sprint concluída tem evidência: testes, build, arquivos modificados e documentação atualizada.
9. Gerar um resumo final com concluído, pendente, riscos conhecidos e próximos passos. Não declarar produção pronta se ainda faltarem integração frontend/backend ou configuração de deploy.

## Arquivos envolvidos
- `Documentação existente e arquivos de estado; não criar documentos redundantes sem necessidade`

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
- [ ] Código, testes, OpenAPI e docs estão alinhados; estado do Git é conhecido; nenhuma decisão aprovada foi alterada; pendências são explícitas.

## O que esta sprint ensina
Auditoria de entrega, documentação como fonte de continuidade e rastreabilidade.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
