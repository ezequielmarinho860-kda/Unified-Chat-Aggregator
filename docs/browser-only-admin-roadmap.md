# Browser-Only Admin Roadmap

Este documento define a rota para transformar o projeto em um produto
browser-only: um backend hospedado/rodando 24/7, um viewer publico para usuarios
do chat local e um painel admin privado para o streamer/host configurar lives,
fontes e moderacao.

## Decisao

Seguir com browser-only como caminho principal.

O Electron app passa a ser opcional ou congelado. A configuracao sensivel deve
ficar no backend, nao no viewer publico e nem em um app desktop distribuido.

Status desta branch: o viewer publico, o overlay e o gateway browser-native ja
existem, mas ainda convivem com o runtime Electron enquanto a transicao avanca.

## Objetivo

- Ter um site publico de chat local em `/viewer`.
- Ter um painel privado de configuracao em `/admin`.
- Proteger `/admin` e todas as APIs admin com autenticacao/autorizacao.
- Guardar configuracoes privadas no backend.
- Permitir que o streamer configure:
  - Twitch/Kick/X sources;
  - dados publicos do viewer;
  - contas mod/admin;
  - opcoes de chat local;
  - overlay/popout para live.
- Impedir que usuarios comuns do chat acessem ou alterem configuracao.

## Arquitetura Alvo

```text
                  Streamer / Host
                        |
                        v
              /admin privado protegido
                        |
                        v
        Backend do hoster ou backend local demo
   config privada + usuarios + roles + chat + eventos
                        |
          +-------------+-------------+
          |                           |
          v                           v
    /viewer publico              /overlay publico
 chat local + filtros          OBS/browser source
```

## Pontos Importantes

- Nao basta esconder o link de `/admin`. Qualquer pessoa pode tentar acessar a
  rota manualmente.
- A seguranca precisa estar no backend:
  - `/admin` pode servir apenas a shell de login sem dados privados;
  - toda API `/api/admin/*` exige role admin/host;
  - usuario comum do chat local nunca pode chamar API admin.
- O viewer publico nao deve receber tokens, client secrets, config privada,
  lista interna de admins, nem detalhes de setup.
- Proteger so o HTML do admin nao basta. As APIs admin tambem precisam ser
  protegidas.
- Para demo local, uma senha/token admin e suficiente. Para producao, usar login
  do hoster/OAuth/SSO com roles.
- Twitch/Kick/X ainda nao estao totalmente no backend. Hoje os conectores vivem
  no app Electron. Browser-only completo exige mover essa responsabilidade para
  o backend ou integrar com servicos do hoster.
- X e o ponto mais dificil, porque hoje depende de captura via Electron/DOM. Para
  browser-only, X precisa de outra estrategia ou ficar como integracao limitada.

## Rotas Publicas

Essas rotas podem ser acessadas por usuarios do chat/local/OBS:

```text
GET /viewer
GET /popout
GET /overlay
GET /api/v1/snapshot
GET /api/v1/events
POST /api/v1/app/events
GET /api/v1/local/me
POST /api/v1/local/login
POST /api/v1/local/register
POST /api/v1/local/messages
POST /api/v1/local/moderation
GET /api/v1/local/moderation-commands
GET /api/v1/auth/google/status
GET /api/v1/auth/google/start
GET /api/v1/auth/google/callback
POST /api/v1/auth/google/complete
```

Observacao: `POST /api/v1/app/events` existe apenas quando `APP_INGEST_TOKEN`
esta configurado e e a rota usada pelo app para publicar eventos no backend.

Observacao: `POST /api/v1/local/moderation` continua publico no sentido de
rota existente, mas precisa validar que o usuario autenticado tem role
`moderator`, `host` ou `admin`.

## Rotas Privadas Admin

Sugestao inicial:

```text
GET  /admin
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/session
GET  /api/admin/config
PUT  /api/admin/config
GET  /api/admin/sources
PUT  /api/admin/sources
GET  /api/admin/moderators
POST /api/admin/moderators
DELETE /api/admin/moderators/:id
```

`GET /admin` pode ser carregado sem sessao para mostrar login, desde que nao
inclua config privada, tokens ou dados internos. As APIs admin privadas precisam
exigir sessao admin. `POST /api/admin/login` e `GET /api/admin/session` sao as
excecoes publicas necessarias para iniciar e detectar sessao.

## Modelo de Auth Admin

### Demo Local

Usar um token/senha admin configurado por env:

```text
ADMIN_TOKEN=uma-string-da-demo
```

Fluxo:

1. Streamer acessa `/admin`.
2. Backend mostra login simples.
3. Streamer informa token/senha.
4. Backend cria cookie de sessao admin `HttpOnly`, `SameSite=Lax`.
5. `/admin` e `/api/admin/*` passam a funcionar enquanto a sessao for valida.

Regras:

- Nunca expor `ADMIN_TOKEN` no HTML.
- Nunca aceitar admin token em query string em producao.
- Para demo local, query string pode ser usada so se for removida/limpa apos
  criar sessao, mas o ideal e formulario POST.

### Producao / Hoster

Usar login do proprio hoster:

- OAuth/SSO do hoster;
- session cookie `HttpOnly`;
- roles no backend: `admin`, `host`, `moderator`, `user`;
- APIs admin validam role;
- APIs de moderacao validam role de moderador.

## Configuracao Privada

O backend deve guardar configuracao privada, por exemplo:

```json
{
  "viewer": {
    "title": "Unified Chat",
    "theme": "dark",
    "showExternalChats": true
  },
  "sources": {
    "twitch": [
      { "enabled": true, "channel": "streamer_a" },
      { "enabled": true, "channel": "streamer_b" }
    ],
    "kick": [
      { "enabled": true, "channel": "streamer_a" },
      { "enabled": false, "channel": "" }
    ],
    "x": [
      { "enabled": true, "liveUrl": "https://x.com/streamer_a/live" },
      { "enabled": false, "liveUrl": "" }
    ]
  }
}
```

O viewer publico recebe somente a versao publica:

```json
{
  "title": "Unified Chat",
  "sources": [
    {
      "sourceId": "twitch:streamer_a",
      "platform": "twitch",
      "channelLabel": "streamer_a",
      "watchUrl": "https://twitch.tv/streamer_a"
    }
  ]
}
```

## O Que Reaproveitar Do Codigo Atual

Reaproveitar:

- `src/browser-backend/runtime.js`
- `src/browser-backend/cli.js`
- `src/gateway/http-gateway.js`
- `src/local-chat-store.js`
- `src/local-chat-moderation.js`
- `src/google-oauth.js`
- `src/viewer/*`
- serializers publicos em `src/public-realtime.js`
- manifesto publico em `src/public-viewer-manifest.js`

Congelar ou tornar opcional:

- `src/main.js`
- `src/renderer.js`
- telas Electron `setup.html` e `dashboard.html`
- conectores que dependem de Electron, especialmente X capture.

Mover futuramente para backend:

- configuracao de sources;
- viewer monitor;
- Twitch connector;
- Kick connector;
- X, se houver estrategia sem Electron.

## Dependencia Com App / Browser Split

Antes de criar um painel `/admin` completo, a fronteira backend precisa estar
clara. O codigo atual ja tem:

- runtime sem Electron em `src/browser-backend/runtime.js`;
- CLI standalone em `src/browser-backend/cli.js`;
- cliente HTTP/WebSocket em `src/browser-backend/client.js`;
- modo `embedded` e `external` em `src/main.js`.

Portanto, a proxima etapa pratica deste roadmap e auth admin basico no backend.
Criar shell visual de admin antes disso conflita com a decisao de que seguranca
nao pode depender de URL escondida nem de HTML protegido isoladamente.

## Cronologia Recomendada

### Bloco 1 - Documento e Contrato

Objetivo: travar a decisao browser-only.

Mudancas:

- Criar este documento.
- Definir rotas publicas e rotas admin.
- Definir modelo de auth demo/producao.

Validacao:

```powershell
git diff --check
```

### Bloco 2 - Admin Auth Basico

Estado atual: implementado no gateway/backend.

Objetivo: proteger `/admin`.

Mudancas:

- Adicionar `ADMIN_TOKEN`.
- Criar sessao admin em cookie `HttpOnly`.
- Criar endpoints:
  - `POST /api/admin/login`
  - `POST /api/admin/logout`
  - `GET /api/admin/session`
- Servir `/admin` sem dados privados e detectar sessao pela API.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js
npm.cmd test
```

### Bloco 3 - Admin Shell

Estado atual: implementado como shell de login/estado de sessao sem dados
privados.

Objetivo: criar shell admin separada do viewer.

Mudancas:

- Criar `src/admin/index.html`.
- Criar `src/admin/admin-mode.js`.
- Criar `src/admin/admin-mode.css`.
- Servir `/admin`.
- Mostrar estado da sessao admin.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js
npm.cmd test
```

### Bloco 4 - Config Store Do Backend

Estado atual: implementado no backend como `browser-config.json` no data dir.

Objetivo: backend virar dono da config browser-only.

Mudancas:

- Criar store de config do backend.
- Salvar config em data dir do backend.
- Criar `GET /api/admin/config`.
- Criar `PUT /api/admin/config`.
- Garantir que `GET /api/v1/snapshot` continue usando somente dados publicos.

Validacao:

```powershell
npm.cmd run lint
node --test test\browser-backend-config.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 5 - Sources Admin

Estado atual: implementado com UI admin para duas sources por plataforma e
manifesto publico derivado da config privada no backend standalone.

Objetivo: configurar lives pelo admin.

Mudancas:

- UI para Twitch/Kick/X sources.
- Limitar duas sources por plataforma para a demo.
- Validar URLs/canais.
- Gerar manifesto publico a partir da config privada.

Validacao:

```powershell
npm.cmd run lint
node --test test\public-viewer-manifest.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 6 - Viewer Popout

Estado atual: implementado como `/viewer?mode=popout` e alias publico
`/popout`, reutilizando o contrato publico do viewer.

Objetivo: streamer usar janela popout na live.

Mudancas:

- Criar modo `/viewer?mode=popout` ou `/popout`.
- Layout compacto so com chat.
- Filtros visiveis/compactos.
- Sem configuracao admin.

Validacao:

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js
npm.cmd test
```

### Bloco 7 - Moderacao Browser-Only

Objetivo: moderadores operarem pelo browser.

Mudancas:

- Admin gerencia mods.
- Local chat continua aceitando comandos:
  - `/ban`
  - `/unban`
  - `/timeout`
  - `/untimeout`
  - `/mod`
  - `/unmod`
- APIs de moderacao validam role.

Validacao:

```powershell
npm.cmd run lint
node --test test\local-chat-store.test.js test\local-chat-moderation.test.js test\http-gateway.test.js
npm.cmd test
```

### Bloco 8 - External Platform Connectors No Backend

Objetivo: deixar Twitch/Kick/X independentes do Electron.

Prioridade:

1. Twitch no backend.
2. Kick no backend.
3. X somente se houver estrategia viavel sem Electron.

Risco:

- Este bloco e maior e pode nao ser necessario para demo se o foco for chat
  local.

Validacao:

```powershell
npm.cmd run lint
npm.cmd test
```

## Nao Fazer Agora

- Nao mover X capture para backend sem antes decidir estrategia tecnica.
- Nao expor tokens no viewer.
- Nao depender de "URL escondida" para proteger admin.
- Nao misturar formulario de configuracao dentro de `/viewer`.
- Nao fazer painel admin completo antes de travar auth admin.

## Comportamento Esperado Na Demo

1. Hoster inicia backend.
2. Streamer acessa `/admin`.
3. Streamer faz login admin.
4. Streamer configura sources e moderadores.
5. Usuarios acessam `/viewer`.
6. Usuarios entram no chat local com email.
7. Se primeira vez, escolhem nick.
8. Moderadores usam comandos no browser.
9. Streamer abre `/viewer?mode=popout` ou `/popout` para live/OBS.
10. Usuario comum tentando `/admin` recebe bloqueio.
