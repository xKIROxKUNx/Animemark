import Sortable from 'sortablejs';

import { nomeDoMembro } from '../auth.js';
import { definirAssistido, reordenarAnime } from '../animes.js';
import { toastErro, toast } from './toast.js';

let sortable = null;
let arrastando = false;
let ultimoEstado = { animes: [], membros: new Map(), uid: null };
let aoAbrirDetalhe = () => {};

const lista = () => document.getElementById('anime-list');
const vazio = () => document.getElementById('list-empty');

function metaDoAnime(a) {
  const partes = [];
  if (a.year) partes.push(String(a.year));
  if (a.type) partes.push(a.type);
  if (a.episodes) partes.push(`${a.episodes} ep.`);
  return partes.join(' · ');
}

function cardDe(anime, membros) {
  const li = document.createElement('li');
  li.className = 'card-item';
  li.dataset.id = anime.id;
  li.dataset.watched = anime.watched ? '1' : '0';
  if (anime.watched) li.classList.add('card-item--assistido');

  const corpo = document.createElement('button');
  corpo.type = 'button';
  corpo.className = 'card-item__body';
  corpo.setAttribute('aria-label', `Ver detalhes de ${anime.title}`);

  const capa = document.createElement('div');
  capa.className = 'card-item__cover';
  if (anime.imageUrl) {
    const img = document.createElement('img');
    img.src = anime.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // Capa quebrada não deve deixar um ícone de imagem partida no card.
    img.addEventListener('error', () => img.remove(), { once: true });
    capa.append(img);
  }
  corpo.append(capa);

  const texto = document.createElement('div');
  texto.className = 'card-item__text';

  const titulo = document.createElement('p');
  titulo.className = 'card-item__title';
  titulo.textContent = anime.title;
  texto.append(titulo);

  const meta = metaDoAnime(anime);
  if (meta) {
    const p = document.createElement('p');
    p.className = 'card-item__meta';
    p.textContent = meta;
    texto.append(p);
  }

  const autor = document.createElement('p');
  autor.className = 'card-item__author';
  autor.textContent = `adicionado por ${nomeDoMembro(membros, anime.addedBy, anime.addedByName)}`;
  texto.append(autor);

  corpo.append(texto);
  corpo.addEventListener('click', () => aoAbrirDetalhe(anime.id));
  li.append(corpo);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'card-item__check';
  toggle.dataset.action = 'toggle-watched';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', anime.watched ? 'true' : 'false');
  toggle.setAttribute(
    'aria-label',
    anime.watched ? `Marcar ${anime.title} como não assistido` : `Marcar ${anime.title} como assistido`
  );
  toggle.title = anime.watched ? 'Marcar como não assistido' : 'Marcar como assistido';
  toggle.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  li.append(toggle);

  return li;
}

function divisor() {
  const li = document.createElement('li');
  li.className = 'list-divider';
  li.dataset.divider = '1';
  li.textContent = 'Assistidos';
  return li;
}

export function renderizarLista(animes, membros, uid) {
  ultimoEstado = { animes, membros, uid };
  // Reescrever a lista no meio de um arrasto cancelaria o gesto; o snapshot
  // seguinte (logo após o drop) redesenha tudo.
  if (arrastando) return;

  const ul = lista();
  ul.textContent = '';

  let divisorInserido = false;
  for (const anime of animes) {
    if (anime.watched && !divisorInserido) {
      ul.append(divisor());
      divisorInserido = true;
    }
    ul.append(cardDe(anime, membros));
  }

  vazio().hidden = animes.length > 0;
}

/**
 * Vizinho imediato dentro do mesmo grupo. O divisor e qualquer card do outro
 * grupo contam como "fim da lista", devolvendo null.
 */
function vizinho(el, direcao) {
  const irmao = direcao === 'anterior' ? el.previousElementSibling : el.nextElementSibling;
  if (!irmao || irmao.dataset.divider) return null;
  return irmao.dataset.watched === el.dataset.watched ? irmao : null;
}

const chaveDe = (el) =>
  el ? (ultimoEstado.animes.find((a) => a.id === el.dataset.id)?.order ?? null) : null;

async function aoSoltar(evt) {
  if (evt.oldIndex === evt.newIndex) return;

  const el = evt.item;
  const anterior = chaveDe(vizinho(el, 'anterior'));
  const seguinte = chaveDe(vizinho(el, 'proximo'));

  try {
    // O snapshot otimista do Firestore chega quase junto e redesenha a lista
    // na ordem nova; só precisamos tratar a falha.
    await reordenarAnime(el.dataset.id, anterior, seguinte);
  } catch (erro) {
    console.error(erro);
    toastErro('Não foi possível salvar a nova ordem.');
    renderizarLista(ultimoEstado.animes, ultimoEstado.membros, ultimoEstado.uid);
  }
}

async function alternarAssistido(id) {
  const anime = ultimoEstado.animes.find((a) => a.id === id);
  if (!anime) return;

  const virandoAssistido = !anime.watched;
  try {
    await definirAssistido(id, virandoAssistido, ultimoEstado.animes, ultimoEstado.uid);
    toast(virandoAssistido ? `"${anime.title}" foi para os assistidos.` : `"${anime.title}" voltou para a fila.`, {
      acao: 'Desfazer',
      aoAgir: async () => {
        try {
          await definirAssistido(id, !virandoAssistido, ultimoEstado.animes, ultimoEstado.uid);
        } catch (erro) {
          console.error(erro);
          toastErro('Não foi possível desfazer.');
        }
      },
    });
  } catch (erro) {
    console.error(erro);
    toastErro('Não foi possível salvar.');
  }
}

export function iniciarLista({ aoAbrirDetalhe: abrir }) {
  aoAbrirDetalhe = abrir;
  const ul = lista();

  ul.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action="toggle-watched"]');
    if (!btn) return;
    const id = btn.closest('.card-item')?.dataset.id;
    if (id) alternarAssistido(id);
  });

  sortable = Sortable.create(ul, {
    draggable: '.card-item',
    filter: '.card-item__check',
    // No celular o toque curto abre o modal e a rolagem continua normal; só o
    // toque-e-segura inicia o arrasto.
    delay: 220,
    delayOnTouchOnly: true,
    touchStartThreshold: 6,
    animation: 160,
    ghostClass: 'card-item--ghost',
    chosenClass: 'card-item--escolhido',
    // O fallback usa eventos de ponteiro em vez do drag-and-drop nativo do
    // HTML5: é o mesmo caminho de código no desktop e no celular (e o único
    // que dá para testar de forma confiável).
    forceFallback: true,
    fallbackOnBody: true,
    // Arrastar nunca marca nem desmarca: um item não pode cruzar o divisor.
    onMove: (evt) =>
      !evt.related?.dataset?.divider && evt.related?.dataset?.watched === evt.dragged?.dataset?.watched,
    onStart: () => {
      arrastando = true;
    },
    onEnd: (evt) => {
      arrastando = false;
      aoSoltar(evt);
    },
  });

  return sortable;
}

export const estadoAtual = () => ultimoEstado;
