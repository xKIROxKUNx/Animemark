// Testes das regras do Firestore contra o emulador.
//
//   Terminal 1: npm run emulators
//   Terminal 2: npm run test:rules
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const ANA = { uid: 'uid-ana', email: 'ana@example.com' };
const BIA = { uid: 'uid-bia', email: 'bia@example.com' };
const INTRUSA = { uid: 'uid-intrusa', email: 'intrusa@example.com' };
// Mesmo uid da Ana, mas logada com outro e-mail: o doc de ativação não bate.
const IMPOSTORA = { uid: 'uid-ana', email: 'outro@example.com' };

let testEnv;

const animeValido = (uid, extra = {}) => ({
  title: 'Frieren',
  titleEnglish: null,
  malId: 52991,
  imdbId: null,
  imageUrl: null,
  synopsis: null,
  year: 2023,
  episodes: 28,
  score: 9.3,
  type: 'TV',
  status: 'Finished Airing',
  genres: ['Adventure'],
  addedBy: uid,
  addedByName: 'ana',
  watched: false,
  watchedAt: null,
  watchedBy: null,
  createdAt: new Date(),
  order: '0a0',
  ...extra,
});

const comoMembro = (perfil) => testEnv.authenticatedContext(perfil.uid, { email: perfil.email }).firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'animemark-demo',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Ativação feita pelo Console/Admin SDK: Ana e Bia liberadas, Intrusa não.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', ANA.uid), { email: ANA.email, nickname: 'Ana' });
    await setDoc(doc(db, 'members', BIA.uid), { email: BIA.email, nickname: '' });
    await setDoc(doc(db, 'animes', 'anime-1'), animeValido(ANA.uid));
  });
});

describe('ativação de conta', () => {
  it('bloqueia quem não está logado', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'animes')));
    await assertFails(getDoc(doc(db, 'members', ANA.uid)));
  });

  it('bloqueia conta logada sem documento de ativação', async () => {
    const db = comoMembro(INTRUSA);
    await assertFails(getDocs(collection(db, 'animes')));
    await assertFails(getDocs(collection(db, 'members')));
    await assertFails(addDoc(collection(db, 'animes'), animeValido(INTRUSA.uid)));
  });

  it('bloqueia quando o e-mail do token não bate com o do documento', async () => {
    const db = comoMembro(IMPOSTORA);
    await assertFails(getDocs(collection(db, 'animes')));
  });

  it('libera quem tem documento com o e-mail conferindo', async () => {
    const db = comoMembro(ANA);
    await assertSucceeds(getDocs(collection(db, 'animes')));
    await assertSucceeds(getDocs(collection(db, 'members')));
  });

  it('aceita diferença de maiúsculas no e-mail', async () => {
    const db = comoMembro({ uid: ANA.uid, email: 'ANA@Example.com' });
    await assertSucceeds(getDocs(collection(db, 'animes')));
  });
});

describe('documentos de membro', () => {
  it('não deixa ninguém criar nem apagar ativações', async () => {
    const db = comoMembro(ANA);
    await assertFails(setDoc(doc(db, 'members', 'uid-novo'), { email: 'nova@example.com' }));
    await assertFails(deleteDoc(doc(db, 'members', BIA.uid)));
    await assertFails(deleteDoc(doc(db, 'members', ANA.uid)));
  });

  it('deixa a pessoa mudar só o próprio apelido', async () => {
    const db = comoMembro(ANA);
    await assertSucceeds(updateDoc(doc(db, 'members', ANA.uid), { nickname: 'Aninha' }));
    await assertFails(updateDoc(doc(db, 'members', BIA.uid), { nickname: 'hackeada' }));
  });

  it('não deixa trocar o próprio e-mail (isso invalidaria a checagem)', async () => {
    const db = comoMembro(ANA);
    await assertFails(updateDoc(doc(db, 'members', ANA.uid), { email: 'outro@example.com' }));
    await assertFails(
      updateDoc(doc(db, 'members', ANA.uid), { nickname: 'Ana', email: 'outro@example.com' })
    );
  });

  it('recusa apelido vazio ou longo demais', async () => {
    const db = comoMembro(ANA);
    await assertFails(updateDoc(doc(db, 'members', ANA.uid), { nickname: '' }));
    await assertFails(updateDoc(doc(db, 'members', ANA.uid), { nickname: 'x'.repeat(41) }));
  });
});

describe('animes', () => {
  it('deixa um membro adicionar, editar e remover', async () => {
    const db = comoMembro(ANA);
    await assertSucceeds(addDoc(collection(db, 'animes'), animeValido(ANA.uid)));
    await assertSucceeds(updateDoc(doc(db, 'animes', 'anime-1'), { order: '0a1' }));
    await assertSucceeds(deleteDoc(doc(db, 'animes', 'anime-1')));
  });

  it('deixa a outra pessoa marcar como assistido o anime que não foi ela que adicionou', async () => {
    const db = comoMembro(BIA);
    await assertSucceeds(
      updateDoc(doc(db, 'animes', 'anime-1'), {
        watched: true,
        watchedBy: BIA.uid,
        watchedAt: new Date(),
        order: '1a0',
      })
    );
  });

  it('exige que quem adiciona seja quem está logado', async () => {
    const db = comoMembro(ANA);
    await assertFails(addDoc(collection(db, 'animes'), animeValido(BIA.uid)));
  });

  it('recusa anime sem título ou sem chave de ordem', async () => {
    const db = comoMembro(ANA);
    await assertFails(addDoc(collection(db, 'animes'), animeValido(ANA.uid, { title: '' })));
    await assertFails(addDoc(collection(db, 'animes'), animeValido(ANA.uid, { order: '' })));
    await assertFails(addDoc(collection(db, 'animes'), animeValido(ANA.uid, { order: 12 })));
  });

  it('recusa anime que já nasce assistido', async () => {
    const db = comoMembro(ANA);
    await assertFails(addDoc(collection(db, 'animes'), animeValido(ANA.uid, { watched: true })));
  });

  it('não deixa reescrever a autoria', async () => {
    const db = comoMembro(BIA);
    await assertFails(updateDoc(doc(db, 'animes', 'anime-1'), { addedBy: BIA.uid }));
  });

  it('recusa update que zera o título ou a ordem', async () => {
    const db = comoMembro(ANA);
    await assertFails(updateDoc(doc(db, 'animes', 'anime-1'), { title: '' }));
    await assertFails(updateDoc(doc(db, 'animes', 'anime-1'), { order: '' }));
    await assertFails(updateDoc(doc(db, 'animes', 'anime-1'), { watched: 'sim' }));
  });
});

describe('coleções fora do esquema', () => {
  it('ficam fechadas mesmo para membros', async () => {
    const db = comoMembro(ANA);
    await assertFails(getDocs(collection(db, 'qualquer-outra')));
    await assertFails(setDoc(doc(db, 'qualquer-outra', 'x'), { a: 1 }));
    assert.ok(true);
  });
});
