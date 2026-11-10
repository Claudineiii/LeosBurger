# Sprint 18 — Preparação para produção e futura integração PIX

**Estado:** Planejada; não é integração de provedor nem deploy.

## Objetivo

Conferir segurança operacional, segredos, Redis, backup/recuperação, monitoramento e rollout. Documentar critérios para escolher/adicionar provedor PIX real posteriormente sem selecioná-lo agora.

## Pré-requisitos

- Sprints 11–17 concluídas e evidenciadas.
- Confirmar evidências das Sprints 11–17: Geoapify conforme quota/termos/atribuições atuais, fluxo de endereço visitante sem conta e endereço pendente não entregável; faixas sem valores comerciais no seed; token hash-only válido durante pedido ativo e por 30 dias após conclusão/cancelamento, rotação e permissões; duas tentativas PIX no total, cada uma com cinco minutos e cancelamento após expiração da segunda; reembolso individual/manual; estados operacionais exatos; semestre civil; limites aprovados de rate limit.
- Confirmar frontend e plataforma real de hospedagem; não há caminho de frontend/deploy a presumir no repositório observado.
- Registrar risco residual aceito de recuperação de token por número do pedido + telefone, sem OTP. A Sprint 17 pode avaliar reforço futuro, não implementá-lo como requisito deste MVP.

## Checklist executável

1. Conferir branch, diff, README, scripts, workflows e estrutura real; não alterar CI sem problema concreto.
2. Inventariar nomes/propósito de variáveis sem imprimir valores; manter segredos em secret manager/ambiente e verificar redaction de logs.
3. Garantir HTTPS, `FRONTEND_ORIGIN` exata, CORS restrito, JWT forte, simulador desabilitado em produção, migrations seguras e erros sem dados internos.
4. Redis compartilhado e protegido para rate limiting; limites por operação foram propostos com justificativa e aprovados antes de produção. Operações sensíveis que alteram estado falham fechadas se Redis cair; consulta GET por token permanece disponível e protegida com fallback degradado em memória por processo, identificado por derivação do token e IP. Redis não é cache nem requisito de desenvolvimento local.
5. Backup/restauração testada, PITR/retention se oferecidos pela infraestrutura real, monitoramento/alertas, resposta a incidentes, logs/privacidade e rollback.
6. Definir critérios vendor-neutral de seleção de PIX: cobertura API, autenticação/assinatura, idempotência/eventos, sandbox, suporte, custos/settlement e processo de homologação. Não escolher Asaas/Mercado Pago/PagBank agora.
7. Só quando fornecedor for aprovado, projetar adaptação do contrato, identificador externo/event ID, assinatura, rotação de segredo, retries, timeout, conciliação, confirmação tardia e reembolso. Não criar webhook vazio, campos/credenciais fictícios ou tabela/coluna prematura.
8. Checklist futuro inclui eventos fora de ordem/duplicados, assinatura inválida, valor/moeda incompatíveis, pagamento tardio e pedido cancelado/outra tentativa paga; reconhecer e auditar o recebimento, nunca ignorar. Nenhum reembolso ocorre automaticamente por pagamento duplicado; procedimento manual ADMIN.
9. Revisar docs e README para não afirmar produção pronta ou pagamento real antes de evidência; preparar rollout/rollback sem executar deploy nesta sprint documental.

## Arquivos e responsabilidades

- Revisar documentos existentes (`README.md`, `docs/01_ESTADO_ATUAL.md`, arquitetura, regras, modelo, plano de APIs, testes e Sprints) e configurações realmente presentes.
- Backend define adaptador, proteção e contratos; frontend envia apenas dados necessários e apresenta estados oficiais, sem segredos ou confirmação por conta própria.
- Não criar documentação duplicada ou infraestrutura fictícia.

## Critérios de aceite

Checklist revisado contra sistema/configuração real; secrets não versionados/logados; política do Geoapify, limites aprovados e Redis fail-closed verificados; consulta de token disponível com Redis indisponível; restore/monitoramento/rollback documentados; risco residual sem OTP explícito; escolha de provedor PIX e integração real explicitamente futuras. Não marcar gateway, homologação ou deploy como concluído sem evidências.
