// mapas.js — importa mapas grandes, cria a versão leve para celular
// e corta o mapa em pedaços para desenhar imagens maiores que a placa de vídeo aguenta.
import { guardar, ler, hashDe } from './armazem.js?v=0.9';

const LADO_CELULAR = 4096;      // maior lado da versão enviada ao celular
const PIXELS_CELULAR = 16e6;    // e no máximo 16 milhões de pixels
const LADO_VISAO_GERAL = 2048;  // versão pequena usada quando o zoom está bem afastado

// Maior textura que a placa de vídeo deste aparelho desenha de uma vez.
export const LIMITE_TEXTURA = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  } catch { return 4096; }
})();
const LADO_PEDACO = Math.min(2048, LIMITE_TEXTURA);

function reduzir(largura, altura, ladoMax, pixelsMax) {
  let f = Math.min(1, ladoMax / Math.max(largura, altura));
  if (largura * altura * f * f > pixelsMax) f = Math.sqrt(pixelsMax / (largura * altura));
  return { w: Math.max(1, Math.round(largura * f)), h: Math.max(1, Math.round(altura * f)) };
}

function paraBlob(canvas, tipo, qualidade) {
  return new Promise(ok => canvas.toBlob(ok, tipo, qualidade));
}

async function bitmapReduzido(origem, w, h) {
  // createImageBitmap com resize é o jeito mais leve; se faltar, usa um canvas.
  try { return await createImageBitmap(origem, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); }
  catch {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(origem, 0, 0, w, h);
    return createImageBitmap(c);
  }
}

async function bitmapParaBlob(bmp) {
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return (await paraBlob(c, 'image/webp', 0.86)) || (await paraBlob(c, 'image/jpeg', 0.86));
}

// Guarda um arquivo no disco e devolve o hash dele.
export async function guardarArquivo(blob, w, h) {
  const hash = await hashDe(await blob.arrayBuffer());
  if (!(await ler('arquivos', hash))) await guardar('arquivos', hash, { blob, w, h, tipo: blob.type });
  return hash;
}

// Importa um mapa escolhido pelo mestre. Devolve { hash, leve, w, h }.
// "hash" é o original (qualidade máxima); "leve" é a versão para celular.
export async function importarMapa(arquivo, aoProgredir = () => {}) {
  if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type) && !/\.(png|jpe?g|webp)$/i.test(arquivo.name || '')) throw new Error('Use uma imagem JPG, PNG ou WebP.');
  aoProgredir('Abrindo a imagem…');
  let bmp;
  try { bmp = await createImageBitmap(arquivo); }
  catch { throw new Error('O navegador não conseguiu abrir esta imagem. Ela pode ser grande demais para a memória deste computador.'); }
  const w = bmp.width, h = bmp.height;
  aoProgredir('Guardando o original…');
  const hash = await guardarArquivo(arquivo, w, h);
  let leve = hash;
  const r = reduzir(w, h, LADO_CELULAR, PIXELS_CELULAR);
  if (r.w < w) {
    aoProgredir('Criando a versão para celular…');
    const pequeno = await bitmapReduzido(bmp, r.w, r.h);
    const blob = await bitmapParaBlob(pequeno);
    pequeno.close();
    leve = await guardarArquivo(blob, r.w, r.h);
  }
  bmp.close();
  return { hash, leve, w, h };
}

// Reduz um retrato para no máximo 256 pixels e devolve um texto (data URL).
export async function retratoPequeno(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  const lado = 256, f = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/webp', 0.85);
}

// Carrega um mapa guardado e corta em pedaços. Devolve { w, h, pedacos, geral }
// ou null se o arquivo não estiver no disco.
// "w" e "h" são o tamanho do mapa ORIGINAL, para que a grade fique no mesmo lugar
// tanto no original quanto na versão leve.
export async function carregarMapa(hash, larguraOriginal, alturaOriginal) {
  const reg = await ler('arquivos', hash);
  if (!reg) return null;
  let inteiro;
  try { inteiro = await createImageBitmap(reg.blob); }
  catch { throw new Error('Este computador não tem memória para abrir o mapa nesse tamanho.'); }
  const iw = inteiro.width, ih = inteiro.height;
  const escala = (larguraOriginal || iw) / iw;
  const pedacos = [];
  if (iw <= LIMITE_TEXTURA && ih <= LIMITE_TEXTURA && iw * ih <= 16e6) {
    pedacos.push({ x: 0, y: 0, w: iw, h: ih, img: inteiro });
  } else {
    for (let y = 0; y < ih; y += LADO_PEDACO) {
      for (let x = 0; x < iw; x += LADO_PEDACO) {
        const pw = Math.min(LADO_PEDACO, iw - x), ph = Math.min(LADO_PEDACO, ih - y);
        pedacos.push({ x, y, w: pw, h: ph, img: await createImageBitmap(inteiro, x, y, pw, ph) });
      }
    }
  }
  let geral = null;
  if (Math.max(iw, ih) > LADO_VISAO_GERAL * 1.5) {
    const r = reduzir(iw, ih, LADO_VISAO_GERAL, 4e6);
    geral = await bitmapReduzido(inteiro, r.w, r.h);
  }
  if (pedacos[0].img !== inteiro) inteiro.close();
  return { w: larguraOriginal || iw, h: alturaOriginal || ih, escala, iw, ih, pedacos, geral };
}

export function liberarMapa(m) {
  if (!m) return;
  for (const p of m.pedacos) try { p.img.close(); } catch {}
  try { m.geral?.close(); } catch {}
}
