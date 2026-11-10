// visao.js — o que cada personagem enxerga (fase 3b).
//
// Paredes e portas fechadas bloqueiam a visão. A partir do centro do token, "raios" vão até cada canto
// de parede; o polígono formado pelos pontos onde os raios batem é a área que ele vê (linha de visão).
// Cada luz faz o mesmo cálculo a partir dela: luz não atravessa parede.
//
// Medidas em pixels do mapa (mundo). 1 quadrado = 1,5 m.

// ---------- geometria ----------
// interseção do raio (origem o, direção d) com o segmento a→b; devolve a distância t (ou null)
function raioNoSegmento(o, d, a, b) {
  const sx = b.x - a.x, sy = b.y - a.y;
  const den = d.x * sy - d.y * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - o.x) * sy - (a.y - o.y) * sx) / den;
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

// Polígono de visão a partir de "o", até a distância "alcance", com os segmentos que bloqueiam.
export function poligonoDeVisao(o, segmentos, alcance) {
  // um quadrado em volta (o alcance máximo) também conta como parede
  const R = alcance, caixa = [
    [{ x: o.x - R, y: o.y - R }, { x: o.x + R, y: o.y - R }], [{ x: o.x + R, y: o.y - R }, { x: o.x + R, y: o.y + R }],
    [{ x: o.x + R, y: o.y + R }, { x: o.x - R, y: o.y + R }], [{ x: o.x - R, y: o.y + R }, { x: o.x - R, y: o.y - R }],
  ];
  // só as paredes que chegam perto importam
  const perto = segmentos.filter(([a, b]) => !(Math.max(a.x, b.x) < o.x - R || Math.min(a.x, b.x) > o.x + R || Math.max(a.y, b.y) < o.y - R || Math.min(a.y, b.y) > o.y + R));
  const todos = [...perto, ...caixa];
  const angulos = [];
  for (const [a, b] of todos) for (const p of [a, b]) {
    const ang = Math.atan2(p.y - o.y, p.x - o.x);
    angulos.push(ang - 1e-4, ang, ang + 1e-4);
  }
  const pontos = [];
  for (const ang of angulos) {
    const d = { x: Math.cos(ang), y: Math.sin(ang) };
    let melhor = Infinity;
    for (const [a, b] of todos) { const t = raioNoSegmento(o, d, a, b); if (t !== null && t < melhor) melhor = t; }
    if (melhor < Infinity) pontos.push({ ang, x: o.x + d.x * melhor, y: o.y + d.y * melhor });
  }
  pontos.sort((p, q) => p.ang - q.ang);
  return pontos;
}

export function pontoNoPoligono(p, poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i], b = poli[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}
export function caminhoDoPoligono(poli) {
  const c = new Path2D();
  poli.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
  return c;
}

// Segmentos que bloqueiam a visão: paredes e portas fechadas
export function segmentosBloqueando(paredes) {
  return (paredes || []).filter(w => w.tipo !== 'porta' || !w.aberta).map(w => [w.a, w.b]);
}
// distância do ponto p ao segmento a→b (para clicar numa parede)
export function distanciaAoSegmento(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Presets de luz (metros): plena + penumbra
export const LUZES = {
  vela: { nome: 'Vela', plena: 1.5, penumbra: 1.5 },
  tocha: { nome: 'Tocha', plena: 6, penumbra: 6 },
  lampiao: { nome: 'Lampião', plena: 9, penumbra: 9 },
  lanterna: { nome: 'Lanterna furta-fogo', plena: 18, penumbra: 18 },
  fogueira: { nome: 'Fogueira', plena: 6, penumbra: 9 },
  luz: { nome: 'Magia Luz', plena: 6, penumbra: 6 },
};

// ---------- tudo o que a tela precisa para desenhar a visão ----------
// cfg = { ambiente: 'dia'|'penumbra'|'escuro', observadores: [{x, y, escuro (px)}], luzes: [{x, y, plena (px), penumbra (px)}],
//         paredes, alcance (px), escuridoes: [{x, y, r (px)}] (escuridão mágica: nem a visão no escuro atravessa) }
// Guarda o resultado enquanto nada muda (calcular a cada quadro seria pesado).
let memo = { chave: '', valor: null };
export function calcularVisao(cfg) {
  const chave = JSON.stringify([cfg.ambiente, cfg.observadores, cfg.luzes, cfg.paredes?.map(w => [w.a.x, w.a.y, w.b.x, w.b.y, w.tipo, !!w.aberta]), cfg.alcance, cfg.escuridoes]);
  if (memo.chave === chave) return memo.valor;
  const seg = segmentosBloqueando(cfg.paredes);
  const linhas = cfg.observadores.map(o => ({ ...o, poli: poligonoDeVisao(o, seg, cfg.alcance) }));
  const luzes = cfg.luzes.map(l => ({ ...l, poli: poligonoDeVisao(l, seg, (l.plena + l.penumbra) || 1) }));
  const valor = {
    ambiente: cfg.ambiente, observadores: linhas, luzes, escuridoes: cfg.escuridoes || [],
    caminhoVisao: (() => { const c = new Path2D(); for (const o of linhas) c.addPath(caminhoDoPoligono(o.poli)); return c; })(),
  };
  memo = { chave, valor };
  return valor;
}

// Um ponto é visto (e como)? 'claro' | 'penumbra' | 'escuro-visao' (visão no escuro, cinza) | null
export function comoVe(p, v) {
  let naLinha = null;
  for (const o of v.observadores) if (pontoNoPoligono(p, o.poli)) { naLinha = o; break; }
  if (!naLinha) return null;
  // escuridão mágica: ninguém enxerga dentro dela, nem com visão no escuro, e luz comum não ilumina
  for (const e of v.escuridoes || []) if (Math.hypot(p.x - e.x, p.y - e.y) <= e.r) return null;
  if (v.ambiente === 'dia') return 'claro';
  let luz = null;
  for (const l of v.luzes) {
    const d = Math.hypot(p.x - l.x, p.y - l.y);
    if (d <= l.plena + l.penumbra && pontoNoPoligono(p, l.poli)) { if (d <= l.plena) return 'claro'; luz = 'penumbra'; }
  }
  if (luz) return luz;
  if (v.ambiente === 'penumbra') return 'penumbra';
  for (const o of v.observadores) if (o.escuro > 0 && Math.hypot(p.x - o.x, p.y - o.y) <= o.escuro && pontoNoPoligono(p, o.poli)) return 'escuro-visao';
  return null;
}

// Uma parede curva vira vários pedaços retos: tira os pontos muito próximos e os que estão quase em linha.
export function simplificarCurva(pontos, passo) {
  if (pontos.length < 2) return pontos;
  const r = [pontos[0]];
  for (const p of pontos.slice(1, -1)) if (Math.hypot(p.x - r[r.length - 1].x, p.y - r[r.length - 1].y) >= passo) r.push(p);
  const ult = pontos[pontos.length - 1];
  if (Math.hypot(ult.x - r[r.length - 1].x, ult.y - r[r.length - 1].y) >= passo / 3 || r.length === 1) r.push(ult);
  else r[r.length - 1] = ult;
  return r;
}
