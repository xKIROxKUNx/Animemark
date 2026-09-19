# AnimeMark

PWA de lista compartilhada de animes para assistir, para duas pessoas.
Instalável no celular, funciona offline e sincroniza em tempo real pelo
Firestore.

👉 **Configuração passo a passo: [SETUP.md](SETUP.md)**

## O que ele faz

- **Um documento por anime** com nome, ID do MyAnimeList, ID do IMDb, capa e
  sinopse.
- **Busca automática dos metadados** ao adicionar: o título é procurado no
  [Jikan](https://jikan.moe) (API pública do MyAnimeList), com o
  [AniList](https://anilist.co) como reserva quando o Jikan cai — ele também
  devolve o `idMal`, então o ID do MyAnimeList continua vindo. O ID do IMDb sai
  do [Wikidata](https://query.wikidata.org). Nenhuma chave de API envolvida, e
  o que não for encontrado pode ser preenchido à mão.
- **Quem adicionou** fica registrado em cada anime, pelo apelido escolhido no
  login.
- **Ordem de criação** por padrão (mais antigo primeiro) e **reordenável**
  arrastando o card.
- **Marcar como assistido** risca o título e manda o anime para o fim da lista;
  dá para desmarcar ou remover de vez.
- **Offline**: a lista abre e aceita mudanças sem internet; tudo sincroniza
  quando a conexão volta.

## Como o acesso funciona

Não existe cadastro no app. As contas são criadas no Firebase Console e só
passam a valer quando existe um documento `members/{uid}` cujo campo `email`
é igual ao e-mail da conta. Sem isso, a pessoa entra e não enxerga nada — as
próprias regras do Firestore barram a leitura.

```
members/{uid}
  email    → precisa bater com o e-mail autenticado (só o Console escreve)
  nickname → a própria pessoa define no login
```

## Stack

Vite · JavaScript puro (sem framework) · Firebase v11 (Auth + Firestore) ·
vite-plugin-pwa (Workbox) · SortableJS · fractional-indexing

A reordenação usa [índices fracionários](https://observablehq.com/@dgreensp/implementing-fractional-indexing):
mover um card custa **uma** escrita, não uma renumeração da lista inteira. O
grupo (a assistir / assistido) vai embutido no primeiro caractere da chave, o
que mantém os assistidos no fim e deixa a lista inteira sair com um único
`orderBy('order')` — sem índice composto para configurar.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção em `dist/` |
| `npm run preview` | Serve o build |
| `npm run emulators` | Sobe os emuladores de Auth e Firestore |
| `npm run test:rules` | Testa as regras de segurança (precisa dos emuladores) |
| `npm run test:e2e` | Smoke test do app inteiro (precisa dos emuladores) |

## Testes

- **17 casos de regras** cobrindo a ativação por documento: conta sem ativação,
  e-mail divergente, imutabilidade do `email`, quem pode mudar qual apelido e
  o que pode ser gravado num anime.
- **20 verificações end-to-end** no Chromium contra os emuladores: login,
  escolha de apelido, busca, reordenação por arrastar, marcar/desmarcar como
  assistido, edição dos IDs, remoção, visão da segunda pessoa, a queda para o
  AniList quando o Jikan responde 504, e o registro do service worker. As APIs
  externas são interceptadas, então não depende de internet.

## Deploy

Push na `main` → GitHub Actions builda e publica em
<https://xkiroxkunx.github.io/Animemark/>.
