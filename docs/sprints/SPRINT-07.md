# Sprint 07 — Autenticação JWT e autorização

**Estado:** Concluída e validada após as Sprints 5 e 6.

## Objetivo
Permitir cadastro/login e proteger recursos privados com JWT em cookie `HttpOnly`, sem tabela de sessões ou revogação.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar modelo `Usuario`, dependências, variáveis de ambiente, plugins e documentação existentes. Não mostrar nem copiar valores de segredos.
2. Confirmar campos reais de usuário, papéis existentes e como a senha está armazenada. Se não houver hash seguro, apresentar a opção de biblioteca antes de instalar dependência.
3. Definir os contratos de cadastro, login e logout com schemas Zod e respostas que nunca incluam hash de senha.
4. Implementar validação de credenciais e comparação com hash usando solução segura já instalada ou previamente aprovada.
5. Emitir JWT assinado e validado pelo backend. Configurar cookie `HttpOnly`, `SameSite=Strict`, `Path=/` sem atributo `Domain`; validade de 30 dias para cliente e 12 horas para administrador. Em produção, usar HTTPS e `Secure`.
6. Implementar logout removendo o cookie. Não criar mecanismo de revogação, tabela ou coluna de sessão. A expiração do token continua sendo a proteção temporal no servidor.
7. Implementar identificação do usuário e verificação de papel ADMIN sem confiar em dados não verificados do token ou no corpo da requisição.
8. Testar cadastro válido/inválido, login válido/inválido, cookie, logout, token ausente/inválido/expirado e bloqueio de usuário comum em rota administrativa.
9. Restringir CORS com credenciais a `FRONTEND_ORIGIN` e validar `Origin` nas operações de escrita. O cookie `SameSite=Strict` e a checagem de origem formam a proteção CSRF desta API.
10. Executar suíte completa e build. Atualizar docs de autenticação e variáveis de ambiente sem incluir segredos.

## Arquivos envolvidos
- `Rotas de autenticação conforme convenção existente, plugin/middleware de autenticação, schemas Zod, testes de autenticação e documentação`

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
- [x] JWT é validado; cookies têm prazos corretos; logout remove cookie; não há tabela/coluna de sessão; respostas não expõem hash; rotas ADMIN são protegidas.

## O que esta sprint ensina
Hash de senha, JWT, cookies, autenticação versus autorização, expiração, CORS e CSRF.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes: `npm test -- --run tests/api/auth.test.ts` passou (1 arquivo, 23 testes); `npm test -- --run` passou (9 arquivos, 70 testes). A cobertura inclui atualização de permissões a partir do tipo atual no banco e falha de inicialização para configurações JWT/origem inválidas.
- Resultado do build: `npm run build` passou.
- Arquivos alterados: `.env.example`, `package.json`, `package-lock.json`, `src/app.ts`, `src/plugins/autenticacao.ts`, `src/plugins/documentacao.ts`, `src/routes/auth.ts`, `src/types/fastify.d.ts`, `tests/api/auth.test.ts` e `vitest.config.ts`; documentação atualizada neste registro, no mapa de sprints, no plano de APIs, no estado atual, nas regras de negócio, na arquitetura e no guia de rotas.
- Documentação atualizada: endpoints de autenticação, prazos e atributos do cookie, allowlist CORS/origem, hooks reutilizáveis, configuração de variáveis de ambiente e semântica de logout sem revogação.
- Pendências ou riscos: JWT copiado não pode ser revogado nesta arquitetura e permanece válido até expirar; desativar o usuário bloqueia novos acessos imediatamente. Não há rate limiting de login. Configurar `JWT_SECRET` e `FRONTEND_ORIGIN` no ambiente; em produção, a origem é obrigatória e deve usar HTTPS. O frontend ainda não está implementado. Nenhuma tabela ou migration foi criada.
