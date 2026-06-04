# Plano de build — Agregador de chat multi-plataforma

App desktop que consolida o chat ao vivo de várias plataformas num único dashboard, com leitura unificada e envio (isolado ou em broadcast). Projeto de competição — o entregável é um **vídeo demonstrando**.

---

## Visão geral

- **O que é:** um app desktop (Electron) que lê o chat ao vivo de Twitch, Kick e X num só lugar, e permite responder a uma plataforma por vez ou a todas de uma vez.
- **Pra quem:** o próprio streamer, rodando no PC dele durante a transmissão.
- **Entregável:** vídeo de demo (não um app que os juízes instalam). Isso libera o caminho de app desktop sem atrito de instalação.

## Escopo

- **Obrigatório (pedido no anúncio):** X, Kick, Twitch. Esses têm que estar impecáveis.
- **Stretch (só se sobrar tempo):** YouTube — entra como *prova de extensibilidade*, não como feature central. É um conector de rede igual a Twitch/Kick, então custa pouco se o núcleo já estiver pronto.
- **Fora de escopo (mas citado):** TikTok, Instagram etc. Não prometer que são fáceis (não são). A narrativa é arquitetural: "cada plataforma é um conector plugável; o padrão acomoda novas plataformas."

## Arquitetura (híbrida)

Três das quatro plataformas entram por **conexão de rede pura** (leves). Só o X precisa de um webview.

- **Twitch** — WebSocket oficial (IRC anônimo pra leitura no MVP, EventSub `channel.chat.message` na versão boa). Grátis, leve, read + write.
- **Kick** — WebSocket do Pusher (não-oficial) pra leitura: conecta pelo username, sem auth. A API oficial é webhook-only, inviável pra desktop sem servidor público — por isso não usamos ela pra leitura. Write usa a API oficial de envio (OAuth).
- **X** — `BrowserWindow` escondida (`show: false`) carregando a live, com preload raspando o DOM. Leitura sólida; envio incerto (best-effort via composer). Referência pronta no SSN.
- **YouTube (stretch)** — API oficial (`liveChatMessages.streamList` pra ler, `.insert` pra enviar), OAuth. Quota é irrelevante pra um único stream próprio.

Custo de recursos: **1 webview (X) + 3 sockets**, não 4 webviews. App leve de verdade.

### Forma do sistema

`webviews/sockets (captura) → IPC → processo principal (Node, hub + orquestração) → renderer (dashboard UI)`. As setas são de mão dupla: o mesmo canal sobe o chat capturado e desce o teu envio.

**Abstração central:** cada plataforma é um *connector* que implementa a mesma interface (`connect()`, emite mensagens no modelo canônico, `send(text)`). É isso que torna o sistema extensível e a demo convincente.

## Stack

- **Electron** + **Electron Forge** (scaffold que já empacota o instalável).
- **Main process:** Node — orquestra connectors, hub de IPC.
- **Renderer:** web tech (HTML/CSS/JS, ou Vite + framework leve). É a UI limpa.
- **Referência:** repositório do Social Stream Ninja (`steveseguin/social_stream`), já clonado — gabarito do webview + injeção e do parser do X (`sources/x.js`).

## Princípios de execução

1. **Constrói a espinha com um mock primeiro** — o pipe (connector falso → IPC → feed) tem que funcionar antes de qualquer plataforma real.
2. **Uma plataforma ponta a ponta antes da próxima** — não faz as quatro em paralelo. A primeira vira template; as outras são repetição.
3. **Núcleo antes do stretch** — os três pedidos sólidos + UX polida antes de tocar no YouTube.
4. **Empacota cedo** — o `make`/package funcionando desde o Bloco 0, porque o entregável é vídeo e build quebrado na última hora mata o projeto.

---

# Os blocos

Cada bloco é pequeno, independente e tem um critério de "pronto". Faz um, valida, passa pro próximo.

## Bloco 0 — Esqueleto e empacotamento

**Objetivo:** ter um app Electron que abre, mostra um "hello dashboard", e gera instalável.

**O que construir:** `npm init electron-app@latest`. Janela principal abrindo o renderer. Confirmar que `make`/`package` rodam. Definir a interface do connector (assinatura, sem implementação). Criar um `CLAUDE.md` como memória do projeto.

**Pronto quando:** o app abre numa janela isolada (sem cara de browser) e você consegue gerar o pacote.

## Bloco 1 — Modelo de dados + backbone de IPC

**Objetivo:** o pipe inteiro funcionando com dados falsos.

**O que construir:** o modelo canônico de mensagem (`{ id, platform, author, text, timestamp, avatarUrl, raw }`). Canal IPC main↔renderer. Um connector mock que emite mensagens fake a cada X segundos. O renderer recebe e mostra no feed.

**Pronto quando:** mensagens falsas aparecem no dashboard em tempo real, vindas pelo IPC.

## Bloco 2 — Connector Twitch (leitura)

**Objetivo:** primeira plataforma real ponta a ponta.

**O que construir:** WebSocket pro Twitch (IRC anônimo `justinfan` pra ler sem token no MVP). Parse das mensagens pro modelo canônico. Pipe pelo IPC. Aparece no feed com badge do Twitch.

**Pronto quando:** o chat real de um canal do Twitch aparece ao vivo no dashboard.

## Bloco 3 — Connector Kick (leitura)

**Objetivo:** segunda plataforma; feed com duas fontes misturadas.

**O que construir:** WebSocket do Pusher, conectando pelo username do canal (resolve o chatroom id automaticamente, sem auth). Parse pro modelo canônico. Badge do Kick no feed.

**Pronto quando:** Twitch e Kick aparecem juntos, mesclados no mesmo feed.

**Nota:** caminho não-oficial (Pusher). Funciona bem, mas é o segundo ponto de fragilidade depois do X.

## Bloco 4 — Connector X (leitura) — o diferencial

**Objetivo:** a plataforma difícil, que ninguém mais vai ter.

**O que construir:** `BrowserWindow` escondida carregando a live do X. Preload raspando os âncoras estáveis: `[data-testid="chatContainer"]` e `[data-testid^="UserAvatar-Container-"]`. Detectar fim da live via texto `"This broadcast has ended"`. `postMessage`/IPC pro main. Badge do X no feed.

**Pronto quando:** o chat do X aparece no feed junto com os outros dois.

**Nota:** consultar `sources/x.js` do SSN clonado pra lógica de seletor e lista virtualizada. Ancorar SÓ em `data-testid`, nunca em classe CSS.

## Bloco 5 — Polimento da UX de leitura

**Objetivo:** "limpo pro user end" — é aqui que se ganha esse ponto.

**O que construir:** badges/cores por fonte, autoscroll, avatar + username + timestamp, e opcionalmente busca/filtro no feed. A janela do dashboard com layout final.

**Pronto quando:** alguém olha o feed das três plataformas e entende tudo num relance, sem explicação.

## Bloco 6 — UX de conexão / onboarding

**Objetivo:** o usuário conecta cada plataforma sem setup técnico.

**O que construir:** tela de configuração. Twitch e Kick por nome de canal. X por login único numa janela visível (depois esconde). Persistir a config.

**Pronto quando:** um usuário não-técnico consegue conectar as três sozinho.

## Bloco 7 — Envio (write) isolado

**Objetivo:** responder a uma plataforma por vez.

**O que construir:** caixa de composição + seletor de destino. Twitch send (API, scope `user:write:chat`, OAuth). Kick send (API oficial de envio, OAuth). X send (injetar no composer — best-effort; se não rolar, X fica read-only e tá tudo bem).

**Pronto quando:** você digita, escolhe uma plataforma, e a mensagem aparece no chat dela.

## Bloco 8 — Broadcast + prevenção de eco

**Objetivo:** mandar pra todas de uma vez, sem loop infinito.

**O que construir:** fan-out pra todas as plataformas conectadas, respeitando o caminho de cada uma e o rate limit individual. Guard de "no reflections": marcar mensagens enviadas por você pra que, quando voltarem como recebidas, não sejam re-enviadas.

**Pronto quando:** uma mensagem em broadcast aparece nas três e NÃO entra em loop.

**Nota:** a prevenção de eco tem que estar no design, não como patch depois.

## Bloco 9 (stretch) — Connector YouTube

**Objetivo:** prova de extensibilidade. Só se o núcleo estiver sólido.

**O que construir:** connector novo na mesma interface. OAuth + `liveChatMessages.streamList` (ler) + `.insert` (enviar).

**Pronto quando:** YouTube entra no feed e no envio usando o mesmo padrão dos outros — demonstrando que o sistema generaliza.

## Bloco 10 — Empacotamento final + vídeo

**Objetivo:** o entregável.

**O que construir:** build limpo, `make` final. Roteiro do vídeo (abaixo). Gravar.

**Pronto quando:** o vídeo está gravado e mostra o produto funcionando.

---

# Referências técnicas (pra não re-derivar)

- **SSN clonado:** `steveseguin/social_stream`. Parser do X em `sources/x.js`. Padrão de webview escondido + preload no app standalone (Electron).
- **Twitch leitura MVP:** IRC anônimo, login `justinfan12345`, sem token. Versão boa: EventSub WebSocket, subscription `channel.chat.message`. Write: Send Chat Message API + scope `user:write:chat`.
- **Kick leitura:** WebSocket Pusher, conectar pelo username → resolve chatroom id → eventos de ChatMessage, sem auth pra ler. Write: API oficial de envio + OAuth 2.1 (PKCE).
- **X:** âncoras `data-testid="chatContainer"` e `data-testid^="UserAvatar-Container-"`; fim de live = texto `"This broadcast has ended"`. NÃO usar classes CSS hasheadas.
- **YouTube:** `liveChatMessages.streamList` (leitura de baixa latência, recomendado sobre polling), `.insert` (envio). OAuth. Quota de 10k/dia sobra pra um stream próprio.

# Riscos e armadilhas conhecidas

- **Kick (Pusher) e X (DOM) são não-oficiais** → podem quebrar quando as plataformas mudam. Mitigar: ancorar em seletores estáveis (no X, `data-testid`) e ter um detector que alerta quando a captura fica silenciosa numa live ativa.
- **X write é incerto** → tratar como read-only se a injeção no composer não funcionar de forma confiável. Não bloquear o projeto por causa disso.
- **Loop de eco no broadcast** → resolver no design (Bloco 8), não depois.
- **Cadência de quebra do X** → historicamente baixa em período estável (algumas vezes por ano). Estamos num período estável.

# Roteiro do vídeo (rascunho)

1. Abrir o app — janela limpa, isolada.
2. Mostrar as três plataformas (X, Kick, Twitch) com chat ao vivo mesclado no feed.
3. Enviar pra uma plataforma isolada.
4. Enviar em broadcast pras três.
5. Fechar com a narrativa de engenharia: "API oficial onde existe, captura de navegador só no X porque não tem API viável — e a arquitetura de conectores recebe qualquer plataforma nova" (mostrar YouTube aqui se o Bloco 9 estiver pronto).
