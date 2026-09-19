import { adicionarAnime, atualizarAnime } from '../animes.js';
import { buscarAnimes, buscarImdbId } from '../lookup.js';
import { abrirModal, fecharModal } from './modal.js';
import { toast, toastErro } from './toast.js';

const DEBOUNCE_MS = 500;

function mensagemDeErro(erro) {
  switch (erro.code) {
    case 'rate-limit':
      return 'Muitas buscas seguidas. Espere um instante e tente de novo.';
    case 'tempo':
      return 'A busca demorou demais para responder. Tente de novo.';
    case 'http':
      return `O MyAnimeList respondeu com erro (${erro.detalhe}). Tente de novo em instantes ou adicione manualmente.`;
    default:
      return 'Não consegui falar com api.jikan.moe — sua rede pode estar bloqueando o site. Adicione manualmente por enquanto.';
  }
}

function resultadoEl(item, aoEscolher) {
  const li = document.createElement('li');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'resultado';

  const capa = document.createElement('div');
  capa.className = 'resultado__cover';
  if (item.thumbUrl) {
    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove(), { once: true });
    capa.append(img);
  }
  btn.append(capa);

  const texto = document.createElement('div');
  texto.className = 'resultado__text';

  const titulo = document.createElement('p');
  titulo.className = 'resultado__title';
  titulo.textContent = item.title;
  texto.append(titulo);

  const meta = [item.year, item.type, item.episodes ? `${item.episodes} ep.` : null]
    .filter(Boolean)
    .join(' · ');
  if (meta) {
    const p = document.createElement('p');
    p.className = 'resultado__meta';
    p.textContent = meta;
    texto.append(p);
  }

  btn.append(texto);
  btn.addEventListener('click', () => aoEscolher(item));
  li.append(btn);
  return li;
}

/**
 * Grava o anime e, em segundo plano, tenta descobrir o ID do IMDb.
 * O documento já nasce utilizável mesmo se o Wikidata não responder.
 */
async function salvar(item, sessao, animes) {
  const ref = await adicionarAnime(item, sessao, animes);

  if (item.malId && !item.imdbId) {
    buscarImdbId(item.malId)
      .then((imdbId) => (imdbId ? atualizarAnime(ref.id, { imdbId }) : null))
      .catch((erro) => console.warn('IMDb não encontrado:', erro));
  }

  return ref;
}

export function abrirAdicionar(sessao, obterAnimes) {
  let controlador = null;
  let timer = null;

  const corpo = document.createElement('div');
  corpo.className = 'add-sheet';
  corpo.innerHTML = `
    <label class="field">
      <span>Buscar anime</span>
      <input type="search" id="add-query" placeholder="Ex.: Frieren" autocomplete="off"
             enterkeyhint="search" autocapitalize="off" spellcheck="false" />
    </label>
    <p class="add-sheet__status" id="add-status">Digite o nome do anime para buscar no MyAnimeList.</p>
    <ul class="resultados" id="add-results"></ul>
    <button class="btn btn--link" type="button" id="add-manual">Não achei — adicionar manualmente</button>
  `;

  const { fechar } = abrirModal({
    titulo: 'Adicionar anime',
    corpo,
    aoFechar: () => {
      clearTimeout(timer);
      controlador?.abort();
    },
  });

  const input = corpo.querySelector('#add-query');
  const status = corpo.querySelector('#add-status');
  const resultados = corpo.querySelector('#add-results');

  const escolher = async (item) => {
    fechar();
    try {
      await salvar(item, sessao, obterAnimes());
      toast(`"${item.title}" entrou na lista.`);
    } catch (erro) {
      console.error(erro);
      toastErro('Não foi possível adicionar o anime.');
    }
  };

  const buscar = async (termo) => {
    controlador?.abort();
    controlador = new AbortController();

    resultados.textContent = '';
    if (termo.trim().length < 2) {
      status.textContent = 'Digite pelo menos 2 letras.';
      return;
    }

    status.textContent = 'Buscando…';
    try {
      const itens = await buscarAnimes(termo, controlador.signal);
      status.textContent = itens.length ? '' : 'Nenhum anime encontrado com esse nome.';
      for (const item of itens) resultados.append(resultadoEl(item, escolher));
    } catch (erro) {
      if (erro.code === 'abortado') return;
      status.textContent = mensagemDeErro(erro);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    // O Jikan limita a 3 requisições por segundo; o debounce evita estourar
    // isso enquanto a pessoa ainda está digitando.
    timer = setTimeout(() => buscar(input.value), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      clearTimeout(timer);
      buscar(input.value);
    }
  });

  corpo.querySelector('#add-manual').addEventListener('click', () => {
    const titulo = input.value.trim();
    if (titulo.length < 1) {
      status.textContent = 'Escreva o nome do anime antes de adicionar manualmente.';
      input.focus();
      return;
    }
    escolher({ title: titulo, genres: [] });
  });

  setTimeout(() => input.focus(), 50);
}

export { fecharModal };
