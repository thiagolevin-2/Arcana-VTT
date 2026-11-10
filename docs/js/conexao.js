// conexao.js — liga o mestre aos jogadores (PeerJS / WebRTC), igual à Mesa online.
// A página do mestre funciona como "servidor": cada jogador conversa só com o mestre,
// e o mestre repassa o que todos precisam ver.
// As mensagens vão em JSON (como na Mesa online). Arquivos grandes (mapas) vão em pedaços
// de 12 KB convertidos em texto (base64), sem entupir a conexão.
//
// Sobre a "ponte" (TURN): quando mestre e jogador estão em internets diferentes, muitas vezes
// a conexão direta é bloqueada (CGNAT, roteador, rede de celular). Aí precisa de um servidor
// TURN que repassa os dados. O TURN gratuito que vem no PeerJS parou de funcionar, então o
// mestre pode colar o seu (grátis com cadastro) em Ajustes › Conexão.

const PREFIXO = 'arcana-tab-';
const PEDACO = 12000;
const LIMITE_FILA = 4 * 1024 * 1024; // espera a fila esvaziar antes de mandar mais
const ESPERA_CONEXAO = 20000;
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAVE_PONTE = 'arcana-tab-ponte';
// "sinal de vida": o jogador manda um "oi" a cada 4 s; sem notícias por 40 s, o mestre o considera offline
const INTERVALO_OI = 4000, LIMITE_SILENCIO = 40000; // folga para abas em segundo plano (o navegador desacelera os relógios)

export function novoCodigo() {
  const n = crypto.getRandomValues(new Uint8Array(6));
  return [...n].map(v => ALFABETO[v % ALFABETO.length]).join('');
}
export const codigoValido = c => /^[A-Z0-9]{6}$/.test(c);

// ---------- ponte TURN ----------
export function lerPonte() {
  try { const p = JSON.parse(localStorage.getItem(CHAVE_PONTE) || 'null'); return p && Array.isArray(p.urls) ? p : null; } catch { return null; }
}
export function salvarPonte(p) {
  try { if (p) localStorage.setItem(CHAVE_PONTE, JSON.stringify(p)); else localStorage.removeItem(CHAVE_PONTE); } catch {}
}
function servidoresIce(ponte = lerPonte()) {
  const lista = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  if (ponte) lista.push({ urls: ponte.urls, username: ponte.usuario, credential: ponte.senha });
  return lista;
}
// Testa se a ponte responde: pede um "candidato relay" ao servidor TURN.
export async function testarPonte(ponte) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: ponte.urls, username: ponte.usuario, credential: ponte.senha }], iceTransportPolicy: 'relay' });
  pc.createDataChannel('teste');
  let achou = false;
  pc.onicecandidate = e => { if (e.candidate?.type === 'relay' || / relay /.test(e.candidate?.candidate || '')) achou = true; };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise(ok => {
    const fim = setTimeout(ok, 9000);
    const olhar = setInterval(() => { if (achou || pc.iceGatheringState === 'complete') { clearTimeout(fim); clearInterval(olhar); ok(); } }, 200);
  });
  pc.close();
  return achou;
}

// Nos testes automáticos dá para apontar para um servidor PeerJS local.
function opcoesPeer() {
  const o = { debug: 1, config: { iceServers: servidoresIce() } };
  try {
    const s = JSON.parse(localStorage.getItem('arcana-tab-servidor') || 'null');
    if (s && typeof s === 'object') for (const k of ['host', 'port', 'path', 'secure', 'key', 'config']) if (k in s) o[k] = s[k];
  } catch {}
  return o;
}

const espera = ms => new Promise(r => setTimeout(r, ms));
function filaDe(conn) {
  try { return (conn.dataChannel?.bufferedAmount || 0) + (conn.bufferSize || 0) * PEDACO * 1.4; } catch { return 0; }
}
function paraTexto(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return btoa(s);
}
function deTexto(t) {
  const s = atob(t), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
// Estado da "procura de caminho" (ICE) de uma conexão: checking, connected, failed…
function estadoIce(conn) { try { return conn.peerConnection?.iceConnectionState || ''; } catch { return ''; } }

// Envia um arquivo em pedaços. aoProgredir(fração) é chamado durante o envio.
export async function enviarArquivo(conn, hash, blob, extra, aoProgredir = () => {}) {
  const total = blob.size, n = Math.max(1, Math.ceil(total / PEDACO));
  conn.send({ t: 'arq-inicio', hash, total, n, tipo: blob.type, ...extra });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < n; i++) {
    while (filaDe(conn) > LIMITE_FILA) {
      if (!conn.open) throw new Error('conexão fechada');
      await espera(15);
    }
    if (!conn.open) throw new Error('conexão fechada');
    conn.send({ t: 'arq-pedaco', hash, i, d: paraTexto(bytes.subarray(i * PEDACO, (i + 1) * PEDACO)) });
    if (i % 64 === 0) aoProgredir(i / n);
  }
  conn.send({ t: 'arq-fim', hash });
  aoProgredir(1);
}

// Monta os arquivos que chegam em pedaços.
export function criarReceptor(aoCompletar, aoProgredir = () => {}) {
  const emCurso = new Map();
  return function receber(msg) {
    if (msg.t === 'arq-inicio') {
      if (!(msg.total > 0 && msg.total < 4e9 && msg.n > 0 && msg.n < 1e6)) return true;
      emCurso.set(msg.hash, { info: msg, partes: new Array(msg.n), recebidos: 0 });
      aoProgredir(msg.hash, 0, msg);
      return true;
    }
    if (msg.t === 'arq-pedaco') {
      const a = emCurso.get(msg.hash);
      if (!a || !(msg.i >= 0 && msg.i < a.partes.length) || a.partes[msg.i] || typeof msg.d !== 'string') return true;
      try { a.partes[msg.i] = deTexto(msg.d); } catch { return true; }
      a.recebidos++;
      if (a.recebidos % 64 === 0) aoProgredir(msg.hash, a.recebidos / a.partes.length, a.info);
      return true;
    }
    if (msg.t === 'arq-fim') {
      const a = emCurso.get(msg.hash);
      emCurso.delete(msg.hash);
      if (a && a.recebidos === a.partes.length) aoCompletar(msg.hash, new Blob(a.partes, { type: a.info.tipo }), a.info);
      return true;
    }
    return false;
  };
}

// ---------- mestre ----------
// eventos: aoAbrir(), aoErro(texto), aoEntrar(jogador), aoSair(jogador), aoMensagem(jogador, msg), aoFalha()
export function abrirSala(codigo, eventos) {
  const jogadores = new Map(); // peerId -> { conn, id, nome, celular, cor }
  let peer = null, fechada = false, tentativas = 0;

  function conectar() {
    if (fechada) return;
    peer = new window.Peer(PREFIXO + codigo, opcoesPeer());
    peer.on('open', () => { tentativas = 0; eventos.aoAbrir?.(); });
    peer.on('connection', conn => {
      // alguém tentou entrar: se a rede bloquear o caminho, avisa o mestre
      const vigia = setTimeout(() => { if (!conn.open) eventos.aoFalha?.(); }, ESPERA_CONEXAO);
      conn.on('open', () => clearTimeout(vigia));
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        let j = jogadores.get(conn.peer);
        if (j) j.ultimo = Date.now();
        if (msg.t === 'oi') return;
        if (msg.t === 'tchau') { if (j) sair(conn); return; }
        if (msg.t === 'ola') {
          j = {
            conn,
            id: String(msg.id || conn.peer).slice(0, 64),
            nome: String(msg.nome || 'Jogador').slice(0, 40),
            celular: !!msg.celular,
            cor: /^#[0-9a-f]{6}$/i.test(msg.cor) ? msg.cor : '#a4c29a',
            ultimo: Date.now(),
          };
          // a mesma pessoa reconectando: fecha a conexão antiga
          for (const [pid, outro] of jogadores) if (outro.id === j.id && pid !== conn.peer) { try { outro.conn.close(); } catch {} jogadores.delete(pid); }
          jogadores.set(conn.peer, j);
          eventos.aoEntrar?.(j);
          return;
        }
        if (j) eventos.aoMensagem?.(j, msg);
      });
      conn.on('close', () => { clearTimeout(vigia); sair(conn); });
      conn.on('error', () => {});
    });
    peer.on('disconnected', () => { if (!fechada) try { peer.reconnect(); } catch {} });
    peer.on('error', err => {
      const tipo = err?.type || '';
      if (tipo === 'unavailable-id') {
        // a sala antiga ainda está registrada (recarregou a página): tenta de novo
        eventos.aoErro?.('Reabrindo a sala…');
        try { peer.destroy(); } catch {}
        if (tentativas++ < 20) setTimeout(conectar, 3000);
        return;
      }
      if (tipo === 'network' || tipo === 'server-error' || tipo === 'socket-error' || tipo === 'socket-closed') {
        eventos.aoErro?.('Sem conexão com o servidor de salas. Tentando de novo…');
        try { peer.destroy(); } catch {}
        setTimeout(conectar, 4000);
        return;
      }
      if (tipo === 'browser-incompatible') eventos.aoErro?.('Este navegador não suporta a conexão da mesa.');
    });
  }
  // tira o jogador da sala (fechou a página, a conexão caiu ou ficou mudo)
  function sair(conn) {
    const j = jogadores.get(conn.peer);
    if (!j || j.conn !== conn) return;
    jogadores.delete(conn.peer);
    try { conn.close(); } catch {}
    eventos.aoSair?.(j);
  }
  const vigiaSilencio = setInterval(() => {
    if (fechada) { clearInterval(vigiaSilencio); return; }
    for (const j of [...jogadores.values()]) if (Date.now() - (j.ultimo || 0) > LIMITE_SILENCIO) sair(j.conn);
  }, 3000);
  conectar();

  return {
    jogadores,
    enviar(j, msg) { try { if (j.conn.open) j.conn.send(msg); } catch {} },
    paraTodos(msg, filtro = () => true) {
      for (const j of jogadores.values()) if (filtro(j)) try { if (j.conn.open) j.conn.send(msg); } catch {}
    },
    fechar() {
      fechada = true;
      for (const j of jogadores.values()) try { j.conn.send({ t: 'fim' }); } catch {}
      setTimeout(() => { try { peer?.destroy(); } catch {} }, 500);
    },
  };
}

// ---------- jogador ----------
// eventos: aoConectar(), aoStatus(texto), aoMensagem(msg), aoFim()
export function entrarNaSala(codigo, eu, eventos) {
  let peer = null, conn = null, saiu = false, timer = null, falhas = 0;
  // sinal de vida para o mestre; e um "tchau" quando a página fecha
  const oi = setInterval(() => { if (saiu) { clearInterval(oi); return; } try { if (conn?.open) conn.send({ t: 'oi' }); } catch {} }, INTERVALO_OI);
  addEventListener('pagehide', () => { try { if (conn?.open) conn.send({ t: 'tchau' }); } catch {} });

  function tentar() {
    if (saiu) return;
    clearTimeout(timer);
    try { peer?.destroy(); } catch {}
    eventos.aoStatus?.('Conectando ao servidor de salas…');
    const p = new window.Peer(opcoesPeer());
    peer = p;
    p.on('open', () => {
      if (peer !== p) return;
      eventos.aoStatus?.('Procurando o mestre…');
      const c = p.connect(PREFIXO + codigo, { reliable: true, serialization: 'json' });
      conn = c;
      // mostra em que etapa está a procura do caminho até o mestre
      const olhar = setInterval(() => {
        if (conn !== c || c.open) { clearInterval(olhar); return; }
        const e = estadoIce(c);
        if (e === 'checking') eventos.aoStatus?.('Achei a sala. Abrindo o caminho até o mestre…');
        if (e === 'failed') {
          clearInterval(olhar); falhas++;
          eventos.aoStatus?.('A internet bloqueou a conexão direta com o mestre. O mestre precisa ligar a ponte (Ajustes › Conexão). Tentando de novo…');
          agendar(6000);
        }
      }, 700);
      const desistir = setTimeout(() => {
        if (conn === c && !c.open) {
          clearInterval(olhar); falhas++;
          eventos.aoStatus?.(estadoIce(c) === 'checking' || estadoIce(c) === 'failed'
            ? 'A internet bloqueou a conexão direta com o mestre. O mestre precisa ligar a ponte (Ajustes › Conexão). Tentando de novo…'
            : 'O mestre não respondeu. A página dele está aberta com a sala? Tentando de novo…');
          agendar();
        }
      }, ESPERA_CONEXAO);
      c.on('open', () => {
        clearTimeout(desistir); clearInterval(olhar); falhas = 0;
        c.send({ t: 'ola', ...eu });
        eventos.aoConectar?.();
      });
      c.on('data', msg => {
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        if (msg.t === 'fim' || msg.t === 'expulso') { saiu = true; eventos.aoFim?.(msg.t === 'expulso' ? (msg.excluido ? 'excluido' : 'expulso') : 'fim'); try { p.destroy(); } catch {} return; }
        eventos.aoMensagem?.(msg);
      });
      c.on('close', () => { if (!saiu && conn === c) { eventos.aoStatus?.('Conexão com o mestre caiu. Reconectando…'); agendar(); } });
    });
    p.on('error', err => {
      if (saiu || peer !== p) return;
      if (err?.type === 'peer-unavailable') eventos.aoStatus?.('Sala não encontrada. Confira o código e se o mestre abriu a sala. Tentando de novo…');
      else eventos.aoStatus?.('Problema de conexão com o servidor de salas. Tentando de novo…');
      agendar();
    });
  }
  function agendar(ms = 3000) { clearTimeout(timer); timer = setTimeout(tentar, ms); }
  tentar();

  return {
    enviar(msg) { try { if (conn?.open) conn.send(msg); } catch {} },
    sair() { saiu = true; clearTimeout(timer); try { peer?.destroy(); } catch {} },
  };
}
