const stack = () => document.getElementById('toast-stack');

/**
 * Mostra um aviso curto no rodapé.
 * @param {string} mensagem
 * @param {{ acao?: string, aoAgir?: () => void, duracao?: number, tipo?: 'info'|'erro' }} opcoes
 */
export function toast(mensagem, opcoes = {}) {
  const { acao, aoAgir, duracao = acao ? 6000 : 3500, tipo = 'info' } = opcoes;

  const el = document.createElement('div');
  el.className = `toast toast--${tipo}`;

  const texto = document.createElement('span');
  texto.className = 'toast__text';
  texto.textContent = mensagem;
  el.append(texto);

  let timer;
  const fechar = () => {
    clearTimeout(timer);
    el.classList.add('toast--saindo');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Se a animação não rodar (prefers-reduced-motion), remove mesmo assim.
    setTimeout(() => el.remove(), 400);
  };

  if (acao && aoAgir) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = acao;
    btn.addEventListener('click', () => {
      fechar();
      aoAgir();
    });
    el.append(btn);
  }

  stack().append(el);
  timer = setTimeout(fechar, duracao);
  return fechar;
}

export const toastErro = (mensagem) => toast(mensagem, { tipo: 'erro' });
