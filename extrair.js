// Extrai do PDF o texto de uma questão (enunciado, comentário e gabarito) para mandar à IA.
// Tira cabeçalho, rodapé e a marca d'água com dados pessoais (linha "CPF - Nome", códigos ==n==).
// Funções puras sobre um documento do pdf.js: usadas pelo app e pelos testes.

const CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
const CPF_NOME = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*-\s*([^\n]+)/;
const COD = /==\s*\d+\s*==/;

async function itens(doc, p, cache) {
  if (!cache.has(p)) cache.set(p, (async () => {
    const pg = await doc.getPage(p); const H = pg.getViewport({ scale: 1 }).height; const tc = await pg.getTextContent();
    return tc.items.filter(o => 'str' in o).map(o => ({ s: o.str, t: o.str.trim(), y: Math.round(o.transform[5]), eol: o.hasEOL, H }));
  })());
  return cache.get(p);
}

// texto da página sem o que se repete na mesma altura nas páginas vizinhas (professor, aula, curso, site, marca d'água),
// sem número de página solto no rodapé e sem nada que pareça CPF; devolve também os nomes da marca d'água achados
export async function textoPagina(doc, p, cache = new Map()) {
  const its = await itens(doc, p, cache); const viz = new Set(); const nomes = new Set();
  for (const q of [p - 1, p + 1]) if (q >= 1 && q <= doc.numPages) for (const o of await itens(doc, q, cache)) if (o.t) viz.add(o.y + '|' + o.t);
  let out = '';
  for (const o of its) {
    const m = CPF_NOME.exec(o.t); if (m) nomes.add(m[1].trim());
    const rodape = o.y < o.H * 0.1 || o.y > o.H * 0.93, numeracao = /^0*\d{1,3}\s*[.)]?$/.test(o.t);
    // o "1." da questão também se repete na mesma altura em páginas vizinhas: repetido só sai se não for numeração (ou se estiver no rodapé)
    const fora = o.t && ((viz.has(o.y + '|' + o.t) && (!numeracao || rodape)) || (rodape && /^\d{1,4}$/.test(o.t)) || /estrategiaconcursos\.com\.br/i.test(o.t) || CPF.test(o.t) || COD.test(o.t));
    if (!fora) out += o.s;
    if (o.eol) out += '\n';
  }
  return { texto: out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n'), nomes };
}

const ini = q => new RegExp(`(?:^|\\n)[ \\t]*0*${q}[ \\t]*[.)](?:[ \\t]|\\n)`);
const NUMERADA = /(?:^|\n)[ \t]*0*\d{1,3}[ \t]*[.)](?:[ \t]|\n)[ \t]*\(/;
// questão sem número no texto (numeração automática do Word vira desenho): começa com a banca entre parênteses, ex. (FGV/ALESC/2024)
const BANCA = /(?:^|\n)[ \t]*\([^)\n]{2,120}\d{4}[^)\n]{0,40}\)/g;
// fim da questão: a próxima questão ou o cabeçalho de outro bloco ("GABARITO" sozinho na linha, não "Gabarito: C")
const FIM = /\n[ \t]*(?:GABARITO[ \t]*(?:\n|$)|LISTA DE QUEST|QUESTÕES COMENTADAS)/;
const BLOCO = /(?:^|\n)[ \t]*(?:GABARITO[ \t]*(?:\n|$)|LISTA DE QUEST|QUESTÕES COMENTADAS)/;

// procura a questão q a partir da página p0 (até maxPag páginas adiante) e devolve { pag, texto, nomes }
// a busca não atravessa para outro bloco (outra lista, gabarito), onde a numeração recomeça
export async function acharQuestao(doc, p0, q, { maxPag = 80, cache = new Map() } = {}) {
  let txt = '', pIni = null; const nomes = new Set();
  for (let p = Math.max(1, p0); p <= Math.min(doc.numPages, p0 + maxPag); p++) {
    const r = await textoPagina(doc, p, cache); r.nomes.forEach(n => nomes.add(n));
    if (pIni == null) {
      const m = ini(q).exec(r.texto), b = p > p0 ? BLOCO.exec(r.texto) : null;
      if (b && (!m || b.index < m.index)) return porContagem(doc, p0, q, maxPag, cache);
      if (!m) continue; pIni = p; txt = r.texto.slice(m.index).replace(/^\n/, '');
    }
    else txt += '\n' + r.texto;
    const corpo = txt.slice(1); const fins = [ini(q + 1).exec(corpo), FIM.exec(corpo)].filter(Boolean);
    if (fins.length) return { pag: pIni, texto: txt.slice(0, 1 + Math.min(...fins.map(f => f.index))).trim(), nomes };
    if (p - pIni >= 4) break;
  }
  return pIni ? { pag: pIni, texto: txt.trim(), nomes } : porContagem(doc, p0, q, maxPag, cache);
}

// plano B: o bloco não tem nenhuma questão numerada no texto; conta as questões pela banca e pega a q-ésima
async function porContagem(doc, p0, q, maxPag, cache) {
  const pags = []; const nomes = new Set();
  for (let p = Math.max(1, p0); p <= Math.min(doc.numPages, p0 + maxPag); p++) {
    const r = await textoPagina(doc, p, cache); r.nomes.forEach(n => nomes.add(n)); let t = r.texto;
    if (p > p0) { const b = BLOCO.exec(t); if (b) { t = t.slice(0, b.index); pags.push({ p, t }); break; } }
    else {
      // na primeira página: começa no cabeçalho do bloco e para no próximo cabeçalho, se houver
      const b = BLOCO.exec(t); if (b) t = t.slice(b.index).replace(/^\n/, '');
      const nl = t.indexOf('\n'); const fim = nl < 0 ? null : BLOCO.exec(t.slice(nl)); if (fim) t = t.slice(0, nl + fim.index);
    }
    pags.push({ p, t });
  }
  let todo = '', marcas = [];
  for (const { p, t } of pags) { marcas.push([todo.length, p]); todo += t + '\n'; }
  if (NUMERADA.test(todo)) return null;   // o bloco é numerado e a questão não está nele: não arrisca
  const ini = [...todo.matchAll(BANCA)].map(m => m.index);
  if (q < 1 || q > ini.length) return null;
  const a = ini[q - 1], b = ini[q] ?? todo.length, pag = marcas.filter(([i]) => i <= a).pop()?.[1] ?? p0;
  return { pag, texto: todo.slice(a, b).replace(/^\n/, '').trim(), nomes, aprox: true };
}

// comentário da questão: procura pelo conteúdo do enunciado a partir da página c, porque listas de bancas
// diferentes podem apontar para o mesmo início de comentários e a numeração recomeça a cada banca
const INICIO = /(?:^|\n)[ \t]*(?:0*\d{1,3}[ \t]*[.)](?:[ \t]|\n)|\([^)\n]{2,120}\d{4}[^)\n]{0,40}\))/g;
function normalizar(t) {
  let n = ''; const pos = [];
  for (let i = 0; i < t.length; i++) { const c = t[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); if (/[a-z0-9]/.test(c)) { n += c; pos.push(i); } }
  return { n, pos };
}
// trecho do enunciado que identifica a questão: pula o começo (o cabeçalho da banca muda de formato entre lista e comentário)
function assinatura(enun) { const { n } = normalizar(enun.slice(0, 600)); return n.length >= 110 ? n.slice(60, 110) : n.length >= 40 ? n.slice(-40) : null; }
export async function acharComentario(doc, c, q, enun, { maxPag = 120, cache = new Map() } = {}) {
  const sig = assinatura(enun || '');
  if (sig) {
    let todo = '', N = ''; const P = [], marcas = [], nomes = new Set();
    for (let p = Math.max(1, c); p <= Math.min(doc.numPages, c + maxPag); p++) {
      const r = await textoPagina(doc, p, cache); r.nomes.forEach(x => nomes.add(x)); marcas.push([todo.length, p]);
      const base = todo.length, z = normalizar(r.texto + '\n'); todo += r.texto + '\n'; N += z.n; for (const i of z.pos) P.push(base + i);
      const k = N.indexOf(sig, Math.max(0, N.length - z.n.length - sig.length)); if (k < 0) continue;
      const o = P[k]; let a = 0;
      for (const m of todo.matchAll(INICIO)) { if (m.index < o) a = m.index; else break; }
      // espera ter texto suficiente depois do achado para pegar comentário e gabarito
      for (let extra = 1; extra <= 4 && p + extra <= doc.numPages; extra++) { const r2 = await textoPagina(doc, p + extra, cache); r2.nomes.forEach(x => nomes.add(x)); marcas.push([todo.length, p + extra]); todo += r2.texto + '\n'; }
      const resto = todo.slice(o); const g = /gabarito/i.exec(resto); const de = g ? o + g.index : o;
      let b = todo.length; for (const m of todo.slice(de).matchAll(INICIO)) { b = de + m.index; break; }
      const f = FIM.exec(todo.slice(o)); if (f && o + f.index < b) b = o + f.index;
      return { pag: marcas.filter(([i]) => i <= a).pop()?.[1] ?? c, texto: todo.slice(a, b).replace(/^\n/, '').trim().slice(0, 8000), nomes };
    }
  }
  // sem assinatura (enunciado curto demais) vai pelo número; com assinatura e sem achado, é melhor nenhum comentário que o de outra questão
  if (sig) return null;
  const r = await acharQuestao(doc, c, q, { cache }); return r && { ...r, incerto: true };
}

// última barreira antes de qualquer envio: tira os nomes da marca d'água e qualquer coisa com formato de CPF
export function limpar(texto, nomes = []) {
  let t = String(texto || '');
  for (const n of nomes) if (n && n.length > 3) t = t.split(n).join('');
  t = t.replace(new RegExp(CPF.source, 'g'), '').replace(new RegExp(COD.source, 'g'), '').replace(/\n{2,}/g, '\n').trim();
  // sobra do título do bloco seguinte no fim (ex.: "– TIPOS DE REDES - FGV")
  return t.replace(/\n[ \t]*[–-][ \t]*[A-ZÀ-Ú0-9][A-ZÀ-Ú0-9 ()\/–-]{4,}$/, '').trim().slice(0, 8000);
}
