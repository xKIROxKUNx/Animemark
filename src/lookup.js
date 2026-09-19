// Busca de metadados sem nenhuma chave de API:
//   - Jikan (API pública do MyAnimeList) para título, capa, sinopse e mal_id;
//   - AniList como reserva quando o Jikan falha (ele também devolve o idMal,
//     então o ID do MyAnimeList continua vindo mesmo com o MAL fora do ar);
//   - Wikidata para converter o mal_id no ID do IMDb.
//
// Tudo aqui é "melhor esforço": se a rede falhar ou o anime não estiver mapeado,
// o app segue funcionando e os IDs continuam editáveis à mão no modal.

const JIKAN = 'https://api.jikan.moe/v4/anime';
const ANILIST = 'https://graphql.anilist.co';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const TIMEOUT_MS = 10000;

function comTimeout(sinalExterno) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (sinalExterno) {
    if (sinalExterno.aborted) ctrl.abort();
    else sinalExterno.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return { sinal: ctrl.signal, limpar: () => clearTimeout(timer) };
}

function anoDe(item) {
  return item.year ?? item.aired?.prop?.from?.year ?? null;
}

function normalizar(item) {
  return {
    malId: item.mal_id ?? null,
    title: item.title ?? item.title_english ?? 'Sem título',
    titleEnglish: item.title_english ?? null,
    imageUrl: item.images?.jpg?.large_image_url ?? item.images?.jpg?.image_url ?? null,
    thumbUrl: item.images?.jpg?.image_url ?? item.images?.jpg?.small_image_url ?? null,
    synopsis: item.synopsis ?? null,
    year: anoDe(item),
    episodes: item.episodes ?? null,
    score: item.score ?? null,
    type: item.type ?? null,
    status: item.status ?? null,
    genres: Array.isArray(item.genres) ? item.genres.map((g) => g.name).filter(Boolean) : [],
  };
}

// O AniList usa vocabulário próprio; traduzimos para o mesmo do MyAnimeList
// para que o card não mude de linguagem conforme a fonte que respondeu.
const FORMATO_ANILIST = {
  TV: 'TV',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
};

const SITUACAO_ANILIST = {
  FINISHED: 'Finished Airing',
  RELEASING: 'Currently Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
};

/**
 * A sinopse do AniList vem com marcação HTML. Nunca a inserimos como HTML
 * (o app usa textContent), então aqui é só para não exibir as tags cruas.
 */
function limparHtml(texto) {
  if (typeof texto !== 'string') return null;
  const limpo = texto
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return limpo || null;
}

function normalizarAniList(m) {
  return {
    malId: m.idMal ?? null,
    title: m.title?.romaji ?? m.title?.english ?? 'Sem título',
    titleEnglish: m.title?.english ?? null,
    imageUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    thumbUrl: m.coverImage?.large ?? m.coverImage?.medium ?? null,
    synopsis: limparHtml(m.description),
    year: m.seasonYear ?? m.startDate?.year ?? null,
    episodes: m.episodes ?? null,
    // averageScore é 0-100 no AniList e 0-10 no MAL.
    score: typeof m.averageScore === 'number' ? Math.round(m.averageScore) / 10 : null,
    type: FORMATO_ANILIST[m.format] ?? m.format ?? null,
    status: SITUACAO_ANILIST[m.status] ?? m.status ?? null,
    genres: Array.isArray(m.genres) ? m.genres : [],
  };
}

const CONSULTA_ANILIST = `query ($q: String) {
  Page(perPage: 10) {
    media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
      idMal
      title { romaji english }
      coverImage { extraLarge large medium }
      description(asHtml: false)
      seasonYear
      startDate { year }
      episodes
      averageScore
      format
      status
      genres
    }
  }
}`;

async function buscarNoAniList(q, sinal) {
  const resp = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: CONSULTA_ANILIST, variables: { q } }),
    signal: sinal,
  });
  if (!resp.ok) {
    const e = new Error(`HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  const json = await resp.json();
  const lista = json?.data?.Page?.media;
  return Array.isArray(lista) ? lista.map(normalizarAniList) : [];
}

/** Monta a URL da busca. `completa` liga os filtros opcionais do Jikan. */
function urlBusca(q, completa) {
  const params = new URLSearchParams({ q, limit: '10' });
  if (completa) {
    params.set('sfw', 'true');
    params.set('order_by', 'members');
    params.set('sort', 'desc');
  }
  return `${JIKAN}?${params}`;
}

async function pedir(url, sinal) {
  const resp = await fetch(url, { signal: sinal });
  if (!resp.ok) {
    const e = new Error(`HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

/**
 * Busca animes por título, com o Jikan como fonte principal e o AniList como
 * reserva.
 *
 * Duas camadas de tolerância a falha, aprendidas na prática:
 *  - se o Jikan recusar os filtros opcionais (4xx), refaz com o mínimo;
 *  - se o Jikan falhar de vez (o 504 "MyAnimeList may be down" é comum),
 *    cai para o AniList, que também devolve o `idMal`.
 *
 * @returns {Promise<{itens: Array, fonte: 'MyAnimeList'|'AniList'}>}
 * @throws {Error} com `code` 'abortado' | 'tempo' | 'rate-limit' | 'http' | 'rede'
 */
export async function buscarAnimes(termo, sinalExterno) {
  const q = termo.trim();
  if (q.length < 2) return { itens: [], fonte: 'MyAnimeList' };

  const { sinal, limpar } = comTimeout(sinalExterno);

  try {
    let json;
    try {
      json = await pedir(urlBusca(q, true), sinal);
    } catch (erro) {
      if (erro.status && erro.status !== 429 && erro.status < 500) {
        console.warn(`Jikan recusou os filtros (${erro.message}); tentando sem eles.`);
        json = await pedir(urlBusca(q, false), sinal);
      } else {
        throw erro;
      }
    }
    const itens = Array.isArray(json.data) ? json.data.map(normalizar) : [];
    return { itens, fonte: 'MyAnimeList' };
  } catch (erroJikan) {
    const classificado = classificar(erroJikan, sinalExterno);
    // Cancelamento e tempo esgotado não são problema do Jikan: não adianta
    // perguntar ao AniList.
    if (classificado.code === 'abortado' || classificado.code === 'tempo') throw classificado;

    try {
      console.warn('Jikan indisponível; tentando o AniList.');
      return { itens: await buscarNoAniList(q, sinal), fonte: 'AniList' };
    } catch (erroAniList) {
      const reserva = classificar(erroAniList, sinalExterno);
      if (reserva.code === 'abortado') throw reserva;
      // As duas fontes caíram: o erro do Jikan é o mais informativo.
      throw classificado;
    }
  } finally {
    limpar();
  }
}

/**
 * Traduz a falha para algo acionável. A diferença entre "a rede não chegou lá"
 * e "a API respondeu com erro" muda completamente o que a pessoa deve fazer.
 */
function classificar(erro, sinalExterno) {
  const e = new Error(erro.message);

  if (erro.name === 'AbortError') {
    // Abortamos por duas razões: busca nova substituindo a anterior, ou estouro
    // do tempo limite.
    e.code = sinalExterno?.aborted ? 'abortado' : 'tempo';
  } else if (erro.status === 429) {
    e.code = 'rate-limit';
  } else if (erro.status) {
    e.code = 'http';
    e.detalhe = `HTTP ${erro.status}`;
  } else {
    // fetch() só lança TypeError quando a requisição nem completou: DNS, TLS,
    // CORS, offline ou bloqueio na rede.
    e.code = 'rede';
    e.detalhe = erro.message;
  }

  console.error(`Busca no Jikan falhou [${e.code}]:`, erro);
  return e;
}

/**
 * Converte um mal_id no ID do IMDb via Wikidata (P4086 = MyAnimeList anime ID,
 * P345 = IMDb ID). A cobertura é boa em títulos conhecidos e falha em silêncio
 * no resto — nesse caso a pessoa preenche o campo à mão.
 * @returns {Promise<string|null>}
 */
export async function buscarImdbId(malId, sinalExterno) {
  if (!malId) return null;

  const sparql = `SELECT ?imdb WHERE { ?item wdt:P4086 "${String(malId)}" . ?item wdt:P345 ?imdb . } LIMIT 1`;
  const url = `${WIKIDATA}?format=json&query=${encodeURIComponent(sparql)}`;
  const { sinal, limpar } = comTimeout(sinalExterno);

  try {
    const resp = await fetch(url, { signal: sinal, headers: { Accept: 'application/sparql-results+json' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const valor = json?.results?.bindings?.[0]?.imdb?.value;
    return typeof valor === 'string' && /^tt\d+$/.test(valor) ? valor : null;
  } catch {
    return null;
  } finally {
    limpar();
  }
}

export const urlMal = (malId) => (malId ? `https://myanimelist.net/anime/${malId}` : null);
export const urlImdb = (imdbId) => (imdbId ? `https://www.imdb.com/title/${imdbId}/` : null);
