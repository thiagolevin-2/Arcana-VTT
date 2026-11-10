// moldes.js — áreas de magia (fase 4): esfera, cone, linha, cubo e emanação, e quem fica dentro.
//
// Um molde: { id, dono, cor, forma, a: {x, y} (ponto de origem, no mundo), b: {x, y} (para onde aponta),
//             metros (tamanho), largura (só a linha, em metros), nome }
// Regras 2024: o cone tem, em cada ponto, a largura igual à distância até a origem; a linha tem 1,5 m de largura
// (a não ser que a magia diga outra coisa); o cubo tem a origem no meio de uma das faces.
// Quem está dentro: um quadrado conta se o centro dele está na área; um token é atingido se qualquer quadrado dele conta.

export const FORMAS = {
  esfera: { nome: 'Esfera / círculo', padrao: 6 },
  cone: { nome: 'Cone', padrao: 4.5 },
  linha: { nome: 'Linha', padrao: 18 },
  cubo: { nome: 'Cubo', padrao: 4.5 },
  emanacao: { nome: 'Emanação', padrao: 3 },
};
const M = 1.5; // metros por quadrado

function direcao(m) {
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l = Math.hypot(dx, dy);
  return l > 1e-6 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 };
}
// Para o cubo: direção presa aos 4 lados da grade
function direcaoReta(m) {
  const d = direcao(m);
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 };
}

// Medidas do molde em pixels do mundo (tam = lado do quadrado)
export function geometria(m, tam) {
  const L = (m.metros / M) * tam, d = direcao(m);
  if (m.forma === 'esfera' || m.forma === 'emanacao') {
    // emanação: sai das bordas do token (raio a mais = metade do tamanho dele)
    return { tipo: 'circulo', c: m.a, r: L + (m.forma === 'emanacao' ? (m.raioExtra || 0) : 0) };
  }
  if (m.forma === 'cubo') {
    const r = direcaoReta(m), c = { x: m.a.x + r.x * L / 2, y: m.a.y + r.y * L / 2 };
    return { tipo: 'quadrado', c, lado: L };
  }
  const p = { x: -d.y, y: d.x };
  if (m.forma === 'linha') {
    const w = ((m.largura || 1.5) / M) * tam / 2, fim = { x: m.a.x + d.x * L, y: m.a.y + d.y * L };
    return { tipo: 'poligono', d, L, w, pontos: [
      { x: m.a.x + p.x * w, y: m.a.y + p.y * w }, { x: fim.x + p.x * w, y: fim.y + p.y * w },
      { x: fim.x - p.x * w, y: fim.y - p.y * w }, { x: m.a.x - p.x * w, y: m.a.y - p.y * w }] };
  }
  // cone: triângulo com a base do mesmo tamanho do comprimento
  const fim = { x: m.a.x + d.x * L, y: m.a.y + d.y * L };
  return { tipo: 'poligono', d, L, cone: true, pontos: [m.a, { x: fim.x + p.x * L / 2, y: fim.y + p.y * L / 2 }, { x: fim.x - p.x * L / 2, y: fim.y - p.y * L / 2 }] };
}

// O ponto p está dentro do molde?
export function dentroDoMolde(m, p, tam) {
  const g = geometria(m, tam), folga = tam * 0.02;
  if (g.tipo === 'circulo') return Math.hypot(p.x - g.c.x, p.y - g.c.y) <= g.r + folga;
  if (g.tipo === 'quadrado') return Math.abs(p.x - g.c.x) <= g.lado / 2 + folga && Math.abs(p.y - g.c.y) <= g.lado / 2 + folga;
  const vx = p.x - m.a.x, vy = p.y - m.a.y, t = vx * g.d.x + vy * g.d.y, perp = Math.abs(-vx * g.d.y + vy * g.d.x);
  if (t < -folga || t > g.L + folga) return false;
  return g.cone ? perp <= t / 2 + folga : perp <= g.w + folga;
}

// Tokens atingidos (grade = { tam, ox, oy }). "ignorar" = o token de origem da emanação.
export function atingidos(m, tokens, grade) {
  const q = grade, r = [];
  for (const t of tokens) {
    if (m.forma === 'emanacao' && m.origem === t.id) continue;
    const n = Math.max(1, Math.round(t.tam || 1)), meio = t.tam < 1;
    let dentro = false;
    for (let i = 0; i < n && !dentro; i++) for (let j = 0; j < n && !dentro; j++) {
      const c = meio ? { x: q.ox + (t.x + 0.5) * q.tam, y: q.oy + (t.y + 0.5) * q.tam } : { x: q.ox + (t.x + i + 0.5) * q.tam, y: q.oy + (t.y + j + 0.5) * q.tam };
      if (dentroDoMolde(m, c, q.tam)) dentro = true;
    }
    if (dentro) r.push(t);
  }
  return r;
}

// Confere um molde vindo da rede
export function limparMolde(m) {
  if (!m || typeof m !== 'object' || !FORMAS[m.forma]) return null;
  const pt = p => (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7 ? { x: p.x, y: p.y } : null);
  const a = pt(m.a), b = pt(m.b) || a;
  if (!a) return null;
  const metros = Number(m.metros);
  return { id: String(m.id || '').slice(0, 64), dono: String(m.dono || '').slice(0, 64), cor: /^#[0-9a-f]{6}$/i.test(m.cor) ? m.cor : '#d3bb7c',
    forma: m.forma, a, b, metros: Number.isFinite(metros) ? Math.max(1.5, Math.min(300, metros)) : FORMAS[m.forma].padrao,
    largura: Math.max(1.5, Math.min(30, Number(m.largura) || 1.5)), nome: String(m.nome || '').slice(0, 40),
    origem: m.origem ? String(m.origem).slice(0, 64) : '', raioExtra: Math.max(0, Math.min(1e5, Number(m.raioExtra) || 0)) };
}
