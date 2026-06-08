# MarketBubble Integration Guide

Este guia descreve como reaproveitar a demo atual do Viewer Mode em uma futura
integracao com o MarketBubble sem acoplar o site ao Electron.

O estado implementado hoje e:

- Collector Electron local para Twitch, Kick e X;
- gateway local somente leitura para demo;
- protocolo publico v1 de snapshot e eventos;
- Viewer Mode browser-native servido em `/viewer`;
- overlay local somente leitura servido em `/overlay`;
- player Twitch embutido quando o manifesto publico fornece `player.provider`;
- fallback externo para plataformas sem embed aprovado;
- transporte substituivel em `src/viewer/viewer-transport.js`.

O que ainda nao esta implementado:

- backend hospedado do MarketBubble;
- autenticacao de espectadores;
- chat nativo MarketBubble;
- historico persistente;
- multiplas sources reais por plataforma;
- moderacao web.

## Arquitetura Recomendada

```text
Twitch / Kick / X
        |
        v
Collector Electron
connectors + chat-hub + viewer-monitor
        |
        v
MarketBubble Backend
auth, fanout, persistence opcional, observability
        |
        v
Viewer Mode hospedado
player + chat combinado + viewers
```

Para a demo local, o backend MarketBubble acima e substituido pelo gateway local
do Collector:

```text
Collector Electron -> http://127.0.0.1:47831 -> Viewer Mode local
```

Essa diferenca deve ficar limitada ao cliente de transporte. A UI principal do
Viewer Mode nao deve voltar a conhecer URLs locais, Electron IPC ou
`window.chatAggregator`.

## Contratos Reutilizaveis

Os artefatos que podem ser reutilizados por uma implementacao hospedada sao:

| Artefato | Uso |
| --- | --- |
| `docs/viewer-realtime-protocol-v1.md` | Contrato de snapshot, eventos, manifesto, mensagens, statuses e viewers. |
| `docs/viewer-transport-client.md` | Fronteira de transporte esperada pela UI do Viewer Mode. |
| `docs/examples/viewer-manifest-demo.json` | Manifesto local com Twitch, Kick e X. |
| `docs/examples/viewer-manifest-marketbubble.json` | Exemplo de manifesto com source MarketBubble e Twitch. |
| `src/viewer/viewer-mode.js` | UI principal browser-native. |
| `src/viewer/overlay.js` | Overlay transparente de chat para OBS Browser Source. |
| `src/viewer/viewer-transport.js` | Cliente local, mock e ponto de injecao para backend hospedado. |

O backend hospedado deve produzir os mesmos payloads publicos definidos no
protocolo v1. Ele pode usar outras rotas, dominios, cookies ou autenticacao,
desde que o objeto entregue ao Viewer Mode preserve o contrato publico.

## Fluxo de Inicializacao

1. O browser carrega o Viewer Mode hospedado pelo MarketBubble.
2. A pagina define `window.__viewerTransportFactory` antes de carregar
   `viewer-mode.js`.
3. A UI chama `loadSnapshot()` no transporte.
4. O backend retorna um snapshot publico completo.
5. A UI chama `connectEvents()` para receber eventos incrementais.
6. Em reconexao, a UI busca novo snapshot antes de aplicar eventos novamente.

O snapshot inicial nao inclui historico de chat no v1. Mensagens recebidas
durante uma desconexao podem ser perdidas ate que uma fase futura implemente
persistencia e replay.

## Transporte Hospedado

A factory hospedada deve seguir o contrato documentado em
`docs/viewer-transport-client.md`:

```js
window.__viewerTransportFactory = () => ({
  async loadSnapshot() {
    const response = await fetch('/viewer-api/v1/snapshot', {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Snapshot request failed with ${response.status}.`);
    }

    return response.json();
  },

  connectEvents({ onClose, onError, onEvent, onOpen }) {
    const socket = new WebSocket('wss://marketbubble.example/viewer-api/v1/events');

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    socket.addEventListener('message', (event) => onEvent(JSON.parse(event.data)));

    return {
      close() {
        socket.close();
      },
    };
  },
});
```

O exemplo usa URLs ilustrativas. A decisao entre cookie de sessao, bearer token
ou URL assinada pertence ao backend hospedado. Nenhum desses detalhes deve
aparecer dentro dos snapshots ou eventos.

## Manifesto Publico

O manifesto informa quais sources e players o Viewer Mode deve exibir. Ele nao
deve conter credenciais nem configuracao interna do Collector.

Exemplo resumido:

```json
{
  "title": "MarketBubble Live Demo",
  "sources": [
    {
      "sourceId": "marketbubble:main-stage",
      "platform": "marketbubble",
      "broadcasterName": "MarketBubble",
      "channelLabel": "Main Stage",
      "watchUrl": "https://marketbubble.example/live/main-stage"
    },
    {
      "sourceId": "twitch:marketbubble",
      "platform": "twitch",
      "channelLabel": "marketbubble",
      "watchUrl": "https://www.twitch.tv/marketbubble",
      "player": {
        "provider": "twitch",
        "channel": "marketbubble"
      }
    }
  ]
}
```

`platform: "marketbubble"` e valido como identidade publica de source, mas o
Collector atual ainda nao possui conector nativo MarketBubble. Para chat nativo,
o MarketBubble deve produzir eventos `chat.message` no mesmo formato das outras
plataformas.

## Requisitos do Backend

Um backend hospedado compativel precisa:

- autenticar o Collector quando ele publicar eventos;
- autorizar espectadores a acessar uma live especifica;
- entregar snapshot completo antes dos eventos incrementais;
- fanout de WebSocket ou transporte equivalente para espectadores conectados;
- normalizar e validar payloads por allowlist;
- emitir `snapshot.replace`, `chat.message`, `source.status`,
  `viewers.update` e `manifest.update`;
- manter `sourceId` estavel durante a sessao;
- recalcular ou validar total de viewers a partir das sources publicas;
- aplicar rate limit e limites de tamanho de payload;
- registrar metricas e erros sem expor dados sensiveis ao espectador.

Persistencia de chat e replay sao opcionais para uma versao posterior. Se forem
adicionados, devem ser documentados como extensao do protocolo, porque o v1
assume chat sem historico.

## Seguranca e Privacidade

Nunca publicar nos payloads publicos:

- Twitch access token;
- Kick access token, refresh token ou Client Secret;
- cookies ou dados de sessao X;
- OAuth state, authorization code ou PKCE verifier;
- config interna do Collector;
- caminhos locais;
- environment overrides;
- stacks de erro;
- payload bruto `raw`;
- identidade da conta autenticada quando ela nao for a source publica.

O gateway local atual deve continuar limitado a loopback. Ele serve para demo e
desenvolvimento, nao para exposicao publica na internet.

## Chat Nativo MarketBubble

O chat nativo do MarketBubble deve entrar como nova origem publica, nao como
caso especial dentro da UI.

Formato recomendado:

```json
{
  "id": "mb-message-1",
  "source": {
    "sourceId": "marketbubble:main-stage",
    "platform": "marketbubble",
    "broadcasterName": "MarketBubble",
    "channelLabel": "Main Stage"
  },
  "author": {
    "id": "viewer-123",
    "name": "Ana"
  },
  "text": "Hello MarketBubble",
  "timestamp": "2026-06-07T18:00:00.000Z",
  "fragments": [
    {
      "type": "text",
      "text": "Hello MarketBubble"
    }
  ]
}
```

Moderacao, bloqueios, exclusao de mensagens e rate limits de usuarios devem ser
definidos pelo backend antes de liberar escrita para espectadores. O Viewer Mode
atual e somente leitura.

## Players e Embeds

Twitch e o unico player embutido aprovado na implementacao atual. Ele exige que
o parametro `parent` corresponda ao dominio que hospeda a pagina. Em producao,
o Viewer Mode deve estar em HTTPS e usar o dominio real do MarketBubble.

Kick e X devem permanecer como `watchUrl` externo ate que um embed confiavel e
legalmente aceitavel seja comprovado. O guia nao assume que esses embeds existem
ou que serao estaveis.

## Limites Conhecidos

- O Collector atual suporta uma source real por plataforma.
- O `chat-hub` ainda rejeita plataformas duplicadas.
- X depende de captura DOM e pode quebrar com mudancas da pagina.
- Viewers da Twitch exigem conta Twitch conectada no Collector.
- Kick chat reading ainda usa Pusher nao oficial.
- BetterTTV e 7TV funcionam no pipeline Twitch, mas emotes de canal 7TV ainda
  podem falhar em algumas execucoes.
- O Viewer Mode v1 nao envia mensagens nem comandos.

## Checklist de Handoff

Antes de integrar com um backend MarketBubble:

- revisar `docs/viewer-realtime-protocol-v1.md`;
- implementar transporte hospedado via `window.__viewerTransportFactory`;
- validar `docs/examples/viewer-manifest-marketbubble.json`;
- garantir HTTPS para embed Twitch em producao;
- definir autenticacao Collector -> backend;
- definir autorizacao Viewer -> live;
- bloquear qualquer dado proibido nos payloads publicos;
- testar reconexao com novo snapshot;
- testar queda de uma plataforma sem derrubar o total de viewers;
- documentar quais partes sao demo local e quais sao producao.

## Ordem Sugerida

1. Hospedar Viewer Mode estatico com transporte injetado.
2. Implementar snapshot publico no backend.
3. Implementar eventos realtime do backend.
4. Receber publicacoes do Collector ou de um relay interno.
5. Adicionar autenticacao e autorizacao.
6. Adicionar observabilidade e rate limits.
7. Projetar chat nativo MarketBubble.
8. Só depois avaliar historico, replay, moderacao web e multi-source real.
