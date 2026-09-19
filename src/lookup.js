// Busca de metadados sem nenhuma chave de API:
//   - Jikan (API pública do MyAnimeList) para título, capa, sinopse e mal_id;
//   - Wikidata para converter o mal_id no ID do IMDb.
//
// Tudo aqui é "melhor esforço": se a rede falhar ou o anime não estiver mapeado,
// o app segue funcionando e os IDs continuam editáveis à mão no modal.

const JIKAN = 'https://api.jikan.moe/v4/anime';
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
 * Busca animes por título no Jikan.
 *
 * Se algum filtro opcional for recusado (4xx), tenta de novo só com `q` e
 * `limit` — o mínimo que a API sempre aceita — em vez de desistir.
 *
 * @returns {Promise<Array>} lista normalizada (vazia se nada for encontrado)
 * @throws {Error} com `code` 'abortado' | 'tempo' | 'rate-limit' | 'http' | 'rede'
 *                 e `detalhe` com o que deu errado de fato
 */
export async function buscarAnimes(termo, sinalExterno) {
  const q = termo.trim();
  if (q.length < 2) return [];

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
    return Array.isArray(json.data) ? json.data.map(normalizar) : [];
  } catch (erro) {
    throw classificar(erro, sinalExterno);
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
