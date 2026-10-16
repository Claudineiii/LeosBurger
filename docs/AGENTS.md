# Instruções para agentes — LEOSBurger

## 1. Missão

Dar continuidade ao projeto existente em `C:/LeosBurger`: cardápio digital e pedidos online para uma hamburgueria. Não recriar o projeto do zero. O usuário é o desenvolvedor responsável e quer aprender implementando.

## 2. Regra de colaboração obrigatória

O usuário quer escrever pessoalmente as APIs, os testes e o código de negócio. Portanto:

- Não entregue implementação completa nem trechos de código prontos espontaneamente.
- Primeiro explique o objetivo, o conceito, o arquivo exato, os passos e os critérios de sucesso.
- Deixe o usuário tentar implementar.
- Se ele pedir ajuda, forneça pistas progressivas e específicas.
- Só forneça código pronto quando o usuário pedir explicitamente.
- Ao revisar código do usuário, explique a causa do erro e como raciocinar sobre a correção.
- Seja direto, avance em etapas pequenas e não repita fundamentos já dominados sem necessidade.
- Não execute alterações ou comandos destrutivos sem autorização explícita.

## 3. Antes de qualquer tarefa

1. Leia `README.md` e os documentos relevantes para a tarefa.
2. Inspecione o repositório real, sem confiar somente na documentação:
   - `git status`
   - `git log -5 --oneline`
   - `package.json`
   - `tsconfig.json`
   - `prisma/schema.prisma`
   - migrations e seed
   - estrutura atual de `src/` e `tests/`
3. Não mostre nem solicite valores secretos de `.env`.
4. Verifique a compatibilidade de qualquer dependência antes de sugerir instalação.
5. Explique qual arquivo será trabalhado, por quê e como o resultado será validado.

## 4. Stack e restrições técnicas

- Frontend planejado: HTML, TypeScript, Tailwind CSS; sem React/JSX.
- Backend: Node.js, TypeScript, ESM, Fastify 5.x, Zod, Prisma 6.19.3.
- Banco: PostgreSQL 16 em Docker Compose.
- Testes: Vitest.
- Documentação HTTP: Swagger/OpenAPI com Scalar; a interface `/reference` e `GET /health` foram visualizadas funcionando.
- Manter `type: module`, configuração TypeScript compatível com NodeNext e `verbatimModuleSyntax: true`, salvo decisão documentada.
- **Não atualizar Prisma 6.19.3 para Prisma 7** sem autorização e revisão explícita de compatibilidade.
- Não adicionar React.
- Não ampliar o banco para além das oito tabelas aprovadas sem apresentar motivo e obter decisão.
- Não remover ou enfraquecer as 11 constraints `CHECK` documentadas na migração definitiva.
- Não adicionar estoque, atendimento telefônico, tabela de cupons ou processamento real de pagamentos ao MVP sem autorização.

## 5. Organização atual conhecida do backend

- `src/server.ts`: inicia o servidor e trata falha de inicialização; não deve concentrar registro de rotas.
- `src/app.ts`: cria/configura Fastify e registra plugins e rotas.
- `src/plugins/prisma.ts`: plugin de ciclo de vida/conexão Prisma.
- `src/plugins/documentacao.ts`: integração de documentação Swagger/Scalar.
- `src/types/fastify.d.ts`: tipagem da decoração `app.prisma`.
- `src/routes/health.ts`: rota `GET /health`.
- `tests/api/health.test.ts`: teste da rota de saúde.
- `tests/api/prisma.test.ts`: teste de integração que consulta o banco; aguarda o boot do Fastify com `app.ready()`.
- `tests/banco/integridade.test.ts`: 17 testes de integridade do banco.

Confirme os caminhos e conteúdo no repositório antes de usá-los como verdade atual.

## 6. Arquitetura de implementação desejada

Separar responsabilidades progressivamente:

- routes: define endpoints e integra validação/handlers;
- services: regras de negócio;
- repositories: acesso a dados, se/quando a complexidade justificar essa camada;
- validators/schemas: validação com Zod e contratos;
- plugins: infraestrutura compartilhada, como Prisma e documentação;
- tests: testes de API e de integridade.

Não criar dezenas de arquivos ou camadas vazias apenas por antecipação. Introduzir a estrutura conforme a primeira funcionalidade real exigir. Manter `app.ts` como ponto de registro.

## 7. Regras de negócio inegociáveis sem decisão do usuário

- Combo não é categoria.
- Categorias do cardápio: Lanches, Acompanhamentos, Bebidas e Sobremesas.
- Acompanhamentos são sugestões de interface/adicionais, não uma nova tabela ou aba de menu por padrão.
- Visitante só pode finalizar pedido usando PIX.
- Cliente autenticado pode usar os métodos de pagamento previstos.
- Pagamento é simulado no MVP; não há cobrança real nem integração com gateway.
- Entrega e retirada são modalidades distintas.
- Endereço, preços, taxa de entrega, desconto/cupom aplicado e composição do combo precisam permanecer historicamente corretos no pedido, conforme o modelo aprovado.
- Um item de `itens_pedido` representa item OU combo, nunca os dois ao mesmo tempo.
- Não existe estoque no MVP.
- Não existe atendimento por telefone no MVP.
- Não há relatórios contábeis em PDF no MVP.
- Dashboard/fechamento é calculated a partir dos pedidos; visões diária, mensal, semestral e anual foram planejadas.
- Cupons foram discutidos como regra de negócio no documento antigo, mas não existe tabela de cupons aprovada no esquema de oito tabelas. Antes de implementar cupom, inspecionar a decisão mais recente e não criar tabela sem autorização.

## 8. Segurança e integridade

- Não confiar nos preços, totais, taxas ou descontos enviados pelo frontend; recalcular no backend.
- Não retornar hash de senha em respostas.
- Normalizar e validar e-mail e CEP conforme os schemas.
- Aplicar autorização para funções administrativas.
- Validar transições permitidas de status do pedido.
- Preservar histórico de status no campo JSONB aprovado.
- Usar transações para operações de pedido que precisem ser atômicas.
- Avaliar proteção contra abuso em login/checkout, CORS restrito e validação de entradas quando essas rotas forem implementadas.
- Não expor stack traces ou detalhes internos em respostas HTTP de produção.
- Não registrar segredos ou dados sensíveis desnecessários nos logs.

## 9. Processo por tarefa

1. Apresente objetivo e critérios de aceite.
2. Explique o arquivo e conceitos necessários.
3. O usuário implementa.
4. Revise a implementação com foco didático.
5. Rode os testes relevantes e, quando apropriado, a suíte completa.
6. Execute `npm run build`; valide Prisma quando o schema mudar.
7. Revise `git diff` e `git status`.
8. Sugira commit somente quando a mudança estiver compreendida e validada.

## 10. Comandos destrutivos proibidos sem autorização

Nunca execute ou recomende como rotina:

- `docker compose down -v`
- `npx prisma migrate reset`
- exclusão de volume do PostgreSQL
- remoção/recriação do banco
- force upgrade de dependências que mude versões principais

Se uma dessas ações parecer necessária, explique o risco e espere autorização explícita.

## 11. Entrega de cada agente

Ao concluir uma tarefa, informar:

- o que foi feito;
- quais arquivos foram alterados;
- decisões e motivos;
- comandos/testes executados e resultados;
- limitações ou pendências;
- próximos passos, sem implementar escopo extra.
