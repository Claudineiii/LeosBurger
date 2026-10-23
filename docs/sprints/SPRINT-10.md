# Sprint 10 — Perfil e endereços

**Estado:** Executar após autenticação.

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
8. Testar usuário não autenticado, atualização válida, dados inválidos e tentativa de acesso a outro usuário.
9. Executar testes e build; documentar os contratos.

## Arquivos envolvidos
- `Rotas de perfil/endereço, schemas e testes correspondentes`

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
- [ ] Acesso restrito ao dono; validação consistente; endereço atual não modifica pedidos antigos; testes passam.

## O que esta sprint ensina
Identidade autenticada, propriedade de recursos e separação entre dados atuais e históricos.

## Delegação opcional ao agente de código
Se o usuário decidir delegar, o agente deve inspecionar o estado real, implementar o escopo completo, executar os testes e o build, revisar o diff e atualizar a documentação. Não deve ampliar o escopo nem alterar decisões aprovadas.

## Registro ao concluir
- Resultado dos testes:
- Resultado do build:
- Arquivos alterados:
- Documentação atualizada:
- Pendências ou riscos:
