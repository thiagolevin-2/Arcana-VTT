// tabuleiro.js — desenha o mapa, a grade e os tokens num <canvas> e cuida do mouse/dedo.
// Coordenadas do "mundo" = pixels do mapa original. A "câmera" (vista) diz
// qual pedaço do mundo aparece na tela e com que zoom.

import { calcularVisao, comoVe, caminhoDoPoligono, distanciaAoSegmento, simplificarCurva } from './visao.js?v=1.0';
import { geometria, atingidos, FORMAS } from './moldes.js?v=1.0';
import { CONDICAO } from './condicoes.js?v=1.0';

export const METROS_POR_QUADRADO = 1.5;

// Distância em quadrados. Regra 2024: diagonal custa igual (1,5 m).
// Regra opcional: diagonais alternam 1,5 m e 3 m.
export function quadrados(dx, dy, regra) {
  dx = Math.abs(dx); dy = Math.abs(dy);
  const maior = Math.max(dx, dy), menor = Math.min(dx, dy);
  return regra === 'alternada' ? maior + Math.floor(menor / 2) : maior;
}

export function textoDistancia(q) {
  const m = (q * METROS_POR_QUADRADO).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `${m} m (${q} ${q === 1 ? 'quadrado' : 'quadrados'})`;
}

// Estado de um monstro como os jogadores veem (sem PV exato).
export function estadoDe(pv, max) {
  if (!(max > 0)) return '';
  if (pv <= 0) return 'Caído';
  if (pv >= max) return 'Ileso';
  return pv > max / 2 ? 'Ferido' : 'Muito ferido';
}
const COR_ESTADO = { 'Ileso': '#7fbf8a', 'Ferido': '#d9b25c', 'Muito ferido': '#e0775f', 'Caído': '#8a8a8a' };

export const celulasDe = tam => Math.max(1, Math.round(tam || 1));

// Custo em metros de andar em linha reta de (x0,y0) até (x1,y1), quadrado a quadrado.
// Terreno difícil custa o dobro (se qualquer quadrado ocupado pelo token for difícil).
export function custoMovimento(cena, tam, x0, y0, x1, y1) {
  const dificil = new Set(cena?.dificil || []), n = celulasDe(tam), alternada = cena?.grade?.diagonal === 'alternada';
  const ehDificil = (x, y) => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (dificil.has(`${x + i},${y + j}`)) return true; return false; };
  let x = x0, y = y0, metros = 0, diagonais = 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  const passos = Math.max(dx, dy);
  for (let k = 1; k <= passos; k++) {
    // caminho reto: cada passo anda 1 no eixo maior e, quando precisa, 1 no menor (diagonal)
    const nx = x0 + sx * Math.round(dx * k / passos), ny = y0 + sy * Math.round(dy * k / passos);
    const diagonal = nx !== x && ny !== y;
    let custo = METROS_POR_QUADRADO;
    if (diagonal && alternada) { diagonais++; if (diagonais % 2 === 0) custo = METROS_POR_QUADRADO * 2; }
    if (ehDificil(nx, ny)) custo *= 2;
    metros += custo; x = nx; y = ny;
  }
  return metros;
}
export const textoMetros = m => m.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' m';

export function criarTabuleiro(canvas, eventos = {}) {
  const g = canvas.getContext('2d');
  const vista = { x: 0, y: 0, escala: 1 };
  let cena = null, mapa = null, dpr = 1, largura = 0, altura = 0;
  let precisa = true;
  const imagens = new Map();       // retratos já carregados
  const pings = [];                // { x, y, cor, t0 }
  const reguas = new Map();        // réguas de outras pessoas
  const lasers = new Map();        // bolinhas com rastro: id -> { cor, pontos: [{x, y, t}] }
  const DURACAO_RASTRO = 700;      // em milissegundos
  let minhaRegua = null;           // { a, b }
  let arrasto = null;              // o que o ponteiro está fazendo agora
  const ponteiros = new Map();     // para o zoom com dois dedos
  let pinca = null;

  const api = {
    ferramenta: 'mover',
    selecionado: null,
    imagemSelecionada: null,
    // névoa: forma 'pincel' ou 'retangulo'; acao 'revelar' ou 'esconder'; raio do pincel em quadrados (0 = 1 quadrado)
    nevoa: { forma: 'redondo', acao: 'revelar', raio: 2 },
    // paredes (fase 3b): modo 'parede' | 'porta' | 'luz' | 'apagar'
    paredes: { modo: 'parede', grade: false, escuridao: 4.5 },
    // fase 4: desenho livre e moldes de magia
    desenho: { modo: 'lapis', espessura: 'media' },
    molde: { forma: 'esfera', metros: 6 },
    cadeia: null,          // ponto onde começa a próxima parede (ao desenhar paredes seguidas)
    explorado: null,       // Set "x,y" dos quadrados que o jogador já viu nesta cena
    cursor: null,
    ehMestre: false,
    corPropria: '#d3bb7c',
    redesenhar: () => { precisa = true; },
  };

  // ---------- conversões ----------
  const grade = () => cena?.grade || { tam: 70, ox: 0, oy: 0 };
  const telaParaMundo = (sx, sy) => ({ x: sx / vista.escala + vista.x, y: sy / vista.escala + vista.y });
  const celulaEm = (wx, wy) => { const q = grade(); return { cx: Math.floor((wx - q.ox) / q.tam), cy: Math.floor((wy - q.oy) / q.tam) }; };
  const centroCelula = (cx, cy) => { const q = grade(); return { x: q.ox + (cx + 0.5) * q.tam, y: q.oy + (cy + 0.5) * q.tam }; };
  function centroToken(t, x = t.x, y = t.y) {
    const q = grade(), n = celulasDe(t.tam);
    return { x: q.ox + (x + n / 2) * q.tam, y: q.oy + (y + n / 2) * q.tam };
  }
  function tamanhoMundo() {
    if (mapa) return { w: mapa.w, h: mapa.h };
    const q = grade();
    return { w: q.ox + (cena?.colunas || 30) * q.tam, h: q.oy + (cena?.linhas || 20) * q.tam };
  }
  function pos(e) { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

  function tokenEm(wx, wy) {
    if (!cena) return null;
    for (let i = cena.tokens.length - 1; i >= 0; i--) {
      const t = cena.tokens[i], c = centroToken(t), raio = celulasDe(t.tam) * grade().tam / 2;
      if ((wx - c.x) ** 2 + (wy - c.y) ** 2 <= raio * raio) return t;
    }
    return null;
  }

  // ---------- API pública ----------
  api.definirCena = c => { cena = c; precisa = true; };
  api.definirMapa = m => { mapa = m; precisa = true; };
  api.cena = () => cena;
  api.vista = vista;
  api.centroDaTela = () => telaParaMundo(largura / 2, altura / 2);
  api.celulaEm = celulaEm;

  api.enquadrar = () => {
    const { w, h } = tamanhoMundo();
    const e = Math.min(largura / w, altura / h) * 0.95 || 1;
    vista.escala = e; vista.x = w / 2 - largura / 2 / e; vista.y = h / 2 - altura / 2 / e;
    precisa = true;
  };
  api.centralizarEm = t => {
    const c = centroToken(t);
    vista.x = c.x - largura / 2 / vista.escala; vista.y = c.y - altura / 2 / vista.escala; precisa = true;
  };
  api.mostrarPing = (x, y, cor) => { pings.push({ x, y, cor, t0: performance.now() }); precisa = true; };
  // acrescenta um ponto ao rastro da bolinha de alguém (x = null: soltou o botão)
  api.mostrarLaser = (id, x, y, cor) => {
    let l = lasers.get(id);
    if (!l) { l = { cor, pontos: [], ativo: true }; lasers.set(id, l); }
    l.cor = cor;
    if (x == null) l.ativo = false;
    else { l.ativo = true; l.pontos.push({ x, y, t: performance.now() }); if (l.pontos.length > 200) l.pontos.shift(); }
    precisa = true;
  };
  api.mostrarRegua = (id, a, b, cor, nome) => {
    if (!a) reguas.delete(id); else reguas.set(id, { a, b, cor, nome });
    precisa = true;
  };

  // ---------- desenho ----------
  function redimensionar() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    largura = r.width; altura = r.height;
    canvas.width = Math.round(largura * dpr); canvas.height = Math.round(altura * dpr);
    precisa = true;
  }
  new ResizeObserver(redimensionar).observe(canvas);
  redimensionar();

  function imagem(src) {
    let im = imagens.get(src);
    if (!im) { im = new Image(); im.onload = () => { precisa = true; }; im.src = src; imagens.set(src, im); }
    return im.complete && im.naturalWidth ? im : null;
  }

  function desenharMapa() {
    // o fundo cobre a tela inteira, não só o mapa
    const f0 = telaParaMundo(0, 0), f1 = telaParaMundo(largura, altura);
    g.fillStyle = cena?.fundo || '#2a2f2b';
    g.fillRect(f0.x, f0.y, f1.x - f0.x, f1.y - f0.y);
    if (!mapa) return;
    const larguraNaTela = mapa.w * vista.escala * dpr;
    if (mapa.geral && larguraNaTela <= mapa.geral.width * 1.3) {
      g.drawImage(mapa.geral, 0, 0, mapa.w, mapa.h);
      return;
    }
    const v0 = telaParaMundo(0, 0), v1 = telaParaMundo(largura, altura);
    const emenda = 1 / (vista.escala * dpr); // cobre a linha fininha entre pedaços
    for (const p of mapa.pedacos) {
      const x = p.x * mapa.escala, y = p.y * mapa.escala, pw = p.w * mapa.escala, ph = p.h * mapa.escala;
      if (x > v1.x || y > v1.y || x + pw < v0.x || y + ph < v0.y) continue;
      g.drawImage(p.img, x, y, pw + emenda, ph + emenda);
    }
  }

// ---------- névoa de guerra (pintada pelo mestre, quadrado a quadrado) ----------
  // cena.nevoa = { ativa, reveladas: ["x,y", …] }. O jogador vê preto onde não foi revelado;
  // o mestre vê um véu escuro transparente (para enxergar o que está escondido).
  function desenharNevoa() {
    const n = cena?.nevoa;
    if (!n?.ativa) return;
    const q = grade(), v0 = telaParaMundo(0, 0), v1 = telaParaMundo(largura, altura);
    const x0 = Math.floor((v0.x - q.ox) / q.tam) - 1, y0 = Math.floor((v0.y - q.oy) / q.tam) - 1;
    const x1 = Math.ceil((v1.x - q.ox) / q.tam) + 1, y1 = Math.ceil((v1.y - q.oy) / q.tam) + 1;
    g.save();
    g.beginPath();
    g.rect(q.ox + x0 * q.tam, q.oy + y0 * q.tam, (x1 - x0) * q.tam, (y1 - y0) * q.tam);
    // recorta os quadrados revelados (regra "evenodd": o que está dentro de dois retângulos fica vazio)
    for (const chave of n.reveladas || []) {
      const i = chave.indexOf(','), cx = +chave.slice(0, i), cy = +chave.slice(i + 1);
      if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) continue;
      g.rect(q.ox + cx * q.tam, q.oy + cy * q.tam, q.tam, q.tam);
    }
    g.fillStyle = api.ehMestre ? 'rgba(4,7,5,.55)' : '#070a08';
    g.fill('evenodd');
    // quadrados recém-revelados: a névoa vai sumindo aos poucos (em vez de sumir de uma vez)
    const lista = n.reveladas || [];
    if (lista !== nevoaVista.lista) {
      const agora = performance.now(), mesma = nevoaVista.cena === cena?.id && nevoaVista.set;
      const novo = new Set(lista);
      if (mesma) for (const k of novo) if (!nevoaVista.set.has(k)) sumindo.set(k, agora);
      nevoaVista = { cena: cena?.id, lista, set: novo };
    }
    if (sumindo.size) {
      const agora = performance.now();
      for (const [k, t0] of sumindo) {
        const f = 1 - (agora - t0) / DURACAO_SUMIR;
        if (f <= 0) { sumindo.delete(k); continue; }
        const i = k.indexOf(','), cx = +k.slice(0, i), cy = +k.slice(i + 1);
        g.globalAlpha = f * (api.ehMestre ? 0.55 : 1); g.fillStyle = api.ehMestre ? 'rgb(4,7,5)' : '#070a08';
        g.fillRect(q.ox + cx * q.tam, q.oy + cy * q.tam, q.tam + 0.5, q.tam + 0.5);
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }
  let nevoaVista = { cena: null, lista: null, set: null };
  const sumindo = new Map(), DURACAO_SUMIR = 900;
  // quadrados do pincel em volta de uma célula
  function celulasDoPincel(c) {
    // pincel "quadrado" pega um quadrado de lado 2r+1; o "redondo" só os quadrados dentro do círculo
    const r = Math.max(0, Math.min(15, api.nevoa.raio | 0)), redondo = api.nevoa.forma === 'redondo', lista = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (redondo && dx * dx + dy * dy > (r + 0.5) * (r + 0.5)) continue;
      lista.push(`${c.cx + dx},${c.cy + dy}`);
    }
    return lista;
  }
  function celulasDoRetangulo(a, b) {
    const lista = [];
    for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) lista.push(`${x},${y}`);
    return lista;
  }

// ---------- paredes, portas e luzes (fase 3b) ----------
  const pontoNaGrade = p => { const q = grade(); return { x: q.ox + Math.round((p.x - q.ox) / q.tam) * q.tam, y: q.oy + Math.round((p.y - q.oy) / q.tam) * q.tam }; };
  // Onde a parede começa ou termina: livre (padrão) ou presa aos cantos da grade (opção "Encaixar na grade" ou Ctrl).
  // Perto da ponta de outra parede, gruda nela, para as paredes fecharem sem frestas.
  let ctrlApertado = false;
  function pontoParede(p) {
    const lim = 9 / vista.escala;
    let melhor = null, dist = lim;
    for (const w of cena?.paredes || []) for (const e of [w.a, w.b]) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d <= dist) { dist = d; melhor = e; } }
    if (melhor) return { x: melhor.x, y: melhor.y };
    if (api.paredes.grade !== ctrlApertado) return pontoNaGrade(p);
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }
  function portaEm(p) {
    const lim = 12 / vista.escala;
    for (const w of cena?.paredes || []) if (w.tipo === 'porta') {
      const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      if (Math.hypot(p.x - m.x, p.y - m.y) <= lim || distanciaAoSegmento(p, w.a, w.b) <= lim / 2) return w;
    }
    return null;
  }
  function desenharParedes(soPortas) {
    const px = 1 / vista.escala;
    g.save(); g.lineCap = 'round';
    for (const w of cena?.paredes || []) {
      if (w.tipo !== 'porta') {
        if (soPortas) continue;
        g.strokeStyle = '#e8a046'; g.lineWidth = 4 * px;
        g.beginPath(); g.moveTo(w.a.x, w.a.y); g.lineTo(w.b.x, w.b.y); g.stroke();
        continue;
      }
      const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      g.strokeStyle = w.aberta ? '#7fd08a' : w.trancada ? '#e0645a' : '#c88a3a'; g.lineWidth = (w.aberta ? 3 : 6) * px;
      if (w.aberta) g.setLineDash([8 * px, 6 * px]);
      g.beginPath(); g.moveTo(w.a.x, w.a.y); g.lineTo(w.b.x, w.b.y); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#111914'; g.strokeStyle = g.strokeStyle; g.lineWidth = 2 * px;
      g.beginPath(); g.arc(m.x, m.y, 9 * px, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#e5eadf'; g.font = `700 ${11 * px}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(w.trancada ? '🔒' : w.aberta ? '◫' : '▯', m.x, m.y + 0.5 * px);
    }
    if (!soPortas) for (const l of eventos.luzesParaDesenhar?.() || []) {
      g.strokeStyle = 'rgba(255,214,120,.5)'; g.lineWidth = 1.5 * px; g.setLineDash([5 * px, 5 * px]);
      g.beginPath(); g.arc(l.x, l.y, l.plena, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(l.x, l.y, l.plena + l.penumbra, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      if (l.fixa) { g.fillStyle = '#ffd678'; g.beginPath(); g.arc(l.x, l.y, 7 * px, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#3a2a08'; g.lineWidth = 2 * px; g.stroke(); }
    }
    g.restore();
  }
  // prévia da parede sendo desenhada
  function desenharPreviaParede() {
    if (api.ferramenta !== 'paredes' || !api.cursor) return;
    const px = 1 / vista.escala, modo = api.paredes.modo;
    if (modo === 'escuridao') {
      const r = api.paredes.escuridao / METROS_POR_QUADRADO * grade().tam;
      g.save(); g.strokeStyle = '#b48cff'; g.lineWidth = 2 * px; g.setLineDash([6 * px, 5 * px]);
      g.beginPath(); g.arc(api.cursor.x, api.cursor.y, r, 0, Math.PI * 2); g.stroke(); g.restore(); return;
    }
    if (modo === 'luz' || modo === 'apagar') return;
    const p = pontoParede(api.cursor);
    g.save(); g.fillStyle = '#e8a046'; g.beginPath(); g.arc(p.x, p.y, 4 * px, 0, Math.PI * 2); g.fill();
    if (arrasto?.tipo === 'curva' && arrasto.pontos.length > 1) {
      g.strokeStyle = '#e8a046'; g.lineWidth = 3 * px; g.lineJoin = 'round'; g.beginPath();
      arrasto.pontos.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
    }
    const de = api.paredes.modo === 'parede' ? api.cadeia : arrasto?.tipo === 'porta' ? arrasto.a : null;
    if (de) { g.strokeStyle = api.paredes.modo === 'porta' ? '#c88a3a' : '#e8a046'; g.lineWidth = 3 * px; g.setLineDash([8 * px, 6 * px]); g.beginPath(); g.moveTo(de.x, de.y); g.lineTo(p.x, p.y); g.stroke(); }
    g.restore();
  }
  // escuridão mágica: o jogador vê preto (por cima de tudo, até dos tokens); o mestre vê uma mancha roxa
  function desenharEscuridao() {
    const lista = eventos.escuridoesParaDesenhar?.() || [];
    if (!lista.length) return false;
    const px = 1 / vista.escala;
    g.save();
    for (const e of lista) {
      g.beginPath(); g.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      if (api.ehMestre) {
        g.fillStyle = 'rgba(28,6,44,.55)'; g.fill();
        g.strokeStyle = '#b48cff'; g.lineWidth = 2 * px; g.setLineDash([7 * px, 5 * px]); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#d9c4ff'; g.font = `600 ${12 * px}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('Escuridão mágica', e.x, e.y);
      } else { g.fillStyle = '#000'; g.fill(); }
    }
    g.restore();
    return true;
  }

  // ---------- desenho livre (fase 4) ----------
  // cena.desenhos = [{ id, dono, cor, larg (no mundo), pontos: [x, y, x, y, …] }]
  function traco(d) {
    const p = d.pontos; if (!p || p.length < 2) return;
    g.strokeStyle = d.cor; g.lineWidth = d.larg; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(p[0], p[1]);
    if (p.length === 2) g.lineTo(p[0] + 0.01, p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  }
  function desenharDesenhos() {
    for (const d of cena?.desenhos || []) traco(d);
    if (arrasto?.tipo === 'desenho') traco(arrasto.d);
  }
  const ESPESSURAS = { fina: 0.05, media: 0.1, grossa: 0.2 };
  function desenhoEm(p) {
    const lim = 8 / vista.escala, lista = cena?.desenhos || [];
    for (let i = lista.length - 1; i >= 0; i--) {
      const d = lista[i], q = d.pontos;
      for (let k = 0; k + 1 < q.length; k += 2) {
        const a = { x: q[k], y: q[k + 1] }, b = k + 3 < q.length ? { x: q[k + 2], y: q[k + 3] } : a;
        if (distanciaAoSegmento(p, a, b) <= lim + d.larg / 2) return d;
      }
    }
    return null;
  }

  // ---------- moldes de magia (fase 4) ----------
  // quem o jogador vê agora (com a visão dinâmica, monstros fora da vista não contam como atingidos)
  let visaoAtual = null;
  function vistoAgora(t) {
    if (!visaoAtual || api.ehMestre || eventos.ehMeu?.(t)) return true;
    const c = centroToken(t);
    return !!comoVe(c, visaoAtual);
  }
  function caminhoDoMolde(m) {
    const q = grade(), gm = geometria(m, q.tam), c = new Path2D();
    if (gm.tipo === 'circulo') c.arc(gm.c.x, gm.c.y, gm.r, 0, Math.PI * 2);
    else if (gm.tipo === 'quadrado') c.rect(gm.c.x - gm.lado / 2, gm.c.y - gm.lado / 2, gm.lado, gm.lado);
    else { gm.pontos.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); }
    return c;
  }
  api.atingidosPor = m => (cena ? atingidos(m, cena.tokens.filter(vistoAgora), grade()) : []);
  function desenharMolde(m, previa) {
    const px = 1 / vista.escala, cor = m.cor || api.corPropria, caminho = caminhoDoMolde(m);
    g.save();
    g.globalAlpha = previa ? 0.28 : 0.2; g.fillStyle = cor; g.fill(caminho);
    g.globalAlpha = 1; g.strokeStyle = cor; g.lineWidth = 2.5 * px; if (previa) g.setLineDash([8 * px, 5 * px]); g.stroke(caminho); g.setLineDash([]);
    g.fillStyle = cor; g.beginPath(); g.arc(m.a.x, m.a.y, 4 * px, 0, Math.PI * 2); g.fill();
    // quem está dentro: anel vermelho
    const alvo = api.atingidosPor(m), q = grade();
    for (const t of alvo) {
      const c = centroToken(t), r = Math.max(0.5, celulasDe(t.tam)) * q.tam / 2;
      g.strokeStyle = '#ff5a4a'; g.lineWidth = 3 * px; g.beginPath(); g.arc(c.x, c.y, r * 0.98, 0, Math.PI * 2); g.stroke();
    }
    const nome = (m.nome ? m.nome + ' · ' : '') + `${FORMAS[m.forma]?.nome.split(' ')[0] || ''} ${String(m.metros).replace('.', ',')} m`;
    const gm = geometria(m, q.tam), topo = gm.tipo === 'circulo' ? gm.c.y - gm.r : gm.tipo === 'quadrado' ? gm.c.y - gm.lado / 2 : Math.min(...gm.pontos.map(p => p.y));
    rotulo(`${nome} · ${alvo.length} ${alvo.length === 1 ? 'atingido' : 'atingidos'}`, gm.tipo === 'circulo' || gm.tipo === 'quadrado' ? gm.c.x : m.a.x, topo - 24 * px, 12 * px, 'rgba(17,25,20,.92)', '#ffd9d4');
    g.restore();
  }
  function moldeDoArrasto(a, b, tk = arrasto?.token) {
    const o = api.molde, m = { id: 'previa', forma: o.forma, a, b, metros: o.metros, largura: o.largura || 1.5, cor: api.corPropria, nome: o.nome || '' };
    if (o.forma === 'emanacao' && tk) { const t = tk; m.a = centroToken(t); m.origem = t.id; m.raioExtra = Math.max(0.5, celulasDe(t.tam)) * grade().tam / 2; }
    return m;
  }
  // origem do molde: presa aos cantos e centros dos quadrados (meio quadrado)
  const pontoDoMolde = p => { const q = grade(), h = q.tam / 2; return { x: q.ox + Math.round((p.x - q.ox) / h) * h, y: q.oy + Math.round((p.y - q.oy) / h) * h }; };

  // buffers: uma "foto" do fundo (sem tokens) e outra do quadro inteiro
  const bufFundo = document.createElement('canvas'), bufTudo = document.createElement('canvas');
  function copiar(buf) {
    if (buf.width !== canvas.width || buf.height !== canvas.height) { buf.width = canvas.width; buf.height = canvas.height; }
    const b = buf.getContext('2d'); b.clearRect(0, 0, buf.width, buf.height); b.drawImage(canvas, 0, 0);
  }
  let ultimaVisao = null;
  // marca como explorados os quadrados que o personagem vê agora
  function explorar(v) {
    if (!api.explorado || v === ultimaVisao) return;
    ultimaVisao = v;
    const q = grade();
    for (const o of v.observadores) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of o.poli) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      // só a parte que aparece na tela (com folga): o alcance da visão pode ser enorme
      const t0 = telaParaMundo(-largura * 0.5, -altura * 0.5), t1 = telaParaMundo(largura * 1.5, altura * 1.5);
      x0 = Math.max(x0, t0.x); y0 = Math.max(y0, t0.y); x1 = Math.min(x1, t1.x); y1 = Math.min(y1, t1.y);
      const cx0 = Math.floor((x0 - q.ox) / q.tam), cy0 = Math.floor((y0 - q.oy) / q.tam), cx1 = Math.ceil((x1 - q.ox) / q.tam), cy1 = Math.ceil((y1 - q.oy) / q.tam);
      if ((cx1 - cx0) * (cy1 - cy0) > 40000) continue;
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const chave = `${cx},${cy}`;
        if (api.explorado.has(chave)) continue;
        if (comoVe({ x: q.ox + (cx + 0.5) * q.tam, y: q.oy + (cy + 0.5) * q.tam }, v)) api.explorado.add(chave);
      }
    }
  }
  // pinta de preto o que não se vê e recoloca o que se vê
  function comporVisao(v, e) {
    const W = canvas.width, H = canvas.height, mundo = () => g.setTransform(e, 0, 0, e, -vista.x * e, -vista.y * e), tela = () => g.setTransform(1, 0, 0, 1, 0, 0);
    const desenharCom = (buf, recorte, filtro, escurecer) => {
      g.save(); mundo(); recorte(); tela();
      if (filtro) g.filter = filtro;
      g.drawImage(buf, 0, 0); g.filter = 'none';
      if (escurecer) { g.fillStyle = `rgba(0,0,0,${escurecer})`; g.fillRect(0, 0, W, H); }
      g.restore();
    };
    tela(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    // o que já foi explorado: o mapa (sem tokens), escurecido
    if (api.explorado?.size) {
      const q = grade(), c = new Path2D(), v0 = telaParaMundo(0, 0), v1 = telaParaMundo(largura, altura);
      for (const chave of api.explorado) {
        const i = chave.indexOf(','), cx = +chave.slice(0, i), cy = +chave.slice(i + 1), x = q.ox + cx * q.tam, y = q.oy + cy * q.tam;
        if (x > v1.x || y > v1.y || x + q.tam < v0.x || y + q.tam < v0.y) continue;
        c.rect(x, y, q.tam, q.tam);
      }
      desenharCom(bufFundo, () => g.clip(c), 'grayscale(.6)', 0.55);
    }
    const linha = () => g.clip(v.caminhoVisao);
    if (v.ambiente === 'dia') { desenharCom(bufTudo, linha); return; }
    if (v.ambiente === 'penumbra') desenharCom(bufTudo, linha, null, 0.4);
    // visão no escuro: cinza
    for (const o of v.observadores) if (o.escuro > 0) {
      desenharCom(bufTudo, () => { g.clip(caminhoDoPoligono(o.poli)); const c = new Path2D(); c.arc(o.x, o.y, o.escuro, 0, Math.PI * 2); g.clip(c); }, 'grayscale(1) brightness(.85)');
    }
    // luzes: primeiro a penumbra (um pouco escura), depois a luz plena por cima
    for (const l of v.luzes) desenharCom(bufTudo, () => { linha(); g.clip(caminhoDoPoligono(l.poli)); const c = new Path2D(); c.arc(l.x, l.y, l.plena + l.penumbra, 0, Math.PI * 2); g.clip(c); }, null, 0.35);
    for (const l of v.luzes) if (l.plena > 0) desenharCom(bufTudo, () => { linha(); g.clip(caminhoDoPoligono(l.poli)); const c = new Path2D(); c.arc(l.x, l.y, l.plena, 0, Math.PI * 2); g.clip(c); });
  }

  // terreno difícil: quadrados com listras alaranjadas
  function desenharTerreno() {
    const lista = cena?.dificil;
    if (!lista?.length) return;
    const q = grade(), px = 1 / vista.escala, v0 = telaParaMundo(0, 0), v1 = telaParaMundo(largura, altura);
    g.save();
    for (const chave of lista) {
      const [cx, cy] = chave.split(',').map(Number);
      const x = q.ox + cx * q.tam, y = q.oy + cy * q.tam;
      if (x > v1.x || y > v1.y || x + q.tam < v0.x || y + q.tam < v0.y) continue;
      g.fillStyle = 'rgba(214,140,58,.16)'; g.fillRect(x, y, q.tam, q.tam);
      g.save(); g.beginPath(); g.rect(x, y, q.tam, q.tam); g.clip();
      g.strokeStyle = 'rgba(232,160,70,.55)'; g.lineWidth = Math.max(1.2 * px, q.tam * 0.03);
      g.beginPath();
      for (let k = -q.tam; k < q.tam; k += q.tam / 4) { g.moveTo(x + k, y + q.tam); g.lineTo(x + k + q.tam, y); }
      g.stroke(); g.restore();
    }
    g.restore();
  }

  function desenharGrade() {
    const q = grade();
    if (!cena || cena.grade?.mostrar === false || q.tam * vista.escala < 4) return;
    // a grade cobre a tela inteira, além do tamanho do mapa
    const v0 = telaParaMundo(0, 0), v1 = telaParaMundo(largura, altura);
    const x0 = v0.x, y0 = v0.y, x1 = v1.x, y1 = v1.y;
    g.beginPath();
    for (let cx = Math.ceil((x0 - q.ox) / q.tam); q.ox + cx * q.tam <= x1; cx++) { const x = q.ox + cx * q.tam; g.moveTo(x, y0); g.lineTo(x, y1); }
    for (let cy = Math.ceil((y0 - q.oy) / q.tam); q.oy + cy * q.tam <= y1; cy++) { const y = q.oy + cy * q.tam; g.moveTo(x0, y); g.lineTo(x1, y); }
    g.strokeStyle = q.cor || '#000000';
    g.globalAlpha = q.opacidade ?? 0.35;
    g.lineWidth = 1 / vista.escala;
    g.stroke();
    g.globalAlpha = 1;
  }

  function rotulo(texto, x, y, tamFonte, corFundo = 'rgba(17,25,20,.86)', corTexto = '#e5eadf') {
    g.font = `600 ${tamFonte}px system-ui, sans-serif`;
    const larg = g.measureText(texto).width + tamFonte * 0.9, alt = tamFonte * 1.5;
    g.fillStyle = corFundo;
    g.beginPath(); g.roundRect(x - larg / 2, y, larg, alt, alt / 2); g.fill();
    g.fillStyle = corTexto; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(texto, x, y + alt / 2 + tamFonte * 0.04);
  }

  function desenharToken(t, x = t.x, y = t.y, fantasma = false) {
    const q = grade(), n = celulasDe(t.tam), c = centroToken(t, x, y);
    const raio = Math.max(0.25, Math.min(n, t.tam || 1)) * q.tam / 2 * 0.88;
    const px = 1 / vista.escala; // 1 pixel da tela em unidades do mundo
    g.save();
    if (fantasma) g.globalAlpha = 0.55;
    else if (t.oculto) g.globalAlpha = 0.45;
    else if (eventos.apagado?.(t)) g.globalAlpha = 0.3; // dono offline (só o mestre vê)
    else if (t.condicoes?.includes('invisivel')) g.globalAlpha = 0.5;
    // sombra
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.arc(c.x, c.y + raio * 0.08, raio * 1.04, 0, Math.PI * 2); g.fill();
    // corpo
    g.fillStyle = t.cor || '#5b7c66';
    g.beginPath(); g.arc(c.x, c.y, raio, 0, Math.PI * 2); g.fill();
    const im = t.img ? imagem(t.img) : null;
    if (im) {
      g.save(); g.beginPath(); g.arc(c.x, c.y, raio * 0.9, 0, Math.PI * 2); g.clip();
      const f = Math.max(raio * 1.8 / im.naturalWidth, raio * 1.8 / im.naturalHeight);
      g.drawImage(im, c.x - im.naturalWidth * f / 2, c.y - im.naturalHeight * f / 2, im.naturalWidth * f, im.naturalHeight * f);
      g.restore();
    } else {
      const iniciais = (t.nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
      g.fillStyle = '#fff'; g.font = `700 ${raio * 0.8}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(iniciais, c.x, c.y + raio * 0.04);
    }
    // borda
    g.lineWidth = Math.max(raio * 0.1, 2 * px);
    g.strokeStyle = t.oculto ? '#9aa39b' : (t.tipo === 'pc' ? '#e5eadf' : '#1b1b1b');
    if (t.oculto) g.setLineDash([raio * 0.25, raio * 0.18]);
    g.beginPath(); g.arc(c.x, c.y, raio, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    const extra = fantasma ? null : eventos.extraDoToken?.(t);
    if (extra?.vez) {
      // é a vez deste token: anel verde pulsando
      const k = (Math.sin(performance.now() / 260) + 1) / 2;
      g.strokeStyle = '#7fd08a'; g.lineWidth = (3 + 2 * k) * px; g.globalAlpha = 0.6 + 0.4 * k;
      g.beginPath(); g.arc(c.x, c.y, raio + (8 + 3 * k) * px, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = t.oculto ? 0.45 : 1;
    }
    if (api.selecionado === t.id && !fantasma) {
      g.strokeStyle = '#d3bb7c'; g.lineWidth = 3 * px;
      g.beginPath(); g.arc(c.x, c.y, raio + 5 * px, 0, Math.PI * 2); g.stroke();
    }
    if (extra?.texto) {
      const f = Math.max(10 * px, Math.min(q.tam * 0.18, 13 * px));
      rotulo(extra.texto, c.x, c.y - raio - f * 3.4, f, extra.alerta ? 'rgba(120,30,25,.92)' : 'rgba(17,25,20,.86)', extra.alerta ? '#ffd9d4' : '#cfe3c9');
    }
    if (!fantasma) {
      // barra de vida (jogadores sempre; monstros só para o mestre)
      const larg = raio * 1.7, altB = Math.max(raio * 0.16, 4 * px);
      const temPV = t.pvMax > 0 && typeof t.pv === 'number';
      if (temPV) {
        const f = Math.max(0, Math.min(1, t.pv / t.pvMax));
        g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(c.x - larg / 2, c.y - raio - altB * 1.6, larg, altB);
        g.fillStyle = f > 0.5 ? '#6fbf73' : f > 0.25 ? '#d9b25c' : '#e0645a';
        g.fillRect(c.x - larg / 2, c.y - raio - altB * 1.6, larg * f, altB);
      } else if (t.estado) {
        g.fillStyle = COR_ESTADO[t.estado] || '#999';
        g.beginPath(); g.arc(c.x + raio * 0.72, c.y - raio * 0.72, Math.max(raio * 0.2, 5 * px), 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#111'; g.lineWidth = 1.5 * px; g.stroke();
      }
      const fonte = Math.max(11 * px, Math.min(q.tam * 0.2, 15 * px));
      const texto = t.estado && !temPV ? `${t.nome} · ${t.estado}` : t.nome;
      if (texto) rotulo(texto, c.x, c.y + raio + 4 * px, fonte);
      // condições: bolinhas com ícone em volta do lado esquerdo do token
      const icones = (t.condicoes || []).map(k => CONDICAO[k]?.icone).filter(Boolean);
      if (t.exaustao > 0) icones.push('😩' + t.exaustao);
      if (icones.length) {
        const r = Math.max(raio * 0.3, 9 * px);
        g.font = `${r * 1.15}px system-ui, "Segoe UI Emoji", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        icones.slice(0, 8).forEach((ic, i) => {
          const ang = Math.PI * (1.05 + i * 0.24), x = c.x + Math.cos(ang) * raio * 1.02, y = c.y + Math.sin(ang) * raio * 1.02 + raio * 0.3;
          g.fillStyle = 'rgba(17,25,20,.92)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#d3bb7c'; g.lineWidth = 1.2 * px; g.stroke();
          g.fillStyle = '#fff';
          if (ic.length > 2 && ic.startsWith('😩')) { g.font = `700 ${r * 1.05}px system-ui`; g.fillText(ic.slice(2), x, y + r * 0.05); g.font = `${r * 1.15}px system-ui, "Segoe UI Emoji", sans-serif`; }
          else g.fillText(ic, x, y + r * 0.08);
        });
      }
    }
    g.restore();
  }

  // ---------- imagens soltas (pedaços de mapa, itens, cartas) ----------
  // Cada imagem: { id, hash, w, h, x, y (centro, no mundo), largura (no mundo), rot (0/90/180/270), camada, oculto, travado }
  const medidas = im => ({ W: im.largura, H: im.largura * im.h / im.w });
  function paraLocal(im, wx, wy) {
    const a = -(im.rot || 0) * Math.PI / 180, dx = wx - im.x, dy = wy - im.y;
    return { lx: dx * Math.cos(a) - dy * Math.sin(a), ly: dx * Math.sin(a) + dy * Math.cos(a) };
  }
  function dentro(im, wx, wy) { const { W, H } = medidas(im), { lx, ly } = paraLocal(im, wx, wy); return Math.abs(lx) <= W / 2 && Math.abs(ly) <= H / 2; }
  function naAlca(im, wx, wy) {
    const { W, H } = medidas(im), { lx, ly } = paraLocal(im, wx, wy), r = 12 / vista.escala;
    return Math.abs(lx - W / 2) <= r && Math.abs(ly - H / 2) <= r;
  }
  function imagemEm(wx, wy) {
    const lista = cena?.imagens || [];
    for (const camada of ['objeto', 'fundo']) {
      for (let i = lista.length - 1; i >= 0; i--) if ((lista[i].camada || 'objeto') === camada && dentro(lista[i], wx, wy)) return lista[i];
    }
    return null;
  }
  function desenharImagem(im) {
    const { W, H } = medidas(im), px = 1 / vista.escala;
    g.save();
    g.translate(im.x, im.y); g.rotate((im.rot || 0) * Math.PI / 180);
    if (im.oculto) g.globalAlpha = 0.5;
    const m = eventos.imagemDe?.(im.hash);
    if (m) {
      const k = W / m.iw;
      if (m.geral && W * vista.escala * dpr <= m.geral.width * 1.3) g.drawImage(m.geral, -W / 2, -H / 2, W, H);
      else for (const p of m.pedacos) g.drawImage(p.img, -W / 2 + p.x * k, -H / 2 + p.y * k, p.w * k + px, p.h * k + px);
    } else {
      g.fillStyle = 'rgba(17,25,20,.6)'; g.fillRect(-W / 2, -H / 2, W, H);
      g.strokeStyle = '#a1ad9e'; g.setLineDash([6 * px, 5 * px]); g.lineWidth = 1.5 * px; g.strokeRect(-W / 2, -H / 2, W, H); g.setLineDash([]);
    }
    if (api.imagemSelecionada === im.id) {
      g.globalAlpha = 1;
      g.strokeStyle = '#d3bb7c'; g.lineWidth = 2 * px; g.strokeRect(-W / 2, -H / 2, W, H);
      if (!im.travado) {
        g.fillStyle = '#d3bb7c'; g.fillRect(W / 2 - 7 * px, H / 2 - 7 * px, 14 * px, 14 * px);
        g.strokeStyle = '#111914'; g.lineWidth = 1.5 * px; g.strokeRect(W / 2 - 7 * px, H / 2 - 7 * px, 14 * px, 14 * px);
      }
    }
    g.restore();
  }

  function desenharLinha(a, b, cor, nome, textoPronto) {
    const px = 1 / vista.escala, cena0 = cena;
    const ca = centroCelula(a.cx, a.cy), cb = centroCelula(b.cx, b.cy);
    g.strokeStyle = cor; g.lineWidth = 4 * px; g.lineCap = 'round';
    g.setLineDash([10 * px, 7 * px]);
    g.beginPath(); g.moveTo(ca.x, ca.y); g.lineTo(cb.x, cb.y); g.stroke();
    g.setLineDash([]);
    g.fillStyle = cor;
    for (const p of [ca, cb]) { g.beginPath(); g.arc(p.x, p.y, 5 * px, 0, Math.PI * 2); g.fill(); }
    const q = quadrados(b.cx - a.cx, b.cy - a.cy, cena0?.grade?.diagonal);
    rotulo((nome ? nome + ': ' : '') + (textoPronto || textoDistancia(q)), cb.x, cb.y + 12 * px, 14 * px, 'rgba(17,25,20,.92)', cor);
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    const animando = pings.length > 0 || lasers.size > 0 || api.pulsando || sumindo.size > 0;
    if (!precisa && !animando) return;
    precisa = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0d1310'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (!cena) return;
    const e = vista.escala * dpr;
    g.setTransform(e, 0, 0, e, -vista.x * e, -vista.y * e);
    g.imageSmoothingQuality = 'high';
    desenharMapa();
    const imgs = cena.imagens || [];
    for (const im of imgs) if (im.camada === 'fundo') desenharImagem(im);
    desenharTerreno();
    desenharGrade();
    for (const im of imgs) if (im.camada !== 'fundo') desenharImagem(im);
    desenharDesenhos();
    desenharNevoa();
    const temEscuridao = !api.ehMestre && desenharEscuridao();
    // visão dinâmica (fase 3b): guarda a "foto" do fundo antes dos tokens
    const cfgVisao = eventos.configVisao?.();
    const visao = cfgVisao ? calcularVisao(cfgVisao) : null;
    visaoAtual = visao;
    if (visao) { explorar(visao); copiar(bufFundo); }
    for (const t of cena.tokens) {
      if (arrasto?.tipo === 'token' && arrasto.token.id === t.id && arrasto.mexeu) continue;
      desenharToken(t);
    }
    if (arrasto?.tipo === 'token' && arrasto.mexeu) {
      const t = arrasto.token;
      desenharToken(t, t.x, t.y, true);
      const n = celulasDe(t.tam), meio = (n - 1) / 2;
      // linha do arraste mostra o custo real (terreno difícil conta dobrado)
      const custo = custoMovimento(cena, t.tam, t.x, t.y, arrasto.alvo.x, arrasto.alvo.y);
      const limite = eventos.limiteMovimento?.(t);
      const passou = limite != null && limite.andou + custo > limite.desloc;
      const textoCusto = textoMetros(custo) + (limite ? ` · total ${textoMetros(limite.andou + custo)} de ${textoMetros(limite.desloc)}` : '');
      desenharLinha({ cx: t.x + meio, cy: t.y + meio }, { cx: arrasto.alvo.x + meio, cy: arrasto.alvo.y + meio }, passou ? '#e0645a' : api.corPropria, null, textoCusto);
      desenharToken(t, arrasto.alvo.x, arrasto.alvo.y);
    }
    if (api.ferramenta === 'nevoa' && api.nevoa.forma !== 'retangulo' && api.cursor && arrasto?.tipo !== 'pan') {
      const q = grade(), c = celulaEm(api.cursor.x, api.cursor.y), r = Math.max(0, Math.min(15, api.nevoa.raio | 0));
      const cx = q.ox + (c.cx + 0.5) * q.tam, cy = q.oy + (c.cy + 0.5) * q.tam, px = 1 / vista.escala;
      g.strokeStyle = api.nevoa.acao === 'esconder' ? '#e18b82' : '#a4c29a'; g.lineWidth = 2 * px; g.setLineDash([6 * px, 5 * px]);
      g.beginPath();
      if (api.nevoa.forma === 'redondo') g.arc(cx, cy, (r + 0.5) * q.tam, 0, Math.PI * 2);
      else g.rect(cx - (r + 0.5) * q.tam, cy - (r + 0.5) * q.tam, (2 * r + 1) * q.tam, (2 * r + 1) * q.tam);
      g.stroke(); g.setLineDash([]);
    }
    if (arrasto?.tipo === 'nevoa-ret' && arrasto.b) {
      const q = grade(), a = arrasto.a, b = arrasto.b;
      const x = q.ox + Math.min(a.cx, b.cx) * q.tam, y = q.oy + Math.min(a.cy, b.cy) * q.tam;
      const w = (Math.abs(b.cx - a.cx) + 1) * q.tam, h = (Math.abs(b.cy - a.cy) + 1) * q.tam;
      g.fillStyle = arrasto.revelar ? 'rgba(164,194,154,.18)' : 'rgba(0,0,0,.35)'; g.fillRect(x, y, w, h);
      g.strokeStyle = arrasto.revelar ? '#a4c29a' : '#e18b82'; g.lineWidth = 2 / vista.escala; g.setLineDash([8 / vista.escala, 6 / vista.escala]);
      g.strokeRect(x, y, w, h); g.setLineDash([]);
    }
    if (arrasto?.tipo === 'grade' && arrasto.b) {
      const { a, b } = arrasto;
      g.strokeStyle = '#d3bb7c'; g.lineWidth = 2 / vista.escala;
      g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    if (temEscuridao) desenharEscuridao(); // por cima dos tokens também
    if (visao) {
      if (!api.ehMestre) desenharParedes(true); // o jogador só vê as portas (e só onde enxerga)
      copiar(bufTudo); comporVisao(visao, e);
      g.setTransform(e, 0, 0, e, -vista.x * e, -vista.y * e);
      for (const t of cena.tokens) if (eventos.ehMeu?.(t)) desenharToken(t); // você sempre sabe onde está
    } else if (temEscuridao) for (const t of cena.tokens) if (eventos.ehMeu?.(t)) desenharToken(t);
    if (api.ehMestre) desenharEscuridao();
    for (const m of cena.moldes || []) desenharMolde(m);
    if (arrasto?.tipo === 'molde') desenharMolde(moldeDoArrasto(arrasto.a, arrasto.b), true);
    else if (api.ferramenta === 'molde' && api.cursor && !arrasto && !celularToque) {
      const p = pontoDoMolde(api.cursor), px = 1 / vista.escala;
      g.fillStyle = api.corPropria; g.beginPath(); g.arc(p.x, p.y, 4 * px, 0, Math.PI * 2); g.fill();
    }
    if (api.ehMestre) { desenharParedes(false); desenharPreviaParede(); }
    for (const r of reguas.values()) desenharLinha(r.a, r.b, r.cor, r.nome);
    if (minhaRegua) desenharLinha(minhaRegua.a, minhaRegua.b, api.corPropria);
    // bolinhas com rastro: o rastro afina e some em 0,7 s
    for (const [id, l] of lasers) {
      while (l.pontos.length && agora - l.pontos[0].t > DURACAO_RASTRO) l.pontos.shift();
      if (!l.pontos.length) { if (!l.ativo) lasers.delete(id); continue; }
      const px = 1 / vista.escala, ps = l.pontos;
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = l.cor;
      for (let i = 1; i < ps.length; i++) {
        const k = 1 - (agora - ps[i].t) / DURACAO_RASTRO;
        g.globalAlpha = Math.max(0, k) * 0.85; g.lineWidth = (2 + 8 * k) * px;
        g.beginPath(); g.moveTo(ps[i - 1].x, ps[i - 1].y); g.lineTo(ps[i].x, ps[i].y); g.stroke();
      }
      const p = ps[ps.length - 1];
      if (l.ativo) {
        g.globalAlpha = 0.35; g.fillStyle = l.cor;
        g.beginPath(); g.arc(p.x, p.y, 14 * px, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.beginPath(); g.arc(p.x, p.y, 7 * px, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2 * px; g.stroke();
      }
      g.globalAlpha = 1;
    }
    // pings: círculos que crescem e somem
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i], t = (agora - p.t0) / 1600;
      if (t >= 1) { pings.splice(i, 1); precisa = true; continue; }
      const px = 1 / vista.escala;
      for (const atraso of [0, 0.25]) {
        const k = Math.max(0, t - atraso) / (1 - atraso);
        if (k <= 0) continue;
        g.globalAlpha = 1 - k;
        g.strokeStyle = p.cor; g.lineWidth = 4 * px;
        g.beginPath(); g.arc(p.x, p.y, (8 + k * 46) * px, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1; g.fillStyle = p.cor;
      g.beginPath(); g.arc(p.x, p.y, 5 * px, 0, Math.PI * 2); g.fill();
    }
  }
  requestAnimationFrame(quadro);

  // ---------- mouse e dedo ----------
  function zoomEm(sx, sy, fator) {
    const antes = telaParaMundo(sx, sy);
    vista.escala = Math.min(8, Math.max(0.02, vista.escala * fator));
    vista.x = antes.x - sx / vista.escala; vista.y = antes.y - sy / vista.escala;
    precisa = true;
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const { sx, sy } = pos(e);
    zoomEm(sx, sy, Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1)));
  }, { passive: false });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  let toqueLongo = null, celularToque = false;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    celularToque = e.pointerType === 'touch'; ctrlApertado = e.ctrlKey || e.metaKey;
    const p = pos(e);
    ponteiros.set(e.pointerId, p);
    if (ponteiros.size === 2) {
      // dois dedos: zoom de pinça (cancela o que estava fazendo)
      clearTimeout(toqueLongo);
      if (arrasto?.tipo === 'regua') { minhaRegua = null; eventos.aoRegua?.(null); }
      arrasto = null;
      const [a, b] = [...ponteiros.values()];
      pinca = { dist: Math.hypot(a.sx - b.sx, a.sy - b.sy), meio: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 } };
      return;
    }
    if (ponteiros.size > 2) return;
    const w = telaParaMundo(p.sx, p.sy);
    const inicio = { sx: p.sx, sy: p.sy, id: e.pointerId };
    if (e.button === 1 || e.button === 2) { arrasto = { tipo: 'pan', ...inicio, vx: vista.x, vy: vista.y }; return; }
    if (e.shiftKey || e.altKey || api.ferramenta === 'ping') { eventos.aoPing?.(w.x, w.y); arrasto = null; return; }
    if (api.ferramenta === 'laser') {
      api.mostrarLaser('eu', w.x, w.y, api.corPropria); eventos.aoLaser?.(w.x, w.y);
      arrasto = { tipo: 'laser', ...inicio }; return;
    }
    if (api.ferramenta === 'paredes' && cena) {
      const m = api.paredes.modo, p = pontoParede(w);
      if (e.button === 2 || e.button === 1) { api.cadeia = null; precisa = true; return; }
      if (m === 'parede') {
        // um ponto muito perto do anterior (o 2º clique do duplo clique) não vira parede
        if (api.cadeia && Math.hypot(api.cadeia.x - p.x, api.cadeia.y - p.y) > 3 / vista.escala) eventos.aoNovaParede?.(api.cadeia, p, 'parede');
        api.cadeia = p; precisa = true; return;
      }
      if (m === 'curva') { arrasto = { tipo: 'curva', ...inicio, pontos: [p] }; precisa = true; return; }
      if (m === 'porta') { arrasto = { tipo: 'porta', ...inicio, a: p }; precisa = true; return; }
      if (m === 'luz') { eventos.aoNovaLuz?.(w.x, w.y); return; }
      if (m === 'escuridao') { eventos.aoNovaEscuridao?.(w.x, w.y); return; }
      if (m === 'apagar') {
        const lim = 10 / vista.escala;
        const luz = (cena.luzes || []).find(l => Math.hypot(l.x - w.x, l.y - w.y) <= lim * 1.6);
        if (luz) { eventos.aoApagar?.('luz', luz.id); return; }
        const esc = [...(cena.escuridoes || [])].reverse().find(x => Math.hypot(x.x - w.x, x.y - w.y) <= x.raio / METROS_POR_QUADRADO * grade().tam);
        if (esc && !(cena.paredes || []).some(pw => distanciaAoSegmento(w, pw.a, pw.b) <= lim)) { eventos.aoApagar?.('escuridao', esc.id); return; }
        let perto = null, dist = lim;
        for (const pw of cena.paredes || []) { const d = distanciaAoSegmento(w, pw.a, pw.b); if (d <= dist) { dist = d; perto = pw; } }
        if (perto) eventos.aoApagar?.('parede', perto.id);
        return;
      }
    }
    // clicar numa porta abre/fecha (mestre: duplo clique tranca/destranca)
    if (api.ferramenta === 'mover' && e.button === 0) {
      const porta = portaEm(w);
      if (porta) { eventos.aoPorta?.(porta); arrasto = null; return; }
    }
    if (api.ferramenta === 'desenho' && cena) {
      if (api.desenho.modo === 'borracha') { const d = desenhoEm(w); if (d) eventos.aoApagarDesenho?.(d); return; }
      const larg = (ESPESSURAS[api.desenho.espessura] || 0.1) * grade().tam;
      arrasto = { tipo: 'desenho', ...inicio, d: { cor: api.desenho.cor || api.corPropria, larg: Math.round(larg * 10) / 10, pontos: [Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10] } };
      precisa = true; return;
    }
    if (api.ferramenta === 'molde' && cena) {
      const tk = api.molde.forma === 'emanacao' ? tokenEm(w.x, w.y) : null;
      if (api.molde.forma === 'emanacao' && !tk) { eventos.aoAvisoMolde?.('Emanação: clique no token de onde ela sai.'); return; }
      const a = tk ? centroToken(tk) : pontoDoMolde(w);
      arrasto = { tipo: 'molde', ...inicio, a, b: { x: w.x, y: w.y }, token: tk };
      precisa = true; return;
    }
    if (api.ferramenta === 'nevoa' && cena) {
      const c0 = celulaEm(w.x, w.y), revelar = api.nevoa.acao !== 'esconder';
      if (api.nevoa.forma === 'retangulo') { arrasto = { tipo: 'nevoa-ret', ...inicio, a: c0, b: c0, revelar }; precisa = true; return; }
      arrasto = { tipo: 'nevoa', ...inicio, revelar, ultima: `${c0.cx},${c0.cy}` };
      eventos.aoPintarNevoa?.(celulasDoPincel(c0), revelar); precisa = true; return;
    }
    if (api.ferramenta === 'terreno' && cena) {
      // o primeiro quadrado decide: pintar (se estava limpo) ou apagar (se já era difícil)
      const c0 = celulaEm(w.x, w.y), chave = `${c0.cx},${c0.cy}`;
      const pintar = !(cena.dificil || []).includes(chave);
      arrasto = { tipo: 'terreno', ...inicio, pintar, feitas: new Set([chave]) };
      eventos.aoPintarTerreno?.(chave, pintar); precisa = true; return;
    }
    if (api.ferramenta === 'regua') {
      const c = celulaEm(w.x, w.y);
      minhaRegua = { a: c, b: c }; arrasto = { tipo: 'regua', ...inicio }; precisa = true; return;
    }
    if (api.ferramenta === 'grade') { arrasto = { tipo: 'grade', ...inicio, a: w, b: null }; return; }
    const t = tokenEm(w.x, w.y);
    const sel = api.ehMestre && (cena?.imagens || []).find(i => i.id === api.imagemSelecionada);
    const im = !t && api.ehMestre ? imagemEm(w.x, w.y) : null;
    if (t && eventos.podeMover?.(t)) {
      arrasto = { tipo: 'token', ...inicio, token: t, alvo: { x: t.x, y: t.y }, mexeu: false };
    } else if (!t && sel && !sel.travado && naAlca(sel, w.x, w.y)) {
      arrasto = { tipo: 'alca', ...inicio, img: sel };
    } else if (im && !im.travado) {
      arrasto = { tipo: 'imagem', ...inicio, img: im, dx: w.x - im.x, dy: w.y - im.y };
    } else {
      arrasto = { tipo: 'pan', ...inicio, vx: vista.x, vy: vista.y, clique: t ? { token: t } : im ? { imagem: im } : 'vazio' };
    }
    // segurar o dedo parado por um tempo = ping (no celular)
    clearTimeout(toqueLongo);
    if (e.pointerType === 'touch') {
      toqueLongo = setTimeout(() => {
        if (arrasto && !arrasto.mexeu) { eventos.aoPing?.(w.x, w.y); arrasto = null; }
      }, 550);
    }
  });

  canvas.addEventListener('pointermove', e => {
    // posição do mouse no mundo (para prévias de ferramentas), mesmo sem clicar
    { const p0 = pos(e); api.cursor = telaParaMundo(p0.sx, p0.sy); ctrlApertado = e.ctrlKey || e.metaKey; if (api.ferramenta !== 'mover') precisa = true; }
    if (!ponteiros.has(e.pointerId)) return;
    const p = pos(e);
    ponteiros.set(e.pointerId, p);
    if (pinca && ponteiros.size === 2) {
      const [a, b] = [...ponteiros.values()];
      const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy), meio = { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 };
      vista.x -= (meio.sx - pinca.meio.sx) / vista.escala; vista.y -= (meio.sy - pinca.meio.sy) / vista.escala;
      zoomEm(meio.sx, meio.sy, dist / (pinca.dist || dist));
      pinca = { dist, meio };
      return;
    }
    if (!arrasto || arrasto.id !== e.pointerId) return;
    const moveu = Math.hypot(p.sx - arrasto.sx, p.sy - arrasto.sy) > 6;
    if (moveu && !arrasto.mexeu) { arrasto.mexeu = true; clearTimeout(toqueLongo); }
    const w = telaParaMundo(p.sx, p.sy);
    if (arrasto.tipo === 'pan' && arrasto.mexeu) {
      vista.x = arrasto.vx - (p.sx - arrasto.sx) / vista.escala;
      vista.y = arrasto.vy - (p.sy - arrasto.sy) / vista.escala;
      precisa = true;
    } else if (arrasto.tipo === 'token') {
      const t = arrasto.token, n = celulasDe(t.tam), q = grade();
      arrasto.alvo = { x: Math.round((w.x - q.ox) / q.tam - n / 2), y: Math.round((w.y - q.oy) / q.tam - n / 2) };
      precisa = true;
    } else if (arrasto.tipo === 'imagem' && arrasto.mexeu) {
      arrasto.img.x = w.x - arrasto.dx; arrasto.img.y = w.y - arrasto.dy; precisa = true;
    } else if (arrasto.tipo === 'alca') {
      const im = arrasto.img, { lx, ly } = paraLocal(im, w.x, w.y);
      im.largura = Math.max(16 / vista.escala, 2 * Math.max(lx, ly * im.w / im.h));
      precisa = true;
    } else if (arrasto.tipo === 'porta') {
      precisa = true;
    } else if (arrasto.tipo === 'curva') {
      const u = arrasto.pontos[arrasto.pontos.length - 1];
      if (Math.hypot(w.x - u.x, w.y - u.y) >= 4 / vista.escala) { arrasto.pontos.push({ x: w.x, y: w.y }); precisa = true; }
    } else if (arrasto.tipo === 'desenho') {
      const p = arrasto.d.pontos, n = p.length;
      if (Math.hypot(w.x - p[n - 2], w.y - p[n - 1]) >= 3 / vista.escala && n < 4000) { p.push(Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10); precisa = true; }
    } else if (arrasto.tipo === 'molde') {
      arrasto.b = { x: w.x, y: w.y }; precisa = true;
    } else if (arrasto.tipo === 'nevoa') {
      const c1 = celulaEm(w.x, w.y), chave = `${c1.cx},${c1.cy}`;
      if (chave !== arrasto.ultima) { arrasto.ultima = chave; eventos.aoPintarNevoa?.(celulasDoPincel(c1), arrasto.revelar); precisa = true; }
    } else if (arrasto.tipo === 'nevoa-ret') {
      arrasto.b = celulaEm(w.x, w.y); precisa = true;
    } else if (arrasto.tipo === 'terreno') {
      const c1 = celulaEm(w.x, w.y), chave = `${c1.cx},${c1.cy}`;
      if (!arrasto.feitas.has(chave)) { arrasto.feitas.add(chave); eventos.aoPintarTerreno?.(chave, arrasto.pintar); precisa = true; }
    } else if (arrasto.tipo === 'laser') {
      api.mostrarLaser('eu', w.x, w.y, api.corPropria); eventos.aoLaser?.(w.x, w.y);
    } else if (arrasto.tipo === 'regua') {
      minhaRegua.b = celulaEm(w.x, w.y);
      eventos.aoRegua?.(minhaRegua);
      precisa = true;
    } else if (arrasto.tipo === 'grade') {
      arrasto.b = w; precisa = true;
    }
  });

  function soltar(e) {
    ponteiros.delete(e.pointerId);
    if (ponteiros.size < 2) pinca = null;
    clearTimeout(toqueLongo);
    if (!arrasto || arrasto.id !== e.pointerId) return;
    const a = arrasto; arrasto = null; precisa = true;
    if (a.tipo === 'token') {
      if (a.mexeu && (a.alvo.x !== a.token.x || a.alvo.y !== a.token.y)) eventos.aoMover?.(a.token, a.alvo.x, a.alvo.y);
      else { api.selecionado = a.token.id; api.imagemSelecionada = null; eventos.aoSelecionar?.(a.token); }
    } else if (a.tipo === 'imagem' || a.tipo === 'alca') {
      if (a.tipo === 'alca') eventos.aoMudarImagem?.(a.img);
      else if (a.mexeu) eventos.aoMudarImagem?.(a.img);
      else { api.imagemSelecionada = a.img.id; api.selecionado = null; eventos.aoSelecionarImagem?.(a.img); }
    } else if (a.tipo === 'pan' && !a.mexeu && a.clique) {
      if (a.clique.imagem) { api.imagemSelecionada = a.clique.imagem.id; api.selecionado = null; eventos.aoSelecionarImagem?.(a.clique.imagem); }
      else {
        const t = a.clique === 'vazio' ? null : a.clique.token;
        api.selecionado = t?.id || null; api.imagemSelecionada = null; eventos.aoSelecionar?.(t);
      }
    } else if (a.tipo === 'porta') {
      const b = pontoParede(api.cursor || a.a);
      if (Math.hypot(b.x - a.a.x, b.y - a.a.y) > 3 / vista.escala) eventos.aoNovaParede?.(a.a, b, 'porta');
    } else if (a.tipo === 'curva') {
      const q = grade(), fim = pontoParede(api.cursor || a.pontos[a.pontos.length - 1]);
      const pts = simplificarCurva([...a.pontos, fim], Math.max(6 / vista.escala, q.tam * 0.2));
      if (pts.length >= 2) eventos.aoNovaCurva?.(pts);
    } else if (a.tipo === 'desenho') {
      if (a.d.pontos.length >= 2) eventos.aoDesenho?.(a.d);
    } else if (a.tipo === 'molde') {
      eventos.aoMolde?.(moldeDoArrasto(a.a, a.mexeu ? a.b : { x: a.a.x + 1, y: a.a.y }, a.token));
    } else if (a.tipo === 'nevoa') {
      eventos.aoTerminarNevoa?.();
    } else if (a.tipo === 'nevoa-ret') {
      eventos.aoPintarNevoa?.(celulasDoRetangulo(a.a, a.b), a.revelar); eventos.aoTerminarNevoa?.();
    } else if (a.tipo === 'terreno') {
      eventos.aoTerminarTerreno?.();
    } else if (a.tipo === 'laser') {
      api.mostrarLaser('eu', null, null, api.corPropria); eventos.aoLaser?.(null);
    } else if (a.tipo === 'regua') {
      minhaRegua = null; eventos.aoRegua?.(null);
    } else if (a.tipo === 'grade' && a.b) {
      const tam = (Math.abs(a.b.x - a.a.x) + Math.abs(a.b.y - a.a.y)) / 2;
      if (tam >= 8) {
        const x0 = Math.min(a.a.x, a.b.x), y0 = Math.min(a.a.y, a.b.y);
        eventos.aoAjustarGrade?.(tam, ((x0 % tam) + tam) % tam, ((y0 % tam) + tam) % tam);
      }
    }
  }
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);

  api.terminarParede = () => { api.cadeia = null; precisa = true; };
  canvas.addEventListener('dblclick', e => {
    if (api.ferramenta === 'paredes') { api.cadeia = null; precisa = true; return; }
    if (api.ehMestre) { const p0 = pos(e), porta = portaEm(telaParaMundo(p0.sx, p0.sy)); if (porta) { eventos.aoTrancar?.(porta); return; } }
    const { sx, sy } = pos(e), w = telaParaMundo(sx, sy), t = tokenEm(w.x, w.y);
    if (t) { eventos.aoEditar?.(t); return; }
    const im = api.ehMestre ? imagemEm(w.x, w.y) : null;
    if (im) { api.imagemSelecionada = im.id; api.selecionado = null; eventos.aoSelecionarImagem?.(im); }
  });

  return api;
}
