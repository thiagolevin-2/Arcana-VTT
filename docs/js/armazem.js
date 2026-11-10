// armazem.js — guarda dados no IndexedDB do navegador.
// O localStorage só aceita uns 5 MB; o IndexedDB usa o disco do computador,
// então cabem mapas enormes. Duas "gavetas":
//   arquivos: imagens (mapas e retratos), cada uma pela sua "impressão digital" (hash)
//   dados:    o estado do mestre (cenas, tokens) e outras configurações

const NOME = 'arcana-tabuleiro';
let bancoPromessa = null;

function abrir() {
  if (!bancoPromessa) {
    bancoPromessa = new Promise((ok, erro) => {
      const pedido = indexedDB.open(NOME, 1);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos');
        if (!db.objectStoreNames.contains('dados')) db.createObjectStore('dados');
      };
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => erro(pedido.error);
    });
  }
  return bancoPromessa;
}

async function operar(gaveta, modo, fazer) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const tx = db.transaction(gaveta, modo);
    const loja = tx.objectStore(gaveta);
    const pedido = fazer(loja);
    tx.oncomplete = () => ok(pedido ? pedido.result : undefined);
    tx.onerror = () => erro(tx.error);
    tx.onabort = () => erro(tx.error || new Error('Gravação cancelada (disco cheio?)'));
  });
}

export const guardar = (gaveta, chave, valor) => operar(gaveta, 'readwrite', l => l.put(valor, chave));
export const ler = (gaveta, chave) => operar(gaveta, 'readonly', l => l.get(chave));
export const apagar = (gaveta, chave) => operar(gaveta, 'readwrite', l => l.delete(chave));
export const chaves = gaveta => operar(gaveta, 'readonly', l => l.getAllKeys());

// Pede ao navegador para não apagar os dados sozinho quando o disco enche.
export async function pedirPersistencia() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}

// Quanto espaço está em uso e quanto o navegador libera para o site.
export async function espaco() {
  try {
    const e = await navigator.storage.estimate();
    return { usado: e.usage || 0, total: e.quota || 0 };
  } catch { return null; }
}

export function tamanhoLegivel(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB';
  if (bytes >= 1e6) return Math.round(bytes / 1e6) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

// "Impressão digital" de um arquivo: dois arquivos iguais têm o mesmo hash.
// Assim o jogador sabe se já tem o mapa guardado sem precisar baixar de novo.
export async function hashDe(buffer) {
  const h = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
