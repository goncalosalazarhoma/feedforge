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
| `PAGE_BUILDER_MODEL` *(opcional)* | modelo do Page Builder para gerar layouts (por omissão `claude-sonnet-4-5`) |
| `PAGE_BUILDER_COPY_MODEL` *(opcional)* | modelo para afinações só de texto no Page Builder (por omissão `claude-haiku-4-5`) |

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

### PIM — importar diretamente do Akeneo (API)
Em vez de exportar um XLSX, o separador **Ficheiros** do PIM optimizer tem **Importar diretamente do Akeneo**: filtros por famílias, categorias, SKUs, "atualizados desde", completude (abaixo de / até / a partir de / acima de / igual a / entre X e Y %, numa língua, em pelo menos uma ou em todas — por omissão "abaixo de 100% em pt_PT") e só ativos, com um máximo de produtos (até 5000). Os produtos (e os modelos-pai, para as variantes) vêm pela API REST e ficam com as mesmas colunas de um export (`ATT-locale-canal`, `-unit`, `-EUR`, `completeness_ratio-…`), por isso diagnóstico, AI e export XLSX funcionam como num ficheiro carregado. Só leitura: nada é escrito no Akeneo.

Variáveis de ambiente (Netlify → Site configuration → Environment variables), a partir de uma *Connection* do Akeneo (Connect → Connection settings):
| Variável | Valor |
|---|---|
| `AKENEO_URL` *(opcional)* | por omissão `https://homa.cloud.akeneo.com` |
| `AKENEO_CLIENT_ID` | Client ID da connection |
| `AKENEO_SECRET` | Secret da connection |
| `AKENEO_USERNAME` | utilizador da connection (ex.: `feedforge_0756`) |
| `AKENEO_PASSWORD` | password do utilizador da connection |

As credenciais nunca vão para o código nem para o browser; o token OAuth fica guardado do lado do servidor (Netlify Blobs) e é renovado automaticamente. Código: `netlify/lib/akeneo-api.mjs`, `netlify/functions/pim-akeneo-background.mjs`; teste: `node test/akeneo.test.mjs`.

## Shop the Look
Separador **Shop the Look** (menu lateral): módulos para o site novo (homastores.com, PT e ES) com produtos do feed do FeedForge, sem scraping (substitui a ferramenta antiga em Vercel).

1. **Novo Shop the Look** → separador **Módulo**: nome, mercado (PT/ES), página (Homepage/PLP/PDP), imagem principal (recomendado 1475×1080 ≈ 1,37:1), eyebrow, título, cor do Color Block, CTA na imagem (texto, link, posição X/Y %), texto do popover e produto ativo.
2. **Produtos**: pesquisa por ID, EAN ou nome (sem acentos, parcial), navegação categoria → subcategoria (do `product_type`), filtros (só em stock, em promoção, preço, cor, material e outras colunas com poucos valores). "Adicionar ao look"; na lista do look arrasta pelo ⠿ para ordenar o carrossel, liga/desliga o pin, ajusta X/Y, badges (branco, amarelo `brand`, verde `success`). Com **Mover pins** ligado, arrasta os pins diretamente na imagem (guardados em %). Produtos fora do feed ou sem stock ficam assinalados e escondidos no widget.
3. **Exportar** → **Gerar código**: valida (imagem, ≥ 2 produtos, nenhum fora do feed, pins entre 0–100%) e gera o código para um bloco HTML/Custom do Page Designer — CSS + JS do widget (uma vez por página) + `<section class="hstl" data-stl-id="…">` + JSON com os produtos já resolvidos (preço, promoção, imagem, link do feed nesse momento; o site não chama o FeedForge). Volta a gerar quando os preços mudarem. **Copiar JSON** dá a configuração resolvida.

Pré-visualização: o widget real num iframe (Desktop ou 375 px). O módulo só guarda referências (IDs, pins, badges, layout); os dados de produto vêm sempre do feed otimizado (`output` do último run de cada mercado, escolhido pela língua do feed `pt-PT`/`es-ES`).

- Widget: `public/stl/widget.css` + `public/stl/widget.js` (`window.HomaShopTheLook.mount(sectionEl, config)`, pode ser chamado de novo; eventos GA4 `stl_pin_select` e `stl_product_click` com `stl_id`, `item_id`, `item_name`, `index`). Exemplo do código exportado numa página simples: `public/stl/export-test.html`.
- API (`/api/stl/*`): `products` e `categories` (aliases da pesquisa partilhada `/api/products*`, ver Page Builder), `modules` (CRUD + `/:id/duplicate`), `render/:id?market=` e `POST render` (configuração com produtos do feed, `missing`/`oos` assinalados). Módulos em Netlify Blobs (`stl/modules/*`); o catálogo de cada mercado fica em cache (Blobs + memória, 5 min) e renova-se a cada run.
- Os módulos são editoriais: não entram no relatório de runs para o Filo.
- Código: `netlify/lib/stl.mjs`, `public/stl-editor.js`, `public/stl/`; pesquisa e picker partilhados com o Page Builder: `netlify/lib/products.mjs`, `public/product-picker.js`; teste: `node test/stl.test.mjs`.

## Page Builder (Blocos HTML)
Separador **Page Builder**: descreves um elemento em português, a IA monta-o com blocos aprovados do design system hôma (Figma "Website" → Page Designer Blocks / Sections), editas, preenches os blocos de produtos com o feed e copias o HTML para um componente **Raw HTML** do Page Designer (homastores.com, PT e ES).

**Princípio:** a IA nunca escreve HTML. Devolve um JSON com blocos de uma biblioteca fixa, validado contra um JSON Schema gerado a partir das definições dos blocos; um renderer determinístico transforma o JSON em HTML + CSS. O resultado tem sempre o aspeto hôma, é seguro (tudo escapado, sem `<script>`, só links de homastores.com) e pode voltar a ser editado e gerado.

### Como usar
1. **Teste de capacidades (uma vez):** abre `/page-builder/capability-test`, cola o snippet num componente Raw HTML em development.homastores.com, vê os pontos 1–7 e inspeciona o DOM (o `id` e os `data-*` mantêm-se?). Regista o resultado no Page Builder → “Registar resultado”. Até lá o HTML é gerado **sem JavaScript** (carrosséis só com swipe/scroll); se o JavaScript correr e os `data-*` ficarem, os carrosséis passam a ter setas.
2. **Novo elemento:** descreve o que precisas (ou usa um dos exemplos), escolhe mercado e página e carrega em **Gerar** (Claude, 20–60 s). Ex.: *“grelha de 4 imagens com link e CTA, depois um título + texto, e no fim um título e uma grelha de 8 produtos”* → `image-tiles` (4) → `text-block` → `section-heading` + `product-grid` (8). O que não existe na biblioteca (formulários, vídeo, contagem decrescente…) aparece em **Notas da IA**.
3. **Editar:** pré-visualização à esquerda (Desktop 1440 / Mobile 375; clica num bloco para o selecionar). À direita:
   - **Estrutura:** ordenar (arrastar ⠿ ou ↑↓), adicionar bloco (a seguir ao selecionado), duplicar, apagar, esconder no mobile/desktop.
   - **Bloco:** formulário gerado a partir da definição do bloco: textos, imagem (URL https + alt + pré-visualização; a IA deixa a descrição da fotografia), links (validados e convertidos em `https://www.homastores.com/pt/pt/…`), fundo (só as cores permitidas), colunas, itens. Nos blocos de produtos: **Regra** (categoria → subcategoria do feed, promoção, stock, preço, ordenação, com contagem ao vivo) ou **Escolher produtos** (o mesmo ProductPicker do Shop the Look, com lista ordenável). **Congelar em lista manual** fixa os produtos que a regra dá agora.
   - **IA:** afinar o elemento todo ou o bloco selecionado (“põe o título mais curto e troca para 3 colunas”). A proposta aparece com a lista de alterações e na pré-visualização; **Aplicar** ou **Descartar**. “Só textos” usa o Haiku (mais barato).
4. **Guardar** grava o JSON (não só o HTML) e guarda as últimas 10 versões (**Versões** → restaurar).
5. **Gerar HTML:** valida (alt em falta, links vazios ou fora de homastores.com, imagens sem https, produtos fora do feed/sem stock, `<h1>`, `<script>`), resolve os produtos no feed nesse momento e mostra o HTML (tamanho; aviso acima de 100 KB), **Copiar HTML**, **Descarregar .html** e pré-visualização a 1440 e 375 px. Os preços e o stock ficam fixos no HTML: quando algum produto do último HTML gerado muda de preço/stock no feed, a lista marca o elemento como **desatualizado** — volta a gerar e substitui no Page Designer.

Galeria de todos os blocos com dados de exemplo (QA visual, desktop e 375 px): `/page-builder/blocks`. Exemplo do HTML exportado numa página simples: `public/page-builder/export-test.html`.

### Contrato do HTML
`<div class="hpb" id="hpb-{id}" data-hpb-version="1" data-hpb-element="{id}">` com um único `<style>` em que todos os seletores começam por `#hpb-{id}` (tokens do Figma como custom properties `--hpb-*`, Gilroy herdada do site, sem `@font-face`), um breakpoint a 768 px, sem JavaScript (salvo teste de capacidades), sem iframes, formulários, handlers inline nem estilos inline. Cada bloco tem `data-hpb-block` e `data-hpb-index`; cada produto `data-item-id`, `data-item-name`, `data-item-price` (para triggers de clique no GTM). Imagens com `alt`, `width`/`height`, `loading="lazy"`, `decoding="async"`.

### Adicionar um tipo de bloco
Tudo vive em `public/page-builder/engine.mjs` (usado pelo editor, pelas functions e pelos testes):
1. **Definição + schema:** acrescenta uma entrada a `BLOCKS` com `label`, `figma`, `llm` (descrição para a IA: o que é e quando usar), `props` (helpers `F.text`, `F.long`, `F.rich`, `F.image`, `F.link`, `F.enum`, `F.int`, `F.bool`, `F.products`), `items` (repetidor, opcional), `defaults` e `sample`. O JSON Schema (`blockSchema`), a normalização, o formulário do editor, a validação e a descrição na prompt (`libraryForPrompt`) saem daqui automaticamente.
2. **Renderer:** um `case` em `renderBlockInner` (só com `esc()`, `img()`, `button()` e `productCard()`) e o CSS em `BLOCK_CSS[tipo]` (seletores com `&`, cores só dos tokens, regra mobile em `@media (max-width:767px)`). Regras que dependem de props vão para `blockCss`.
3. **Galeria:** o `sample` aparece em `/page-builder/blocks`.
4. **Testes:** `UPDATE_SNAPSHOTS=1 node test/page-builder.test.mjs` grava o snapshot do novo bloco; depois `node test/page-builder.test.mjs`.

### Técnico
- API (`/api/page-builder/*`): `generate` (cria um job e corre em `netlify/functions/page-builder-background.mjs`; a UI consulta `jobs/:id`), `hydrate` (produtos para a pré-visualização), `export` (HTML + validação + snapshot dos produtos), `elements` (CRUD, `/:id/versions`, `/:id/duplicate`), `settings` (resultado do teste de capacidades), `log`, `library`.
- Pesquisa de produtos partilhada (Shop the Look + Page Builder), sobre o feed **otimizado** de cada mercado: `GET /api/products?q=&category=&subcategory=&onSale=&inStock=&priceMin=&priceMax=&color=&material=&market=&page=` (ou `ids=`), `GET /api/products/categories?market=`, `POST /api/products/resolve` (`{ids}` ou regra → produtos com `missing`/`oos`). Badges: “Exclusivo online”/“Sustentável” quando um custom label o diz, “Novo” para produtos vistos pela primeira vez há menos de 30 dias.
- Claude com tool use (`emit_element` / `emit_block`) e o schema dos blocos; a resposta é validada (uma nova tentativa com os erros) e normalizada; categorias fora da árvore do feed são removidas com nota. Cada geração fica registada (`pb/log`: prompt, modelo, tokens, tempo). Mesmas variáveis `ANTHROPIC_API_KEY`/`ANTHROPIC_WORKSPACE_ID` do resto da app.
- Elementos, versões, jobs e definições em Netlify Blobs (`pb/*`). O Page Builder é editorial: nada é reportado ao Filo.
- Código: `netlify/lib/page-builder.mjs`, `public/page-builder/engine.mjs`, `public/page-builder.js`, `public/page-builder/{blocks,capability-test,export-test}.html`; teste: `node test/page-builder.test.mjs`.

## Feed em XML
Além do Sheets (CSV), cada feed tem links XML públicos (Dashboard → Links XML), gerados a partir do output do último run:
`/xml/<feed>/<token>/meta.xml` e `/xml/<feed>/<token>/gmc.xml` (acrescenta `.gz` para a versão comprimida).
Formato RSS 2.0 com atributos `g:` (aceite pelo Meta e pelo GMC); `additional_image_link` sai repetido e `shipping` com sub-elementos. O token impede que o link seja adivinhado; "Gerar novos links" invalida os atuais. Cache de 15 min na CDN da Netlify.
