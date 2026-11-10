// rolagens.js — rolar ataques, danos e testes; a janela do dado (como na Ficha Arcana);
// e a janela "Rolagens" (o histórico que todos veem).
//
// Quem clica rola os dados no próprio aparelho e manda o resultado ao mestre (um "pedido").
// O mestre confere contra a CA do alvo (que os jogadores não veem) e devolve a "entrada" pronta.
// O ataque é rolado primeiro; o dano vem depois, num segundo clique — igual à ficha.
// Antes de rolar um d20, a pessoa escolhe: Normal, Vantagem ou Desvantagem.
import { rolar, rolarD20, comSinal } from './dados.js?v=0.9';
import { el, uid } from './util.js?v=0.9';
import { diceFromValues } from './dice-geometry.js?v=0.9';

// ---------- cálculos ----------
export function rolarAtaque(acao, modo = 'normal') {
  const r = rolarD20(modo);
  return {
    id: uid(), tipo: 'ataque', titulo: acao.nome, danos: [], margem: acao.critico || 20,
    d20: { valores: r.valores, escolhido: r.escolhido, bonus: acao.acerto, total: r.escolhido + acao.acerto, modo },
    critico: r.escolhido >= (acao.critico || 20), falha: r.escolhido === 1,
  };
}
// Ação de salvaguarda (CD): não tem d20 de quem age; o alvo é que rola.
export function rolarAcaoComCD(acao) {
  return { id: uid(), tipo: 'acao', titulo: acao.nome, danos: [], cd: acao.cd, salva: acao.salva || null };
}
export function rolarDano(acao, critico = false, ataqueId = null) {
  const danos = (acao.partes || []).map(parte => {
    const r = rolar(parte.dano, { critico });
    return { expr: parte.dano, total: Math.max(0, r.total), detalhe: r.detalhe, tipo: parte.tipo || '', dados: r.dados };
  });
  return { id: uid(), tipo: 'dano', titulo: 'Dano · ' + acao.nome, danos, danoTotal: danos.reduce((s, x) => s + x.total, 0), critico, ataqueId };
}
export function rolarTeste(nome, bonus, modo = 'normal', tipo = 'teste') {
  const r = rolarD20(modo);
  return { id: uid(), tipo, titulo: nome, danos: [], d20: { valores: r.valores, escolhido: r.escolhido, bonus, total: r.escolhido + bonus, modo } };
}
export function rolarLivre(expr) {
  const r = rolar(expr);
  return { id: uid(), tipo: 'livre', titulo: expr, danos: [], livre: { expr: r.expr, total: r.total, detalhe: r.detalhe, dados: r.dados } };
}

// Transforma um pedido em linhas para mostrar (o mestre monta a entrada com isto).
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

// O que a animação 3D precisa: os dados (lados e valor), o total e o tipo da rolagem.
export function animacaoDoPedido(p) {
  if (p.d20) {
    let marcado = false;
    const dice = p.d20.valores.map(value => { const selected = !marcado && value === p.d20.escolhido; if (selected) marcado = true; return { sides: 20, value, selected }; });
    return { dice, total: p.d20.total, natural: p.d20.escolhido, kind: p.tipo === 'ataque' ? 'attack' : 'free', criticalThreshold: p.margem || 20,
      subtitle: p.d20.modo === 'vantagem' ? 'Vantagem · o maior d20 vale' : p.d20.modo === 'desvantagem' ? 'Desvantagem · o menor d20 vale' : p.tipo === 'iniciativa' ? 'Iniciativa' : 'Rolagem de d20' };
  }
  const grupos = p.livre ? p.livre.dados || [] : (p.danos || []).flatMap(x => x.dados || []);
  const dice = grupos.flatMap(g => diceFromValues(g.lados, g.valores));
  if (!dice.length) return null;
  return { dice, total: p.livre ? p.livre.total : p.danoTotal, natural: null, kind: 'free', criticalThreshold: 20,
    subtitle: p.livre ? 'Rolagem livre' : p.critico ? 'Dano crítico · dados dobrados' : 'Dano' };
}

// ---------- janela do dado (igual à da ficha) ----------
// abrir({ titulo, frase, acao, teste: { nome, bonus, tipo }, alvoNome, enviar(pedido) })
//   1º passo: escolher Normal / Vantagem / Desvantagem (ações com CD pulam este passo).
//   2º passo: o d20 rola (a animação 3D aparece no canto do tabuleiro para todos) e o total aparece.
//   3º passo (ataques): "Rolar dano".
// resultado(entrada): o mestre respondeu (acertou/errou, dano aplicado) → atualiza a janela.
const FRASES_ATAQUE = ['Cada ataque pode mudar o rumo da batalha.', 'Mire bem.', 'Agora é com os dados.'];
const FRASES_TESTE = ['Deixe os dados contarem a história.', 'Que a sorte esteja com você.'];
const MODOS = [['normal', 'Normal', 'Um d20'], ['vantagem', 'Vantagem', 'Dois d20, vale o maior'], ['desvantagem', 'Desvantagem', 'Dois d20, vale o menor']];
const TEMPO_ANIMACAO = 2500; // o total só aparece quando os dados 3D param de rolar
const sorteia = lista => lista[Math.floor(Math.random() * lista.length)];

// ganchos.aoRolar(pedido, palco): quem usa a janela anima os dados 3D dentro do "palco"; devolve true se animou.
export function criarJanelaDado(raiz, ganchos = {}) {
  let atual = null; // { opcoes, modo, escolhendo, pedido, dano, respostaAtaque, respostaDano, revelado }
  let vez = 0;      // cada rolagem nova invalida o "revelar" atrasado da anterior
  const palco = el('div', { class: 'dado-anim' }); // o mesmo elemento em todos os desenhos: a animação não é cortada

  function fechar() { raiz.hidden = true; atual = null; }
  raiz.addEventListener('click', e => { if (e.target === raiz) fechar(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !raiz.hidden) fechar(); });

  // espera a animação terminar para mostrar o número (se a animação estiver ligada)
  function esperarAnimacao(pedido) {
    const minha = ++vez;
    palco.replaceChildren();
    if (!ganchos.aoRolar?.(pedido, palco)) { atual.revelado = true; return; }
    atual.revelado = false;
    setTimeout(() => { if (atual && minha === vez) { atual.revelado = true; desenhar(); } }, TEMPO_ANIMACAO);
  }
  function rolarD20Agora(modo) {
    const o = atual.opcoes;
    atual.modo = modo || atual.modo; atual.escolhendo = false; atual.erro = null;
    try {
      atual.pedido = o.acao ? (o.acao.acerto != null ? rolarAtaque(o.acao, atual.modo) : rolarAcaoComCD(o.acao)) : rolarTeste(o.teste.nome, o.teste.bonus, atual.modo, o.teste.tipo || 'teste');
    } catch (e) { atual.erro = e.message; desenhar(); return; }
    atual.dano = null; atual.respostaAtaque = null; atual.respostaDano = null;
    if (atual.pedido.d20) esperarAnimacao(atual.pedido); else atual.revelado = true;
    o.enviar(atual.pedido);
    desenhar();
  }
  function rolarDanoAgora() {
    const o = atual.opcoes, p = atual.pedido;
    atual.erro = null;
    try { atual.dano = rolarDano(o.acao, !!p.critico, p.tipo === 'ataque' ? p.id : null); }
    catch (e) { atual.erro = e.message; desenhar(); return; }
    atual.respostaDano = null;
    esperarAnimacao(atual.dano);
    o.enviar(atual.dano);
    desenhar();
  }

  function dados(p) {
    if (p.d20) return el('div', { class: 'dado-detalhe' },
      p.d20.valores.map(v => el('span', { class: 'valor' + (p.d20.valores.length > 1 && v !== p.d20.escolhido ? ' descartado' : ''), texto: String(v) })),
      el('span', { texto: comSinal(p.d20.bonus) }));
    return el('div', { class: 'dado-detalhe' }, (p.danos || []).map(d => el('span', { class: 'parte', texto: `${d.expr}${d.tipo ? ' ' + d.tipo : ''}: ${d.detalhe} = ${d.total}` })));
  }
  const rolando = texto => el('div', { class: 'dado-total rolando' }, el('b', { texto: '…' }), el('span', { texto }));

  function desenhar() {
    if (!atual) return;
    const o = atual.opcoes, p = atual.pedido, d = atual.dano, a = o.acao;
    const ehAtaque = p?.tipo === 'ataque', ehCD = p?.tipo === 'acao';
    let corpo, rodape = [];
    if (atual.escolhendo) {
      // 1º passo: como rolar
      const bonus = a ? a.acerto : o.teste.bonus;
      corpo = [
        el('p', { class: 'dica', texto: `d20 ${comSinal(bonus)}${o.alvoNome ? ' · alvo: ' + o.alvoNome : ''}` }),
        el('div', { class: 'escolha-modo' }, MODOS.map(([m, n, dica]) => el('button', { class: 'btn-modo' + (m === 'normal' ? ' principal' : ''), type: 'button', onclick: () => rolarD20Agora(m) },
          el('strong', { texto: n }), el('small', { texto: dica })))),
      ];
    } else if (d) {
      // tela do dano
      const res = atual.respostaDano?.resultado;
      corpo = atual.revelado ? [
        el('div', { class: 'dado-total' }, el('b', { texto: String(d.danoTotal) }), el('span', { texto: d.critico ? 'Dano crítico (dados dobrados)' : 'Dano total' })),
        dados(d),
        el('div', { class: 'dado-resultado ' + (res?.classe || ''), texto: res?.texto || (atual.respostaDano ? 'Dano registrado.' : 'Enviando ao mestre…') }),
      ] : [palco];
      rodape = [el('button', { class: 'btn', texto: 'Voltar ao ataque', onclick: () => { atual.dano = null; atual.revelado = true; desenhar(); } })];
    } else if (ehCD) {
      corpo = [
        el('div', { class: 'dado-total' }, el('b', { texto: 'CD ' + p.cd }), el('span', { texto: p.salva ? `Salvaguarda de ${p.salva}` : 'Salvaguarda' })),
        el('p', { class: 'dica', texto: 'O alvo rola a salvaguarda. Depois, role o dano; o mestre decide se é inteiro ou metade.' }),
      ];
    } else if (p) {
      const res = atual.respostaAtaque?.resultado;
      const textoPadrao = ehAtaque ? (p.critico ? 'Acerto crítico!' : p.falha ? 'Falha no ataque' : 'Resultado do ataque') : 'Resultado do teste';
      const modo = MODOS.find(m => m[0] === p.d20.modo)?.[1] || 'Normal';
      corpo = atual.revelado ? [
        el('span', { class: 'etiqueta cinza', texto: modo }),
        el('div', { class: 'dado-total' + (p.critico ? ' critico' : p.falha ? ' falha' : '') }, el('b', { texto: String(p.d20.total) }), el('span', { texto: textoPadrao })),
        dados(p),
        ehAtaque ? el('div', { class: 'dado-resultado ' + (res?.classe || ''), texto: res ? res.texto + (atual.respostaAtaque.alvoNome ? ' · ' + atual.respostaAtaque.alvoNome : '') : (o.alvoNome ? `Conferindo contra ${o.alvoNome}…` : 'Sem alvo: o mestre confere.') }) : null,
        ehAtaque && a.critico < 20 ? el('p', { class: 'dica', texto: `Crítico com ${a.critico} ou mais.` }) : null,
      ] : [el('span', { class: 'etiqueta cinza', texto: modo }), palco];
    }
    if (!atual.escolhendo && !d) {
      if (p?.d20) rodape.push(el('button', { class: 'btn', texto: 'Rolar de novo', onclick: () => { atual.escolhendo = true; atual.pedido = null; vez++; desenhar(); } }));
      if (a && a.partes?.length && p && atual.revelado) rodape.push(el('button', { class: 'btn primario', texto: p.critico ? 'Dano crítico' : 'Rolar dano', disabled: !!p.falha, onclick: rolarDanoAgora }));
    }
    raiz.replaceChildren(el('div', { class: 'dado-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.titulo },
      el('header', {}, el('div', {}, el('h2', { texto: d ? 'Dano · ' + o.titulo : o.titulo }), el('p', { texto: o.frase })),
        el('button', { class: 'btn pequeno', texto: 'Fechar', onclick: fechar })),
      atual.erro ? el('p', { class: 'aviso erro', texto: atual.erro }) : null,
      el('div', { class: 'dado-corpo' }, corpo),
      rodape.length ? el('footer', {}, rodape) : null));
    raiz.hidden = false;
    (raiz.querySelector('.btn-modo.principal') || raiz.querySelector('footer .primario:not([disabled])') || raiz.querySelector('footer .btn'))?.focus();
  }

  return {
    abrir(opcoes) {
      vez++;
      atual = { opcoes: { frase: sorteia(opcoes.acao ? FRASES_ATAQUE : FRASES_TESTE), ...opcoes }, modo: 'normal', revelado: true };
      // ações com CD não têm d20: já mostram a CD; o resto começa escolhendo o modo
      if (opcoes.acao && opcoes.acao.acerto == null) rolarD20Agora();
      else { atual.escolhendo = true; desenhar(); }
    },
    resultado(entrada) {
      if (!atual || !entrada) return;
      if (atual.pedido && entrada.id === atual.pedido.id) { atual.respostaAtaque = entrada; desenhar(); }
      else if (atual.dano && entrada.id === atual.dano.id) { atual.respostaDano = entrada; desenhar(); }
    },
    fechar,
  };
}

// ---------- janela "Rolagens" (histórico) ----------
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
    return el('article', { class: 'rolagem' + (e.secreta ? ' secreta' : '') },
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
