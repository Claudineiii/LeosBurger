# Plano de APIs — LEOSBurger

## 1. Objetivo

Este documento é um **plano de endpoints**, não afirma que as APIs listadas já foram implementadas. O agente deve conferir as rotas reais em `src/routes/` antes de concluir qualquer status.

Base atual conhecida: Fastify 5.x, TypeScript, Prisma 6.19.3, Zod, Swagger/OpenAPI e Scalar. A rota já implementada é `GET /health`.

## 2. Princípios para todas as rotas

- Validar parâmetros, query strings e bodies com schemas.
- Documentar operações, entradas, respostas e erros no OpenAPI.
- Responder com códigos HTTP coerentes.
- Não expor detalhes internos nem hashes de senha.
- Não confiar em preços/totais enviados pelo cliente.
- Separar autenticação de autorização; estar autenticado não significa ser administrador.
- Testar sucesso, entrada inválida, ausência de registro, falta de autenticação/autorização e falhas relevantes.
- Usar transação para criar pedido e persistir suas linhas/histórico de forma consistente.
- Manter documentação e comportamento real sincronizados.

## 3. Etapa A — Fundação

| Método | Caminho proposto             | Acesso                       | Objetivo                                 | Estado                                                   |
| ------ | ---------------------------- | ---------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| GET    | `/health`                    | Público                      | Verificar disponibilidade básica da API. | Implementada e testada.                                  |
| GET    | `/reference`                 | Desenvolvimento/documentação | Interface Scalar para explorar OpenAPI.  | Visualizada funcionando; conferir configuração real.     |
| GET    | endpoint OpenAPI configurado | Documentação                 | Servir especificação gerada.             | Confirmar caminho real em `src/plugins/documentacao.ts`. |

Não usar `/reference` como prova de que todas as rotas estão documentadas: cada endpoint precisa de descrição/schema.

## 4. Etapa B — Catálogo público

Planejar primeiro:

- consultar lista de categorias;
- consultar itens ativos por categoria;
- consultar detalhes de um item;
- consultar combos ativos;
- consultar detalhes de um combo.

Regras:

- o cliente público vê apenas itens/combos disponíveis para venda;
- não tratar combo como categoria;
- adicionais permitidos devem respeitar a configuração do item;
- validar paginação/filtros se forem implementados;
- não expor campos administrativos internos.

Caminhos HTTP exatos e convenções de pluralização devem ser definidos antes da primeira rota e mantidos consistentes.

## 5. Etapa C — Administração do catálogo

Operações planejadas:

- criar/editar/ativar/desativar categorias conforme regras;
- criar/editar/ativar/desativar itens;
- definir adicionais permitidos por item;
- criar/editar/ativar/desativar combos;
- manter composição de combo por meio de `itens_combo`.

Todas as operações administrativas exigem autenticação e autorização de administrador. Regras de exclusão devem considerar referências e histórico de pedidos; preferir desativação quando apagar comprometer integridade ou histórico.

## 6. Etapa D — Autenticação e perfil

Operações candidatas:

- cadastro;
- login;
- logout/renovação, conforme estratégia de sessão/token definida;
- consulta/edição de perfil;
- listar/criar/editar endereço do cliente.

Antes de implementar, definir:

- estratégia de autenticação e armazenamento de credencial;
- expiração e revogação de token/sessão;
- hash de senha;
- proteção de rotas;
- respostas seguras;
- normalização de e-mail e CEP.

Não expor hash de senha. Confirmar as decisões de JWT/sessão no código/configuração existente antes de adicionar dependências.

## 7. Etapa E — Checkout e pedidos

Operações candidatas:

- calcular/validar prévia do checkout;
- criar pedido;
- consultar pedido por identificador;
- listar pedidos do cliente autenticado;
- simular resultado do pagamento;
- atualizar status por usuário autorizado/admin;
- consultar histórico de status.

Regras críticas:

- visitante só finaliza com PIX;
- métodos de pagamento previstos: PIX, crédito, débito e dinheiro, com simulação;
- backend recalcula todos os valores.
