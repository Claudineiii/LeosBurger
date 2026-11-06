# Sprint 11 — Adicionais, endereços, cupons e prévia do checkout

**Estado:** implementação local concluída; há pendências externas e de hardening antes de produção. Nenhum pedido definitivo, pagamento ou gateway foi implementado.

## 1. Objetivo

Preparar e implementar, em etapas pequenas, as regras e APIs necessárias para configurar adicionais, validar endereços, administrar cupons e faixas de frete e calcular uma prévia de checkout. A prévia é somente de leitura: não cria pedidos nem inicia pagamentos.

Esta Sprint não implementa criação definitiva do pedido, processamento ou tentativas de pagamento, integração com gateway, recuperação de token de visitante ou dashboard financeiro.

## 2. Estado atual relevante

- Backend TypeScript/ESM com Fastify 5, Zod, Prisma 6.19.3, PostgreSQL e Vitest.
- A aplicação registra rotas em `src/app.ts`; os serviços desta Sprint ficam em `src/services/`, sem repositórios ou camadas vazias.
- `Item.adicionais` já é JSON. `Endereco` já possui coordenadas. O pedido exige campos de entrega e totais compatíveis com as constraints atuais.
- O schema contém 17 modelos/tabelas após migrations incrementais. A migration definitiva anterior tem 11 constraints `CHECK`; nenhuma foi removida ou enfraquecida.
- Os contratos, registros JSON de adicionais, autenticação e padrões de autorização foram conferidos no código antes da implementação.
- As alterações locais preexistentes devem ser preservadas. Nenhum trabalho desta Sprint deve stagear, commitar ou enviar alterações sem autorização.
- Implementação verificada em 04/11/2026: adicionais, Geoapify/cache/quota, referências, rotas de endereço, cupons, faixas e prévia estão implementados. Testes usam apenas `leosburger_test`; não houve chamada real ao Geoapify.
- A migration `20261104120000_checkout_previo_sprint11` acrescenta cupons, usos, elegibilidade, faixas e lock de cache. Não altera a migration histórica nem as 11 CHECK constraints existentes.

## 3. Escopo e regras consolidadas

### 3.1 Adicionais

- Adicionais aplicam-se apenas a itens individuais; combos não aceitam adicionais.
- Usar `Item.adicionais` em JSON. Antes de alterar o formato, inventariar os registros existentes sem expor dados pessoais e definir compatibilidade/migração controlada.
- Cada configuração tem identificador estável, nome, preço, estado ativo/inativo e quantidade máxima; quantidade máxima ausente em registro legado equivale a 1 somente se a migração/compatibilidade for explícita e testada.
- Apenas adicionais ativos podem ser selecionados. O backend valida que cada ID pertence ao item e recalcula o preço usando o valor persistido. Preços enviados pelo cliente são ignorados ou rejeitados, nunca usados como autoridade.
- A API pública retorna somente adicionais ativos e sua quantidade máxima. A aplicação principal é em lanches. O snapshot futuro do pedido deve preservar nome, preço e quantidade selecionada em `ItemPedido.adicionais`.

### 3.2 Endereços e Geoapify

- Provedor inicial: Geoapify, pelo backend e por adaptador substituível. Nenhum frontend chama o provedor.
- A chave fica em variável de ambiente (`GEOAPIFY_API_KEY`); nunca deve aparecer no frontend, respostas, logs ou erros. A documentação do provedor usa a chave na query string: redigir URLs e detalhes de requisições HTTP nos logs.
- Endereço só será confirmado automaticamente quando houver exatamente um candidato `full_match` e os componentes disponíveis (número, logradouro, CEP, bairro, cidade, estado e país) coincidirem com o endereço normalizado. Esse critério conservador foi adotado provisoriamente porque não houve resposta à solicitação de decisão; resultados sem evidência suficiente permanecem pendentes e o critério ainda precisa de validação antes de produção.
- Enviar somente componentes de localização necessários. Não enviar nome, telefone, complemento, referência ou outros dados do pedido.
- Configurar timeout, validar a resposta, tratar falha/ausência de resultados explicitamente e não converter falha em coordenadas, frete ou sucesso confirmado.
- O endereço comercial é em Campinas/SP, com região prevista na Vila Formosa; endereço e coordenadas comerciais confiáveis ainda não foram definidos. Não usar centro de bairro, coordenadas fictícias ou fixtures como origem. Configurar a origem no backend; sem origem confiável, entrega e cálculo real de frete ficam indisponíveis.
- Fluxo normal: endereço recebido pelo backend → Geoapify → avaliação de resultado → coordenadas confiáveis → distância em linha reta → faixa ativa → frete. Endereço fora da área não recebe cotação de entrega; retirada continua possível.
- Não geocodificar no `POST /checkout/preview` nem na criação definitiva do pedido. Endereço autenticado é geocodificado em criação/edição; endereço de visitante, em operação prévia própria de validação.
- Se não for possível validar/geocodificar o endereço por falha ou ausência de resultado, a validação pode registrar uma referência explicitamente pendente. Isso viabiliza o fluxo excepcional de pedido pendente previsto para sprint posterior, não confirma entrega/frete e não cria pedido nesta Sprint.
- O contato telefônico pela equipe é exclusivamente para resolver essa exceção; não criar módulo de atendimento nem pedidos por telefone.
- Origem comercial não configurada não é falha de validação de endereço e não habilita a exceção de pedido pendente: entrega continua indisponível até existir origem confiável.
- Coordenadas nunca são aceitas como autoridade no preview. Eventual correção manual de coordenadas só pode ocorrer no cadastro/edição de endereço e precisa seguir o contrato já aprovado para esse fluxo; nunca durante checkout.
- Retirada não depende de Geoapify, origem ou faixas. Se o provedor estiver indisponível, retirada permanece disponível.

### 3.3 Referência temporária de endereço de visitante

- Validade inicial: 30 minutos. Token opaco, imprevisível e criptograficamente aleatório; persistir somente seu hash.
- PostgreSQL é o armazenamento compartilhado entre instâncias; não usar memória local nem Redis exclusivamente para esta Sprint.
- Associar a referência ao endereço submetido e aos resultados de validação produzidos pelo backend. Guardar somente os dados necessários à futura composição do pedido; não incluir dados pessoais desnecessários na chave/cache de geocodificação.
- Validar expiração e existência no servidor em todo uso. Expirado ou inexistente exige nova validação; o cliente não envia nem determina coordenadas, distância, frete, status ou validade.
- A referência pode ser reutilizada enquanto válida para obter prévias; não é uma credencial de conta e não altera endereços permanentes de CLIENTE.
- Limpar registros expirados por mecanismo idempotente ligado ao ciclo de vida da aplicação. Falha de PostgreSQL impede emissão/validação segura da referência e deve ser reportada explicitamente; não oferecer fallback local.

### 3.4 Cache, limite de uso e termos Geoapify

Consulta documental oficial em **02/11/2026**:

- A página de pricing consultada apresentava **3.000 créditos/dia** no plano Free e até **5 requisições/segundo**; a página de detalhes informa **1 crédito por requisição de Geocoding**. Os limites e a forma de contabilização podem mudar: confirmar novamente na página, painel da conta e contrato vigente antes de integrar e antes de produção.
- A FAQ atual da página de pricing confirma uso comercial e em produção do Free, desde que respeitados quota, rate limits, limites de API e atribuições. A página de termos consultada ainda exibe “Version 5”, datada de **02/02/2024**, e menciona limitações/contato para detalhes. Usar a FAQ vigente como referência para a decisão aprovada, mas revalidar pricing e termos atuais antes de produção; não presumir que limites ou condições permanecem iguais.
- Revalidação em **03/11/2026**: pricing oficial confirma até **5 requisições/segundo** no plano Free e 1 crédito por consulta de Geocoding; a página atual consultada não expôs o orçamento diário. Os **3.000 créditos/dia** permanecem o limite conservador já registrado nesta Sprint, mas não foram reconfirmados na página atual nem no painel da conta. O serviço ainda não fez chamadas reais; confirmar orçamento da conta antes de habilitá-las.
- Os termos consultados exigem atribuição OpenStreetMap em todo uso, atribuição Geoapify no plano Free e atribuições adicionais conforme API/fontes usadas. A documentação de Geocoding indica fontes diversas (incluindo OpenStreetMap e outras); não presumir que uma única atribuição cobre todos os resultados. Definir apresentação adequada no frontend quando ele existir.
- A página de Geocoding diz que dados de endereço/localização podem ser armazenados sem custo adicional; isso não elimina a obrigação de atribuição, de verificar termos/fontes dos dados nem autoriza redistribuir o serviço ou resultados brutos como produto de terceiros.
- A política de privacidade consultada informa que requisições de API podem incluir body, headers, IP e timestamp e que dados de chamadas bem-sucedidas geralmente são mantidos por até 24 horas para estatísticas. Tratar endereço como dado pessoal: minimizar os campos enviados, documentar o provedor no aviso de privacidade e confirmar os termos atuais/DPA e requisitos legais antes do uso em produção.
- Referências oficiais consultadas:
  - [Pricing](https://www.geoapify.com/pricing/)
  - [Pricing details](https://www.geoapify.com/pricing-details/)
  - [Terms and conditions](https://www.geoapify.com/terms-and-conditions/)
  - [Privacy policy](https://www.geoapify.com/privacy-policy/)
  - [Geocoding API](https://www.geoapify.com/geocoding-api/)
  - [Forward Geocoding API docs](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/)

Planejamento técnico:

- Cache compartilhado no PostgreSQL; chave derivada por HMAC de componentes normalizados de localização, com segredo próprio e sem armazenar a consulta textual em claro no cache. Guardar somente coordenadas e metadados mínimos de qualidade/fonte necessários à validação.
- Coordenar todas as instâncias usando uma linha de controle PostgreSQL atualizada atomicamente: reservar orçamento diário e instante global antes de cada chamada externa. Como limite interno conservador, planejar no máximo 4 req/s agregadas (intervalo de 250 ms), sem exceder o teto Free consultado de 5 req/s; cada retry, se algum for futuramente aprovado, também consumiria uma reserva. Não criar retries automáticos nesta Sprint.
- Contabilizar reservas de chamadas externas conservadoramente até reconciliação com o painel Geoapify; bloquear novas chamadas quando o orçamento diário configurado for atingido e monitorar consumo. Não distribuir chamadas entre contas/projetos para contornar limites.
- Se PostgreSQL estiver indisponível, não chamar Geoapify sem controle global/cache; registrar a falha e manter entrega pendente/indisponível. Retirada permanece independente.
- Definir prazo de retenção do cache antes de implementação e validá-lo contra termos/fontes e privacidade vigentes. Registros devem ter `expiresAt` e limpeza controlada; não manter cache indefinidamente por padrão.

### 3.5 Cupons

- Um cupom por pedido; desconto fixo ou percentual, limitado a 30%; cliente envia somente o código.
- Vigência inclusiva por dias inteiros em `America/Sao_Paulo`; datas persistidas como datas civis, sem comparar com horário local implícito da máquina.
- Elegibilidade configurável para itens e combos. Desconto só incide sobre subtotal elegível, nunca sobre frete.
- Compra mínima é opcional e desativada por padrão; quando configurada, considera subtotal elegível antes do desconto.
- Backend valida estado, datas, valor, elegibilidade e mínimo e recalcula o desconto. Snapshot futuro guarda código e desconto aplicado.
- A prévia retorna o desconto total. Não inventar rateio de cupom fixo entre linhas.

### 3.6 Faixas de frete

- Administráveis por ADMIN; distância em linha reta, limite inicial de 6 km.
- Conjunto ativo cobre continuamente a área configurada, sem intervalos inválidos, lacunas ou sobreposições. Definir intervalos semiabertos e a inclusão do limite máximo na última faixa sem ambiguidade.
- Substituição integral do conjunto em uma transação PostgreSQL; serializar edições concorrentes por lock transacional/serializável. Não deixar estado intermediário parcialmente atualizado.
- Remoção da configuração ativa desativa a faixa sem apagar snapshots históricos. Pedido futuro guarda faixa/distância/taxa aplicadas; desativação nunca recalcula pedidos existentes.
- Valores de seed são exclusivamente fixtures de teste, não preços comerciais.

### 3.7 Pedido com endereço pendente — proposta para sprint posterior

O schema atual exige distância/taxa/total de entrega e possui constraints que não permitem uma entrega sem cotação. Para suportar a exceção aprovada sem valores fictícios, a proposta a validar antes de qualquer migration de pedidos é:

1. Manter o estado operacional existente (`PENDENTE`, etc.) e acrescentar estado de validação de endereço independente, por exemplo `NAO_APLICAVEL`, `PENDENTE` e `CONFIRMADO`.
2. Em pedido de entrega pendente, preservar o endereço submetido e subtotal/desconto calculáveis, mas manter distância, taxa de entrega e total final como `NULL` até verificação manual e cotação real. Nunca usar zero como substituto de frete desconhecido.
3. Retirada continua sem distância e com taxa zero; entrega confirmada exige coordenadas confiáveis, distância, faixa/taxa e total consistentes.
4. A migration posterior deve revisar constraints para adicionar explicitamente o ramo pendente, mantendo as invariantes atuais para pedidos confirmados/retirada e acrescentando testes negativos; não excluir nem enfraquecer checks para contornar o modelo.
5. A confirmação manual da equipe registra ator/data no histórico aprovado, calcula a cotação vigente e só então permite aceitar o pedido. A decisão operacional de recusa/cancelamento segue regras de ADMIN existentes; esta Sprint não cria esses endpoints.

Essa modelagem é planejamento, não autorização para alterar schema nesta tarefa. Antes da migration, revisar os nomes/tipos finais, constraints e efeito sobre consumidores do schema.

## 4. Estrutura e arquivos previstos

### Existentes a inspecionar/modificar conforme a etapa

- `src/app.ts`: registro das novas rotas/plugins.
- `src/routes/itens.ts`: resposta pública com adicionais ativos e validação de seleção, mantendo contratos atuais.
- `src/routes/catalogo-admin.ts`: configuração administrativa de adicionais, se esse for o padrão existente.
- `src/routes/enderecos.ts`: geocodificação de criação/edição de endereço autenticado e persistência de coordenadas/estado, preservando regras de autorização.
- `src/plugins/prisma.ts` e `src/types/fastify.d.ts`: conexão e tipagem da decoração Prisma, sem concentrar regras de negócio.
- `prisma/schema.prisma` e novas migrations incrementais.
- Testes existentes em `tests/api/`, `tests/banco/` e `tests/configuracao/`; reutilizar fixtures e helpers reais.
- `package.json`, `.env.example` e configuração Zod de ambiente somente se a inspeção justificar as mudanças. Não adicionar dependência se `fetch` nativo do Node e dependências existentes atenderem.

### Novos arquivos/pastas previstos

- `src/services/` — criar somente os serviços necessários: `geocodificacao.ts`, `referencias-endereco.ts`, `cupons.ts`, `faixas-frete.ts`, `checkout-preview.ts`.
- `src/providers/geoapify.ts` — adaptador HTTP isolado, timeout, normalização e erros tipados.
- `src/validators/` — schemas de endereço, adicionais, cupom, faixa e preview, conforme padrão Zod do repositório.
- `src/routes/cupons-admin.ts`, `src/routes/faixas-frete-admin.ts`, `src/routes/checkout.ts` — rotas HTTP; registrar em `src/app.ts`.
- `src/plugins/limpeza-referencias-endereco.ts` — limpeza de referências vencidas ligada ao ciclo de vida do Fastify, apenas se não houver mecanismo existente apropriado.
- Testes novos propostos: `tests/unit/providers/geoapify.test.ts`, `tests/unit/services/adicionais.test.ts`, `tests/unit/services/referencias-endereco.test.ts`, `tests/unit/services/cupons.test.ts`, `tests/unit/services/faixas-frete.test.ts`, `tests/unit/services/checkout-preview.test.ts`; testes API em `tests/api/` e testes de persistência em `tests/banco/`, seguindo os helpers reais existentes.

Não criar repositories ou abstrações sem necessidade demonstrada pelo padrão existente. Nomes de migrations serão definidos pelo Prisma durante a implementação; não editar migration já aplicada.

## 5. Alterações de banco previstas

Todas incrementais e revisadas antes de aplicar:

1. **Cupons:** modelo `Cupom` com código normalizado único, modalidade/valor, validade, ativo e compra mínima opcional; relações de elegibilidade para `Item` e `Combo`. Restrições de valor e percentual máximo de 30%; índice de busca pelo código.
2. **Faixas:** modelo persistido para limites, taxa, ativo e ordenação/identificador estável. Validar o conjunto inteiro no serviço/transação; não presumir que uma `CHECK` por linha resolve lacunas/sobreposição globais.
3. **Geocodificação:** tabela de referências temporárias com hash único do token, snapshot mínimo de endereço, coordenadas/resultado de validação, estado e expiração; tabela de cache com chave HMAC única, coordenadas/metadados mínimos e expiração; linha/tabela de controle global com próxima janela e reservas diárias.
4. **Adicionais:** manter `Item.adicionais` JSON; nenhuma tabela nova. Criar migração de dados somente se a auditoria demonstrar que o formato existente não pode ser lido com compatibilidade segura.
5. **Pedido pendente:** fora da migration da Sprint 11. Na Sprint de criação do pedido, avaliar alteração de nulabilidade e revisão condicional das constraints descritas na seção 3.7.

Preservar as 11 constraints `CHECK` existentes. Se uma nova regra exigir ajustar uma constraint, documentar a equivalência para o fluxo normal, o ramo pendente explícito, a razão e testes cobrindo ambos; não apagar ou reduzir proteção. Validar migration e integridade somente no banco `leosburger_test`. Nunca resetar banco de desenvolvimento ou remover volumes Docker.

## 6. APIs e contratos planejados

Os schemas Zod finais devem seguir os nomes/tipos atuais do projeto e ser publicados no OpenAPI. Respostas não devem expor segredo, token em claro além da emissão, dados internos do provedor ou stack trace.

### Adicionais

- `GET /itens` (ou contrato público existente): adicionar configurações ativas de adicionais sem retornar configurações inativas.
- Rota administrativa existente de itens: permitir criar/editar JSON validado; apenas ADMIN.
- Entrada de seleção contém ID e quantidade. Rejeitar ID desconhecido/inativo, duplicado, quantidade fora do limite e adicionais em combo. Não aceitar preço como fonte de cálculo.

### Endereço autenticado

- `POST/PATCH /auth/me/endereco` conforme rotas e contratos existentes: validar dados e geocodificar no backend; não enviar complemento/referência/telefone/nome ao provedor.
- Falha de geocodificação não apaga coordenadas válidas silenciosamente nem as substitui por zero. O comportamento de atualização é detalhado como pendência na seção 9.
- Retirada não depende do resultado do geocoder.

### Validação do endereço de visitante

- `POST /checkout/endereco-visitante/validar`: recebe somente endereço e dados necessários à entrega; não recebe coordenadas, distância, taxa ou validade.
- Resultado explícito: endereço `CONFIRMADO` com coordenadas internas e, quando origem/faixa estiverem disponíveis, cotação; ou endereço `PENDENTE` com motivo não sensível e referência temporária para o fluxo excepcional futuro. Sem origem configurada, retornar entrega indisponível, não criar cotação nem classificar como pendência de endereço.
- Retorna token opaco uma única vez e informações de estado/expiração para UX; o backend verifica o hash e expiração em todo uso. Não retornar a chave Geoapify nem a resposta bruta.

### Cupons e faixas (ADMIN)

- `POST/PATCH /admin/cupons` e consulta administrativa correspondente: validar modalidade, máximo percentual de 30%, dias inclusivos, mínimo opcional e elegibilidade.
- `GET /admin/faixas-frete` e `PUT /admin/faixas-frete`: `PUT` substitui atomicamente o conjunto ativo completo; validar limites e cobertura antes de persistir, sob lock/transação. Proteção ADMIN obrigatória.

### `POST /checkout/preview`

- Acesso permitido a visitante ou CLIENTE autenticado. Ausência de cookie/token é o fluxo visitante; token inválido/expirado continua sendo erro de autenticação, não visitante. ADMIN não pode usar o fluxo de cliente: negar acesso.
- Visitante envia referência temporária; CLIENTE envia endereço próprio já validado conforme contrato escolhido após inspeção. A referência não é intercambiável com endereço permanente.
- Aceitar somente itens/combos, quantidades, seleção de adicionais e código do cupom. Não aceitar preços, totais, coordenadas, distância, faixa, taxa, desconto ou validade como autoridade.
- Revalidar disponibilidade/estado dos produtos, adicionais ativos e limites, composição de combo, elegibilidade/datas do cupom e faixa atual; calcular subtotal, desconto, distância, frete e total no backend.
- Se a validação de endereço estiver pendente, retornar prévia explicitamente não confirmada sem taxa/total final. Se a origem não estiver configurada ou a entrega estiver fora da área, não produzir cotação confirmada; retirada continua disponível.
- Não geocodificar, criar pedido, persistir carrinho/prévia, reservar faixa, iniciar pagamento nem produzir outro efeito colateral. A rota executa somente leituras; cache e referência devem ter sido preparados no endpoint de validação.

## 7. Serviços e responsabilidades

- `GeoapifyProvider`: chamada HTTP server-side, chave em ambiente, timeout, parsing e mapeamento de erros. Usar `fetch` nativo se compatível com a versão Node do projeto; não criar SDK ou dependência por antecipação.
- `GeocodificacaoService`: minimização/normalização do endereço, leitura/escrita de cache, verificação de qualidade do resultado, reserva compartilhada de quota/ritmo e cálculo geográfico. Não conhece regras de pedido/cupom.
- `ReferenciaEnderecoService`: gerar segredo com `node:crypto`, armazenar/verificar hash, expiração, snapshot e estado; não armazenar token claro.
- `EnderecoService`: cadastro/edição autenticados e classificação da geocodificação; preservar coordenadas válidas conforme a política aprovada.
- `CupomService`: validação de status, datas locais inclusivas, elegibilidade e desconto em valores decimais.
- `FaixaFreteService`: validação do conjunto integral, lock transacional, persistência atômica e consulta da faixa ativa.
- `CheckoutPreviewService`: carregar dados persistidos e compor itens, adicionais, combos, cupom, distância/frete e total sem gravar pedido.
- `src/routes/*`: contratos, autenticação/autorização, validação Zod e chamada aos serviços. Evitar regra de negócio em `app.ts`.
- Dinheiro deve usar `Prisma.Decimal`/decimal exato e arredondamento consistente do projeto, nunca `number` binário para calcular valores.

## 8. Sequência de implementação e critérios por etapa

Cada etapa depende da anterior somente quando indicado. Não implementar tudo em uma alteração única.

### Etapa 0 — Auditoria e alinhamento documental

- **Objetivo:** confirmar o estado real, alinhar o provider Geoapify aprovado e revisar quota/termos vigentes.
- **Arquivos:** ler `AGENTS.md`, documentos de arquitetura/regras/APIs, `src/routes/catalogo-admin.ts`, `src/routes/itens.ts`, `src/routes/enderecos.ts`, `src/app.ts`, schema, migrations e testes. Alterações nesses documentos dependem de autorização/escopo documental próprio.
- **Ações:** conferir mecanismos reais de auth opcional, papéis, Zod, Prisma, Node e configuração; inventariar JSON de adicionais sem imprimir dados sensíveis; confirmar planos, quotas, atribuição, termos comerciais e retenção.
- **Testes/aceite:** relatório de compatibilidade e lista de fixtures; decisões pendentes registradas; nenhuma alteração em banco ou implementação antes de resolver divergência de instruções e limite de confiança do geocoder.

### Etapa 1 — Contratos e compatibilidade de adicionais

- **Arquivos existentes:** `src/routes/itens.ts`, `src/routes/catalogo-admin.ts`, `prisma/schema.prisma`.
- **Novos:** schemas Zod de adicional/item; service apenas se regra compartilhada justificar.
- **Banco/migration:** nenhum por padrão; migração controlada só após auditoria do JSON legado.
- **Imports:** reutilizar Zod e Prisma existentes; decimal persistido conforme schema; sem dependência nova.
- **Ações/regras:** fechar estrutura compatível; endpoint público filtra ativos; ADMIN altera JSON validado; rejeitar adicionais em combo e toda seleção inválida; recalcular preço no servidor.
- **Testes:** `tests/unit/services/adicionais.test.ts` e teste API em `tests/api/`; formatos legado/válido/inválido; ID de outro item; inativo; quantidade mínima/máxima; combo; preço falsificado; resposta pública sem inativos.
- **Aceite:** JSON antigo continua legível ou há migração revisada; contrato público e administrativo passam testes.

### Etapa 2 — Adaptador Geoapify e configuração

- **Arquivos existentes:** `.env.example`, configuração de ambiente, `src/app.ts`, logger, `package.json`.
- **Novos:** `src/providers/geoapify.ts`, `tests/unit/providers/geoapify.test.ts`; criar schema de ambiente e `src/services/geocodificacao.ts` somente quando a validação do endereço for aprovada.
- **Banco/migration:** nenhuma nesta etapa; mock em testes.
- **Imports:** `fetch` nativo, Zod para validar estrutura GeoJSON; interface `Geocodificador` para permitir substituir o provider.
- **Ações/regras:** chave somente no backend via `GEOAPIFY_API_KEY`; timeout de 5 s; enviar apenas endereço necessário; mapear erros sem incluir URL, chave ou resposta bruta; retornar candidatos e evidências sem selecionar resultado aproximado/ambíguo.
- **Testes:** `tests/unit/providers/geoapify.test.ts`; timeout durante headers e corpo, HTTP não sucesso, JSON/coordenadas inválidos, nenhum resultado, múltiplos candidatos, ausência de segredo e sanitização de erros. Nenhum teste consome créditos reais.
- **Estado em 03/11/2026:** provider, cache e controle de quota integrados; o serviço de validação classifica somente um resultado `full_match` com componentes coincidentes. Rotas autenticadas e de visitante usam esses serviços. Não houve chamada real. O critério de correspondência e o limite diário da conta continuam pendentes de validação antes de produção.
- **Aceite restante:** validar o critério conservador e os limites efetivos da conta antes de habilitar chamadas reais; aumentar cobertura da API para sucesso, expiração e indisponibilidade.

### Etapa 3 — Persistência PostgreSQL compartilhada de cache, controle e referências

- **Arquivos existentes:** `prisma/schema.prisma`, padrão de migrations, `src/plugins/prisma.ts`, `src/app.ts`.
- **Novos:** migration incremental, modelos Prisma, `src/services/referencias-endereco.ts`, plugin de limpeza se necessário.
- **Banco:** tabelas de cache, referência temporária e controle global de chamadas/quota; índices únicos para HMAC/hash e índice de expiração.
- **Imports:** Prisma transaction/raw SQL parametrizado para lock/reserva, `node:crypto` para token/hash/HMAC; sem Redis.
- **Ações/regras:** token aleatório seguro, persistir somente hash; 30 minutos; cache com prazo aprovado e sem query textual/PII desnecessária; reservar globalmente 4 req/s e orçamento Free diário consultado antes do HTTP; limpeza idempotente; banco indisponível falha fechado.
- **Testes:** `tests/unit/services/referencias-endereco.test.ts` e testes em `tests/banco/`; emissão e verificação, hash-only, expiração, concorrência de reservas em duas conexões, não exceder orçamento, limpeza e erro de banco; executar migration apenas em `leosburger_test`.
- **Aceite:** duas instâncias compartilham cache, controle e referências; nenhum fallback em memória; secrets e tokens ausentes dos logs.
- **Estado em 03/11/2026:** migration aditiva e modelos Prisma criados e aplicados somente em `leosburger_test`; cache HMAC de 30 minutos, reservas serializadas a 4 req/s e limite diário conservador de 3.000, referências de 30 minutos com hash SHA-256 e limpeza periódica no ciclo de vida da aplicação. Testes cobrem cache entre clientes Prisma, expiração, quota concorrente/diária, hash-only, pendência e limpeza. A quota diária ainda precisa ser confrontada com o painel do plano antes de chamadas reais.

### Etapa 4 — Endereços autenticados

- **Arquivos existentes:** `src/routes/enderecos.ts`, schemas/autenticação atuais, `src/app.ts`.
- **Novos:** integração com `EnderecoService`/`GeocodificacaoService` se ainda não criados.
- **Banco:** apenas coordenadas/estado já previstos no modelo; migration somente se a inspeção comprovar ausência de campo necessário.
- **Imports:** serviços da Etapa 2–3 e Prisma existente.
- **Ações/regras:** geocodificar no cadastro/edição; não geocodificar no preview; quando a localização muda e não é confirmada, limpar coordenadas antigas para não associá-las a outro endereço. Alterações apenas de complemento/referência preservam coordenadas e não geocodificam. O perfil autenticado permite enviar latitude/longitude em par durante cadastro/edição como correção manual; visitantes não podem enviar coordenadas.
- **Testes:** `tests/api/perfil.test.ts` e `tests/unit/services/validacao-endereco.test.ts`; cobrem atualização geográfica, provider indisponível, limpeza de coordenadas antigas, preservação em alterações não geográficas e falhas do provider.
- **Aceite:** atualização de endereço não cria falsa coordenada nem perde dados válidos silenciosamente; retirada continua possível.
- **Estado:** implementada; a regra `full_match` único com componentes exatos é conservadora, mas provisória e precisa de validação com endereços reais antes de produção.

### Etapa 5 — Validação de endereço de visitante

- **Arquivos existentes:** `src/app.ts`, padrões de rotas/auth e conexão Prisma.
- **Implementados:** `src/routes/checkout-endereco-visitante.ts`, schema Zod estrito e integração com os serviços de validação e referência.
- **Banco:** usa tabelas da Etapa 3.
- **Imports:** `ReferenciaEnderecoService`, `GeocodificacaoService`, Zod.
- **Ações/regras:** `POST /checkout/endereco-visitante/validar` gera referência server-side sem conta; resposta contém token, situação e expiração, sem endereço ou coordenadas. Falha/ausência de geocodificação gera estado pendente. Este endpoint não calcula frete.
- **Testes:** `tests/api/checkout-endereco-visitante.test.ts` cobre emissão pendente sem provider, persistência hash-only sem coordenadas e rejeição de coordenadas/campos extras; testes de serviço/banco cobrem provider bem-sucedido, tokens confirmados, expiração, uso entre instâncias e limpeza.
- **Aceite:** visitante não fornece coordenada/distância/frete e o servidor mantém associação verificável e compartilhada por 30 minutos.
- **Estado:** implementada localmente. Não há rate limit por cliente/origem nesse endpoint; o limite de quota Geoapify não equivale a proteção contra abuso de emissão de referências e essa proteção deve ser definida antes de produção.

### Etapa 6 — Cupons e elegibilidade

- **Arquivos existentes:** `src/app.ts`, schema Prisma, padrões de rotas ADMIN.
- **Novos:** modelos/migration incremental, `src/routes/cupons-admin.ts`, schemas Zod, `src/services/cupons.ts`.
- **Banco:** Cupom e tabelas de junção de elegibilidade de item/combo; constraints/índices para código e valores.
- **Imports:** `Prisma.Decimal`, Zod, autenticação/autorização atuais.
- **Ações/regras:** CRUD ADMIN, código normalizado, um cupom, validade inclusiva `America/Sao_Paulo`, máximo de 30%, mínimo opcional sobre subtotal elegível, não incluir frete, sem rateio fixo por linha.
- **Testes:** `tests/unit/services/cupons.test.ts`, `tests/api/cupons-admin.test.ts` e `tests/api/checkout-preview.test.ts`; schema/percentual, cálculo em centavos, data de São Paulo, rotas ADMIN, elegibilidade mista, inativo, expirado, esgotado, mínimo, desconto fixo limitado e ausência de linhas elegíveis.
- **Aceite:** serviço recebe código e composição persistida, retorna desconto confiável e não aceita valor calculado pelo cliente.

### Etapa 7 — Faixas de frete administráveis

- **Arquivos existentes:** `src/app.ts`, padrões ADMIN e schema Prisma.
- **Novos:** tabela/migration, `src/routes/faixas-frete-admin.ts`, schemas, `src/services/faixas-frete.ts`.
- **Imports:** transação Prisma e lock PostgreSQL, Zod e Decimal.
- **Ações/regras:** `GET/PUT /admin/faixas-frete`; PUT substitui conjunto completo, valida cobertura sem lacunas/sobreposições e usa advisory lock transacional; faixas omitidas são desativadas sem exclusão física.
- **Testes:** `tests/unit/services/faixas-frete.test.ts` e `tests/api/faixas-frete-admin.test.ts`; faixa válida/inválida, limites, autorização, substituição concorrente e restauração de fixtures. Fixtures são exclusivamente de teste.
- **Aceite:** nenhuma leitura observa estado parcial e duas edições concorrentes não deixam conjunto inconsistente.

### Etapa 8 — Cálculo de checkout e `POST /checkout/preview`

- **Arquivos existentes:** `src/app.ts`, `src/routes/itens.ts`, `src/routes/enderecos.ts`, middleware de autenticação/papéis.
- **Novos:** `src/routes/checkout-preview.ts`, `src/services/checkout-preview.ts` e schemas Zod no próprio serviço.
- **Banco:** leitura apenas; sem migration nesta etapa.
- **Imports:** serviços de adicionais/cupom/faixas/geocodificação, Prisma Decimal e Zod.
- **Ações/regras:** auth opcional distingue cookie ausente de inválido; visitante usa referência, CLIENTE endereço próprio; ADMIN negado; preços/estado vêm do banco; dinheiro calculado em centavos; endereço pendente ou frete sem configuração retorna frete/total `null`; nenhuma chamada ao geocoder ou escrita/efeito comercial.
- **Testes:** `tests/unit/services/checkout-preview.test.ts` e `tests/api/checkout-preview.test.ts`; fluxo visitante/CLIENTE, token ausente/inválido/expirado, ADMIN, endereço não associado, adicional inativo/combos, cupom, entrega normal/pending/sem origem/fora da faixa, retirada sem geocoder, concorrência e assert de zero writes/chamadas externas.
- **Aceite:** valores monetários serializados em decimal sem cálculo financeiro com ponto flutuante; preview não cria pedido/pagamento nem consome cupom; erros de domínio mapeados sem stack trace em resposta.

### Resultado final das etapas 0–9

| Etapa | Resultado | Evidência / limite |
|---|---|---|
| 0 — auditoria e alinhamento | Concluída localmente | Estado Git, schema, migrations, rotas e documentos foram revisados e alinhados. Quota/termos e endereço real seguem validação externa. |
| 1 — adicionais | Concluída | Schemas Zod, compatibilidade conservadora com legado e DTO público ativo; testes unitários, API e build. |
| 2 — provider Geoapify | Concluída localmente | `fetch` server-side, chave em ambiente, timeout, parsing GeoJSON e erros sanitizados; 9 testes unitários. Sem chamada real. |
| 3 — cache/quota/referências | Concluída localmente | PostgreSQL compartilhado, HMAC, lock para cache miss, reserva diária/intervalo e token hash-only de 30 min; testes de banco entre instâncias. |
| 4 — endereço autenticado | Parcial para produção | Criação/edição, correção manual em par e limpeza de coordenadas antigas cobertas; critério de confirmação precisa de validação real. |
| 5 — endereço visitante | Parcial para produção | `POST /checkout/endereco-visitante/validar`, resposta mínima e referência persistida; sem rate limit específico por cliente e sem teste real no provider. |
| 6 — cupons | Concluída localmente | CRUD GET/POST/PUT, elegibilidade, datas locais, limite de usos opcional e cálculo no preview; testes de API/unitários. Uso só será registrado quando a criação de pedidos existir. |
| 7 — faixas | Concluída localmente | `GET/PUT`, validação de conjunto 0–6 km e lock transacional; teste da substituição concorrente. Valores comerciais não configurados. |
| 8 — checkout preview | Concluída localmente | `POST /checkout/preview` de leitura, visitante/CLIENTE, ADMIN negado, valores monetários exatos, frete fail-closed; testes de efeitos nulos e cenários de entrega/retirada. |
| 9 — revisão/documentação | Concluída localmente | Suíte, build, Prisma, migrations de teste e diff validados; nenhum staging/commit/push. Dependências de produção permanecem explícitas. |

### Etapa 9 — Revisão final e documentação

- **Arquivos:** rotas/services/schema/migrations/testes desta Sprint; documentos de API e sprint conforme escopo autorizado.
- **Ações:** revisar todas as CHECK constraints e migrações; validar OpenAPI e mensagens de erro; conferir atribuição/segredos/logs e confirmar termos/quota Geoapify.
- **Validação:** suíte completa `npm test -- --run` (26 arquivos, 163 testes aprovados), `npm run build`, `npx prisma validate`, `npm run db:test:migrate` sem migrations pendentes e `git diff --check`; testes/migrations de banco exclusivamente em `leosburger_test`. Testes de integração que alteram faixas globais são serializados por lock advisory no banco de teste.
- **Aceite:** critérios gerais da seção 10 passam, documentação corresponde ao código, nenhuma alteração local alheia é perdida, sem commit/push não autorizado.

## 9. Pendências externas e de produção

1. **Origem comercial:** configurar endereço/coordenadas reais do restaurante. Até lá, frete real e entrega ficam indisponíveis.
2. **Condições Geoapify:** confirmar no painel/contrato a quota efetiva, atribuição, termos atuais, uso comercial e retenção antes de produção. O controle interno de 3.000 reservas/dia é conservador, mas não prova que a conta tem essa quota.
3. **Confiança do geocoder:** o critério provisório confirma somente um candidato `full_match` com componentes textuais exatos. Validar com endereços reais; não adicionar limiar de confiança inventado.
4. **Privacidade/retention:** cache atual expira em 30 minutos e a limpeza roda periodicamente; definir retenção legal/operacional e atualizar o aviso de privacidade.
5. **Dados legados:** o código conserva JSON legado para leitura administrativa, mas somente configurações estruturadas com ID/estado são publicadas/selecionáveis. Reavaliar registros reais antes de alterações em massa; nenhuma migração de adicionais foi criada.
6. **Pedido pendente e snapshot de frete:** ficam para Sprint 12, com revisão incremental das constraints e snapshot histórico antes de implementar pedidos.
7. **Atribuição no frontend:** não há frontend no repositório; definir apresentação de Geoapify/OpenStreetMap quando a interface for criada.
8. **Rate limit da validação pública:** a rota de referência não tem limitador específico por IP/cliente. Definir e justificar limites por operação antes de produção, sem reutilizar a quota do geocoder como proteção de abuso.

## 10. Critérios gerais de conclusão

- Adicionais JSON existentes são compatíveis ou migrados de forma revisada; só itens individuais podem tê-los e apenas ativos são expostos.
- Geoapify é acessado exclusivamente pelo backend por adaptador substituível; chave não aparece em cliente/log; timeout e falhas são explícitos.
- Quota diária e limite agregado são coordenados no PostgreSQL, cache é compartilhado, tokens são guardados somente como hash e expiram após 30 minutos.
- Termos, plano Free, atribuições e quota efetiva devem ser confirmados antes de produção; chamadas não ultrapassam o orçamento interno configurado.
- Nenhuma entrega é cotada sem coordenadas confiáveis do cliente, origem comercial configurada e faixa/taxa atual. Falha de geocodificação pode produzir apenas estado pendente explícito; não usa taxa/distância/total fictícios. Retirada continua possível sem Geoapify.
- Cupons recalculados no backend respeitam elegibilidade, máximo de 30%, datas inclusivas, mínimo opcional e exclusão do frete.
- Faixas completas e consistentes são administradas atomicamente e concorrência é testada; a criação futura do pedido deve preservar o snapshot de faixa/distância/valor.
- Auth opcional distingue visitante sem credencial de credencial inválida; ADMIN não usa preview de CLIENTE.
- `POST /checkout/preview` valida catálogo/endereço/cupom e recalcula valores, mas não cria pedido, pagamento, escrita ou chamada de geocodificação.
- Migrations incrementais passam no `leosburger_test`; constraints existentes continuam protegendo todos os casos atuais e o ramo pendente explicitamente aprovado.
- Testes relevantes, build, Prisma validate e `git diff --check` passam; documentação e OpenAPI refletem o comportamento final.

## 11. Riscos e mitigação

- **Limite/termos do provedor mudam:** confirmar fonte oficial e painel antes de implementar/produzir; limiter e orçamento compartilhados; atribuição revisada.
- **Endereço incorreto ou ambíguo:** critérios de confiança pendentes; resultado não confiável nunca vira entrega confirmada; equipe pode tratar exceção no fluxo futuro.
- **Origem ainda indefinida:** bloquear cálculo real de frete, sem seed ou coordenada fictícia.
- **Concorrência multi-instância:** controle de quota, referências, cache e faixas usam PostgreSQL e transações/locks; testes com operações simultâneas.
- **Banco indisponível:** falhar fechado para entrega, referência e administração; não contornar limite com estado local. Retirada sem geocoder permanece independente, observadas as dependências normais do checkout.
- **Precisão monetária/distância:** Prisma Decimal, arredondamento explícito e distância em linha reta com regra testada; evitar `number` binário para dinheiro.
- **PII e segredo em URL:** minimizar requisição, HMAC para cache, token em hash, redigir query string nos logs; revisar retenção e aviso de privacidade.
- **Pedido pendente versus constraints atuais:** não criar migração de pedido antes de aprovar modelo, nulabilidade condicional e todos os checks afetados.
- **Histórico alterado por administração:** snapshot de faixa/cupom/preço no pedido futuro; faixas omitidas ficam desativadas, não apagadas.
- **Documentos:** arquitetura, regras, modelo, APIs, testes e mapa foram harmonizados com a implementação Geoapify; alterações preexistentes foram preservadas.
