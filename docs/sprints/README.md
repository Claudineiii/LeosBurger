# LEOSBurger — Plano de Sprints do Backend

## Como usar esta pasta

Esta pasta contém o mapa geral e um arquivo Markdown por sprint. Ela foi preparada para ser copiada para `C:/LeosBurger/docs/sprints/`.

**Antes de executar uma sprint:** confira o estado real do repositório. Uma sprint descrita aqui é um plano de trabalho, não uma afirmação de que a funcionalidade ainda está ausente. Se a rota ou os testes já existirem, audite-os e ajuste a sprint em vez de duplicar implementação.

## Ordem de execução

- Sprints 1 e 2: fundação e tratamento de erros — estado conhecido como concluído; verificar o repositório.
- Sprint 3: listagem pública de itens.
- Sprint 4: detalhes de um item.
- Sprint 5: listagem pública de combos.
- Sprint 6: detalhes de um combo.
- Sprint 7: autenticação JWT e autorização.
- Sprint 8: administração de categorias e itens — concluída; ver `SPRINT-08.md`.
- Sprint 9: administração de combos.
- Sprint 10: perfil e endereços.
- Sprint 11: validação/prévia do checkout.
- Sprint 12: criação transacional do pedido.
- Sprint 13: pagamento simulado e transições de status.
- Sprint 14: histórico de pedidos do cliente.
- Sprint 15: administração de pedidos.
- Sprint 16: dashboard e fechamentos.
- Sprint 17: auditoria de segurança e testes integrados.
- Sprint 18: auditoria final e documentação.

## Regras fixas do projeto

- Backend: Node.js 22, TypeScript ESM/NodeNext, Fastify 5.x, Prisma 6.19.3, PostgreSQL 16, Zod, Vitest, Swagger/OpenAPI e Scalar.
- Não usar React no frontend.
- Manter o modelo de oito tabelas: `usuarios`, `enderecos`, `categorias`, `itens`, `combos`, `itens_combo`, `pedidos`, `itens_pedido`.
- Não adicionar tabela de estoque, tabela exclusiva de cupons ou tabela/coluna de sessão sem uma nova decisão explícita.
- Não implementar pagamento real, gateway real, armazenamento de cartões, pedidos por telefone, estoque ou relatórios PDF.
- Não permitir exclusão física por rotas administrativas; utilizar ativação/desativação.
- Visitante só pode finalizar pedido com PIX.
- O backend recalcula preços, descontos, taxa e total. Nunca confiar nos valores financeiros enviados pelo frontend.
- Um registro de `itens_pedido` representa um item individual OU um combo, nunca ambos.
- Preservar no pedido os dados históricos de endereço, nome, preço, adicionais, composição do combo, desconto e taxa de entrega.
- O histórico de status permanece no JSON existente do pedido.
- JWT em cookie `HttpOnly`; sem revogação de token; logout remove o cookie do navegador, mas tokens copiados permanecem válidos até expirar. Validade: 30 dias para cliente e 12 horas para administrador. Sem tabela/coluna de sessão.
- Status existentes: `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`.
- Entrega: `PENDENTE → CONFIRMADO → PREPARANDO → PRONTO → SAIU_PARA_ENTREGA → CONCLUIDO`.
- Retirada: `PENDENTE → CONFIRMADO → PREPARANDO → PRONTO → CONCLUIDO`.
- De qualquer estado anterior a `CONCLUIDO`, é permitida transição para `CANCELADO`.
- A permissão de cada papel para executar cada transição deve ser conferida na documentação de negócio e definida antes de implementar a alteração de status. Não inventar a matriz de permissões.
- Combo público fica oculto se estiver inativo ou se qualquer componente estiver inativo.
- Adicionais ficam no JSON existente; não criar tabela.
- Geocodificação por endereço/CEP e localização fixa do estabelecimento. Distância estimada por coordenadas, não por trajeto viário.
- Taxas: até 2 km R$ 7,99; acima de 2 até 5 km R$ 9,99; acima de 5 até 8 km R$ 12,99; acima de 8 até 10 km R$ 15,99; acima de 10 km fora da área.
- Dashboard deve separar status do pedido e situação/valores do pagamento simulado. A data de referência deve ser conferida na documentação antes de implementar os agrupamentos.
- Cupons permanecem no MVP, com regra simples sem tabela dedicada. Consultar as regras originais antes de fixar a mecânica de desconto.

## Padrão técnico para cada rota

1. Verificar se já existe rota equivalente e ler o padrão em `src/routes/categorias.ts`.
2. Definir o contrato HTTP antes de programar: método, caminho, parâmetros, query/body, respostas e erros.
3. Validar entradas com Zod e documentar entradas e respostas no OpenAPI.
4. Usar `app.withTypeProvider<ZodTypeProvider>()` conforme o padrão existente, se continuar sendo a abordagem adotada no projeto.
5. Selecionar explicitamente os campos públicos no Prisma; evitar devolver registros completos.
6. Manter `src/app.ts` como ponto de registro das rotas e `src/server.ts` como inicialização.
7. Não criar controllers/services/repositories vazios. Separar regras em serviços somente quando houver benefício real de reutilização ou clareza.
8. Escrever testes com `criarAplicacao()` e `app.inject()`, seguindo os testes existentes.
9. Criar os próprios dados de teste e limpar apenas os registros criados pelo teste. Não depender de o banco estar vazio.
10. Rodar testes específicos, suíte completa e build quando a mudança for relevante.
11. Atualizar a documentação técnica e o estado do projeto depois da conclusão.

## Comandos conhecidos

```bash
npm run dev
npm run build
npm start
npm test -- --run
npm test -- --run tests/api/categorias.test.ts
npm test -- --run tests/api
npm run test:watch
npm run db:test:migrate
```

Confira os scripts reais do `package.json` antes de usar comandos. O banco de testes `leosburger_test` possui proteções; não contorne os mecanismos de segurança nem execute reset destrutivo.

## Critério de conclusão de qualquer sprint

- O comportamento corresponde às regras de negócio.
- Os testes novos e os existentes passam.
- O build passa.
- Não há alteração não planejada de schema, migrações, dependências ou escopo.
- A documentação reflete o código real.
- O agente verificou o diff e o estado do Git antes de declarar conclusão.
