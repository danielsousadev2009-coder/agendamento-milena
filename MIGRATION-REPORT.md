# Relatório de equivalência: Django para Node.js/Express

## Situação da migração

- A implementação Node.js/Express é a API ativa neste checkout; o Django permanece como legado para rollback.
- O frontend é React 19 + Vite e atualmente chama `/api/*` na mesma origem.
- O Vite encaminha `/api/*` para Express em `127.0.0.1:3000`; a Vercel usa o handler `api/index.js`.
- O PostgreSQL existente é acessado pelo backend; a migração `0002_protect_django_tables.py` habilita RLS e revoga acesso direto aos papéis da Data API do Supabase.
- A conexão ao banco de produção não foi testada; a preservação dos dados precisa ser comprovada em uma base de teste isolada antes do corte.
- A troca será aditiva: manter tabelas, nomes, chaves, hashes e formatos de dados existentes. Não executar DDL, migrations ou cópia de dados durante o deploy.

## Inventário do sistema atual

### Componentes Django legados mantidos para rollback

- `config`: configurações, middleware Django/WhiteNoise, sessões, CSRF, autenticação e roteamento do projeto.
- `requests_app`: models, serializers, validadores, permissões, throttles, segurança/criptografia, serviços, views e rotas REST.
- `django.contrib.auth`: usuários, hashes de senha e autenticação da psicóloga.
- `django.contrib.sessions`: sessões do painel da psicóloga.
- `django.contrib.admin`: rota padrão `/django-admin/`; não há modelos de negócio registrados no admin nem chamadas do frontend para essa rota.

### Tabelas e relações existentes

| Tabela | Finalidade e relações |
|---|---|
| `auth_user` | Usuário e hash de senha do Django; a conta da psicóloga referencia esse usuário. |
| `requests_app_psychologistaccount` | Perfil administrativo único, estado ativo e último login; relação 1:1 com `auth_user`. |
| `requests_app_counselingrequest` | Solicitação, protocolo único, dados pessoais cifrados, digest HMAC do CPF, estado e posição de fila. |
| `requests_app_queuecounter` | Contador transacional da fila. |
| `requests_app_urgencyrequest` | Pedido de urgência; FK para solicitação e, opcionalmente, avaliador. |
| `requests_app_auditevent` | Histórico JSON de mudanças; FKs opcionais para solicitação, urgência e ator. |
| Tabelas `auth_*`/`django_*` | Usuários, permissões, sessões e metadados mantidos pelo Django. Não devem ser removidas nesta migração. |

Regras relevantes:

- Um CPF normalizado não pode ter mais de uma solicitação ativa; a restrição é reforçada por `active_cpf_digest` único.
- Solicitações e descrições de urgência são cifradas com Fernet. O índice do CPF é HMAC-SHA256 com chave separada. O backend precisa conservar ambas as chaves e os formatos para ler os registros atuais.
- O contador da fila é bloqueado durante a criação; reordenações são auditadas.
- Apenas uma conta `PsychologistAccount` ativa e o usuário Django ativo podem acessar o painel.
- A avaliação pública de uma solicitação exige protocolo e CPF correspondentes.
- Solicitações de urgência são privadas e visíveis apenas à psicóloga.

## Equivalência dos endpoints

Todos os caminhos abaixo estão sob `/api/`. Os caminhos, métodos, formatos e códigos de resposta são o contrato a preservar.

| Método e endpoint | Acesso | Comportamento e resposta atual | Destino Node |
|---|---|---|---|
| `GET /health/` | Público | `200 {"status":"ok"}` | Health controller; sem acesso ao banco. |
| `GET /csrf/` | Público | `200 {"detail":"CSRF cookie set."}` e cookie CSRF | Middleware/controlador CSRF; token não HttpOnly para envio no header. |
| `POST /requests/` | Público | Cria solicitação; `201 {protocol,status}`, duplicidade ativa `409 {detail}`; limite 5/hora/IP | Validação + serviço transacional no PostgreSQL legado. |
| `POST /requests/status/` | Público | Confere protocolo/CPF; `200 {status,queue_position}` ou `404 {detail}` | Consulta pública com digest em tempo constante; limite anônimo atual de 60/hora. |
| `POST /requests/urgency/` | Público | Vincula urgência a solicitação; `201 {received,evaluation}` ou `404 {detail}`; limite 3/hora/IP | Serviço com a cifra Fernet existente e auditoria. |
| `POST /admin/login/` | Público, protegido por CSRF | `200 {authenticated:true}` ou `400 {detail}`; limite 5/minuto | Verificação dos hashes Django existentes, atualização compatível para bcrypt após login bem-sucedido e cookie JWT HttpOnly. |
| `POST /admin/logout/` | Psicóloga autenticada | `204` | Revoga cookie de sessão e exige CSRF. |
| `GET /admin/dashboard/` | Psicóloga autenticada | `200 {counts,pending_urgencies,call_list,requests}`; aceita `q`, `classroom`, `status` | Mesmas listas/contagens, sem CPF na listagem; CPF mascarado somente nos detalhes da solicitação. |
| `GET /admin/requests/:id/` | Psicóloga autenticada | `200` com detalhes e histórico; `404 {detail}` | Mesmo formato e autorização. |
| `PATCH /admin/requests/:id/` | Psicóloga autenticada | Atualiza status, contato, nota ou posição da fila; resposta `200 {updated:true}`; validação `400`; inexistente `404` | Mesmas validações, estados, justificativa de reordenação e auditoria. |
| `GET /admin/urgencies/` | Psicóloga autenticada | `200 {urgencies}`; filtro opcional `evaluation` | Mesma ordenação, filtro e acesso restrito. |
| `PATCH /admin/urgencies/:id/` | Psicóloga autenticada | Registra avaliação/justificativa; `200 {updated:true}` ou `404 {detail}` | Mesmo comportamento e auditoria. |
| `GET /admin/urgencies/:id/history/` | Psicóloga autenticada | `200 {history}` ou `404 {detail}` | Mesmo formato e autorização. |

O DRF também retorna objetos de erro de validação por campo (`{"campo":["mensagem"]}`), usa `detail` para erros gerais e rejeita métodos HTTP incompatíveis. A API Node deve manter esse contrato, inclusive respostas sem corpo `204`.

### Recursos de autenticação inexistentes no backend atual

Não foram encontrados endpoints nem fluxos implementados de cadastro público, recuperação de senha, alteração de senha ou atualização de perfil. A tela informa que não há cadastro público. Portanto, esses recursos não fazem parte da equivalência e não serão simulados. A migração precisa manter o login/logout administrativo existente e a compatibilidade com os hashes Django.

## Frontend e integrações

- `src/App.tsx` concentra as chamadas `fetch` à API; todas usam `/api/*`, cookies e CSRF.
- O painel consulta o dashboard a cada 30 segundos para mostrar novas solicitações; não há envio de e-mail, SMTP, Gmail ou outro provedor externo.
- Vite encaminha `/api` ao servidor Express local em `127.0.0.1:3000`.
- `api/index.js` mapeia as rotas Vercel para o aplicativo Express sem iniciar um servidor persistente.
- `render.yaml` mantém a configuração do backend Python legado para rollback; não é necessário configurar `BACKEND_URL` para a função Vercel atual.
- Não há configuração nem dependência Supabase no frontend. A integração existente é PostgreSQL via backend e não deve expor chaves administrativas do Supabase no browser.

## Implementação Node.js/Express

- Função serverless catch-all da Vercel em `api/index.js`, delegando ao aplicativo Express sem `listen()` persistente.
- Módulos separados para configuração, conexão PostgreSQL, repositório, serviços, validadores, controllers, rotas, autenticação/CSRF, autorização e erros.
- SQL direcionado às tabelas Django já existentes; nenhuma tabela ou dado deve ser apagado ou recriado.
- Compatibilidade de leitura com hashes `pbkdf2_sha256` do Django; novas atualizações de hash devem permanecer verificáveis pelo Django durante o período de rollback.
- Mesmos algoritmos e variáveis `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY`; rotação dessas chaves não faz parte da migração.
- JWT com expiração de 14 dias em cookie `HttpOnly`, `Secure` em produção e `SameSite=Lax`; o identificador da sessão é persistido na tabela `django_session` existente e removido no logout, e a conta/estado da psicóloga é revalidado no banco nas rotas administrativas. O frontend restaura o painel se a sessão ainda estiver válida.
- Limites DRF preservados com contadores atômicos na tabela `django_session` já existente, sem DDL; chaves de limite são HMAC de escopo/IP/janela e as linhas expiram na virada da janela.
- CORS limitado a origens explicitamente configuradas; acesso pelo frontend publicado na mesma origem não exige expor credenciais ao cliente.

## Validações pendentes antes do corte definitivo

- Conexão real ao PostgreSQL Supabase e leitura dos dados legados.
- Compatibilidade do banco/role de conexão com RLS e privilégios existentes.
- Fluxos de cadastro de solicitação, consulta, urgência, login/logout, painel, alterações e auditoria usando uma base de teste com o esquema legado.
- Comparação de cada resposta com o contrato Django e verificação do build/testes do frontend.
- Configuração das variáveis secretas na Vercel e validação no domínio de produção.
- Só depois desses passos deve-se desativar Render e retirar o runtime/código Python. As migrações Django existentes são evidência do esquema e não serão apagadas nesta etapa.

## Resultado técnico desta etapa

- Implementados os 14 endpoints REST, incluindo `GET /admin/session/` para restaurar o painel, em módulos Express, com SQL parametrizado nas tabelas existentes e validação dos contratos com testes de API usando banco simulado.
- A função Vercel agora delega ao Express local/serverless; o React continua usando `/api/*` na mesma origem e não aceita mais `VITE_API_BASE_URL`.
- Criados `.env.example`, configuração de build/deploy, verificação de conexão/tabelas (`npm run check:db`) e comando Node interativo para provisionar a conta administrativa.
- `npm test`: 7 testes aprovados; incluem validação, criação/consulta/urgência, painel, login inválido, persistência/revogação da sessão, logout, CSRF, rate limit, Fernet e compatibilidade PBKDF2/bcrypt.
- `npm run lint`: aprovado. `npm run build`: aprovado. `npm audit --omit=dev`: 0 vulnerabilidades conhecidas.
- `python backend/manage.py check`: aprovado, sem problemas no runtime Django legado.
- `npm run check:db` e consultas ao Supabase real não foram executados; os testes usam banco simulado e não comprovam SQL, permissões ou RLS contra a base real.
- Nenhum dado foi lido, modificado, migrado ou removido. Nenhuma alteração de esquema foi necessária.
- O corte final permanece bloqueado até conexão Supabase de teste, validação SQL/roles/RLS, testes CRUD reais e comparação de dados. Até lá, `backend/` Python, requirements, migrations históricas e `render.yaml` são mantidos deliberadamente.
- A rota Django padrão `/django-admin/` não tem equivalência funcional no React: nenhum modelo de negócio é registrado no admin. Ela permanece apenas no backend legado até o corte seguro.
