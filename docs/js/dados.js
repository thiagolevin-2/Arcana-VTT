// dados.js — rola dados a partir de textos como "1d20+5", "2d6 + 1d4 + 3" ou "8d6".
// Usa o gerador de números aleatórios seguro do navegador (crypto), que é justo.

export function d(lados) {
  // sorteio sem viés: descarta valores que deixariam alguns lados mais prováveis
  const limite = Math.floor(0x100000000 / lados) * lados;
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n); while (n[0] >= limite);
  return (n[0] % lados) + 1;
}

// "2d6+3" -> [{ sinal: 1, n: 2, lados: 6 }, { sinal: 1, valor: 3 }]
export function analisar(texto) {
  const limpo = String(texto || '').toLowerCase().replace(/\s+/g, '').replace(/−/g, '-');
  if (!limpo || limpo.length > 80 || !/^[-+]?(\d*d\d+|\d+)([-+](\d*d\d+|\d+))*$/.test(limpo)) throw new Error(`Não entendi "${texto}". Use algo como 1d20+5 ou 2d6+3.`);
  const termos = [];
  for (const m of limpo.matchAll(/([-+]?)(\d*)d(\d+)|([-+]?)(\d+)/g)) {
    if (m[3]) {
      const n = Number(m[2] || 1), lados = Number(m[3]);
      if (n < 1 || n > 100 || lados < 1 || lados > 1000) throw new Error('Use de 1 a 100 dados, com até 1000 lados.');
      termos.push({ sinal: m[1] === '-' ? -1 : 1, n, lados });
    } else termos.push({ sinal: m[4] === '-' ? -1 : 1, valor: Number(m[5]) });
  }
  return termos;
}

// Rola uma expressão. Com critico = true, a quantidade de dados dobra (regra 2024).
// Devolve { expr, total, detalhe } — ex.: detalhe "[4, 2] + 3".
export function rolar(expr, { critico = false } = {}) {
  const termos = analisar(expr);
  let total = 0;
  const pedacos = [], dados = []; // dados: cada grupo rolado { lados, valores } (para a animação 3D)
  for (const t of termos) {
    if (t.valor != null) { total += t.sinal * t.valor; pedacos.push((t.sinal < 0 ? '− ' : '+ ') + t.valor); continue; }
    const n = critico ? t.n * 2 : t.n, valores = Array.from({ length: n }, () => d(t.lados));
    const soma = valores.reduce((a, b) => a + b, 0);
    total += t.sinal * soma;
    dados.push({ lados: t.lados, valores });
    pedacos.push((t.sinal < 0 ? '− ' : '+ ') + `[${valores.join(', ')}]`);
  }
  const detalhe = pedacos.join(' ').replace(/^\+ /, '');
  return { expr: String(expr).replace(/\s+/g, ''), total, detalhe, dados };
}

// d20 com vantagem / desvantagem: devolve { valores, escolhido }
export function rolarD20(modo = 'normal') {
  if (modo === 'vantagem' || modo === 'desvantagem') {
    const a = d(20), b = d(20);
    return { valores: [a, b], escolhido: modo === 'vantagem' ? Math.max(a, b) : Math.min(a, b) };
  }
  const a = d(20);
  return { valores: [a], escolhido: a };
}

export const comSinal = n => (n >= 0 ? '+' : '−') + Math.abs(n);
