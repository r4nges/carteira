# Carteira

App pessoal para acompanhar uma carteira de investimentos, no PC e no celular, com os mesmos dados nos dois. Este repositório é **público** e não contém dados da carteira: nenhum ticker, quantidade ou valor aparece no código, nos testes, nos logs nem na documentação. A carteira vive só no banco (Supabase), protegida por login.

## Como funciona

- **`app/`**: o app (Preact + Vite, PWA). Publicado no GitHub Pages pelo workflow `deploy-app`. Lê e grava no Supabase com a chave pública *anon* e o login do dono.
- **`coletor/`**: script Python que roda no GitHub Actions (workflow `coletor`) e grava cotações, índices, macro, Tesouro, notícias e o snapshot diário no Supabase, com a chave *service*. Detalhes em [`coletor/README.md`](coletor/README.md).
- **`supabase/`**: esquema do banco ([`migrations/0001_init.sql`](supabase/migrations/0001_init.sql)) e o verificador de RLS (`verificar_rls.py`).
- **Supabase** guarda tudo. Todas as tabelas têm RLS: só o usuário registrado na tabela `dono` lê e escreve; o coletor usa a chave *service*, que ignora a RLS.
- **GitHub Actions** agenda o coletor e publica o app; nenhum servidor próprio.

## Antes do primeiro push

O repositório será público. O histórico do branch de trabalho (`feat/carteira-app`) contém valores do começo do desenvolvimento que não podem ser publicados; a árvore de arquivos está limpa, o histórico não. Por isso:

1. **Integre na `main` com `git switch main` e `git merge --squash feat/carteira-app`**, e faça um commit novo. A `main` só tem o `.gitignore`, então o resultado é uma história nova, sem os commits antigos.
2. **Nunca dê push de `feat/carteira-app`** (nem `git push --all`). Só a `main` sai do seu computador.
3. **Antes do push, procure os seus valores reais no que será publicado.** Liste num arquivo fora do repositório (um por linha) os tickers, as quantidades e os valores em R$ da sua carteira, e rode, com a `main` selecionada:
   ```
   git log -p main | grep -n -F -f /caminho/fora/do/repositorio/valores.txt
   ```
   O resultado esperado é nenhuma linha. Qualquer ocorrência significa que um valor ainda está no histórico: não publique. (Sem `--all`, que incluiria o branch de trabalho.)
4. Planilhas (`*.xlsx`, `*.xls`) e arquivos `.env*` já estão no `.gitignore`; confirme com `git status` que nenhuma planilha da B3 nem arquivo com chave está versionado.

## Preparação (uma vez só, feita pelo dono)

Siga na ordem.

1. **Criar o repositório público no GitHub** e publicar o código:
   ```
   git remote add origin https://github.com/<usuario>/<repositorio>.git
   git push -u origin main
   ```
   O `deploy-app` roda neste primeiro push e vai falhar, porque ainda faltam os secrets e o Pages; é esperado, e ele é refeito no passo 7. O `coletor` só tem agendamento e disparo manual: não roda no push, mas as execuções agendadas falham até os secrets existirem (passo 5); ele é conferido no passo 9.
2. **Criar um projeto Supabase gratuito** em <https://supabase.com>. Anote a URL e as chaves em Project Settings > API (*Project URL*, *anon* e *service_role*).
3. **Criar o esquema do banco**: no Supabase, SQL Editor, cole e rode o conteúdo de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Pode ser rodado de novo sem estragar nada.
4. **Fechar o acesso e criar o único usuário**:
   1. Em Authentication, desligue os novos cadastros (Sign In / Providers: "Allow new users to sign up" desligado). **Faça isto antes de ativar o Pages (passo 7).**
   2. Em Authentication > Users, crie o seu usuário (e-mail e senha) e copie o `id` (uid) dele.
   3. No SQL Editor, registre-o como dono:
      ```sql
      insert into dono (uid) values ('<id do usuário>');
      ```
      Sem essa linha ninguém, além da chave *service*, enxerga os dados.
5. **Cadastrar os secrets do GitHub** (Settings > Secrets and variables > Actions > New repository secret), com os valores do passo 2. A tabela está abaixo.
6. **Criar o token grátis da brapi** em <https://brapi.dev> e salvá-lo como o secret `BRAPI_TOKEN`.
7. **Ativar o GitHub Pages por Actions**: Settings > Pages > Build and deployment > Source: **GitHub Actions**. Depois, em Actions > deploy-app > Run workflow (ou novo push em `app/`) para publicar. O endereço aparece no fim do job `deploy` e é `https://<usuario>.github.io/<repositorio>/`.
8. **Abrir o app, entrar e carregar a carteira**: faça login, vá em Importar e envie a planilha `.xlsx` de posição da B3 (ela fica no seu computador, nunca no repositório), depois digite os alvos em Configurações.
9. **Disparar o coletor**: em Actions > coletor > Run workflow, rode o modo `fechamento` e depois o modo `noticias`. Sem isso o app abre sem preços de hoje nem notícias. Depois disso o agendamento segue sozinho (horários em [`coletor/README.md`](coletor/README.md)). Se for a primeira vez, siga também o "Portão da nuvem" desse arquivo.

### Verificação final

10. **RLS**: no seu computador, com as três variáveis abaixo exportadas (valores do projeto real), rode da raiz do repositório:
    ```
    pip install -r coletor/requirements.txt
    python supabase/verificar_rls.py
    ```
    Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`. Resultado esperado, e só ele: `RLS ok`. Qualquer outra saída significa que a RLS está aberta demais; não use o app até corrigir.
11. **Instalar e conferir no PC e no celular**: abra o endereço do app em cada um e use "Adicionar à tela inicial" (celular) ou "Instalar" (Chrome/Edge no PC). Confira:
    - o login funciona;
    - a carteira é a mesma nos dois aparelhos;
    - a tela Ativos mostra o preço e a hora da cotação (num fim de semana, feriado ou antes das 18h, é a do último pregão, e não a de hoje);
    - a aba Notícias (na tela Início) mostra os blocos preenchidos.

## Secrets

| Nome | Onde cadastrar | Quem usa |
| --- | --- | --- |
| `SUPABASE_URL` | GitHub: secrets de Actions | coletor (`coletor.yml`) |
| `SUPABASE_SERVICE_KEY` | GitHub: secrets de Actions | coletor (`coletor.yml`). Ignora a RLS: nunca vai para o app nem para log |
| `BRAPI_TOKEN` | GitHub: secrets de Actions | coletor (`coletor.yml`) |
| `VITE_SUPABASE_URL` | GitHub: secrets de Actions | build do app (`deploy-app.yml`) |
| `VITE_SUPABASE_ANON_KEY` | GitHub: secrets de Actions | build do app (`deploy-app.yml`) |

Para rodar o app ou o coletor no seu computador, as mesmas chaves vão em variáveis de ambiente ou em `app/.env.local` (modelo em [`app/.env.example`](app/.env.example)); esses arquivos são ignorados pelo git. O `verificar_rls.py` também usa `SUPABASE_ANON_KEY` (a mesma chave *anon*), só no seu computador.

**A chave anon é pública.** O `VITE_SUPABASE_ANON_KEY` fica embutido no JavaScript publicado e qualquer pessoa pode lê-lo; isso é normal no Supabase. O que protege os dados é o login somado à RLS: sem ser o `dono`, o banco devolve nada. Por isso os novos cadastros precisam estar desligados antes de ativar o Pages (passo 4) e o `verificar_rls.py` deve responder `RLS ok` (passo 10). A chave *service_role* nunca entra no app.

## Testes

```
# app (a partir da raiz)
cd app
npm ci
npm test

# coletor (a partir da raiz)
cd coletor
python -m unittest -v

# verificador de RLS (a partir da raiz, sem rede)
python -m unittest discover -s supabase -v
```

O workflow `deploy-app` roda os testes do app antes de publicar; se falharem, nada é publicado.

## Repositório público

- Não versione planilhas da B3 (`*.xlsx`, `*.xls`), arquivos `.env*` nem `coletor/config.json`: estão no `.gitignore`.
- Os logs de Actions de repositório público são públicos. Não adicione `set -x`, `env` nem qualquer eco de variável aos workflows.
- Não escreva ticker, quantidade ou valor da carteira em código, testes, commits, issues ou documentação.
