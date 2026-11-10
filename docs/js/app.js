// app.js — o "maestro": telas, painéis do mestre, tela do jogador e as mensagens entre eles.
import { guardar, ler, apagar, chaves, pedirPersistencia, espaco, tamanhoLegivel, hashDe } from './armazem.js?v=0.9';
import { importarMapa, carregarMapa, liberarMapa, retratoPequeno, guardarArquivo } from './mapas.js?v=0.9';
import { criarTabuleiro, estadoDe, celulasDe, custoMovimento, textoMetros } from './tabuleiro.js?v=0.9';
import { limparFicha, tokenDoMonstro, limparFichaDoToken, limparRecursos } from './fichas.js?v=0.9';
import { LUZES } from './visao.js?v=0.9';
import { criarJanelaRolagens, criarJanelaDado, linhasDoPedido, rolarLivre, rolarTeste, animacaoDoPedido } from './rolagens.js?v=0.9';
import { animateDice, diceAnimationsEnabled, setDiceAnimations } from './dice3d.js?v=0.9';
import { barraDeAbas, abaPersonagem, abaAtributos, abaCombate, abaHabilidades } from './fichaUI.js?v=0.9';
import { comSinal } from './dados.js?v=0.9';
import { abrirSala, entrarNaSala, novoCodigo, codigoValido, enviarArquivo, criarReceptor, lerPonte, salvarPonte, testarPonte } from './conexao.js?v=0.9';

import { $, uid, celular, el, avisar, definirStatus, avisoMapa, escolherArquivo, numero, inteiro, corValida, imagemValida, hashValido, TIPOS_IMAGEM, CORES, escolhaDeCor, limitador, titulo } from './util.js?v=0.9';

const VERSAO = '0.9';

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

let janela = null;     // janela "Rolagens" (histórico)
let janelaDado = null; // janela do dado: ataque primeiro, dano depois

// Dados 3D (os mesmos da Ficha Arcana), no canto de cima do tabuleiro, para todos.
const minhasRolagens = new Set(); // ids das rolagens feitas neste aparelho (a animação delas fica na janela do dado)
function animar(e) {
  const a = e?.dados3d;
  if (!a?.dice?.length || !diceAnimationsEnabled() || minhasRolagens.has(e.id)) return;
  animateDice(a.dice, { label: e.titulo, total: a.total, subtitle: a.subtitle, natural: a.natural, kind: a.kind,
    criticalThreshold: a.criticalThreshold, alvo: $('#dados3d'), quem: e.quem }).catch(() => {});
}
function atualizarBotao3d() {
  const ligado = diceAnimationsEnabled(), b = $('#btn-3d');
  b.classList.toggle('ativo', ligado); b.setAttribute('aria-pressed', String(ligado));
  b.title = ligado ? 'Dados 3D ligados (clique para desligar)' : 'Dados 3D desligados (clique para ligar)';
}

function prepararTabuleiro(eventos, opcoesRolagens) {
  $('#inicio').hidden = true;
  $('#mesa').hidden = false;
  tab = criarTabuleiro($('#tela'), eventos);
  janela = criarJanelaRolagens($('#rolagens'), opcoesRolagens);
  janelaDado = criarJanelaDado($('#dado'), {
    // a janela do dado avisa quando rolou: anima ali dentro e não repete no canto
    aoRolar: (p, palco) => {
      minhasRolagens.add(p.id);
      let a = null; try { a = animacaoDoPedido(p); } catch {}
      if (!a?.dice?.length || !diceAnimationsEnabled()) return false;
      animateDice(a.dice, { label: p.titulo, total: a.total, subtitle: a.subtitle, natural: a.natural, kind: a.kind, criticalThreshold: a.criticalThreshold, alvo: palco }).catch(() => {});
      return true;
    },
  });
  $('#btn-3d').addEventListener('click', () => {
    setDiceAnimations(!diceAnimationsEnabled()); atualizarBotao3d();
    avisar(diceAnimationsEnabled() ? 'Dados 3D ligados.' : 'Dados 3D desligados: os resultados aparecem na hora.');
  });
  atualizarBotao3d();
  $('#btn-dados').addEventListener('click', () => { $('#rolagens').classList.toggle('mostrar-celular'); janela.abrir(); });
  const dicas = {
    regua: 'Régua: arraste para medir. Cada quadrado = 1,5 m.',
    ping: 'Ping: clique no mapa para mostrar um ponto a todos.',
    laser: 'Bolinha com rastro: segure o botão e mexa o mouse. Todos veem o caminho.',
    grade: 'Ajustar grade: arraste por cima de UM quadrado desenhado no mapa, de canto a canto.',
    nevoa: 'Névoa: arraste para revelar ou esconder. As opções ficam na barra de cima.',
    paredes: 'Paredes: clique ponto a ponto (a grade puxa para os cantos). Duplo clique termina. Na ferramenta Mover: clique abre/fecha a porta, duplo clique tranca.',
    terreno: 'Terreno difícil: clique ou arraste para pintar. Comece num quadrado já pintado para apagar. Custa o dobro para andar.',
  };
  const escolher = f => {
    tab.ferramenta = f;
    document.querySelectorAll('[data-ferramenta]').forEach(b => b.classList.toggle('ativo', b.dataset.ferramenta === f));
    $('#tela').style.cursor = f === 'mover' ? 'grab' : 'crosshair';
    const d = $('#dica-ferramenta'); d.hidden = !dicas[f]; d.textContent = dicas[f] || '';
    eventos.aoFerramenta?.(f);
  };
  document.querySelectorAll('[data-ferramenta]').forEach(b => b.addEventListener('click', () => escolher(b.dataset.ferramenta)));
  $('#btn-enquadrar').addEventListener('click', () => tab.enquadrar());
  $('#vitrine-fechar').addEventListener('click', () => fecharVitrine(true));
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden) { fecharModal(); return; }
    if (e.target.closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' && !$('#vitrine').hidden) { fecharVitrine(true); return; }
    if (k === 'v') escolher('mover'); else if (k === 'r') escolher('regua'); else if (k === 'p') escolher('ping'); else if (k === 'l') escolher('laser');
    else if (k === 'g' && papel === 'mestre') escolher('grade'); else if (k === 't' && papel === 'mestre') escolher('terreno'); else if (k === 'n' && papel === 'mestre') escolher('nevoa'); else if (k === 'w' && papel === 'mestre') escolher('paredes'); else if (k === 'f') tab.enquadrar();
    else if (k === 'escape') { if (tab.ferramenta === 'paredes' && tab.cadeia) tab.terminarParede(); else escolher('mover'); }
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
// combate: { cenaId, ordem: [{ id, ini }], vezId, rodada, andou: { tokenId: metros } }
// fichas: a última ficha que cada jogador carregou (para criar o token dele em outras cenas)
// ---------- visão dinâmica (fase 3b) ----------
// Monta o que o tabuleiro precisa para calcular a visão: quem enxerga (observadores), as luzes e as paredes.
const metrosParaPx = (cena, m) => m / 1.5 * cena.grade.tam;
function centroDoToken(cena, t) { const q = cena.grade, n = celulasDe(t.tam); return { x: q.ox + (t.x + n / 2) * q.tam, y: q.oy + (t.y + n / 2) * q.tam }; }
function luzesDaCena(cena) {
  const px = m => metrosParaPx(cena, m);
  return [
    ...(cena.luzes || []).map(l => { const p = LUZES[l.tipo] || LUZES.tocha; return { x: l.x, y: l.y, plena: px(p.plena), penumbra: px(p.penumbra), fixa: true }; }),
    ...cena.tokens.filter(t => t.luz && LUZES[t.luz]).map(t => ({ ...centroDoToken(cena, t), plena: px(LUZES[t.luz].plena), penumbra: px(LUZES[t.luz].penumbra) })),
  ];
}
function configDaVisao(cena, observadores) {
  if (!cena?.visao?.ativa) return null;
  return {
    ambiente: cena.visao.ambiente || 'escuro',
    observadores: observadores.map(t => ({ ...centroDoToken(cena, t), escuro: metrosParaPx(cena, t.visao || 0) })),
    luzes: luzesDaCena(cena), paredes: cena.paredes || [], alcance: cena.grade.tam * 120,
  };
}

// galeria: tokens que o mestre subiu ({ id, nome, img, dono }); bloqueados: jogadores expulsos
const M = { codigo: null, cenas: [], aberta: null, ativa: null, conhecidos: {}, combate: null, fichas: {}, galeria: [], bloqueados: {} };
let sala = null, abaMestre = 'cenas', salvarTimer = null, escolherFerramenta = null, rascunhoNovo = null;
const envios = new Map(); // jogadorId -> { fila: Promise, texto }

function novaCena(nome) {
  return {
    id: uid(), nome, mapa: null, colunas: 30, linhas: 20, fundo: '#2a2f2b',
    grade: { tam: 70, ox: 0, oy: 0, cor: '#000000', opacidade: 0.35, mostrar: true, diagonal: 'simples' },
    tokens: [], imagens: [],
  };
}
function normalizar() { for (const c of M.cenas) { c.tokens ||= []; c.imagens ||= []; c.dificil ||= []; c.nevoa ||= { ativa: false, reveladas: [] }; c.paredes ||= []; c.luzes ||= []; c.visao ||= { ativa: false, ambiente: 'escuro' }; } M.fichas ||= {}; M.galeria ||= []; M.bloqueados ||= {}; if (M.combate && !M.cenas.some(c => c.id === M.combate.cenaId)) M.combate = null; }
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
  const c = { id: t.id, nome: t.nome, tipo: t.tipo, cor: t.cor, tam: t.tam, x: t.x, y: t.y, dono: t.dono, img: t.img, luz: t.luz || '' };
  if (t.tipo === 'pc') {
    // personagens: números e ações vão para todos (a CA dos monstros continua secreta)
    Object.assign(c, { pv: t.pv, pvMax: t.pvMax, pvTemp: t.pvTemp || 0, recursos: t.recursos || [], ca: t.ca, desloc: t.desloc, outros: t.outros, visao: t.visao, ini: t.ini, ficha: t.ficha || null });
  } else c.estado = estadoDe(t.pv, t.pvMax);
  return c;
}
// está conectado agora?
const online = id => !!id && [...(sala?.jogadores.values() || [])].some(j => j.id === id);
// os jogadores só veem tokens visíveis e, se o token tem dono, só enquanto o dono está conectado
// monstro/PdM dentro da névoa: nem é enviado aos jogadores (personagens continuam visíveis)
function escondidoNaNevoa(cena, t) {
  if (!cena?.nevoa?.ativa || t.tipo === 'pc') return false;
  const rev = cena.nevoa._set && cena.nevoa._lista === cena.nevoa.reveladas ? cena.nevoa._set : null;
  const set = rev || new Set(cena.nevoa.reveladas);
  if (!rev) { Object.defineProperty(cena.nevoa, '_set', { value: set, writable: true, configurable: true, enumerable: false }); Object.defineProperty(cena.nevoa, '_lista', { value: cena.nevoa.reveladas, writable: true, configurable: true, enumerable: false }); }
  const n = celulasDe(t.tam);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (set.has(`${t.x + i},${t.y + j}`)) return false;
  return true;
}
const visivelParaJogadores = (t, cena) => !t.oculto && (!t.dono || online(t.dono)) && !escondidoNaNevoa(cena, t);
function cenaParaJogador(cena, j) {
  return {
    id: cena.id, nome: cena.nome, colunas: cena.colunas, linhas: cena.linhas, fundo: cena.fundo, grade: cena.grade,
    mapa: cena.mapa ? { hash: j.celular ? cena.mapa.leve : cena.mapa.hash, w: cena.mapa.w, h: cena.mapa.h } : null,
    tokens: cena.tokens.filter(t => visivelParaJogadores(t, cena)).map(tokenParaJogador),
    dificil: cena.dificil || [],
    nevoa: cena.nevoa?.ativa ? { ativa: true, reveladas: cena.nevoa.reveladas } : { ativa: false, reveladas: [] },
    // visão dinâmica: as paredes vão junto (o aparelho do jogador calcula o que ele vê)
    visao: cena.visao?.ativa ? { ativa: true, ambiente: cena.visao.ambiente } : { ativa: false },
    paredes: cena.visao?.ativa ? cena.paredes.map(w => ({ id: w.id, a: w.a, b: w.b, tipo: w.tipo, aberta: !!w.aberta, trancada: !!w.trancada })) : [],
    luzes: cena.visao?.ativa ? cena.luzes : [],
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
  if (removido || !visivelParaJogadores(t, cena)) sala.paraTodos({ t: 'tok-fora', id: t.id });
  else sala.paraTodos({ t: 'tok', tok: tokenParaJogador(t) });
}
// mudanças de imagem: manda a cena (só se for a que os jogadores estão vendo)
function enviarImagens(cena) { if (cena.id === M.ativa) enviarCena(); }

// ---------- combate: iniciativa, turnos e movimento ----------
const cenaDoCombate = () => M.cenas.find(c => c.id === M.combate?.cenaId) || null;
function ordenarCombate() {
  const cb = M.combate; if (!cb) return;
  const c = cenaDoCombate();
  const iniDe = id => c?.tokens.find(t => t.id === id)?.ini ?? 0;
  // maior iniciativa primeiro; empate: maior bônus; quem não rolou vai para o fim
  cb.ordem.sort((a, b) => (b.ini ?? -99) - (a.ini ?? -99) || iniDe(b.id) - iniDe(a.id));
}
// O que cada jogador sabe do combate (sem tokens escondidos; movimento só dos personagens).
// A iniciativa: cada um vê só o próprio número; dos outros, só se já rolou.
function combateParaJogadores(j) {
  const cb = M.combate, c = cenaDoCombate();
  if (!cb || !c || c.id !== M.ativa) return null;
  const visiveis = new Map(c.tokens.filter(t => visivelParaJogadores(t, c)).map(t => [t.id, t]));
  return {
    rodada: cb.rodada, vezId: visiveis.has(cb.vezId) ? cb.vezId : null,
    ordem: cb.ordem.filter(o => visiveis.has(o.id)).map(o => {
      const meu = j && visiveis.get(o.id).dono === j.id;
      return { id: o.id, nome: visiveis.get(o.id).nome, ini: meu ? o.ini : null, rolou: o.ini != null };
    }),
    andou: Object.fromEntries(Object.entries(cb.andou || {}).filter(([id]) => visiveis.get(id)?.tipo === 'pc')),
  };
}
function enviarCombate() {
  tab?.redesenhar();
  if (tab) tab.pulsando = !!M.combate && cenaAberta().id === M.combate.cenaId;
  for (const j of sala?.jogadores.values() || []) sala.enviar(j, { t: 'combate', combate: combateParaJogadores(j) });
  atualizarSeAba('combate');
}
function comecarCombate() {
  const c = cenaAberta();
  M.combate = { cenaId: c.id, ordem: c.tokens.map(t => ({ id: t.id, ini: null })), vezId: null, rodada: 1, andou: {} };
  salvar(); enviarCombate();
  if (c.id !== M.ativa) avisar('Atenção: os jogadores estão em outra cena e não veem este combate.', true);
  postar({ quem: 'Mestre', cor: '#d3bb7c', titulo: 'Combate começou! Rolem iniciativa.' });
}
function proximoTurno() {
  const cb = M.combate; if (!cb?.ordem.length) return;
  ordenarCombate();
  const i = cb.ordem.findIndex(o => o.id === cb.vezId);
  let prox = i + 1;
  if (i < 0) prox = 0; else if (prox >= cb.ordem.length) { prox = 0; cb.rodada++; }
  cb.vezId = cb.ordem[prox].id;
  cb.andou[cb.vezId] = 0; // o movimento zera no começo do turno
  salvar(); enviarCombate();
  const t = cenaDoCombate()?.tokens.find(x => x.id === cb.vezId);
  if (t) {
    if (cenaAberta().id === cb.cenaId) tab.centralizarEm(t);
    if (!t.oculto) postar({ quem: 'Mestre', cor: '#d3bb7c', titulo: `Rodada ${cb.rodada} · vez de ${t.nome}` });
  }
}
function encerrarCombate() { M.combate = null; salvar(); enviarCombate(); postar({ quem: 'Mestre', cor: '#d3bb7c', titulo: 'Combate encerrado.' }); }
function definirIniciativa(tokenId, valor) {
  const o = M.combate?.ordem.find(x => x.id === tokenId);
  if (!o) return;
  o.ini = valor == null || valor === '' ? null : inteiro(valor, -20, 60);
  ordenarCombate(); salvar(); enviarCombate();
}
// Conta o movimento do token durante o combate. Devolve o aviso, se passou do deslocamento.
function registrarMovimento(cena, t, x0, y0) {
  const cb = M.combate;
  if (!cb || cb.cenaId !== cena.id || !cb.ordem.some(o => o.id === t.id)) return;
  const custo = custoMovimento(cena, t.tam, x0, y0, t.x, t.y);
  cb.andou[t.id] = (cb.andou[t.id] || 0) + custo;
  salvar(); enviarCombate();
  if (t.desloc > 0 && cb.andou[t.id] > t.desloc + 0.01) {
    const msg = `${t.nome} andou ${textoMetros(cb.andou[t.id])}, mais que o deslocamento (${textoMetros(t.desloc)}).`;
    avisar(msg, true);
    if (!t.oculto && t.tipo === 'pc') postar({ quem: t.nome, cor: t.cor, titulo: 'Passou do deslocamento', linhas: [{ rotulo: 'Andou', total: textoMetros(cb.andou[t.id]), detalhe: `deslocamento ${textoMetros(t.desloc)} (Disparada dobra)` }] });
  }
}
// rótulo em cima do token: "6 / 9 m" no combate; vermelho se passou
function extraDoToken(t, combate, souMestre) {
  if (!combate) return null;
  const vez = combate.vezId === t.id, andou = combate.andou?.[t.id];
  if (andou == null || !(souMestre || t.tipo === 'pc')) return vez ? { vez } : null;
  const desloc = t.desloc || 0;
  return { vez, texto: desloc ? `${textoMetros(andou)} / ${textoMetros(desloc)}` : textoMetros(andou), alerta: desloc > 0 && andou > desloc + 0.01 };
}

// ---------- rolagens no mestre ----------
let historico = []; // últimas entradas (para quem entra depois)
function postar(e, { secreta = false } = {}) {
  const entrada = { id: e.id || uid(), linhas: [], ...e, secreta };
  janela?.adicionar(entrada);
  animar(entrada);
  if (secreta) return entrada;
  historico.push(entrada); if (historico.length > 30) historico.shift();
  sala?.paraTodos({ t: 'rolagem', e: paraJogadores(entrada) });
  return entrada;
}
const paraJogadores = e => ({ ...e, alvoId: undefined, aplicado: undefined, desfazer: undefined });
// Recebe um pedido de rolagem (do jogador ou do próprio mestre) e monta a entrada.
// O ataque vem primeiro (acertou/errou); o dano vem depois, num pedido separado que aponta para o ataque.
const ataquesRecentes = new Map(); // id do ataque -> { acertou, critico, alvoId, secreta }
function resolverPedido(p, autor, atacante, alvo, secreta = false) {
  const e = { id: p.id, quem: atacante?.nome || autor.nome, cor: atacante?.cor || autor.cor, titulo: p.titulo, linhas: linhasDoPedido(p) };
  try { e.dados3d = animacaoDoPedido(p); } catch { e.dados3d = null; }
  const ataque = p.tipo === 'dano' && p.ataqueId ? ataquesRecentes.get(p.ataqueId) : null;
  if (ataque) { alvo = tokenPorId(ataque.alvoId)?.t || null; secreta = secreta || ataque.secreta; }
  if (alvo && (p.tipo === 'ataque' || p.tipo === 'dano' || p.cd != null)) { e.alvoId = alvo.id; e.alvoNome = alvo.oculto && !secreta ? 'alvo escondido' : alvo.nome; }
  if (p.tipo === 'ataque') {
    if (p.critico) e.resultado = { texto: 'Acerto crítico!', classe: 'critico' };
    else if (p.falha) e.resultado = { texto: 'Errou (1 natural)', classe: 'erro' };
    else if (alvo && Number.isFinite(alvo.ca)) e.resultado = p.d20.total >= alvo.ca ? { texto: 'Acertou!', classe: 'acerto' } : { texto: 'Errou', classe: 'erro' };
    else if (alvo) e.resultado = { texto: 'O mestre decide se acertou', classe: '' };
    ataquesRecentes.set(p.id, { acertou: ['acerto', 'critico'].includes(e.resultado?.classe), errou: e.resultado?.classe === 'erro', critico: !!p.critico, alvoId: alvo?.id || null, secreta });
    if (ataquesRecentes.size > 100) ataquesRecentes.delete(ataquesRecentes.keys().next().value);
  }
  let aplicarSozinho = false;
  if (p.tipo === 'dano' && p.danoTotal > 0) {
    e.dano = p.danoTotal;
    if (ataque?.acertou && alvo) { aplicarSozinho = true; e.resultado = { texto: `Dano aplicado em ${e.alvoNome}`, classe: 'acerto' }; }
    else if (ataque?.errou) e.resultado = { texto: 'O ataque errou: dano não aplicado', classe: 'erro' };
    else if (alvo) e.resultado = { texto: 'O mestre aplica (inteiro ou metade)', classe: '' };
  }
  // iniciativa: só entra na ordem do combate (sem registro nas rolagens e sem animação para os outros)
  if (p.tipo === 'iniciativa') {
    if (atacante && M.combate?.ordem.some(o => o.id === atacante.id)) definirIniciativa(atacante.id, p.d20.total);
    return { ...e, secreta: true };
  }
  const entrada = postar(e, { secreta });
  if (aplicarSozinho) aplicarDano(entrada, 1);
  // iniciativa entra sozinha no combate
  if (p.tipo === 'iniciativa' && atacante && M.combate?.ordem.some(o => o.id === atacante.id)) definirIniciativa(atacante.id, p.d20.total);
  return entrada;
}
function tokenPorId(id) { for (const c of M.cenas) { const t = c.tokens.find(x => x.id === id); if (t) return { c, t }; } return null; }
function aplicarDano(entrada, fator) {
  const achado = tokenPorId(entrada.alvoId); if (!achado) return;
  const { c, t } = achado, dano = Math.floor(entrada.dano * fator);
  // PV temporários absorvem primeiro
  const absorvido = Math.min(t.pvTemp || 0, dano);
  t.pvTemp = (t.pvTemp || 0) - absorvido;
  const tirado = Math.min(t.pv || 0, dano - absorvido);
  t.pv = (t.pv || 0) - tirado;
  entrada.aplicado = dano; entrada.desfazer = { absorvido, tirado };
  salvar(); tab.redesenhar(); enviarToken(c, t); atualizarSeAba('tokens', 'combate');
  janela.adicionar(entrada);
}
function desfazerDano(entrada) {
  const achado = tokenPorId(entrada.alvoId); if (!achado || !entrada.aplicado) return;
  const { c, t } = achado, d = entrada.desfazer || { absorvido: 0, tirado: entrada.aplicado };
  t.pv = (t.pv || 0) + d.tirado; t.pvTemp = (t.pvTemp || 0) + d.absorvido;
  entrada.aplicado = 0; entrada.desfazer = null;
  salvar(); tab.redesenhar(); enviarToken(c, t); atualizarSeAba('tokens', 'combate');
  janela.adicionar(entrada);
}
// grupos de dados { lados, valores } que chegam pela rede
const LADOS = [4, 6, 8, 10, 12, 20, 100];
function limparGrupos(lista) {
  return (Array.isArray(lista) ? lista : []).slice(0, 10).filter(g => LADOS.includes(g?.lados))
    .map(g => ({ lados: g.lados, valores: (Array.isArray(g.valores) ? g.valores : []).slice(0, 40).map(v => inteiro(v, 1, g.lados, 1)) }));
}
// Confere um pedido vindo da rede (o jogador rolou no aparelho dele)
function pedidoValido(p) {
  if (!p || typeof p !== 'object' || !['ataque', 'acao', 'dano', 'teste', 'iniciativa', 'livre'].includes(p.tipo)) return null;
  const n = (v, a, b) => numero(v, a, b, 0);
  const r = { id: /^[\w-]{8,64}$/.test(p.id || '') ? p.id : uid(), ataqueId: /^[\w-]{8,64}$/.test(p.ataqueId || '') ? p.ataqueId : null,
    tipo: p.tipo, titulo: String(p.titulo || '').slice(0, 60), danos: [], cd: p.cd != null ? n(p.cd, 1, 40) : null, salva: p.salva ? String(p.salva).slice(0, 20) : null,
    critico: !!p.critico, falha: !!p.falha };
  if (p.d20) {
    const valores = (Array.isArray(p.d20.valores) ? p.d20.valores : []).slice(0, 2).map(v => inteiro(v, 1, 20, 1));
    const escolhido = inteiro(p.d20.escolhido, 1, 20, 1), bonus = inteiro(p.d20.bonus, -20, 40);
    r.d20 = { valores, escolhido, bonus, total: escolhido + bonus, modo: ['vantagem', 'desvantagem'].includes(p.d20.modo) ? p.d20.modo : 'normal' };
  }
  for (const d of (Array.isArray(p.danos) ? p.danos : []).slice(0, 10)) r.danos.push({ expr: String(d.expr || '').slice(0, 60), total: inteiro(d.total, 0, 9999), detalhe: String(d.detalhe || '').slice(0, 200), tipo: String(d.tipo || '').slice(0, 30), dados: limparGrupos(d.dados) });
  r.margem = inteiro(p.margem, 2, 20, 20);
  r.danoTotal = r.danos.reduce((s, x) => s + x.total, 0);
  if (p.livre) r.livre = { expr: String(p.livre.expr || '').slice(0, 60), total: inteiro(p.livre.total, -9999, 99999), detalhe: String(p.livre.detalhe || '').slice(0, 300), dados: limparGrupos(p.livre.dados) };
  return r;
}

// Dados de token a partir da ficha carregada pelo jogador
function aplicarFichaNoToken(t, f) {
  Object.assign(t, { nome: f.nome, pv: f.pv, pvMax: f.pvMax, pvTemp: f.pvTemp || 0, ca: f.ca, ini: f.ini, desloc: f.desloc, outros: f.outros, visao: f.visao, tam: f.tam,
    recursos: f.recursos || [],
    ficha: { atributos: f.atributos, valores: f.valores, salvaguardas: f.salvaguardas, pericias: f.pericias, percepcao: f.percepcao,
      habilidades: f.habilidades, acoes: f.acoes, magia: f.magia, resumo: f.resumo } });
  if (f.retratoPequeno) t.img = f.retratoPequeno;
}

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
    aoMover: (t, x, y) => {
      const x0 = t.x, y0 = t.y; t.x = x; t.y = y; salvar(); tab.redesenhar();
      if (cenaAberta().id === M.ativa) {
        if (cenaAberta().nevoa?.ativa && t.tipo !== 'pc') enviarToken(cenaAberta(), t);
        else sala?.paraTodos({ t: 'mov', id: t.id, x, y });
      }
      registrarMovimento(cenaAberta(), t, x0, y0);
    },
    extraDoToken: t => {
      const extra = M.combate?.cenaId === cenaAberta().id ? extraDoToken(t, M.combate, true) : null;
      return t.dono && !online(t.dono) ? { ...(extra || {}), texto: 'offline', alerta: false } : extra;
    },
    apagado: t => !!t.dono && !online(t.dono),
    limiteMovimento: t => (M.combate?.cenaId === cenaAberta().id && M.combate.ordem.some(o => o.id === t.id) && t.desloc ? { andou: M.combate.andou[t.id] || 0, desloc: t.desloc } : null),
    aoPintarTerreno: (chave, pintar) => {
      const c = cenaAberta(), s = new Set(c.dificil || []);
      if (pintar) s.add(chave); else s.delete(chave);
      c.dificil = [...s];
    },
    aoTerminarTerreno: () => { salvar(); enviarCena(); },
    aoPintarNevoa: (celulas, revelar) => {
      const n = cenaAberta().nevoa, set = new Set(n.reveladas);
      for (const k of celulas) { if (revelar) set.add(k); else set.delete(k); }
      n.reveladas = [...set]; tab.redesenhar();
    },
    aoTerminarNevoa: () => { salvar(); enviarCena(); },
    aoFerramenta: f => {
      $('#opcoes-nevoa').hidden = f !== 'nevoa'; if (f === 'nevoa') desenharOpcoesNevoa();
      $('#opcoes-paredes').hidden = f !== 'paredes'; if (f === 'paredes') desenharOpcoesParedes(); else tab.terminarParede?.();
    },
    // o mestre vê tudo; com "Ver como", vê o que aquele token enxerga
    configVisao: () => { const c = cenaAberta(), t = verComo && c.tokens.find(x => x.id === verComo); return t ? configDaVisao(c, [t]) : null; },
    ehMeu: t => t.id === verComo,
    luzesParaDesenhar: () => (cenaAberta().visao?.ativa ? luzesDaCena(cenaAberta()) : (cenaAberta().luzes || []).length ? luzesDaCena(cenaAberta()) : []),
    aoNovaParede: (a, b, tipo) => { const c = cenaAberta(); c.paredes.push({ id: uid(), a, b, tipo, aberta: false, trancada: false }); salvar(); tab.redesenhar(); enviarParedes(c); },
    aoNovaLuz: (x, y) => { const c = cenaAberta(); c.luzes.push({ id: uid(), x, y, tipo: luzEscolhida }); salvar(); tab.redesenhar(); enviarParedes(c); },
    aoApagar: (tipo, id) => {
      const c = cenaAberta();
      if (tipo === 'luz') c.luzes = c.luzes.filter(l => l.id !== id); else c.paredes = c.paredes.filter(w => w.id !== id);
      salvar(); tab.redesenhar(); enviarParedes(c);
    },
    aoPorta: w => { w.aberta = !w.aberta; salvar(); tab.redesenhar(); enviarParedes(cenaAberta()); },
    // duplo clique: tranca/destranca (os dois cliques simples abrem e fecham, então a porta volta como estava)
    aoTrancar: w => { w.trancada = !w.trancada; salvar(); tab.redesenhar(); enviarParedes(cenaAberta()); avisar(w.trancada ? 'Porta trancada: os jogadores não abrem.' : 'Porta destrancada.'); },
    aoSelecionar: t => { if (t) abaMestre = 'tokens'; desenharPainelMestre(); },
    aoEditar: t => { tab.selecionado = t.id; tab.imagemSelecionada = null; abaMestre = 'tokens'; desenharPainelMestre(); abrirPainelCelular(); },
    imagemDe: hash => imagensAbertas.get(hash)?.m || null,
    aoSelecionarImagem: () => { abaMestre = 'imagens'; desenharPainelMestre(); },
    aoMudarImagem: () => { salvar(); enviarImagens(cenaAberta()); atualizarSeAba('imagens'); },
    aoPing: (x, y) => { tab.mostrarPing(x, y, '#d3bb7c'); if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'ping', x, y, cor: '#d3bb7c' }); },
    aoRegua: r => { if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'regua', id: 'mestre', a: r?.a, b: r?.b, cor: '#d3bb7c', nome: 'Mestre' }); },
    aoLaser: (() => { const mandar = limitador(p => { if (cenaAberta().id === M.ativa) sala?.paraTodos({ t: 'laser', id: 'mestre', cor: '#d3bb7c', x: p?.x, y: p?.y, fim: !p }); }); return (x, y) => mandar(x == null ? null : { x, y }); })(),
    aoAjustarGrade: (tam, ox, oy) => {
      Object.assign(cenaAberta().grade, { tam: Math.round(tam * 10) / 10, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
      salvar(); tab.redesenhar(); enviarCena(); abaMestre = 'grade'; desenharPainelMestre(); escolherFerramenta('mover');
      avisar('Grade ajustada. Use os campos da aba Grade para o ajuste fino.');
    },
    aoTecla: e => {
      if (tab.ferramenta === 'nevoa' && (e.key === '[' || e.key === ']')) { mudarPincel(e.key === ']' ? 1 : -1); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const c = cenaAberta();
      const t = c.tokens.find(x => x.id === tab.selecionado);
      if (t) { if (confirm(`Excluir o token "${t.nome}"?`)) excluirToken(c, t); return; }
      const im = c.imagens.find(x => x.id === tab.imagemSelecionada);
      if (im && confirm(`Excluir a imagem "${im.nome}"?`)) excluirImagem(c, im);
    },
  }, {
    ehMestre: true,
    aoRolarLivre: (expr, secreta) => {
      try { resolverPedido(rolarLivre(expr), { nome: 'Mestre', cor: '#d3bb7c' }, null, null, secreta); }
      catch (e) { avisar(e.message, true); return false; }
    },
    aoAplicar: (e, fator) => aplicarDano(e, fator),
    aoDesfazer: e => desfazerDano(e),
  });
  tab.pulsando = !!M.combate && M.combate.cenaId === cenaAberta().id;
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
      if (M.bloqueados[j.id]) { sala.enviar(j, { t: 'expulso' }); setTimeout(() => { try { j.conn.close(); } catch {} }, 400); return; }
      M.conhecidos[j.id] = { nome: j.nome, cor: j.cor };
      salvar();
      const c = cenaAtiva();
      sala.enviar(j, { t: 'bemvindo', versao: VERSAO, cena: c ? cenaParaJogador(c, j) : null });
      sala.enviar(j, { t: 'combate', combate: combateParaJogadores(j) });
      for (const e of historico.slice(-15)) sala.enviar(j, { t: 'rolagem', e: paraJogadores(e), antiga: true }); // sem animação
      sala.enviar(j, { t: 'galeria', itens: galeriaPara(j) });
      avisar(`${j.nome} entrou na mesa.`);
      enviarCena(); enviarCombate(); tab.redesenhar(); // o token dele volta a aparecer para os outros
      atualizarStatusMestre(); atualizarSeAba('jogadores', 'cenas', 'tokens');
    },
    aoSair: j => {
      avisar(`${j.nome} saiu.`); envios.delete(j.id);
      enviarCena(); enviarCombate(); tab.redesenhar(); // o token dele some para os outros
      atualizarStatusMestre(); atualizarSeAba('jogadores', 'cenas');
    },
    aoMensagem: (j, msg) => tratarMensagemDoJogador(j, msg),
    aoFalha: () => avisar('Alguém tentou entrar, mas a internet bloqueou o caminho até você. Ligue a ponte em Ajustes › Conexão.', true),
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
    const x0 = t.x, y0 = t.y;
    t.x = inteiro(msg.x, -500, 5000); t.y = inteiro(msg.y, -500, 5000);
    salvar(); if (cenaAberta().id === c.id) tab.redesenhar();
    sala.paraTodos({ t: 'mov', id: t.id, x: t.x, y: t.y });
    registrarMovimento(c, t, x0, y0);
  } else if (msg.t === 'ficha' && c) {
    // o jogador carregou a ficha exportada: atualiza (ou cria) o token dele
    let f;
    try { f = limparFicha(msg.ficha); } catch (e) { sala.enviar(j, { t: 'erro', texto: e.message }); return; }
    f.retratoPequeno = imagemValida(msg.retrato);
    M.fichas[j.id] = { ...f, retrato: null };
    let t = c.tokens.find(x => x.dono === j.id && x.id === msg.tokenId) || c.tokens.find(x => x.dono === j.id);
    if (!t) {
      t = { id: uid(), tipo: 'pc', cor: j.cor, dono: j.id, oculto: false, img: null, x: inteiro(msg.x, -500, 5000), y: inteiro(msg.y, -500, 5000) };
      c.tokens.push(t);
    }
    aplicarFichaNoToken(t, f);
    salvar(); if (cenaAberta().id === c.id) tab.redesenhar();
    enviarToken(c, t); atualizarSeAba('tokens', 'combate');
    avisar(`${j.nome} carregou a ficha de ${f.nome}.`);
  } else if (msg.t === 'porta' && c) {
    const w = c.paredes.find(x => x.id === msg.id && x.tipo === 'porta');
    if (!w) return;
    if (w.trancada) { sala.enviar(j, { t: 'erro', texto: 'A porta está trancada.' }); return; }
    w.aberta = !w.aberta; salvar(); if (cenaAberta().id === c.id) tab.redesenhar(); enviarCena();
  } else if (msg.t === 'galeria-escolher') {
    escolhaDaGaleria(j, msg.id ? String(msg.id).slice(0, 64) : null);
  } else if (msg.t === 'meu-token' && c) {
    const t = c.tokens.find(x => x.id === msg.id && x.dono === j.id); if (!t) return;
    const v = inteiro(msg.valor, 0, 9999, 0);
    let linha = null;
    if (msg.acao === 'dano' && v) {
      const absorvido = Math.min(t.pvTemp || 0, v); t.pvTemp = (t.pvTemp || 0) - absorvido; t.pv = Math.max(0, (t.pv || 0) - (v - absorvido));
      linha = { rotulo: 'Dano', total: '−' + v, detalhe: `PV ${t.pv}/${t.pvMax}${absorvido ? ` · ${absorvido} absorvido pelos temporários` : ''}` };
    } else if (msg.acao === 'cura' && v) {
      t.pv = Math.min(t.pvMax || 9999, (t.pv || 0) + v); linha = { rotulo: 'Cura', total: '+' + v, detalhe: `PV ${t.pv}/${t.pvMax}` };
    } else if (msg.acao === 'temp' && v) {
      t.pvTemp = v; linha = { rotulo: 'PV temporários', total: v, detalhe: 'não se somam: vale o novo valor' };
    } else if (msg.acao === 'usar' || msg.acao === 'restaurar') {
      const r = (t.recursos || []).find(x => x.id === msg.recurso); if (!r) return;
      if (msg.acao === 'usar' && r.usados < r.max) r.usados++; else if (msg.acao === 'restaurar' && r.usados > 0) r.usados--; else return;
      linha = { rotulo: msg.acao === 'usar' ? 'Usou' : 'Restaurou', total: `${r.max - r.usados}/${r.max}`, detalhe: r.nome };
    } else if (msg.acao === 'luz') {
      t.luz = LUZES[msg.luz] ? msg.luz : '';
      linha = { rotulo: 'Luz', total: t.luz ? LUZES[t.luz].nome : 'apagada', detalhe: t.luz ? `${LUZES[t.luz].plena} m de luz plena + ${LUZES[t.luz].penumbra} m de penumbra` : '' };
    } else if (msg.acao === 'descanso') {
      const longo = msg.tipo === 'longo';
      for (const r of t.recursos || []) { if (longo || r.recarga === 'short') r.usados = 0; else if (r.recarga === 'one') r.usados = Math.max(0, r.usados - 1); }
      if (longo) { t.pv = t.pvMax || t.pv; t.pvTemp = 0; }
      linha = { rotulo: longo ? 'Descanso longo' : 'Descanso curto', total: '✓', detalhe: longo ? 'PV e usos recuperados' : 'usos de descanso curto recuperados' };
    } else return;
    salvar(); if (cenaAberta().id === c.id) tab.redesenhar();
    enviarToken(c, t); atualizarSeAba('tokens', 'combate');
    if (!t.oculto) postar({ quem: t.nome, cor: t.cor, titulo: linha.rotulo, linhas: [linha] });
  } else if (msg.t === 'rolar') {
    const p = pedidoValido(msg.p); if (!p) return;
    const ativa = cenaAtiva();
    const meu = ativa?.tokens.find(t => t.id === msg.tokenId && t.dono === j.id) || null;
    const alvo = ativa?.tokens.find(t => t.id === msg.alvoId && !t.oculto) || null;
    resolverPedido(p, { nome: j.nome, cor: j.cor }, meu, alvo);
  } else if (msg.t === 'ping') {
    const x = numero(msg.x, -1e6, 1e6), y = numero(msg.y, -1e6, 1e6);
    if (cenaAberta().id === M.ativa) tab.mostrarPing(x, y, j.cor);
    sala.paraTodos({ t: 'ping', x, y, cor: j.cor }, o => o !== j);
  } else if (msg.t === 'regua') {
    const cel = p => (p && { cx: inteiro(p.cx, -1e5, 1e5), cy: inteiro(p.cy, -1e5, 1e5) });
    const a = cel(msg.a), b = cel(msg.b);
    if (cenaAberta().id === M.ativa) tab.mostrarRegua(j.id, a, b, j.cor, j.nome);
    sala.paraTodos({ t: 'regua', id: j.id, a, b, cor: j.cor, nome: j.nome }, o => o !== j);
  } else if (msg.t === 'criar-token' && c) {
    // o jogador coloca o próprio token (no máximo 3 por jogador)
    if (c.tokens.filter(t => t.dono === j.id).length >= 3) return;
    const t = { id: uid(), nome: String(msg.nome || j.nome).trim().slice(0, 40) || j.nome, tipo: 'pc', cor: corValida(msg.cor) || j.cor,
      tam: 1, pv: 0, pvMax: 0, dono: j.id, oculto: false, img: null, x: inteiro(msg.x, -500, 5000), y: inteiro(msg.y, -500, 5000) };
    // se o jogador já carregou a ficha antes, o token novo já nasce com os números dela
    if (M.fichas[j.id] && !c.tokens.some(x => x.dono === j.id)) aplicarFichaNoToken(t, M.fichas[j.id]);
    const escolhido = M.galeria.find(g => g.dono === j.id); if (escolhido) t.img = escolhido.img;
    c.tokens.push(t);
    salvar(); if (cenaAberta().id === c.id) tab.redesenhar();
    enviarToken(c, t); atualizarSeAba('tokens');
    avisar(`${j.nome} colocou o token "${t.nome}".`);
  } else if (msg.t === 'laser') {
    const fim = !!msg.fim || msg.x == null;
    const x = fim ? null : numero(msg.x, -1e7, 1e7), y = fim ? null : numero(msg.y, -1e7, 1e7);
    if (cenaAberta().id === M.ativa) tab.mostrarLaser(j.id, x, y, j.cor);
    sala.paraTodos({ t: 'laser', id: j.id, cor: j.cor, x, y, fim }, o => o !== j);
  } else if (msg.t === 'preciso' && hashValido(msg.hash)) {
    mandarMapa(j, msg.hash);
  }
}

async function abrirCenaNoTabuleiro() {
  const c = cenaAberta();
  tab.selecionado = null; tab.imagemSelecionada = null;
  tab.definirCena(c);
  for (const h of imagensDaCena(c)) abrirImagem(h);
  tab.pulsando = !!M.combate && M.combate.cenaId === c.id;
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
  const abas = [['cenas', 'Cenas'], ['tokens', 'Tokens'], ['combate', 'Combate'], ['imagens', 'Imagens'], ['grade', 'Grade'], ['jogadores', 'Jogadores'], ['backup', 'Ajustes']];
  const corpo = { cenas: painelCenas, tokens: painelTokens, combate: painelCombate, imagens: painelImagens, grade: painelGrade, jogadores: painelJogadores, backup: painelBackup }[abaMestre]();
  const rolagem = $('#painel .conteudo')?.scrollTop || 0;
  $('#painel').replaceChildren(
    el('div', { class: 'abas', role: 'tablist' }, abas.map(([id, nome]) =>
      el('button', { role: 'tab', 'aria-selected': String(abaMestre === id), texto: nome, onclick: () => { abaMestre = id; desenharPainelMestre(); } }))),
    el('div', { class: 'conteudo' }, corpo),
  );
  $('#painel .conteudo').scrollTop = rolagem;
}
// título de bloco com um botão pequeno à direita

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
        : el('button', { class: 'btn primario', texto: 'Levar os jogadores para esta cena', onclick: () => levarJogadores(c) }),
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
      el('div', { class: 'linha-campos meio' },
        el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: !!c.nevoa?.ativa, onchange: e => ligarNevoa(c, e.target.checked) }), 'Névoa de guerra'),
        el('button', { class: 'btn pequeno', texto: 'Pintar névoa (N)', onclick: () => escolherFerramenta('nevoa') })),
      progresso),
    el('div', { class: 'bloco cresce' },
      titulo(`Suas cenas (${M.cenas.length})`, el('button', { class: 'btn pequeno', texto: '+ Nova cena', onclick: async () => {
        const nome = prompt('Nome da nova cena:', `Cena ${M.cenas.length + 1}`); if (!nome) return;
        const s = novaCena(nome.slice(0, 60)); M.cenas.push(s); M.aberta = s.id; salvar(); await abrirCenaNoTabuleiro(); desenharPainelMestre();
      } })),
      lista),
    el('button', { class: 'btn', texto: '+ Monstro do livro nesta cena', onclick: abrirListaMonstros }),
    el('button', { class: 'btn pequeno', texto: 'Pré-carregar todas as cenas nos jogadores', title: 'Manda os mapas e imagens agora, antes do jogo, para as cenas abrirem na hora.', disabled: !sala?.jogadores.size, onclick: preCarregar }),
  ];
}

// Leva os jogadores (e os tokens deles) para a cena: os tokens com dono saem das outras cenas
// e aparecem lado a lado no centro da tela do mestre.
function levarJogadores(c) {
  const centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
  let i = 0;
  for (const outra of M.cenas) {
    if (outra === c) continue;
    const deJogadores = outra.tokens.filter(t => t.dono && t.tipo === 'pc');
    if (!deJogadores.length) continue;
    outra.tokens = outra.tokens.filter(t => !deJogadores.includes(t));
    for (const t of deJogadores) {
      if (c.tokens.some(x => x.id === t.id)) continue;
      t.x = cel.cx - Math.floor(deJogadores.length / 2) + i++; t.y = cel.cy;
      c.tokens.push(t);
    }
  }
  M.ativa = c.id; salvar();
  tab.redesenhar(); enviarCena(); enviarCombate(); desenharPainelMestre();
  avisar(`Jogadores levados para ${c.nome}${i ? ` com ${i} token(s)` : ''}.`);
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
  const rascunho = t ? { ...t } : (rascunhoNovo ||= { nome: '', tipo: 'npc', cor: '#8c3b3b', tam: 1, pv: 10, pvMax: 10, ca: 12, desloc: 9, dono: '', oculto: false, img: null });
  const campo = (k, props) => el('input', { value: rascunho[k] ?? '', oninput: e => { rascunho[k] = e.target.value; if (t) aplicar(); }, ...props });
  const previa = el('img', { class: 'retrato-previa', alt: 'Retrato', hidden: !rascunho.img, src: rascunho.img || null });

  function lerFormulario() {
    return {
      nome: String(rascunho.nome || '').trim().slice(0, 40) || (rascunho.tipo === 'pc' ? 'Personagem' : 'Monstro'),
      tipo: rascunho.tipo === 'pc' ? 'pc' : 'npc',
      cor: corValida(rascunho.cor) || '#5b7c66',
      tam: numero(rascunho.tam, 0.5, 4, 1),
      pv: inteiro(rascunho.pv, -999, 9999, 0), pvMax: inteiro(rascunho.pvMax, 0, 9999, 0),
      ca: rascunho.ca === '' || rascunho.ca == null ? null : inteiro(rascunho.ca, 0, 40, 10), desloc: numero(rascunho.desloc, 0, 300, 9),
      dono: rascunho.dono || '', oculto: !!rascunho.oculto, img: imagemValida(rascunho.img), luz: LUZES[rascunho.luz] ? rascunho.luz : '',
      visao: numero(rascunho.visao, 0, 300, 0),
    };
  }
  function aplicar() { Object.assign(t, lerFormulario()); salvar(); tab.redesenhar(); enviarToken(c, t); }

  const donos = el('select', { onchange: e => { rascunho.dono = e.target.value; if (t) { aplicar(); desenharPainelMestre(); } } },
    el('option', { value: '', texto: 'Só o mestre' }),
    Object.entries(M.conhecidos).map(([id, j]) => el('option', { value: id, texto: j.nome, selected: rascunho.dono === id })));

  const ajustePV = el('input', { type: 'number', min: 0, placeholder: 'Valor', inputmode: 'numeric', 'aria-label': 'Valor de dano ou cura' });
  const mudarPV = sinal => { const v = inteiro(ajustePV.value, 0, 9999, 0); if (!v || !t) return; t.pv = Math.min(t.pvMax || 9999, t.pv + sinal * v); ajustePV.value = ''; salvar(); tab.redesenhar(); enviarToken(c, t); desenharPainelMestre(); };

  const form = el('div', { class: 'bloco' },
    titulo(t ? 'Editar: ' + t.nome : 'Novo token', el('div', { class: 'acoes' },
      el('button', { class: 'btn pequeno', texto: '+ Monstro do livro', onclick: abrirListaMonstros }),
      t ? el('button', { class: 'btn pequeno', texto: '+ Novo', onclick: () => { tab.selecionado = null; tab.redesenhar(); desenharPainelMestre(); } }) : null)),
    el('label', {}, 'Nome', campo('nome', { maxlength: 40 })),
    el('div', { class: 'linha-campos meio' }, el('span', { class: 'rotulo', texto: 'Cor' }),
      escolhaDeCor(rascunho.cor, cor => { rascunho.cor = cor; if (t) aplicar(); })),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'cresce' }, 'Tipo', el('select', { onchange: e => { rascunho.tipo = e.target.value; if (t) aplicar(); } },
        el('option', { value: 'pc', texto: 'Personagem', selected: rascunho.tipo === 'pc' }),
        el('option', { value: 'npc', texto: 'Monstro / PdM', selected: rascunho.tipo !== 'pc' }))),
      el('label', { class: 'cresce' }, 'Tamanho', el('select', { onchange: e => { rascunho.tam = Number(e.target.value); if (t) aplicar(); } },
        TAMANHOS.map(([v, n]) => el('option', { value: v, texto: n, selected: Number(rascunho.tam) === v }))))),
    el('div', { class: 'linha-campos' },
      el('label', { class: 'curto' }, 'PV', campo('pv', { type: 'number', inputmode: 'numeric' })),
      el('label', { class: 'curto' }, 'PV máx.', campo('pvMax', { type: 'number', min: 0, inputmode: 'numeric' })),
      el('label', { class: 'curto' }, 'CA', campo('ca', { type: 'number', min: 0, inputmode: 'numeric' })),
      el('label', { class: 'curto' }, 'Desloc. m', campo('desloc', { type: 'number', min: 0, step: 1.5, inputmode: 'decimal' }))),
    el('div', { class: 'linha-campos' }, el('label', { class: 'cresce' }, 'Quem move', donos),
      el('label', { class: 'cresce' }, 'Luz', el('select', { onchange: e => { rascunho.luz = e.target.value; if (t) aplicar(); } },
        el('option', { value: '', texto: 'Nenhuma' }), Object.entries(LUZES).map(([k, l]) => el('option', { value: k, texto: l.nome, selected: rascunho.luz === k })))),
      el('label', { class: 'curto' }, 'Escuro m', campo('visao', { type: 'number', min: 0, step: 1.5, inputmode: 'decimal', title: 'Visão no escuro em metros' }))),
    t ? el('div', { class: 'linha-campos' }, el('div', { class: 'curto' }, ajustePV),
      el('button', { class: 'btn pequeno perigo cresce', texto: '− Dano', onclick: () => mudarPV(-1) }),
      el('button', { class: 'btn pequeno cresce', texto: '+ Cura', onclick: () => mudarPV(1) })) : null,
    el('div', { class: 'linha-campos meio' }, previa,
      M.galeria.length ? el('button', { class: 'btn pequeno', texto: 'Da galeria', title: 'Usar um token que você subiu na galeria', onclick: () => escolherDaGaleria(img => { rascunho.img = img; previa.src = img; previa.hidden = false; if (t) aplicar(); desenharPainelMestre(); }) }) : null,
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
      botaoOlho(x, () => { salvar(); tab.redesenhar(); enviarToken(c, x); desenharPainelMestre(); }),
      el('button', { class: 'olho', texto: '🗑', title: 'Excluir token', 'aria-label': 'Excluir ' + x.nome, onclick: e => { e.stopPropagation(); if (confirm(`Excluir o token "${x.nome}"?`)) excluirToken(c, x); } }))))
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

// ---------- barra de opções das paredes, portas e luzes ----------
let verComo = '', luzEscolhida = 'tocha';
function enviarParedes(c) { if (c.id === M.ativa && c.visao?.ativa) enviarCena(); }
function desenharOpcoesParedes() {
  const c = cenaAberta(), o = tab.paredes;
  const seg = (lista, atual, mudar) => el('div', { class: 'segmentos' }, lista.map(([v, n]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(atual === v), texto: n, onclick: () => { mudar(v); desenharOpcoesParedes(); } })));
  $('#opcoes-paredes').replaceChildren(...[
    el('label', { class: 'marcar', title: 'Cada jogador vê só o que o personagem enxerga' }, el('input', { type: 'checkbox', checked: !!c.visao.ativa, onchange: e => { c.visao.ativa = e.target.checked; salvar(); tab.redesenhar(); enviarCena(); desenharOpcoesParedes(); } }), 'Visão dinâmica'),
    el('select', { 'aria-label': 'Luz do ambiente', title: 'Luz do ambiente', onchange: e => { c.visao.ambiente = e.target.value; salvar(); tab.redesenhar(); enviarParedes(c); } },
      [['dia', 'Dia (tudo iluminado)'], ['penumbra', 'Penumbra'], ['escuro', 'Escuridão']].map(([v, n]) => el('option', { value: v, texto: n, selected: c.visao.ambiente === v }))),
    seg([['parede', 'Parede'], ['porta', 'Porta'], ['luz', 'Luz'], ['apagar', 'Apagar']], o.modo, v => { o.modo = v; tab.terminarParede?.(); }),
    o.modo === 'luz' ? el('select', { 'aria-label': 'Tipo de luz', onchange: e => { luzEscolhida = e.target.value; } },
      Object.entries(LUZES).map(([k, l]) => el('option', { value: k, texto: `${l.nome} (${l.plena}+${l.penumbra} m)`, selected: luzEscolhida === k }))) : null,
    el('select', { 'aria-label': 'Ver como', title: 'Ver o tabuleiro como um personagem enxerga', onchange: e => { verComo = e.target.value; tab.redesenhar(); } },
      el('option', { value: '', texto: 'Ver: tudo (mestre)' }),
      c.tokens.filter(t => t.tipo === 'pc' || t.visao).map(t => el('option', { value: t.id, texto: 'Ver como ' + t.nome, selected: verComo === t.id }))),
    el('button', { class: 'btn pequeno perigo', texto: 'Apagar paredes', onclick: () => { if (!confirm('Apagar todas as paredes, portas e luzes desta cena?')) return; c.paredes = []; c.luzes = []; salvar(); tab.redesenhar(); enviarParedes(c); } }),
    el('span', { class: 'dica', texto: o.modo === 'parede' ? 'Clique ponto a ponto; duplo clique termina.' : o.modo === 'porta' ? 'Arraste de um lado ao outro da porta.' : o.modo === 'luz' ? 'Clique onde fica a luz.' : 'Clique numa parede, porta ou luz.' }),
  ].filter(Boolean));
}

// ---------- barra de opções da névoa ----------
function mudarPincel(d) { tab.nevoa.raio = Math.max(0, Math.min(15, tab.nevoa.raio + d)); tab.redesenhar(); desenharOpcoesNevoa(); }
function ligarNevoa(c, ligada) {
  c.nevoa.ativa = ligada; salvar(); tab.redesenhar(); enviarCena(); desenharOpcoesNevoa(); atualizarSeAba('cenas');
}
function desenharOpcoesNevoa() {
  const c = cenaAberta(), o = tab.nevoa;
  const seg = (lista, atual, mudar) => el('div', { class: 'segmentos' }, lista.map(([v, n]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(atual === v), texto: n, onclick: () => { mudar(v); desenharOpcoesNevoa(); } })));
  $('#opcoes-nevoa').replaceChildren(...[
    el('label', { class: 'marcar' }, el('input', { type: 'checkbox', checked: !!c.nevoa.ativa, onchange: e => ligarNevoa(c, e.target.checked) }), 'Névoa ligada'),
    seg([['revelar', 'Revelar'], ['esconder', 'Esconder']], o.acao, v => { o.acao = v; }),
    seg([['redondo', 'Redondo'], ['pincel', 'Quadrado'], ['retangulo', 'Retângulo']], o.forma, v => { o.forma = v; }),
    o.forma !== 'retangulo' ? el('div', { class: 'tamanho-pincel', title: 'Tamanho do pincel (teclas [ e ])' },
      el('button', { class: 'btn pequeno', texto: '−', 'aria-label': 'Pincel menor', onclick: () => mudarPincel(-1) }),
      el('span', { texto: o.raio === 0 ? '1 quadrado' : `raio ${o.raio}` }),
      el('button', { class: 'btn pequeno', texto: '+', 'aria-label': 'Pincel maior', onclick: () => mudarPincel(1) })) : null,
    el('button', { class: 'btn pequeno', texto: 'Cobrir tudo', title: 'Esconde de novo tudo o que foi revelado', onclick: () => {
      if (!confirm('Cobrir a cena inteira com névoa de novo?')) return;
      c.nevoa.reveladas = []; if (!c.nevoa.ativa) c.nevoa.ativa = true; salvar(); tab.redesenhar(); enviarCena(); desenharOpcoesNevoa();
    } })].filter(Boolean));
}

// ---------- aba Combate: iniciativa, turnos e ações do token ----------
let modoMestre = 'normal', alvoMestre = '';
function painelCombate() {
  const c = cenaAberta(), cb = M.combate;
  const blocos = [];
  if (!cb || cb.cenaId !== c.id) {
    blocos.push(el('div', { class: 'bloco' }, titulo('Combate'),
      cb ? el('p', { class: 'dica', texto: 'Há um combate em outra cena. Abra aquela cena para continuar, ou comece um novo aqui (o outro será encerrado).' }) : null,
      el('button', { class: 'btn primario', texto: 'Começar combate nesta cena', onclick: comecarCombate }),
      el('p', { class: 'dica', texto: 'Todos os tokens da cena entram na ordem. Os jogadores rolam a iniciativa no painel deles e o valor entra sozinho.' })));
  } else {
    const porId = new Map(c.tokens.map(t => [t.id, t]));
    const novos = c.tokens.filter(t => !cb.ordem.some(o => o.id === t.id));
    blocos.push(el('div', { class: 'bloco' },
      titulo(`Combate · rodada ${cb.rodada}`, el('button', { class: 'btn pequeno perigo', texto: 'Encerrar', onclick: () => { if (confirm('Encerrar o combate?')) encerrarCombate(); } })),
      el('div', { class: 'linha-campos' },
        el('button', { class: 'btn primario cresce', texto: cb.vezId ? 'Próximo turno ▸' : 'Começar a 1ª rodada ▸', onclick: proximoTurno }),
        el('button', { class: 'btn pequeno', texto: 'Rolar inic. dos monstros', title: 'd20 + iniciativa para os monstros sem valor (rolagem secreta)', onclick: () => {
          for (const o of cb.ordem) {
            const t = porId.get(o.id);
            if (t && t.tipo !== 'pc' && o.ini == null) {
              const p = rolarTeste('Iniciativa', t.ini ?? 0, 'normal', 'iniciativa');
              o.ini = p.d20.total;

            }
          }
          ordenarCombate(); salvar(); enviarCombate();
        } })),
      novos.length ? el('button', { class: 'btn pequeno', texto: `Incluir ${novos.length} token(s) novo(s) na ordem`, onclick: () => { for (const t of novos) cb.ordem.push({ id: t.id, ini: null }); salvar(); enviarCombate(); } }) : null));
    blocos.push(el('div', { class: 'bloco cresce' }, titulo('Ordem de iniciativa'),
      el('div', { class: 'lista' }, cb.ordem.filter(o => porId.has(o.id)).map(o => {
        const t = porId.get(o.id), andou = cb.andou[o.id];
        return el('div', { class: 'item' + (o.id === cb.vezId ? ' vez' : '') + (t.id === tab.selecionado ? ' sel' : '') },
          el('input', { class: 'ini', type: 'number', value: o.ini ?? '', placeholder: '—', 'aria-label': 'Iniciativa de ' + t.nome, inputmode: 'numeric',
            onchange: e => definirIniciativa(o.id, e.target.value) }),
          el('span', { class: 'bola', style: `background:${t.cor}` }),
          el('button', { class: 'nome link', texto: t.nome + (t.oculto ? ' (escondido)' : ''), onclick: () => { tab.selecionado = t.id; tab.centralizarEm(t); desenharPainelMestre(); } }),
          t.pvMax ? el('span', { class: 'etiqueta cinza', texto: `${t.pv}/${t.pvMax}` }) : null,
          andou != null ? el('span', { class: 'etiqueta ' + (t.desloc && andou > t.desloc + 0.01 ? 'perigo' : 'cinza'), texto: t.desloc ? `${textoMetros(andou)}/${textoMetros(t.desloc)}` : textoMetros(andou) }) : null,
          el('button', { class: 'olho', texto: '×', title: 'Tirar do combate', 'aria-label': 'Tirar ' + t.nome + ' do combate', onclick: () => {
            cb.ordem = cb.ordem.filter(x => x !== o); if (cb.vezId === o.id) cb.vezId = null; salvar(); enviarCombate();
          } }));
      }))));
  }
  // ações do token selecionado (ou de quem é a vez)
  const t = c.tokens.find(x => x.id === tab.selecionado) || (cb?.cenaId === c.id ? c.tokens.find(x => x.id === cb.vezId) : null);
  if (t) {
    const alvos = c.tokens.filter(x => x.id !== t.id).map(x => ({ id: x.id, nome: x.nome + (x.oculto ? ' (escondido)' : '') }));
    if (alvoMestre && !alvos.some(a => a.id === alvoMestre)) alvoMestre = '';
    const secreta = !!t.oculto || c.id !== M.ativa;
    const enviar = p => janelaDado.resultado(resolverPedido(p, { nome: 'Mestre', cor: '#d3bb7c' }, t, c.tokens.find(x => x.id === alvoMestre) || null, secreta));
    blocos.push(el('div', { class: 'bloco' }, titulo('Ações: ' + t.nome, el('span', { class: 'etiqueta cinza', texto: [t.ca != null ? 'CA ' + t.ca : '', t.desloc ? textoMetros(t.desloc) : '', t.visao ? 'visão ' + textoMetros(t.visao) : ''].filter(Boolean).join(' · ') })),
      abaCombate(t, {
        alvos, alvoId: alvoMestre, aoMudarAlvo: v => { alvoMestre = v; },
        aoAcao: a => janelaDado.abrir({ titulo: a.nome, acao: a, alvoNome: c.tokens.find(x => x.id === alvoMestre)?.nome, enviar }),
        aoTeste: (nome, bonus, tipo) => janelaDado.abrir({ titulo: nome, teste: { nome, bonus, tipo }, enviar }),
      }),
      el('details', { class: 'bloco' }, el('summary', { texto: 'Atributos e salvaguardas' }),
        abaAtributos(t, { aoTeste: (nome, bonus, tipo) => janelaDado.abrir({ titulo: nome, teste: { nome, bonus, tipo }, enviar }) }))));
  } else blocos.push(el('p', { class: 'dica', texto: 'Clique num token para ver e rolar as ações dele aqui.' }));
  return blocos;
}

// ---------- lista de monstros (livro + os seus da Área do Mestre) ----------
let livroMonstros = null;
async function carregarLivro() {
  if (!livroMonstros) {
    const r = await fetch('dados/monstros.json?v=' + VERSAO);
    if (!r.ok) throw new Error('Não consegui abrir a lista de monstros.');
    livroMonstros = (await r.json()).monstros;
  }
  return livroMonstros;
}
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function abrirListaMonstros() {
  let livro;
  try { livro = await carregarLivro(); } catch (e) { avisar(e.message, true); return; }
  M.meusMonstros ||= [];
  const busca = el('input', { placeholder: 'Procurar: goblin, dragão, lobo…', 'aria-label': 'Procurar monstro', autocomplete: 'off' });
  const escondido = el('input', { type: 'checkbox' });
  const resultados = el('div', { class: 'lista resultados' });
  const todos = () => [...M.meusMonstros.map(m => ({ ...m, meu: true })), ...livro];
  const mostrar = () => {
    const q = semAcento(busca.value.trim());
    // nome exato primeiro, depois os que começam com o texto, depois o resto (em ordem alfabética)
    const pontos = n => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
    const achados = todos().filter(m => !q || semAcento(m.n ?? m.name).includes(q))
      .sort((a, b) => { const na = semAcento(a.n ?? a.name), nb = semAcento(b.n ?? b.name); return pontos(na) - pontos(nb) || na.localeCompare(nb); })
      .slice(0, 60);
    resultados.replaceChildren(...achados.map(m => el('button', { class: 'item', onclick: () => {
      const c = cenaAberta(), base = tokenDoMonstro(m), centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
      const n = { id: uid(), ...base, nome: c.tokens.some(t => t.nome === base.nome) ? proximoNome(c, base.nome) : base.nome, dono: '', oculto: escondido.checked, img: null,
        x: cel.cx - Math.floor((celulasDe(base.tam) - 1) / 2), y: cel.cy - Math.floor((celulasDe(base.tam) - 1) / 2) };
      c.tokens.push(n); tab.selecionado = n.id; tab.imagemSelecionada = null;
      if (M.combate?.cenaId === c.id) M.combate.ordem.push({ id: n.id, ini: null });
      salvar(); tab.redesenhar(); enviarToken(c, n); if (M.combate) enviarCombate();
      avisar(`${n.nome} colocado no centro da tela.`);
      desenharPainelMestre();
    } },
      el('span', { class: 'nome' }, el('strong', { texto: m.n ?? m.name }), el('small', { texto: ` ND ${m.nd ?? m.cr ?? '?'} · ${m.tp ?? m.type ?? ''} · ${m.tam ?? m.size ?? ''}` })),
      m.meu ? el('span', { class: 'etiqueta ouro', texto: 'meu' }) : null,
      el('span', { class: 'etiqueta cinza', texto: `CA ${m.ca ?? m.ac} · PV ${m.pv ?? m.hp}` }))),
      ...(achados.length ? [] : [el('p', { class: 'vazio', texto: 'Nenhum monstro com esse nome.' })]));
  };
  busca.addEventListener('input', mostrar);
  abrirModal('Monstros', [
    busca,
    el('div', { class: 'linha-campos meio' },
      el('label', { class: 'marcar' }, escondido, 'Colocar escondido dos jogadores'),
      el('span', { class: 'espaco' }),
      el('button', { class: 'btn pequeno', texto: 'Importar meus monstros', title: 'Backup JSON da Área do Mestre da Ficha Arcana', onclick: async () => {
        const arq = await escolherArquivo('.json,application/json'); if (!arq) return;
        try {
          const raw = JSON.parse(await arq.text());
          if (raw?.kind !== 'arcana-dm' || !Array.isArray(raw.custom)) throw new Error('Este arquivo não é um backup da Área do Mestre.');
          const meus = raw.custom.filter(m => m && m.name).slice(0, 1000);
          M.meusMonstros = meus; salvar();
          avisar(`${meus.length} monstro(s) seus importados.`); mostrar();
        } catch (e) { avisar(e.message, true); }
      } })),
    resultados,
    el('p', { class: 'dica', texto: `${livro.length} monstros do Livro dos Monstros 2024. O token já vem com PV, CA, deslocamento, tamanho e ataques.` }),
  ]);
  mostrar(); busca.focus();
}
function abrirModal(titulo2, conteudo) {
  $('#modal-titulo').textContent = titulo2;
  $('#modal-corpo').replaceChildren(...conteudo);
  $('#modal').hidden = false;
}
function fecharModal() { $('#modal').hidden = true; }

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
  const conectados = new Map([...(sala?.jogadores.values() || [])].map(j => [j.id, j]));
  const todos = Object.entries(M.conhecidos).map(([id, j]) => ({ id, ...j, conn: conectados.get(id) }));
  const endereco = location.href.split('#')[0].split('?')[0];
  const tokensDe = id => M.cenas.reduce((n, c) => n + c.tokens.filter(t => t.dono === id).length, 0);
  return [
    el('div', { class: 'bloco' }, titulo('Como os jogadores entram'),
      el('p', { class: 'dica', texto: `Abrem ${endereco}, clicam em "Sou jogador" e digitam o código ${M.codigo}.` }),
      el('button', { class: 'btn pequeno', texto: 'Copiar endereço e código', onclick: () => { navigator.clipboard?.writeText(`${endereco}\nCódigo da sala: ${M.codigo}`); avisar('Copiado.'); } })),
    el('div', { class: 'bloco cresce' }, titulo(`Jogadores (${conectados.size} conectados de ${todos.length})`),
      todos.length ? el('div', { class: 'lista' }, todos.map(j => el('div', { class: 'item' + (j.conn ? '' : ' apagado') },
        el('span', { class: 'bola', style: `background:${j.cor}` }),
        el('span', { class: 'nome', texto: j.nome }),
        envios.get(j.id)?.texto ? el('span', { class: 'etiqueta ouro', texto: envios.get(j.id).texto }) : null,
        M.bloqueados[j.id] ? el('span', { class: 'etiqueta perigo', texto: 'expulso' }) : el('span', { class: 'etiqueta ' + (j.conn ? '' : 'cinza'), texto: j.conn ? (j.conn.celular ? 'online · celular' : 'online') : 'offline' }),
        M.bloqueados[j.id]
          ? el('button', { class: 'btn pequeno', texto: 'Deixar voltar', onclick: () => { delete M.bloqueados[j.id]; salvar(); desenharPainelMestre(); } })
          : el('button', { class: 'btn pequeno perigo', texto: 'Expulsar', title: 'Desconecta e não deixa entrar de novo', onclick: () => expulsar(j.id) }),
        el('button', { class: 'olho', texto: '🗑', title: 'Excluir jogador e os tokens dele', 'aria-label': 'Excluir ' + j.nome, onclick: () => excluirJogador(j.id, tokensDe(j.id)) }))))
        : el('p', { class: 'vazio', texto: 'Ninguém entrou ainda.' })),
    painelGaleria(),
  ];
}
function expulsar(id) {
  const j = M.conhecidos[id]; if (!j || !confirm(`Expulsar ${j.nome}? Ele será desconectado e não poderá entrar de novo (até você deixar).`)) return;
  M.bloqueados[id] = true; salvar();
  for (const c of sala?.jogadores.values() || []) if (c.id === id) { sala.enviar(c, { t: 'expulso' }); setTimeout(() => { try { c.conn.close(); } catch {} }, 400); }
  avisar(`${j.nome} foi expulso.`); desenharPainelMestre();
}
function excluirJogador(id, nTokens) {
  const j = M.conhecidos[id]; if (!j) return;
  if (!confirm(`Excluir ${j.nome} da lista${nTokens ? ` e os ${nTokens} token(s) dele` : ''}? (Se ele entrar de novo, volta para a lista.)`)) return;
  for (const c of M.cenas) { for (const t of c.tokens.filter(t => t.dono === id)) enviarToken(c, t, true); c.tokens = c.tokens.filter(t => t.dono !== id); }
  if (M.combate) M.combate.ordem = M.combate.ordem.filter(o => M.cenas.some(c => c.tokens.some(t => t.id === o.id)));
  for (const g of M.galeria) if (g.dono === id) g.dono = null;
  delete M.conhecidos[id]; delete M.fichas[id];
  for (const c of sala?.jogadores.values() || []) if (c.id === id) { sala.enviar(c, { t: 'expulso', excluido: true }); setTimeout(() => { try { c.conn.close(); } catch {} }, 400); }
  salvar(); tab.redesenhar(); enviarGaleria(); enviarCombate(); desenharPainelMestre();
  avisar(`${j.nome} foi excluído.`);
}

// ---------- galeria de tokens: o mestre sobe imagens; cada jogador escolhe um (fica indisponível para os outros) ----------
const galeriaPara = j => M.galeria.map(g => ({ id: g.id, nome: g.nome, img: g.img, livre: !g.dono, meu: g.dono === j.id, de: g.dono && g.dono !== j.id ? (M.conhecidos[g.dono]?.nome || 'outro jogador') : '' }));
function enviarGaleria() { if (!sala) return; for (const j of sala.jogadores.values()) sala.enviar(j, { t: 'galeria', itens: galeriaPara(j) }); }
function painelGaleria() {
  const subir = async () => {
    const arquivos = await new Promise(ok => { const i = el('input', { type: 'file', accept: 'image/*', multiple: true }); i.addEventListener('change', () => ok([...i.files])); i.click(); });
    let n = 0;
    for (const arq of arquivos.slice(0, 40)) {
      try { M.galeria.push({ id: uid(), nome: arq.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Token', img: await retratoPequeno(arq), dono: null }); n++; }
      catch { avisar(`Não consegui abrir ${arq.name}.`, true); }
    }
    if (n) { salvar(); enviarGaleria(); avisar(`${n} token(s) na galeria.`); desenharPainelMestre(); }
  };
  return el('div', { class: 'bloco' }, titulo(`Galeria de tokens (${M.galeria.length})`, el('button', { class: 'btn pequeno', texto: '+ Subir tokens', onclick: subir })),
    el('p', { class: 'dica', texto: 'Os jogadores escolhem um token da galeria no painel deles; o escolhido fica indisponível para os outros. Você também pode usar estes tokens nos NPCs (botão "Da galeria").' }),
    M.galeria.length ? el('div', { class: 'galeria' }, M.galeria.map(g => el('div', { class: 'galeria-item' + (g.dono ? ' usado' : '') },
      el('img', { src: g.img, alt: g.nome }),
      el('small', { texto: g.dono ? (M.conhecidos[g.dono]?.nome || 'em uso') : g.nome }),
      el('div', { class: 'acoes' },
        g.dono ? el('button', { class: 'olho', texto: '↺', title: 'Liberar (o jogador perde este token)', 'aria-label': 'Liberar ' + g.nome, onclick: () => { g.dono = null; salvar(); enviarGaleria(); desenharPainelMestre(); } }) : null,
        el('button', { class: 'olho', texto: '🗑', title: 'Tirar da galeria', 'aria-label': 'Tirar ' + g.nome + ' da galeria', onclick: () => { M.galeria = M.galeria.filter(x => x !== g); salvar(); enviarGaleria(); desenharPainelMestre(); } })))))
      : null);
}
function escolherDaGaleria(aoEscolher) {
  abrirModal('Escolher da galeria', [
    el('div', { class: 'galeria grande' }, M.galeria.map(g => el('button', { class: 'galeria-item', type: 'button', onclick: () => { fecharModal(); aoEscolher(g.img); } },
      el('img', { src: g.img, alt: g.nome }), el('small', { texto: g.nome })))),
  ]);
}
// o jogador escolheu (ou largou) um token da galeria
function escolhaDaGaleria(j, id) {
  const g = M.galeria.find(x => x.id === id);
  if (id && (!g || (g.dono && g.dono !== j.id))) { sala.enviar(j, { t: 'erro', texto: 'Este token já foi escolhido por outro jogador.' }); enviarGaleria(); return; }
  for (const x of M.galeria) if (x.dono === j.id) x.dono = null; // um por jogador
  if (g) {
    g.dono = j.id;
    for (const c of M.cenas) for (const t of c.tokens) if (t.dono === j.id && t.tipo === 'pc') { t.img = g.img; enviarToken(c, t); }
  }
  salvar(); tab.redesenhar(); enviarGaleria(); atualizarSeAba('jogadores', 'tokens');
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
  const ponte = lerPonte() || { urls: [], usuario: '', senha: '' };
  const fUrls = el('input', { value: ponte.urls.join(' '), placeholder: 'turn:exemplo.com:3478', spellcheck: 'false', autocomplete: 'off' });
  const fUsuario = el('input', { value: ponte.usuario || '', autocomplete: 'off', spellcheck: 'false' });
  const fSenha = el('input', { value: ponte.senha || '', type: 'password', autocomplete: 'off' });
  const resultado = el('p', { class: 'dica', texto: lerPonte() ? 'Ponte configurada.' : 'Sem ponte: só conecta quando a internet de vocês permite conexão direta.' });
  const lerCampos = () => {
    const urls = fUrls.value.split(/[\s,]+/).map(s => s.trim()).filter(s => /^turns?:/.test(s)).slice(0, 6);
    return urls.length ? { urls, usuario: fUsuario.value.trim(), senha: fSenha.value } : null;
  };
  return [
    el('div', { class: 'bloco' }, titulo('Conexão: ponte (TURN)'),
      el('p', { class: 'dica', texto: 'Se o jogador vê "a internet bloqueou a conexão", cole aqui um servidor TURN (grátis com cadastro, veja o LEIA_PRIMEIRO). Só o mestre precisa configurar.' }),
      el('label', {}, 'Endereço(s) TURN', fUrls),
      el('div', { class: 'linha-campos' }, el('label', { class: 'cresce' }, 'Usuário', fUsuario), el('label', { class: 'cresce' }, 'Senha', fSenha)),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn pequeno', texto: 'Testar ponte', onclick: async () => {
          const p = lerCampos(); if (!p) { resultado.textContent = 'Escreva um endereço que comece com turn:'; return; }
          resultado.textContent = 'Testando…';
          resultado.textContent = (await testarPonte(p)) ? '✓ A ponte respondeu. Pode salvar.' : '✗ A ponte não respondeu. Confira endereço, usuário e senha.';
        } }),
        el('button', { class: 'btn pequeno primario', texto: 'Salvar e reabrir a sala', onclick: () => {
          salvarPonte(lerCampos()); avisar('Ponte salva. Reabrindo a sala…'); sala?.fechar(); setTimeout(() => location.reload(), 900);
        } }),
        lerPonte() ? el('button', { class: 'btn pequeno perigo', texto: 'Tirar ponte', onclick: () => { salvarPonte(null); sala?.fechar(); setTimeout(() => location.reload(), 700); } }) : null),
      resultado),
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
const J = { eu: null, codigo: null, cena: null, conexao: null, esperando: new Set(), vitrine: null, aba: 'personagem', vistas: new Set(),
  ficha: null, modo: 'normal', alvoId: '', tokenId: '', combate: null };
function lerFichaGuardada() { try { return JSON.parse(localStorage.getItem('arcana-tab-ficha') || 'null'); } catch { return null; } }
function guardarFicha(f) { try { localStorage.setItem('arcana-tab-ficha', JSON.stringify(f)); } catch { avisar('A ficha é grande demais para guardar neste aparelho; ela vale só para esta sessão.', true); } }

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
    dificil: Array.isArray(c.dificil) ? c.dificil.filter(k => typeof k === 'string' && /^-?\d{1,5},-?\d{1,5}$/.test(k)).slice(0, 20000) : [],
    visao: c.visao?.ativa ? { ativa: true, ambiente: ['dia', 'penumbra', 'escuro'].includes(c.visao.ambiente) ? c.visao.ambiente : 'escuro' } : { ativa: false },
    paredes: (Array.isArray(c.paredes) ? c.paredes : []).slice(0, 5000).map(limparParede).filter(Boolean),
    luzes: (Array.isArray(c.luzes) ? c.luzes : []).slice(0, 300).map(l => (l && Number.isFinite(l.x) && Number.isFinite(l.y) ? { id: String(l.id).slice(0, 64), x: l.x, y: l.y, tipo: LUZES[l.tipo] ? l.tipo : 'tocha' } : null)).filter(Boolean),
    nevoa: c.nevoa?.ativa ? { ativa: true, reveladas: (Array.isArray(c.nevoa.reveladas) ? c.nevoa.reveladas : []).filter(k => typeof k === 'string' && /^-?\d{1,5},-?\d{1,5}$/.test(k)).slice(0, 200000) } : { ativa: false, reveladas: [] },
  };
}
function limparParede(w) {
  const pt = p => (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7 ? { x: p.x, y: p.y } : null);
  const a = pt(w?.a), b = pt(w?.b);
  return a && b ? { id: String(w.id).slice(0, 64), a, b, tipo: w.tipo === 'porta' ? 'porta' : 'parede', aberta: !!w.aberta, trancada: !!w.trancada } : null;
}
function limparToken(t) {
  if (!t || typeof t !== 'object') return null;
  const r = { luz: LUZES[t.luz] ? t.luz : '', id: String(t.id).slice(0, 64), nome: String(t.nome || '').slice(0, 40), tipo: t.tipo === 'pc' ? 'pc' : 'npc', cor: corValida(t.cor) || '#5b7c66',
    tam: numero(t.tam, 0.5, 4, 1), x: inteiro(t.x, -500, 5000), y: inteiro(t.y, -500, 5000), dono: String(t.dono || ''), img: imagemValida(t.img) };
  if (t.tipo === 'pc') {
    r.pv = inteiro(t.pv, -999, 9999); r.pvMax = inteiro(t.pvMax, 0, 9999);
    r.ca = t.ca == null ? null : inteiro(t.ca, 0, 40); r.desloc = numero(t.desloc, 0, 300); r.visao = numero(t.visao, 0, 300); r.ini = inteiro(t.ini, -10, 30);
    r.outros = Object.fromEntries(Object.entries(t.outros && typeof t.outros === 'object' ? t.outros : {}).slice(0, 6).map(([k, v]) => [String(k).slice(0, 20), numero(v, 0, 300)]));
    r.ficha = limparFichaDoToken(t.ficha);
    r.pvTemp = inteiro(t.pvTemp, 0, 999); r.recursos = limparRecursos(t.recursos);
  } else r.estado = ['Ileso', 'Ferido', 'Muito ferido', 'Caído'].includes(t.estado) ? t.estado : '';
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

const CLASSES_RESULTADO = ['acerto', 'erro', 'critico'];
function limparEntrada(e) {
  if (!e || typeof e !== 'object') return null;
  const t = (v, n) => String(v ?? '').slice(0, n);
  return { id: t(e.id, 64), quem: t(e.quem, 40), cor: corValida(e.cor) || '#a4c29a', titulo: t(e.titulo, 80), alvoNome: e.alvoNome ? t(e.alvoNome, 40) : '',
    linhas: (Array.isArray(e.linhas) ? e.linhas : []).slice(0, 10).map(l => ({ rotulo: t(l?.rotulo, 40), total: t(l?.total, 20), detalhe: t(l?.detalhe, 200) })),
    resultado: e.resultado ? { texto: t(e.resultado.texto, 40), classe: CLASSES_RESULTADO.includes(e.resultado.classe) ? e.resultado.classe : '' } : null,
    dados3d: limparAnimacao(e.dados3d) };
}
function limparAnimacao(a) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.dice)) return null;
  const dice = a.dice.slice(0, 24).filter(d => [4, 6, 8, 10, 12, 20].includes(d?.sides))
    .map(d => ({ sides: d.sides, value: inteiro(d.value, 1, d.sides, 1), selected: !!d.selected, ...(['tens', 'ones'].includes(d.percentile) ? { percentile: d.percentile } : {}) }));
  if (!dice.length) return null;
  return { dice, total: String(a.total ?? '').slice(0, 10), natural: a.natural == null ? null : inteiro(a.natural, 1, 20, 1),
    kind: a.kind === 'attack' ? 'attack' : 'free', criticalThreshold: inteiro(a.criticalThreshold, 2, 20, 20), subtitle: String(a.subtitle || '').slice(0, 60) };
}
function limparCombate(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.ordem)) return null;
  return { rodada: inteiro(c.rodada, 1, 9999, 1), vezId: c.vezId ? String(c.vezId).slice(0, 64) : null,
    ordem: c.ordem.slice(0, 200).map(o => ({ id: String(o.id).slice(0, 64), nome: String(o.nome || '').slice(0, 40), ini: o.ini == null ? null : inteiro(o.ini, -20, 60), rolou: !!o.rolou })),
    andou: Object.fromEntries(Object.entries(c.andou && typeof c.andou === 'object' ? c.andou : {}).slice(0, 200).map(([k, v]) => [String(k).slice(0, 64), numero(v, 0, 9999)])) };
}
// O token que o jogador está usando agora (pode ter até 3)
function meuToken() {
  const meus = J.cena?.tokens.filter(t => t.dono === J.eu.id) || [];
  return meus.find(t => t.id === J.tokenId) || meus[0] || null;
}
async function carregarFicha() {
  const arq = await escolherArquivo('.json,application/json');
  if (!arq) return;
  try {
    const bruta = JSON.parse(await arq.text());
    const f = limparFicha(bruta); // confere antes de mandar
    let retrato = null;
    if (f.retrato) { try { retrato = await retratoPequeno(await (await fetch(f.retrato)).blob()); } catch {} }
    const leve = { ...bruta, retrato: null };
    J.ficha = { bruta: leve, retrato };
    guardarFicha(J.ficha);
    mandarFicha();
    avisar(`Ficha de ${f.nome} carregada: CA ${f.ca}, ${f.pv}/${f.pvMax} PV, ${f.acoes.length} ações.`);
  } catch (e) { avisar(e.message.includes('JSON') ? 'Este arquivo não é uma ficha válida.' : e.message, true); }
}
function mandarFicha() {
  if (!J.ficha || !J.cena) return;
  const centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
  J.conexao.enviar({ t: 'ficha', ficha: J.ficha.bruta, retrato: J.ficha.retrato, tokenId: meuToken()?.id || '', x: cel.cx, y: cel.cy });
}

function pedirMapa(hash) {
  if (J.esperando.has(hash)) return;
  J.esperando.add(hash);
  J.conexao.enviar({ t: 'preciso', hash });
}

async function receberCena(c) {
  const anterior = J.cena?.id;
  J.cena = limparCenaRecebida(c);
  // memória do que já foi visto, por cena (fica enquanto a página estiver aberta)
  J.explorado ||= {};
  if (J.cena) tab.explorado = (J.explorado[J.cena.id] ||= new Set());
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
  if (msg.t === 'rolagem') {
    const e = limparEntrada(msg.e); if (!e) return;
    const nova = !J.vistas.has(e.id); J.vistas.add(e.id);
    janela.adicionar(e); janelaDado.resultado(e);
    if (nova && !msg.antiga) animar(e);
    return;
  }
  if (msg.t === 'galeria') {
    J.galeria = (Array.isArray(msg.itens) ? msg.itens : []).slice(0, 200).map(g => ({ id: String(g.id).slice(0, 64), nome: String(g.nome || '').slice(0, 30),
      img: imagemValida(g.img), livre: !!g.livre, meu: !!g.meu, de: String(g.de || '').slice(0, 40) })).filter(g => g.img);
    desenharPainelJogador(); return;
  }
  if (msg.t === 'erro') { avisar(String(msg.texto || 'Erro').slice(0, 200), true); return; }
  if (msg.t === 'combate') {
    const antes = J.combate;
    J.combate = limparCombate(msg.combate); tab.pulsando = !!J.combate; tab.redesenhar(); desenharPainelJogador();
    // combate começou e minha iniciativa ainda não foi rolada: aviso grande
    if (iniciativaPendente() && !antes) mostrarAvisoIniciativa(); else if (!iniciativaPendente()) $('#aviso-iniciativa').hidden = true;
    return;
  }
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
  } else if (msg.t === 'laser') {
    const fim = !!msg.fim || msg.x == null;
    tab.mostrarLaser('j:' + String(msg.id).slice(0, 64), fim ? null : numero(msg.x, -1e7, 1e7), fim ? null : numero(msg.y, -1e7, 1e7), corValida(msg.cor) || '#d3bb7c');
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
    aoLaser: (() => { const mandar = limitador(p => J.conexao?.enviar(p ? { t: 'laser', x: p.x, y: p.y } : { t: 'laser', fim: true })); return (x, y) => mandar(x == null ? null : { x, y }); })(),
    extraDoToken: t => extraDoToken(t, J.combate, false),
    // visão dinâmica: o jogador vê pelos olhos dos próprios tokens
    configVisao: () => (J.cena ? configDaVisao(J.cena, J.cena.tokens.filter(t => t.dono === J.eu.id)) : null),
    ehMeu: t => t.dono === J.eu.id,
    aoPorta: w => J.conexao.enviar({ t: 'porta', id: w.id }),
    limiteMovimento: t => (J.combate?.ordem.some(o => o.id === t.id) && t.desloc ? { andou: J.combate.andou[t.id] || 0, desloc: t.desloc } : null),
    aoRegua: r => {
      // manda no máximo 20 vezes por segundo
      reguaPendente = r;
      const agora = performance.now();
      if (!r || agora - ultimaRegua > 50) { ultimaRegua = agora; J.conexao.enviar({ t: 'regua', a: r?.a, b: r?.b }); reguaPendente = null; }
      else setTimeout(() => { if (reguaPendente) { J.conexao.enviar({ t: 'regua', a: reguaPendente.a, b: reguaPendente.b }); reguaPendente = null; } }, 60);
    },
  }, {
    ehMestre: false,
    aoRolarLivre: expr => {
      try { J.conexao.enviar({ t: 'rolar', p: rolarLivre(expr), tokenId: meuToken()?.id || '' }); }
      catch (e) { avisar(e.message, true); return false; }
    },
  });
  J.ficha = lerFichaGuardada();
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
  let conectado = false;
  J.conexao = entrarNaSala(codigo, J.eu, {
    aoConectar: () => {
      conectado = true;
      definirStatus('Conectado', 'on'); avisoMapa(null);
      // reconectou: pede de novo os arquivos que estavam a caminho
      const pendentes = [...J.esperando]; J.esperando.clear(); pendentes.forEach(pedirMapa);
    },
    // a barra de cima corta textos longos; antes de conectar, a mensagem inteira aparece no meio da tela
    aoStatus: t => { definirStatus(t, 'espera'); if (!conectado || !J.cena) avisoMapa(t); else avisar(t); conectado = false; },
    aoMensagem: tratarMensagemDoMestre,
    aoFim: motivo => {
      const texto = motivo === 'expulso' ? 'Você foi removido da mesa pelo mestre.' : motivo === 'excluido' ? 'O mestre excluiu você da mesa.' : 'O mestre encerrou a sala.';
      definirStatus(texto, 'off'); avisar(texto, motivo !== 'fim'); avisoMapa(texto);
    },
  });
}

// ---------- aviso "rolem iniciativa" ----------
function iniciativaPendente() {
  const eu = meuToken();
  return !!(J.combate && eu && J.combate.ordem.some(o => o.id === eu.id && o.ini == null));
}
function rolarIniciativaJogador() {
  const eu = meuToken(); if (!eu) return;
  $('#aviso-iniciativa').hidden = true;
  janelaDado.abrir({ titulo: 'Iniciativa', teste: { nome: 'Iniciativa', bonus: eu.ini || 0, tipo: 'iniciativa' },
    enviar: p => J.conexao.enviar({ t: 'rolar', p, tokenId: eu.id, alvoId: '' }) });
}
function mostrarAvisoIniciativa() {
  const caixa = $('#aviso-iniciativa');
  caixa.replaceChildren(
    el('strong', { texto: '⚔ O combate começou!' }),
    el('span', { texto: 'Role sua iniciativa.' }),
    el('button', { class: 'btn primario', texto: 'Rolar iniciativa', onclick: rolarIniciativaJogador }),
    el('button', { class: 'olho', texto: '×', 'aria-label': 'Fechar aviso', title: 'Fechar (o botão de iniciativa continua piscando)', onclick: () => { caixa.hidden = true; } }));
  caixa.hidden = false;
}

// tokens da galeria do mestre: o jogador escolhe um; os já escolhidos ficam indisponíveis
function escolhaDeToken() {
  const itens = J.galeria || [];
  if (!itens.length) return null;
  return el('div', { class: 'bloco' }, titulo('Escolha seu token'),
    el('div', { class: 'galeria' }, itens.map(g => el('button', { type: 'button', class: 'galeria-item' + (g.meu ? ' meu' : '') + (!g.livre && !g.meu ? ' usado' : ''),
      disabled: !g.livre && !g.meu, title: g.meu ? 'Seu token (clique para largar)' : g.livre ? 'Escolher ' + g.nome : 'Escolhido por ' + g.de,
      onclick: () => J.conexao.enviar({ t: 'galeria-escolher', id: g.meu ? null : g.id }) },
      el('img', { src: g.img, alt: g.nome }), el('small', { texto: g.meu ? 'Seu' : g.livre ? g.nome : g.de || 'em uso' })))));
}

function desenharPainelJogador() {
  if (document.activeElement?.closest?.('#painel input, #painel select')) { clearTimeout(desenharPainelJogador.t); desenharPainelJogador.t = setTimeout(desenharPainelJogador, 800); return; }
  const meus = J.cena?.tokens.filter(t => t.dono === J.eu.id) || [];
  const eu = meuToken(), cb = J.combate;
  const rolagem = $('#painel .conteudo')?.scrollTop || 0;
  const enviar = p => J.conexao.enviar({ t: 'rolar', p, tokenId: eu?.id || '', alvoId: J.alvoId });
  const rolarTesteJanela = (nome, bonus, tipo) => janelaDado.abrir({ titulo: nome, teste: { nome, bonus, tipo }, enviar });
  const mudar = (acao, extra = {}) => J.conexao.enviar({ t: 'meu-token', id: eu.id, acao, ...extra });

  // faixa do combate (aparece em todas as abas)
  const faixa = cb ? el('div', { class: 'faixa-combate' + (meus.some(t => t.id === cb.vezId) ? ' minha-vez' : '') },
    el('strong', { texto: meus.some(t => t.id === cb.vezId) ? 'É a sua vez!' : `Rodada ${cb.rodada} · vez de ${cb.ordem.find(o => o.id === cb.vezId)?.nome || '—'}` }),
    el('ol', { class: 'ordem' }, cb.ordem.map(o => {
      // a iniciativa do meu token que ainda não foi rolada vira um botão
      const meuSemIni = o.ini == null && meus.some(t => t.id === o.id);
      return el('li', { class: o.id === cb.vezId ? 'vez' : '' }, el('span', { texto: o.nome }),
        meuSemIni ? el('button', { class: 'btn pequeno primario piscando', texto: 'Rolar iniciativa', onclick: rolarIniciativaJogador })
          : el('b', { texto: o.ini != null ? String(o.ini) : o.rolou ? '✓' : '…', title: o.ini != null ? 'Sua iniciativa' : o.rolou ? 'Já rolou' : 'Ainda não rolou' }));
    }))) : null;

  // botões de token e ficha
  const botoesFicha = el('div', { class: 'acoes' },
    J.cena && meus.length < 3 ? el('button', { class: 'btn pequeno primario', texto: meus.length ? '+ Outro token' : 'Colocar meu token no mapa', onclick: () => {
      const centro = tab.centroDaTela(), cel = tab.celulaEm(centro.x, centro.y);
      J.conexao.enviar({ t: 'criar-token', nome: meus.length ? `${J.eu.nome} ${meus.length + 1}` : J.eu.nome, cor: J.eu.cor, x: cel.cx, y: cel.cy });
      $('#painel').classList.remove('aberto');
    } }) : null,
    el('button', { class: 'btn pequeno', texto: J.ficha ? 'Trocar ficha' : 'Carregar minha ficha', title: 'Arquivo da Ficha Arcana: Exportar ficha › Exportar para o tabuleiro', onclick: carregarFicha }),
    J.ficha && eu && !eu.ficha ? el('button', { class: 'btn pequeno', texto: 'Usar ficha neste token', onclick: mandarFicha }) : null,
    eu ? el('button', { class: 'btn pequeno', texto: 'Achar no mapa', onclick: () => { tab.centralizarEm(eu); $('#painel').classList.remove('aberto'); } }) : null);

  let corpo;
  if (!eu) {
    corpo = [el('div', { class: 'bloco' }, titulo(J.cena ? J.cena.nome : 'Esperando o mestre'),
      el('p', { class: 'dica', texto: `Você é ${J.eu.nome}. Coloque seu token no mapa e carregue a ficha exportada da Ficha Arcana.` }), botoesFicha)];
  } else if (J.aba === 'atributos') corpo = abaAtributos(eu, { aoTeste: rolarTesteJanela });
  else if (J.aba === 'combate') {
    const alvos = (J.cena?.tokens || []).filter(t => t.id !== eu.id).map(t => ({ id: t.id, nome: t.nome }));
    if (J.alvoId && !alvos.some(a => a.id === J.alvoId)) J.alvoId = '';
    corpo = abaCombate(eu, {
      alvos, alvoId: J.alvoId, aoMudarAlvo: v => { J.alvoId = v; },
      aoAcao: a => janelaDado.abrir({ titulo: a.nome, acao: a, alvoNome: alvos.find(x => x.id === J.alvoId)?.nome, enviar }),
      aoTeste: (nome, bonus, tipo) => (tipo === 'iniciativa' ? rolarIniciativaJogador() : rolarTesteJanela(nome, bonus, tipo)),
      iniciativaPendente: iniciativaPendente(),
    });
  } else if (J.aba === 'habilidades') corpo = abaHabilidades(eu);
  else corpo = abaPersonagem(eu, {
    podeEditar: true,
    aoVida: (acao, valor) => mudar(acao, { valor }),
    aoRecurso: (recurso, acao) => mudar(acao, { recurso }),
    aoIniciativa: rolarIniciativaJogador,
    iniciativaPendente: iniciativaPendente(),
    aoDescanso: tipo => { if (confirm(tipo === 'longo' ? 'Descanso longo: recupera todos os PV e usos. Confirmar?' : 'Descanso curto: recupera os usos de descanso curto. Confirmar?')) mudar('descanso', { tipo }); },
    extras: [
      meus.length > 1 ? el('label', {}, 'Token que você está usando', el('select', { onchange: e => { J.tokenId = e.target.value; desenharPainelJogador(); } },
        meus.map(t => el('option', { value: t.id, texto: t.nome, selected: t.id === eu.id })))) : null,
      botoesFicha,
      escolhaDeToken(),
      J.cena?.visao?.ativa ? el('label', {}, 'Sua luz (tocha, lampião…)', el('select', { onchange: e => mudar('luz', { luz: e.target.value }) },
        el('option', { value: '', texto: 'Nenhuma' }), Object.entries(LUZES).map(([k, l]) => el('option', { value: k, texto: `${l.nome} (${l.plena}+${l.penumbra} m)`, selected: eu.luz === k })))) : null,
      el('details', { class: 'bloco' }, el('summary', { texto: 'Como usar' }),
        el('p', { class: 'dica', texto: celular
          ? 'Arraste com um dedo para mover a tela ou o seu token. Dois dedos dão zoom. Segure o dedo parado para fazer um ping.'
          : 'Arraste seu token para andar. Arraste o fundo para mover a tela e use a rodinha para o zoom. Shift + clique faz um ping. R = régua, L = bolinha.' }),
        el('button', { class: 'btn pequeno', texto: 'Apagar os mapas guardados neste aparelho', onclick: async () => {
          if (!confirm('Apagar os mapas guardados? Eles serão baixados de novo do mestre quando precisar.')) return;
          for (const k of await chaves('arquivos')) await apagar('arquivos', k);
          avisar('Mapas apagados.');
        } })),
    ].filter(Boolean),
  });
  $('#painel').replaceChildren(
    eu ? barraDeAbas(J.aba, a => { J.aba = a; desenharPainelJogador(); $('#painel .conteudo').scrollTop = 0; }) : '',
    el('div', { class: 'conteudo' }, faixa, corpo));
  $('#painel .conteudo').scrollTop = rolagem;
}

// =====================================================================
//                           TELA INICIAL
// =====================================================================
// Para os testes automáticos e para estudar no console do navegador (F12).
document.getElementById('versao').textContent = 'v' + VERSAO;
window.arcanaTabuleiro = { get tab() { return tab; }, M, J, imagensAbertas };

(async function inicio() {
  const perfil = lerPerfil();
  let corEscolhida = corValida(perfil?.cor) || CORES[3][0];
  if (perfil) { $('#j-nome').value = perfil.nome || ''; $('#j-codigo').value = perfil.codigo || ''; }
  $('#j-cores').replaceWith(escolhaDeCor(corEscolhida, c => { corEscolhida = c; }));
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
    const p = { id: perfil?.id || uid(), nome: $('#j-nome').value.trim().slice(0, 40) || 'Jogador', cor: corEscolhida, codigo };
    salvarPerfil(p);
    iniciarJogador(p, codigo);
  });
})();
