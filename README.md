# Sistema de Acolhimento Psicológico Escolar

Aplicação React/Vite com API REST em Node.js + Express e PostgreSQL no projeto Supabase existente. O frontend e a função da API são publicados sob a mesma origem na Vercel; não há servidor Express permanente.

## Requisitos

- Node.js 22.12 ou superior e npm.
- A URL de conexão PostgreSQL do projeto Supabase atual.
- As chaves `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY` já usadas pelo banco. Não gere outras para uma instalação existente: isso impediria a leitura dos dados pessoais atuais.

## Configuração local

1. Copie `.env.example` para `.env`.
2. Preencha `DATABASE_URL` com a conexão **Transaction pooler** do projeto Supabase existente. Use o host, o usuário, a senha e a porta mostrados pelo painel; não componha a URL manualmente. A porta usual do pooler de transação é `6543`.
3. Configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` com os valores de **Project URL** e **Publishable key** do mesmo projeto Supabase. Nunca use `service_role` nesta aplicação.
4. Configure `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY` com os valores atuais, preservando-os exatamente.
5. Gere um `JWT_SECRET` exclusivo:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

6. Instale dependências:

   ```powershell
   npm ci
   ```

7. Abra dois terminais:

   ```powershell
   npm run dev:api
   ```

   ```powershell
   npm run dev
   ```

   O Vite encaminha `/api/*` para o Express local em `http://127.0.0.1:3000`.

O servidor também aceita as variáveis legadas `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` e `DB_SSLMODE`, portanto a configuração local atual pode ser reutilizada sem imprimir ou copiar credenciais. Para TLS, `require` cifra a conexão sem validar a CA do servidor, igual ao modo libpq `require`; `verify-full` valida certificado e nome do host e pode receber uma CA Base64 em `DB_SSL_CA`.

## Scripts

| Comando | Uso |
|---|---|
| `npm run dev` | Frontend Vite |
| `npm run dev:api` | API Express local |
| `npm start` | API Express fora da Vercel |
| `npm run build` | Build de produção do React |
| `npm run lint` | Oxlint |
| `npm test` | Testes unitários e HTTP |
| `npm run test:db` | Teste PostgreSQL opt-in, com CRUD sintético dentro de transação revertida |
| `npm run create:psychologist` | Cria o perfil administrativo legado que será vinculado à conta Supabase |

O login da psicóloga usa Supabase Auth. Desative o cadastro público nas configurações de Auth do projeto e crie ou convide a usuária em **Authentication → Users**. Confirme o e-mail e use o mesmo e-mail do perfil administrativo ativo existente no banco. A senha é gerenciada pelo Supabase; redefina-a pelos fluxos de recuperação do Supabase, não pelo banco legado. O projeto não oferece cadastro público.

Para executar o teste real do banco em PowerShell:

```powershell
$env:RUN_DB_INTEGRATION = 'true'
npm run test:db
Remove-Item Env:\RUN_DB_INTEGRATION
```

O teste verifica a conexão e o esquema existente, cria registros exclusivamente sintéticos dentro de uma transação e termina com `ROLLBACK`. Não aplica migrations nem persiste esses registros.

## Deploy na Vercel

1. Importe o repositório com a raiz do projeto na pasta principal. O build configurado é `npm run build`, com saída em `dist`; `api/[...path].js` encaminha todas as rotas REST para uma única função Express.
2. Configure as variáveis de ambiente na Vercel:
   - `DATABASE_URL`: URL do **Transaction pooler** do mesmo projeto Supabase.
   - `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`: URL e chave pública do mesmo projeto. Não configure a chave `service_role`.
   - `JWT_SECRET`: segredo aleatório exclusivo, com no mínimo 32 bytes.
   - `FRONTEND_URL`: origem HTTPS exata do domínio de produção, sem caminho ou barra final.
   - `PII_ENCRYPTION_KEY`: valor atual do banco, sem alteração.
   - `CPF_INDEX_KEY`: valor atual do banco, sem alteração.
   - `PG_POOL_MAX`: `1` recomendado para a função serverless.
   - `DB_SSLMODE`: opcional; `require` cifra a conexão, `verify-full` valida certificado/host e aceita a CA Base64 em `DB_SSL_CA`.
3. Faça o deploy e teste `/api/health/`, login e os fluxos do sistema no domínio publicado. O ambiente `Preview` também aceita a URL de deploy específica fornecida pela Vercel.

Não configure `BACKEND_URL`, `VITE_API_BASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ou qualquer segredo como variável `VITE_*`. A API usa a mesma origem do frontend e acessa o PostgreSQL somente no servidor. CORS não é aberto a origens arbitrárias.

## Dados e autenticação

Não é necessária alteração de esquema: a API usa as tabelas Django já existentes e não apaga tabelas, usuários ou registros. O Supabase Auth valida a senha; para autorizar o painel, o e-mail confirmado precisa corresponder ao e-mail de um perfil administrativo ativo em `auth_user` e `requests_app_psychologistaccount`. As tabelas antigas de autenticação e sessões permanecem como dados PostgreSQL; os arquivos de migrations históricos também são mantidos. Após o login, a API emite uma sessão JWT revogável, armazenada em cookie HttpOnly; sessões e throttles usam a tabela existente `django_session`.

Contas Supabase sem e-mail confirmado não podem entrar. Novas contas administrativas não são criadas pelo frontend: crie ou convide a usuária no Supabase Auth e mantenha o perfil administrativo correspondente no banco. O cookie da sessão é HttpOnly, Secure em produção, SameSite=Lax e expira após 8 horas; alterações autenticadas exigem CSRF.

Cadastro público, recuperação e alteração de senha não faziam parte do backend anterior e, portanto, não foram inventados nesta migração. Não existe envio de e-mail: notificações de novas solicitações continuam sendo obtidas por polling enquanto o painel da psicóloga está aberto.

Veja [MIGRATION-REPORT.md](./MIGRATION-REPORT.md) para a equivalência dos endpoints, tabelas, funcionalidades e limites de validação.
