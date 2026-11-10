// rolagens.js — rolar ataques, danos e testes; a tabela de ações; e a janela "Rolagens".
//
// Quem clica rola os dados no próprio aparelho e manda o resultado ao mestre (um "pedido").
// O mestre confere contra a CA do alvo (que os jogadores não veem), aplica o dano se acertou
// e manda a "entrada" pronta para todos verem na janela de rolagens.
import { rolar, rolarD20, comSinal } from './dados.js';
import { ATRIBUTOS } from './fichas.js';
import { el } from './util.js';

const MODOS = [['normal', 'Normal'], ['vantagem', 'Vantagem'], ['desvantagem', 'Desvant.']];

// ---------- cálculos ----------
export function rolarAcao(acao, modo = 'normal') {
  const p = { tipo: 'acao', titulo: acao.nome, danos: [], cd: acao.cd ?? null, salva: acao.salva ?? null };
  let critico = false;
  if (acao.acerto != null) {
    const r = rolarD20(modo);
    p.d20 = { valores: r.valores, escolhido: r.escolhido, bonus: acao.acerto, total: r.escolhido + acao.acerto, modo };
    critico = r.escolhido >= (acao.critico || 20);
    p.critico = critico; p.falha = r.escolhido === 1;
    p.tipo = 'ataque';
  }
  for (const parte of acao.partes || []) {
    const r = rolar(parte.dano, { critico });
    p.danos.push({ expr: parte.dano, total: Math.max(0, r.total), detalhe: r.detalhe, tipo: parte.tipo || '' });
  }
  p.danoTotal = p.danos.reduce((s, x) => s + x.total, 0);
  return p;
}
export function rolarTeste(nome, bonus, modo = 'normal', tipo = 'teste') {
  const r = rolarD20(modo);
  return { tipo, titulo: nome, danos: [], d20: { valores: r.valores, escolhido: r.escolhido, bonus, total: r.escolhido + bonus, modo } };
}
export function rolarLivre(expr) {
  const r = rolar(expr);
  return { tipo: 'livre', titulo: expr, danos: [], livre: { expr: r.expr, total: r.total, detalhe: r.detalhe } };
}

// Transforma um pedido em linhas para mostrar (usado pelo mestre ao montar a entrada).
export function linhasDoPedido(p) {
  const linhas = [];
  if (p.d20) {
    const v = p.d20.valores.length > 1 ? `[${p.d20.valores.join(', ')}] → ${p.d20.escolhido}` : String(p.d20.escolhido);
    linhas.push({ rotulo: p.tipo === 'ataque' ? 'Acerto' : p.tipo === 'iniciativa' ? 'Iniciativa' : 'd20', total: p.d20.total,
      detalhe: `d20 ${v} ${comSinal(p.d20.bonus)}${p.d20.modo !== 'normal' ? ' · ' + p.d20.modo : ''}` });
  }
  if (p.cd != null) linhas.push({ rotulo: 'Salvaguarda', total: 'CD ' + p.cd, detalhe: p.salva || '' });
  for (const x of p.danos || []) linhas.push({ rotulo: 'Dano' + (x.tipo ? ' ' + x.tipo : ''), total: x.total, detalhe: `${x.expr}: ${x.detalhe}${p.critico ? ' · crítico' : ''}` });
  if (p.livre) linhas.push({ rotulo: p.livre.expr, total: p.livre.total, detalhe: p.livre.detalhe });
  return linhas;
}

// ---------- tabela de ações (aba Ataques + Macros da ficha, ou ações do monstro) ----------
// opcoes: { ficha, ini, alvos: [{id, nome}], alvoId, modo, aoMudarAlvo, aoMudarModo, aoRolar(pedido) }
export function tabelaDeAcoes(o) {
  const ficha = o.ficha || {};
  const acoes = ficha.acoes || [];
  const grupos = [...new Set(acoes.map(a => a.grupo || 'Ações'))];
  const seguro = fazer => { try { o.aoRolar(fazer()); } catch (e) { o.aoErro?.(e.message); } };

  const alvo = el('select', { 'aria-label': 'Alvo', onchange: e => o.aoMudarAlvo(e.target.value) },
    el('option', { value: '', texto: 'Sem alvo' }),
    (o.alvos || []).map(a => el('option', { value: a.id, texto: a.nome, selected: a.id === o.alvoId })));
  const modos = el('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': 'Modo do d20' },
    MODOS.map(([v, n]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(o.modo === v), texto: n, onclick: () => o.aoMudarModo(v) })));

  const linhaAcao = a => {
    const bonus = a.acerto != null ? comSinal(a.acerto) : a.cd != null ? `CD ${a.cd}` : '';
    const dano = a.partes.map(p => `${p.dano}${p.tipo ? ' ' + p.tipo : ''}`).join(' + ');
    return el('div', { class: 'acao', title: a.obs || '' },
      el('div', { class: 'acao-nome' }, el('strong', { texto: a.nome }), el('small', { texto: [a.salva && a.cd != null ? `Salvaguarda de ${a.salva}` : '', dano].filter(Boolean).join(' · ') || a.obs || '' })),
      el('span', { class: 'acao-bonus', texto: bonus }),
      el('button', { class: 'btn pequeno primario', texto: 'Rolar', 'aria-label': 'Rolar ' + a.nome, onclick: () => seguro(() => rolarAcao(a, o.modo)) }));
  };

  return el('div', { class: 'tabela-acoes' },
    el('div', { class: 'linha-campos' }, el('label', { class: 'cresce' }, 'Alvo', alvo)),
    modos,
    acoes.length ? grupos.map(g => el('div', { class: 'grupo-acoes' }, el('h4', { texto: g }), acoes.filter(a => (a.grupo || 'Ações') === g).map(linhaAcao)))
      : el('p', { class: 'vazio', texto: 'Sem ataques. Carregue a ficha exportada para o tabuleiro.' }),
    el('div', { class: 'grupo-acoes' }, el('h4', { texto: 'Testes' }),
      el('div', { class: 'testes' },
        ATRIBUTOS.map(([k, sigla, nome]) => el('button', { class: 'btn pequeno', title: 'Teste de ' + nome, onclick: () => seguro(() => rolarTeste('Teste de ' + nome, ficha.atributos?.[k] ?? 0, o.modo)) },
          sigla, el('small', { texto: ' ' + comSinal(ficha.atributos?.[k] ?? 0) }))),
        el('button', { class: 'btn pequeno', title: 'Rolar iniciativa', onclick: () => seguro(() => rolarTeste('Iniciativa', o.ini ?? 0, o.modo, 'iniciativa')) },
          'Inic.', el('small', { texto: ' ' + comSinal(o.ini ?? 0) })))),
  );
}

// ---------- janela "Rolagens" ----------
// opcoes: { ehMestre, aoRolarLivre(expr, secreta), aoAplicar(entrada, fator), aoDesfazer(entrada) }
export function criarJanelaRolagens(raiz, o) {
  const lista = el('div', { class: 'rolagens-lista', role: 'log', 'aria-live': 'polite' });
  const campo = el('input', { placeholder: '1d20+5', 'aria-label': 'Dados para rolar', autocomplete: 'off', spellcheck: 'false' });
  const secreta = o.ehMestre ? el('input', { type: 'checkbox', 'aria-label': 'Rolagem secreta' }) : null;
  const entradas = new Map();
  const rolarCampo = () => { const v = campo.value.trim(); if (!v) return; if (o.aoRolarLivre(v, !!secreta?.checked) !== false) campo.value = ''; };
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') rolarCampo(); });
  const corpo = el('div', { class: 'rolagens-corpo' }, lista,
    el('div', { class: 'rolagens-campo' }, campo,
      secreta ? el('label', { class: 'marcar pequena', title: 'Só você vê' }, secreta, 'Secreta') : null,
      el('button', { class: 'btn pequeno primario', texto: 'Rolar', onclick: rolarCampo })));
  const botaoAbrir = el('button', { class: 'rolagens-topo', type: 'button', 'aria-expanded': 'true' }, el('strong', { texto: 'Rolagens' }), el('span', { class: 'seta', texto: '▾' }));
  botaoAbrir.addEventListener('click', () => {
    const aberto = raiz.classList.toggle('fechada') === false;
    botaoAbrir.setAttribute('aria-expanded', String(aberto));
  });
  raiz.replaceChildren(botaoAbrir, corpo);

  function desenhar(e) {
    const caixa = el('article', { class: 'rolagem' + (e.secreta ? ' secreta' : '') },
      el('header', {}, el('span', { class: 'bola', style: `background:${e.cor || '#a4c29a'}` }), el('strong', { texto: e.quem || '' }),
        el('span', { texto: e.titulo || '' }), e.alvoNome ? el('span', { class: 'alvo', texto: '→ ' + e.alvoNome }) : null,
        e.secreta ? el('span', { class: 'etiqueta cinza', texto: 'secreta' }) : null),
      (e.linhas || []).map(l => el('div', { class: 'linha-rolagem' },
        el('span', { class: 'rot', texto: l.rotulo }), el('b', { texto: String(l.total) }), el('small', { texto: l.detalhe || '' }))),
      e.resultado ? el('div', { class: 'resultado ' + (e.resultado.classe || ''), texto: e.resultado.texto }) : null,
      o.ehMestre && e.dano > 0 && e.alvoId ? el('div', { class: 'acoes-mestre' },
        e.aplicado
          ? [el('span', { class: 'dica', texto: `−${e.aplicado} PV aplicados` }), el('button', { class: 'btn pequeno', texto: 'Desfazer', onclick: () => o.aoDesfazer(e) })]
          : [el('button', { class: 'btn pequeno', texto: `Aplicar ${e.dano}`, onclick: () => o.aoAplicar(e, 1) }),
            el('button', { class: 'btn pequeno', texto: `Metade (${Math.floor(e.dano / 2)})`, onclick: () => o.aoAplicar(e, 0.5) })]) : null);
    return caixa;
  }
  return {
    adicionar(e) {
      const novo = desenhar(e);
      const velho = entradas.get(e.id);
      if (velho) velho.replaceWith(novo); else lista.append(novo);
      entradas.set(e.id, novo);
      while (lista.children.length > 80) { const p = lista.firstChild; for (const [k, v] of entradas) if (v === p) entradas.delete(k); p.remove(); }
      lista.scrollTop = lista.scrollHeight;
      if (raiz.classList.contains('fechada') && !velho) raiz.classList.add('novidade');
    },
    abrir() { raiz.classList.remove('fechada', 'novidade'); botaoAbrir.setAttribute('aria-expanded', 'true'); },
  };
}
