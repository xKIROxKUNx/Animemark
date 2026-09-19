import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';

import { auth, db } from './firebase.js';

const MEMBERS = 'members';

/**
 * Mensagens de erro do Firebase Auth em português.
 * Login e senha errados devolvem o mesmo texto de propósito (o Firebase moderno
 * já unifica tudo em `invalid-credential` para não vazar quais e-mails existem).
 */
export function traduzErroAuth(erro) {
  switch (erro?.code) {
    case 'auth/invalid-email':
      return 'E-mail inválido.';
    case 'auth/missing-password':
      return 'Digite sua senha.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha incorretos.';
    case 'auth/user-disabled':
      return 'Esta conta foi desativada.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Espere alguns minutos e tente de novo.';
    case 'auth/network-request-failed':
      return 'Sem conexão com a internet.';
    case 'auth/operation-not-allowed':
      return 'Login por e-mail/senha não está ativado no projeto Firebase.';
    default:
      return 'Não foi possível entrar. Tente novamente.';
  }
}

export function entrar(email, senha) {
  return signInWithEmailAndPassword(auth, email.trim(), senha);
}

export function enviarResetDeSenha(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export function sair() {
  return signOut(auth);
}

export function salvarApelido(uid, apelido) {
  return updateDoc(doc(db, MEMBERS, uid), { nickname: apelido.trim() });
}

/**
 * Observa a sessão e resolve o estado da tela.
 *
 * Estados possíveis entregues ao callback:
 *   { estado: 'carregando' }
 *   { estado: 'deslogado' }
 *   { estado: 'negado', email }          conta existe no Auth mas não está ativada
 *   { estado: 'sem-apelido', user, membros }
 *   { estado: 'pronto', user, membros }
 *
 * A ativação é decidida pelas regras: se a pessoa não tem `members/{uid}` com o
 * e-mail conferindo, o próprio listener da coleção devolve permission-denied.
 */
export function observarSessao(aoMudar) {
  let pararMembros = null;

  const encerrarMembros = () => {
    if (pararMembros) {
      pararMembros();
      pararMembros = null;
    }
  };

  const pararAuth = onAuthStateChanged(auth, (user) => {
    encerrarMembros();

    if (!user) {
      aoMudar({ estado: 'deslogado' });
      return;
    }

    aoMudar({ estado: 'carregando' });

    pararMembros = onSnapshot(
      collection(db, MEMBERS),
      (snap) => {
        const membros = new Map();
        snap.forEach((d) => membros.set(d.id, { id: d.id, ...d.data() }));

        const eu = membros.get(user.uid);
        if (!eu) {
          // A query passou pelas regras mas o próprio documento sumiu: trata
          // como não ativado em vez de deixar a tela em branco.
          aoMudar({ estado: 'negado', email: user.email });
          return;
        }

        const apelido = (eu.nickname || '').trim();
        aoMudar({
          estado: apelido ? 'pronto' : 'sem-apelido',
          user,
          membros,
        });
      },
      (erro) => {
        if (erro.code === 'permission-denied') {
          aoMudar({ estado: 'negado', email: user.email });
        } else {
          aoMudar({ estado: 'erro', erro });
        }
      }
    );
  });

  return () => {
    encerrarMembros();
    pararAuth();
  };
}

/** Apelido atual de um uid, com fallbacks para não deixar o card sem autor. */
export function nomeDoMembro(membros, uid, fallback) {
  const membro = membros?.get(uid);
  const apelido = (membro?.nickname || '').trim();
  if (apelido) return apelido;
  if (fallback) return fallback;
  const email = membro?.email || '';
  return email ? email.split('@')[0] : 'alguém';
}
