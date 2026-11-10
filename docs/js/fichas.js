// fichas.js — transforma a ficha exportada da Ficha Arcana e os monstros do livro
// em dados de token: PV, CA, deslocamento, visão no escuro e uma lista única de "ações".
//
// Uma ação: { nome, grupo, acerto (número ou null), cd, salva, partes: [{ dano, tipo }], critico, obs }

const texto = (v, max = 60) => String(v ?? '').slice(0, max);
const num = (v, min, max, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const formulaValida = f => typeof f === 'string' && f.length <= 80 && /^[\s\dd+\-−]+$/i.test(f) && /\d/.test(f);

export const ATRIBUTOS = [['str', 'FOR', 'Força'], ['dex', 'DES', 'Destreza'], ['con', 'CON', 'Constituição'], ['int', 'INT', 'Inteligência'], ['wis', 'SAB', 'Sabedoria'], ['cha', 'CAR', 'Carisma']];
export const nomeAtributo = k => (ATRIBUTOS.find(a => a[0] === k)?.[2]) || texto(k, 20);

// "Grande" -> 2 quadrados. "Médio ou Pequeno" usa a primeira palavra.
export function quadradosDoTamanho(tamanho) {
  const t = String(tamanho || '').toLowerCase();
  if (t.startsWith('min')) return 0.5;
  if (t.startsWith('grande')) return 2;
  if (t.startsWith('enorme')) return 3;
  if (t.startsWith('colossal') || t.startsWith('imenso')) return 4;
  return 1;
}

// "9 m, voo 18 m (pairar)" -> { desloc: 9, outros: { Voo: 18 } }
export function lerDeslocamento(t) {
  const s = String(t || '');
  const desloc = Number((s.match(/^\s*(\d+(?:[.,]\d+)?)\s*m/) || [])[1]?.replace(',', '.')) || 0;
  const outros = {};
  for (const [chave, nome] of [['voo', 'Voo'], ['nata', 'Natação'], ['escal', 'Escalada'], ['escav', 'Escavação']]) {
    const m = s.match(new RegExp(chave + '[a-zçã]*\\s*(\\d+(?:[.,]\\d+)?)\\s*m', 'i'));
    if (m) outros[nome] = Number(m[1].replace(',', '.'));
  }
  return { desloc, outros };
}
export const lerVisao = t => Number((String(t || '').match(/vis[aã]o no escuro\s*(\d+(?:[.,]\d+)?)\s*m/i) || [])[1]?.replace(',', '.')) || 0;

function limparAcao(a, grupo) {
  if (!a || typeof a !== 'object') return null;
  const partes = (Array.isArray(a.partes) ? a.partes : []).slice(0, 8)
    .map(p => ({ dano: texto(p?.dano, 80).trim(), tipo: texto(p?.tipo, 30) })).filter(p => formulaValida(p.dano));
  const r = {
    nome: texto(a.nome, 50) || 'Ação', grupo: texto(a.grupo || grupo, 20),
    acerto: Number.isFinite(Number(a.acerto)) && a.acerto !== null ? num(a.acerto, -20, 40) : null,
    cd: Number.isFinite(Number(a.cd)) && a.cd !== null ? num(a.cd, 1, 40) : null,
    salva: a.salva ? texto(a.salva, 20) : null,
    partes, critico: num(a.critico, 2, 20, 20), obs: texto(a.obs, 220),
  };
  return r.acerto != null || r.cd != null || r.partes.length ? r : null;
}

// Partes da versão 2: salvaguardas, perícias, valores, recursos (usos) e textos das habilidades.
export const RECARGAS = { long: 'descanso longo', short: 'descanso curto', one: '1 por descanso curto, todos no longo' };
function limparExtras(raw) {
  const valores = {}, salvaguardas = {};
  for (const [k] of ATRIBUTOS) {
    if (raw.valores?.[k] != null) valores[k] = num(raw.valores[k], 1, 30, 10);
    const sv = raw.salvaguardas?.[k];
    if (sv && typeof sv === 'object') salvaguardas[k] = { bonus: num(sv.bonus, -10, 30), prof: !!sv.prof };
  }
  const pericias = (Array.isArray(raw.pericias) ? raw.pericias : []).slice(0, 40).map(p => ({
    nome: texto(p?.nome, 30), atributo: ATRIBUTOS.some(a => a[0] === p?.atributo) ? p.atributo : 'str', bonus: num(p?.bonus, -10, 30), prof: [0, 1, 2].includes(p?.prof) ? p.prof : 0,
  })).filter(p => p.nome);
  const recursos = (Array.isArray(raw.recursos) ? raw.recursos : []).slice(0, 40).map(r => {
    const max = num(r?.max, 0, 99, 0);
    return { id: texto(r?.id, 60), nome: texto(r?.nome, 60), max, usados: num(r?.usados, 0, max, 0), recarga: ['long', 'short', 'one'].includes(r?.recarga) ? r.recarga : 'long', dica: texto(r?.dica, 200) };
  }).filter(r => r.id && r.nome && r.max > 0);
  const habilidades = (Array.isArray(raw.habilidades) ? raw.habilidades : []).slice(0, 200).map(h => ({
    grupo: texto(h?.grupo, 20) || 'Outras', nome: texto(h?.nome, 80), origem: texto(h?.origem, 60), texto: texto(h?.texto, 3000),
  })).filter(h => h.nome);
  return { valores, salvaguardas, pericias, recursos, habilidades, percepcao: raw.percepcaoPassiva ?? raw.percepcao ?? null };
}
export function limparRecursos(lista) { return limparExtras({ recursos: lista }).recursos; }

// Ficha exportada pela Ficha Arcana ("Exportar para o tabuleiro").
export function limparFicha(raw) {
  if (!raw || typeof raw !== 'object' || raw.formato !== 'arcana-tabuleiro-ficha') throw new Error('Este arquivo não é uma ficha exportada para o tabuleiro. Na Ficha Arcana use: Exportar ficha › Exportar para o tabuleiro.');
  const acoes = [];
  for (const a of (raw.ataques || []).slice(0, 30)) acoes.push(limparAcao({ nome: a.nome, acerto: a.acerto, partes: [{ dano: a.dano, tipo: a.tipo }], critico: a.critico }, 'Ataques'));
  for (const m of (raw.macros || []).slice(0, 30)) acoes.push(limparAcao({ nome: m.nome, acerto: m.acerto, cd: m.cd, salva: m.salvaguarda, partes: m.partes, critico: m.critico, obs: m.resumo }, 'Macros'));
  if (raw.magia && Number.isFinite(Number(raw.magia.acerto))) acoes.push(limparAcao({ nome: 'Ataque mágico', acerto: raw.magia.acerto, obs: 'Some o dano da magia na caixa de rolagem.' }, 'Magia'));
  const atributos = {};
  for (const [k] of ATRIBUTOS) atributos[k] = num(raw.atributos?.[k], -5, 15, 0);
  const outros = {};
  for (const [k, v] of Object.entries(raw.outrosDeslocamentos || {}).slice(0, 6)) outros[texto(k, 20)] = num(v, 0, 300);
  const extras = limparExtras(raw);
  return {
    ...extras, percepcao: extras.percepcao == null ? null : num(extras.percepcao, 0, 40), pvTemp: num(raw.pvTemp, 0, 999),
    nome: texto(raw.nome, 40) || 'Personagem', resumo: texto(raw.resumo, 80), nivel: num(raw.nivel, 1, 30, 1),
    pv: num(raw.pv, -999, 9999), pvMax: num(raw.pvMax, 0, 9999), ca: num(raw.ca, 0, 40, 10), ini: num(raw.iniciativa, -10, 30),
    desloc: num(raw.deslocamento, 0, 300), outros, visao: num(raw.visaoNoEscuro, 0, 300), tam: num(raw.tamanho, 0.5, 4, 1),
    atributos, magia: raw.magia ? { acerto: num(raw.magia.acerto, -10, 30), cd: num(raw.magia.cd, 0, 40) } : null,
    acoes: acoes.filter(Boolean), retrato: typeof raw.retrato === 'string' && raw.retrato.startsWith('data:image/') ? raw.retrato : null,
  };
}

// Monstro do livro (versão enxuta de dados/monstros.json) ou da Área do Mestre.
export function acoesDoMonstro(m) {
  // no livro (versão enxuta) "ac" é a lista de ações; na Área do Mestre "ac" é a CA (número)
  const lista = Array.isArray(m.ac) ? m.ac : [
    ...(m.actions || []).map(a => ({ ...a, g: 'Ações' })), ...(m.bonusActions || []).map(a => ({ ...a, g: 'Ações bônus' })),
    ...(m.reactions || []).map(a => ({ ...a, g: 'Reações' })), ...(m.legendaryActions || []).map(a => ({ ...a, g: 'Lendárias' })),
  ].map(a => ({ n: a.name, k: a.kind, b: a.attackBonus, f: a.formula, t: a.damageType, cd: a.dc, s: a.saveAbility, d: a.description, g: a.g,
    p: Array.isArray(a.damageParts) ? a.damageParts.map(p => ({ f: p.formula, t: p.type || p.damageType })) : null }));
  return lista.map(a => {
    if (a.k === 'ability' && !a.cd) return null;
    const partes = a.p?.length ? a.p.map(p => ({ dano: p.f, tipo: p.t })) : a.f ? [{ dano: a.f, tipo: a.t }] : [];
    return limparAcao({ nome: a.n + (a.rc ? ` (recarga ${a.rc}–6)` : ''), grupo: a.g, acerto: a.k === 'attack' ? a.b : null,
      cd: a.cd || null, salva: a.s ? nomeAtributo(a.s) : null, partes, obs: a.d }, a.g);
  }).filter(Boolean);
}
export function tokenDoMonstro(m) {
  const ab = m.at || m.abilities || {}, mod = v => Math.floor((Number(v || 10) - 10) / 2);
  const { desloc, outros } = lerDeslocamento(m.desl ?? m.speed);
  return {
    nome: texto(m.n ?? m.name, 40), tipo: 'npc', cor: '#8c3b3b', tam: quadradosDoTamanho(m.tam ?? m.size),
    pv: num(m.pv ?? m.hp, 0, 99999, 1), pvMax: num(m.pv ?? m.hp, 0, 99999, 1), ca: num(m.ca ?? (Array.isArray(m.ac) ? null : m.ac), 0, 40, 10),
    ini: num(m.ini ?? m.initiative ?? mod(ab.dex), -10, 30), desloc, outros, visao: lerVisao(m.sen ?? m.senses),
    ficha: { atributos: Object.fromEntries(ATRIBUTOS.map(([k]) => [k, mod(ab[k])])), valores: Object.fromEntries(ATRIBUTOS.map(([k]) => [k, num(ab[k], 1, 30, 10)])),
      acoes: acoesDoMonstro(m), nd: texto(m.nd ?? m.cr, 8),
      habilidades: (Array.isArray(m.ac) ? m.ac : []).filter(a => a.d).map(a => ({ grupo: a.g || 'Ações', nome: texto(a.n, 80), origem: '', texto: texto(a.d, 3000) })) },
  };
}

// Ficha que já veio dentro de um token (o mestre manda): confere de novo antes de usar.
export function limparFichaDoToken(f) {
  if (!f || typeof f !== 'object') return null;
  const atributos = {};
  for (const [k] of ATRIBUTOS) atributos[k] = num(f.atributos?.[k], -5, 15, 0);
  const extras = limparExtras(f);
  return {
    atributos, resumo: texto(f.resumo, 80), nd: f.nd ? texto(f.nd, 8) : undefined,
    valores: extras.valores, salvaguardas: extras.salvaguardas, pericias: extras.pericias, habilidades: extras.habilidades,
    percepcao: extras.percepcao == null ? null : num(extras.percepcao, 0, 40),
    acoes: (Array.isArray(f.acoes) ? f.acoes : []).slice(0, 80).map(a => limparAcao(a, a?.grupo)).filter(Boolean),
    magia: f.magia ? { acerto: num(f.magia.acerto, -10, 30), cd: num(f.magia.cd, 0, 40) } : null,
  };
}
