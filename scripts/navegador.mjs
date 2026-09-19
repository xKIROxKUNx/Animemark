import { existsSync } from 'node:fs';

import { chromium } from 'playwright';

// O ambiente já traz um Chromium em /opt/pw-browsers; a versão do npm nem
// sempre bate com o build instalado, então apontamos o executável na mão em
// vez de baixar um novo (o download é bloqueado aqui de qualquer jeito).
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium';

export function abrirNavegador(opcoes = {}) {
  return chromium.launch({
    ...(existsSync(CHROMIUM_LOCAL) ? { executablePath: CHROMIUM_LOCAL } : {}),
    args: ['--no-sandbox'],
    ...opcoes,
  });
}
