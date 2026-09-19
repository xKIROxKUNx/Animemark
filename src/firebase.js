import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

import { firebaseConfig } from './firebase-config.js';

// `npm run build` normal usa o projeto real; os testes fazem o build com
// VITE_USE_EMULATORS=true para apontar tudo para os emuladores locais.
const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

const app = initializeApp(
  USE_EMULATORS ? { ...firebaseConfig, projectId: 'animemark-demo', apiKey: 'fake-api-key' } : firebaseConfig
);

export const auth = getAuth(app);

// O cache persistente é o que faz a lista abrir instantaneamente e continuar
// utilizável offline; as escritas ficam na fila até a conexão voltar.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export const isPlaceholderConfig = firebaseConfig.projectId.startsWith('COLE_AQUI');
