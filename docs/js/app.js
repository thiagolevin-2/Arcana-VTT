// app.js — o "maestro": telas, painéis do mestre, tela do jogador e as mensagens entre eles.
import { guardar, ler, apagar, chaves, pedirPersistencia, espaco, tamanhoLegivel, hashDe } from './armazem.js';
import { importarMapa, carregarMapa, liberarMapa, retratoPequeno, guardarArquivo } from './mapas.js';
import { criarTabuleiro, estadoDe, celulasDe } from './tabuleiro.js';
import { abrirSala, entrarNaSala, novoCodigo, codigoValido, enviarArquivo, criarReceptor } from './conexao.js';

const VERSAO = '0.1';
const $ = s => document.querySelector(s);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
const celular = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;

// ---------- pequenos ajudantes de tela ----------
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'texto') e.textContent = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
function avisar(texto, erro = false) {
  const a = el('div', { class: 'aviso' + (erro ? ' erro' : ''), texto });
  $('#avisos').append(a);
  setTimeout(() => a.remove(), erro ? 6000 : 3200);
}
function definirStatus(texto, tipo) {
  const s = $('#status'); s.className = 'status ' + tipo; s.querySelector('span').textContent = texto;
}
function avisoMapa(texto, fracao) {
  const box = $('#aviso-mapa');
  if (!texto) { box.hidden = true; return; }
  box.hidden = false; box.replaceChildren(el('div', { texto }));
  if (fracao != null) { const b = el('b'); b.style.width = Math.round(fracao * 100) + '%'; box.append(el('div', { class: 'barra-progresso' }, b)); }
}
function escolherArquivo(aceita) {
  return new Promise(ok => {
    const i = el('input', { type: 'file', accept: aceita });
    i.addEventListener('change', () => ok(i.files[0] || null));
    i.click();
  });
}
const numero = (v, min, max, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const inteiro = (v, min, max, padrao = 0) => Math.round(numero(v, min, max, padrao));
const corValida = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
const imagemValida = s => (typeof s === 'string' && s.startsWith('data:image/') && s.length < 400000 ? s : null);

// ---------- tabuleiro (compartilhado entre mestre e jogador) ----------
let tab = null, papel = null, mapaAtual = null, hashCarregado = null;

async function mostrarMapa(cena, hash) {
  if (!cena?.mapa) { liberarMapa(mapaAtual); mapaAtual = null; hashCarregado = null; tab.definirMapa(null); avisoMapa(null); return true; }
  if (hashCarregado === hash && mapaAtual) return true;
  avisoMapa('Abrindo o mapa…');
  try {
    const m = await carregarMapa(hash, cena.mapa.w, cena.mapa.h);
    if (!m) return false;
    if (tab.cena() !== cena && tab.cena()?.id !== cena.id) { liberarMapa(m); return true; }
    liberarMapa(mapaAtual);
    mapaAtual = m; hashCarregado = hash;
    tab.definirMapa(m);
    avisoMapa(null);
    return true;
  } catch (e) { avisoMapa(e.message); return true; }
}

function prepararTabuleiro(eventos) {
  $('#inicio').hidden = true;
  $('#mesa').hidden = false;
  tab = criarTabuleiro($('#tela'), eventos);
  const dicas = {
    regua: 'Régua: arraste para medir. Cada quadrado = 1,5 m.',
    ping: 'Ping: clique no mapa para mostrar um ponto a todos.',
    grade: 'Ajustar grade: arraste por cima de UM quadrado desenhado no mapa, de canto a canto.',
  };
  const escolher = f => {
    tab.ferramenta = f;
    document.querySelectorAll('[data-ferramenta]').forEach(b => b.classList.toggle('ativo', b.dataset.ferramenta === f));
    $('#tela').style.cursor = f === 'mover' ? 'grab' : 'crosshair';
    const d = $('#dica-ferramenta'); d.hidden = !dicas[f]; d.textContent = dicas[f] || '';
  };
  document.querySelectorAll('[data-ferramenta]').forEach(b => b.addEventListener('click', () => escolher(b.dataset.ferramenta)));
  $('#btn-enquadrar').addEventListener('click', () => tab.enquadrar());
  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'v') escolher('mover'); else if (k === 'r') escolher('regua'); else if (k === 'p') escolher('ping');
    else if (k === 'g' && papel === 'mestre') escolher('grade'); else if (k === 'f') tab.enquadrar();
    else if (k === 'escape') escolher('mover');
    else eventos.aoTecla?.(e);
  });
  $('#btn-painel').addEventListener('click', () => {
    const p = $('#painel'), aberto = !p.classList.contains('aberto');
    p.classList.toggle('aberto', aberto); $('#btn-painel').setAttribute('aria-expanded', aberto);
  });
  return escolher;
}

// =====================================================================
//                               MESTRE
// =====================================================================
const M = { codigo: null, cenas: [], aberta: null, ativa: null, conhecidos: {} };
let sala = null, abaMestre = 'cenas', salvarTimer = null, escolherFerramenta = null, rascunhoNovo = null;
const envios = new Map(); // jogadorId -> { fila: Promise, texto }

function novaCena(nome) {
  return {
    id: uid(), nome, mapa: null, colunas: 30, linhas: 20, fundo: '#2a2f2b',
    grade: { tam: 70, ox: 0, oy: 0, cor: '#000000', opacidade: 0.35, mostrar: true, diagonal: 'simples' },
    tokens: [],
  };
}
const cenaAberta = () => M.cenas.find(c => c.id === M.aberta) || M.cenas[0];
const cenaAtiva = () => M.cenas.find(c => c.id === M.ativa) || null;
const salvar = () => { clearTimeout(salvarTimer); salvarTimer = setTimeout(() => guardar('dados', 'mestre', M).catch(e => avisar('Não consegui salvar: ' + e.message, true)), 300); };

// O que um jogador pode ver de uma cena: sem tokens ocultos, monstros sem PV exato.
function tokenParaJogador(t) {
  const c = { id: t.id, nome: t.nome, tipo: t.tipo, cor: t.cor, tam: t.tam, x: t.x, y: t.y, dono: t.dono, img: t.img };
  if (t.tipo === 'pc') { c.pv = t.pv; c.pvMax = t.pvMax; } else c.estado = estadoDe(t.pv, t.pvMax);
  return c;
}
function cenaParaJogador(cena, j) {
  return {
    id: cena.id, nome: cena.nome, colunas: cena.colunas, linhas: cena.linhas, fundo: cena.fundo, grade: cena.grade,
    mapa: cena.mapa ? { hash: j.celular ? cena.mapa.leve : cena.mapa.hash, w: cena.mapa.w, h: cena.mapa.h } : null,
    tokens: cena.tokens.filter(t => !t.oculto).map(tokenParaJogador),
  };
}
function enviarCena() {
  const c = cenaAtiva(); if (!sala || !c) return;
  for (const j of sala.jogadores.values()) sala.enviar(j, { t: 'cena', cena: cenaParaJogador(c, j) });
}
function enviarToken(cena, t, removido = false) {
  if (!sala || cena.id !== M.ativa) return;
  if (removido || t.oculto) sala.paraTodos({ t: 'tok-fora', id: t.id });
  else sala.paraTodos({ t: 'tok', tok: tokenParaJogador(t) });
}

// manda um mapa (ou vários) para um jogador, um de cada vez
function mandarMapa(j, hash) {
  const permitidos = new Set(M.cenas.flatMap(c => (c.mapa ? [c.mapa.hash, c.mapa.leve] : [])));
  if (!permitidos.has(hash)) return;
  const reg = envios.get(j.id) || { fila: Promise.resolve(), texto: '' };
  envios.set(j.id, reg);
  reg.fila = reg.fila.then(async () => {
    const arq = await ler('arquivos', hash);
    if (!arq || !j.conn.open) return;
    await enviarArquivo(j.conn, hash, arq.blob, { w: arq.w, h: arq.h }, f => {
      reg.texto = f >= 1 ? '' : `Recebendo mapa ${Math.round(f * 100)}%`;
      atualizarSeAba('jogadores');
    });
  }).catch(() => { reg.texto = ''; });
}

async function iniciarMestre() {
  papel = 'mestre';
  await pedirPersistencia();
  const salvo = await ler('dados', 'mestre').catch(() => null);
  if (salvo && Array.isArray(salvo.cenas) && salvo.cenas.length) Object.assign(M, salvo);
  else M.cenas = [novaCena('Primeira cena')];
  if (!M.codigo) M.codigo = novoCodigo();
  if (!M.cenas.some(c => c.id === M.aberta)) M.aberta = M.cenas[0].id;
  if (M.ativa && !M.cenas.some(c => c.id === M.ativa)) M.ativa = null;
  if (!M.ativa) M.ativa = M.aberta;
  M.conhecidos ||= {};
  salvar();

  escolherFerramenta = prepararTabuleiro({
    podeMover: () => true,
    aoMover: (t, x, y) => { t.x = x; t.y = y; salvar(); tab.redesenhar(); if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'mov', id: t.id, x, y }); },
    aoSelecionar: t => { tab.selecionado = t?.id || null; if (t) abaMestre = 'tokens'; desenharPainelMestre(); },
    aoEditar: t => { tab.selecionado = t.id; abaMestre = 'tokens'; desenharPainelMestre(); abrirPainelCelular(); },
    aoPing: (x, y) => { tab.mostrarPing(x, y, '#d3bb7c'); if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'ping', x, y, cor: '#d3bb7c' }); },
    aoRegua: r => { if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'regua', id: 'mestre', a: r?.a, b: r?.b, cor: '#d3bb7c', nome: 'Mestre' }); },
    aoAjustarGrade: (tam, ox, oy) => {
      Object.assign(cenaAberta().grade, { tam: Math.round(tam * 10) / 10, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
      salvar(); tab.redesenhar(); enviarCena(); abaMestre = 'grade'; desenharPainelMestre(); escolherFerramenta('mover');
      avisar('Grade ajustada. Use os campos da aba Grade para o ajuste fino.');
    },
    aoTecla: e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && tab.selecionado) {
        const c = cenaAberta(), t = c.tokens.find(x => x.id === tab.selecionado);
        if (t && confirm(`Excluir o token "${t.nome}"?`)) excluirToken(c, t);
      }
    },
  });
  $('#mesa').classList.add('mestre');
  tab.ehMestre = true;
  $('#chip-codigo').textContent = M.codigo;
  $('#chip-codigo').addEventListener('click', () => { navigator.clipboard?.writeText(M.codigo); avisar('Código copiado: ' + M.codigo); });
  $('#btn-sair').textContent = 'Encerrar sala';
  $('#btn-sair').addEventListener('click', () => {
    if (!confirm('Encerrar a sala? Os jogadores serão desconectados. Suas cenas continuam salvas.')) return;
    sala?.fechar(); setTimeout(() => location.reload(), 700);
  });
  await abrirCenaNoTabuleiro();
  ligarSala();
  desenharPainelMestre();
}

function ligarSala() {
  definirStatus('Abrindo a sala…', 'espera');
  if (!window.Peer) { definirStatus('Sem a biblioteca de conexão: dá para preparar as cenas, mas ninguém entra.', 'off'); return; }
  sala = abrirSala(M.codigo, {
    aoAbrir: () => atualizarStatusMestre(),
    aoErro: t => definirStatus(t, 'off'),
    aoEntrar: j => {
      M.conhecidos[j.id] = { nome: j.nome, cor: j.cor };
      salvar();
      const c = cenaAtiva();
      sala.enviar(j, { t: 'bemvindo', versao: VERSAO, cena: c ? cenaParaJogador(c, j) : null });
      avisar(`${j.nome} entrou na mesa.`);
      atualizarStatusMestre(); atualizarSeAba('jogadores', 'cenas', 'tokens');
    },
    aoSair: j => { avisar(`${j.nome} saiu.`); envios.delete(j.id); atualizarStatusMestre(); atualizarSeAba('jogadores', 'cenas'); },
    aoMensagem: (j, msg) => tratarMensagemDoJogador(j, msg),
  });
}
function atualizarStatusMestre() {
  const n = sala?.jogadores.size || 0;
  definirStatus(n ? `Sala aberta · ${n} ${n === 1 ? 'jogador' : 'jogadores'}` : 'Sala aberta · esperando jogadores', 'on');
}

function tratarMensagemDoJogador(j, msg) {
  const c = cenaAtiva();
  if (msg.t === 'mover' && c) {
    const t = c.tokens.find(x => x.id === msg.id);
    if (!t || t.dono !== j.id || t.oculto) return;
    t.x = inteiro(msg.x, -500, 5000); t.y = inteiro(msg.y, -500, 5000);
    salvar(); if (cenaAberta().id === c.id) tab.redesenhar();
    sala.paraTodos({ t: 'mov', id: t.id, x: t.x, y: t.y });
  } else if (msg.t === 'ping') {
    const x = numero(msg.x, -1e6, 1e6), y = numero(msg.y, -1e6, 1e6);
    if (cenaAberta().id === M.ativa) tab.mostrarPing(x, y, j.cor);
    sala.paraTodos({ t: 'ping', x, y, cor: j.cor }, o => o !== j);
  } else if (msg.t === 'regua') {
    const cel = p => (p && { cx: inteiro(p.cx, -1e5, 1e5), cy: inteiro(p.cy, -1e5, 1e5) });
    const a = cel(msg.a), b = cel(msg.b);
    if (cenaAberta().id === M.ativa) tab.mostrarRegua(j.id, a, b, j.cor, j.nome);
    sala.paraTodos({ t: 'regua', id: j.id, a, b, cor: j.cor, nome: j.nome }, o => o !== j);
  } else if (msg.t === 'preciso' && typeof msg.hash === 'string') {
    mandarMapa(j, msg.hash);
  }
}

async function abrirCenaNoTabuleiro() {
  const c = cenaAberta();
  tab.selecionado = null;
  tab.definirCena(c);
  if (c.mapa) await mostrarMapa(c, c.mapa.hash); else await mostrarMapa(c, null);
  tab.enquadrar();
}

function excluirToken(c, t) {
  c.tokens = c.tokens.filter(x => x !== t);
  if (tab.selecionado === t.id) tab.selecionado = null;
  enviarToken(c, t, true); salvar(); tab.redesenhar(); desenharPainelMestre();
}
function abrirPainelCelular() { if (matchMedia('(max-width:900px)').matches) { $('#painel').classList.add('aberto'); $('#btn-painel').setAttribute('aria-expanded', 'true'); } }

// ---------- painel do mestre ----------
// Redesenha só se a aba aberta for uma destas e o mestre não estiver digitando num campo.
// (Evita apagar o que ele está escrevendo quando um jogador entra, por exemplo.)
function atualizarSeAba(...abas) {
  if (!abas.includes(abaMestre)) return;
  if (document.activeElement?.closest?.('#painel input, #painel select')) return;
  desenharPainelMestre();
}
function desenharPainelMestre() {
  const abas = [['cenas', 'Cenas'], ['tokens', 'Tokens'], ['grade', 'Grade'], ['jogadores', 'Jogadores'], ['backup', 'Backup']];
  const corpo = { cenas: painelCenas, tokens: painelTokens, grade: painelGrade, jogadores: painelJogadores, backup: painelBackup }[abaMestre]();
  const rolagem = $('#painel .conteudo')?.scrollTop || 0;
  $('#painel').replaceChildren(
    el('div', { class: 'abas', role: 'tablist' }, abas.map(([id, nome]) =>
      el('button', { role: 'tab', 'aria-selected': String(abaMestre === id), texto: nome, onclick: () => { abaMestre = id; desenharPainelMestre(); } }))),
    el('div', { class: 'conteudo' }, corpo),
  );
  $('#painel .conteudo').scrollTop = rolagem;
}

function painelCenas() {
  const c = cenaAberta();
  const lista = el('div', { class: 'lista' }, M.cenas.map(s => el('button', {
    class: 'item' + (s.id === c.id ? ' sel' : ''),
    onclick: async () => { M.aberta = s.id; salvar(); await abrirCenaNoTabuleiro(); desenharPainelMestre(); },
  }, el('span', { class: 'nome', texto: s.nome }),
    s.id === M.ativa ? el('span', { class: 'etiqueta', texto: 'jogadores aqui' }) : null,
    s.mapa ? null : el('span', { class: 'etiqueta cinza', texto: 'sem mapa' }))));

  const progresso = el('p', { class: 'dica', texto: '' });
  const trocarMapa = async () => {
    const arq = await escolherArquivo('image/png,image/jpeg,image/webp');
    if (!arq) return;
    try {
      const info = await importarMapa(arq, t => { progresso.textContent = t; avisoMapa(t); });
      c.mapa = info;
      salvar();
      await abrirCenaNoTabuleiro();
      enviarCena();
      avisar(`Mapa importado: ${info.w} × ${info.h} pixels (${tamanhoLegivel(arq.size)}).`);
    } catch (e) { avisoMapa(null); avisar(e.message, true); }
    atualizarSeAba('cenas');
  };
  return [
    el('div', { class: 'bloco' }, el('h3', { texto: 'Suas cenas' }), lista,
      el('button', { class: 'btn', texto: '+ Nova cena', onclick: async () => {
        const nome = prompt('Nome da nova cena:', `Cena ${M.cenas.length + 1}`); if (!nome) return;
        const s = novaCena(nome.slice(0, 60)); M.cenas.push(s); M.aberta = s.id; salvar(); await abrirCenaNoTabuleiro(); desenharPainelMestre();
      } })),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Cena aberta: ' + c.nome }),
      c.id === M.ativa
        ? el('p', { class: 'dica', texto: 'Os jogadores estão vendo esta cena.' })
        : el('button', { class: 'btn primario', texto: 'Levar os jogadores para esta cena', onclick: () => { M.ativa = c.id; salvar(); enviarCena(); desenharPainelMestre(); avisar('Jogadores levados para ' + c.nome + '.'); } }),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn', texto: c.mapa ? 'Trocar mapa' : 'Escolher mapa', onclick: trocarMapa }),
        c.mapa ? el('button', { class: 'btn', texto: 'Tirar mapa', onclick: async () => { c.mapa = null; salvar(); await abrirCenaNoTabuleiro(); enviarCena(); desenharPainelMestre(); } }) : null,
        el('button', { class: 'btn', texto: 'Renomear', onclick: () => { const n = prompt('Novo nome:', c.nome); if (n) { c.nome = n.slice(0, 60); salvar(); enviarCena(); desenharPainelMestre(); } } }),
        el('button', { class: 'btn perigo', texto: 'Excluir cena', disabled: M.cenas.length === 1, onclick: async () => {
          if (!confirm(`Excluir a cena "${c.nome}" com todos os tokens?`)) return;
          M.cenas = M.cenas.filter(s => s !== c);
          if (M.ativa === c.id) M.ativa = M.cenas[0].id;
          M.aberta = M.cenas[0].id; salvar(); limparArquivosSemUso(); await abrirCenaNoTabuleiro(); enviarCena(); desenharPainelMestre();
        } })),
      progresso,
      c.mapa ? el('p', { class: 'dica', texto: `Mapa: ${c.mapa.w} × ${c.mapa.h} pixels. Jogadores no celular recebem uma versão mais leve.` }) : null),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Antes da sessão' }),
      el('button', { class: 'btn', texto: 'Pré-carregar todas as cenas nos jogadores', disabled: !sala?.jogadores.size, onclick: preCarregar }),
      el('p', { class: 'dica', texto: 'Manda os mapas agora, enquanto vocês conversam. Na hora de trocar de cena, abre na hora.' })),
  ];
}

function preCarregar() {
  for (const j of sala.jogadores.values()) {
    const mapas = M.cenas.filter(c => c.mapa).map(c => ({ hash: j.celular ? c.mapa.leve : c.mapa.hash }));
    sala.enviar(j, { t: 'precarregar', mapas });
  }
  avisar('Pré-carregamento iniciado. Veja o progresso na aba Jogadores.');
}

async function limparArquivosSemUso() {
  const usados = new Set(M.cenas.flatMap(c => (c.mapa ? [c.mapa.hash, c.mapa.leve] : [])));
  for (const k of await chaves('arquivos')) if (!usados.has(k)) await apagar('arquivos', k);
}

const TAMANHOS = [[0.5, 'Miúdo'], [1, 'Pequeno / Médio'], [2, 'Grande (2×2)'], [3, 'Enorme (3×3)'], [4, 'Imenso (4×4)']];

function painelTokens() {
  const c = cenaAberta();
  const t = c.tokens.find(x => x.id === tab.selecionado) || null;
  const rascunho = t ? { ...t } : (rascunhoNovo ||= { nome: '', tipo: 'npc', cor: '#8c3b3b', tam: 1, pv: 10, pvMax: 10, dono: '', oculto: false, img: null });
  const campo = (k, props) => el('input', { value: rascunho[k] ?? '', oninput: e => { rascunho[k] = e.target.value; if (t) aplicar(); }, ...props });
  const previa = el('img', { class: 'retrato-previa', alt: 'Retrato', hidden: !rascunho.img, src: rascunho.img || null });

  function lerFormulario() {
    return {
      nome: String(rascunho.nome || '').trim().slice(0, 40) || (rascunho.tipo === 'pc' ? 'Personagem' : 'Monstro'),
      tipo: rascunho.tipo === 'pc' ? 'pc' : 'npc',
      cor: corValida(rascunho.cor) || '#5b7c66',
      tam: numero(rascunho.tam, 0.5, 4, 1),
      pv: inteiro(rascunho.pv, -999, 9999, 0), pvMax: inteiro(rascunho.pvMax, 0, 9999, 0),
      dono: rascunho.dono || '', oculto: !!rascunho.oculto, img: imagemValida(rascunho.img),
    };
  }
  function aplicar() { Object.assign(t, lerFormulario()); salvar(); tab.redesenhar(); enviarToken(c, t); }

  const donos = el('select', { onchange: e => { rascunho.dono = e.target.value; if (t) { aplicar(); desenharPainelMestre(); } } },
    el('option', { value: '', texto: 'Só o mestre' }),
    Object.entries(M.conhecidos).map(([id, j]) => el('option', { value: id, texto: j.nome, selected: rascunho.dono === id })));

  const ajustePV = el('input', { type: 'number', min: 0, placeholder: 'Valor', inputmode: 'numeric' });
  const mudarPV = sinal => { const v = inteiro(ajustePV.value, 0, 9999, 0); if (!v || !t) return; t.pv = Math.min(t.pvMax || 9999, t.pv + sinal * v); ajustePV.value = ''; salvar(); tab.redesenhar(); enviarToken(c, t); desenharPainelMestre(); };

  const form = el('div', { class: 'bloco' },
    el('h3', { texto: t ? 'Editar: ' + t.nome : 'Novo token' }),
    el('label', {}, 'Nome', campo('nome', { maxlength: 40 })),
    el('div', { class: 'duas' },
      el('label', {}, 'Tipo', el('select', { onchange: e => { rascunho.tipo = e.target.value; if (t) aplicar(); } },
        el('option', { value: 'pc', texto: 'Personagem', selected: rascunho.tipo === 'pc' }),
        el('option', { value: 'npc', texto: 'Monstro / PdM', selected: rascunho.tipo !== 'pc' }))),
      el('label', {}, 'Tamanho', el('select', { onchange: e => { rascunho.tam = Number(e.target.value); if (t) aplicar(); } },
        TAMANHOS.map(([v, n]) => el('option', { value: v, texto: n, selected: Number(rascunho.tam) === v }))))),
    el('div', { class: 'tres' },
      el('label', {}, 'PV atual', campo('pv', { type: 'number', inputmode: 'numeric' })),
      el('label', {}, 'PV máx.', campo('pvMax', { type: 'number', min: 0, inputmode: 'numeric' })),
      el('label', {}, 'Cor', campo('cor', { type: 'color' }))),
    t ? el('div', { class: 'duas' }, ajustePV,
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno perigo', texto: 'Dano', onclick: () => mudarPV(-1) }),
        el('button', { class: 'btn pequeno', texto: 'Cura', onclick: () => mudarPV(1) }))) : null,
    el('label', {}, 'Quem pode mover', donos),
    el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: !!rascunho.oculto, onchange: e => { rascunho.oculto = e.target.checked; if (t) { aplicar(); desenharPainelMestre(); } } }), 'Escondido dos jogadores'),
    el('div', { class: 'acoes' }, previa,
      el('button', { class: 'btn pequeno', texto: rascunho.img ? 'Trocar retrato' : 'Escolher retrato', onclick: async () => {
        const arq = await escolherArquivo('image/*'); if (!arq) return;
        try { rascunho.img = await retratoPequeno(arq); previa.src = rascunho.img; previa.hidden = false; if (t) aplicar(); }
        catch { avisar('Não consegui abrir essa imagem.', true); }
      } }),
      rascunho.img ? el('button', { class: 'btn pequeno', texto: 'Tirar retrato', onclick: () => { rascunho.img = null; if (t) aplicar(); desenharPainelMestre(); } }) : null),
    t
      ? el('div', { class: 'acoes' },
        el('button', { class: 'btn', texto: 'Duplicar', onclick: () => {
          const n = { ...t, id: uid(), x: t.x + celulasDe(t.tam), nome: proximoNome(c, t.nome) };
          c.tokens.push(n); tab.selecionado = n.id; salvar(); tab.redesenhar(); enviarToken(c, n); desenharPainelMestre();
        } }),
        el('button', { class: 'btn', texto: 'Novo token', onclick: () => { tab.selecionado = null; tab.redesenhar(); desenharPainelMestre(); } }),
        el('button', { class: 'btn perigo', texto: 'Excluir', onclick: () => excluirToken(c, t) }))
      : el('button', { class: 'btn primario cheio', texto: 'Colocar no centro da tela', onclick: () => {
        const n = { id: uid(), ...lerFormulario() }, centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
        n.x = cel.cx; n.y = cel.cy; c.tokens.push(n); tab.selecionado = n.id; rascunhoNovo = null;
        salvar(); tab.redesenhar(); enviarToken(c, n); desenharPainelMestre();
      } }),
  );

  const lista = el('div', { class: 'bloco' }, el('h3', { texto: `Tokens nesta cena (${c.tokens.length})` }),
    c.tokens.length ? el('div', { class: 'lista' }, c.tokens.map(x => el('div', { class: 'item' + (x.id === tab.selecionado ? ' sel' : ''),
      onclick: () => { tab.selecionado = x.id; tab.centralizarEm(x); desenharPainelMestre(); } },
      el('span', { class: 'bola', style: `background:${x.cor}` }),
      el('span', { class: 'nome', texto: x.nome }),
      x.tipo === 'pc' ? el('span', { class: 'etiqueta', texto: 'personagem' }) : null,
      x.pvMax ? el('span', { class: 'etiqueta cinza', texto: `${x.pv}/${x.pvMax}` }) : null,
      el('button', { class: 'olho', title: x.oculto ? 'Mostrar aos jogadores' : 'Esconder dos jogadores', 'aria-label': x.oculto ? 'Mostrar aos jogadores' : 'Esconder dos jogadores',
        texto: x.oculto ? '🙈' : '👁', onclick: e => { e.stopPropagation(); x.oculto = !x.oculto; salvar(); tab.redesenhar(); enviarToken(c, x); desenharPainelMestre(); } }))))
      : el('p', { class: 'vazio', texto: 'Nenhum token ainda. Preencha acima e coloque no mapa.' }));
  return [form, lista, el('p', { class: 'dica', texto: 'Dica: arraste os tokens no mapa. Duplo clique abre a edição. Delete exclui o selecionado.' })];
}
function proximoNome(c, nome) {
  const base = nome.replace(/\s+\d+$/, '');
  let i = 2; while (c.tokens.some(t => t.nome === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function painelGrade() {
  const c = cenaAberta(), q = c.grade;
  const mudar = (k, v, alvo = q) => { alvo[k] = v; salvar(); tab.redesenhar(); enviarCena(); };
  const num = (k, min, max, passo, alvo = q) => el('input', { type: 'number', min, max, step: passo, value: alvo[k], inputmode: 'decimal',
    oninput: e => { const v = numero(e.target.value, min, max, alvo[k]); if (e.target.value !== '') mudar(k, v, alvo); } });
  const empurrar = (dx, dy) => { q.ox = Math.round((q.ox + dx) * 10) / 10; q.oy = Math.round((q.oy + dy) * 10) / 10; salvar(); tab.redesenhar(); enviarCena(); desenharPainelMestre(); };
  return [
    el('div', { class: 'bloco' }, el('h3', { texto: 'Encaixar a grade no mapa' }),
      el('button', { class: 'btn primario', texto: 'Medir um quadrado do mapa', onclick: () => escolherFerramenta('grade') }),
      el('p', { class: 'dica', texto: 'Dê bastante zoom e arraste de um canto ao outro de UM quadrado desenhado no mapa. Depois, ajuste fino abaixo.' }),
      el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: q.mostrar !== false, onchange: e => mudar('mostrar', e.target.checked) }), 'Mostrar a grade'),
      el('label', {}, 'Tamanho do quadrado (pixels do mapa)', num('tam', 8, 2000, 0.1)),
      el('div', { class: 'duas' }, el('label', {}, 'Deslocar X', num('ox', -2000, 2000, 0.1)), el('label', {}, 'Deslocar Y', num('oy', -2000, 2000, 0.1))),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno', texto: '← 1px', onclick: () => empurrar(-1, 0) }), el('button', { class: 'btn pequeno', texto: '1px →', onclick: () => empurrar(1, 0) }),
        el('button', { class: 'btn pequeno', texto: '↑ 1px', onclick: () => empurrar(0, -1) }), el('button', { class: 'btn pequeno', texto: '↓ 1px', onclick: () => empurrar(0, 1) }))),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Aparência' }),
      el('div', { class: 'duas' },
        el('label', {}, 'Cor das linhas', el('input', { type: 'color', value: q.cor, oninput: e => mudar('cor', e.target.value) })),
        el('label', {}, 'Força das linhas', el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: q.opacidade, oninput: e => mudar('opacidade', Number(e.target.value)) })))),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Medidas' }),
      el('label', {}, 'Diagonal', el('select', { onchange: e => mudar('diagonal', e.target.value) },
        el('option', { value: 'simples', texto: 'Regra 2024: toda diagonal = 1,5 m', selected: q.diagonal !== 'alternada' }),
        el('option', { value: 'alternada', texto: 'Opcional: alterna 1,5 m e 3 m', selected: q.diagonal === 'alternada' }))),
      el('p', { class: 'dica', texto: 'Cada quadrado vale 1,5 m. A régua mostra metros e quadrados.' })),
    c.mapa ? null : el('div', { class: 'bloco' }, el('h3', { texto: 'Cena sem mapa' }),
      el('div', { class: 'duas' }, el('label', {}, 'Colunas', num('colunas', 5, 300, 1, c)), el('label', {}, 'Linhas', num('linhas', 5, 300, 1, c))),
      el('label', {}, 'Cor do fundo', el('input', { type: 'color', value: c.fundo, oninput: e => mudar('fundo', e.target.value, c) }))),
  ];
}

function painelJogadores() {
  const online = [...(sala?.jogadores.values() || [])];
  const endereco = location.href.split('#')[0].split('?')[0];
  return [
    el('div', { class: 'bloco' }, el('h3', { texto: 'Como os jogadores entram' }),
      el('p', { class: 'dica', texto: `1. Abrem ${endereco}` }),
      el('p', { class: 'dica', texto: `2. Clicam em "Sou jogador" e digitam o código ${M.codigo}.` }),
      el('button', { class: 'btn', texto: 'Copiar endereço e código', onclick: () => { navigator.clipboard?.writeText(`${endereco}\nCódigo da sala: ${M.codigo}`); avisar('Copiado.'); } })),
    el('div', { class: 'bloco' }, el('h3', { texto: `Conectados agora (${online.length})` }),
      online.length ? el('div', { class: 'lista' }, online.map(j => el('div', { class: 'item' },
        el('span', { class: 'bola', style: `background:${j.cor}` }),
        el('span', { class: 'nome', texto: j.nome }),
        envios.get(j.id)?.texto ? el('span', { class: 'etiqueta ouro', texto: envios.get(j.id).texto }) : null,
        el('span', { class: 'etiqueta cinza', texto: j.celular ? 'celular' : 'PC' }))))
        : el('p', { class: 'vazio', texto: 'Ninguém conectado ainda.' })),
    el('p', { class: 'dica', texto: 'Para um jogador mover o próprio token: selecione o token e escolha o jogador em "Quem pode mover".' }),
  ];
}

// ---------- backup (um arquivo só, com os mapas dentro) ----------
// Formato: "ARCTAB1\n" + 10 dígitos com o tamanho do cabeçalho + cabeçalho JSON + os arquivos colados em seguida.
async function baixarBackup() {
  avisar('Montando o backup…');
  const usados = [...new Set(M.cenas.flatMap(c => (c.mapa ? [c.mapa.hash, c.mapa.leve] : [])))];
  const arquivos = [], partes = [];
  for (const h of usados) {
    const a = await ler('arquivos', h); if (!a) continue;
    arquivos.push({ hash: h, w: a.w, h: a.h, tipo: a.tipo || a.blob.type, tamanho: a.blob.size }); partes.push(a.blob);
  }
  const cab = new TextEncoder().encode(JSON.stringify({ formato: 'arcana-tabuleiro', versao: 1, app: VERSAO, data: new Date().toISOString(), estado: M, arquivos }));
  const blob = new Blob(['ARCTAB1\n', String(cab.length).padStart(10, '0'), cab, ...partes], { type: 'application/octet-stream' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `arcana-tabuleiro-backup-${new Date().toISOString().slice(0, 10)}.arcanatab` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  avisar(`Backup pronto (${tamanhoLegivel(blob.size)}).`);
}
async function restaurarBackup() {
  const arq = await escolherArquivo('.arcanatab');
  if (!arq) return;
  try {
    const topo = await arq.slice(0, 18).text();
    if (!topo.startsWith('ARCTAB1\n')) throw new Error('Este arquivo não é um backup do Arcana Tabuleiro.');
    const n = Number(topo.slice(8, 18));
    const cab = JSON.parse(await arq.slice(18, 18 + n).text());
    if (cab.formato !== 'arcana-tabuleiro' || !Array.isArray(cab.estado?.cenas)) throw new Error('Backup inválido.');
    if (!confirm(`Restaurar o backup de ${new Date(cab.data).toLocaleString('pt-BR')}? As cenas atuais serão SUBSTITUÍDAS.`)) return;
    let pos = 18 + n;
    for (const f of cab.arquivos) {
      const blob = arq.slice(pos, pos + f.tamanho, f.tipo); pos += f.tamanho;
      if ((await hashDe(await blob.arrayBuffer())) !== f.hash) throw new Error('O backup está corrompido (um mapa não confere).');
      await guardar('arquivos', f.hash, { blob, w: f.w, h: f.h, tipo: f.tipo });
    }
    const codigo = M.codigo;
    Object.assign(M, cab.estado, { codigo });
    await guardar('dados', 'mestre', M);
    avisar('Backup restaurado.');
    await abrirCenaNoTabuleiro(); enviarCena(); desenharPainelMestre();
  } catch (e) { avisar(e.message, true); }
}
function painelBackup() {
  const uso = el('p', { class: 'dica', texto: 'Calculando espaço…' });
  espaco().then(e => { uso.textContent = e ? `Usando ${tamanhoLegivel(e.usado)} de ${tamanhoLegivel(e.total)} que o navegador libera para este site.` : ''; });
  return [
    el('div', { class: 'bloco' }, el('h3', { texto: 'Guardar tudo num arquivo' }),
      el('p', { class: 'dica', texto: 'Tudo fica salvo neste navegador. Limpar os dados do navegador apaga as cenas, então baixe um backup no fim de cada sessão. O backup leva os mapas junto, por isso pode ficar grande.' }),
      el('button', { class: 'btn primario', texto: 'Baixar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', texto: 'Restaurar backup', onclick: restaurarBackup }), uso),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Código da sala' }),
      el('p', { class: 'dica', texto: 'O código continua o mesmo entre as sessões. Se ele vazou, gere outro (os jogadores precisarão do novo).' }),
      el('button', { class: 'btn', texto: 'Gerar código novo', onclick: async () => {
        if (!confirm('Gerar um código novo? Quem estiver conectado vai cair.')) return;
        M.codigo = novoCodigo(); await guardar('dados', 'mestre', M); sala?.fechar(); setTimeout(() => location.reload(), 700);
      } })),
    el('p', { class: 'dica', texto: `Arcana Tabuleiro ${VERSAO}` }),
  ];
}

// =====================================================================
//                               JOGADOR
// =====================================================================
const J = { eu: null, codigo: null, cena: null, conexao: null, esperando: new Set() };

function lerPerfil() { try { return JSON.parse(localStorage.getItem('arcana-tab-jogador') || 'null'); } catch { return null; } }
function salvarPerfil(p) { try { localStorage.setItem('arcana-tab-jogador', JSON.stringify(p)); } catch {} }

function limparCenaRecebida(c) {
  if (!c || typeof c !== 'object') return null;
  const q = c.grade || {};
  return {
    id: String(c.id), nome: String(c.nome || '').slice(0, 60),
    colunas: inteiro(c.colunas, 5, 300, 30), linhas: inteiro(c.linhas, 5, 300, 20), fundo: corValida(c.fundo) || '#2a2f2b',
    grade: { tam: numero(q.tam, 8, 2000, 70), ox: numero(q.ox, -2000, 2000), oy: numero(q.oy, -2000, 2000), cor: corValida(q.cor) || '#000000',
      opacidade: numero(q.opacidade, 0, 1, 0.35), mostrar: q.mostrar !== false, diagonal: q.diagonal === 'alternada' ? 'alternada' : 'simples' },
    mapa: c.mapa && /^[0-9a-f]{32}$/.test(c.mapa.hash) ? { hash: c.mapa.hash, w: inteiro(c.mapa.w, 1, 1e6, 1), h: inteiro(c.mapa.h, 1, 1e6, 1) } : null,
    tokens: Array.isArray(c.tokens) ? c.tokens.map(limparToken).filter(Boolean) : [],
  };
}
function limparToken(t) {
  if (!t || typeof t !== 'object') return null;
  const r = { id: String(t.id).slice(0, 64), nome: String(t.nome || '').slice(0, 40), tipo: t.tipo === 'pc' ? 'pc' : 'npc', cor: corValida(t.cor) || '#5b7c66',
    tam: numero(t.tam, 0.5, 4, 1), x: inteiro(t.x, -500, 5000), y: inteiro(t.y, -500, 5000), dono: String(t.dono || ''), img: imagemValida(t.img) };
  if (t.tipo === 'pc') { r.pv = inteiro(t.pv, -999, 9999); r.pvMax = inteiro(t.pvMax, 0, 9999); }
  else r.estado = ['Ileso', 'Ferido', 'Muito ferido', 'Caído'].includes(t.estado) ? t.estado : '';
  return r;
}

const receber = criarReceptor(async (hash, blob, info) => {
  J.esperando.delete(hash);
  try {
    const conferido = await guardarArquivo(blob, info.w, info.h);
    if (conferido !== hash) { avisar('Um mapa chegou com defeito. Pedindo de novo…', true); pedirMapa(hash); return; }
  } catch (e) { avisar('Não consegui guardar o mapa: ' + e.message, true); return; }
  if (J.cena?.mapa?.hash === hash) { await mostrarMapa(J.cena, hash); }
  else if (!J.esperando.size) avisoMapa(null);
}, (hash, f) => {
  if (J.cena?.mapa?.hash === hash) avisoMapa(`Recebendo o mapa do mestre… ${Math.round(f * 100)}%`, f);
});

function pedirMapa(hash) {
  if (J.esperando.has(hash)) return;
  J.esperando.add(hash);
  J.conexao.enviar({ t: 'preciso', hash });
}

async function receberCena(c) {
  const anterior = J.cena?.id;
  J.cena = limparCenaRecebida(c);
  tab.definirCena(J.cena || { tokens: [], grade: { tam: 70, ox: 0, oy: 0 } });
  if (J.cena?.mapa) {
    const pronto = await mostrarMapa(J.cena, J.cena.mapa.hash);
    if (!pronto) { avisoMapa('Esperando o mapa do mestre…', 0); pedirMapa(J.cena.mapa.hash); }
  } else await mostrarMapa(J.cena, null);
  if (anterior !== J.cena?.id) {
    const meu = J.cena?.tokens.find(t => t.dono === J.eu.id);
    if (meu && tab.vista) { tab.enquadrar(); tab.centralizarEm(meu); } else tab.enquadrar();
  }
  desenharPainelJogador();
}

function tratarMensagemDoMestre(msg) {
  if (receber(msg)) return;
  const c = J.cena;
  if (msg.t === 'bemvindo' || msg.t === 'cena') { receberCena(msg.cena); return; }
  if (!c) return;
  if (msg.t === 'tok') {
    const t = limparToken(msg.tok); if (!t) return;
    const i = c.tokens.findIndex(x => x.id === t.id);
    if (i >= 0) c.tokens[i] = t; else c.tokens.push(t);
    tab.redesenhar(); desenharPainelJogador();
  } else if (msg.t === 'tok-fora') {
    c.tokens = c.tokens.filter(x => x.id !== msg.id); tab.redesenhar(); desenharPainelJogador();
  } else if (msg.t === 'mov') {
    const t = c.tokens.find(x => x.id === msg.id);
    if (t) { t.x = inteiro(msg.x, -500, 5000); t.y = inteiro(msg.y, -500, 5000); tab.redesenhar(); }
  } else if (msg.t === 'ping') {
    tab.mostrarPing(numero(msg.x, -1e6, 1e6), numero(msg.y, -1e6, 1e6), corValida(msg.cor) || '#d3bb7c');
  } else if (msg.t === 'regua') {
    const cel = p => (p && { cx: inteiro(p.cx, -1e5, 1e5), cy: inteiro(p.cy, -1e5, 1e5) });
    tab.mostrarRegua(String(msg.id), cel(msg.a), cel(msg.b), corValida(msg.cor) || '#d3bb7c', String(msg.nome || '').slice(0, 40));
  } else if (msg.t === 'precarregar' && Array.isArray(msg.mapas)) {
    (async () => {
      let faltam = 0;
      for (const m of msg.mapas.slice(0, 200)) {
        if (!/^[0-9a-f]{32}$/.test(m?.hash)) continue;
        if (!(await ler('arquivos', m.hash))) { faltam++; pedirMapa(m.hash); }
      }
      avisar(faltam ? `O mestre está enviando ${faltam} ${faltam === 1 ? 'mapa' : 'mapas'} da sessão.` : 'Você já tem todos os mapas da sessão.');
    })();
  }
}

function iniciarJogador(perfil, codigo) {
  papel = 'jogador';
  J.eu = { id: perfil.id, nome: perfil.nome, cor: perfil.cor, celular };
  J.codigo = codigo;
  pedirPersistencia();
  let ultimaRegua = 0, reguaPendente = null;
  prepararTabuleiro({
    podeMover: t => t.dono === J.eu.id,
    aoMover: (t, x, y) => { t.x = x; t.y = y; tab.redesenhar(); J.conexao.enviar({ t: 'mover', id: t.id, x, y }); },
    aoSelecionar: () => tab.redesenhar(),
    aoPing: (x, y) => { tab.mostrarPing(x, y, J.eu.cor); J.conexao.enviar({ t: 'ping', x, y }); },
    aoRegua: r => {
      // manda no máximo 20 vezes por segundo
      reguaPendente = r;
      const agora = performance.now();
      if (!r || agora - ultimaRegua > 50) { ultimaRegua = agora; J.conexao.enviar({ t: 'regua', a: r?.a, b: r?.b }); reguaPendente = null; }
      else setTimeout(() => { if (reguaPendente) { J.conexao.enviar({ t: 'regua', a: reguaPendente.a, b: reguaPendente.b }); reguaPendente = null; } }, 60);
    },
  });
  $('#mesa').classList.add('jogador');
  tab.corPropria = J.eu.cor;
  tab.definirCena({ tokens: [], grade: { tam: 70, ox: 0, oy: 0 }, colunas: 30, linhas: 20 });
  tab.enquadrar();
  $('#chip-codigo').textContent = codigo;
  $('#chip-codigo').addEventListener('click', () => { navigator.clipboard?.writeText(codigo); avisar('Código copiado.'); });
  $('#btn-sair').addEventListener('click', () => { if (confirm('Sair da mesa?')) { J.conexao.sair(); location.reload(); } });
  avisoMapa('Conectando à sala do mestre…');
  desenharPainelJogador();
  if (!window.Peer) { definirStatus('Sem a biblioteca de conexão.', 'off'); return; }
  J.conexao = entrarNaSala(codigo, J.eu, {
    aoConectar: () => {
      definirStatus('Conectado', 'on'); avisoMapa(null);
      // reconectou: pede de novo os mapas que estavam a caminho
      const pendentes = [...J.esperando]; J.esperando.clear(); pendentes.forEach(pedirMapa);
    },
    aoStatus: t => definirStatus(t, 'espera'),
    aoMensagem: tratarMensagemDoMestre,
    aoFim: () => { definirStatus('O mestre encerrou a sala.', 'off'); avisar('O mestre encerrou a sala.'); },
  });
}

function desenharPainelJogador() {
  const meus = J.cena?.tokens.filter(t => t.dono === J.eu.id) || [];
  $('#painel').replaceChildren(el('div', { class: 'conteudo' },
    el('div', { class: 'bloco' }, el('h3', { texto: J.cena ? J.cena.nome : 'Esperando o mestre' }),
      el('p', { class: 'dica', texto: `Você é ${J.eu.nome}.` })),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Seus tokens' }),
      meus.length ? el('div', { class: 'lista' }, meus.map(t => el('button', { class: 'item', onclick: () => { tab.centralizarEm(t); $('#painel').classList.remove('aberto'); } },
        el('span', { class: 'bola', style: `background:${t.cor}` }), el('span', { class: 'nome', texto: t.nome }),
        t.pvMax ? el('span', { class: 'etiqueta cinza', texto: `${t.pv}/${t.pvMax} PV` }) : null)))
        : el('p', { class: 'vazio', texto: 'O mestre ainda não te deu um token. Peça para ele escolher você em "Quem pode mover".' })),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Como usar' }),
      el('p', { class: 'dica', texto: celular
        ? 'Arraste com um dedo para mover a tela ou o seu token. Dois dedos dão zoom. Segure o dedo parado para fazer um ping.'
        : 'Arraste seu token para andar. Arraste o fundo para mover a tela e use a rodinha para o zoom. Shift + clique faz um ping. R = régua.' })),
    el('div', { class: 'bloco' }, el('h3', { texto: 'Mapas guardados' }),
      el('button', { class: 'btn pequeno', texto: 'Apagar os mapas guardados neste aparelho', onclick: async () => {
        if (!confirm('Apagar os mapas guardados? Eles serão baixados de novo do mestre quando precisar.')) return;
        for (const k of await chaves('arquivos')) await apagar('arquivos', k);
        avisar('Mapas apagados.');
      } })),
  ));
}

// =====================================================================
//                           TELA INICIAL
// =====================================================================
// Para os testes automáticos e para estudar no console do navegador (F12).
window.arcanaTabuleiro = { get tab() { return tab; }, M, J };

(async function inicio() {
  const perfil = lerPerfil();
  if (perfil) { $('#j-nome').value = perfil.nome || ''; $('#j-cor').value = corValida(perfil.cor) || '#a4c29a'; $('#j-codigo').value = perfil.codigo || ''; }
  const codigoNaUrl = new URLSearchParams(location.search).get('sala');
  if (codigoNaUrl) $('#j-codigo').value = codigoNaUrl.toUpperCase().slice(0, 6);
  const salvo = await ler('dados', 'mestre').catch(() => null);
  if (salvo?.codigo) $('#mestre-info').textContent = `Você já tem ${salvo.cenas?.length || 0} ${salvo.cenas?.length === 1 ? 'cena' : 'cenas'} salvas. Código da sala: ${salvo.codigo}.`;

  $('#btn-mestre').addEventListener('click', () => iniciarMestre().catch(e => avisar('Erro ao abrir: ' + e.message, true)));
  $('#j-codigo').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#form-jogador').addEventListener('submit', e => {
    e.preventDefault();
    const codigo = $('#j-codigo').value.trim().toUpperCase();
    if (!codigoValido(codigo)) { avisar('O código tem 6 letras e números. Peça de novo ao mestre.', true); return; }
    const p = { id: perfil?.id || uid(), nome: $('#j-nome').value.trim().slice(0, 40) || 'Jogador', cor: $('#j-cor').value, codigo };
    salvarPerfil(p);
    iniciarJogador(p, codigo);
  });
})();
