# Local Browser Chat Roadmap

Este documento organiza a cronologia para implementar o chat proprio exibido no
browser e no app. A ideia e manter a demo pragmatica, mas sem contrariar a
arquitetura atual: hoje o gateway publico e somente leitura e o app nao tem
banco de dados.

## Objetivo

- Permitir que usuarios logados enviem mensagens no chat do browser.
- Permitir que o host/app tambem participe do chat local.
- Misturar mensagens locais com Twitch, Kick e X quando o usuario quiser.
- Permitir ocultar ou exibir chats externos.
- Ter nick unico por usuario.
- Suportar moderadores por email e nick.
- Suportar comandos basicos de moderacao.

## Premissas Confirmadas

- O login deve usar OAuth quando a versao hospedada existir.
- O chat sera acessado por varios usuarios na rede/internet.
- Moderadores podem ser definidos por email e por nick.
- A moderacao inicial sera por comandos.
- Se a competicao for vencida, o chat deve migrar para o dominio/backend do
  hoster.

## Pontos Importantes

- OAuth resolve identidade/email, mas nao resolve nick unico sozinho.
- Nick unico precisa de persistencia e validacao server-side.
- O gateway local atual e read-only; enviar mensagens e moderar exige novos
  endpoints de escrita.
- Para uso na internet, o backend hospedado e o caminho correto. Expor o app
  desktop diretamente muda o risco de seguranca.
- O app desktop deve continuar sendo o coletor de Twitch, Kick e X.
- O backend hospedado deve cuidar de usuarios, sessoes, chat local e moderacao.
- Para demo local antes do backend real, da para simular identidade com email,
  nick e token local, mas isso nao prova posse do email.

## Arquitetura Alvo

### App Desktop

- Coleta mensagens de Twitch, Kick e X.
- Exibe o feed combinado.
- Envia eventos das plataformas para o gateway/backend.
- Permite o host enviar mensagens locais.
- Permite configurar moderadores e executar comandos.

### Browser Chat

- Exibe o chat combinado.
- Permite login/cadastro de nick.
- Permite envio de mensagens locais.
- Permite escolher se mensagens externas aparecem.
- Para moderadores, permite comandos como ban, timeout e unban.

### Backend/Gateway

- Mantem usuarios, nicks, roles, bans e timeouts.
- Recebe mensagens locais.
- Publica mensagens locais e externas no realtime.
- Valida sessao antes de aceitar envio.
- Valida permissao antes de aceitar comandos de moderacao.

## Cronologia de Implementacao

### Fase 0 - Contrato e Limites

Antes de codar, fechar o contrato minimo:

- Nome da plataforma local: `local`.
- Evento publico para mensagem local: reutilizar `chat.message`.
- Source local sugerido:

```json
{
  "sourceId": "local:chat",
  "platform": "local",
  "channelLabel": "Local Chat"
}
```

- Mensagem local deve seguir o mesmo shape publico das outras mensagens.
- O filtro de plataforma deve aceitar `local`.
- O chat externo deve poder ser ocultado sem parar a coleta das plataformas.

### Fase 1 - Store Local de Demo

Criar um store separado do `config.json`, por exemplo:

```text
%APPDATA%/Unified Chat Aggregator/local-chat.json
```

Dados iniciais:

```json
{
  "users": [],
  "sessions": [],
  "moderators": [],
  "bans": [],
  "timeouts": [],
  "messages": []
}
```

Regras:

- Email normalizado em lowercase.
- Nick normalizado para comparacao case-insensitive.
- Nick unico.
- Sessao com token aleatorio.
- Mensagens com limite de historico.

Validar com testes unitarios:

- cria usuario novo;
- rejeita nick duplicado;
- encontra usuario por sessao;
- aplica ban por email;
- aplica ban por nick;
- aplica timeout com expiracao;
- rejeita mensagem de usuario banido ou em timeout.

### Fase 2 - Gateway Local Writable

Adicionar endpoints locais para a demo:

- `POST /api/v1/local/login`
- `POST /api/v1/local/register`
- `POST /api/v1/local/messages`
- `POST /api/v1/local/moderation`
- `GET /api/v1/local/me`

Regras:

- Aceitar JSON pequeno.
- Limitar tamanho de mensagem.
- Validar token de sessao.
- Rejeitar usuario banido/time-out.
- Publicar mensagem aceita via WebSocket como `chat.message`.

Observacao:

- Esta fase ainda pode ser local, mas ja deve nascer com formato facil de
  migrar para backend hospedado.

### Fase 3 - UI do Browser Chat

Adicionar no Viewer Mode:

- Login/cadastro simples.
- Estado logado/deslogado.
- Campo de mensagem local.
- Botao de envio.
- Filtro `Local`.
- Toggle para mostrar/ocultar plataformas externas.

Comportamento:

- Usuario deslogado ve mensagens, mas nao envia.
- Usuario logado envia mensagens locais.
- Mensagens locais aparecem misturadas com Twitch, Kick e X.
- Se o usuario ocultar plataformas externas, so ve `local`.

### Fase 4 - UI do App

Adicionar no app:

- Identidade local do host.
- Campo de envio para `Local Chat`.
- Painel simples de moderadores.
- Lista/config de mods por email e nick.
- Indicacao visual para mensagem local.

Comportamento:

- O host consegue enviar mensagem local pelo app.
- O host consegue usar comandos de moderacao.
- Mods configurados tambem conseguem usar comandos no browser.

### Fase 5 - Comandos de Moderacao

Comandos iniciais:

```text
/ban nick motivo opcional
/ban-email email motivo opcional
/timeout nick 60 motivo opcional
/untimeout nick
/unban nick
/unban-email email
/mod nick
/unmod nick
```

Regras:

- Apenas host/mod pode executar.
- Comando nao deve aparecer como mensagem normal se for executado com sucesso.
- Falha deve retornar erro visivel para quem executou.
- Ban por email deve bloquear mesmo se o usuario trocar nick.
- Ban por nick deve bloquear o nick atual.

### Fase 6 - Caminho Hospedado

Quando existir dominio/backend do hoster:

- Trocar store local por banco do backend.
- Trocar endpoints locais por endpoints hospedados.
- Usar OAuth real com callback no dominio do hoster.
- Usar cookies seguros ou token curto com refresh.
- App desktop envia eventos externos para o backend.
- Browser consome realtime do backend.

Requisitos minimos do backend:

- Users
- Sessions
- Roles
- Messages
- Bans
- Timeouts
- Platform event ingestion
- Realtime fanout
- Rate limit

## Ordem Recomendada de Commits

1. `docs: add local browser chat roadmap`
2. `feat: add local chat store`
3. `feat: expose local chat gateway endpoints`
4. `feat: render local chat controls in viewer mode`
5. `feat: add local chat controls to dashboard`
6. `feat: add local chat moderation commands`
7. `docs: document hosted chat backend integration`

## Validacao por Fase

### Fase 1

```powershell
npm.cmd run lint
node --test test\local-chat-store.test.js
```

### Fase 2

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js test\local-chat-store.test.js
```

### Fase 3 e 4

```powershell
npm.cmd run lint
node --test test\http-gateway.test.js
npm.cmd --prefix frontend run build
```

Observacao: atualmente nao existe `frontend/package.json`, entao esse build
falha por estrutura inexistente ate o repo ganhar esse pacote.

### Antes de Fechar Cada Bloco

```powershell
npm.cmd test
git diff --check
git diff --stat
```

## Decisoes Pendentes

- Provider OAuth inicial: Google, Discord, Auth0 ou outro.
- Se a demo local precisa aceitar usuarios de outras maquinas antes do backend
  hospedado.
- Limite de mensagens em memoria/historico.
- Se comandos de moderacao devem ser aceitos tambem pelo app ou apenas pelo
  browser.
- Se o host pode reservar nicks antes do primeiro login.
