# FeedForge — product feed optimizer (hôma)

Lê o feed Meta (CSV do SFCC) todos os dias, deteta diferenças face ao dia anterior, aplica regras, labels, edições manuais e copy AI (Claude Haiku), converte para Google Merchant Center e escreve ambos numa Google Sheet cujos links CSV públicos vão para o Meta e o GMC.

## Como funciona o run diário

1. **Download** do CSV de origem.
2. **Diff vs dia anterior** → novos · removidos · conteúdo alterado · só stock/preço · iguais.
   - Proteção: se o feed de hoje tiver menos de X% dos produtos de ontem (por omissão 50%), o run aborta e o Sheets fica como estava.
3. **AI só para produtos novos** (com campos sub-otimizados, ou todos os novos — configurável). Os existentes mantêm a copy AI já gerada. Máximo por run configurável; o excedente fica em fila para o dia seguinte.
4. Para cada produto: `origem → AI → regras → edições manuais → campos trancados (sempre da origem)`.
   - **Regras e labels são calculados uma vez por produto e guardados em cache.** Só voltam a correr para produtos novos, produtos cujos dados mudaram (incluindo preço/promo, para os labels de faixa de preço/promo ficarem certos), ou quando uma regra é editada ou entra/sai do agendamento.
   - **Agendamento por regra/label:** sempre (até eu remover), a partir de uma data (até eu remover) ou entre datas (ex.: Black Friday 20–30 nov). Fora do período a regra não se aplica e o label volta ao valor da origem.
5. **Meta** (mesmas colunas da origem + colunas criadas por regras) e **GMC** (mapeamento configurável).
6. Escreve os separadores `meta` e `gmc` na Google Sheet (sem limpar primeiro — o CSV público nunca fica vazio a meio).

Campos **trancados** (por omissão `id, availability, price, sale_price, sale_price_effective_date, inventory, link, image_link, gtin`) passam sempre diretos da origem para o Sheets. Na conversão GMC só muda o formato (`in stock` → `in_stock`, preço `6.00 EUR`).

## Setup (≈15 min)

### 1. Repo + Netlify
1. Cria um repo GitHub (privado) e faz push desta pasta.
2. Netlify → *Add new site → Import from Git* → escolhe o repo. Não há build: publish dir `public`, functions em `netlify/functions` (já está no `netlify.toml`).
3. Netlify Blobs (armazenamento) fica ativo automaticamente.

### 2. Variáveis de ambiente (Site configuration → Environment variables)
| Variável | Valor |
|---|---|
| `APP_PASSWORD` | password para entrar na app |
| `ANTHROPIC_API_KEY` | chave da API Anthropic |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conteúdo do JSON da service account (pode ser colado tal como está, ou em base64) |
| `AI_MODEL` *(opcional)* | sobrepõe o modelo definido na app (por omissão `claude-haiku-4-5`) |

Depois de definir as variáveis, faz *Deploys → Trigger deploy*.

### 3. Service account Google
1. [console.cloud.google.com](https://console.cloud.google.com) → cria/escolhe um projeto → *APIs & Services → Library* → ativa **Google Sheets API**.
2. *IAM & Admin → Service Accounts → Create* (sem roles) → separador *Keys → Add key → JSON* → descarrega.
3. Cola o conteúdo do JSON em `GOOGLE_SERVICE_ACCOUNT_JSON`.

### 4. Google Sheet de destino
1. Cria uma Google Sheet vazia (ex.: "hôma feed PT").
2. *Partilhar* → adiciona o email da service account (aparece em Definições na app) como **Editor**.
3. *Partilhar → Acesso geral → Qualquer pessoa com o link → Leitor* (para os links CSV serem públicos).
4. Cola o URL da sheet em **Definições** na app.

### 5. Primeiro run
1. Entra na app → cria o feed (nome, língua, URL do CSV) → **Testar** em Definições.
2. Revê **Campos & locks** e **AI** → **Dashboard → Correr run completo**.
3. Copia os links do Dashboard:
   - **Meta**: Commerce Manager → Catálogo → Fontes de dados → *Feed agendado* → URL `…/export?format=csv&gid=…` → diário.
   - **GMC**: Produtos → Fontes de dados → *Ficheiro → Obter ficheiro agendado* com o link `gmc`, ou diretamente *Google Sheets* (seleciona o separador `gmc`).
   - Agenda Meta/GMC para buscar **depois** da hora do run da app (ex.: run às 06:00 → Meta/GMC às 08:00).

> No primeiro run todos os produtos são "novos": a AI processa até ao máximo por run (300) e o resto vai saindo nos dias seguintes. Podes subir o máximo temporariamente.

## Funcionalidades

- **Dashboard**: KPIs, links finais, diff do último run, problemas de qualidade (clicáveis), *Correr run completo* e *Aplicar alterações* (reaplica regras/edições ao último feed e atualiza o Sheets, sem download nem AI).
- **Produtos**: pesquisa, filtros (novos, sub-otimizados, AI, editados, excluídos), editor por produto com origem vs final, revert por campo, gerar/aceitar/remover copy AI, preview GMC. "Enviar filtro para AI" força re-otimização no próximo run.
- **Regras**: SE (condições sobre qualquer campo ou campos virtuais `_discount_pct`, `_days_since_first_seen`, `_effective_price`, `_title_length`…) ENTÃO (definir com template `{{campo}}`, acrescentar, substituir/regex, remover, maiúsculas, truncar, remover HTML, mapear valores, faixa de preço, copiar campo, excluir do Meta/GMC/ambos). Pré-visualização antes de guardar.
- **Labels**: presets para `custom_label_0–4` (faixa de preço, promo, desconto ≥ X%, novidades N dias, mapeamento, valor fixo).
- **Campos & locks**: trancar campos, escolher campos que a AI otimiza, limites de qualidade.
- **AI**: modelo, modo (sub-otimizados/todos os novos), máximo por run, tom de voz, instruções por campo.
- **Conversão GMC**: mapeamento automático ou personalizado (transformações availability, condition, age_group, gender, preço, lista, template, valor fixo, identifier_exists).
- **Definições**: origem, coluna de ID, Sheet, separadores, hora do run (Lisboa), proteção de % mínima.
- **Histórico**: últimos 40 runs com passos, diff e IDs novos/removidos.
- Vários feeds (ex.: PT e ES) na mesma app — seletor no topo.

## Estrutura

```
netlify/functions/api.mjs             API JSON (/api/*) para a UI
netlify/functions/run-background.mjs  pipeline (background function, até 15 min)
netlify/functions/daily.mjs           agendada de hora a hora → corre cada feed à hora definida
netlify/lib/pipeline.mjs              diff, AI, regras, edições, locks, outputs, Sheets
netlify/lib/rules.mjs                 motor de regras
netlify/lib/quality.mjs               deteção de campos sub-otimizados
netlify/lib/ai.mjs                    Claude (Messages API)
netlify/lib/gmc.mjs                   conversão Meta → GMC
netlify/lib/sheets.mjs                Google Sheets via service account (JWT, sem googleapis)
public/                               UI (HTML/CSS/JS sem build)
test/pipeline.test.mjs                teste local: npm install && npm test
```

## Notas
- O run agendado arranca à hora definida (Lisboa); se falhar, tenta na hora seguinte (até 3x por dia). Runs manuais não contam como o run do dia.
- A app guarda o estado em Netlify Blobs: snapshot do dia anterior, copy AI, edições, último feed e output.
- Os links `export?format=csv` refletem a sheet quase em tempo real; os links "Publicar na Web" podem ter alguns minutos de cache.

## PIM optimizer (Akeneo)

Separador **PIM optimizer** na app:

1. **Carregar** um export XLSX/CSV do Akeneo (tem de ter a coluna `sku`). O ficheiro é lido no browser.
2. **Diagnóstico** por produto: nome (vazio, curto, maiúsculas), nome PLP em falta, descrição longa curta para SEO, texto genérico/campanha, HTML, traduções `es_ES` em falta, completude < 100% e — com o dicionário Akeneo importado — atributos obrigatórios da família em falta.
3. **AI** (background, retoma onde parou): gera `ATT_NAME`, `ATT_PLP_NAME` e `ATT_LONG_DESCRIPTION` (SEO/GEO) em `pt_PT` e `es_ES`. O texto de campanha só se mantém em produtos sazonais (`ATT_SEASONALITY` = permanent_seasonal/Promocional ou categoria sazonal). A descrição curta não é tocada.
4. **Revisão** lado a lado: aceitar / rejeitar / editar por campo, ou aceitar em bloco.
5. **Exportar XLSX** só com `sku` + colunas aceites e alteradas — preços, EAN, códigos ERP, fornecedor e logística nunca saem (só os atributos marcados como editáveis em *Campos & AI*).

Regras do Akeneo incluídas (`netlify/lib/akeneo-dictionary.mjs`, snapshot só de leitura de homa.cloud.akeneo.com): requisitos de completude do canal `ecommerce` das 50 famílias, opções de cor/material/marca/estilo/secções/sazonalidade/aroma em PT e ES, e nomes dos atributos. Com isto o diagnóstico separa obrigatórios de **conteúdo** (resolvidos aqui) de obrigatórios de **dados** (compras/logística), a AI recebe cor/material/composição em texto, e para ES gera também `ATT_SHORT_DESCRIPTION` (máx. 40, limite do Akeneo) e `ATT_PLP_DESCRIPTION` — obrigatórios em todas as famílias. `ATT_SEASONALITY-es_ES` é copiado do PT quando a família o exige.

Ficheiros: `netlify/lib/pim.mjs`, `netlify/lib/akeneo-dictionary.mjs`, `netlify/functions/pim-api.mjs` (rotas `/pim-api/*`), `netlify/functions/pim-background.mjs`, `public/pim.js`.

### PIM — deduções, imagens e labels

- **Deduções sem AI** (só preenchem células vazias, cada valor mostra a origem): Cores ← Cor variante; Volume da caixa ← C×L×A; Composição ← Material (+100% se o texto o disser); Atividade de ar livre ← categorias de jardim/exterior; Coleção ← palavra em maiúsculas no nome; Peças ← "Conjunto de N"/"N peças"; Capacidade/Tensão/Potência ← valores no texto; Aroma ← nome do aroma no texto; LED ← "LED" no texto; Sazonalidade ES ← PT.
- **Imagens** (`pim-images-background`): quantidade a partir de `ATT_PRODUCT_IMAGE`/`ATT_AMBIANCE_IMAGES` (deteta códigos duplicados em dois formatos), qualidade a partir dos links públicos do feed (resolução, proporção, peso, links partidos). Pontuação /100 por produto.
- **Labels** (separador Labels do PIM): regras SE/ENTÃO com agendamento para `Etiqueta_homa`, `ATT_NEW` (+datas), `ATT_BEST` (+datas), `ATT_ONLINE_EXCLUSIVE`, `ATT_THEME`, `ATT_BROCHURE_COLLECTION`.
- **Re-categorização**: deteta produtos sem categoria ecommerce, só no nível superior, em categorias improváveis para a família, produtos de Natal fora de Natal e faixas de preço (`ecom_up_to_10`, `ecom_from_X_to_Y`) que não batem com o PVP. Correções seguras entram como propostas; "Propor re-categorização (AI)" sugere a categoria final certa usando apenas códigos existentes. A coluna `categories` mantém sempre os códigos ERP; as propostas são aceites à parte ("Aceitar categorias propostas"). A taxonomia é aprendida dos ficheiros carregados e pode ser completada com a árvore do Akeneo (`dictionary.categories`).

### PIM — product models (variantes)
- Aceita exports com `entity_type`, `code`, `sku`, `parent` (produtos e modelos no mesmo ficheiro). Modelos referenciados mas ausentes do ficheiro entram como modelos "virtuais" para receber edições.
- Dono de cada atributo vem das *family variants* do Akeneo (`netlify/lib/akeneo-family-variants.mjs`, 76 variantes): atributos do nível 1 vivem no sub-modelo (ou no produto, em variantes de 1 nível), do último nível no produto, os restantes no modelo raiz. Eixos (cor, tamanho, aroma…) nunca são editáveis.
- Para identificar a variante, o export deve trazer `family` (e idealmente `family_variant`). Sem isso usa consenso entre variantes e, em último caso, a herança de valores; se não houver certeza, o campo fica trancado.
- AI, deduções e labels só propõem no nível dono; os produtos mostram o campo como "herdado do modelo X" e os problemas como "corrigir no modelo X". A completude estimada dos produtos conta as alterações aceites nos modelos.
- Export: ficheiro único com `entity_type/code/sku/parent` ou "Produtos + modelos separados" (dois ficheiros: `sku` e `code`).

## Feed em XML
Além do Sheets (CSV), cada feed tem links XML públicos (Dashboard → Links XML), gerados a partir do output do último run:
`/xml/<feed>/<token>/meta.xml` e `/xml/<feed>/<token>/gmc.xml` (acrescenta `.gz` para a versão comprimida).
Formato RSS 2.0 com atributos `g:` (aceite pelo Meta e pelo GMC); `additional_image_link` sai repetido e `shipping` com sub-elementos. O token impede que o link seja adivinhado; "Gerar novos links" invalida os atuais. Cache de 15 min na CDN da Netlify.
