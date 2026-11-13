# Sistema de Acolhimento Psicológico Escolar

Frontend React/Vite e API REST Node.js/Express. A API é executada como função serverless da Vercel e acessa o PostgreSQL existente no Supabase pelo driver `pg`.

> **Migração em validação:** a implementação Node mantém o esquema legado e não executa migrations ou apaga dados. O acesso ao Supabase de produção não está disponível neste checkout; por isso, o backend Django, as migrations históricas e a configuração Render foram mantidos para rollback. Não desative o serviço antigo nem divulgue o novo endereço antes das validações de banco e fluxo descritas abaixo.

O mapeamento de funcionalidades e endpoints está em [MIGRATION-REPORT.md](./MIGRATION-REPORT.md).

## Funcionalidades

- Registro de solicitação, consulta pública por protocolo e CPF e envio de pedido de urgência.
- Login/logout da psicóloga, painel, fila, detalhes, atualização de status/contato, ordenação e auditoria.
- CPF indexado por HMAC e dados pessoais cifrados no formato Fernet já usado pelo Django.
- Hashes Django `pbkdf2_sha256` verificados no login e atualizados para `bcrypt_sha256` compatível com Django após autenticação bem-sucedida.
- Limites de requisição, validação CSRF, cookies HttpOnly de sessão, restauração do painel após recarregar, CORS restrito e autorização do perfil ativo da psicóloga.
- Notificações do painel por consulta periódica a cada 30 segundos. Não há integração de e-mail.

Cadastro público, recuperação/alteração de senha e atualização de perfil não existiam no backend anterior e não foram simulados. A criação administrativa da psicóloga é um comando de servidor, sem cadastro público.

## Requisitos

- Node.js 22.12 ou superior (Node 24 é compatível com a Vercel).
- Projeto Supabase/PostgreSQL já usado pela aplicação.
- As chaves atuais `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY` do backend em produção.

## Configuração local

Na raiz do repositório, copie o exemplo e edite `.env` localmente:

```powershell
Copy-Item .env.example .env
npm.cmd install
```

Configure no `.env`:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | URL do PostgreSQL. Para Vercel, use no Supabase **Connect → Transaction pooler**, porta `6543`; use o host e usuário exatos fornecidos pelo painel. Codifique caracteres reservados da senha na URL. Em produção, o backend exige `sslmode=verify-full` para validar TLS, certificado e hostname. |
| `DATABASE_SSL_CA_BASE64` | Certificado raiz baixado em **Supabase → Database settings → SSL Configuration**, codificado em Base64. Obrigatório em produção para validar a cadeia do certificado do PostgreSQL. |
| `JWT_SECRET` | Segredo aleatório exclusivo, com pelo menos 32 bytes. Gere um novo; não reutilize uma senha de usuário. |
| `PII_ENCRYPTION_KEY` | Copie exatamente a chave Fernet usada pelo backend atual. Trocá-la torna CPF e descrições já gravados ilegíveis. |
| `CPF_INDEX_KEY` | Copie exatamente a chave HMAC atual. Trocá-la impede localizar solicitações existentes por CPF. |
| `FRONTEND_URL` | Origem do frontend, sem caminho; localmente `http://localhost:5173`. |
| `NODE_ENV` | `development` localmente e `production` na Vercel. |
| `PORT` | Porta local da API; padrão `3000`. |

Baixe o certificado raiz em **Supabase → Database settings → SSL Configuration** e codifique o arquivo localmente para configurar `DATABASE_SSL_CA_BASE64`:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\do\certificado.crt"))
```

Configure o valor gerado nas variáveis do projeto Vercel para Production e não o envie pelo chat nem o versione.

Gere o segredo JWT localmente:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Não use `SUPABASE_SERVICE_ROLE_KEY` no frontend, nem coloque `DATABASE_URL` ou qualquer chave no código. A aplicação usa conexão PostgreSQL de servidor, não a Data API do browser. Nunca envie `.env` por chat ou commit.

Inicie API e frontend em terminais separados:

```powershell
npm.cmd run dev:api
npm.cmd run dev
```

O Vite encaminha `/api/*` para o Express local em `127.0.0.1:3000`. A API de produção não mantém processo Express permanente; [api/index.js](./api/index.js) exporta o handler para a função Vercel. `backend/node/server.js` serve apenas para desenvolvimento local.

O build Vite define `NODE_ENV=production` para o bundle, mesmo que o `.env` local use `development` para executar a API.

## Verificações

```powershell
npm.cmd run check:db
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

`check:db` executa `SELECT 1` e confere somente a existência das tabelas legadas necessárias; não lê registros nem altera o esquema. Os testes automatizados cobrem os contratos HTTP com um banco falso, CSRF, autenticação, hashes, criptografia e validações. Eles **não substituem** testes de integração contra uma base Supabase de teste.

Se não existir uma conta administrativa ativa, é possível provisioná-la interativamente, com senha não exibida no terminal:

```powershell
npm.cmd run create:psychologist
```

Esse comando exige `DATABASE_URL`, acesso ao banco e um terminal interativo. Ele cria linhas de usuário e perfil nas tabelas Django já existentes e exige senha com pelo menos 14 caracteres; não o execute em produção sem autorização e sem validar primeiro uma cópia/branch de teste do projeto.

Para redefinir a senha da única conta ativa de psicóloga, use `npm.cmd run reset:psychologist-password` em um terminal interativo e digite a nova senha nos prompts ocultos. O comando localiza essa conta automaticamente e interrompe sem alterar dados se não houver exatamente uma conta ativa. A operação altera somente o hash da senha e encerra sessões Node do painel; não apaga os dados da conta nem solicita acesso ao e-mail. A senha nunca deve ser enviada pelo chat.

## Publicação na Vercel

1. Importe este repositório na Vercel com a raiz do projeto na pasta principal. O `vercel.json` mantém o build Vite e encaminha `/api/*` para uma função Node.
2. Cadastre os segredos nas variáveis da Vercel para cada ambiente necessário. Não use prefixo `VITE_` para segredos:
   - `DATABASE_URL`: URL do **transaction pooler** Supabase (porta `6543`); o backend exige `sslmode=verify-full`.
   - `DATABASE_SSL_CA_BASE64`: certificado raiz Supabase em Base64, conforme as instruções acima.
   - `JWT_SECRET`: segredo novo e exclusivo.
   - `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY`: valores atuais, copiados sem alteração do serviço backend existente.
   - `FRONTEND_URL`: origem HTTPS de produção, por exemplo `https://seu-projeto.vercel.app`, sem `/` final.
   - `NODE_ENV=production`.
3. Configure `FRONTEND_URL` também para domínios de Preview se precisar acessá-los; a origem do deployment fornecida por `VERCEL_URL` é permitida automaticamente. CORS não aceita curingas.
4. Faça deploy em Preview e execute `npm run check:db` localmente usando a URL/credencial de teste, depois valide o fluxo ponta a ponta numa branch Supabase isolada com dados de teste.
5. Antes do corte, compare amostras e contagens sem expor dados pessoais, teste todos os fluxos e verifique sessões, permissões e logs. Só então direcione o domínio de produção à Vercel e desative o Render.

Não é necessária chave `SUPABASE_URL` ou `SUPABASE_ANON_KEY` no frontend para esta arquitetura; o acesso ao banco é feito exclusivamente pelo backend. Não configure `BACKEND_URL`: a função da Vercel não encaminha mais as chamadas ao Render.

## Banco e compatibilidade

- Nenhuma tabela, usuário ou registro é removido, e nenhuma migration de esquema é aplicada nesta etapa.
- As tabelas `auth_*`, `django_session` e `requests_app_*` são reutilizadas. A tabela de sessões existente mantém os JWTs revogáveis no logout e contadores de limite com expiração; não é necessário criar tabela nova.
- O backend conecta diretamente por PostgreSQL. Use apenas uma credencial de servidor com os privilégios necessários para o esquema atual protegido por RLS; não exponha essa credencial no browser.
- Sessões Django existentes não autenticam no Node. Após o corte, a psicóloga deverá entrar novamente; as novas sessões Node são revogadas no logout e expiram em 14 dias.
- As migrations Django continuam no repositório como histórico do esquema e rollback. Os arquivos Python, `requirements.txt` e `render.yaml` **ainda não foram removidos** porque não foi possível verificar os dados do Supabase neste ambiente.

## Limitações conhecidas antes da migração final

- A conexão de produção e a preservação dos dados ainda precisam ser comprovadas com credenciais configuradas fora do chat e uma base de teste isolada.
- Os testes locais não executam PostgreSQL real nem validam permissões/RLS do projeto Supabase.
- O corte definitivo, a desativação do Render e a remoção segura do runtime Django dependem dessa validação.
