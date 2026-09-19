// Gera os PNGs do PWA a partir dos SVGs em public/icons/ usando o Chromium
// já instalado no ambiente (nada é baixado da internet).
//
//   node scripts/gerar-icones.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { abrirNavegador } from './navegador.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icones = resolve(raiz, 'public/icons');

// O ícone maskable precisa de margem: os launchers do Android recortam até 20%
// de cada borda, então o desenho vive dentro de um "safe zone" central.
const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b49bff"/><stop offset="1" stop-color="#6fd6ff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#12101a"/>
  <g transform="translate(256 256) scale(0.62) translate(-256 -256)">
    <path d="M176 112h160a24 24 0 0 1 24 24v272l-104-64-104 64V136a24 24 0 0 1 24-24z" fill="url(#g)"/>
    <path d="M212 216l30 32 60-68" fill="none" stroke="#12101a" stroke-width="26"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const alvos = [
  { arquivo: 'icon-192.png', tamanho: 192, svg: null },
  { arquivo: 'icon-512.png', tamanho: 512, svg: null },
  { arquivo: 'apple-touch-icon.png', tamanho: 180, svg: null },
  { arquivo: 'maskable-512.png', tamanho: 512, svg: MASKABLE },
];

const base = await readFile(resolve(icones, 'favicon.svg'), 'utf8');

const navegador = await abrirNavegador();
try {
  await mkdir(icones, { recursive: true });

  for (const { arquivo, tamanho, svg } of alvos) {
    const pagina = await navegador.newPage({
      viewport: { width: tamanho, height: tamanho },
      deviceScaleFactor: 1,
    });
    await pagina.setContent(
      `<body style="margin:0">
         <div style="width:${tamanho}px;height:${tamanho}px">${svg ?? base}</div>
       </body>`
    );
    const png = await pagina.locator('div').screenshot({ omitBackground: false });
    await writeFile(resolve(icones, arquivo), png);
    await pagina.close();
    console.log(`ok  ${arquivo}  (${tamanho}×${tamanho})`);
  }
} finally {
  await navegador.close();
}
