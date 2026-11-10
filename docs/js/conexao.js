// conexao.js — liga o mestre aos jogadores (PeerJS / WebRTC), igual à Mesa online.
// A página do mestre funciona como "servidor": cada jogador conversa só com o mestre,
// e o mestre repassa o que todos precisam ver.
// Arquivos grandes (mapas) vão em pedaços de 16 KB, sem entupir a conexão.

const PREFIXO = 'arcana-tab-';
const PEDACO = 16000;
const LIMITE_FILA = 4 * 1024 * 1024; // espera a fila esvaziar antes de mandar mais
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function novoCodigo() {
  const n = crypto.getRandomValues(new Uint8Array(6));
  return [...n].map(v => ALFABETO[v % ALFABETO.length]).join('');
}
export const codigoValido = c => /^[A-Z0-9]{6}$/.test(c);

// Nos testes automáticos dá para apontar para um servidor PeerJS local.
function opcoesPeer() {
  const o = { debug: 1 };
  try {
    const s = JSON.parse(localStorage.getItem('arcana-tab-servidor') || 'null');
    if (s && typeof s === 'object') for (const k of ['host', 'port', 'path', 'secure', 'key', 'config']) if (k in s) o[k] = s[k];
  } catch {}
  return o;
}

const espera = ms => new Promise(r => setTimeout(r, ms));
function filaDe(conn) {
  try { return (conn.dataChannel?.bufferedAmount || 0) + (conn.bufferSize || 0) * PEDACO; } catch { return 0; }
}

// Envia um arquivo em pedaços. aoProgredir(fração) é chamado durante o envio.
export async function enviarArquivo(conn, hash, blob, extra, aoProgredir = () => {}) {
  const total = blob.size, n = Math.max(1, Math.ceil(total / PEDACO));
  conn.send({ t: 'arq-inicio', hash, total, n, tipo: blob.type, ...extra });
  const buffer = await blob.arrayBuffer();
  for (let i = 0; i < n; i++) {
    while (filaDe(conn) > LIMITE_FILA) {
      if (!conn.open) throw new Error('conexão fechada');
      await espera(15);
    }
    if (!conn.open) throw new Error('conexão fechada');
    conn.send({ t: 'arq-pedaco', hash, i, d: buffer.slice(i * PEDACO, (i + 1) * PEDACO) });
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
      if (!(msg.total > 0 && msg.total < 4e9 && msg.n > 0)) return true;
      emCurso.set(msg.hash, { info: msg, partes: new Array(msg.n), recebidos: 0 });
      aoProgredir(msg.hash, 0, msg);
      return true;
    }
    if (msg.t === 'arq-pedaco') {
      const a = emCurso.get(msg.hash);
      if (!a || !(msg.i >= 0 && msg.i < a.partes.length) || a.partes[msg.i]) return true;
      a.partes[msg.i] = msg.d; a.recebidos++;
      if (a.recebidos % 64 === 0) aoProgredir(msg.hash, a.recebidos / a.partes.length, a.info);
      return true;
    }
    if (msg.t === 'arq-fim') {
      const a = emCurso.get(msg.hash);
      emCurso.delete(msg.hash);
      if (a && a.recebidos === a.partes.length) {
        aoCompletar(msg.hash, new Blob(a.partes, { type: a.info.tipo }), a.info);
      }
      return true;
    }
    return false;
  };
}

// ---------- mestre ----------
// eventos: aoAbrir(), aoErro(texto), aoEntrar(jogador), aoSair(jogador), aoMensagem(jogador, msg)
export function abrirSala(codigo, eventos) {
  const jogadores = new Map(); // peerId -> { conn, id, nome, celular, cor }
  let peer = null, fechada = false, tentativas = 0;

  function conectar() {
    if (fechada) return;
    peer = new window.Peer(PREFIXO + codigo, opcoesPeer());
    peer.on('open', () => { tentativas = 0; eventos.aoAbrir?.(); });
    peer.on('connection', conn => {
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        let j = jogadores.get(conn.peer);
        if (msg.t === 'ola') {
          j = {
            conn,
            id: String(msg.id || conn.peer).slice(0, 64),
            nome: String(msg.nome || 'Jogador').slice(0, 40),
            celular: !!msg.celular,
            cor: /^#[0-9a-f]{6}$/i.test(msg.cor) ? msg.cor : '#a4c29a',
          };
          // a mesma pessoa reconectando: fecha a conexão antiga
          for (const [pid, outro] of jogadores) if (outro.id === j.id && pid !== conn.peer) { try { outro.conn.close(); } catch {} jogadores.delete(pid); }
          jogadores.set(conn.peer, j);
          eventos.aoEntrar?.(j);
          return;
        }
        if (j) eventos.aoMensagem?.(j, msg);
      });
      conn.on('close', () => { const j = jogadores.get(conn.peer); if (j && j.conn === conn) { jogadores.delete(conn.peer); eventos.aoSair?.(j); } });
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
      if (tipo === 'network' || tipo === 'server-error' || tipo === 'socket-error') {
        eventos.aoErro?.('Sem conexão com o servidor de salas. Tentando de novo…');
        try { peer.destroy(); } catch {}
        setTimeout(conectar, 4000);
        return;
      }
      if (tipo === 'browser-incompatible') eventos.aoErro?.('Este navegador não suporta a conexão da mesa.');
    });
  }
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
  let peer = null, conn = null, saiu = false, timer = null;

  function tentar() {
    if (saiu) return;
    clearTimeout(timer);
    try { peer?.destroy(); } catch {}
    eventos.aoStatus?.('Conectando…');
    peer = new window.Peer(opcoesPeer());
    peer.on('open', () => {
      conn = peer.connect(PREFIXO + codigo, { reliable: true });
      const desistir = setTimeout(() => { if (!conn.open) { eventos.aoStatus?.('O mestre não respondeu. Tentando de novo…'); agendar(); } }, 10000);
      conn.on('open', () => {
        clearTimeout(desistir);
        conn.send({ t: 'ola', ...eu });
        eventos.aoConectar?.();
      });
      conn.on('data', msg => {
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        if (msg.t === 'fim') { saiu = true; eventos.aoFim?.(); try { peer.destroy(); } catch {} return; }
        eventos.aoMensagem?.(msg);
      });
      conn.on('close', () => { if (!saiu) { eventos.aoStatus?.('Conexão com o mestre caiu. Reconectando…'); agendar(); } });
    });
    peer.on('error', err => {
      if (saiu) return;
      if (err?.type === 'peer-unavailable') eventos.aoStatus?.('Sala não encontrada. O mestre está com a página aberta? Tentando de novo…');
      else eventos.aoStatus?.('Problema de conexão. Tentando de novo…');
      agendar();
    });
  }
  function agendar() { clearTimeout(timer); timer = setTimeout(tentar, 3000); }
  tentar();

  return {
    enviar(msg) { try { if (conn?.open) conn.send(msg); } catch {} },
    sair() { saiu = true; clearTimeout(timer); try { peer?.destroy(); } catch {} },
  };
}
