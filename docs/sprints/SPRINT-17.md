# Sprint 17 — Auditoria de segurança e testes integrados

**Estado:** Executar quando os fluxos principais estiverem implementados.

## Objetivo
Verificar a aplicação ponta a ponta, corrigindo riscos fundamentais antes da disponibilização.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Revisar autenticação JWT, assinatura, expiração e cookies: cliente 30 dias, ADMIN 12 horas, `HttpOnly`, `Secure` em produção, `SameSite` adequado e logout por remoção do cookie; não adicionar revogação ou tabela de sessões.
2. Verificar hashes de senha, respostas que não exponham campos privados e ausência de segredos no Git.
3. Testar autorização ADMIN e propriedade de pedidos/endereço com usuários distintos.
4. Verificar CORS, credenciais e proteção CSRF conforme o uso de cookies e as origens do frontend.
5. Verificar limites de tentativas de login/checkout já previstos e implementar ou ajustar os controles fundamentais sem duplicar mecanismos.
6. Testar visitante com PIX e rejeição de outros métodos de pagamento.
7. Testar manipulação de preços, descontos, taxas e totais; o servidor deve recalcular todos os valores.
8. Verificar as 11 restrições CHECK existentes e as regras de histórico, entrega/retirada e exclusividade item/combo.
9. Executar testes de integração dos fluxos principais e da suíte completa.
10. Executar build e auditoria de dependências com as ferramentas já disponíveis. Não atualizar versões principais nem instalar ferramenta nova sem necessidade.
11. Registrar riscos restantes e correções realizadas na documentação de segurança.

## Arquivos envolvidos
- `Testes de segurança/integrados, configuração de ambiente e documentação`

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
- [ ] Acesso indevido é bloqueado; valores são calculados no servidor; cookies e segredos estão protegidos; testes e build passam; riscos restantes são registrados.

## O que esta sprint ensina
Testes de autorização, proteção de sessão, segurança de API e validação de regras de negócio.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
