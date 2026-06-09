# External App Bridge Deployment Notes

Estas notas descrevem o caminho recomendado para rodar o browser backend fora do
Electron mantendo o app local como coletor de Twitch, Kick e X.

## Modelo Recomendado

```text
Internet
   |
   v
HTTPS reverse proxy
   |
   v
127.0.0.1:47831
browser backend
```

O backend atual deve continuar escutando localmente. Para VPS ou dominio
publico, exponha o site por um reverse proxy HTTPS no mesmo host. Isso evita
abrir o processo Node diretamente para a internet antes de existir uma politica
completa de bind, origem, rate limit e hardening.

## Processo Backend

Variaveis minimas:

```powershell
$env:APP_INGEST_TOKEN = "troque-por-token-longo"
$env:BROWSER_BACKEND_DATA_DIR = "C:\uca-browser-backend"
$env:BROWSER_BACKEND_PORT = "47831"
npm.cmd run backend
```

Responsabilidades desse processo:

- servir `/viewer` e `/overlay`;
- servir `/api/v1/snapshot` e `/api/v1/events`;
- manter `local-chat.json`;
- aceitar local chat;
- receber eventos do Electron via `POST /api/v1/app/events`.

## Processo Electron

Na maquina onde o Electron roda:

```powershell
$env:BROWSER_BACKEND_URL = "https://seu-dominio.example"
$env:APP_INGEST_TOKEN = "mesmo-token-do-backend"
npm.cmd start
```

Se o Electron estiver na mesma VPS ou na mesma maquina do backend, tambem pode
usar:

```powershell
$env:BROWSER_BACKEND_URL = "http://127.0.0.1:47831"
```

## Pontos Importantes

- O `APP_INGEST_TOKEN` deve ser longo e privado. Ele nao deve aparecer no
  viewer, overlay, logs publicos ou codigo client-side.
- Fechar o Electron nao derruba o backend externo, mas para a coleta de
  Twitch/Kick/X.
- `local-chat.json` deve ter backup, porque guarda usuarios, sessoes, bans,
  timeouts, moderadores e mensagens locais.
- Twitch/Kick/X nao devem ser persistidos em `local-chat.json`.
- O reverse proxy precisa encaminhar WebSocket para `/api/v1/events`.
- O viewer publico precisa de HTTPS para embeds e para uso normal em dominio.
- O backend atual aceita WebSocket apenas de origens loopback. Antes de publicar
  em dominio real, sera necessario implementar uma allowlist de origens publica.

## Antes De Expor Publicamente

Checklist tecnico:

- Definir dominio final.
- Configurar HTTPS no reverse proxy.
- Encaminhar WebSocket.
- Definir allowlist de origins para o dominio publico.
- Definir armazenamento seguro do `APP_INGEST_TOKEN`.
- Definir processo supervisor para manter `npm.cmd run backend` vivo.
- Definir backup/reset do data dir.
- Revisar limites de request e protecao basica contra abuso.

## Nao Fazer Ainda

- Nao fazer bind direto em `0.0.0.0` sem origin allowlist.
- Nao publicar `APP_INGEST_TOKEN` em query string.
- Nao mover X para a VPS.
- Nao colocar tokens de Twitch/Kick/X no browser backend.
- Nao depender de URL escondida para seguranca.

