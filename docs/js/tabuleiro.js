// tabuleiro.js — desenha o mapa, a grade e os tokens num <canvas> e cuida do mouse/dedo.
// Coordenadas do "mundo" = pixels do mapa original. A "câmera" (vista) diz
// qual pedaço do mundo aparece na tela e com que zoom.

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

export function criarTabuleiro(canvas, eventos = {}) {
  const g = canvas.getContext('2d');
  const vista = { x: 0, y: 0, escala: 1 };
  let cena = null, mapa = null, dpr = 1, largura = 0, altura = 0;
  let precisa = true;
  const imagens = new Map();       // retratos já carregados
  const pings = [];                // { x, y, cor, t0 }
  const reguas = new Map();        // réguas de outras pessoas
  let minhaRegua = null;           // { a, b }
  let arrasto = null;              // o que o ponteiro está fazendo agora
  const ponteiros = new Map();     // para o zoom com dois dedos
  let pinca = null;

  const api = {
    ferramenta: 'mover',
    selecionado: null,
    imagemSelecionada: null,
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
    if (api.selecionado === t.id && !fantasma) {
      g.strokeStyle = '#d3bb7c'; g.lineWidth = 3 * px;
      g.beginPath(); g.arc(c.x, c.y, raio + 5 * px, 0, Math.PI * 2); g.stroke();
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

  function desenharLinha(a, b, cor, nome) {
    const px = 1 / vista.escala, cena0 = cena;
    const ca = centroCelula(a.cx, a.cy), cb = centroCelula(b.cx, b.cy);
    g.strokeStyle = cor; g.lineWidth = 4 * px; g.lineCap = 'round';
    g.setLineDash([10 * px, 7 * px]);
    g.beginPath(); g.moveTo(ca.x, ca.y); g.lineTo(cb.x, cb.y); g.stroke();
    g.setLineDash([]);
    g.fillStyle = cor;
    for (const p of [ca, cb]) { g.beginPath(); g.arc(p.x, p.y, 5 * px, 0, Math.PI * 2); g.fill(); }
    const q = quadrados(b.cx - a.cx, b.cy - a.cy, cena0?.grade?.diagonal);
    rotulo((nome ? nome + ': ' : '') + textoDistancia(q), cb.x, cb.y + 12 * px, 14 * px, 'rgba(17,25,20,.92)', cor);
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    const animando = pings.length > 0;
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
    desenharGrade();
    for (const im of imgs) if (im.camada !== 'fundo') desenharImagem(im);
    for (const t of cena.tokens) {
      if (arrasto?.tipo === 'token' && arrasto.token.id === t.id && arrasto.mexeu) continue;
      desenharToken(t);
    }
    if (arrasto?.tipo === 'token' && arrasto.mexeu) {
      const t = arrasto.token;
      desenharToken(t, t.x, t.y, true);
      const n = celulasDe(t.tam), meio = (n - 1) / 2;
      desenharLinha({ cx: t.x + meio, cy: t.y + meio }, { cx: arrasto.alvo.x + meio, cy: arrasto.alvo.y + meio }, api.corPropria);
      desenharToken(t, arrasto.alvo.x, arrasto.alvo.y);
    }
    if (arrasto?.tipo === 'grade' && arrasto.b) {
      const { a, b } = arrasto;
      g.strokeStyle = '#d3bb7c'; g.lineWidth = 2 / vista.escala;
      g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    for (const r of reguas.values()) desenharLinha(r.a, r.b, r.cor, r.nome);
    if (minhaRegua) desenharLinha(minhaRegua.a, minhaRegua.b, api.corPropria);
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

  let toqueLongo = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
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

  canvas.addEventListener('dblclick', e => {
    const { sx, sy } = pos(e), w = telaParaMundo(sx, sy), t = tokenEm(w.x, w.y);
    if (t) { eventos.aoEditar?.(t); return; }
    const im = api.ehMestre ? imagemEm(w.x, w.y) : null;
    if (im) { api.imagemSelecionada = im.id; api.selecionado = null; eventos.aoSelecionarImagem?.(im); }
  });

  return api;
}
