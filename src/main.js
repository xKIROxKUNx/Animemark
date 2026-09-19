import './styles.css';

import {
  enviarResetDeSenha,
  entrar,
  nomeDoMembro,
  observarSessao,
  sair,
  salvarApelido,
  traduzErroAuth,
} from './auth.js';
import { observarAnimes } from './animes.js';
import { isPlaceholderConfig } from './firebase.js';
import { abrirAdicionar } from './ui/add.js';
import { abrirDetalhe } from './ui/detail.js';
import { iniciarLista, renderizarLista } from './ui/list.js';
import { fecharModal } from './ui/modal.js';
import { toast, toastErro } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

const TELAS = {
  carregando: 'screen-loading',
  deslogado: 'screen-login',
  negado: 'screen-denied',
  'sem-apelido': 'screen-nickname',
  pronto: 'screen-list',
};

function mostrarTela(nome) {
  const alvo = TELAS[nome] ?? TELAS.carregando;
  for (const id of Object.values(TELAS)) {
    $(id)?.toggleAttribute('data-active', id === alvo);
  }
}

// Estado vivo da sessão, compartilhado com os módulos de UI.
const sessao = { uid: null, apelido: '', membros: new Map() };
let animes = [];
let pararAnimes = null;
const obterAnimes = () => animes;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function erroLogin(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.hidden = !msg;
}

$('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('login-email').value;
  const senha = $('login-password').value;
  const botao = $('login-submit');

  if (!email.trim() || !senha) {
    erroLogin('Preencha e-mail e senha.');
    return;
  }

  erroLogin('');
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    await entrar(email, senha);
    $('login-password').value = '';
  } catch (e) {
    erroLogin(traduzErroAuth(e));
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

$('login-reset').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  if (!email) {
    erroLogin('Escreva seu e-mail primeiro para receber o link.');
    $('login-email').focus();
    return;
  }
  erroLogin('');
  try {
    await enviarResetDeSenha(email);
  } catch (e) {
    // Um e-mail inexistente não deve revelar isso; só erros reais aparecem.
    if (e.code === 'auth/invalid-email' || e.code === 'auth/network-request-failed') {
      erroLogin(traduzErroAuth(e));
      return;
    }
    console.warn(e);
  }
  toast('Se essa conta existir, o link de redefinição foi enviado.');
});

// ---------------------------------------------------------------------------
// Apelido e saída
// ---------------------------------------------------------------------------

$('nickname-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const apelido = $('nickname-input').value.trim();
  const el = $('nickname-error');

  if (apelido.length < 2) {
    el.textContent = 'Escolha um apelido com pelo menos 2 letras.';
    el.hidden = false;
    return;
  }
  el.hidden = true;

  try {
    await salvarApelido(sessao.uid, apelido);
  } catch (e) {
    console.error(e);
    el.textContent = 'Não foi possível salvar o apelido.';
    el.hidden = false;
  }
});

for (const id of ['signout-btn', 'denied-signout', 'nickname-signout']) {
  $(id).addEventListener('click', () => {
    fecharModal();
    sair();
  });
}

// Tocar no próprio apelido abre a tela para trocá-lo.
$('whoami').addEventListener('click', () => {
  $('nickname-input').value = sessao.apelido;
  mostrarTela('sem-apelido');
});

$('add-btn').addEventListener('click', () => abrirAdicionar(sessao, obterAnimes));

iniciarLista({
  aoAbrirDetalhe: (id) => {
    const anime = animes.find((a) => a.id === id);
    if (anime) abrirDetalhe(anime, sessao, obterAnimes);
  },
});

// ---------------------------------------------------------------------------
// Sessão → lista
// ---------------------------------------------------------------------------

function pararListaDeAnimes() {
  if (pararAnimes) {
    pararAnimes();
    pararAnimes = null;
  }
  animes = [];
}

function iniciarListaDeAnimes() {
  if (pararAnimes) return;
  pararAnimes = observarAnimes(
    (lista) => {
      animes = lista;
      renderizarLista(animes, sessao.membros, sessao.uid);
    },
    (erro) => {
      console.error(erro);
      // permission-denied já é tratado pela tela de "conta não autorizada".
      if (erro.code !== 'permission-denied') {
        toastErro('Não foi possível carregar a lista.');
      }
    }
  );
}

observarSessao((s) => {
  if (s.estado === 'pronto' || s.estado === 'sem-apelido') {
    sessao.uid = s.user.uid;
    sessao.membros = s.membros;
    sessao.apelido = nomeDoMembro(s.membros, s.user.uid, null);
  }

  switch (s.estado) {
    case 'pronto':
      $('whoami').textContent = sessao.apelido;
      iniciarListaDeAnimes();
      // Um snapshot de membros pode chegar depois dos animes; redesenhar
      // mantém os apelidos dos cards em dia.
      renderizarLista(animes, sessao.membros, sessao.uid);
      mostrarTela('pronto');
      break;

    case 'sem-apelido':
      $('nickname-input').value = sessao.apelido === 'alguém' ? '' : sessao.apelido;
      mostrarTela('sem-apelido');
      break;

    case 'negado':
      pararListaDeAnimes();
      fecharModal();
      $('denied-detail').textContent =
        `O e-mail ${s.email ?? ''} entrou no Firebase, mas ainda não foi ativado para esta lista. ` +
        'Peça para o administrador criar o documento de acesso.';
      mostrarTela('negado');
      break;

    case 'deslogado':
      pararListaDeAnimes();
      fecharModal();
      sessao.uid = null;
      sessao.membros = new Map();
      mostrarTela('deslogado');
      break;

    case 'erro':
      console.error(s.erro);
      toastErro('Erro de conexão com o servidor.');
      break;

    default:
      mostrarTela('carregando');
  }
});

// ---------------------------------------------------------------------------
// Estado da conexão
// ---------------------------------------------------------------------------

const atualizarBannerOffline = () => {
  $('offline-banner').hidden = navigator.onLine;
};
window.addEventListener('online', atualizarBannerOffline);
window.addEventListener('offline', atualizarBannerOffline);
atualizarBannerOffline();

if (isPlaceholderConfig) {
  console.warn(
    'firebase-config.js ainda está com os valores de exemplo. Veja SETUP.md para conectar o projeto real.'
  );
}
