// app.js — o "maestro": telas, painéis do mestre, tela do jogador e as mensagens entre eles.
import { guardar, ler, apagar, chaves, pedirPersistencia, espaco, tamanhoLegivel, hashDe } from './armazem.js';
import { importarMapa, carregarMapa, liberarMapa, retratoPequeno, guardarArquivo } from './mapas.js';
import { criarTabuleiro, estadoDe, celulasDe } from './tabuleiro.js';
import { abrirSala, entrarNaSala, novoCodigo, codigoValido, enviarArquivo, criarReceptor } from './conexao.js';

const VERSAO = '0.2';
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
  const caixa = $('#avisos');
  while (caixa.children.length >= 3) caixa.firstChild.remove(); // no máximo 3 avisos de cada vez
  const a = el('div', { class: 'aviso' + (erro ? ' erro' : ''), texto });
  caixa.append(a);
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
const hashValido = h => typeof h === 'string' && /^[0-9a-f]{32}$/.test(h);
const TIPOS_IMAGEM = 'image/png,image/jpeg,image/webp';

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

// Imagens soltas no tabuleiro (pedaços de mapa, itens, cartas): ficam abertas na memória por hash.
const imagensAbertas = new Map(); // hash -> { m } ou { carregando: true }
async function abrirImagem(hash) {
  if (imagensAbertas.has(hash)) return true;
  imagensAbertas.set(hash, { carregando: true });
  try {
    const m = await carregarMapa(hash);
    if (!m) { imagensAbertas.delete(hash); return false; }
    if (!imagensAbertas.has(hash)) { liberarMapa(m); return true; }
    imagensAbertas.set(hash, { m });
    tab.redesenhar();
    return true;
  } catch { imagensAbertas.delete(hash); return true; }
}
// Fecha as imagens que a cena não usa mais e devolve as que ela usa.
function imagensDaCena(cena) {
  const usadas = new Set((cena?.imagens || []).map(i => i.hash));
  for (const [h, v] of imagensAbertas) if (!usadas.has(h)) { liberarMapa(v.m); imagensAbertas.delete(h); }
  return [...usadas];
}

// Janela "mostrar a todos" (carta, item, retrato em tela cheia)
let urlVitrine = null;
async function abrirVitrine(hash, nome, mestre = false) {
  const reg = await ler('arquivos', hash);
  if (!reg) return false;
  fecharVitrine(false);
  urlVitrine = URL.createObjectURL(reg.blob);
  $('#vitrine-img').src = urlVitrine;
  $('#vitrine-img').alt = nome || 'Imagem';
  $('#vitrine-nome').textContent = nome || '';
  $('#vitrine-fechar').textContent = mestre ? 'Fechar para todos' : 'Fechar';
  $('#vitrine').hidden = false;
  return true;
}
function fecharVitrine(avisarJogadores = true) {
  $('#vitrine').hidden = true;
  if (urlVitrine) { URL.revokeObjectURL(urlVitrine); urlVitrine = null; }
  if (avisarJogadores && papel === 'mestre') sala?.paraTodos({ t: 'mostrar-fim' });
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
  $('#vitrine-fechar').addEventListener('click', () => fecharVitrine(true));
  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && !$('#vitrine').hidden) { fecharVitrine(true); return; }
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
    tokens: [], imagens: [],
  };
}
function normalizar() { for (const c of M.cenas) { c.tokens ||= []; c.imagens ||= []; } }
const cenaAberta = () => M.cenas.find(c => c.id === M.aberta) || M.cenas[0];
const cenaAtiva = () => M.cenas.find(c => c.id === M.ativa) || null;
const salvar = () => { clearTimeout(salvarTimer); salvarTimer = setTimeout(() => guardar('dados', 'mestre', M).catch(e => avisar('Não consegui salvar: ' + e.message, true)), 300); };
// todos os arquivos (mapas e imagens) que as cenas usam
const hashesUsados = () => new Set(M.cenas.flatMap(c => [
  ...(c.mapa ? [c.mapa.hash, c.mapa.leve] : []),
  ...(c.imagens || []).flatMap(i => [i.hash, i.leve]),
]));

// O que um jogador pode ver de uma cena: sem tokens/imagens escondidos, monstros sem PV exato.
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
    imagens: (cena.imagens || []).filter(i => !i.oculto).map(i => ({
      id: i.id, hash: j.celular ? i.leve : i.hash, w: i.w, h: i.h, x: i.x, y: i.y, largura: i.largura, rot: i.rot, camada: i.camada,
    })),
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
// mudanças de imagem: manda a cena (só se for a que os jogadores estão vendo)
function enviarImagens(cena) { if (cena.id === M.ativa) enviarCena(); }

// manda um arquivo para um jogador, um de cada vez
function mandarMapa(j, hash) {
  if (!hashesUsados().has(hash)) return;
  const reg = envios.get(j.id) || { fila: Promise.resolve(), texto: '' };
  envios.set(j.id, reg);
  reg.fila = reg.fila.then(async () => {
    const arq = await ler('arquivos', hash);
    if (!arq || !j.conn.open) return;
    await enviarArquivo(j.conn, hash, arq.blob, { w: arq.w, h: arq.h }, f => {
      reg.texto = f >= 1 ? '' : `Recebendo ${Math.round(f * 100)}%`;
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
  normalizar();
  if (!M.codigo) M.codigo = novoCodigo();
  if (!M.cenas.some(c => c.id === M.aberta)) M.aberta = M.cenas[0].id;
  if (M.ativa && !M.cenas.some(c => c.id === M.ativa)) M.ativa = null;
  if (!M.ativa) M.ativa = M.aberta;
  M.conhecidos ||= {};
  salvar();

  escolherFerramenta = prepararTabuleiro({
    podeMover: () => true,
    aoMover: (t, x, y) => { t.x = x; t.y = y; salvar(); tab.redesenhar(); if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'mov', id: t.id, x, y }); },
    aoSelecionar: t => { if (t) abaMestre = 'tokens'; desenharPainelMestre(); },
    aoEditar: t => { tab.selecionado = t.id; tab.imagemSelecionada = null; abaMestre = 'tokens'; desenharPainelMestre(); abrirPainelCelular(); },
    imagemDe: hash => imagensAbertas.get(hash)?.m || null,
    aoSelecionarImagem: () => { abaMestre = 'imagens'; desenharPainelMestre(); },
    aoMudarImagem: () => { salvar(); enviarImagens(cenaAberta()); atualizarSeAba('imagens'); },
    aoPing: (x, y) => { tab.mostrarPing(x, y, '#d3bb7c'); if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'ping', x, y, cor: '#d3bb7c' }); },
    aoRegua: r => { if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'regua', id: 'mestre', a: r?.a, b: r?.b, cor: '#d3bb7c', nome: 'Mestre' }); },
    aoAjustarGrade: (tam, ox, oy) => {
      Object.assign(cenaAberta().grade, { tam: Math.round(tam * 10) / 10, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
      salvar(); tab.redesenhar(); enviarCena(); abaMestre = 'grade'; desenharPainelMestre(); escolherFerramenta('mover');
      avisar('Grade ajustada. Use os campos da aba Grade para o ajuste fino.');
    },
    aoTecla: e => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const c = cenaAberta();
      const t = c.tokens.find(x => x.id === tab.selecionado);
      if (t) { if (confirm(`Excluir o token "${t.nome}"?`)) excluirToken(c, t); return; }
      const im = c.imagens.find(x => x.id === tab.imagemSelecionada);
      if (im && confirm(`Excluir a imagem "${im.nome}"?`)) excluirImagem(c, im);
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
  } else if (msg.t === 'preciso' && hashValido(msg.hash)) {
    mandarMapa(j, msg.hash);
  }
}

async function abrirCenaNoTabuleiro() {
  const c = cenaAberta();
  tab.selecionado = null; tab.imagemSelecionada = null;
  tab.definirCena(c);
  for (const h of imagensDaCena(c)) abrirImagem(h);
  if (c.mapa) await mostrarMapa(c, c.mapa.hash); else await mostrarMapa(c, null);
  tab.enquadrar();
}

function excluirToken(c, t) {
  c.tokens = c.tokens.filter(x => x !== t);
  if (tab.selecionado === t.id) tab.selecionado = null;
  enviarToken(c, t, true); salvar(); tab.redesenhar(); desenharPainelMestre();
}
function excluirImagem(c, im) {
  c.imagens = c.imagens.filter(x => x !== im);
  if (tab.imagemSelecionada === im.id) tab.imagemSelecionada = null;
  salvar(); tab.redesenhar(); enviarImagens(c); imagensDaCena(c); limparArquivosSemUso(); desenharPainelMestre();
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
  const abas = [['cenas', 'Cenas'], ['tokens', 'Tokens'], ['imagens', 'Imagens'], ['grade', 'Grade'], ['jogadores', 'Jogadores'], ['backup', 'Backup']];
  const corpo = { cenas: painelCenas, tokens: painelTokens, imagens: painelImagens, grade: painelGrade, jogadores: painelJogadores, backup: painelBackup }[abaMestre]();
  const rolagem = $('#painel .conteudo')?.scrollTop || 0;
  $('#painel').replaceChildren(
    el('div', { class: 'abas', role: 'tablist' }, abas.map(([id, nome]) =>
      el('button', { role: 'tab', 'aria-selected': String(abaMestre === id), texto: nome, onclick: () => { abaMestre = id; desenharPainelMestre(); } }))),
    el('div', { class: 'conteudo' }, corpo),
  );
  $('#painel .conteudo').scrollTop = rolagem;
}
// título de bloco com um botão pequeno à direita
const titulo = (texto, botao) => el('div', { class: 'titulo' }, el('h3', { texto }), botao || null);

function painelCenas() {
  const c = cenaAberta();
  const lista = el('div', { class: 'lista' }, M.cenas.map(s => el('button', {
    class: 'item' + (s.id === c.id ? ' sel' : ''),
    onclick: async () => { M.aberta = s.id; salvar(); await abrirCenaNoTabuleiro(); desenharPainelMestre(); },
  }, el('span', { class: 'nome', texto: s.nome }),
    s.id === M.ativa ? el('span', { class: 'etiqueta', texto: 'jogadores aqui' }) : null,
    s.mapa ? null : el('span', { class: 'etiqueta cinza', texto: 'sem mapa' }))));

  const progresso = el('p', { class: 'dica', texto: c.mapa ? `Mapa: ${c.mapa.w} × ${c.mapa.h} px` : 'Sem mapa: a grade cobre tudo.' });
  const trocarMapa = async () => {
    const arq = await escolherArquivo(TIPOS_IMAGEM);
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
    el('div', { class: 'bloco' },
      titulo('Cena aberta: ' + c.nome),
      c.id === M.ativa
        ? el('p', { class: 'dica destaque', texto: '✓ Os jogadores estão vendo esta cena.' })
        : el('button', { class: 'btn primario', texto: 'Levar os jogadores para esta cena', onclick: () => { M.ativa = c.id; salvar(); enviarCena(); desenharPainelMestre(); avisar('Jogadores levados para ' + c.nome + '.'); } }),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno', texto: c.mapa ? 'Trocar mapa' : 'Escolher mapa', onclick: trocarMapa }),
        c.mapa ? el('button', { class: 'btn pequeno', texto: 'Tirar mapa', onclick: async () => { c.mapa = null; salvar(); await abrirCenaNoTabuleiro(); enviarCena(); limparArquivosSemUso(); desenharPainelMestre(); } }) : null,
        el('button', { class: 'btn pequeno', texto: 'Renomear', onclick: () => { const n = prompt('Novo nome:', c.nome); if (n) { c.nome = n.slice(0, 60); salvar(); enviarCena(); desenharPainelMestre(); } } }),
        el('button', { class: 'btn pequeno perigo', texto: 'Excluir', disabled: M.cenas.length === 1, onclick: async () => {
          if (!confirm(`Excluir a cena "${c.nome}" com todos os tokens e imagens?`)) return;
          M.cenas = M.cenas.filter(s => s !== c);
          if (M.ativa === c.id) M.ativa = M.cenas[0].id;
          M.aberta = M.cenas[0].id; salvar(); limparArquivosSemUso(); await abrirCenaNoTabuleiro(); enviarCena(); desenharPainelMestre();
        } })),
      progresso),
    el('div', { class: 'bloco cresce' },
      titulo(`Suas cenas (${M.cenas.length})`, el('button', { class: 'btn pequeno', texto: '+ Nova cena', onclick: async () => {
        const nome = prompt('Nome da nova cena:', `Cena ${M.cenas.length + 1}`); if (!nome) return;
        const s = novaCena(nome.slice(0, 60)); M.cenas.push(s); M.aberta = s.id; salvar(); await abrirCenaNoTabuleiro(); desenharPainelMestre();
      } })),
      lista),
    el('button', { class: 'btn pequeno', texto: 'Pré-carregar todas as cenas nos jogadores', title: 'Manda os mapas e imagens agora, antes do jogo, para as cenas abrirem na hora.', disabled: !sala?.jogadores.size, onclick: preCarregar }),
  ];
}

function preCarregar() {
  for (const j of sala.jogadores.values()) {
    const mapas = M.cenas.flatMap(c => [
      ...(c.mapa ? [{ hash: j.celular ? c.mapa.leve : c.mapa.hash }] : []),
      ...(c.imagens || []).filter(i => !i.oculto).map(i => ({ hash: j.celular ? i.leve : i.hash })),
    ]);
    sala.enviar(j, { t: 'precarregar', mapas });
  }
  avisar('Pré-carregamento iniciado. Veja o progresso na aba Jogadores.');
}

async function limparArquivosSemUso() {
  const usados = hashesUsados();
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

  const ajustePV = el('input', { type: 'number', min: 0, placeholder: 'Valor', inputmode: 'numeric', 'aria-label': 'Valor de dano ou cura' });
  const mudarPV = sinal => { const v = inteiro(ajustePV.value, 0, 9999, 0); if (!v || !t) return; t.pv = Math.min(t.pvMax || 9999, t.pv + sinal * v); ajustePV.value = ''; salvar(); tab.redesenhar(); enviarToken(c, t); desenharPainelMestre(); };

  const form = el('div', { class: 'bloco' },
    titulo(t ? 'Editar: ' + t.nome : 'Novo token', t ? el('button', { class: 'btn pequeno', texto: '+ Novo', onclick: () => { tab.selecionado = null; tab.redesenhar(); desenharPainelMestre(); } }) : null),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'cresce' }, 'Nome', campo('nome', { maxlength: 40 })),
      el('label', {}, 'Cor', campo('cor', { type: 'color' }))),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'cresce' }, 'Tipo', el('select', { onchange: e => { rascunho.tipo = e.target.value; if (t) aplicar(); } },
        el('option', { value: 'pc', texto: 'Personagem', selected: rascunho.tipo === 'pc' }),
        el('option', { value: 'npc', texto: 'Monstro / PdM', selected: rascunho.tipo !== 'pc' }))),
      el('label', { class: 'cresce' }, 'Tamanho', el('select', { onchange: e => { rascunho.tam = Number(e.target.value); if (t) aplicar(); } },
        TAMANHOS.map(([v, n]) => el('option', { value: v, texto: n, selected: Number(rascunho.tam) === v }))))),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'curto' }, 'PV', campo('pv', { type: 'number', inputmode: 'numeric' })),
      el('label', { class: 'curto' }, 'PV máx.', campo('pvMax', { type: 'number', min: 0, inputmode: 'numeric' })),
      el('label', { class: 'cresce' }, 'Quem move', donos)),
    t ? el('div', { class: 'linha-campos' }, el('div', { class: 'curto' }, ajustePV),
      el('button', { class: 'btn pequeno perigo cresce', texto: '− Dano', onclick: () => mudarPV(-1) }),
      el('button', { class: 'btn pequeno cresce', texto: '+ Cura', onclick: () => mudarPV(1) })) : null,
    el('div', { class: 'linha-campos meio' }, previa,
      el('button', { class: 'btn pequeno', texto: rascunho.img ? 'Trocar retrato' : 'Retrato', onclick: async () => {
        const arq = await escolherArquivo('image/*'); if (!arq) return;
        try { rascunho.img = await retratoPequeno(arq); previa.src = rascunho.img; previa.hidden = false; if (t) aplicar(); }
        catch { avisar('Não consegui abrir essa imagem.', true); }
      } }),
      rascunho.img ? el('button', { class: 'btn pequeno', texto: 'Tirar', onclick: () => { rascunho.img = null; if (t) aplicar(); desenharPainelMestre(); } }) : null,
      el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: !!rascunho.oculto, onchange: e => { rascunho.oculto = e.target.checked; if (t) { aplicar(); desenharPainelMestre(); } } }), 'Escondido')),
    t
      ? el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno', texto: 'Duplicar', onclick: () => {
          const n = { ...t, id: uid(), x: t.x + celulasDe(t.tam), nome: proximoNome(c, t.nome) };
          c.tokens.push(n); tab.selecionado = n.id; salvar(); tab.redesenhar(); enviarToken(c, n); desenharPainelMestre();
        } }),
        el('button', { class: 'btn pequeno', texto: 'Centralizar', onclick: () => tab.centralizarEm(t) }),
        el('button', { class: 'btn pequeno perigo', texto: 'Excluir', onclick: () => excluirToken(c, t) }))
      : el('button', { class: 'btn primario', texto: 'Colocar no centro da tela', onclick: () => {
        const n = { id: uid(), ...lerFormulario() }, centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
        n.x = cel.cx; n.y = cel.cy; c.tokens.push(n); tab.selecionado = n.id; tab.imagemSelecionada = null; rascunhoNovo = null;
        salvar(); tab.redesenhar(); enviarToken(c, n); desenharPainelMestre();
      } }),
  );

  const lista = el('div', { class: 'bloco cresce' }, titulo(`Tokens nesta cena (${c.tokens.length})`),
    c.tokens.length ? el('div', { class: 'lista' }, c.tokens.map(x => el('div', { class: 'item' + (x.id === tab.selecionado ? ' sel' : ''),
      onclick: () => { tab.selecionado = x.id; tab.imagemSelecionada = null; tab.centralizarEm(x); desenharPainelMestre(); } },
      el('span', { class: 'bola', style: `background:${x.cor}` }),
      el('span', { class: 'nome', texto: x.nome }),
      x.tipo === 'pc' ? el('span', { class: 'etiqueta', texto: 'personagem' }) : null,
      x.pvMax ? el('span', { class: 'etiqueta cinza', texto: `${x.pv}/${x.pvMax}` }) : null,
      botaoOlho(x, () => { salvar(); tab.redesenhar(); enviarToken(c, x); desenharPainelMestre(); }))))
      : el('p', { class: 'vazio', texto: 'Nenhum token ainda. Preencha acima e coloque no mapa.' }));
  return [form, lista];
}
function botaoOlho(x, depois) {
  const rotulo = x.oculto ? 'Mostrar aos jogadores' : 'Esconder dos jogadores';
  return el('button', { class: 'olho', title: rotulo, 'aria-label': rotulo, texto: x.oculto ? '🙈' : '👁',
    onclick: e => { e.stopPropagation(); x.oculto = !x.oculto; depois(); } });
}
function proximoNome(c, nome) {
  const base = nome.replace(/\s+\d+$/, '');
  let i = 2; while (c.tokens.some(t => t.nome === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// ---------- imagens: pedaços de mapa, itens, cartas ----------
function painelImagens() {
  const c = cenaAberta(), q = c.grade;
  const im = c.imagens.find(x => x.id === tab.imagemSelecionada) || null;
  const progresso = el('p', { class: 'dica', texto: 'Arraste a imagem no tabuleiro. O quadradinho dourado no canto muda o tamanho.' });
  const mudou = () => { salvar(); tab.redesenhar(); enviarImagens(c); };

  async function adicionar(camada) {
    const arq = await escolherArquivo(TIPOS_IMAGEM);
    if (!arq) return;
    try {
      const info = await importarMapa(arq, t => { progresso.textContent = t; });
      const centro = tab.centroDaTela();
      const largura = camada === 'fundo' ? info.w : q.tam * 3;
      const n = { id: uid(), nome: arq.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Imagem', ...info,
        x: centro.x, y: centro.y, largura, rot: 0, camada, oculto: false, travado: false };
      c.imagens.push(n);
      await abrirImagem(n.hash);
      tab.imagemSelecionada = n.id; tab.selecionado = null;
      mudou();
      avisar(camada === 'fundo' ? 'Imagem colocada como parte do mapa.' : 'Imagem colocada como objeto.');
    } catch (e) { avisar(e.message, true); }
    desenharPainelMestre();
  }

  const medidaQuadrados = im ? Math.round(im.largura / q.tam * 10) / 10 : 0;
  const editor = im ? el('div', { class: 'bloco' },
    titulo('Imagem: ' + im.nome),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'cresce' }, 'Nome', el('input', { value: im.nome, maxlength: 40, oninput: e => { im.nome = e.target.value.slice(0, 40); salvar(); } })),
      el('label', { class: 'curto' }, 'Largura (□)', el('input', { type: 'number', min: 0.2, step: 0.5, value: medidaQuadrados, inputmode: 'decimal',
        oninput: e => { const v = numero(e.target.value, 0.2, 500, 0); if (v) { im.largura = v * q.tam; mudou(); } } }))),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'cresce' }, 'Camada', el('select', { onchange: e => { im.camada = e.target.value; mudou(); } },
        el('option', { value: 'fundo', texto: 'Parte do mapa (embaixo da grade)', selected: im.camada === 'fundo' }),
        el('option', { value: 'objeto', texto: 'Objeto (item, carta, por cima)', selected: im.camada !== 'fundo' })))),
    el('div', { class: 'acoes' },
      el('button', { class: 'btn pequeno', texto: '↻ Girar', onclick: () => { im.rot = ((im.rot || 0) + 90) % 360; mudou(); } }),
      el('button', { class: 'btn pequeno', texto: 'Encaixar na grade', onclick: () => { encaixar(im, q); mudou(); desenharPainelMestre(); } }),
      el('button', { class: 'btn pequeno', texto: 'Para frente', onclick: () => { c.imagens = [...c.imagens.filter(x => x !== im), im]; mudou(); } }),
      el('button', { class: 'btn pequeno', texto: im.travado ? '🔒 Destravar' : 'Travar', title: 'Imagem travada não sai do lugar quando você arrasta o mapa', onclick: () => { im.travado = !im.travado; mudou(); desenharPainelMestre(); } })),
    el('div', { class: 'linha-campos meio' },
      el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: !!im.oculto, onchange: e => { im.oculto = e.target.checked; mudou(); desenharPainelMestre(); } }), 'Escondido dos jogadores'),
      el('span', { class: 'espaco' }),
      el('button', { class: 'btn pequeno perigo', texto: 'Excluir', onclick: () => excluirImagem(c, im) })),
    el('button', { class: 'btn primario', texto: 'Mostrar a todos em tela cheia', onclick: () => mostrarATodos(im) }),
  ) : null;

  const lista = el('div', { class: 'bloco cresce' }, titulo(`Imagens nesta cena (${c.imagens.length})`),
    c.imagens.length ? el('div', { class: 'lista' }, [...c.imagens].reverse().map(x => el('div', { class: 'item' + (x.id === tab.imagemSelecionada ? ' sel' : ''),
      onclick: () => { tab.imagemSelecionada = x.id; tab.selecionado = null; centralizarImagem(x); desenharPainelMestre(); } },
      el('span', { class: 'nome', texto: x.nome }),
      el('span', { class: 'etiqueta cinza', texto: x.camada === 'fundo' ? 'mapa' : 'objeto' }),
      x.travado ? el('span', { class: 'etiqueta cinza', texto: '🔒' }) : null,
      botaoOlho(x, () => { mudou(); desenharPainelMestre(); }))))
      : el('p', { class: 'vazio', texto: 'Nenhuma imagem ainda.' }));

  return [
    el('div', { class: 'bloco' }, titulo('Adicionar imagem'),
      el('div', { class: 'linha-campos' },
        el('button', { class: 'btn pequeno cresce', texto: '+ Parte do mapa', title: 'Um pedaço de mapa: fica embaixo da grade', onclick: () => adicionar('fundo') }),
        el('button', { class: 'btn pequeno cresce', texto: '+ Item ou carta', title: 'Um objeto: fica por cima do mapa', onclick: () => adicionar('objeto') })),
      progresso),
    editor,
    lista,
  ];
}
function centralizarImagem(im) {
  const v = tab.vista, r = $('#tela').getBoundingClientRect();
  v.x = im.x - r.width / 2 / v.escala; v.y = im.y - r.height / 2 / v.escala; tab.redesenhar();
}
// Ajusta a largura para quadrados inteiros e alinha o canto com a grade.
function encaixar(im, q) {
  const deitada = (im.rot || 0) % 180 !== 0;
  const n = Math.max(1, Math.round((deitada ? im.largura * im.h / im.w : im.largura) / q.tam));
  const larguraVista = n * q.tam;
  im.largura = deitada ? larguraVista * im.w / im.h : larguraVista;
  const bw = deitada ? im.largura * im.h / im.w : im.largura, bh = deitada ? im.largura : im.largura * im.h / im.w;
  const esq = q.ox + Math.round((im.x - bw / 2 - q.ox) / q.tam) * q.tam, topo = q.oy + Math.round((im.y - bh / 2 - q.oy) / q.tam) * q.tam;
  im.x = esq + bw / 2; im.y = topo + bh / 2;
}
async function mostrarATodos(im) {
  if (im.oculto && !confirm('Esta imagem está escondida. Mostrar mesmo assim aos jogadores?')) return;
  await abrirVitrine(im.hash, im.nome, true);
  if (!sala) return;
  for (const j of sala.jogadores.values()) sala.enviar(j, { t: 'mostrar', hash: j.celular ? im.leve : im.hash, nome: im.nome });
}

function painelGrade() {
  const c = cenaAberta(), q = c.grade;
  const mudar = (k, v, alvo = q) => { alvo[k] = v; salvar(); tab.redesenhar(); enviarCena(); };
  const num = (k, min, max, passo, alvo = q) => el('input', { type: 'number', min, max, step: passo, value: alvo[k], inputmode: 'decimal',
    oninput: e => { const v = numero(e.target.value, min, max, alvo[k]); if (e.target.value !== '') mudar(k, v, alvo); } });
  const empurrar = (dx, dy) => { q.ox = Math.round((q.ox + dx) * 10) / 10; q.oy = Math.round((q.oy + dy) * 10) / 10; salvar(); tab.redesenhar(); enviarCena(); desenharPainelMestre(); };
  return [
    el('div', { class: 'bloco' }, titulo('Encaixar a grade no mapa'),
      el('button', { class: 'btn primario', texto: 'Medir um quadrado do mapa', onclick: () => escolherFerramenta('grade') }),
      el('p', { class: 'dica', texto: 'Dê bastante zoom e arraste de um canto ao outro de UM quadrado desenhado no mapa.' }),
      el('div', { class: 'linha-campos' },
        el('label', { class: 'cresce' }, 'Quadrado (px)', num('tam', 8, 2000, 0.1)),
        el('label', { class: 'cresce' }, 'Deslocar X', num('ox', -2000, 2000, 0.1)),
        el('label', { class: 'cresce' }, 'Deslocar Y', num('oy', -2000, 2000, 0.1))),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno', texto: '←', 'aria-label': 'Grade 1 pixel para a esquerda', onclick: () => empurrar(-1, 0) }),
        el('button', { class: 'btn pequeno', texto: '→', 'aria-label': 'Grade 1 pixel para a direita', onclick: () => empurrar(1, 0) }),
        el('button', { class: 'btn pequeno', texto: '↑', 'aria-label': 'Grade 1 pixel para cima', onclick: () => empurrar(0, -1) }),
        el('button', { class: 'btn pequeno', texto: '↓', 'aria-label': 'Grade 1 pixel para baixo', onclick: () => empurrar(0, 1) }),
        el('span', { class: 'dica', texto: 'ajuste fino de 1 px' }))),
    el('div', { class: 'bloco' }, titulo('Aparência'),
      el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: q.mostrar !== false, onchange: e => mudar('mostrar', e.target.checked) }), 'Mostrar a grade'),
      el('div', { class: 'linha-campos' },
        el('label', {}, 'Linhas', el('input', { type: 'color', value: q.cor, oninput: e => mudar('cor', e.target.value) })),
        el('label', { class: 'cresce' }, 'Força das linhas', el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: q.opacidade, oninput: e => mudar('opacidade', Number(e.target.value)) })),
        el('label', {}, 'Fundo', el('input', { type: 'color', value: c.fundo, title: 'Cor em volta do mapa', oninput: e => mudar('fundo', e.target.value, c) })))),
    el('div', { class: 'bloco' }, titulo('Medidas'),
      el('label', {}, 'Diagonal', el('select', { onchange: e => mudar('diagonal', e.target.value) },
        el('option', { value: 'simples', texto: 'Regra 2024: toda diagonal = 1,5 m', selected: q.diagonal !== 'alternada' }),
        el('option', { value: 'alternada', texto: 'Opcional: alterna 1,5 m e 3 m', selected: q.diagonal === 'alternada' }))),
      el('p', { class: 'dica', texto: 'Cada quadrado vale 1,5 m. A régua mostra metros e quadrados.' })),
  ];
}

function painelJogadores() {
  const online = [...(sala?.jogadores.values() || [])];
  const endereco = location.href.split('#')[0].split('?')[0];
  return [
    el('div', { class: 'bloco' }, titulo('Como os jogadores entram'),
      el('p', { class: 'dica', texto: `1. Abrem ${endereco}` }),
      el('p', { class: 'dica', texto: `2. Clicam em "Sou jogador" e digitam o código ${M.codigo}.` }),
      el('button', { class: 'btn', texto: 'Copiar endereço e código', onclick: () => { navigator.clipboard?.writeText(`${endereco}\nCódigo da sala: ${M.codigo}`); avisar('Copiado.'); } })),
    el('div', { class: 'bloco cresce' }, titulo(`Conectados agora (${online.length})`),
      online.length ? el('div', { class: 'lista' }, online.map(j => el('div', { class: 'item' },
        el('span', { class: 'bola', style: `background:${j.cor}` }),
        el('span', { class: 'nome', texto: j.nome }),
        envios.get(j.id)?.texto ? el('span', { class: 'etiqueta ouro', texto: envios.get(j.id).texto }) : null,
        el('span', { class: 'etiqueta cinza', texto: j.celular ? 'celular' : 'PC' }))))
        : el('p', { class: 'vazio', texto: 'Ninguém conectado ainda.' })),
    el('p', { class: 'dica', texto: 'Para um jogador mover o próprio token: selecione o token e escolha o jogador em "Quem move".' }),
  ];
}

// ---------- backup (um arquivo só, com os mapas e imagens dentro) ----------
// Formato: "ARCTAB1\n" + 10 dígitos com o tamanho do cabeçalho + cabeçalho JSON + os arquivos colados em seguida.
async function baixarBackup() {
  avisar('Montando o backup…');
  const arquivos = [], partes = [];
  for (const h of hashesUsados()) {
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
      if ((await hashDe(await blob.arrayBuffer())) !== f.hash) throw new Error('O backup está corrompido (um arquivo não confere).');
      await guardar('arquivos', f.hash, { blob, w: f.w, h: f.h, tipo: f.tipo });
    }
    const codigo = M.codigo;
    Object.assign(M, cab.estado, { codigo });
    normalizar();
    await guardar('dados', 'mestre', M);
    avisar('Backup restaurado.');
    await abrirCenaNoTabuleiro(); enviarCena(); desenharPainelMestre();
  } catch (e) { avisar(e.message, true); }
}
function painelBackup() {
  const uso = el('p', { class: 'dica', texto: 'Calculando espaço…' });
  espaco().then(e => { uso.textContent = e ? `Usando ${tamanhoLegivel(e.usado)} de ${tamanhoLegivel(e.total)} que o navegador libera para este site.` : ''; });
  return [
    el('div', { class: 'bloco' }, titulo('Guardar tudo num arquivo'),
      el('p', { class: 'dica', texto: 'Tudo fica salvo neste navegador. Limpar os dados do navegador apaga as cenas, então baixe um backup no fim de cada sessão. O backup leva os mapas e imagens junto, por isso pode ficar grande.' }),
      el('button', { class: 'btn primario', texto: 'Baixar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', texto: 'Restaurar backup', onclick: restaurarBackup }), uso),
    el('div', { class: 'bloco' }, titulo('Código da sala'),
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
const J = { eu: null, codigo: null, cena: null, conexao: null, esperando: new Set(), vitrine: null };

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
    mapa: c.mapa && hashValido(c.mapa.hash) ? { hash: c.mapa.hash, w: inteiro(c.mapa.w, 1, 1e6, 1), h: inteiro(c.mapa.h, 1, 1e6, 1) } : null,
    tokens: Array.isArray(c.tokens) ? c.tokens.map(limparToken).filter(Boolean) : [],
    imagens: Array.isArray(c.imagens) ? c.imagens.map(limparImagem).filter(Boolean).slice(0, 500) : [],
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
function limparImagem(i) {
  if (!i || typeof i !== 'object' || !hashValido(i.hash)) return null;
  return { id: String(i.id).slice(0, 64), hash: i.hash, w: inteiro(i.w, 1, 1e6, 1), h: inteiro(i.h, 1, 1e6, 1),
    x: numero(i.x, -1e7, 1e7), y: numero(i.y, -1e7, 1e7), largura: numero(i.largura, 1, 1e7, 100),
    rot: [0, 90, 180, 270].includes(i.rot) ? i.rot : 0, camada: i.camada === 'fundo' ? 'fundo' : 'objeto' };
}

const receber = criarReceptor(async (hash, blob, info) => {
  J.esperando.delete(hash);
  try {
    const conferido = await guardarArquivo(blob, info.w, info.h);
    if (conferido !== hash) { avisar('Um arquivo chegou com defeito. Pedindo de novo…', true); pedirMapa(hash); return; }
  } catch (e) { avisar('Não consegui guardar o arquivo: ' + e.message, true); return; }
  if (J.cena?.mapa?.hash === hash) await mostrarMapa(J.cena, hash);
  else if (!J.esperando.size) avisoMapa(null);
  if (J.cena?.imagens.some(i => i.hash === hash)) abrirImagem(hash);
  if (J.vitrine?.hash === hash) { abrirVitrine(hash, J.vitrine.nome); J.vitrine = null; }
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
  tab.definirCena(J.cena || { tokens: [], imagens: [], grade: { tam: 70, ox: 0, oy: 0 } });
  for (const h of imagensDaCena(J.cena)) abrirImagem(h).then(tem => { if (!tem) pedirMapa(h); });
  if (J.cena?.mapa) {
    const pronto = await mostrarMapa(J.cena, J.cena.mapa.hash);
    if (!pronto) { avisoMapa('Esperando o mapa do mestre…', 0); pedirMapa(J.cena.mapa.hash); }
  } else await mostrarMapa(J.cena, null);
  if (anterior !== J.cena?.id) {
    const meu = J.cena?.tokens.find(t => t.dono === J.eu.id);
    tab.enquadrar();
    if (meu) tab.centralizarEm(meu);
  }
  desenharPainelJogador();
}

function tratarMensagemDoMestre(msg) {
  if (receber(msg)) return;
  if (msg.t === 'mostrar' && hashValido(msg.hash)) {
    const nome = String(msg.nome || '').slice(0, 40);
    abrirVitrine(msg.hash, nome).then(ok => { if (!ok) { J.vitrine = { hash: msg.hash, nome }; pedirMapa(msg.hash); avisar('O mestre está mostrando uma imagem… recebendo.'); } });
    return;
  }
  if (msg.t === 'mostrar-fim') { J.vitrine = null; fecharVitrine(false); return; }
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
      for (const m of msg.mapas.slice(0, 500)) {
        if (!hashValido(m?.hash)) continue;
        if (!(await ler('arquivos', m.hash))) { faltam++; pedirMapa(m.hash); }
      }
      avisar(faltam ? `O mestre está enviando ${faltam} ${faltam === 1 ? 'arquivo' : 'arquivos'} da sessão.` : 'Você já tem todos os mapas da sessão.');
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
    imagemDe: hash => imagensAbertas.get(hash)?.m || null,
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
  tab.definirCena({ tokens: [], imagens: [], grade: { tam: 70, ox: 0, oy: 0 }, colunas: 30, linhas: 20 });
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
      // reconectou: pede de novo os arquivos que estavam a caminho
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
    el('div', { class: 'bloco' }, titulo(J.cena ? J.cena.nome : 'Esperando o mestre'),
      el('p', { class: 'dica', texto: `Você é ${J.eu.nome}.` })),
    el('div', { class: 'bloco' }, titulo('Seus tokens'),
      meus.length ? el('div', { class: 'lista' }, meus.map(t => el('button', { class: 'item', onclick: () => { tab.centralizarEm(t); $('#painel').classList.remove('aberto'); } },
        el('span', { class: 'bola', style: `background:${t.cor}` }), el('span', { class: 'nome', texto: t.nome }),
        t.pvMax ? el('span', { class: 'etiqueta cinza', texto: `${t.pv}/${t.pvMax} PV` }) : null)))
        : el('p', { class: 'vazio', texto: 'O mestre ainda não te deu um token. Peça para ele escolher você em "Quem move".' })),
    el('div', { class: 'bloco' }, titulo('Como usar'),
      el('p', { class: 'dica', texto: celular
        ? 'Arraste com um dedo para mover a tela ou o seu token. Dois dedos dão zoom. Segure o dedo parado para fazer um ping.'
        : 'Arraste seu token para andar. Arraste o fundo para mover a tela e use a rodinha para o zoom. Shift + clique faz um ping. R = régua.' })),
    el('div', { class: 'bloco' }, titulo('Mapas guardados'),
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
window.arcanaTabuleiro = { get tab() { return tab; }, M, J, imagensAbertas };

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
