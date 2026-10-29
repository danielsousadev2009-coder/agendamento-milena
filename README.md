# Sistema de Acolhimento Psicológico Escolar

Aplicação web com frontend React/Vite e API Django. O banco PostgreSQL pode ser hospedado no Supabase.

## Configuração do banco Supabase

1. No Supabase, crie um projeto e obtenha os dados de conexão PostgreSQL em **Project Settings → Database**. Use o host, o usuário, a senha, o nome do banco e a porta fornecidos pelo Supabase. Para conexões diretas, o host normalmente usa a porta `5432`; se a rede não permitir conexão direta, configure o pooler indicado pelo Supabase.
2. Na raiz do projeto, copie `.env.example` para `.env` e preencha as credenciais localmente. Não compartilhe nem envie o `.env` ao Git.
3. Gere valores exclusivos para `DJANGO_SECRET_KEY`, `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY`. Exemplo de geração local da chave Fernet:

   ```powershell
   Set-Location backend
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Gere `DJANGO_SECRET_KEY` e `CPF_INDEX_KEY` com valores aleatórios longos. Guarde as três chaves em local seguro: perder ou trocar as chaves de criptografia impede a leitura dos dados pessoais já armazenados.
4. Instale as dependências do backend e aplique as migrações:

   ```powershell
   Set-Location backend
   python -m pip install -r requirements.txt
   python manage.py migrate
   ```

O backend carrega o `.env` da raiz do projeto. Se `DB_NAME` estiver configurado, conecta ao PostgreSQL; sem ele, usa SQLite local. A conexão PostgreSQL é fechada ao final de cada requisição para evitar acumular sessões no pooler compartilhado. `DJANGO_CSRF_TRUSTED_ORIGINS` deve conter as origens permitidas do frontend; o exemplo inclui as origens locais do Vite. Em produção, substitua-as pelas origens HTTPS reais. As migrações criam as tabelas do Django e do sistema, inicializam o contador da fila e protegem as tabelas contra acesso direto pelos papéis da API do Supabase. Para criar o acesso administrativo da psicóloga depois de conectar e migrar o banco, execute `python manage.py create_psychologist`.

## Notificações e painel da psicóloga

Enquanto a psicóloga estiver conectada ao painel, o sistema verifica a cada 30 segundos se chegaram novas solicitações e mostra os avisos na seção **Notificações**. Não é necessário configurar Gmail ou senha de app. Os avisos são exibidos no painel aberto; para recebê-los quando estiver desconectada, será necessário integrar um serviço externo de e-mail ou notificações.

Na área da psicóloga, a lista de chamada permite atualizar a situação do contato e alterar a posição com justificativa. Os pedidos de urgência têm seção própria para ler a descrição e registrar a avaliação e o encaminhamento.

Não configure a chave `service_role` do Supabase no frontend. A aplicação acessa o PostgreSQL pelo backend Django usando as credenciais do banco.

## Publicação com Render e Vercel

O arquivo `render.yaml` prepara a API Django no Render e `vercel.json` configura o frontend Vite. A Vercel também encaminha as chamadas `/api/*` ao Render pelo endpoint em `api/`; isso mantém cookies de sessão e CSRF na mesma origem do site, sem depender de cookies de terceiros. Não defina `VITE_API_BASE_URL` na Vercel.

### 1. Publicar a API no Render

1. Envie o projeto para um repositório GitHub e, no Render, crie um **Blueprint** a partir desse repositório. O Render detectará `render.yaml`.
2. Preencha as variáveis marcadas como secretas usando os dados atuais do `.env` local e as credenciais do Supabase: `DJANGO_SECRET_KEY`, `PII_ENCRYPTION_KEY`, `CPF_INDEX_KEY`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` e `DB_HOST`. Use o host/porta e modo SSL indicados pelo Supabase; não coloque esses valores no Git.
3. Aguarde o deploy ficar saudável em `/api/health/`. O comando de inicialização executa `migrate` antes de iniciar o Gunicorn. Mantenha uma instância enquanto usar o plano gratuito.

### 2. Publicar o frontend na Vercel

1. Importe o mesmo repositório na Vercel, mantendo a raiz do projeto na pasta principal. As configurações de build e saída já estão no `vercel.json`.
2. Em **Settings → Environment Variables**, defina `BACKEND_URL` como a URL HTTPS pública do serviço Render, sem `/api` no final (por exemplo, `https://nome-do-servico.onrender.com`).
3. Faça o deploy e anote o domínio de produção atribuído pela Vercel.

### 3. Autorizar o domínio do site

No Render, defina `DJANGO_CSRF_TRUSTED_ORIGINS` com a origem exata do domínio de produção da Vercel, incluindo `https://` e sem barra final (por exemplo, `https://nome-do-projeto.vercel.app`). Não use curingas nem domínios de preview. Salve a variável e aguarde o novo deploy do backend.

### 4. Antes de abrir para usuários

- Redefina a senha temporária da psicóloga **antes de divulgar o site**. A senha temporária foi compartilhada durante a configuração anterior. No Shell do serviço Render, use `python manage.py changepassword NOME_DE_USUARIO`.
- Se ainda não houver uma conta da psicóloga no banco, crie-a pelo Shell do Render com `python manage.py create_psychologist`.
- Confirme que `/api/health/` responde com `{"status":"ok"}`, que o formulário grava uma solicitação e que o login/logout administrativo funciona no domínio de produção.
- O Render gratuito pode suspender o serviço quando ocioso e causar demora na primeira solicitação. A instância gratuita é configurada para executar um worker, importante para respeitar o limite de conexões do pooler Supabase.
- Notificações são exibidas apenas no painel aberto da psicóloga; não há envio de e-mail nem notificação quando ela está desconectada.

Não publique se alguma variável de banco, chave de criptografia ou origem CSRF estiver faltando. Preserve `PII_ENCRYPTION_KEY` e `CPF_INDEX_KEY` já usadas pelo banco: trocar essas chaves pode tornar dados pessoais existentes ilegíveis.
