# Viewer Mode Transport Client

O Viewer Mode consome o protocolo publico v1 por uma fronteira de transporte
browser-native em `src/viewer/viewer-transport.js`.

Essa fronteira existe para permitir que o Viewer Mode local use o gateway do
Collector hoje e que uma versao hospedada pelo MarketBubble troque apenas o
cliente de transporte, sem alterar a UI principal em `viewer-mode.js`.

## Contrato do cliente

Um cliente de transporte precisa expor:

```js
{
  async loadSnapshot() {},
  connectEvents({ onClose, onError, onEvent, onOpen }) {}
}
```

`loadSnapshot()` retorna o snapshot publico completo definido em
`docs/viewer-realtime-protocol-v1.md`.

`connectEvents()` abre o canal de eventos incrementais e chama:

- `onOpen()` quando a conexao estiver pronta;
- `onEvent(event)` para cada envelope publico v1 recebido;
- `onError()` quando o transporte sinalizar erro;
- `onClose()` quando a conexao encerrar.

O retorno de `connectEvents()` precisa ter um metodo `close()` idempotente:

```js
{
  close() {}
}
```

## Cliente local padrao

O cliente local usa:

- `GET /api/v1/snapshot`;
- WebSocket em `/api/v1/events`;
- o mesmo host que serviu a pagina.

Esses detalhes ficam no arquivo de transporte. A UI principal chama apenas
`window.ViewerTransports.createDefaultViewerTransportClient()`.

## Injetando outro backend

Uma pagina hospedada pode definir `window.__viewerTransportFactory` antes de
carregar `viewer-mode.js`:

```html
<script>
  window.__viewerTransportFactory = () => ({
    async loadSnapshot() {
      const response = await fetch('https://api.marketbubble.example/viewer/v1/snapshot', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Snapshot request failed with ${response.status}.`);
      }

      return response.json();
    },

    connectEvents({ onClose, onError, onEvent, onOpen }) {
      const socket = new WebSocket('wss://api.marketbubble.example/viewer/v1/events');

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
</script>
```

O backend substituto deve preservar os payloads do protocolo v1. Autenticacao,
cookies, bearer tokens ou autorizacao de espectadores pertencem ao backend
hospedado e nao devem aparecer nos snapshots ou eventos publicos.

## Mock de demo

`createMockViewerTransportClient()` existe para demos e testes manuais. Ele
retorna um snapshot em memoria e reproduz uma lista opcional de eventos v1 sem
abrir rede.
