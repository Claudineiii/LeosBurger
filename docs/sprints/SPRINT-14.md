# Sprint 14 — Histórico de cliente e acompanhamento de visitante

**Estado:** Planejada e não implementada; depende dos pedidos (Sprint 12) e do contrato de tentativas PIX (Sprint 13).

## Objetivo e contratos

Cliente autenticado lista/detalha somente seus pedidos. Visitante usa token exclusivo criptograficamente aleatório; backend mantém somente hash, expiração e revogação. O token permite consulta de pedido/pagamento, solicitação de cancelamento e solicitação da segunda tentativa PIX. Não autoriza alterar dados ou histórico do pedido.

### APIs planejadas

- `GET /pedidos` e `GET /pedidos/:id`: cookie JWT obrigatório, identidade derivada do usuário validado, query filtrada por proprietário; dados de terceiro e inexistente indistinguíveis (`404`).
- `GET /pedidos/acompanhamento`: token enviado em header de autorização, não path/query. Validar hash, expiração e revogação. Retornar dados mínimos do pedido e pagamento, sem endereço completo ou dados pessoais desnecessários.
- `POST /pedidos/acompanhamento/recuperar`: recebe número do pedido e telefone informado na compra; resposta genérica contra enumeração. Emite novo token criptográfico e invalida o anterior. Requer rate limiting.
- `POST /pedidos/:id/solicitacoes-cancelamento`: token visitante válido registra solicitação/motivo; nunca muda status, que depende de ADMIN.
- `POST /pedidos/:id/tentativas-pagamento`: token visitante válido pode solicitar a segunda tentativa PIX conforme limites/prazos da Sprint 13.
- Paginação se o volume/contrato justificar; ordenar por criação desc e desempate estável.
- Expor histórico de snapshot sem recomputar catálogo, frete ou cupom atual; incluir estado operacional e financeiro em campos separados para dono autenticado.

## Segurança e limite do token

- Nunca armazenar plaintext, registrar token em log ou incluí-lo em URL; redigir cabeçalhos de autorização.
- Limitar tentativas de tracking e responder `429`; se Redis estiver indisponível, GET permanece disponível com limitador degradado em memória por processo, por derivação do token e IP. O fallback não é distribuído; usar proteção de borda quando disponível.
- Token nunca altera endereço, produtos, quantidades, adicionais, valores ou snapshots históricos. As únicas operações autorizadas além de consulta são solicitar cancelamento (decisão ADMIN) e retry PIX (regras da Sprint 13).
- Token permanece válido enquanto o pedido estiver ativo. Após conclusão ou cancelamento, expira 30 dias depois do respectivo evento. Também pode ser revogado por ADMIN ou invalidado pela emissão de um novo token.
- Cliente autenticado vê somente compras próprias, inclusive quando houver token.
- Pedido visitante não fica acessível por UUID, telefone ou e-mail isoladamente.
- Recuperação por número do pedido + telefone é risco residual conhecido e aceito no MVP. Não implementar OTP SMS/WhatsApp nesta fase; avaliar possibilidade de OTP na Sprint 17.
- Proteger com rate limit recuperação, solicitação de cancelamento e nova tentativa PIX. A consulta do pedido/status com token válido deve permanecer disponível se Redis estiver indisponível.

## Arquivos

- Existentes: `src/app.ts`, `src/plugins/autenticacao.ts`, padrões em `src/routes/auth.ts` e `src/routes/enderecos.ts`.
- Planejados: extensão de `src/routes/pedidos.ts` ou `src/routes/pedidos-acompanhamento.ts` se separação justificar; `tests/api/pedidos.test.ts` e `tests/api/tracking.test.ts`.
- Campos hash/expiração/revogação e telefone histórico já existem no modelo de pedido ou devem ser previstos na migration aditiva da Sprint 12; não duplicar informação de telefone.

## Passos

1. Implementar validade durante pedido ativo e TTL de 30 dias após conclusão ou cancelamento, além de revogação/rotação; injetar relógio nos testes.
2. Implementar query por proprietário no banco e DTO público com seleção explícita.
3. Implementar comparação segura do token contra hash, expiração e revogação; não diferenciar erro que facilite enumeração.
4. Implementar recuperação por número + telefone, resposta genérica e rotação atômica que invalida token anterior; não registrar dados sensíveis.
5. Integrar operações limitadas de cancelamento e segunda tentativa PIX sem permitir mutação do pedido.
6. Configurar redaction de logs e rate limit para recuperação/cancelamento/retry; proteger primeira cobrança PIX e segunda tentativa para visitante e autenticado. Não tornar GET por token indisponível durante pane do Redis e aplicar fallback degradado protegido por processo.
7. Documentar schemas OpenAPI e comparar com respostas reais.

## Testes e aceite

Lista vazia/própria, pedido de terceiro/ausente, sessão ausente, snapshots após catálogo/faixa/cupom mudarem; token válido enquanto pedido ativo e expiração 30 dias após conclusão ou cancelamento, token inválido/revogado, ausência de plaintext em banco/log/URL; recuperação por telefone correto/incorreto, resposta não enumerável e rotação invalida o token anterior; solicitações visitante limitadas e sujeitas à autorização descrita; GET por token continua disponível e protegido sem Redis via fallback degradado; não expor endereço completo; nunca alterar dados históricos.

Aceite: isolamento de propriedade; token válido durante pedido ativo e por 30 dias após conclusão/cancelamento; revogação e recuperação/rotação; operações de visitante limitadas ao escopo autorizado; rate limit nas operações de recuperação, cancelamento e tentativas PIX; consulta por token disponível e protegida durante indisponibilidade Redis. O risco residual de recuperação por número+telefone sem OTP fica documentado e aceito.
