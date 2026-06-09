# External App Bridge Plan

Este documento e a fonte de verdade para a retomada pos browser-only pivot. A
decisao atual e manter o Electron app como coletor local das plataformas
externas e deixar o browser backend vivo de forma independente.

## Decisao Atual

- O browser backend e o processo que deve ficar online para servir `/viewer`,
  `/overlay`, realtime e local chat.
- O Electron app continua responsavel por autenticar, coletar e enviar para
  Twitch, Kick e X.
- O Electron app publica mensagens externas, status de fontes e viewer counts no
  browser backend enquanto estiver aberto.
- X continua no Electron por ser o caminho mais robusto com browser local e
  sessao de login local.
- Mensagens externas de Twitch, Kick e X nao entram no `local-chat.json`; elas
  sao eventos de feed/realtime, nao historico persistente do chat local.
- O browser-only admin roadmap fica pausado. Qualquer parte util daquele caminho
  deve ser trazida depois de forma seletiva, commit por commit.

## Arquitetura Alvo

```text
Twitch / Kick / X
        |
        v
Electron App local
connectors + auth + send + viewer counts
        |
        |  APP_INGEST_TOKEN
        |  POST /api/v1/app/events
        v
Browser Backend externo
viewer + overlay + local chat + sessions + realtime
        |
        v
Browser Viewer / OBS / usuarios do chat local
```

## Estado Atual Na Main

Ja existe na branch `main`:

- `src/browser-backend/runtime.js` para iniciar o gateway sem importar Electron.
- `src/browser-backend/cli.js` exposto por `npm.cmd run backend`.
- `src/browser-backend/client.js` para o app falar com o backend por
  HTTP/WebSocket.
- `src/browser-backend/snapshot-state.js` para manter snapshot em modo
  standalone.
- `POST /api/v1/app/events` protegido por `APP_INGEST_TOKEN`.
- `BROWSER_BACKEND_URL`, `BROWSER_BACKEND_MODE` e `APP_INGEST_TOKEN` na config
  runtime do app.
- Modo `external`, onde o app conecta em um backend ja rodando.
- Modo `embedded`, onde o app sobe o gateway junto com o Electron.
- Viewer e overlay consumindo snapshot e WebSocket pelo contrato publico.
- Local chat com login/cadastro, mensagens locais e moderacao basica.

Isso significa que o trabalho atual nao e reescrever o app. O foco e consolidar
o modo external, testar o contrato ponta a ponta e documentar o setup correto.

## Pontos Importantes

- "Site vivo sem Electron" so e verdadeiro quando o backend roda como processo
  separado ou servico. Se estiver em `embedded`, fechar o app fecha o site.
- Fechar o Electron em `external` nao derruba viewer/local chat, mas para a
  coleta de Twitch, Kick e X.
- O backend atual e local-first: o gateway escuta em `127.0.0.1` e WebSocket
  aceita origens loopback. Para VPS/dominio publico, sera necessario tratar
  bind, reverse proxy HTTPS e allowlist de origem.
- O `APP_INGEST_TOKEN` e credencial de app para backend. Ele nao deve aparecer
  no viewer, overlay, logs publicos ou config publica.
- O `local-chat.json` deve armazenar somente usuarios, sessoes, moderacao e
  mensagens locais.
- Nao devemos mover Twitch, Kick ou X para o backend nesta fase.
- Nao devemos trazer o painel admin browser-only completo nesta fase.

## Contratos

### App Para Backend

Endpoint principal:

```text
POST /api/v1/app/events
Authorization: Bearer <APP_INGEST_TOKEN>
```

Eventos aceitos:

- `snapshot.replace`
- `chat.message`
- `source.status`
- `viewers.update`
- `manifest.update`

Uso esperado:

- `chat.message`: mensagens normalizadas de Twitch, Kick e X vindas do app.
- `source.status`: estado de conexao e contadores por fonte.
- `viewers.update`: viewer counts normalizados por fonte.
- `manifest.update` ou `snapshot.replace`: atualizacao publica inicial/geral.

### Browser Para Backend

Rotas publicas existentes:

```text
GET  /viewer
GET  /overlay
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

## Plano De Implementacao

### Bloco 1 - Atualizar Contrato E Documentacao

Objetivo: alinhar README e docs com a decisao external-first.

Mudancas:

- Criar este plano.
- Atualizar README para explicar Electron coletor + browser backend externo.
- Deixar claro que browser-only admin esta pausado.
- Documentar comandos de demo external.

Validacao:

```powershell
npm.cmd run lint
git diff --check
```

### Bloco 2 - Auditar External Mode Na Main

Objetivo: provar o que ja existe antes de alterar comportamento.

Checagens:

- App publica `snapshot.replace` ao conectar no backend externo.
- App publica `chat.message` para mensagens Twitch/Kick/X.
- App publica `source.status` e `viewers.update`.
- App recebe eventos do backend para mostrar mensagens locais no dashboard.
- Local chat pelo app usa backend client quando `browserBackendClient` existe.

Validacao:

```powershell
npm.cmd run lint
node --test test\browser-backend-client.test.js test\browser-backend-cli.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 3 - Estado De Conexao Do Backend No App

Objetivo: o host saber se o app esta conectado ao backend externo.

Mudancas provaveis:

- Expor estado `connected`, `disconnected`, `error` para o renderer.
- Mostrar erro de backend/token de ingestao sem expor o token.
- Adicionar retry/reconnect se o backend cair e voltar.
- Manter `embedded` como fallback tecnico, mas indicar que o fluxo alvo e
  `external`.

Risco:

- Evitar mexer no fluxo de conectores que ja funciona. Esta etapa deve ficar na
  fronteira app/backend e UI de status.

Validacao:

```powershell
npm.cmd run lint
node --test test\app-config.test.js test\browser-backend-client.test.js
npm.cmd test
```

### Bloco 4 - Smoke External Completo

Objetivo: provar o fluxo real de demo.

Cenario:

1. Rodar backend separado com `APP_INGEST_TOKEN`.
2. Abrir `/viewer`.
3. Rodar Electron com `BROWSER_BACKEND_URL` e mesmo `APP_INGEST_TOKEN`.
4. Confirmar snapshot inicial no viewer.
5. Confirmar mensagem externa do app aparecendo no viewer.
6. Confirmar viewer counts no viewer.
7. Enviar mensagem local pelo browser e ver no app.
8. Enviar mensagem local pelo app e ver no browser.
9. Fechar Electron.
10. Confirmar que `/viewer` e local chat continuam funcionando.
11. Confirmar que Twitch/Kick/X param de atualizar, como esperado.

Validacao automatica possivel:

```powershell
npm.cmd run lint
node --test test\browser-backend-cli.test.js test\browser-backend-client.test.js test\public-realtime.test.js
npm.cmd test
```

### Bloco 5 - Preparacao Para VPS

Objetivo: listar o que precisa mudar antes de hospedar publicamente.

Itens:

- Definir se o backend vai continuar escutando so em `127.0.0.1` atras de
  reverse proxy ou se vai aceitar bind configuravel.
- Definir allowlist de origens do WebSocket.
- Documentar HTTPS/reverse proxy.
- Definir onde `APP_INGEST_TOKEN` fica armazenado na VPS.
- Definir backup/reset do `local-chat.json`.
- Adiar banco hospedado ate existir necessidade real.

Validacao:

```powershell
npm.cmd run lint
git diff --check
```

## Nao Fazer Nesta Fase

- Migrar Twitch/Kick/X para o browser backend.
- Rodar X via backend/VPS.
- Persistir mensagens externas no local chat.
- Criar painel admin browser-only completo.
- Criar banco hospedado ou multi-tenant.
- Reescrever o app Electron que ja esta funcionando como coletor.
- Fazer merge direto do branch `codex/browser-only-pivot`.

## Comandos De Demo External

Terminal do backend:

```powershell
$env:APP_INGEST_TOKEN = "demo-token"
npm.cmd run backend
```

Terminal do app:

```powershell
$env:BROWSER_BACKEND_URL = "http://127.0.0.1:47831"
$env:APP_INGEST_TOKEN = "demo-token"
npm.cmd start
```

Abrir viewer:

```text
http://127.0.0.1:47831/viewer
```

## Ordem Recomendada De Commits

1. `docs: add external app bridge plan`
2. `test: audit external backend bridge`
3. `feat: surface backend connection status`
4. `test: add external bridge smoke coverage`
5. `docs: document external deployment notes`

