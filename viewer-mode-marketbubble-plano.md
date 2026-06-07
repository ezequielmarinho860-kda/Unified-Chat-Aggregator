# Plano cronologico - Viewer Mode e integracao futura com MarketBubble

Este documento planeja a evolucao do Unified Chat Aggregator atual para uma
demo web que represente a visao descrita pelo MarketBubble:

- o streamer acompanha chats e viewers em um dashboard unificado;
- o espectador assiste a uma live junto do chat combinado;
- mensagens identificam plataforma e streamer/canal de origem;
- a integracao futura com o site do MarketBubble exige o minimo possivel de
  reescrita;
- OBS pode consumir overlays e controles depois, sem ser requisito para o
  Viewer Mode.

O plano considera o codigo existente em junho de 2026. Ele nao substitui
`chat-aggregator-plano.md`, que registra o plano inicial de construcao do app.

---

## 1. Estado atual comprovado pelo repositorio

O app atual e um aplicativo desktop Electron, nao uma aplicacao web hospedada.

Ja existe:

- leitura unificada de Twitch, Kick e X;
- envio de mensagens para Twitch, Kick e X;
- badge de plataforma em cada mensagem;
- dashboard local com chat combinado;
- contagens individuais e total combinado de viewers;
- configuracao persistida localmente;
- janelas separadas de setup e dashboard;
- modelo canonico de mensagem e camada `chat-hub`;
- testes unitarios para conectores, mensagens, configuracao e viewers.

Ainda nao existe:

- servidor HTTP ou WebSocket para consumidores externos;
- pagina web publica ou Viewer Mode;
- player de live no dashboard;
- conceito consistente de stream, transmissao ou streamer de origem no modelo
  canonico;
- suporte a mais de um canal por plataforma;
- historico de chat persistente;
- autenticacao para espectadores;
- conector de chat nativo do MarketBubble;
- overlay ou dock para OBS.

## 2. Inconsistencias e limites que afetam o plano

### 2.1 O renderer atual nao e diretamente migravel para um site

`src/renderer.js` depende da API `window.chatAggregator`, exposta pelo preload
do Electron. Copiar o dashboard atual para o MarketBubble manteria o
acoplamento ao Electron e exigiria uma reescrita posterior.

Antes de criar uma pagina web, os dados consumidos por ela precisam ter um
contrato independente de IPC.

### 2.2 Plataforma nao identifica qual streamer originou a mensagem

O modelo atual possui `platform`, mas isso nao basta quando duas pessoas
transmitem na mesma plataforma. A mensagem precisa carregar uma identidade de
origem, por exemplo:

```js
{
  platform: 'x',
  source: {
    streamId: 'host-x-live',
    broadcasterId: 'host',
    broadcasterName: 'Host',
    channelLabel: '@host'
  }
}
```

Essa evolucao deve ser retrocompativel primeiro. Transformar imediatamente toda
a configuracao em listas de canais aumentaria muito o risco e o tamanho da
mudanca.

### 2.3 Player web e OBS resolvem problemas diferentes

- Player web oficial entrega o video da plataforma diretamente ao espectador.
- OBS produz e envia a transmissao do lado do streamer.
- OBS nao deve ser usado como servidor de video para o Viewer Mode.
- OBS deve entrar depois como consumidor de overlay ou dashboard.

### 2.4 Embeds nao possuem a mesma confiabilidade em todas as plataformas

Twitch possui embed oficial bem documentado. Kick e X devem ser tratados como
adaptadores opcionais, com fallback para abrir a live na plataforma quando o
embed nao estiver disponivel ou deixar de funcionar.

---

## 3. Arquitetura alvo

```text
Twitch / Kick / X
        |
        v
Electron Collector
connectors + chat-hub + viewer-monitor
        |
        v
Realtime Gateway
contrato HTTP/WebSocket independente do Electron
        |
        +-------------------+
        |                   |
        v                   v
Viewer Mode web       Futuro MarketBubble
player + chat         integra o mesmo contrato
        |
        v
OBS Browser Source / dock opcional
```

### Responsabilidades

**Electron Collector**

- autenticar contas;
- capturar e normalizar chats;
- consultar viewers;
- enviar comandos e mensagens;
- publicar eventos normalizados para o gateway.

**Realtime Gateway**

- expor estado inicial por HTTP;
- transmitir mensagens, statuses e viewers por WebSocket;
- nao conhecer detalhes internos de IPC ou DOM do Electron;
- permitir troca futura por um backend operado pelo MarketBubble.

**Viewer Mode**

- rodar em browser comum;
- mostrar player, chat combinado e viewers;
- consumir somente o contrato do gateway;
- nao acessar tokens ou funcoes administrativas.

---

## 4. Regras de execucao

- Cada bloco deve resultar em um comportamento verificavel.
- Cada bloco deve buscar ficar em ate aproximadamente 300 linhas alteradas.
- Mudancas maiores devem ser divididas novamente antes da implementacao.
- Nao iniciar o bloco seguinte com lint ou testes quebrados.
- Nao misturar refactor estrutural, feature visivel e integracao OBS no mesmo
  commit.
- Revisar `git diff` antes de sugerir cada commit.
- Separar commits por escopo.
- Rodar `npm run lint` em todo bloco que altere arquivos relevantes.
- Rodar `node --test ...` nos testes afetados.
- Rodar `npm test` ao concluir cada fase.
- O projeto nao possui atualmente um pacote `frontend`; portanto
  `npm --prefix frontend run build` so passa a ser obrigatorio caso um frontend
  separado seja criado.

---

# Fase A - Preparar contratos sem mudar o comportamento atual

## Bloco A1 - Registrar contratos publicos da demo

**Objetivo:** decidir o formato dos dados antes de criar transporte ou UI web.

**Status:** concluido em `docs/viewer-realtime-protocol-v1.md`.

**Mudancas previstas:**

- documentar envelopes de evento para mensagem, status e viewers;
- documentar snapshot inicial;
- definir versao do protocolo, inicialmente `v1`;
- definir quais campos sao publicos e quais nunca podem sair do Electron;
- definir comportamento para campos opcionais e plataformas indisponiveis.

**Arquivos esperados:**

- novo documento de protocolo em `docs/` ou equivalente.

**Nao inclui:**

- servidor;
- alteracao do modelo atual;
- pagina Viewer Mode.

**Pronto quando:**

- todos os eventos necessarios para renderizar a demo estao documentados;
- nenhum token, client secret ou dado de sessao faz parte do contrato.

**Validacao:**

- revisao manual do documento;
- `npm run lint` somente se arquivos de codigo forem tocados.

**Commit sugerido:** `docs: define viewer mode realtime protocol`

## Bloco A2 - Adicionar identidade opcional de origem a mensagens

**Objetivo:** distinguir plataforma de streamer/canal sem quebrar conectores.

**Status:** concluido com `source` opcional no modelo canonico e preenchimento
automatico pelo `chat-hub`.

**Mudancas previstas:**

- estender o modelo canonico com `source` opcional;
- normalizar e validar campos de origem;
- preencher origem usando a configuracao atual de um canal por plataforma;
- manter compatibilidade com mensagens sem `source`;
- adicionar testes focados no modelo e no hub.

**Nao inclui:**

- multiplos canais por plataforma;
- alteracao visual ampla;
- gateway.

**Pronto quando:**

- toda nova mensagem publicada pelo app possui origem quando ela pode ser
  determinada;
- conectores e testes existentes continuam funcionando.

**Validacao:**

- `npm run lint`;
- `node --test test/chat-message.test.js test/chat-hub.test.js`;
- testes dos conectores alterados.

**Commit sugerido:** `feat: attach source identity to chat messages`

## Bloco A3 - Mostrar origem do streamer no dashboard atual

**Objetivo:** provar visualmente a diferenca entre plataforma e canal.

**Status:** concluido com label de origem no metadata de cada mensagem.

**Mudancas previstas:**

- renderizar um label curto de canal/streamer junto ao badge da plataforma;
- manter layout legivel quando `source` estiver ausente;
- adicionar apenas o CSS necessario.

**Nao inclui:**

- redesign completo;
- Viewer Mode web;
- suporte a multiplos canais.

**Pronto quando:**

- uma mensagem identifica claramente plataforma e canal de origem.

**Validacao:**

- `npm run lint`;
- teste manual do dashboard;
- `npm test`.

**Commit sugerido:** `feat: show broadcaster source in dashboard messages`

---

# Fase B - Criar uma fronteira independente do Electron

## Bloco B1 - Criar serializadores publicos

**Objetivo:** impedir que objetos internos e dados sensiveis vazem pelo gateway.

**Status:** concluido com serializadores por allowlist para source, mensagens,
status, viewers e snapshot.

**Mudancas previstas:**

- criar funcoes puras para serializar mensagem, status, viewers e snapshot;
- permitir somente campos explicitamente aprovados;
- testar remocao de tokens, secrets e detalhes internos.

**Nao inclui:**

- rede;
- WebSocket;
- pagina web.

**Pronto quando:**

- qualquer consumidor externo pode receber objetos publicos estaveis;
- testes provam que credenciais nao aparecem nos payloads.

**Validacao:**

- `npm run lint`;
- `node --test` nos novos testes e testes de config relacionados.

**Commit sugerido:** `feat: add public realtime payload serializers`

## Bloco B2 - Implementar gateway HTTP local somente leitura

**Objetivo:** expor um snapshot inicial para uma pagina web local.

**Mudancas previstas:**

- servidor HTTP local vinculado somente a `127.0.0.1`;
- endpoint versionado, por exemplo `GET /api/v1/snapshot`;
- lifecycle ligado ao Electron;
- porta configuravel para desenvolvimento;
- testes do handler sem depender de abrir uma janela Electron.

**Nao inclui:**

- WebSocket;
- acesso remoto;
- escrita de chat;
- autenticacao web.

**Pronto quando:**

- um browser local consegue obter o snapshot publico;
- o servidor encerra junto com o app;
- nenhuma credencial e exposta.

**Validacao:**

- `npm run lint`;
- testes focados do gateway;
- `npm test`.

**Commit sugerido:** `feat: expose local read-only snapshot endpoint`

## Bloco B3 - Implementar eventos em tempo real

**Objetivo:** entregar mensagens e atualizacoes sem polling constante.

**Mudancas previstas:**

- canal WebSocket local versionado;
- eventos para mensagem, status e viewers;
- snapshot inicial ao conectar ou estrategia documentada de bootstrap;
- heartbeat e limpeza de clientes desconectados;
- testes de conexao, publicacao e desconexao.

**Nao inclui:**

- comandos administrativos;
- envio de chat pelo browser;
- hospedagem publica.

**Pronto quando:**

- um cliente web local recebe mensagens e viewers em tempo real;
- reconexao nao duplica listeners nem mensagens.

**Validacao:**

- `npm run lint`;
- testes focados do gateway;
- `npm test`.

**Commit sugerido:** `feat: stream public updates over local websocket`

---

# Fase C - Construir a primeira demo do Viewer Mode

## Bloco C1 - Criar shell web independente

**Objetivo:** provar que a UI roda em browser comum sem APIs do Electron.

**Mudancas previstas:**

- pagina Viewer Mode simples servida pelo gateway local;
- cliente HTTP para snapshot;
- cliente WebSocket para atualizacoes;
- estados de carregamento, desconectado e reconectando;
- layout inicial reservado para player, viewers e chat.

**Nao inclui:**

- player funcional;
- envio de mensagens;
- copiar o `renderer.js` atual.

**Pronto quando:**

- a pagina abre no browser e mostra dados em tempo real;
- nao existe referencia a `window.chatAggregator`.

**Validacao:**

- `npm run lint`;
- build do frontend, caso seja criado um pacote separado;
- teste manual no browser;
- `npm test`.

**Commit sugerido:** `feat: add browser-native viewer mode shell`

## Bloco C2 - Renderizar chat combinado somente leitura

**Objetivo:** entregar o principal valor para o espectador.

**Mudancas previstas:**

- lista de mensagens em tempo real;
- label de plataforma e streamer/canal;
- autor, texto, timestamp, badges e emotes suportados pelo contrato;
- limite de mensagens em memoria;
- autoscroll e estado vazio.

**Nao inclui:**

- envio de chat;
- moderacao;
- historico persistente.

**Pronto quando:**

- um espectador entende de qual plataforma e streamer veio cada mensagem;
- a pagina permanece estavel durante uma demo longa.

**Validacao:**

- `npm run lint`;
- build do frontend, se aplicavel;
- teste manual com as tres plataformas;
- testes unitarios dos renderizadores puros, se adotados.

**Commit sugerido:** `feat: render combined chat in viewer mode`

## Bloco C3 - Mostrar viewers individuais e total combinado

**Objetivo:** completar a parte quantitativa da visao do post.

**Mudancas previstas:**

- cards de viewers por origem disponivel;
- total combinado;
- estados indisponivel, offline e desabilitado;
- indicador de ultima atualizacao.

**Nao inclui:**

- analytics historico;
- graficos;
- alteracao da coleta existente.

**Pronto quando:**

- Viewer Mode reflete o snapshot de viewers do app em tempo real.

**Validacao:**

- `npm run lint`;
- build do frontend, se aplicavel;
- testes do calculo/formatacao afetados;
- teste manual.

**Commit sugerido:** `feat: show combined viewers in viewer mode`

## Bloco C4 - Adicionar player Twitch configuravel

**Objetivo:** demonstrar live + chat combinado para espectadores.

**Mudancas previstas:**

- contrato publico de player/configuracao;
- adaptador Twitch usando embed oficial;
- canal configuravel;
- fallback de erro/offline;
- documentacao do requisito de dominio `parent` e HTTPS em producao.

**Nao inclui:**

- reproduzir video do OBS;
- embeds nao comprovados de Kick ou X;
- varios players simultaneos.

**Pronto quando:**

- Viewer Mode reproduz uma live Twitch e mostra o chat combinado ao lado.

**Validacao:**

- `npm run lint`;
- build do frontend, se aplicavel;
- teste manual em browser comum;
- `npm test`.

**Commit sugerido:** `feat: embed configurable Twitch player in viewer mode`

## Bloco C5 - Criar adaptadores de player e fallback externo

**Objetivo:** evitar acoplamento da pagina a Twitch.

**Mudancas previstas:**

- interface pequena de adaptador de player;
- adaptador Twitch movido para a interface;
- fallback generico com link para abrir a plataforma;
- seletor de live principal quando houver mais de uma opcao configurada.

**Nao inclui:**

- prometer embed funcional de Kick ou X;
- suporte completo a multiplos chats por plataforma.

**Pronto quando:**

- adicionar um futuro provider nao exige alterar o layout principal;
- providers sem embed continuam apresentaveis na demo.

**Validacao:**

- `npm run lint`;
- build do frontend, se aplicavel;
- testes dos adaptadores;
- teste manual.

**Commit sugerido:** `refactor: add viewer player adapter boundary`

---

# Fase D - Preparar migracao para o MarketBubble

## Bloco D1 - Extrair configuracao publica da demo

**Objetivo:** permitir que outra aplicacao hospede o Viewer Mode sem conhecer o
formato interno do Electron.

**Mudancas previstas:**

- manifesto publico com titulo, streams e providers;
- validacao do manifesto;
- configuracao separada de credenciais e config interna;
- exemplos de manifesto para demo e futura integracao.

**Pronto quando:**

- trocar canal, titulo ou provider nao exige editar o codigo do Viewer Mode.

**Validacao:**

- `npm run lint`;
- testes de validacao do manifesto;
- build do frontend, se aplicavel.

**Commit sugerido:** `feat: define public viewer mode manifest`

## Bloco D2 - Criar cliente de transporte substituivel

**Objetivo:** permitir que o MarketBubble troque o gateway local por seu backend.

**Mudancas previstas:**

- interface de cliente para snapshot e eventos;
- implementacao local HTTP/WebSocket;
- mock para demo e testes;
- documentacao de como implementar outro backend.

**Pronto quando:**

- a UI nao conhece URLs locais nem detalhes do Electron;
- um mock consegue alimentar toda a pagina.

**Validacao:**

- `npm run lint`;
- testes do cliente;
- build do frontend, se aplicavel;
- `npm test`.

**Commit sugerido:** `refactor: isolate viewer mode transport client`

## Bloco D3 - Documentar pacote de integracao MarketBubble

**Objetivo:** transformar a demo em uma proposta tecnicamente migravel.

**Mudancas previstas:**

- guia de integracao;
- protocolo e exemplos de payload;
- requisitos de seguranca e autenticacao;
- estrategia para chat nativo do MarketBubble como novo connector/provider;
- limites conhecidos de Twitch, Kick e X;
- diagrama de producao sugerido.

**Nao inclui:**

- implementar infraestrutura do MarketBubble;
- assumir acesso ao dominio ou backend deles.

**Pronto quando:**

- uma equipe externa entende o que pode reutilizar e o que precisa operar.

**Validacao:**

- revisao manual tecnica;
- conferencia dos exemplos contra o contrato implementado.

**Commit sugerido:** `docs: add MarketBubble integration guide`

---

# Fase E - Multiplos streamers e canais

Esta fase deve comecar somente depois que a demo de um player com chat combinado
estiver estavel. Ela muda configuracao, lifecycle de connectors, identidade e
UI; portanto, nao deve ser antecipada apenas para mostrar dois labels falsos.

## Bloco E1 - Projetar configuracao multi-source

**Objetivo:** definir como representar mais de um canal da mesma plataforma.

**Mudancas previstas:**

- ADR/documento comparando migracao de objeto unico para lista de sources;
- IDs estaveis por source;
- estrategia de migracao da config salva atual;
- regras para autenticacao compartilhada ou separada.

**Pronto quando:**

- formato e migracao estao decididos antes de alterar runtime.

**Commit sugerido:** `docs: design multi-source connector configuration`

## Bloco E2 - Migrar config com retrocompatibilidade

**Objetivo:** aceitar o novo formato sem perder configuracoes existentes.

**Mudancas previstas:**

- normalizacao e migracao;
- snapshot publico atualizado;
- testes amplos da config;
- nenhuma alteracao de connector ainda.

**Validacao:**

- `npm run lint`;
- `node --test test/app-config.test.js test/app-config-store.test.js`;
- `npm test`.

**Commit sugerido:** `feat: migrate config to multi-source format`

## Bloco E3 - Tornar o hub capaz de distinguir instancias

**Objetivo:** permitir duas origens da mesma plataforma.

**Mudancas previstas:**

- identificar connector por `sourceId`, nao somente `platform`;
- manter roteamento e status por instancia;
- adaptar testes do hub;
- preservar envio explicito para uma origem.

**Ponto de atencao:** o `chat-hub` atual rejeita plataformas duplicadas. Esta e
uma mudanca estrutural central e deve permanecer isolada neste bloco.

**Validacao:**

- `npm run lint`;
- `node --test test/chat-hub.test.js test/connector-contract.test.js`;
- `npm test`.

**Commit sugerido:** `refactor: identify connectors by source instance`

## Bloco E4 - Habilitar multiplas fontes progressivamente

**Objetivo:** adicionar suporte real sem alterar todos os connectors de uma vez.

**Ordem sugerida:**

1. Twitch;
2. Kick;
3. X, somente depois de avaliar custo de varias BrowserWindows.

Cada plataforma deve ser um bloco e um commit separado, com testes proprios.

**Pronto quando:**

- duas fontes da plataforma escolhida aparecem separadamente;
- viewers, status e mensagens preservam `sourceId`.

---

# Fase F - Integracoes opcionais com OBS

OBS entra depois do Viewer Mode porque consome uma pagina web pronta. Ele nao
deve bloquear a demo principal.

## Bloco F1 - Overlay publico somente leitura

**Objetivo:** permitir adicionar o chat combinado como Browser Source no OBS.

**Mudancas previstas:**

- rota/view de overlay transparente;
- layout compacto;
- parametros visuais seguros;
- sem controles administrativos ou tokens.

**Pronto quando:**

- OBS Browser Source consegue carregar o overlay pela URL local.

**Validacao:**

- `npm run lint`;
- build do frontend, se aplicavel;
- teste manual no OBS;
- teste de regressao do Viewer Mode.

**Commit sugerido:** `feat: add OBS browser-source chat overlay`

## Bloco F2 - Dashboard como dock do OBS

**Objetivo:** permitir acompanhar o dashboard dentro do OBS.

**Mudancas previstas:**

- layout responsivo estreito;
- instrucoes para Custom Browser Dock;
- verificacao de reconexao e foco.

**Nao inclui:**

- controle de cenas;
- exposicao de credenciais.

**Commit sugerido:** `feat: add OBS dock-friendly dashboard mode`

## Bloco F3 - Controle opcional via obs-websocket

**Objetivo:** automatizar cenas ou fontes somente se houver um caso de demo
claro.

Possibilidades:

- mostrar/ocultar overlay;
- reagir ao inicio/fim da live;
- destacar uma mensagem selecionada;
- trocar uma fonte de player/overlay.

**Ponto de atencao:** obs-websocket deve usar autenticacao e permanecer local.
Nao expor controle do OBS ao Viewer Mode publico.

---

# Fase G - Producao e chat nativo futuro

Estes itens nao sao necessarios para a primeira demo, mas devem estar claros
para nao vender a demo local como produto pronto para producao.

## Bloco G1 - Backend hospedado de referencia

- autenticacao Collector -> backend;
- autorizacao Viewer -> canais permitidos;
- TLS;
- rate limiting;
- observabilidade;
- reconexao e escalabilidade WebSocket;
- politica de retencao.

## Bloco G2 - Chat nativo MarketBubble

- definir API e identidade de usuario MarketBubble;
- implementar como nova origem de mensagens;
- normalizar para o mesmo contrato;
- definir moderacao, bloqueio, exclusao e rate limits;
- definir se mensagens nativas sao apenas locais ou replicadas para plataformas.

## Bloco G3 - Historico e replay

- persistencia opcional;
- paginacao;
- politica de privacidade e retencao;
- exclusao e moderacao;
- sincronizacao aproximada com player/VOD, se necessaria.

---

## 5. Ordem recomendada para a competicao

Ordem minima para uma demo convincente e migravel:

1. A1 - contrato publico;
2. A2 - identidade de origem;
3. A3 - label visual de streamer/canal;
4. B1 - serializadores publicos;
5. B2 - snapshot HTTP local;
6. B3 - WebSocket local;
7. C1 - shell web;
8. C2 - chat combinado;
9. C3 - viewers;
10. C4 - player Twitch;
11. D1 - manifesto publico;
12. D2 - transporte substituivel;
13. D3 - guia MarketBubble.

Depois da demo principal:

14. C5 - adaptadores/fallbacks de player;
15. F1 - overlay OBS;
16. F2 - dock OBS;
17. E1 em diante - multiplos streamers reais;
18. F3 - obs-websocket, somente com caso de uso claro;
19. G1 em diante - producao e chat nativo.

---

## 6. Criterio de sucesso da demo

A demo esta pronta quando for possivel mostrar, sem editar codigo durante a
apresentacao:

1. o Collector Electron conectado a Twitch, Kick e X;
2. mensagens chegando com plataforma e streamer/canal de origem;
3. Viewer Mode aberto em browser comum;
4. uma live Twitch incorporada;
5. chat combinado atualizando em tempo real;
6. viewers individuais e total combinado;
7. queda/reconexao apresentada sem recarregar toda a aplicacao;
8. manifesto ou mock demonstrando como o MarketBubble substituiria o backend;
9. guia curto explicando a migracao para o site futuro.

## 7. Itens explicitamente fora da primeira demo

- transmitir video diretamente do OBS aos espectadores;
- infraestrutura publica de video;
- chat nativo MarketBubble funcional sem acesso aos sistemas deles;
- autenticacao completa de espectadores;
- moderacao web completa;
- historico persistente;
- multiplos embeds simultaneos com audio;
- prometer embeds estaveis de Kick e X;
- multiplos canais por plataforma antes da fronteira web estar estavel.

---

## Pontos importantes

- A maior protecao contra retrabalho e manter o Viewer Mode independente de
  `window.chatAggregator` e do IPC Electron.
- O gateway local e adequado para demo, mas nao deve ser exposto diretamente a
  internet.
- Tokens e secrets nunca devem fazer parte do snapshot ou dos eventos publicos.
- `platform` e `sourceId` sao conceitos diferentes; ambos precisam existir para
  multiplos streamers.
- Multiplos canais por plataforma exigem refactor central do `chat-hub`, pois
  hoje ele rejeita plataformas duplicadas.
- O X usa captura DOM e cada origem adicional pode exigir outra BrowserWindow,
  aumentando custo e fragilidade.
- Twitch deve ser o primeiro player da demo porque possui embed oficial. Kick e
  X precisam de fallback ate serem tecnicamente comprovados.
- OBS agrega valor como overlay e dock depois que a pagina web existe; ele nao
  simplifica a entrega de video ao espectador.
- Qualquer backend hospedado muda o perfil de seguranca, privacidade e operacao
  do projeto e deve ser tratado como fase propria.
