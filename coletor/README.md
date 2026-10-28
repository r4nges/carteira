# Coletor de mercado

Lê a lista de ativos do banco (Supabase) e grava ali cotações, índices, macro, Tesouro e o snapshot diário do patrimônio. Cada dado leva horário e fonte. O repositório é público: nenhum ticker, quantidade ou valor da carteira aparece no código, nos logs nem neste arquivo; a carteira fica só no banco.

## Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `SUPABASE_URL` | endereço do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | chave de serviço (ignora RLS; nunca vai para o front-end nem para o log) |
| `BRAPI_TOKEN` | token grátis da brapi.dev (limite grátis: 15 mil requisições por mês). Sem ele, a brapi só atende um conjunto restrito de tickers; se a brapi falhar, o Yahoo cobre as cotações. O nome da variável pode mudar em `brapi_token_env` no config |

No GitHub, as três entram como *secrets* do repositório (Settings > Secrets and variables > Actions) e só chegam ao coletor pelo `env:` do workflow. O modo `noticias` usa só `SUPABASE_*`.

## Modos

| Modo | O que faz |
| --- | --- |
| `pregao` | cotações dos ativos de bolsa, índices (IBOV, dólar, EWZ) e o texto do bloco Mercado (`indicadores.briefing_mercado`). Sai sem fazer nada em fim de semana e feriado da B3 |
| `fechamento` | tudo do `pregao`, mais Fundamentus (P/VP, P/L, DY), macro (Selic, IPCA, PTAX, Focus), Tesouro Direto e o snapshot diário |
| `noticias` | lê os feeds de `noticias/fontes.py`, agrupa a mesma notícia de veículos diferentes, marca ativos e temas macro, pontua e grava em `noticias`. Descarta item publicado há mais de 7 dias e URL repetida no lote, e apaga do banco o que foi gravado há mais de 7 dias. Roda todo dia, inclusive fim de semana e feriado |

`defasado` compara a data da cotação com o último pregão que já devia ter fechado. O código sai com 1 só quando nada foi gravado havendo ativos a coletar; um bloco que falha vira linha `ERRO:` no log, sem derrubar os outros. Os erros no log não citam tickers; o detalhe por ativo fica na coluna `erro` de `cotacoes`. No `noticias` o código sai com 1 quando todas as fontes falham ou quando houve notícias lidas e nenhuma foi salva (mensagem própria, `SEM_NOTICIAS_SALVAS`); uma fonte fora do ar só gera linha `ERRO:` com o nome do veículo. O `briefing_mercado` é regravado a cada `pregao` e `fechamento`, mesmo vazio (o app esconde o bloco), para um texto antigo não passar por atual.

## Rodar localmente

A partir da raiz do repositório, com as três variáveis exportadas:

```
pip install -r coletor/requirements.txt
python coletor/coletor.py --modo fechamento
```

Use sempre esse caminho (`coletor/coletor.py`): o script importa `calendario` e `db` como módulos irmãos. `--config outro.json` é opcional; o padrão é `coletor/config.json` (ignorado pelo git), e se ele não existir vale `coletor/config.example.json`. Na nuvem vale sempre o `config.example.json`.

Testes:

```
cd coletor
python -m unittest -v
```

## Agendamento na nuvem (GitHub Actions)

`.github/workflows/coletor.yml` tem um job por modo. O cron do GitHub é em UTC (Brasília = UTC-3) e não carrega o modo, então cada job compara `github.event.schedule` com o seu cron. Também dá para disparar à mão em Actions > coletor > Run workflow, escolhendo o `modo`.

| Modo | Cron (UTC) | Horário em Brasília |
| --- | --- | --- |
| `pregao` | `0,30 13-20 * * 1-5` | dias úteis, 10h00 a 17h30, a cada 30 min |
| `fechamento` | `30 21 * * 1-5` | dias úteis, 18h30 |
| `noticias` | `10 11-23,0-1 * * *` | todos os dias, de hora em hora, 08h10 a 22h10 |

- `concurrency` é por job: `pregao` e `fechamento` dividem o grupo `coletor`, então nunca rodam ao mesmo tempo (a brapi grátis aceita 1 requisição simultânea). O GitHub guarda no máximo uma execução pendente por grupo: se uma terceira chegar enquanto uma roda e outra espera, a pendente é cancelada. Por isso `noticias`, que não usa a brapi, tem grupo próprio (`coletor-noticias`) e não cancela um `fechamento` à espera.
- `timeout-minutes` por job: 20 (`pregao`), 45 (`fechamento`), 15 (`noticias`). Com 429 persistente a brapi pode gastar até 3 x 60 s por ticker.
- O cron do GitHub pode atrasar alguns minutos em horários de pico.
- `.github/workflows/manter-ativo.yml` roda no dia 1 de cada mês e reabilita os workflows via `gh api`, para evitar a pausa automática de workflows agendados após 60 dias sem atividade no repositório.
- Os logs de Actions de repositório público são públicos. Não adicione `set -x`, `env` ou qualquer eco de variável aos workflows.

## Portão da nuvem (checklist manual, pendente)

Antes de confiar na nuvem, falta confirmar que o Yahoo e o Fundamentus respondem a partir dos IPs do GitHub (sites costumam bloquear IPs de datacenter). Isso depende dos secrets do repositório e é feito pelo Rangel:

1. Cadastrar os secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e `BRAPI_TOKEN`.
2. Em Actions > coletor > Run workflow, rodar `fechamento` (num dia útil, depois das 18h para existir cotação do dia).
3. No log do job, conferir:
   - nenhuma linha `ERRO:` de Fundamentus (`fundamentus_*`) nem de cotações/índices do Yahoo (`cotacoes: X de Y ativos falharam`, ou falha de índices); o detalhe do Yahoo por ativo está na coluna `erro` de `cotacoes`;
   - a linha-resumo `fechamento: N/N cotações gravadas ...` com N igual ao total de ativos de bolsa.
4. Na tabela `cotacoes` do banco, conferir nas linhas novas que `faixa52_min`, `pvp` e `pl` estão preenchidos (ativos sem P/L por natureza, como fundos imobiliários, podem ficar sem `pl`).
5. Disparar `noticias` e conferir a tabela `noticias` e as linhas `ERRO:` do log; fonte bloqueada na nuvem sai de `noticias/fontes.py` ou fica registrada aqui.

Resultado do portão: _pendente_.

### Se a nuvem for bloqueada

Não cortar indicadores. Registrar aqui o bloqueio (qual fonte, qual erro), desligar a nuvem comentando o bloco `schedule:` de `.github/workflows/coletor.yml` (o `workflow_dispatch` pode ficar) e instalar o plano B local abaixo.

## Plano B: agendamento local

Roda o mesmo comando, em um PC ou homelab ligado nos horários. Nenhum segredo vai na linha de comando: o script de envelope carrega as variáveis de um arquivo `.env` fora do repositório (`.env*` já está no `.gitignore`).

Arquivo `.env` (placeholders; preencha com os valores reais, só na sua máquina):

```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_KEY=...
BRAPI_TOKEN=...
```

### Windows (Agendador de Tarefas)

Crie `C:\caminho\rodar-coletor.cmd`, que carrega o `.env` e roda o coletor com o modo recebido:

```
@echo off
for /f "usebackq tokens=1,* delims==" %%a in ("C:\caminho\.env") do set "%%a=%%b"
cd /d C:\caminho\coletor-carteira
python coletor\coletor.py --modo %1
```

Horários locais (Brasília), ajuste os caminhos:

```
schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 18:30 /TN "Coletor fechamento" /TR "C:\caminho\rodar-coletor.cmd fechamento"
schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 10:00 /RI 30 /ET 17:30 /TN "Coletor pregao" /TR "C:\caminho\rodar-coletor.cmd pregao"
```

### Linux ou homelab (cron)

Fuso do servidor em `America/Sao_Paulo`. Em `crontab -e`:

```
30 18 * * 1-5      cd /caminho/coletor-carteira && set -a && . /caminho/.env && set +a && python3 coletor/coletor.py --modo fechamento
0,30 10-17 * * 1-5 cd /caminho/coletor-carteira && set -a && . /caminho/.env && set +a && python3 coletor/coletor.py --modo pregao
```

## Notas sobre os dados

- O VPA vem do par (cotação, P/VP) do próprio Fundamentus, então é coerente entre si. O P/VP gravado usa o preço mais fresco que o coletor achou, dividido por esse VPA; o valor original do Fundamentus fica em `pvp_fundamentus`.
- A faixa de 52 semanas usa a mínima e a máxima intradiárias dos últimos 12 meses (Yahoo). Pode diferir poucos centavos do Status Invest.
- O endereço do CSV do Tesouro Transparente está em `TESOURO_CSV` no `coletor.py` e pode ser sobrescrito com `tesouro_csv_url` no config. Se der erro de download do Tesouro, abra o dataset "Taxas dos Títulos Ofertados pelo Tesouro Direto" no portal e copie o link atual.
- Yahoo e Fundamentus não são APIs oficiais e podem mudar sem aviso. O coletor valida o layout do Fundamentus e registra o erro, em vez de gravar número errado.
- IFIX e curva DI não têm fonte gratuita limpa e ficam de fora.
