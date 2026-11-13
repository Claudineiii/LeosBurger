# Modelo de dados e integridade — LEOSBurger

## 1. Estado atual e regra de evolução

O schema real está em `prisma/schema.prisma` e atualmente define 17 modelos/tabelas, incluindo as estruturas implementadas na Sprint 11. Essa contagem descreve o estado atual, não é um limite arquitetural.

As tabelas de cupons, elegibilidade, usos de cupom, faixas de frete, referências temporárias, cache e controle Geoapify foram criadas por migrations incrementais. A Sprint 12 acrescentou somente colunas e constraints aditivas em `pedidos`; tentativas de pagamento e reembolsos seguem conceitualmente aprovados, mas ainda não existem no banco.

Uma nova tabela é apropriada quando representar entidade/responsabilidade persistente e garantir integridade referencial. As migrations da Sprint 11 e da Sprint 12 são aditivas e não removem nem alteram as 11 CHECK constraints da migration definitiva. As migrations novas foram aplicadas somente ao banco isolado `leosburger_test`; não foram aplicadas ao banco de desenvolvimento.

## 2. Modelos existentes

| Tabela | Responsabilidade atual |
|---|---|
| `usuarios` | Conta, autenticação, perfil e tipo de usuário. |
| `enderecos` | Endereço atual associado ao usuário; inclui latitude/longitude opcionais. |
| `categorias` | Categorias do cardápio. |
| `itens` | Itens, preços, estado e coluna JSON `adicionais`. |
| `combos` | Combos e preços definidos pelo proprietário. |
| `itens_combo` | Composição atual/removida logicamente dos combos. |
| `pedidos` | Compra, snapshots de cliente/endereço/faixa/cupom, modalidade, valores, método, status/histórico, idempotência e hash/validade/revogação do tracking visitante. |
| `itens_pedido` | Linhas históricas de item ou combo, adicionais e composição histórica JSON. |

O enum atual `StatusPedido` usa `PREPARANDO` e esse nome está aprovado; não renomear para `EM_PREPARACAO`. O enum `MetodoPagamento` existente tem `PIX`, `CREDITO`, `DEBITO`, `DINHEIRO`; cartão permanece exclusivamente presencial.

As 11 constraints CHECK documentadas na migration definitiva devem ser preservadas. Antes de editar constraints, conferir SQL real e `tests/banco/integridade.test.ts`; nunca remover/enfraquecer uma regra para adaptar a aplicação.

As colunas `DateTime` existentes são `TIMESTAMP(3)` sem fuso no PostgreSQL. Armazenar instantes em UTC é uma convenção da aplicação, não uma propriedade garantida pelo tipo da coluna; futuras rotas e relatórios devem normalizar e testar essa convenção.

## 3. Estruturas implementadas na Sprint 11 e expansão futura

As estruturas abaixo já existem no schema e em migrations. As tentativas de pagamento e os reembolsos permanecem aprovados para sprints futuras.

| Entidade aprovada | Motivo / integridade |
|---|---|
| `cupons` | Permitir que ADMIN crie/edite cupons no painel sem deploy; armazenar código, tipo, valor, ativo e datas de validade inclusivas. |
| `cupons_itens` | Relação N:N com itens elegíveis, FKs e unicidade por par. |
| `cupons_combos` | Relação N:N com combos elegíveis, FKs e unicidade por par. |
| `faixas_frete` | Configuração administrativa de limites/valores e validação de cobertura do serviço até 6 km. |
| `cupons_utilizacoes` | Contagem persistida de aplicações de cupom, com limite opcional; uma utilização é inserida atomicamente com o pedido. |
| `referencias_endereco` | Snapshot mínimo de endereço e validação associado somente ao hash do token temporário de 30 minutos. |
| `cache_geoapify` | Resultado normalizado com chave HMAC, sem consulta textual em claro e com expiração. |
| `controle_geoapify` | Reserva agregada de quota e intervalo mínimo entre chamadas externas. |
| `reservas_cache_geoapify` | Lock/reserva com expiração para coalescer cache misses concorrentes entre instâncias. |
| `tentativas_pagamento` | Cobrança inicial e no máximo uma tentativa adicional por pedido, ligadas à mesma compra, com idempotência, prazo e preservação de eventos tardios/duplicados. |
| `reembolsos` | Um registro por ocorrência, ligado ao pedido e à tentativa/transação original; suporta vários registros por pedido e prepara valor parcial sem habilitá-lo no MVP. |

Não criar tabela de adicionais: manter configuração JSON em `Item.adicionais`. Não criar tabela de carrinho, cache, sessão ou histórico operacional genérico sem necessidade comprovada. Cancelamento/reembolso pode usar eventos tipados no JSONB `Pedido.historicoStatus`; somente propor outra entidade se testes/requisitos demonstrarem que o histórico do pedido não é suficiente.

## 4. Contrato dos adicionais no JSON

O `Item.adicionais` existente deverá ser validado como lista estruturada pelo backend. Forma lógica recomendada:

```json
[
  {
    "id": "uuid",
    "nome": "Cheddar",
    "preco": 2.5,
    "ativo": true,
    "quantidadeMaxima": 1
  }
]
```

O identificador é estável dentro da configuração daquele item; nome é público; preço é não negativo, decimal monetário a centavos; somente `ativo: true` pode ser escolhido. `quantidadeMaxima` é inteiro positivo e assume 1 quando omitido; o cliente envia identificador e quantidade, nunca preço/nome/ativo como autoridade. Ao criar linha do pedido, copiar ID, nome, preço unitário e quantidade selecionada para `ItemPedido.adicionais`. Mudanças/desativação futuras não reescrevem pedidos. Sem estoque.

Antes de implementar, validar compatibilidade com JSON legado, rejeitar IDs duplicados na configuração/seleção, e formalizar schema Zod/OpenAPI. Não é necessária tabela nova para adicionais.

## 5. Cupons e elegibilidade

`Cupom` guarda código único normalizado, tipo percentual/fixo, valor, ativo, datas inicial/final inclusivas e compra mínima opcional. Compra mínima é desativada por padrão; quando configurada, compara-se ao subtotal das linhas elegíveis antes do desconto, sem frete. Regras:

- percentual entre 0 e 30, validado na gravação e no cálculo;
- relações de elegibilidade normalizadas em `CupomItem` e `CupomCombo`, com FK e unicidade;
- somente linhas associadas são elegíveis; taxa de entrega nunca é elegível;
- um cupom por pedido, código enviado pelo frontend, preço e cálculo vêm do banco;
- desconto fixo limitado ao subtotal elegível, total nunca negativo; usar `ROUND_HALF_UP` para arredondamento monetário no backend e cobrir os limites em testes;
- início e fim são datas civis inclusivas no fuso `America/Sao_Paulo`; representam-se como datas sem horário (`DATE`) e comparam-se com a data de negócio local;
- limite de utilizações opcional; ausência de limite preserva uso ilimitado;
- pedido guarda `codigoCupom` e valor aplicado como snapshot. Alteração do cupom/elegibilidade não afeta histórico.

O banco deve impedir relações duplicadas, valores percentuais acima de 30, valores negativos, compra mínima negativa e datas de validade invertidas. Um cupom aplicado sem linhas elegíveis não concede desconto; a API informa desconto zero sem atribuir desconto a linhas não elegíveis. Adicionais selecionados integram o valor da linha elegível conforme o preço oficial persistido no snapshot.

## 6. Faixas de frete

`FaixaFrete` deve representar limite mínimo, limite máximo, valor e estado ativo/inativo. Valores comerciais ainda não foram escolhidos; exemplos em conversas/documentos não são valores aprovados.

- Calcular distância em linha reta usando coordenadas do restaurante e endereço completo geocodificado.
- Limite de entrega inicial: 6 km; distância maior rejeita modalidade ENTREGA.
- Faixas ativas cobrem continuamente `[0, 6]`, sem interseção, intervalo invertido ou lacunas. A convenção é `[min, max)` para faixas intermediárias e inclui o limite final de 6 km na última faixa, evitando dupla correspondência nas fronteiras.
- Validar todas as faixas ativas no contexto transacional ao criar, alterar ou ativar. Se atualização deixar o conjunto inválido, rejeitar a operação.
- Pedido mantém snapshot da distância, faixa aplicada (identificação e limites/critério comercial) e valor. Alterações posteriores ou desativação da faixa não recalculam pedidos.
- O schema atual tem `Pedido.distanciaKm` e `Pedido.taxaEntrega`, mas não identifica nem fotografa a faixa aplicada. A migration deve preservar a faixa no pedido sem depender apenas da relação mutável com `FaixaFrete`.
- Retirada não usa geocodificação e taxa é zero.
- Para visitante, validar e geocodificar endereço antes da finalização por operação backend separada; não geocodificar durante a prévia, criação final do pedido ou pagamento. Geoapify recebe somente CEP/logradouro/número/bairro/cidade/estado, sem nome, telefone, complemento ou referência. Se indisponível, manter endereço pendente; somente aquele endereço fica inelegível para entrega, sem restringir retirada ou outros visitantes.

Coordenadas do restaurante devem ser configuração confiável do backend, nunca recebidas do checkout. Não aceitar valor de frete/distância do cliente como fonte confiável.

## 7. Tentativas de pagamento

`TentativaPagamento` liga-se a `Pedido` e persiste uma tentativa por operação:

- pedido, método, status, sequência/instante, idempotency key e expiração;
- confirmação/resultados, responsável/data quando confirmação presencial;
- identificador externo opcional apenas quando houver provedor real;
- estado/evento de confirmação tardia e dados mínimos para auditoria, sem payloads/secrets de fornecedor.

Um pedido admite duas tentativas PIX no total: cobrança inicial e uma tentativa adicional. Cada uma expira cinco minutos após o backend confirmar a criação da cobrança. Falha ou recusa explícita encerra imediatamente a tentativa; a tentativa 2 fica disponível após a primeira falhar, ser recusada ou expirar. A expiração da segunda cancela automaticamente o pedido; falha/recusa da segunda impede terceira cobrança, mas não equivale à regra de cancelamento automático por expiração. Pedido pago/cancelado não aceita cobrança. Idempotência e controle transacional/concorrente impedem tentativas simultâneas, cobranças repetidas e ultrapassagem do limite.

Estados mínimos da tentativa: pendente, aprovada, recusada, falha, expirada e confirmação tardia/em exceção. A expiração de cada tentativa parte do instante em que o backend confirma a criação, não do início da chamada externa. Estado financeiro (`PAGO`, `REEMBOLSO_PENDENTE`, etc.) não é `Pedido.status`; após confirmação tardia em pedido cancelado, a tentativa original fica `PAGO`, o estado financeiro do pedido passa a `REEMBOLSO_PENDENTE` e o status operacional permanece `CANCELADO`.

Contrato de integração independente do fornecedor deve existir desde o início da implementação financeira; simulador apenas em desenvolvimento/testes e impossível de habilitar em produção. Uma repetição de confirmação/evento da mesma cobrança é idempotente, preserva identificadores de evento/transação e gera ocorrência auditável sem contar como nova tentativa; não dispara reembolso automático. Duas cobranças distintas confirmadas são eventos financeiros distintos, vinculados cada qual à tentativa original e encaminhados à análise ADMIN sem reembolso automático. Confirmação tardia após cancelamento preserva a tentativa original como `PAGO`, atualiza o estado financeiro do pedido para `REEMBOLSO_PENDENTE` e mantém o operacional `CANCELADO`. Webhooks reais futuros validam assinatura/autenticidade, valor, moeda, pedido e idempotência antes de mudar estado.

## 8. Pedidos, cancelamentos e reembolsos

`Pedido` continua sendo snapshot imutável da compra. Adições prováveis a avaliar:

- hash SHA-256 do token de visitante, expiração e revogação; nunca texto puro nem logado. É válido enquanto o pedido estiver ativo; após conclusão ou cancelamento, expira 30 dias depois do respectivo evento. Recuperação exige número do pedido e telefone da compra, emite novo token e invalida o anterior. OTP não é usado no MVP; o risco de recuperação por dois dados é conhecido e aceito;
- idempotency key UUID globalmente única, hash do escopo (identificador de CLIENTE ou telefone normalizado de visitante) e hash do payload canônico para distinguir replay idêntico de reutilização incompatível; a chave permanece enquanto o pedido existir;
- snapshot explícito da faixa de frete aplicada. O pedido já contém distância e taxa; os campos novos registram ID e limites da faixa;
- referência ao pedido anterior somente se necessária para auditar nova compra após mudança de carrinho;
- situação financeira atual se necessária à consulta, mantendo tentativas como histórico financeiro;

O schema contém snapshots de nome/telefone/endereço do cliente, valores do pedido, distância, taxa, código do cupom, nome/preço da linha, adicionais e composição histórica do combo. A migration `20261105120000_pedidos_idempotencia_tracking` adicionou campos de idempotência, token e faixa, além de `cupom_historico` com as regras e elegibilidade usadas. A criação do pedido registra a utilização de cupom na mesma transação.

Solicitação/decisão de cancelamento registra em evento histórico tipado: motivo, solicitante, data; decisão ADMIN, data, decisão e justificativa quando aplicável; resultado financeiro. Visitante pode solicitar cancelamento usando token válido, mas somente ADMIN decide. Cancelamento e reembolso são independentes.

`Reembolso` é registro próprio por ocorrência, com FK para pedido e para tentativa/transação original quando houver, valor, estado, motivo, responsável, datas e identificador externo opcional. Vários reembolsos por pedido são permitidos. PIX: ADMIN inicia o procedimento manualmente e confirma conclusão; reembolso pendente não é concluído. Dinheiro/cartão presencial: registrar devolução manual, valor, responsável e data. Valor parcial poderá ser representado, mas não será aceito pela API do MVP. Pedido `CONCLUIDO` não admite solicitação nem transição para `CANCELADO`; problema posterior segue o processo financeiro, sem alterar status operacional.

Uma migration não pode substituir nem eliminar os snapshots já existentes de cliente/endereço, `codigoCupom`, desconto, taxa, composição e linhas de pedido.

### Referência temporária para endereço de visitante

Decisão técnica da Sprint 11: após a geocodificação anterior ao checkout, o backend emite token opaco, aleatório e criptograficamente seguro, persiste somente seu hash e associa a referência a um snapshot mínimo do endereço, estado da validação e coordenadas confiáveis (quando houver). A referência fica em PostgreSQL compartilhado entre instâncias e expira em 30 minutos; não inclui nome, telefone, complemento nem referência enviados ao geocodificador. O cliente só transporta o token; prévia e criação final consultam hash, finalidade e validade e recuperam endereço/coordenadas exclusivamente do banco. Não aceitar coordenadas livres do cliente nem geocodificar na criação do pedido/pagamento. Não registrar token ou endereço completo. A referência não exige conta.

## 9. Processo de alteração de banco nas Sprints

1. Reinspecionar `schema.prisma`, migrations, seed e constraints no início da sprint; conferir se documentos ainda refletem código. Oito tabelas é a contagem atual, não um limite.
2. Separar estado atual, regra aprovada e detalhes técnicos. Documentar para cada tabela/campo novo a responsabilidade e constraint de integridade.
3. Projetar alteração aditiva e revisar nomes/FKs/índices/constraints. Não criar migration nesta etapa documental.
4. Atualizar seed somente com fixtures explícitas de teste; não popular cupons/faixas comerciais ilustrativas em produção.
5. Escrever testes de banco/API para integridade, isolamento, concorrência, transações e snapshots.
6. Validar `npx prisma validate`, migrations no banco isolado, suíte e build quando a implementação for autorizada.
7. Revisar SQL e diff; nunca resetar banco ou remover volume como rotina.

## 10. Pendências de modelagem

- Fonte confiável e processo de atualização das coordenadas do restaurante.
- Configuração e rotação seguras da chave da referência temporária de endereço de visitante.
- Preenchimento de `tokenAcompanhamentoExpiraEm` pelo futuro fluxo administrativo quando o pedido concluir ou cancelar (30 dias após o evento terminal).
- Dados mínimos de auditoria/evento tardio e quando adicionar identificadores externos.
- Limites numéricos de rate limiting, que devem ser propostos e aprovados antes de produção; fallback GET durante indisponibilidade Redis em memória por processo é degradado e não distribuído.
