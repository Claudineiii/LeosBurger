# Sprint 07 — Autenticação JWT e autorização

**Estado:** Executar depois do catálogo público; conferir dependências e código antes de começar.

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
5. Emitir JWT assinado e validado pelo backend. Configurar cookie `HttpOnly`; validade de 30 dias para cliente e 12 horas para administrador. Em produção, usar HTTPS e `Secure`; configurar `SameSite`, domínio e path conforme o ambiente.
6. Implementar logout removendo o cookie. Não criar mecanismo de revogação, tabela ou coluna de sessão. A expiração do token continua sendo a proteção temporal no servidor.
7. Implementar identificação do usuário e verificação de papel ADMIN sem confiar em dados não verificados do token ou no corpo da requisição.
8. Testar cadastro válido/inválido, login válido/inválido, cookie, logout, token ausente/inválido/expirado e bloqueio de usuário comum em rota administrativa.
9. Verificar CORS e credenciais entre frontend e backend. Avaliar a proteção contra CSRF de acordo com a configuração de cookies e origens.
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
- [ ] JWT é validado; cookies têm prazos corretos; logout remove cookie; não há tabela/coluna de sessão; respostas não expõem hash; rotas ADMIN são protegidas.

## O que esta sprint ensina
Hash de senha, JWT, cookies, autenticação versus autorização, expiração, CORS e CSRF.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
