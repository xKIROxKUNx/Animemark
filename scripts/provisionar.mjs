// Provisiona o projeto Firebase inteiro a partir de uma chave de service
// account, sem precisar de navegador.
//
//   node scripts/provisionar.mjs --chave sa.json \
//        --conta voce@exemplo.com:senhaInicial \
//        --conta amiga@exemplo.com:outraSenha
//
// O que ele faz (tudo idempotente — rodar duas vezes não estraga nada):
//   1. cria o banco do Firestore, se ainda não existir;
//   2. liga o provedor de login por e-mail/senha;
//   3. registra o app web e grava a config em src/firebase-config.js;
//   4. cria as contas informadas (ou reaproveita as existentes);
//   5. cria os documentos de ativação `members/{uid}`;
//   6. publica as regras e os índices (via firebase-tools).
//
// A chave é uma credencial: apague-a do disco e do console quando terminar.
import { execFile } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as espera } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const RAIZ = new URL('..', import.meta.url).pathname;
const REGIAO_PADRAO = 'southamerica-east1';

// ----------------------------------------------------------- argumentos ---

function lerArgs(argv) {
  const args = { contas: [], regiao: REGIAO_PADRAO };
  for (let i = 0; i < argv.length; i += 1) {
    const valor = argv[i + 1];
    if (argv[i] === '--chave') args.chave = valor;
    else if (argv[i] === '--regiao') args.regiao = valor;
    else if (argv[i] === '--conta') {
      // Só o primeiro ":" separa — senhas podem conter ":".
      const corte = valor.indexOf(':');
      if (corte < 1) throw new Error(`--conta precisa ser email:senha (recebi "${valor}")`);
      args.contas.push({ email: valor.slice(0, corte).trim(), senha: valor.slice(corte + 1) });
    }
  }
  if (!args.chave) throw new Error('falta --chave caminho/para/service-account.json');
  if (args.contas.length === 0) throw new Error('informe ao menos uma --conta email:senha');
  return args;
}

// ------------------------------------------------------------- OAuth SA ---

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Troca a chave da service account por um access token (fluxo JWT bearer). */
async function pegarToken(sa) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: agora,
      exp: agora + 3600,
    })
  );
  const assinatura = base64url(
    createSign('RSA-SHA256').update(`${cabecalho}.${corpo}`).sign(sa.private_key)
  );

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${cabecalho}.${corpo}.${assinatura}`,
    }),
  });
  const json = await resp.json();
  if (!json.access_token) {
    throw new Error(`não consegui autenticar com a chave: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

// ------------------------------------------------------------- HTTP ------

function criarApi(token) {
  return async function api(url, { metodo = 'GET', corpo, ignorar = [] } = {}) {
    const resp = await fetch(url, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await resp.text();
    const json = texto ? JSON.parse(texto) : {};
    if (!resp.ok) {
      if (ignorar.includes(resp.status)) return { ignorado: resp.status, ...json };
      const msg = json?.error?.message ?? texto;
      throw new Error(`${metodo} ${url} → ${resp.status}: ${msg}`);
    }
    return json;
  };
}

/** Espera uma long-running operation do Google terminar. */
async function esperarOperacao(api, nome) {
  for (let i = 0; i < 60; i += 1) {
    const op = await api(`https://firebase.googleapis.com/v1/${nome}`);
    if (op.done) {
      if (op.error) throw new Error(`operação falhou: ${op.error.message}`);
      return op.response;
    }
    await espera(2000);
  }
  throw new Error(`operação ${nome} demorou demais`);
}

// ------------------------------------------------------------- passos ----

async function garantirFirestore(api, projeto, regiao) {
  const bancos = await api(
    `https://firestore.googleapis.com/v1/projects/${projeto}/databases`,
    { ignorar: [403] }
  );
  if (bancos.ignorado) {
    // A chave do Admin SDK não pode ativar APIs; quem liga o Firestore é o
    // console, ao criar o banco pela primeira vez.
    throw new Error(
      'a Cloud Firestore API ainda não está ativada neste projeto. ' +
        'No console: Criação → Firestore Database → Criar banco de dados ' +
        `(região ${regiao}, modo de produção).`
    );
  }
  if ((bancos.databases ?? []).some((b) => b.name.endsWith('/(default)'))) {
    return 'já existia';
  }

  await api(
    `https://firestore.googleapis.com/v1/projects/${projeto}/databases?databaseId=(default)`,
    {
      metodo: 'POST',
      corpo: { locationId: regiao, type: 'FIRESTORE_NATIVE', concurrencyMode: 'OPTIMISTIC' },
    }
  );
  // A criação é assíncrona; esperamos o banco aparecer na listagem.
  for (let i = 0; i < 45; i += 1) {
    await espera(2000);
    const agora = await api(`https://firestore.googleapis.com/v1/projects/${projeto}/databases`);
    if ((agora.databases ?? []).some((b) => b.name.endsWith('/(default)'))) return 'criado';
  }
  throw new Error('o banco do Firestore não ficou pronto a tempo');
}

async function ligarEmailSenha(api, projeto) {
  const atual = await api(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projeto}/config`,
    { ignorar: [404] }
  );
  if (atual.ignorado === 404) {
    throw new Error(
      'o Authentication ainda não foi inicializado neste projeto. ' +
        'No console: Criação → Authentication → Comece agora.'
    );
  }
  await api(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projeto}/config?updateMask=signIn.email`,
    {
      metodo: 'PATCH',
      corpo: { signIn: { email: { enabled: true, passwordRequired: true } } },
    }
  );
  return 'ativado';
}

async function garantirAppWeb(api, projeto) {
  const lista = await api(`https://firebase.googleapis.com/v1beta1/projects/${projeto}/webApps`);
  let app = (lista.apps ?? [])[0];

  if (!app) {
    const op = await api(`https://firebase.googleapis.com/v1beta1/projects/${projeto}/webApps`, {
      metodo: 'POST',
      corpo: { displayName: 'AnimeMark' },
    });
    app = op.done ? op.response : await esperarOperacao(api, op.name);
  }

  return api(
    `https://firebase.googleapis.com/v1beta1/projects/${projeto}/webApps/${app.appId}/config`
  );
}

async function garantirConta(api, projeto, { email, senha }) {
  const busca = await api(
    `https://identitytoolkit.googleapis.com/v1/projects/${projeto}/accounts:lookup`,
    { metodo: 'POST', corpo: { email: [email] } }
  );
  const existente = (busca.users ?? [])[0];
  if (existente) return { uid: existente.localId, novo: false };

  const criado = await api(
    `https://identitytoolkit.googleapis.com/v1/projects/${projeto}/accounts`,
    { metodo: 'POST', corpo: { email, password: senha, emailVerified: false } }
  );
  return { uid: criado.localId, novo: true };
}

async function garantirAtivacao(api, projeto, uid, email) {
  // PATCH cria o documento se não existir; a máscara preserva o apelido que a
  // pessoa já tiver escolhido.
  const base = `https://firestore.googleapis.com/v1/projects/${projeto}/databases/(default)/documents/members/${uid}`;
  const atual = await api(base, { ignorar: [404] });
  const jaTemApelido = typeof atual?.fields?.nickname?.stringValue === 'string';

  const campos = { email: { stringValue: email } };
  const mascara = ['email'];
  if (!jaTemApelido) {
    campos.nickname = { stringValue: '' };
    mascara.push('nickname');
  }

  await api(`${base}?${mascara.map((c) => `updateMask.fieldPaths=${c}`).join('&')}`, {
    metodo: 'PATCH',
    corpo: { fields: campos },
  });
  return atual?.ignorado === 404 ? 'criado' : 'atualizado';
}

async function gravarConfig(config) {
  const caminho = resolve(RAIZ, 'src/firebase-config.js');
  const conteudo = `// Configuração web do Firebase.
//
// Estes valores NÃO são segredo: todo PWA precisa deles no bundle e eles são
// visíveis para qualquer pessoa que abrir o site. Quem protege os dados são as
// regras em \`firestore.rules\`, que exigem um documento \`members/{uid}\` com o
// e-mail conferindo. Veja SETUP.md.
//
// Gerado por scripts/provisionar.mjs.
export const firebaseConfig = {
  apiKey: ${JSON.stringify(config.apiKey)},
  authDomain: ${JSON.stringify(config.authDomain)},
  projectId: ${JSON.stringify(config.projectId)},
  storageBucket: ${JSON.stringify(config.storageBucket ?? '')},
  messagingSenderId: ${JSON.stringify(config.messagingSenderId)},
  appId: ${JSON.stringify(config.appId)},
};
`;
  await writeFile(caminho, conteudo);
  return caminho;
}

async function publicarRegras(caminhoChave, projeto) {
  const { stdout, stderr } = await execFileP(
    'npx',
    ['firebase', 'deploy', '--only', 'firestore:rules,firestore:indexes', '--project', projeto],
    {
      cwd: RAIZ,
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: caminhoChave },
      maxBuffer: 10 * 1024 * 1024,
    }
  );
  return `${stdout}${stderr}`.trim().split('\n').slice(-3).join('\n');
}

// -------------------------------------------------------------- roteiro ---

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const caminhoChave = resolve(args.chave);
  const sa = JSON.parse(await readFile(caminhoChave, 'utf8'));
  const projeto = sa.project_id;
  if (!projeto) throw new Error('a chave não tem project_id — é mesmo um JSON de service account?');

  console.log(`Projeto: ${projeto}\n`);
  const api = criarApi(await pegarToken(sa));

  // Um passo que falha não derruba os outros: o que der para adiantar é
  // adiantado, e no fim sai a lista do que ainda falta. Rodar de novo depois
  // de resolver retoma de onde parou.
  const pendencias = [];
  const tentar = async (rotulo, fn) => {
    try {
      const r = await fn();
      console.log(`${rotulo.padEnd(24)} ${r ?? 'ok'}`);
      return { ok: true, valor: r };
    } catch (erro) {
      console.log(`${rotulo.padEnd(24)} FALHOU`);
      pendencias.push(`${rotulo.trim()}: ${erro.message}`);
      return { ok: false };
    }
  };

  const firestore = await tentar('1. Firestore .........', () =>
    garantirFirestore(api, projeto, args.regiao)
  );
  const auth = await tentar('2. Login e-mail/senha ', () => ligarEmailSenha(api, projeto));

  const app = await tentar('3. App web ...........', async () => {
    const config = await garantirAppWeb(api, projeto);
    await gravarConfig(config);
    return `${config.appId} → config gravada em src/firebase-config.js`;
  });

  if (auth.ok && firestore.ok) {
    console.log('4. Contas e ativação:');
    for (const conta of args.contas) {
      await tentar(`   ${conta.email}`, async () => {
        const { uid, novo } = await garantirConta(api, projeto, conta);
        const estado = await garantirAtivacao(api, projeto, uid, conta.email);
        return `uid ${uid} (conta ${novo ? 'criada' : 'já existia'}, ativação ${estado})`;
      });
    }
  } else {
    console.log('4. Contas e ativação:    pulado (depende dos passos 1 e 2)');
  }

  if (firestore.ok) {
    await tentar('5. Regras e índices ..', async () => {
      const saida = await publicarRegras(caminhoChave, projeto);
      return `publicados\n${saida.split('\n').map((l) => `   ${l}`).join('\n')}`;
    });
  } else {
    console.log('5. Regras e índices ..   pulado (depende do passo 1)');
  }

  if (pendencias.length) {
    console.log('\nFalta resolver:');
    for (const p of pendencias) console.log(`  - ${p}`);
    console.log('\nDepois é só rodar este script de novo — ele retoma de onde parou.');
    process.exitCode = 1;
    return;
  }

  console.log(`
Pronto. Ainda falta, no console:
  - Authentication → Settings → Domínios autorizados: adicionar xkiroxkunx.github.io
  - Settings → Pages do repositório: Source = GitHub Actions

E apague a chave de service account (aqui e no console) quando terminar.`);
}

principal().catch((erro) => {
  console.error(`\nFalhou: ${erro.message}`);
  process.exit(1);
});
