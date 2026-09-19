let aberto = null;

/**
 * Abre uma folha modal (bottom sheet no celular, caixa centrada no desktop).
 * Só um modal por vez: abrir um novo fecha o anterior.
 */
export function abrirModal({ titulo, corpo, rodape, aoFechar }) {
  fecharModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'modal';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', titulo);

  const head = document.createElement('header');
  head.className = 'modal__head';

  const h = document.createElement('h2');
  h.className = 'modal__title';
  h.textContent = titulo;
  head.append(h);

  const btnFechar = document.createElement('button');
  btnFechar.type = 'button';
  btnFechar.className = 'icon-btn';
  btnFechar.setAttribute('aria-label', 'Fechar');
  btnFechar.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  head.append(btnFechar);
  sheet.append(head);

  const conteudo = document.createElement('div');
  conteudo.className = 'modal__body';
  conteudo.append(corpo);
  sheet.append(conteudo);

  if (rodape) {
    const pe = document.createElement('footer');
    pe.className = 'modal__foot';
    pe.append(rodape);
    sheet.append(pe);
  }

  backdrop.append(sheet);
  document.body.append(backdrop);
  document.body.classList.add('sem-scroll');

  const focoAnterior = document.activeElement;

  const fechar = () => {
    if (aberto?.backdrop !== backdrop) return;
    document.removeEventListener('keydown', aoTeclar);
    backdrop.remove();
    document.body.classList.remove('sem-scroll');
    aberto = null;
    focoAnterior?.focus?.();
    aoFechar?.();
  };

  function aoTeclar(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      fechar();
    }
  }

  btnFechar.addEventListener('click', fechar);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) fechar();
  });
  document.addEventListener('keydown', aoTeclar);

  aberto = { backdrop, fechar };
  return { fechar, sheet };
}

export function fecharModal() {
  aberto?.fechar();
}
