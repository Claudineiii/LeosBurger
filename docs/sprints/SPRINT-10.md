# Sprint 10 — Perfil e endereços

**Estado:** Concluída.

## Objetivo
Permitir que o cliente consulte e atualize seu perfil e endereço, sem acessar dados de terceiros.

## Antes de começar
1. Leia `docs/01_ESTADO_ATUAL.md`, `docs/05_PLANO_DE_APIS.md` e `docs/06_PADRAO_DAS_ROTAS_API.md` quando forem relevantes.
2. Confira a implementação real e o estado do Git. Se a tarefa já estiver concluída, audite e registre evidências em vez de duplicar código.
3. Não alterar schema, migrações, dependências ou decisões de negócio sem justificativa e autorização.

## Passo a passo
1. Inspecionar os campos reais de `Usuario` e `Endereco`, a restrição de endereço por usuário e a documentação de negócio.
2. Confirmar que o modelo atual permite um endereço por usuário. Não mudar para vários endereços sem decisão explícita.
3. Definir endpoints de perfil e endereço de acordo com a convenção já usada no projeto.
4. Proteger as rotas e obter o ID do usuário da identidade autenticada, não de um ID arbitrário enviado pelo cliente.
5. Validar campos de perfil e endereço com Zod, incluindo CEP como texto e os formatos reais definidos no schema.
6. Implementar leitura e atualização do próprio perfil/endereço, sem retornar hash de senha ou campos internos.
7. Preservar a regra de que alterações no endereço atual não alteram os dados históricos já gravados em pedidos.
8. Expor perfil próprio por `GET/PATCH /auth/me` e o único endereço do usuário por `GET/POST/PATCH/DELETE /auth/me/endereco`.
9. Testar usuário não autenticado, atualização válida, dados inválidos, unicidade, isolamento entre usuários e preservação do snapshot histórico.
10. Executar testes e build; documentar os contratos.

## Contratos implementados

- `PATCH /auth/me` atualiza somente `nome`, `email` e `telefone`. O corpo é estrito, não pode ser vazio, o e-mail é normalizado para minúsculas e conflito de unicidade retorna `409`.
- `GET /auth/me/endereco` consulta o endereço atual. `POST` cria quando não existe, `PATCH` atualiza parcialmente e `DELETE` exclui; o modelo permite apenas um endereço por usuário. Consultar/atualizar/excluir sem endereço retorna `404`; duplicar criação retorna `409`.
- Todas as rotas identificam o usuário pelo JWT em cookie, nunca pelo body. Escritas verificam a origem. O CEP aceita oito dígitos com hífen opcional e é persistido sem hífen; estado é normalizado para duas letras maiúsculas; número é texto e aceita `S/N`.
- Respostas de perfil/endereço selecionam explicitamente dados públicos. Nenhuma rota altera papel, estado da conta, senha ou coordenadas.
- Alterar ou excluir o endereço atual não modifica os snapshots de endereço já armazenados nos pedidos. Não há checkout, geocodificação ou endereço principal nesta Sprint.
- Não houve alteração de schema ou criação/aplicação de migration.

## Arquivos envolvidos
- `Rotas de perfil/endereço, schemas e testes correspondentes`

Os caminhos são indicativos. Confirme a estrutura real antes de criar arquivos e reutilize os existentes quando apropriado.

## Como validar
Execute primeiro o teste específico da rota ou funcionalidade, depois os testes relacionados, a suíte completa e o build. Comandos conhecidos:

```bash
npm test -- --run
npm run build
git diff --check
```

Confira `package.json` antes de usar um comando específico de teste. Não contorne a proteção do banco de testes.

## Critérios de conclusão
- [x] Acesso restrito ao dono; validação consistente; endereço atual não modifica pedidos antigos.
- [x] Teste focado, suíte completa, build e documentação OpenAPI validados.

## O que esta sprint ensina
Identidade autenticada, propriedade de recursos e separação entre dados atuais e históricos.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes: focado 1 arquivo/10 testes aprovados; suíte completa 12 arquivos/106 testes aprovados.
- Resultado do build: `npm run build` aprovado; `npx prisma validate` aprovado.
- Arquivos alterados: `src/app.ts`, `src/routes/auth.ts`, `src/routes/enderecos.ts`, `src/plugins/documentacao.ts` e `tests/api/perfil.test.ts`.
- Documentação atualizada: estado atual, regras de negócio, plano de APIs, padrão das rotas, testes, mapa e README de sprints.
- Pendências ou riscos: nenhuma pendência técnica identificada. Testes executados no banco isolado; sem alteração do banco de desenvolvimento.
