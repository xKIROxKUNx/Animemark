// Configuração web do Firebase.
//
// Estes valores NÃO são segredo: todo PWA precisa deles no bundle e eles são
// visíveis para qualquer pessoa que abrir o site. Quem protege os dados são as
// regras em `firestore.rules`, que exigem um documento `members/{uid}` com o
// e-mail conferindo. Veja SETUP.md.
export const firebaseConfig = {
  apiKey: 'COLE_AQUI_apiKey',
  authDomain: 'COLE_AQUI_authDomain',
  projectId: 'COLE_AQUI_projectId',
  storageBucket: 'COLE_AQUI_storageBucket',
  messagingSenderId: 'COLE_AQUI_messagingSenderId',
  appId: 'COLE_AQUI_appId',
};
