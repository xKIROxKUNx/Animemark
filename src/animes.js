import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { generateKeyBetween } from 'fractional-indexing';

import { db } from './firebase.js';

const ANIMES = 'animes';

/**
 * `order` é um índice fracionário (string) com o grupo embutido no primeiro
 * caractere: '0' para "a assistir" e '1' para "assistido".
 *
 * Isso resolve duas coisas de uma vez. Os assistidos ficam sempre no fim,
 * inclusive depois de adicionar animes novos ('0…' < '1…'), e a lista inteira
 * sai com um ÚNICO `orderBy('order')` — que o Firestore atende com o índice
 * automático de campo simples. Sem índice composto para configurar, sem espera
 * de construção e sem o erro `failed-precondition` em projeto novo.
 *
 * Reordenar continua custando uma única escrita: só a chave do item movido
 * muda, nunca a lista inteira.
 */
const prefixoDe = (assistido) => (assistido ? '1' : '0');
const semPrefixo = (chave) => (typeof chave === 'string' && chave.length > 1 ? chave.slice(1) : null);

export function observarAnimes(aoMudar, aoFalhar) {
  const q = query(collection(db, ANIMES), orderBy('order'));

  return onSnapshot(
    q,
    (snap) => {
      const animes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      aoMudar(animes, { doCache: snap.metadata.fromCache, pendente: snap.metadata.hasPendingWrites });
    },
    aoFalhar
  );
}

/**
 * `generateKeyBetween` lança se as chaves vizinhas não forem estritamente
 * crescentes (acontece se duas clientes inserirem no mesmo ponto ao mesmo
 * tempo). Nesse caso degradamos para "depois de a" / "antes de b" em vez de
 * quebrar o arrastar; a colisão se resolve sozinha no movimento seguinte.
 */
function chaveEntre(a, b) {
  try {
    return generateKeyBetween(a ?? null, b ?? null);
  } catch {
    try {
      return generateKeyBetween(a ?? null, null);
    } catch {
      return generateKeyBetween(null, b ?? null);
    }
  }
}

/** Chave que coloca o item no fim do grupo indicado. */
export function chaveNoFim(animes, assistido = false) {
  const grupo = animes.filter((a) => Boolean(a.watched) === assistido);
  const ultima = grupo.length ? semPrefixo(grupo[grupo.length - 1].order) : null;
  return prefixoDe(assistido) + chaveEntre(ultima, null);
}

export function adicionarAnime(dados, { uid, apelido }, animes) {
  return addDoc(collection(db, ANIMES), {
    title: dados.title,
    titleEnglish: dados.titleEnglish ?? null,
    malId: dados.malId ?? null,
    imdbId: dados.imdbId ?? null,
    imageUrl: dados.imageUrl ?? null,
    synopsis: dados.synopsis ?? null,
    year: dados.year ?? null,
    episodes: dados.episodes ?? null,
    score: dados.score ?? null,
    type: dados.type ?? null,
    status: dados.status ?? null,
    genres: dados.genres ?? [],
    addedBy: uid,
    addedByName: apelido,
    watched: false,
    watchedAt: null,
    watchedBy: null,
    createdAt: serverTimestamp(),
    order: chaveNoFim(animes, false),
  });
}

export function removerAnime(id) {
  return deleteDoc(doc(db, ANIMES, id));
}

export function atualizarAnime(id, campos) {
  return updateDoc(doc(db, ANIMES, id), campos);
}

/**
 * Marca/desmarca como assistido. O item sempre vai para o fim do grupo de
 * destino, então "assistido" cai no fim da lista e "desmarcar" devolve o anime
 * para o fim da fila de pendentes.
 */
export function definirAssistido(id, assistido, animes, uid) {
  return updateDoc(doc(db, ANIMES, id), {
    watched: assistido,
    watchedAt: assistido ? serverTimestamp() : null,
    watchedBy: assistido ? uid : null,
    order: chaveNoFim(animes, assistido),
  });
}

/**
 * Reposiciona um anime entre dois vizinhos do mesmo grupo.
 * @param {string|null} chaveAnterior chave do item que ficará acima
 * @param {string|null} chaveSeguinte chave do item que ficará abaixo
 * @param {boolean} assistido grupo do item movido (define o prefixo)
 */
export function reordenarAnime(id, chaveAnterior, chaveSeguinte, assistido) {
  return updateDoc(doc(db, ANIMES, id), {
    order: prefixoDe(assistido) + chaveEntre(semPrefixo(chaveAnterior), semPrefixo(chaveSeguinte)),
  });
}
