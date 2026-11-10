// util.js — pequenos ajudantes usados por todas as partes do tabuleiro.
export const $ = s => document.querySelector(s);
export const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
export const celular = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

// ---------- pequenos ajudantes de tela ----------
export function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'texto') e.textContent = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
export function avisar(texto, erro = false) {
  const caixa = $('#avisos');
  while (caixa.children.length >= 3) caixa.firstChild.remove(); // no máximo 3 avisos de cada vez
  const a = el('div', { class: 'aviso' + (erro ? ' erro' : ''), texto });
  caixa.append(a);
  setTimeout(() => a.remove(), erro ? 6000 : 3200);
}
export function definirStatus(texto, tipo) {
  const s = $('#status'); s.className = 'status ' + tipo; s.querySelector('span').textContent = texto;
}
export function avisoMapa(texto, fracao) {
  const box = $('#aviso-mapa');
  if (!texto) { box.hidden = true; return; }
  box.hidden = false; box.replaceChildren(el('div', { texto }));
  if (fracao != null) { const b = el('b'); b.style.width = Math.round(fracao * 100) + '%'; box.append(el('div', { class: 'barra-progresso' }, b)); }
}
export function escolherArquivo(aceita) {
  return new Promise(ok => {
    const i = el('input', { type: 'file', accept: aceita });
    i.addEventListener('change', () => ok(i.files[0] || null));
    i.click();
  });
}
export const numero = (v, min, max, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
export const inteiro = (v, min, max, padrao = 0) => Math.round(numero(v, min, max, padrao));
export const corValida = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
export const imagemValida = s => (typeof s === 'string' && s.startsWith('data:image/') && s.length < 400000 ? s : null);
export const hashValido = h => typeof h === 'string' && /^[0-9a-f]{32}$/.test(h);
export const TIPOS_IMAGEM = 'image/png,image/jpeg,image/webp';

// 6 cores prontas + "outra cor" (abre o seletor do navegador)
export const CORES = [['#d64541', 'Vermelho'], ['#e8873a', 'Laranja'], ['#e9c46a', 'Amarelo'], ['#4caf6e', 'Verde'], ['#3a86d6', 'Azul'], ['#9b6bd6', 'Roxo']];
export function escolhaDeCor(atual, aoMudar) {
  const caixa = el('div', { class: 'cores', role: 'radiogroup', 'aria-label': 'Cor' });
  const outra = el('input', { type: 'color', value: corValida(atual) || '#a4c29a', title: 'Outra cor', 'aria-label': 'Outra cor' });
  const marcar = cor => {
    caixa.querySelectorAll('.amostra').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cor === cor.toLowerCase())));
    outra.classList.toggle('marcada', !CORES.some(([c]) => c === cor.toLowerCase()));
  };
  for (const [cor, nome] of CORES) {
    caixa.append(el('button', { type: 'button', class: 'amostra', role: 'radio', 'data-cor': cor, title: nome, 'aria-label': nome, style: `background:${cor}`,
      onclick: () => { outra.value = cor; marcar(cor); aoMudar(cor); } }));
  }
  outra.addEventListener('input', () => { marcar(outra.value); aoMudar(outra.value); });
  caixa.append(outra);
  marcar(corValida(atual) || '');
  return caixa;
}

// Manda no máximo uma mensagem a cada "ms" (a última sempre chega); null passa na hora.
export function limitador(enviar, ms = 40) {
  let ultimo = 0, pendente, timer = null;
  return valor => {
    clearTimeout(timer);
    const agora = performance.now();
    if (valor == null || agora - ultimo >= ms) { ultimo = agora; enviar(valor); return; }
    pendente = valor;
    timer = setTimeout(() => { ultimo = performance.now(); enviar(pendente); }, ms - (agora - ultimo));
  };
}

// título de bloco com um botão pequeno à direita
export const titulo = (texto, botao) => el('div', { class: 'titulo' }, el('h3', { texto }), botao || null);
