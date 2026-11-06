# Regras de negócio aprovadas — LEOSBurger

Este documento consolida decisões aprovadas pelo proprietário. Não reabrir decisões nele registradas como definitivas; se surgir conflito com código/documentação, relatar a divergência e distinguir estado implementado de regra aprovada. Pedir decisão apenas quando houver detalhe realmente não definido que não possa ser resolvido como convenção técnica.

## 1. Escopo do produto

- Cardápio digital compartilhável por link.
- Cliente navega pelo cardápio e finaliza pedidos online.
- Área administrativa para gerenciar itens, categorias, combos, cupons, faixas de frete e pedidos.
- Dashboard/fechamento com visão diária e mensal, além de análises semestrais e anuais planejadas.
- Pagamento simulado somente para desenvolvimento e testes; provedor PIX real ainda não foi escolhido.
- Entrega e retirada disponíveis.
- Interface planejada em HTML, TypeScript e Tailwind; sem React.

## 2. Categorias e catálogo

Categorias previstas:

- Lanches
- Acompanhamentos
- Bebidas
- Sobremesas

Regras:

- Combo é uma entidade própria, não uma categoria.
- Acompanhamentos podem aparecer como sugestões de interface/adicionais; não devem virar automaticamente uma tabela ou uma aba separada do cardápio.
- Exemplos de adicionais mencionados: bacon, cheddar, ovo e molho.
- Produtos como Coca-Cola lata podem não aceitar adicionais.
- Não há módulo de estoque no MVP.
- Itens e combos podem ser ativados/desativados no painel administrativo. Combos inativos continuam consultáveis pela administração e ficam ocultos no catálogo público.
- Nesta etapa, somente usuários ADMIN ativos podem criar, editar, listar ou alterar o estado de categorias e itens. A administração não remove registros fisicamente; `ativo` controla sua disponibilidade.
- O nome da categoria é único; o nome do item é único dentro da mesma categoria, conforme as constraints existentes no banco.
- Item administrativo deve referenciar categoria existente, e seu preço não pode ser negativo. O backend valida esses dados sem confiar nos valores do cliente.
- `adicionais` permanece no JSON já existente no modelo, com configuração por item. Cada adicional contém identificador, nome, preço, situação ativo/inativo e quantidade máxima configurável (padrão 1). Só adicionais ativos daquele item podem ser escolhidos, em quantidade inteira positiva até o máximo. O backend valida seleção e preço; o frontend não determina valores. O snapshot da linha do pedido copia identificador, nome, preço unitário e quantidade selecionada. Não há estoque de adicionais.
- Combos são cadastrados pelo proprietário; não dependem de data de validade semanal/sazonal.
- O preço do combo é definido manualmente pelo proprietário e não é recalculado quando seus componentes ou quantidades mudam.
- A composição de combo usa exclusivamente a associação existente `ItemCombo`; cada item pode aparecer uma vez por combo e a quantidade deve ser positiva.
- Se um componente for desativado, a consulta administrativa informa seu estado e sinaliza o combo para revisão manual. O sistema não substitui componentes nem altera o preço ou o estado do combo automaticamente.
- `ItemCombo.removidoEm` controla a composição vigente sem exclusão física: `null` significa associação ativa; data preenchida significa associação removida. A unicidade `(comboId, itemId)` é preservada. O PATCH administrativo usa `removerItemIds` para remover explicitamente; itens omitidos continuam associados. Readicionar um item reativa a associação existente, limpa `removidoEm` e atualiza a quantidade.
- A consulta administrativa retorna a composição vigente em `itens`; associações removidas são incluídas em `itensRemovidos` somente quando `incluirRemovidos=true` é solicitado. A composição pública ignora associações removidas e exige ao menos um componente vigente, todos ativos. Ativar combo com componente inativo é permitido; a consulta pública continua ocultando-o até todos os componentes vigentes estarem ativos.
- Não excluir ou alterar dados históricos de pedidos ao editar o catálogo atual.
- Bebidas esperadas inicialmente incluem Coca-Cola lata e Guaraná, mas isso é conteúdo inicial de catálogo, não regra rígida de código.

## 3. Conta e checkout

- Visitante pode fazer pedido sem criar conta, escolhendo entrega ou retirada; pagamento de visitante é exclusivamente PIX.
- Para os demais métodos de pagamento, exige-se conta autenticada.
- Cadastro público cria apenas usuários do tipo `CLIENTE`; a senha é armazenada com bcrypt e nunca aparece em respostas.
- E-mails são removidos de espaços externos e convertidos para minúsculas no cadastro, login e atualização do perfil.
- A autenticação usa JWT HS256 em cookie `HttpOnly`, `SameSite=Strict` e `Path=/`; o cookie recebe `Secure` em produção.
- O JWT dura 30 dias para `CLIENTE` e 12 horas para `ADMIN`. O token contém o identificador do usuário; o servidor consulta a conta ativa e o papel atual antes de autorizar cada requisição protegida.
- Logout limpa o cookie do navegador, mas não revoga JWTs copiados; eles continuam válidos até a expiração, enquanto o usuário permanecer ativo. Não há tabela de sessões, refresh token ou revogação nesta versão.
- CORS com credenciais permite somente a origem exata configurada em `FRONTEND_ORIGIN`; operações de escrita recusam uma origem diferente.
- Visitantes e clientes autenticados podem escolher entrega ou retirada. Visitante não precisa de conta nem endereço previamente salvo; para entrega informa endereço, que o backend valida e geocodifica antes da finalização. A retirada apresenta o endereço do estabelecimento.
- Geoapify é o serviço inicial aprovado para a Sprint 11, isolado no backend. Enviar somente campos de localização necessários (CEP/logradouro/número/bairro/cidade/estado), nunca nome, telefone, complemento ou referência. Usar cache e controle de quota compartilhados no PostgreSQL, com o limite conservador de 4 requisições por segundo e 3.000 por dia definido na Sprint; confirmar o plano efetivo antes de habilitar chamadas reais. Não fazer autocomplete nem consultas em massa. O frontend nunca chama Geoapify.
- O endereço de visitante validado é associado ao fluxo por referência temporária opaca e aleatória; somente o hash do token fica persistido no PostgreSQL junto ao snapshot mínimo do endereço e do estado da validação. A referência expira em 30 minutos, protege dados e coordenadas contra adulteração e funciona entre instâncias. Não exige conta. O frontend não envia coordenadas livres como autoridade. A criação final do pedido e o pagamento não geocodificam.
- Se Geoapify estiver indisponível, o endereço pode ficar pendente, com possibilidade de nova tentativa. Aquele endereço sem coordenadas válidas não permite ENTREGA; RETIRADA continua disponível. Correção manual do ponto só ocorre durante cadastro/edição do endereço, não como etapa obrigatória do checkout.
- O acompanhamento/operações autorizadas de visitante usam token aleatório criptograficamente seguro; somente hash é persistido e o token nunca é registrado em logs. Permanece válido enquanto o pedido estiver ativo; após conclusão ou cancelamento, expira 30 dias depois da respectiva data. Recuperação exige número do pedido e telefone informado na compra, emite novo token e invalida o anterior. OTP por SMS/WhatsApp não faz parte do MVP; o risco residual da recuperação por número+telefone é aceito e mitigado por rate limit.
- Endereço atual do perfil pode mudar, mas pedidos antigos preservam o endereço usado no momento da compra.
- O modelo admite um endereço por usuário. O próprio usuário autenticado pode consultar, criar, atualizar ou excluir seu endereço; a API não aceita identidade do proprietário enviada pelo cliente.
- CEP é armazenado como string de oito dígitos; a API aceita a forma numérica ou com hífen e normaliza removendo o hífen. O número do endereço é texto e pode conter `S/N`.
- Não há endereço principal no modelo atual. A manutenção do endereço não altera pedidos existentes. A geocodificação usa os campos de localização necessários, nunca apenas CEP sem contexto; respeita minimização de dados definida acima.
- O perfil permite atualizar nome, e-mail e telefone; o e-mail é normalizado para minúsculas. Campos de senha, papel, estado da conta e identificador não podem ser alterados por esse endpoint.

## 4. Pagamentos

Métodos disponíveis no enum do banco:

- PIX
- Crédito
- Débito
- Dinheiro

Regras aprovadas para o checkout futuro:

- Visitante pode finalizar somente com PIX online. Não pode pagar com cartão ou dinheiro na entrega/retirada.
- Cliente autenticado pode escolher PIX online, cartão presencial (crédito ou débito, na maquininha do restaurante) ou dinheiro na entrega/retirada.
- Cartão online está fora do escopo: não coletar dados de cartão, tokenizar, autorizar nem integrar gateway de cartão.
- Nenhum método presencial é considerado pago ao criar o pedido. O estado inicial da tentativa é pendente e uma operação ADMIN autorizada registra o resultado, responsável e data.
- O estado financeiro é separado do estado operacional de preparo/entrega do pedido.
- O MVP não movimenta dinheiro. O simulador é destinado somente a desenvolvimento e testes; uma resposta simulada não é prova de recebimento real.
- Criar contrato genérico independente de fornecedor desde o início da implementação financeira. Não escolher nem integrar provedor PIX real no MVP; regras de checkout não dependem de SDK/fornecedor.
- Não criar webhook vazio, configuração fictícia de fornecedor, nem guardar dados completos de cartão. Confirmação PIX real futura deve vir de notificação autenticada e validada do provedor, nunca do frontend.
- Não confiar em preço, subtotal, desconto, taxa, total, método autorizado nem estado de pagamento enviado pelo frontend. O backend valida identidade/modalidade/método e recalcula todos os valores com dados oficiais.
- A configuração do simulador não pode ser habilitada em produção; iniciar produção com o simulador configurado deve falhar explicitamente.
- O enum existente `metodo_pagamento` mantém `PIX`, `CREDITO`, `DEBITO` e `DINHEIRO`; sua presença não autoriza cartão online.
- Um pedido representa uma compra; cada tentativa de pagamento é uma operação individual persistida em tabela vinculada ao pedido.
- Cada pedido admite duas tentativas PIX no total: cobrança inicial e uma tentativa adicional. Cada tentativa possui cinco minutos, contados de quando o backend confirma a criação da cobrança. Falha ou recusa explícita encerra imediatamente a tentativa, sem aguardar o restante do prazo. A segunda tentativa fica disponível após a primeira falhar, ser recusada ou expirar. A segunda também tem cinco minutos; sua expiração cancela automaticamente o pedido. Falha/recusa da segunda não permite terceira cobrança, mas não dispara por si só o cancelamento automático reservado à expiração.
- Criação é idempotente e concorrência deve impedir cobranças simultâneas ou ultrapassar duas tentativas, inclusive em solicitações concorrentes. Repetir a mesma solicitação idempotente retorna a operação original e não cria cobrança/tentativa. Pedido pago ou cancelado não aceita nova cobrança. Visitantes e clientes autenticados podem solicitar a segunda tentativa quando disponível, sob rate limit próprio ou da criação de pagamentos.
- Alterar produtos, adicionais, endereço, cupom ou modalidade exige um novo pedido; não modificar nem reutilizar o snapshot anterior. Encerrar o pedido anterior pelo fluxo de cancelamento antes de concluir nova compra.
- Confirmação tardia de PIX permanece vinculada à cobrança/tentativa original. Se o pedido já foi cancelado, registrar a confirmação, manter a tentativa como `PAGO`, atualizar o estado financeiro do pedido para `REEMBOLSO_PENDENTE` e preservar o status operacional `CANCELADO`; ADMIN trata o reembolso manualmente. Uma confirmação repetida da mesma cobrança é evento duplicado, deve preservar IDs de evento/transação e ser idempotente, sem reembolso automático. Duas cobranças distintas confirmadas são duas operações financeiras vinculadas às respectivas tentativas; registrar a ocorrência e encaminhar à análise ADMIN, também sem reembolso automático. Não associar confirmação a outro pedido.
- O simulador reproduz pendente, pagamento confirmado, falha, recusa, expiração, confirmação tardia e eventos duplicados; existe somente em desenvolvimento/testes e não movimenta dinheiro nem pode ser habilitado em produção.

O schema real ainda não tem tabela de tentativas nem estado/auditoria completa de pagamentos. A modelagem e migration aditivas serão preparadas nas sprints, sem alteração de schema nesta tarefa.

## 5. Entrega e distância

- A distância de entrega é em linha reta entre as coordenadas do restaurante e as coordenadas válidas do endereço, não por trajeto viário. O limite inicial é 6 km; acima disso, entrega indisponível. Retirada permanece disponível.
- Geoapify é o serviço inicial aprovado para a Sprint 11. A integração fica isolada no backend; geocodifica endereço autenticado no cadastro/edição ou nova tentativa, e endereço de visitante em operação prévia à finalização. O visitante pode usar ENTREGA sem conta: informa CEP/endereço completo, recebe referência temporária persistida e a reutiliza na prévia/criação do pedido. A referência armazena somente o hash do token e o snapshot mínimo, com validade de 30 minutos. O frontend não chama o geocoder nem envia coordenadas livres como autoridade; criação final do pedido e pagamento não geocodificam.
- Respeitar os limites do plano Geoapify, incluindo o teto conservador de 4 req/s e 3.000 consultas/dia definido na Sprint, confirmado pelo controle global PostgreSQL. Confirmar o limite diário da conta antes de chamadas reais; incluir atribuição Geoapify e OpenStreetMap exigida pelo plano. Não fazer autocomplete/geocodificação em lote. Enviar somente campos de localização necessários (CEP/logradouro/número/bairro/cidade/estado), nunca nome, telefone, complemento ou referência.
- Se o serviço estiver indisponível ou não retornar coordenadas confiáveis, manter aquele endereço sem coordenadas e indicar geocodificação pendente, com possibilidade de nova tentativa. Esse endereço não pode ser usado para ENTREGA; RETIRADA segue disponível para qualquer visitante. A correção manual do ponto é aceita somente ao cadastrar/editar endereço e não é etapa obrigatória do checkout.
- Administrador cadastra, edita e ativa/desativa faixas persistidas. Seed de faixas contém apenas dados de teste, nunca valores comerciais. Faixas desativadas não se aplicam a pedidos novos.
- Faixas ativas devem cobrir 0–6 km sem sobreposições, lacunas indevidas ou intervalos inválidos. Validar o conjunto inteiro ao criar/editar/ativar para impedir configuração quebrada.
- Pedido preserva distância calculada, faixa aplicada e valor do frete. Mudanças futuras em coordenadas, faixas ou valores não alteram compras anteriores.
- Retirada não consulta geocoder e tem frete zero.

## 6. Pedidos e histórico

- Pedido pode pertencer a usuário cadastrado ou visitante (`usuario_id` anulável no modelo aprovado).
- Um registro de item do pedido representa um item individual OU um combo; nunca os dois.
- Preservar nome, preço, quantidade, adicionais e valores aplicados no momento da compra.
- Preservar composição do combo no pedido para que mudanças futuras no combo não alterem pedidos antigos.
- Preservar endereço, dados do cliente necessários ao pedido, taxa, desconto e total históricos.
- Identificador interno do pedido é UUID; número sequencial de exibição pode ser usado para facilitar atendimento/visualização, sem substituir o identificador de rastreio.
- O status operacional atual fica no pedido e o histórico de mudanças permanece em JSONB, salvo necessidade demonstrada. Estado financeiro/tentativas é separado.
- Estados operacionais aprovados: `PENDENTE`, `CONFIRMADO`, `PREPARANDO`, `PRONTO`, `SAIU_PARA_ENTREGA`, `CONCLUIDO`, `CANCELADO`; o enum/schema atual já usa `PREPARANDO`. Não renomear para `EM_PREPARACAO`. Retirada pode pular `SAIU_PARA_ENTREGA`.
- ADMIN controla todas as transições operacionais válidas. A única transição automática fora desse controle é o cancelamento por expiração da segunda tentativa PIX. Cancelamento solicitado pelo cliente/visitante depende de decisão ADMIN; pode ocorrer em qualquer estado anterior a `CONCLUIDO`. `CONCLUIDO` não transita para `CANCELADO`; problemas posteriores seguem o processo financeiro de reembolso. Estado operacional e financeiro são independentes.
- Toda solicitação de cancelamento registra motivo, solicitante e horário; decisão registra ADMIN, horário, resultado e justificativa quando aplicável. ADMIN pode decidir inclusive em `PRONTO` ou `SAIU_PARA_ENTREGA`. Pedido `CONCLUIDO` não admite solicitação nem transição para `CANCELADO`; problemas posteriores são tratados somente no processo financeiro de reembolso.
- Cancelamento e reembolso são processos independentes. PIX não pago: cancelar sem reembolso. PIX pago: criar registro de reembolso pendente, com execução manual por ADMIN e confirmação registrada. Cartão/dinheiro presencial pago: registrar devolução manual, valor, responsável e data. Cancelar nunca significa reembolso concluído.
- Cada ocorrência de reembolso tem registro próprio ligado ao pedido e à tentativa/transação original; um pedido pode ter vários registros. O modelo permite valor parcial, mas a operação parcial fica desabilitada no MVP.
- Preservar solicitações, decisões, transições e resultados financeiros na auditoria do pedido; mudanças correlatas são atômicas.

## 7. Cupons

Cupons são criados e editados por ADMIN no painel e persistidos no banco:

- Persistir cupons em `cupons`, `cupons_itens` e `cupons_combos`, com FKs para elegibilidade individual por item e combo, seguindo convenções existentes. Não guardar IDs elegíveis em JSON.
- Cada cupom possui código, tipo percentual/fixo, valor, ativo/inativo, datas de início/fim inclusivas durante todo o dia civil em `America/Sao_Paulo`, compra mínima opcional e limite de usos opcional. Compra mínima e limite de usos ficam desativados por padrão; quando configurados, a compra mínima considera o subtotal das linhas elegíveis antes do desconto, sem taxa de entrega.
- Um pedido usa no máximo um código. Backend remove espaços externos, compara sem diferenciar maiúsculas/minúsculas e confere existência, ativação e validade.
- Validade usa datas civis inclusivas no fuso `America/Sao_Paulo`: o cupom vale durante todo o dia inicial e todo o dia final. A persistência representa datas sem horário; a aplicação compara a data de negócio local. O contrato aceita datas `AAAA-MM-DD`.
- Desconto percentual máximo de 30%, validado no backend e na escrita da configuração. Configuração acima do teto é rejeitada; não limitar silenciosamente.
- Percentual calculado sobre subtotal elegível; desconto fixo aplicado é o menor entre configuração e subtotal elegível. Não descontar taxa de entrega e nunca permitir total negativo.
- Somente itens/combos associados ao cupom são elegíveis; linhas não elegíveis não recebem desconto. O backend resolve essa relação e calcula; frontend envia apenas o código.
- Rejeitar código inexistente, inativo ou fora de validade sem conceder desconto. `LEOS15` 15% e `CUPOM100` inexistente seguem como cenários obrigatórios de teste, não cadastro automático de produção.
- Um código válido cujo carrinho não contenha linhas elegíveis permanece válido, mas aplica desconto zero; a resposta informa esse valor sem atribuí-lo a linhas não elegíveis.
- Pedido mantém snapshot do código e desconto aplicado. Alterações posteriores do cupom/elegibilidade não alteram o histórico.

## 8. Dashboard e administração

- Administração de categorias, itens, combos e pedidos.
- Combos ativos/inativos manualmente; não por agenda.
- Dashboard futuro calculado a partir dos pedidos, distinguindo estado do pedido e estado financeiro; não está implementado.
- Visões diária, mensal, semestral e anual usam calendário `America/Sao_Paulo`; semestre civil é janeiro–junho ou julho–dezembro. Timestamps são persistidos em UTC por convenção da aplicação.
- Separar valores brutos dos pedidos, valores efetivamente recebidos e reembolsos confirmados. Reembolso pendente não é reembolso concluído.
- As agregações devem ocorrer no PostgreSQL; medir desempenho antes de otimizar.
- ADMIN gerencia faixas de frete e cupons por APIs protegidas.
- Não gerar relatórios contábeis em PDF no MVP.
- Não incluir módulo de atendimento telefônico.

## 9. Exclusões explícitas do MVP

- Estoque.
- Atendimento por telefone.
- Pagamento real ou gateway de pagamento.
- Relatórios contábeis em PDF.
- Tabela separada para carrinho no banco.
- React.
- Gateway real ou cartão online na primeira versão.
- Cache Redis nesta etapa; Redis será inicialmente para rate limiting de produção.
- Não limitar artificialmente o modelo a uma contagem de tabelas: o schema atual possui 17 modelos/tabelas após a Sprint 11, e entidades justificadas para pagamentos/reembolsos podem ser adicionadas por migrations revisadas e validadas.

## 10. Regras de integridade e segurança

- Quantidades devem ser positivas.
- Uma linha de pedido não pode apontar simultaneamente para item e combo.
- Totais e valores devem ser calculados no backend.
- Endereço e preço históricos precisam ser imutáveis em relação a alterações posteriores no perfil/catálogo.
- Pedido com entrega deve ter os dados históricos de endereço exigidos pelo schema.
- E-mail deve ser normalizado/validado.
- CEP deve ser validado/normalizado para os dígitos esperados.
- Hash de senha nunca deve aparecer em resposta de API.
- Rotas administrativas exigem autorização.
- Proteger login, criação de pedido/pagamento, validação de cupom, recuperação de token, solicitação de cancelamento, retry PIX e recuperação de senha (quando existir) contra abuso; retornar `429` quando apropriado. Não inventar limites numéricos: propor e justificar limites por operação antes da produção.
- Cliente só consulta seus próprios pedidos e endereços; cadastro/edição pública não pode alterar o tipo do usuário.
- Aplicar autorização ADMIN para operações administrativas e registrar operações administrativas relevantes.
- Proteção de escrita considera CORS e a verificação de origem já implementados para autenticação por cookie; avaliar CSRF de acordo com o mecanismo real, sem presumir que CORS sozinho substitua autorização.
- Usar transação para pedido e linhas; tratar repetição de requisição, concorrência, falha parcial e duplicidade financeira.
- Uma futura notificação PIX deve validar autenticidade e idempotência antes de mudar estado. Nenhum dado de provedor/credencial deve aparecer em código versionado ou logs.
- Rate limit: memória em desenvolvimento, limites controlados e isolados nos testes, Redis compartilhado em produção. Proteger explicitamente a primeira cobrança PIX e a solicitação/criação da segunda, tanto para CLIENTE quanto para visitante. Em produção, operações protegidas de alteração falham fechadas se Redis estiver indisponível e retornam `429` quando aplicável. A consulta GET por token permanece disponível com limitação degradada em memória por processo, usando identificador derivado do token e IP; a estratégia não é distribuída e deve ser complementada por proteção de borda quando disponível. Redis não é obrigatório no ambiente local e não é cache. Valores numéricos por operação são proposta técnica a justificar e aprovar antes da produção.
- Medir HTTP/SQL, quantidade de consultas, conexões e recursos; usar `select`, evitar N+1, `EXPLAIN ANALYZE` em consultas relevantes e planejar índices conforme filtros reais. Não adicionar cache ou abstração preventiva.
