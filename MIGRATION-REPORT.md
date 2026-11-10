# Relatório de equivalência da migração

## Inventário legado

- **Aplicativo Django:** `requests_app`; o restante do backend era a configuração padrão do Django, incluindo autenticação e sessões.
- **Frontend:** React 19 + TypeScript + Vite. As chamadas estavam concentradas em `src/App.tsx`; o Vite encaminhava `/api` para Django e a função Vercel encaminhava ao Render.
- **Integrações:** PostgreSQL do Supabase via conexão direta do backend; notificações por polling de 30 segundos no painel. Não havia e-mail, serviço de recuperação de senha ou integração de cadastro.
- **Segurança de dados:** CPF e descrição de urgência armazenados em Fernet; índice do CPF via HMAC-SHA256; cookies de sessão/CSRF; throttle por IP.

## Equivalência dos endpoints

O Django declarava 12 caminhos de URL; o detalhe da solicitação aceita `GET` e `PATCH`, totalizando 13 combinações método/caminho.

| Método e endpoint | Comportamento mantido | Estado |
|---|---|---|
| `GET /api/health/` | JSON `{ "status": "ok" }` | Implementado |
| `GET /api/csrf/` | JSON de confirmação e cookie CSRF | Implementado |
| `POST /api/requests/` | Validação de nome, CPF e turma; protocolo; fila; auditoria; conflito de CPF ativo | Implementado |
| `POST /api/requests/status/` | Consulta por protocolo + CPF e posição da fila | Implementado |
| `POST /api/requests/urgency/` | Vincula pedido, cifra descrição e registra auditoria | Implementado |
| `POST /api/admin/login/` | Supabase Auth com e-mail confirmado e perfil administrativo ativo vinculado; sessão e cookie locais | Implementado |
| `POST /api/admin/logout/` | Revoga a sessão e limpa cookie | Implementado |
| `GET /api/admin/dashboard/` | Contagens, fila, busca e filtros | Implementado |
| `GET /api/admin/requests/:id/` | Detalhes, CPF mascarado e histórico | Implementado |
| `PATCH /api/admin/requests/:id/` | Status, contato, nota e reordenação justificada da fila | Implementado |
| `GET /api/admin/urgencies/` | Lista e filtro de avaliação; descrição decifrada apenas no painel autenticado | Implementado |
| `PATCH /api/admin/urgencies/:id/` | Avaliação e auditoria | Implementado |
| `GET /api/admin/urgencies/:id/history/` | Histórico de avaliação | Implementado |

Respostas, códigos HTTP, estados, validações e campos consumidos pelo React foram reproduzidos. A nova API centraliza erros, valida JSON, registra logs sem corpos de requisição e limita payloads. Throttles anônimos são por IP, o throttle autenticado é por usuário, e ambos são compartilhados entre instâncias via PostgreSQL; a sessão administrativa usa JWT HS256 revogável, cookie HttpOnly e proteção CSRF.

## Dados e esquema

Os modelos legados correspondem a `requests_app_counselingrequest`, `requests_app_urgencyrequest`, `requests_app_auditevent`, `requests_app_queuecounter` e `requests_app_psychologistaccount`, além de `auth_user` e `django_session`. Nenhuma tabela, usuário ou migration foi apagada; nenhuma alteração de esquema foi necessária. A chave Fernet e a chave HMAC existentes precisam ser mantidas exatamente.

O Supabase Auth valida as credenciais. O cadastro público do Supabase deve permanecer desativado; o e-mail confirmado da conta Supabase deve corresponder ao e-mail do perfil ativo nas tabelas legadas `auth_user` e `requests_app_psychologistaccount`. Essa verificação mantém a autorização do painel restrita à psicóloga. A API usa uma chave pública Supabase apenas no servidor para o login e não usa `service_role`. Depois da autenticação, sessões/throttles Node são compartilhados entre instâncias via tabela PostgreSQL existente `django_session`; cookies Django preexistentes não são convertidos em sessões Node.

## Funcionalidades ausentes no sistema original

- Não havia API nem interface para cadastro público, recuperação ou troca de senha; não foram adicionadas.
- Não havia integração de e-mail/SMS; notificações continuam visíveis somente no painel aberto.
- Não há endpoint público de registro de conta administrativa; a conta de autenticação é criada/confirmada no Supabase e o perfil legado é provisionado por `npm run create:psychologist`.

## Validação executada

- Build de produção React: aprovado.
- Oxlint e `git diff --check`: aprovados.
- Testes unitários/HTTP: CPF, Fernet compatível com ciphertext Python, login Supabase Auth confirmado (simulado), validações, health, CSRF, autorização e CORS: aprovados.
- Conexão ao PostgreSQL Supabase e operações CRUD/auditoria/throttle, além da leitura de sessão quando há conta ativa: aprovadas em teste transacional com dados sintéticos e `ROLLBACK`; nenhuma alteração persistiu.
- Não foram testados login real com a senha da psicóloga nem o deploy/roteamento dentro de um projeto Vercel publicado. Esses testes dependem do ambiente operacional e das credenciais que não devem ser incluídas no repositório.

## Publicação

Configure na Vercel `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `PII_ENCRYPTION_KEY`, `CPF_INDEX_KEY` e `PG_POOL_MAX=1`. Use a URL Transaction pooler do projeto existente. Não defina segredos `VITE_*` nem `BACKEND_URL`. Publique a raiz do repositório; o frontend usa `npm run build`/`dist` e a API é uma função Express Node.js em `api/[...path].js`.
