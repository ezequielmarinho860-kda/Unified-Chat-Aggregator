# App / Browser Split Roadmap

Este documento define a cronologia para separar o browser chat/backend do app
Electron. O objetivo e fazer o browser continuar de pe mesmo quando o app fechar,
mantendo o app como coletor das plataformas externas e como cliente/moderador do
chat local.

## Objetivo

- Rodar o backend do browser chat fora do processo principal do Electron.
- Servir o browser viewer e overlay a partir desse backend separado.
- Manter o chat local funcionando mesmo se o app fechar.
- Permitir que o app conecte nesse backend para:
  - publicar mensagens Twitch, Kick e X;
  - publicar status e viewers;
  - ler mensagens do chat local;
  - enviar mensagens locais;
  - executar comandos de moderacao.
- Preservar o formato publico atual de snapshot/eventos sempre que possivel.

## Estado Atual do Codigo

Hoje o app Electron e dono de tudo:

- `src/main.js` cria `localChatStore`.
- `src/main.js` chama `createHttpGateway(...)`.
- `src/gateway/http-gateway.js` serve `/viewer`, `/overlay`, snapshot, eventos,
  OAuth Google e endpoints do local chat.
- O browser chat depende desse gateway local.
- Se o app fechar, o gateway fecha junto.

Portanto, a premissa "browser continua vivo com app fechado" conflita com a
arquitetura atual. A solucao correta e extrair o gateway/local chat para um
runtime separado.

## Pontos Importantes

- Separar backend e app nao significa que Twitch/Kick/X continuam coletando com
  o app fechado. Enquanto os conectores ficarem no app, fechar o app para essas
  plataformas.
- O chat local pode continuar funcionando com app fechado se o backend separado
  continuar rodando.
- Para a demo local, o backend pode ser um processo Node separado na mesma
  maquina.
- Para producao/hoster, esse backend deve virar servico hospedado em dominio
  proprio.
- O browser deve falar somente com o backend. Ele nao deve depender de
  `window.chatAggregator`, Electron ou IPC.
- O app deve falar com o backend por HTTP/WebSocket, nao por import direto de
  store/gateway.
- Tokens de ingestao do app precisam ser separados dos tokens dos usuarios do
  chat.
- Essa e uma mudanca grande. Deve entrar em blocos pequenos, com testes em cada
  bloco.

## Arquitetura Alvo

```text
              Twitch / Kick / X
                    |
                    v
             Electron App
     connectors + dashboard + config
                    |
        app ingestion HTTP/WebSocket
                    |
                    v
       Browser Chat Backend separado
  users + sessions + messages + mods
  snapshot + realtime + viewer assets
                    |
          HTTP/WebSocket publico
                    |
                    v
       Browser Viewer / Overlay / OBS
```

### Backend Separado

Responsabilidades:

- Servir `/viewer` e `/overlay`.
- Servir `/api/v1/snapshot`.
- Servir `/api/v1/events`.
- Servir endpoints de local chat.
- Servir OAuth do chat local.
- Manter usuarios, sessoes, roles, bans, timeouts e mensagens locais.
- Receber ingestao de eventos externos vindos do app.
- Fazer fanout realtime para browsers conectados.
- Manter snapshot publico atual.

### Electron App

Responsabilidades:

- Continuar autenticando/coletando Twitch, Kick e X.
- Continuar exibindo dashboard local.
- Conectar no backend separado.
- Publicar `chat.message`, `source.status`, `viewers.update` e
  `manifest.update` no backend.
- Ler eventos do backend para mostrar local chat no app.
- Enviar mensagens locais pelo backend.
- Executar moderacao pelo backend.
- Mostrar estado da conexao com o backend.

### Browser Viewer

Responsabilidades:

- Consumir o backend separado.
- Exibir chat combinado.
- Login/cadastro/OAuth local.
- Enviar mensagens locais.
- Mostrar comandos e mencoes.
- Filtrar plataformas.

## Contratos Novos

### App Ingestion API

Endpoints sugeridos para comunicacao app -> backend:

```text
POST /api/v1/app/events
POST /api/v1/app/snapshot
POST /api/v1/app/manifest
POST /api/v1/app/viewers
GET  /api/v1/app/events
```

Headers:

```text
Authorization: Bearer <APP_INGEST_TOKEN>
```

Eventos aceitos devem seguir o contrato publico atual:

- `chat.message`
- `source.status`
- `viewers.update`
- `manifest.update`
- `snapshot.replace` apenas se realmente necessario

### Browser API

Continuar usando os endpoints existentes:

```text
GET  /api/v1/snapshot
GET  /api/v1/events
GET  /api/v1/local/me
POST /api/v1/local/register
POST /api/v1/local/login
POST /api/v1/local/messages
POST /api/v1/local/moderation
GET  /api/v1/local/moderation-commands
GET  /api/v1/auth/google/status
GET  /api/v1/auth/google/start
GET  /api/v1/auth/google/callback
POST /api/v1/auth/google/complete
```

### App Client API

O app deve parar de chamar `localChatStore` direto para chat local quando estiver
em modo backend separado. Ele deve usar um cliente HTTP:

```js
backendClient.sendLocalMessage({ token, text })
backendClient.runLocalModerationCommand({ token, command })
backendClient.getLocalSession(token)
backendClient.connectEvents(...)
backendClient.publishAppEvent(event)
```

## Cronologia de Implementacao

### Bloco 0 - Preparacao e Contrato

Objetivo: travar o contrato antes de mover runtime.

Mudancas:

- Documentar `APP_INGEST_TOKEN`, `BROWSER_BACKEND_URL` e modo local/externo.
- Criar testes de contrato para eventos de ingestao.
- Garantir que serializers publicos continuam sendo a fronteira.
- Definir fallback: se nao existir backend externo, app sobe backend local como
  hoje.

Arquivos provaveis:

- `docs/app-browser-split-roadmap.md`
- `README.md`
- testes de contrato em `test/`

Validacao:

```powershell
npm.cmd run lint
npm.cmd test
git diff --check
```

### Bloco 1 - Extrair Runtime do Gateway

Objetivo: permitir iniciar o gateway sem Electron.

Mudancas:

- Criar modulo de runtime do backend, por exemplo:

```text
src/browser-backend/runtime.js
src/browser-backend/config.js
```

- Mover criacao de `localChatStore`, `googleOAuthService` e `createHttpGateway`
  para esse runtime reutilizavel.
- `src/main.js` passa a chamar esse runtime, nao montar tudo manualmente.
- Ainda roda dentro do app neste bloco.

Risco:

- Se misturar logica Electron com runtime Node, o backend separado nao vai
  iniciar fora do app. O runtime nao pode importar `electron`.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js test\local-chat-store.test.js test\google-oauth.test.js
npm.cmd test
```

### Bloco 2 - CLI do Backend Separado

Objetivo: iniciar o backend como processo Node independente.

Mudancas:

- Criar entrypoint:

```text
src/browser-backend/cli.js
```

- Adicionar script no `package.json`:

```json
"backend": "node src/browser-backend/cli.js"
```

- Configurar porta, store path, OAuth e token por env:

```text
BROWSER_BACKEND_PORT=47831
BROWSER_BACKEND_DATA_DIR=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=...
APP_INGEST_TOKEN=...
```

- Garantir shutdown limpo.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js
npm.cmd test
```

Teste manual:

```powershell
npm.cmd run backend
```

Abrir:

```text
http://127.0.0.1:47831/viewer
```

### Bloco 3 - App Como Cliente do Backend

Objetivo: o app conversar com o backend por HTTP/WebSocket.

Mudancas:

- Criar `src/browser-backend/client.js`.
- Implementar:
  - `loadSnapshot()`
  - `connectEvents()`
  - `sendLocalMessage()`
  - `runLocalModerationCommand()`
  - `publishAppEvent()`
  - `publishViewers()`
  - `publishManifest()`
- `src/main.js` publica eventos do `chatHub` no backend.
- `src/main.js` assina eventos locais do backend para exibir no dashboard.
- App ganha estado "Backend connected/disconnected".

Risco:

- Duplicar mensagens: o app ja recebe mensagens dos conectores e tambem pode
  receber as mesmas de volta do backend. Precisa deduplicar por `sourceId:id`.

Validacao:

```powershell
npm.cmd run lint
node --test test\chat-hub.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 4 - Ingestion API no Backend

Objetivo: backend aceitar eventos externos vindos do app.

Mudancas:

- Adicionar endpoints protegidos por `APP_INGEST_TOKEN`.
- Validar payload por allowlist.
- Reusar `createPublicEvent(...)`.
- Atualizar snapshot interno ao receber:
  - mensagens externas;
  - status;
  - viewers;
  - manifest.
- Publicar eventos via WebSocket para browsers.

Endpoints:

```text
POST /api/v1/app/events
POST /api/v1/app/viewers
POST /api/v1/app/manifest
GET  /api/v1/app/events
```

Risco:

- Nao aceitar evento arbitrario do app sem validacao. Isso vira superficie de
  ataque quando hospedar.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js test\public-realtime.test.js
npm.cmd test
```

### Bloco 5 - Modo Dual no App

Objetivo: suportar backend embutido e backend externo.

Modos:

```text
embedded  -> app sobe backend local automaticamente
external  -> app conecta em BROWSER_BACKEND_URL
```

Config sugerida:

```json
{
  "browserBackend": {
    "mode": "embedded",
    "url": "http://127.0.0.1:47831",
    "ingestToken": ""
  }
}
```

Comportamento:

- Demo simples pode continuar usando `embedded`.
- Ultima big atualizacao deve permitir `external`.
- Se app fechar em `external`, browser continua.
- Se app fechar em `embedded`, browser fecha junto. Isso e esperado.

Validacao:

```powershell
npm.cmd run lint
node --test test\app-config.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 6 - Persistencia e Restart do Backend

Objetivo: backend sobreviver a restart sem perder chat local/config minima.

Mudancas:

- Confirmar store separado do app.
- Mover `local-chat.json` para data dir do backend.
- Documentar backup/reset.
- Garantir que sessoes continuam ou expiram de forma previsivel.

Para demo local:

```text
%APPDATA%/Unified Chat Aggregator/browser-backend/local-chat.json
```

Para producao:

- Banco hospedado.
- Migracao para Postgres/Supabase ou equivalente.

Validacao:

```powershell
npm.cmd run lint
node --test test\local-chat-store.test.js
npm.cmd test
```

### Bloco 7 - UI de Configuracao do Backend no App

Objetivo: deixar claro para o host se o app esta conectado ao backend.

Adicionar no setup/dashboard:

- Modo do backend: Embedded / External.
- URL do backend.
- Status da conexao.
- Botao de reconectar.
- Link do viewer.
- Aviso quando app esta em embedded: "fechar o app derruba o browser".

Risco:

- Nao expor `APP_INGEST_TOKEN` em UI publica ou logs.

Validacao:

```powershell
npm.cmd run lint
npm.cmd --prefix frontend run build
npm.cmd test
```

Observacao: hoje `npm.cmd --prefix frontend run build` falha porque nao existe
`frontend/package.json`. Enquanto a UI continuar em `src/*.html`, registrar essa
falha como limitacao estrutural do repo.

### Bloco 8 - Smoke Final de Demo

Objetivo: provar o fluxo completo.

Cenario A - Embedded:

1. Abrir app.
2. Abrir `/viewer`.
3. Mandar mensagem local pelo browser.
4. Ver no app.
5. Mandar mensagem local pelo app.
6. Ver no browser.
7. Fechar app.
8. Confirmar que browser cai. Este e o comportamento esperado do embedded.

Cenario B - External:

1. Rodar `npm.cmd run backend`.
2. Abrir `/viewer`.
3. Abrir app em modo external.
4. Confirmar conexao app -> backend.
5. Mandar mensagem Twitch/Kick/X simulada ou real pelo app.
6. Ver no browser.
7. Mandar mensagem local pelo browser.
8. Ver no app.
9. Fechar app.
10. Confirmar que browser local continua online.
11. Confirmar que novas mensagens locais ainda funcionam.
12. Confirmar que Twitch/Kick/X param de atualizar se conectores estavam so no
    app.

## Ordem Recomendada de Commits

1. `docs: add app browser split roadmap`
2. `refactor: extract browser backend runtime`
3. `feat: add standalone browser backend cli`
4. `feat: add browser backend client for app`
5. `feat: add protected app ingestion endpoints`
6. `feat: support embedded and external backend modes`
7. `feat: add backend connection controls`
8. `test: add app browser split smoke coverage`

## Estimativa de Tamanho

Estimativa conservadora:

- Bloco 1: 200-350 linhas.
- Bloco 2: 120-220 linhas.
- Bloco 3: 250-400 linhas.
- Bloco 4: 250-450 linhas.
- Bloco 5: 250-450 linhas.
- Bloco 6: 80-180 linhas.
- Bloco 7: 250-450 linhas.
- Bloco 8: 80-160 linhas de testes/docs.

Total provavel: 1.500-2.600 linhas entre codigo, testes e docs.

Regra de execucao:

- Nao fazer tudo em um patch unico.
- Quebrar em blocos de ate mais ou menos 300 linhas quando possivel.
- Cada bloco deve terminar com lint/testes e diff revisado.

## Decisoes Antes de Codar

Decisoes que precisamos fechar antes do Bloco 1:

- O primeiro modo externo sera apenas local (`127.0.0.1`) ou ja preparado para
  dominio publico?
- O backend separado sera iniciado manualmente via `npm.cmd run backend` ou o
  app podera iniciar/parar esse processo?
- O `APP_INGEST_TOKEN` sera gerado automaticamente em arquivo local ou passado
  por env?
- Para demo, as sessoes de usuarios podem continuar sem expiracao curta ou
  devemos adicionar expiracao agora?
- O app em modo external deve falhar aberto sem backend ou bloquear envio ate
  reconectar?

## Nao Fazer Nesta Ultima Big Atualizacao

Para manter escopo controlado, nao incluir:

- Migrar conectores Twitch/Kick/X para o backend.
- Banco hospedado real.
- Multi-tenant.
- Painel admin completo.
- Refresh token complexo.
- Deploy automatico.

Esses itens pertencem a uma fase pos-demo/producao.
