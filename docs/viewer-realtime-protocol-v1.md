# Viewer Realtime Protocol v1

Status: design aprovado para implementacao incremental.

Este documento define o contrato publico, somente leitura, entre o Collector e
consumidores como Viewer Mode, overlays OBS e uma futura integracao do
MarketBubble.

O contrato e independente de Electron IPC. Nenhum consumidor deve depender de
`window.chatAggregator`, dos objetos internos do `chat-hub` ou do formato do
arquivo local `config.json`.

## Objetivos

- permitir renderizar player, chat combinado, status e viewers;
- distinguir plataforma de canal/streamer de origem;
- manter payloads publicos estaveis enquanto a implementacao interna evolui;
- permitir substituir o gateway local por um backend do MarketBubble;
- impedir exposicao acidental de credenciais ou detalhes internos.

## Escopo da versao 1

O protocolo v1 e:

- somente leitura;
- orientado a snapshot inicial e eventos incrementais;
- preparado para multiplas origens, mesmo enquanto o app suporta apenas uma
  origem por plataforma;
- sem historico de chat;
- sem comandos de moderacao ou envio de mensagens;
- sem autenticacao de espectadores.

## Convencoes

- Datas usam strings ISO 8601 em UTC.
- IDs sao strings opacas e devem ser comparados exatamente.
- Campos nao disponiveis sao omitidos. Nao usar string vazia como ausencia.
- `null` nao deve ser enviado, exceto se uma versao futura definir isso
  explicitamente.
- Consumidores devem ignorar campos desconhecidos.
- Novos campos opcionais podem ser adicionados sem alterar a versao principal.
- Remover campos ou mudar seu significado exige uma nova versao principal.

## Identidade de origem

`platform` identifica a plataforma tecnica. `sourceId` identifica uma instancia
de canal ou transmissao configurada no Collector.

Enquanto existir apenas uma origem por plataforma, o `sourceId` recomendado e:

```text
twitch:monstercat
kick:xqc
x:chooserich
```

O `sourceId` deve continuar estavel durante a sessao. Consumidores nao devem
derivar regras de negocio analisando seu texto.

Objeto publico de origem:

```json
{
  "sourceId": "twitch:monstercat",
  "platform": "twitch",
  "broadcasterName": "Monstercat",
  "channelLabel": "monstercat"
}
```

Campos:

| Campo | Obrigatorio | Descricao |
| --- | --- | --- |
| `sourceId` | sim | Identificador opaco da origem configurada. |
| `platform` | sim | Provider tecnico, inicialmente `twitch`, `kick` ou `x`. |
| `broadcasterName` | nao | Nome adequado para exibicao. |
| `channelLabel` | nao | Handle, slug ou label curta do canal. |

## Envelope de evento

Todo evento em tempo real usa o mesmo envelope:

```json
{
  "protocolVersion": "1",
  "type": "chat.message",
  "eventId": "01JXYZ...",
  "emittedAt": "2026-06-06T19:30:00.000Z",
  "data": {}
}
```

| Campo | Obrigatorio | Descricao |
| --- | --- | --- |
| `protocolVersion` | sim | Versao principal como string. Para este documento, `1`. |
| `type` | sim | Tipo do evento. |
| `eventId` | sim | ID unico usado para deduplicacao. |
| `emittedAt` | sim | Momento em que o gateway publicou o evento. |
| `data` | sim | Payload correspondente ao tipo. |

Tipos v1:

- `snapshot.replace`;
- `chat.message`;
- `source.status`;
- `viewers.update`;
- `manifest.update`.

## Snapshot inicial

O consumidor deve obter ou receber um snapshot completo antes de aplicar
eventos incrementais:

```json
{
  "protocolVersion": "1",
  "generatedAt": "2026-06-06T19:30:00.000Z",
  "manifest": {
    "title": "MarketBubble Live",
    "sources": []
  },
  "statuses": [],
  "viewers": {
    "sources": [],
    "total": 0
  }
}
```

O snapshot nao inclui mensagens anteriores. O chat comeca vazio e recebe apenas
novas mensagens depois da conexao.

`snapshot.replace` carrega esse mesmo objeto em `data` e substitui todo o estado
publico anterior. Ele deve ser usado apos reconexao ou mudanca estrutural.

## Manifesto publico

O manifesto descreve o que o Viewer Mode pode exibir. Ele nao e a configuracao
interna do Collector.

Exemplos versionados ficam em `docs/examples/viewer-manifest-demo.json` e
`docs/examples/viewer-manifest-marketbubble.json`.

```json
{
  "title": "MarketBubble Live",
  "sources": [
    {
      "sourceId": "twitch:monstercat",
      "platform": "twitch",
      "broadcasterName": "Monstercat",
      "channelLabel": "monstercat",
      "watchUrl": "https://www.twitch.tv/monstercat",
      "player": {
        "provider": "twitch",
        "channel": "monstercat"
      }
    }
  ]
}
```

Campos de uma source no manifesto:

| Campo | Obrigatorio | Descricao |
| --- | --- | --- |
| campos de identidade de origem | sim | Conforme secao anterior. |
| `watchUrl` | nao | URL publica para abrir a live na plataforma. Pode existir mesmo quando nao ha embed aprovado. |
| `player` | nao | Configuracao publica para um adaptador de player suportado. |

`player` e uma estrutura discriminada por `provider`. No v1, somente o formato
Twitch e aprovado:

```json
{
  "provider": "twitch",
  "channel": "monstercat"
}
```

O dominio `parent` exigido pelo embed Twitch pertence ao ambiente que hospeda o
Viewer Mode e nao deve ser confiado ao Collector.

`manifest.update` carrega o manifesto completo em `data` e substitui o manifesto
anterior.

## Evento de chat

`chat.message` publica uma mensagem normalizada e segura para exibicao:

```json
{
  "protocolVersion": "1",
  "type": "chat.message",
  "eventId": "01JXYZ...",
  "emittedAt": "2026-06-06T19:30:00.000Z",
  "data": {
    "id": "message-1",
    "source": {
      "sourceId": "twitch:monstercat",
      "platform": "twitch",
      "broadcasterName": "Monstercat",
      "channelLabel": "monstercat"
    },
    "author": {
      "id": "author-1",
      "name": "Ana",
      "badges": []
    },
    "text": "Hello chat",
    "timestamp": "2026-06-06T19:29:59.000Z",
    "fragments": [
      {
        "type": "text",
        "text": "Hello chat"
      }
    ]
  }
}
```

Campos publicos da mensagem:

| Campo | Obrigatorio | Descricao |
| --- | --- | --- |
| `id` | sim | ID da mensagem dentro da origem. |
| `source` | sim | Identidade da origem. |
| `author` | sim | Autor publico da mensagem. |
| `text` | sim | Texto completo para fallback e acessibilidade. |
| `timestamp` | sim | Timestamp informado ou inferido pelo Collector. |
| `avatarUrl` | nao | Avatar associado a mensagem quando aplicavel. |
| `fragments` | nao | Fragmentos estruturados para texto e emotes. |

Autor:

```json
{
  "id": "author-1",
  "name": "Ana",
  "avatarUrl": "https://example.test/avatar.png",
  "badges": [
    {
      "id": "moderator",
      "label": "Mod",
      "version": "1",
      "imageUrl": "https://example.test/mod.png"
    }
  ]
}
```

Fragmento:

```json
{
  "type": "emote",
  "id": "25",
  "text": "Kappa",
  "imageUrl": "https://example.test/emote.png"
}
```

O campo interno `raw` nunca faz parte da mensagem publica.

## Evento de status

`source.status` substitui o status publico de uma origem:

```json
{
  "protocolVersion": "1",
  "type": "source.status",
  "eventId": "01JXYZ...",
  "emittedAt": "2026-06-06T19:30:00.000Z",
  "data": {
    "source": {
      "sourceId": "twitch:monstercat",
      "platform": "twitch",
      "broadcasterName": "Monstercat",
      "channelLabel": "monstercat"
    },
    "state": "connected",
    "messageCount": 42,
    "lastMessageAt": "2026-06-06T19:29:59.000Z",
    "updatedAt": "2026-06-06T19:30:00.000Z"
  }
}
```

Estados v1:

- `disabled`;
- `idle`;
- `connecting`;
- `connected`;
- `observing`;
- `disconnected`;
- `error`.

Um status pode incluir `notice`, uma mensagem sanitizada e adequada ao
espectador. Erros brutos, detalhes de captura, URLs internas e identidades
autenticadas nao devem ser publicados.

O array `statuses` do snapshot usa os objetos contidos em `data`, sem envelope.

## Evento de viewers

`viewers.update` substitui todo o snapshot publico de viewers:

```json
{
  "protocolVersion": "1",
  "type": "viewers.update",
  "eventId": "01JXYZ...",
  "emittedAt": "2026-06-06T19:30:00.000Z",
  "data": {
    "sources": [
      {
        "source": {
          "sourceId": "twitch:monstercat",
          "platform": "twitch",
          "broadcasterName": "Monstercat",
          "channelLabel": "monstercat"
        },
        "state": "available",
        "count": 1234,
        "updatedAt": "2026-06-06T19:30:00.000Z"
      }
    ],
    "total": 1234
  }
}
```

Estados de viewers v1:

- `available`;
- `unavailable`;
- `disabled`.

Regras:

- `count` e inteiro nao negativo e so aparece quando `state` e `available`;
- `total` soma somente contagens atualmente disponiveis;
- uma origem indisponivel nao transforma o total inteiro em indisponivel;
- o consumidor pode mostrar `notice` sanitizado quando fornecido;
- erros brutos de API nao devem ser publicados.

O objeto `viewers` do snapshot usa o mesmo formato de `data`.

## Ordenacao, deduplicacao e reconexao

- Eventos devem ser aplicados na ordem recebida por uma conexao.
- `eventId` permite ignorar eventos repetidos apos reconexao.
- `chat.message.data.id` nao e globalmente unico; a chave logica e a combinacao
  de `source.sourceId` e `id`.
- `source.status`, `viewers.update` e `manifest.update` substituem o estado
  anterior correspondente.
- Ao perder a conexao, o consumidor deve obter um novo snapshot antes de voltar
  a aplicar eventos.
- Como nao existe historico no v1, mensagens ocorridas durante a desconexao
  podem ser perdidas.

## Allowlist publica e dados proibidos

Serializadores futuros devem construir payloads novos por allowlist. Eles nao
devem espalhar objetos internos e remover alguns campos depois.

Dados proibidos em qualquer payload publico:

- Twitch access token;
- Kick access token e refresh token;
- Kick Client Secret;
- cookies e dados da sessao X;
- OAuth state, authorization code ou PKCE verifier;
- caminho local de configuracao;
- valores de environment overrides;
- config interna completa;
- campo `raw` das mensagens;
- stack traces;
- URLs internas de OAuth broker;
- detalhes internos de captura ou seletores DOM;
- identidade da conta autenticada quando ela nao for a origem publica da live.

## Transporte previsto

Este protocolo nao exige uma tecnologia especifica, mas a primeira
implementacao planejada usa:

- `GET /api/v1/snapshot` para bootstrap;
- WebSocket local para eventos incrementais;
- bind somente em `127.0.0.1`;
- sem endpoints de escrita.

Uma implementacao hospedada pode usar outras URLs e autenticacao, desde que
preserve os payloads definidos aqui.

## Relacao com o codigo atual

O contrato descreve o alvo publico. Nem todos os campos existem hoje:

- `source` ja existe como campo opcional no modelo canonico e o `chat-hub`
  preenche sua identidade a partir do connector atual;
- labels visuais de origem ja aparecem no dashboard Electron;
- serializadores por allowlist para source, mensagens, status, viewers e
  snapshot ja existem;
- snapshot HTTP local esta disponivel em `GET /api/v1/snapshot`;
- envelopes e eventos WebSocket locais estao disponiveis em
  `ws://127.0.0.1:47831/api/v1/events`;
- manifesto, player Twitch e watch links externos ja sao publicados para o
  Viewer Mode local;
- manifesto publico ja possui normalizacao/validacao separada da config interna;
- transporte substituivel continua planejado para a Fase D.

O snapshot interno atual de `src/main.js` nao atende este contrato e nao deve ser
publicado diretamente.

## Checklist de conformidade v1

Antes de considerar um produtor compativel:

- publica somente campos definidos ou extensoes opcionais documentadas;
- nunca inclui dados proibidos;
- fornece `sourceId` em mensagens, status e viewers;
- fornece snapshot antes dos eventos incrementais;
- usa envelopes com `protocolVersion`, `eventId` e `emittedAt`;
- sanitiza notices destinados ao espectador;
- suporta reconexao com novo snapshot;
- nao oferece escrita ou moderacao no mesmo canal publico.
