// Smoke test do app inteiro contra os emuladores do Firebase.
//
//   Terminal 1: npm run emulators
//   Terminal 2: npm run test:e2e
//
// As APIs externas (Jikan e Wikidata) são interceptadas pelo Playwright, então
// o teste não depende de internet — só do que o app faz com as respostas.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as espera } from 'node:timers/promises';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

import { abrirNavegador } from '../scripts/navegador.mjs';

const PROJETO = 'animemark-demo';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8080';
const PORTA = 4173;
const URL_APP = `http://127.0.0.1:${PORTA}/Animemark/`;

const MANUAL = 'Obra Desconhecida ZZZ';
const ANA = { email: 'ana@example.com', senha: 'senha-forte-123' };
const BIA = { email: 'bia@example.com', senha: 'senha-forte-456' };

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// --------------------------------------------------------------- emulador --

async function limparEmuladores() {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJETO}/accounts`, { method: 'DELETE' });
}

/**
 * Lê a coleção direto no emulador, ignorando as regras ("Bearer owner").
 * O SortableJS move o DOM assim que a pessoa solta o card, então conferir a
 * tela não prova nada: quem diz se a ordem foi salva é o servidor.
 */
async function estadoNoServidor() {
  const resp = await fetch(
    `${FIRESTORE}/v1/projects/${PROJETO}/databases/(default)/documents/animes`,
    { headers: { Authorization: 'Bearer owner' } }
  );
  const { documents = [] } = await resp.json();
  return documents
    .map((d) => ({
      title: d.fields.title.stringValue,
      order: d.fields.order.stringValue,
      watched: d.fields.watched.booleanValue === true,
    }))
    // Mesma ordenação do app: só a chave. O prefixo de grupo ('0'/'1') já
    // empurra os assistidos para o fim. Comparação por código de caractere,
    // como o Firestore faz — localeCompare inverteria 'Zz' e 'a0'.
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((a) => ({ title: a.title, watched: a.watched }));
}

const ordemNoServidor = async () => (await estadoNoServidor()).map((a) => a.title);

async function esperarServidor(esperado, rotulo) {
  for (let i = 0; i < 60; i += 1) {
    const atual = await ordemNoServidor();
    if (atual.length === esperado.length && atual.every((t, n) => t === esperado[n])) return;
    await espera(250);
  }
  assert.deepEqual(await ordemNoServidor(), esperado, `servidor não convergiu: ${rotulo}`);
}

async function criarUsuario({ email, senha }) {
  const resp = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    }
  );
  const json = await resp.json();
  assert.ok(json.localId, `falha ao criar ${email}: ${JSON.stringify(json)}`);
  return json.localId;
}

/** Ativa a conta como o Console faria: documento members/{uid} com o e-mail. */
async function ativar(testEnv, uid, email, nickname) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'members', uid), { email, nickname });
  });
}

// ------------------------------------------------------------- servidor ----

async function subirPreview() {
  // Um preview esquecido de outra execução serviria um bundle velho e faria o
  // teste mentir; melhor falhar na cara dura.
  try {
    await fetch(URL_APP);
    throw new Error(
      `já existe algo escutando em ${URL_APP} — encerre com: pkill -f "vite preview"`
    );
  } catch (e) {
    if (e.message.startsWith('já existe')) throw e;
  }

  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORTA), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(URL_APP);
      if (r.ok) return proc;
    } catch {
      /* ainda subindo */
    }
    await espera(250);
  }
  proc.kill();
  throw new Error('vite preview não respondeu a tempo');
}

// ------------------------------------------------------------- stubs API ---

const JIKAN_DB = {
  frieren: {
    mal_id: 52991,
    title: 'Sousou no Frieren',
    title_english: 'Frieren: Beyond Journey’s End',
    images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/anime/1/f.jpg', large_image_url: 'https://cdn.myanimelist.net/images/anime/1/f-l.jpg' } },
    synopsis: 'A elfa Frieren parte numa jornada depois da queda do Rei Demônio.',
    year: 2023,
    episodes: 28,
    score: 9.3,
    type: 'TV',
    status: 'Finished Airing',
    genres: [{ name: 'Adventure' }, { name: 'Drama' }],
  },
  steins: {
    mal_id: 9253,
    title: 'Steins;Gate',
    title_english: 'Steins;Gate',
    images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/anime/1/s.jpg', large_image_url: 'https://cdn.myanimelist.net/images/anime/1/s-l.jpg' } },
    synopsis: 'Um cientista maluco descobre como mandar mensagens para o passado.',
    year: 2011,
    episodes: 24,
    score: 9.07,
    type: 'TV',
    status: 'Finished Airing',
    genres: [{ name: 'Sci-Fi' }],
  },
  monster: {
    mal_id: 19,
    title: 'Monster',
    title_english: 'Monster',
    images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/anime/1/m.jpg', large_image_url: 'https://cdn.myanimelist.net/images/anime/1/m-l.jpg' } },
    synopsis: 'Um neurocirurgião salva a vida errada.',
    year: 2004,
    episodes: 74,
    score: 8.88,
    type: 'TV',
    status: 'Finished Airing',
    genres: [{ name: 'Mystery' }],
  },
};

const IMDB_POR_MAL = { 52991: 'tt22248376', 9253: 'tt1910272' };

async function instalarStubs(contexto) {
  await contexto.route('https://api.jikan.moe/**', async (rota) => {
    const q = new URL(rota.request().url()).searchParams.get('q')?.toLowerCase() ?? '';
    const chave = Object.keys(JIKAN_DB).find((k) => q.includes(k));
    await rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: chave ? [JIKAN_DB[chave]] : [] }),
    });
  });

  await contexto.route('https://query.wikidata.org/**', async (rota) => {
    const sparql = new URL(rota.request().url()).searchParams.get('query') ?? '';
    const mal = sparql.match(/"(\d+)"/)?.[1];
    const imdb = IMDB_POR_MAL[mal];
    await rota.fulfill({
      status: 200,
      contentType: 'application/sparql-results+json',
      body: JSON.stringify({ results: { bindings: imdb ? [{ imdb: { value: imdb } }] : [] } }),
    });
  });

  await contexto.route('https://cdn.myanimelist.net/**', (rota) =>
    rota.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX })
  );
}

// ----------------------------------------------------------------- testes --

const feitos = [];
async function passo(nome, fn) {
  await fn();
  feitos.push(nome);
  console.log(`  ok  ${nome}`);
}

const titulos = (page) =>
  page.$$eval('#anime-list .card-item .card-item__title', (els) => els.map((e) => e.textContent));

const esperarCards = (page, n) =>
  page.waitForFunction(
    (qtd) => document.querySelectorAll('#anime-list .card-item').length === qtd,
    n,
    { timeout: 10000 }
  );

/**
 * A lista é redesenhada a cada snapshot do Firestore, então um elemento
 * resolvido pelo locator pode ser destacado do DOM antes de medirmos. Tenta de
 * novo até a lista assentar.
 */
async function caixa(locator) {
  for (let i = 0; i < 25; i += 1) {
    const b = await locator.boundingBox().catch(() => null);
    if (b) return b;
    await espera(100);
  }
  throw new Error('elemento nunca ficou estável para medir');
}

const entrar = async (page, { email, senha }) => {
  await page.fill('#login-email', email);
  await page.fill('#login-password', senha);
  await page.click('#login-submit');
};

async function adicionar(page, termo, tituloEsperado) {
  await page.click('#add-btn');
  await page.fill('#add-query', termo);
  await page.click(`.resultado:has-text("${tituloEsperado}")`);
  await page.waitForSelector(`#anime-list .card-item:has-text("${tituloEsperado}")`);
}

async function rodar() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJETO,
    firestore: { host: '127.0.0.1', port: 8080 },
  });

  await limparEmuladores();
  const uidAna = await criarUsuario(ANA);
  const uidBia = await criarUsuario(BIA);
  // Ana entra sem apelido (testa o gate); Bia já vem configurada.
  await ativar(testEnv, uidAna, ANA.email, '');
  await ativar(testEnv, uidBia, BIA.email, 'Bia');
  // Conta que existe no Auth mas nunca foi ativada.
  const naoAtivada = { email: 'intrusa@example.com', senha: 'senha-forte-789' };
  await criarUsuario(naoAtivada);

  const preview = await subirPreview();
  const navegador = await abrirNavegador();
  const contexto = await navegador.newContext({ serviceWorkers: 'block' });
  await instalarStubs(contexto);
  const page = await contexto.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`[browser] ${m.text()}`);
  });
  page.on('dialog', (d) => d.accept());

  try {
    await page.goto(URL_APP);

    await passo('mostra a tela de login', async () => {
      await page.waitForSelector('#screen-login[data-active]');
      assert.equal(await page.isVisible('#login-form'), true);
    });

    await passo('recusa senha errada com mensagem em português', async () => {
      await entrar(page, { email: ANA.email, senha: 'errada' });
      await page.waitForSelector('#login-error:not([hidden])');
      assert.equal(await page.textContent('#login-error'), 'E-mail ou senha incorretos.');
    });

    await passo('bloqueia conta sem documento de ativação', async () => {
      await entrar(page, naoAtivada);
      await page.waitForSelector('#screen-denied[data-active]');
      assert.match(await page.textContent('#denied-detail'), /intrusa@example\.com/);
      await page.click('#denied-signout');
      await page.waitForSelector('#screen-login[data-active]');
    });

    await passo('pede o apelido no primeiro login', async () => {
      await entrar(page, ANA);
      await page.waitForSelector('#screen-nickname[data-active]');
      await page.fill('#nickname-input', 'Ana');
      await page.click('#nickname-submit');
      await page.waitForSelector('#screen-list[data-active]');
      assert.equal(await page.textContent('#whoami'), 'Ana');
    });

    await passo('começa com a lista vazia', async () => {
      await page.waitForSelector('#list-empty:not([hidden])');
    });

    await passo('adiciona animes pela busca e mantém a ordem de criação', async () => {
      await adicionar(page, 'frieren', 'Sousou no Frieren');
      await adicionar(page, 'steins', 'Steins;Gate');
      await adicionar(page, 'monster', 'Monster');
      assert.deepEqual(await titulos(page), ['Sousou no Frieren', 'Steins;Gate', 'Monster']);
    });

    await passo('guarda o autor e os metadados vindos da busca', async () => {
      const autor = await page.textContent('#anime-list .card-item:first-child .card-item__author');
      assert.equal(autor, 'adicionado por Ana');
      const meta = await page.textContent('#anime-list .card-item:first-child .card-item__meta');
      assert.equal(meta, '2023 · TV · 28 ep.');
    });

    await passo('resolve o ID do IMDb em segundo plano', async () => {
      await page.click('#anime-list .card-item:first-child .card-item__body');
      await page.waitForSelector('.modal');
      await page.waitForFunction(
        () => document.querySelector('#det-imdb')?.value === 'tt22248376',
        null,
        { timeout: 8000 }
      );
      assert.equal(await page.inputValue('#det-mal'), '52991');
      assert.equal(await page.textContent('.detalhe__synopsis'), JIKAN_DB.frieren.synopsis);
      assert.equal(await page.getAttribute('.pill-link:has-text("IMDb")', 'href'), 'https://www.imdb.com/title/tt22248376/');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached' });
    });

    await passo('reordena arrastando e a nova ordem persiste', async () => {
      await espera(300);
      const origem = await caixa(page.locator('#anime-list .card-item').nth(2));
      const destino = await caixa(page.locator('#anime-list .card-item').nth(0));
      await page.mouse.move(origem.x + origem.width / 2, origem.y + origem.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(
          destino.x + destino.width / 2,
          origem.y + ((destino.y - origem.y) * i) / 12,
          { steps: 2 }
        );
      }
      await page.mouse.up();

      await esperarServidor(['Monster', 'Sousou no Frieren', 'Steins;Gate'], 'reordenação');

      await page.reload();
      await page.waitForSelector('#screen-list[data-active]');
      await esperarCards(page, 3);
      assert.deepEqual(await titulos(page), ['Monster', 'Sousou no Frieren', 'Steins;Gate']);
    });

    await passo('marca como assistido: risca o título e manda para o fim', async () => {
      await page.click('#anime-list .card-item:first-child .card-item__check');
      await page.waitForSelector('.list-divider');
      assert.deepEqual(await titulos(page), ['Sousou no Frieren', 'Steins;Gate', 'Monster']);
      await esperarServidor(['Sousou no Frieren', 'Steins;Gate', 'Monster'], 'assistido');

      const ultimo = page.locator('#anime-list .card-item').last();
      assert.equal(await ultimo.getAttribute('data-watched'), '1');
      const risco = await ultimo
        .locator('.card-item__title')
        .evaluate((el) => getComputedStyle(el).textDecorationLine);
      assert.equal(risco, 'line-through');
    });

    await passo('anime novo entra acima dos assistidos', async () => {
      await page.click('#add-btn');
      await page.fill('#add-query', MANUAL);
      // Termo que o Jikan não conhece: exercita o caminho "não achei".
      await page.waitForSelector('#add-status:has-text("Nenhum anime encontrado")');
      await page.click('#add-manual');
      await esperarCards(page, 4);
      assert.deepEqual(await titulos(page), ['Sousou no Frieren', 'Steins;Gate', MANUAL, 'Monster']);
      await esperarServidor(
        ['Sousou no Frieren', 'Steins;Gate', MANUAL, 'Monster'],
        'adição manual'
      );
    });

    await passo('arrastar não marca nem desmarca ao cruzar o divisor', async () => {
      const antes = await titulos(page);
      await espera(300);
      const origem = await caixa(page.locator('#anime-list .card-item').nth(0));
      const destino = await caixa(page.locator('#anime-list .card-item').last());
      await page.mouse.move(origem.x + origem.width / 2, origem.y + origem.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) {
        await page.mouse.move(
          destino.x + destino.width / 2,
          origem.y + ((destino.y + destino.height - origem.y) * i) / 12,
          { steps: 2 }
        );
      }
      await page.mouse.up();
      await espera(800);

      // O item pode até parar no fim do PRÓPRIO grupo (isso é reordenação
      // legítima), mas nunca pode virar assistido nem passar do divisor.
      const depois = await titulos(page);
      assert.equal(depois.length, antes.length);
      assert.equal(depois[depois.length - 1], 'Monster', 'o assistido continua no fim');
      assert.equal(
        await page.locator('#anime-list .card-item').last().getAttribute('data-watched'),
        '1'
      );
      const assistidos = (await estadoNoServidor()).filter((a) => a.watched).map((a) => a.title);
      assert.deepEqual(assistidos, ['Monster'], 'o arrasto não mudou quem está assistido');
    });

    await passo('desmarca pelo modal e o anime volta para o fim da fila', async () => {
      await page.click('#anime-list .card-item:last-child .card-item__body');
      await page.waitForSelector('.modal');
      const antes = await titulos(page);
      await page.click('.btn--primary:has-text("Marcar como não assistido")');
      await page.waitForSelector('.modal', { state: 'detached' });
      await page.waitForSelector('.list-divider', { state: 'detached' });
      // Volta para o fim da fila de pendentes, ou seja: a ordem visível não
      // muda, só o risco e o divisor somem.
      assert.deepEqual(await titulos(page), antes);
      const watched = await page.$$eval('#anime-list .card-item', (els) =>
        els.map((e) => e.dataset.watched)
      );
      assert.deepEqual(watched, ['0', '0', '0', '0']);
      assert.deepEqual((await estadoNoServidor()).filter((a) => a.watched), []);
    });

    await passo('edita os IDs à mão e valida o formato', async () => {
      await page.click('#anime-list .card-item:has-text("Steins;Gate") .card-item__body');
      await page.waitForSelector('.modal');
      await page.fill('#det-imdb', 'formato-errado');
      await page.click('#det-salvar-ids');
      await page.waitForSelector('#det-erro:not([hidden])');
      assert.match(await page.textContent('#det-erro'), /começa com "tt"/);

      await page.fill('#det-imdb', 'tt1910272');
      await page.click('#det-salvar-ids');
      await page.waitForSelector('.modal', { state: 'detached' });

      await page.click('#anime-list .card-item:has-text("Steins;Gate") .card-item__body');
      await page.waitForSelector('.modal');
      assert.equal(await page.inputValue('#det-imdb'), 'tt1910272');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached' });
    });

    await passo('remove um anime da lista', async () => {
      const restantes = await titulos(page);
      await page.click(`#anime-list .card-item:has-text("${MANUAL}") .card-item__body`);
      await page.waitForSelector('.modal');
      await page.click('.btn--perigo');
      await page.waitForSelector('.modal', { state: 'detached' });
      await esperarCards(page, 3);
      const esperado = restantes.filter((t) => t !== MANUAL);
      assert.deepEqual(await titulos(page), esperado);
      await esperarServidor(esperado, 'remoção');
    });

    await passo('a outra pessoa vê a mesma lista e aparece como autora', async () => {
      await page.click('#signout-btn');
      await page.waitForSelector('#screen-login[data-active]');
      await entrar(page, BIA);
      await page.waitForSelector('#screen-list[data-active]');
      assert.equal(await page.textContent('#whoami'), 'Bia');
      const noServidor = await ordemNoServidor();
      await esperarCards(page, noServidor.length);
      assert.deepEqual(await titulos(page), noServidor);

      // "Monster" já está na lista (adicionado pela Ana), então esperar pelo
      // texto não basta: é a contagem que diz que o card novo chegou.
      const quantos = (await titulos(page)).length;
      await adicionar(page, 'monster', 'Monster');
      await esperarCards(page, quantos + 1);
      const autor = await page.textContent('#anime-list .card-item:last-child .card-item__author');
      assert.equal(autor, 'adicionado por Bia');
    });

    // O service worker fica bloqueado no contexto acima para não interferir
    // nas rotas interceptadas; aqui verificamos o registro num contexto limpo.
    await passo('registra o service worker do PWA', async () => {
      const ctxSw = await navegador.newContext({ serviceWorkers: 'allow' });
      const pageSw = await ctxSw.newPage();
      await pageSw.goto(URL_APP);
      const pronto = await pageSw.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return { escopo: reg.scope, ativo: Boolean(reg.active) };
      });
      assert.ok(pronto.ativo, 'service worker não ativou');
      assert.match(pronto.escopo, /\/Animemark\/$/);
      await ctxSw.close();
    });

    console.log(`\n${feitos.length} verificações passaram.`);
  } finally {
    await navegador.close().catch(() => {});
    preview.kill('SIGTERM');
    await testEnv.cleanup().catch(() => {});
  }
}

rodar()
  .then(() => process.exit(0))
  .catch((erro) => {
    console.error('\nFALHOU:', erro);
    // O preview e os listeners do Firestore seguram o event loop; saímos na mão.
    process.exit(1);
  });
