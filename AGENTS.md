# Instruções para agentes — LEOSBurger

## 1. Missão

Dar continuidade ao projeto existente em `C:/LeosBurger`: cardápio digital e pedidos online para uma hamburgueria. Não recriar o projeto do zero. O usuário é o desenvolvedor responsável pelo projeto.

## 2. Regra de colaboração

O agente deve implementar exatamente o que for solicitado, de forma direta e objetiva. Tokens são limitados — evite explicações longas, preâmbulos ou descrição de conceitos básicos.

- Entregue sempre o código completo e funcional, pronto para uso.
- Não pergunte se deve implementar — implemente.
- Não ofereça alternativas não solicitadas nem explicações estendidas, a menos que perguntado.
- Ao revisar código existente, aponte o erro e entregue a correção completa, sem rodeio.
- Seja conciso nas respostas em texto; o código fala por si.
- Não execute alterações ou comandos destrutivos sem autorização explícita.

## 3. Antes de qualquer tarefa

1. Leia `AGENTS.md`, `README.md` e os documentos relevantes, incluindo a Sprint correspondente.
2. Antes de alterar, registre branch, HEAD, `git status`, arquivos em stage, modificados e não rastreados. Preserve alterações locais e identifique o que já existia.
3. Inspecione o repositório real, sem confiar somente na documentação:
   - `git log -5 --oneline`
   - `package.json`
   - `tsconfig.json`
   - `prisma/schema.prisma`
   - migrations e seed
   - estrutura atual de `src/` e `tests/`
4. Não mostre nem solicite valores secretos de `.env`.
5. Verifique a compatibilidade de qualquer dependência antes de sugerir instalação.
6. Informe quais arquivos serão alterados antes de editar.
7. Não sobrescreva, descarte ou reverta trabalho preexistente. Não use reset, restore, checkout ou stash.

## 4. Stack e restrições técnicas

- Frontend planejado: HTML, TypeScript, Tailwind CSS; sem React/JSX.
- Backend: Node.js, TypeScript, ESM, Fastify 5.x, Zod, Prisma 6.19.3.
- Banco: PostgreSQL 16 em Docker Compose.
- Testes: Vitest.
- Documentação HTTP: Swagger/OpenAPI com Scalar; a interface `/reference` e `GET /health` foram visualizadas funcionando.
- Manter `type: module`, configuração TypeScript compatível com NodeNext e `verbatimModuleSyntax: true`, salvo decisão documentada.
- **Não atualizar Prisma 6.19.3 para Prisma 7** sem autorização e revisão explícita de compatibilidade.
- Não adicionar React.
- O schema atual define oito tabelas hoje, mas essa contagem não é um limite obrigatório nem uma regra arquitetural permanente. A expansão aprovada inclui cupons, relações de elegibilidade, faixas de frete, tentativas de pagamento e registros de reembolso. Não criar entidades persistentes adicionais fora desse escopo aprovado sem justificativa técnica e autorização explícita; manter o modelo enxuto e íntegro.
- Não remover ou enfraquecer as 11 constraints `CHECK` documentadas na migração definitiva.
- Não adicionar estoque, atendimento telefônico, gateway PIX real, webhook real ou cartão online ao MVP. Entidades conceituais de cupons/elegibilidade, faixas de frete, tentativas de pagamento e reembolsos foram aprovadas para expansão futura; nenhuma alteração de banco é permitida fora de sprint de implementação, com revisão incremental de schema/migration e testes.

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
- Simulador de pagamento é somente para desenvolvimento e testes; não movimenta dinheiro. Provedor PIX real não foi escolhido nem integrado; cartão online não faz parte da primeira versão.
- Visitantes e clientes autenticados podem escolher entrega ou retirada. Visitante não precisa de conta nem endereço previamente salvo; para entrega informa endereço, que o backend valida/geocodifica antes da finalização e vincula ao fluxo por referência temporária protegida. A criação final do pedido e o pagamento não geocodificam. Sem coordenadas válidas, aquele endereço não permite entrega, mas retirada continua disponível. Correção manual de ponto ocorre somente durante cadastro/edição do endereço. Geoapify é o provedor aprovado para a Sprint 11, isolado no backend; usar cache e quota compartilhados no PostgreSQL, limite conservador de 4 req/s e até 3.000 consultas/dia conforme a Sprint, sem enviar nome, telefone, complemento ou referência. Incluir atribuições Geoapify e OpenStreetMap exigidas pelo plano.
- Frete usa faixas administradas e persistidas; distância em linha reta, limite inicial 6 km. Seed de faixas é somente fixture de teste, nunca preço comercial. Pedido preserva distância, faixa e valor históricos; desativar uma faixa só afeta pedidos novos.
- Endereço, preços, taxa de entrega, desconto/cupom aplicado e composição do combo precisam permanecer historicamente corretos no pedido, conforme o modelo aprovado.
- Um item de `itens_pedido` representa item OU combo, nunca os dois ao mesmo tempo.
- Não existe estoque no MVP.
- Não existe atendimento por telefone no MVP.
- Não há relatórios contábeis em PDF no MVP.
- Dashboard/fechamento é calculado a partir dos pedidos; visões diária, mensal, semestral e anual foram planejadas.
- Cupons são aprovados para administração no painel e persistência no banco, com relações de elegibilidade para itens/combos; consultar `docs/03_REGRAS_DE_NEGOCIO.md` e `docs/04_MODELO_DE_DADOS_E_INTEGRIDADE.md`. A criação de schema/migration deve ocorrer somente em sprint de implementação, após revisar as relações e constraints atuais.
- Cupons aceitam desconto fixo ou percentual (máximo 30%), estado ativo e datas inicial/final inclusivas durante todo o dia em `America/Sao_Paulo`; um por pedido. O limite de usos é opcional e não configurado por padrão. Podem ter compra mínima opcional, desativada por padrão, calculada sobre o subtotal elegível antes do desconto. Somente itens/combos elegíveis recebem desconto, nunca o frete. Backend calcula; pedido guarda código e desconto aplicado.
- Adicionais permanecem em JSON por item; cada configuração tem ID, nome, preço, ativo/inativo e quantidade máxima (padrão 1). Backend valida e precifica. Snapshot guarda nome, preço e quantidade; não criar tabela de adicionais.
- Estados operacionais aprovados: `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`. Usar `PREPARANDO`, nunca `EM_PREPARACAO`. `CONCLUIDO` não volta a `CANCELADO`; retirada pode pular `SAIU_PARA_ENTREGA`. Estado operacional e financeiro são independentes.
- ADMIN controla todas as transições administrativas de status operacional; a exceção automática aprovada é cancelamento após expiração da segunda tentativa PIX. Solicitação de cancelamento do cliente/visitante exige decisão ADMIN.
- Token de visitante é criptograficamente aleatório; persistir somente hash e nunca registrar o token. Permanece válido enquanto o pedido estiver ativo; após conclusão ou cancelamento, expira 30 dias depois. Pode ser revogado. Recuperação exige número do pedido e telefone informado na compra, gera token novo e invalida o anterior. OTP não faz parte do MVP; risco residual de recuperação por número+telefone é aceito e deve ser limitado e monitorado. O token autoriza consultar pedido/pagamento, solicitar cancelamento (sujeito a ADMIN) e solicitar a segunda tentativa PIX; não autoriza editar endereço, produtos, quantidades, adicionais, valores ou histórico.
- Cada pedido admite duas tentativas PIX no total: cobrança inicial e uma tentativa adicional. Cada tentativa expira cinco minutos após o backend confirmar a criação da cobrança. Falha ou recusa explícita encerra imediatamente a tentativa; a segunda fica disponível após falha, recusa ou expiração da primeira. A expiração da segunda cancela automaticamente o pedido; falha/recusa da segunda não permite uma terceira cobrança. Requisições repetidas idempotentes retornam a mesma operação, e controle concorrente impede ultrapassar o limite ou criar cobranças simultâneas. Pedido pago/cancelado não aceita nova cobrança. Confirmação tardia fica ligada à cobrança original; em pedido cancelado, a tentativa fica `PAGO`, o estado financeiro do pedido passa a `REEMBOLSO_PENDENTE` e o status operacional permanece `CANCELADO`. Evento repetido da mesma cobrança é distinto de duas tentativas legítimas pagas; ambos são auditados e encaminhados à análise ADMIN sem reembolso automático.
- Cada ocorrência de reembolso tem registro próprio ligado ao pedido e à tentativa/transação original; múltiplos registros por pedido são permitidos. PIX é iniciado manualmente por ADMIN no MVP. Dinheiro/cartão presencial exige registro de devolução manual, valor, responsável e data. Reembolso parcial só deve ser suportado estruturalmente, não habilitado.
- Pagamento usa contrato genérico independente de fornecedor desde o início da implementação financeira e simulador exclusivo de dev/teste. Não escolher gateway PIX, implementar webhook real ou cartão online.
- Rate limit: memória em desenvolvimento, isolado/controlado em testes e Redis compartilhado em produção; proteger explicitamente a cobrança inicial e a segunda tentativa PIX para autenticados e visitantes. Não inventar valores numéricos; propor e justificar limites por operação antes da produção. Operações protegidas de alteração falham fechadas se Redis de produção estiver indisponível. Consulta GET por token permanece disponível com limitação degradada em memória por processo, usando identificador derivado do token e IP; documentar que esse fallback não oferece coordenação distribuída e aplicar proteção de borda se disponível. Redis não é cache.
- Dashboard usa `America/Sao_Paulo`, semestres civis (jan–jun e jul–dez), timestamps persistidos em UTC por convenção da aplicação e agregações no banco. Separar bruto, recebimentos e reembolsos confirmados.

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

1. Leia `AGENTS.md`, README, documentação arquitetural e a Sprint correspondente em `docs/sprints/` antes de implementar.
2. Registre branch, HEAD, `git status`, stage, modificações e não rastreados; confira código, schema, migrations e testes reais, preservando alterações locais.
3. Inspecione padrões existentes antes de criar arquivos, funções, tabelas, serviços ou abstrações; não duplique funcionalidades.
4. Implemente somente o escopo solicitado e aprovado, com testes correspondentes.
5. Rode testes relevantes, build e validações aplicáveis; nunca esconda falhas.
6. Revise `git diff`/`git status` e atualize a Sprint correspondente e `docs/01_ESTADO_ATUAL.md` após implementação.
7. Informe arquivos criados, modificados e removidos, decisões aplicadas, testes/resultados e limitações.
8. **Não coloque arquivos em stage nem execute `git commit`, `git push`, deploy ou publicação sem autorização explícita do usuário.**

## 10. Comandos destrutivos proibidos sem autorização

Nunca execute ou recomende como rotina:

- `docker compose down -v`
- `npx prisma migrate reset`
- exclusão de volume do PostgreSQL
- remoção/recriação do banco
- force upgrade de dependências que mude versões principais

Se uma dessas ações parecer necessária, explique o risco e espere autorização explícita.

## 11. Entrega de cada agente

Ao concluir uma tarefa, informar, de forma objetiva:

- o que foi feito;
- quais arquivos foram alterados;
- decisões e motivos (quando houver escolha entre abordagens);
- comandos/testes executados e resultados;
- limitações ou pendências;
- próximos passos, sem implementar escopo extra.
