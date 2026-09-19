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
 * A ordenação é (watched, order, createdAt):
 *  - `watched` vem primeiro e em Firestore `false` < `true`, então os
 *    assistidos ficam sempre no fim, mesmo depois de adicionar animes novos;
 *  - `order` é um índice fracionário (string), o que faz cada reordenação
 *    custar UMA escrita em vez de renumerar a lista inteira;
 *  - `createdAt` só desempata caso duas chaves iguais apareçam por corrida.
 */
export function observarAnimes(aoMudar, aoFalhar) {
  const q = query(
    collection(db, ANIMES),
    orderBy('watched'),
    orderBy('order'),
    orderBy('createdAt')
  );

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

const ultimaChave = (animes, assistido) => {
  const grupo = animes.filter((a) => Boolean(a.watched) === assistido);
  return grupo.length ? grupo[grupo.length - 1].order : null;
};

/** Chave para um item novo: entra no fim do grupo "para assistir". */
export function chaveNoFim(animes, assistido = false) {
  return chaveEntre(ultimaChave(animes, assistido), null);
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
 * Reposiciona um anime entre dois vizinhos (ambos do mesmo grupo).
 * @param {string|null} chaveAnterior chave do item que ficará acima
 * @param {string|null} chaveSeguinte chave do item que ficará abaixo
 */
export function reordenarAnime(id, chaveAnterior, chaveSeguinte) {
  return updateDoc(doc(db, ANIMES, id), {
    order: chaveEntre(chaveAnterior, chaveSeguinte),
  });
}
