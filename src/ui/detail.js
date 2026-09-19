import { nomeDoMembro } from '../auth.js';
import { atualizarAnime, definirAssistido, removerAnime } from '../animes.js';
import { buscarImdbId, urlImdb, urlMal } from '../lookup.js';
import { abrirModal } from './modal.js';
import { toast, toastErro } from './toast.js';

function linha(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const dt = document.createElement('div');
  dt.className = 'info-row';
  dt.innerHTML = `<span class="info-row__label"></span><span class="info-row__value"></span>`;
  dt.querySelector('.info-row__label').textContent = rotulo;
  dt.querySelector('.info-row__value').textContent = valor;
  return dt;
}

function linkExterno(texto, href) {
  const a = document.createElement('a');
  a.className = 'pill-link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = texto;
  return a;
}

export function abrirDetalhe(anime, sessao, obterAnimes) {
  const corpo = document.createElement('div');
  corpo.className = 'detalhe';

  if (anime.imageUrl) {
    const capa = document.createElement('img');
    capa.className = 'detalhe__cover';
    capa.src = anime.imageUrl;
    capa.alt = `Capa de ${anime.title}`;
    capa.addEventListener('error', () => capa.remove(), { once: true });
    corpo.append(capa);
  }

  const titulo = document.createElement('h3');
  titulo.className = `detalhe__title${anime.watched ? ' riscado' : ''}`;
  titulo.textContent = anime.title;
  corpo.append(titulo);

  if (anime.titleEnglish && anime.titleEnglish !== anime.title) {
    const sub = document.createElement('p');
    sub.className = 'detalhe__subtitle';
    sub.textContent = anime.titleEnglish;
    corpo.append(sub);
  }

  const links = document.createElement('div');
  links.className = 'detalhe__links';
  if (anime.malId) links.append(linkExterno('MyAnimeList', urlMal(anime.malId)));
  if (anime.imdbId) links.append(linkExterno('IMDb', urlImdb(anime.imdbId)));
  if (links.childElementCount) corpo.append(links);

  if (anime.synopsis) {
    const sinopse = document.createElement('p');
    sinopse.className = 'detalhe__synopsis';
    sinopse.textContent = anime.synopsis;
    corpo.append(sinopse);
  }

  const infos = document.createElement('div');
  infos.className = 'detalhe__infos';
  for (const el of [
    linha('Tipo', anime.type),
    linha('Episódios', anime.episodes),
    linha('Ano', anime.year),
    linha('Nota no MAL', anime.score),
    linha('Situação', anime.status),
    linha('Gêneros', anime.genres?.length ? anime.genres.join(', ') : null),
    linha('Adicionado por', nomeDoMembro(sessao.membros, anime.addedBy, anime.addedByName)),
    anime.watched
      ? linha('Assistido por', nomeDoMembro(sessao.membros, anime.watchedBy, null))
      : null,
  ]) {
    if (el) infos.append(el);
  }
  if (infos.childElementCount) corpo.append(infos);

  // --- IDs editáveis ------------------------------------------------------
  const ids = document.createElement('div');
  ids.className = 'detalhe__ids';
  ids.innerHTML = `
    <label class="field field--inline">
      <span>ID do MAL</span>
      <input type="text" id="det-mal" inputmode="numeric" placeholder="ex.: 52991" />
    </label>
    <label class="field field--inline">
      <span>ID do IMDb</span>
      <input type="text" id="det-imdb" placeholder="ex.: tt22248376" />
    </label>
    <div class="detalhe__ids-actions">
      <button class="btn btn--ghost" type="button" id="det-buscar-imdb">Buscar IMDb</button>
      <button class="btn btn--ghost" type="button" id="det-salvar-ids">Salvar IDs</button>
    </div>
    <p class="form-error" id="det-erro" role="alert" hidden></p>
  `;
  corpo.append(ids);

  const inputMal = ids.querySelector('#det-mal');
  const inputImdb = ids.querySelector('#det-imdb');
  const erro = ids.querySelector('#det-erro');
  inputMal.value = anime.malId ?? '';
  inputImdb.value = anime.imdbId ?? '';

  const mostrarErro = (msg) => {
    erro.textContent = msg;
    erro.hidden = !msg;
  };

  // --- Ações --------------------------------------------------------------
  const rodape = document.createElement('div');
  rodape.className = 'detalhe__acoes';

  const btnAssistido = document.createElement('button');
  btnAssistido.type = 'button';
  btnAssistido.className = 'btn btn--primary';
  btnAssistido.textContent = anime.watched ? 'Marcar como não assistido' : 'Marcar como assistido';
  rodape.append(btnAssistido);

  const btnRemover = document.createElement('button');
  btnRemover.type = 'button';
  btnRemover.className = 'btn btn--perigo';
  btnRemover.textContent = 'Remover da lista';
  rodape.append(btnRemover);

  const { fechar } = abrirModal({ titulo: 'Detalhes', corpo, rodape });

  ids.querySelector('#det-salvar-ids').addEventListener('click', async () => {
    const malTexto = inputMal.value.trim();
    const imdbTexto = inputImdb.value.trim();

    if (malTexto && !/^\d+$/.test(malTexto)) {
      mostrarErro('O ID do MAL é só números (ex.: 52991).');
      return;
    }
    if (imdbTexto && !/^tt\d+$/.test(imdbTexto)) {
      mostrarErro('O ID do IMDb começa com "tt" (ex.: tt22248376).');
      return;
    }
    mostrarErro('');

    try {
      await atualizarAnime(anime.id, {
        malId: malTexto ? Number(malTexto) : null,
        imdbId: imdbTexto || null,
      });
      fechar();
      toast('IDs atualizados.');
    } catch (e) {
      console.error(e);
      mostrarErro('Não foi possível salvar.');
    }
  });

  ids.querySelector('#det-buscar-imdb').addEventListener('click', async (ev) => {
    const malTexto = inputMal.value.trim();
    if (!/^\d+$/.test(malTexto)) {
      mostrarErro('Preencha o ID do MAL primeiro para buscar o do IMDb.');
      return;
    }
    mostrarErro('');
    ev.target.disabled = true;
    ev.target.textContent = 'Buscando…';
    const encontrado = await buscarImdbId(Number(malTexto));
    ev.target.disabled = false;
    ev.target.textContent = 'Buscar IMDb';
    if (encontrado) {
      inputImdb.value = encontrado;
      mostrarErro('');
    } else {
      mostrarErro('O Wikidata não tem o IMDb desse anime. Preencha à mão.');
    }
  });

  btnAssistido.addEventListener('click', async () => {
    const virando = !anime.watched;
    try {
      await definirAssistido(anime.id, virando, obterAnimes(), sessao.uid);
      fechar();
      toast(virando ? `"${anime.title}" foi para os assistidos.` : `"${anime.title}" voltou para a fila.`);
    } catch (e) {
      console.error(e);
      mostrarErro('Não foi possível salvar.');
    }
  });

  btnRemover.addEventListener('click', async () => {
    // A lista é das duas pessoas, então remover apaga para ambas.
    if (!confirm(`Remover "${anime.title}" da lista? Isso apaga para as duas.`)) return;
    try {
      await removerAnime(anime.id);
      fechar();
      toast(`"${anime.title}" foi removido.`);
    } catch (e) {
      console.error(e);
      toastErro('Não foi possível remover.');
    }
  });
}
