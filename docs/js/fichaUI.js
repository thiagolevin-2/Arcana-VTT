// fichaUI.js — as abas do personagem no painel: Personagem, Atributos, Combate e Habilidades.
// Só monta a tela; quem chama decide o que cada botão faz (rolar, gastar um uso, mudar a vida).
import { el, titulo } from './util.js?v=0.8';
import { comSinal } from './dados.js?v=0.8';
import { ATRIBUTOS, RECARGAS } from './fichas.js?v=0.8';
import { textoMetros } from './tabuleiro.js?v=0.8';

export const ABAS_FICHA = [['personagem', 'Personagem'], ['atributos', 'Atributos'], ['combate', 'Combate'], ['habilidades', 'Habilidades']];

export function barraDeAbas(atual, aoTrocar, abas = ABAS_FICHA) {
  return el('div', { class: 'abas abas-ficha', role: 'tablist' }, abas.map(([id, nome]) =>
    el('button', { role: 'tab', 'aria-selected': String(atual === id), texto: nome, onclick: () => aoTrocar(id) })));
}

// ---------- Personagem: retrato, vida, números e usos de habilidades ----------
// o: { podeEditar, aoVida(acao, valor), aoRecurso(id, acao), aoDescanso(tipo), extras: [elementos] }
export function abaPersonagem(t, o = {}) {
  const f = t.ficha || {};
  const pv = t.pv ?? 0, max = t.pvMax || 0, temp = t.pvTemp || 0;
  const fracao = max ? Math.max(0, Math.min(1, pv / max)) : 0;
  const valor = el('input', { type: 'number', min: 1, placeholder: 'Valor', inputmode: 'numeric', 'aria-label': 'Valor de dano, cura ou PV temporário' });
  const pegar = () => { const v = Math.floor(Number(valor.value)); if (!(v > 0)) { valor.focus(); return null; } valor.value = ''; return v; };
  const numeros = [['CA', t.ca ?? '—'], ['Deslocamento', t.desloc ? textoMetros(t.desloc) : '—'], ['Visão no escuro', t.visao ? textoMetros(t.visao) : '—'],
    ['Iniciativa', comSinal(t.ini || 0)], ...(f.percepcao != null ? [['Percepção passiva', f.percepcao]] : [])];
  const recursos = t.recursos || [];
  return [
    el('div', { class: 'cabeca-ficha' },
      t.img ? el('img', { class: 'retrato-grande', src: t.img, alt: 'Retrato de ' + t.nome }) : el('span', { class: 'bola grande', style: `background:${t.cor}` }),
      el('div', {}, el('strong', { texto: t.nome }), f.resumo ? el('small', { texto: f.resumo }) : null)),
    // vida
    el('div', { class: 'bloco cartao-vida' },
      titulo('Pontos de vida', temp ? el('span', { class: 'etiqueta azul', texto: `+${temp} temporários` }) : null),
      el('div', { class: 'vida-numero' }, el('b', { texto: String(pv) }), el('span', { texto: max ? ` / ${max}` : '' })),
      el('div', { class: 'vida-barra' }, el('span', { style: `width:${fracao * 100}%`, class: fracao > 0.5 ? '' : fracao > 0.25 ? 'meio' : 'baixo' })),
      o.podeEditar ? el('div', { class: 'linha-campos' }, el('div', { class: 'curto' }, valor),
        el('button', { class: 'btn pequeno perigo cresce', texto: '− Dano', onclick: () => { const v = pegar(); if (v) o.aoVida('dano', v); } }),
        el('button', { class: 'btn pequeno cresce', texto: '+ Cura', onclick: () => { const v = pegar(); if (v) o.aoVida('cura', v); } }),
        el('button', { class: 'btn pequeno cresce', texto: 'PV temp.', onclick: () => { const v = pegar(); if (v) o.aoVida('temp', v); } })) : null),
    // a Iniciativa vira um botão: clicou, rolou
    el('div', { class: 'numeros' }, numeros.map(([r, v]) => r === 'Iniciativa' && o.aoIniciativa
      ? el('button', { class: 'num-botao' + (o.iniciativaPendente ? ' piscando' : ''), title: 'Rolar iniciativa', onclick: o.aoIniciativa }, el('small', { texto: 'Iniciativa 🎲' }), el('b', { texto: String(v) }))
      : el('div', {}, el('small', { texto: r }), el('b', { texto: String(v) })))),
    Object.keys(t.outros || {}).length ? el('p', { class: 'dica', texto: 'Outros deslocamentos: ' + Object.entries(t.outros).map(([k, v]) => `${k} ${textoMetros(v)}`).join(' · ') }) : null,
    // usos de habilidades
    el('div', { class: 'bloco' },
      titulo('Usos de habilidades'),
      o.podeEditar && recursos.length ? el('div', { class: 'linha-campos' },
        el('button', { class: 'btn pequeno cresce', texto: 'Descanso curto', onclick: () => o.aoDescanso('curto') }),
        el('button', { class: 'btn pequeno cresce', texto: 'Descanso longo', onclick: () => o.aoDescanso('longo') })) : null,
      recursos.length ? el('div', { class: 'recursos' }, recursos.map(r => {
        const sobra = r.max - r.usados;
        return el('div', { class: 'recurso', title: r.dica || '' },
          el('div', { class: 'recurso-topo' }, el('strong', { texto: r.nome }), el('b', { texto: `${sobra} / ${r.max}` })),
          el('div', { class: 'bolinhas', 'aria-hidden': 'true' }, Array.from({ length: Math.min(r.max, 20) }, (_, i) => el('i', { class: i < sobra ? 'cheia' : '' }))),
          el('small', { texto: (r.dica ? r.dica + ' · ' : '') + 'Recupera: ' + (RECARGAS[r.recarga] || r.recarga) }),
          o.podeEditar ? el('div', { class: 'acoes' },
            el('button', { class: 'btn pequeno primario', texto: 'Usar', disabled: sobra <= 0, onclick: () => o.aoRecurso(r.id, 'usar') }),
            el('button', { class: 'btn pequeno', texto: 'Restaurar 1', disabled: r.usados <= 0, onclick: () => o.aoRecurso(r.id, 'restaurar') })) : null);
      })) : el('p', { class: 'vazio', texto: t.ficha ? 'Nenhum uso de habilidade nesta ficha (ou ela veio de uma Ficha Arcana antiga: exporte de novo pela 1.2).' : 'Carregue a ficha para ver os usos de habilidades.' })),
    ...(o.extras || []),
  ];
}

// ---------- Atributos: valores, salvaguardas e perícias (cada um rola um teste) ----------
// o: { aoTeste(nome, bonus, tipo) }
export function abaAtributos(t, o) {
  const f = t.ficha || {};
  const mods = f.atributos || {}, valores = f.valores || {}, sv = f.salvaguardas || {};
  const pericias = f.pericias || [];
  return [
    el('div', { class: 'bloco' }, titulo('Atributos', el('span', { class: 'dica', texto: 'clique para rolar' })),
      el('div', { class: 'atributos' }, ATRIBUTOS.map(([k, sigla, nome]) => el('button', { class: 'atributo', title: 'Teste de ' + nome, onclick: () => o.aoTeste('Teste de ' + nome, mods[k] ?? 0, 'teste') },
        el('span', { class: 'sigla', texto: sigla }), el('b', { texto: comSinal(mods[k] ?? 0) }), el('small', { texto: valores[k] != null ? String(valores[k]) : '' }))))),
    el('div', { class: 'bloco' }, titulo('Salvaguardas'),
      el('div', { class: 'lista-testes duas' }, ATRIBUTOS.map(([k, sigla, nome]) => {
        const s = sv[k] || { bonus: mods[k] ?? 0, prof: false };
        return el('button', { class: 'teste', title: 'Salvaguarda de ' + nome, onclick: () => o.aoTeste('Salvaguarda de ' + nome, s.bonus, 'teste') },
          el('span', { class: 'ponto' + (s.prof ? ' cheio' : '') }), el('span', { class: 'nome', texto: nome }), el('b', { texto: comSinal(s.bonus) }));
      }))),
    el('div', { class: 'bloco' }, titulo('Perícias', f.percepcao != null ? el('span', { class: 'etiqueta cinza', texto: 'Percepção passiva ' + f.percepcao }) : null),
      pericias.length ? el('div', { class: 'lista-testes' }, pericias.map(p => el('button', { class: 'teste', title: 'Teste de ' + p.nome, onclick: () => o.aoTeste('Teste de ' + p.nome, p.bonus, 'teste') },
        el('span', { class: 'ponto' + (p.prof === 2 ? ' especialista' : p.prof ? ' cheio' : ''), title: p.prof === 2 ? 'Especialização' : p.prof ? 'Proficiente' : '' }),
        el('span', { class: 'nome', texto: p.nome }), el('small', { texto: ATRIBUTOS.find(a => a[0] === p.atributo)?.[1] || '' }), el('b', { texto: comSinal(p.bonus) }))))
        : el('p', { class: 'vazio', texto: 'As perícias vêm da ficha exportada pela Ficha Arcana 1.2.' }),
      pericias.length ? el('div', { class: 'legenda' }, el('span', {}, el('span', { class: 'ponto cheio' }), ' Proficiente'), el('span', {}, el('span', { class: 'ponto especialista' }), ' Especialização')) : null),
  ];
}

// ---------- Combate: botões grandes de ataque (o dano vem depois, na janela) ----------
// o: { alvos, alvoId, aoMudarAlvo(id), aoAcao(acao), aoTeste(nome, bonus, tipo), topo: [elementos] }
const ICONE = { Ataques: '⚔', Macros: '✦', Magia: '✧', 'Ações': '⚔', 'Ações bônus': '➤', 'Reações': '↺', 'Lendárias': '♛' };
export function abaCombate(t, o) {
  const acoes = t.ficha?.acoes || [];
  const grupos = [...new Set(acoes.map(a => a.grupo || 'Ações'))];
  const alvo = el('select', { 'aria-label': 'Alvo', onchange: e => o.aoMudarAlvo(e.target.value) },
    el('option', { value: '', texto: 'Sem alvo (o mestre confere)' }),
    (o.alvos || []).map(a => el('option', { value: a.id, texto: a.nome, selected: a.id === o.alvoId })));
  return [
    ...(o.topo || []),
    el('div', { class: 'bloco' }, el('label', {}, 'Alvo do ataque', alvo)),
    ...(acoes.length ? grupos.map(g => el('div', { class: 'bloco' }, titulo(g),
      el('div', { class: 'cartoes-ataque' }, acoes.filter(a => (a.grupo || 'Ações') === g).map(a => {
        const bonus = a.acerto != null ? comSinal(a.acerto) : a.cd != null ? 'CD ' + a.cd : '—';
        const dano = a.partes.map(p => `${p.dano}${p.tipo ? ' ' + p.tipo : ''}`).join(' + ');
        return el('button', { class: 'cartao-ataque', title: a.obs || '', onclick: () => o.aoAcao(a) },
          el('span', { class: 'icone', 'aria-hidden': 'true', texto: ICONE[g] || '⚔' }),
          el('span', { class: 'meio' }, el('strong', { texto: a.nome }), el('small', { texto: (a.salva && a.cd != null ? `Salvaguarda de ${a.salva} · ` : '') + (dano || a.obs || '') })),
          el('span', { class: 'bonus', texto: bonus }));
      }))))
      : [el('p', { class: 'vazio', texto: 'Sem ataques. Carregue a ficha exportada para o tabuleiro.' })]),
    el('button', { class: 'btn cheio' + (o.iniciativaPendente ? ' primario piscando' : ''), texto: `Rolar iniciativa (${comSinal(t.ini || 0)})`, onclick: () => o.aoTeste('Iniciativa', t.ini || 0, 'iniciativa') }),
  ];
}

// ---------- Habilidades: textos de classe, subclasse, espécie e talentos ----------
export function abaHabilidades(t) {
  const lista = t.ficha?.habilidades || [];
  if (!lista.length) return [el('p', { class: 'vazio', texto: t.ficha ? 'Os textos das habilidades vêm da ficha exportada pela Ficha Arcana 1.2.' : 'Carregue a ficha para ver as habilidades.' })];
  const caixa = el('div', { class: 'habilidades' });
  const busca = el('input', { placeholder: 'Procurar habilidade…', 'aria-label': 'Procurar habilidade', autocomplete: 'off' });
  const desenhar = () => {
    const q = busca.value.trim().toLowerCase();
    const achadas = lista.filter(h => !q || (h.nome + ' ' + h.texto).toLowerCase().includes(q));
    const grupos = [...new Set(achadas.map(h => h.grupo))];
    caixa.replaceChildren(...grupos.map(g => el('div', { class: 'bloco' }, titulo(g),
      achadas.filter(h => h.grupo === g).map(h => el('details', { class: 'habilidade', open: !!q },
        el('summary', {}, el('span', { texto: h.nome }), h.origem ? el('span', { class: 'etiqueta cinza', texto: h.origem }) : null),
        el('p', { texto: h.texto }))))),
      ...(achadas.length ? [] : [el('p', { class: 'vazio', texto: 'Nada encontrado.' })]));
  };
  busca.addEventListener('input', desenhar);
  desenhar();
  return [busca, caixa];
}
