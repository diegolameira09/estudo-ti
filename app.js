import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

/* ---------------- utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const W = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const br = s => { if (!s) return ''; const d = parseISO(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const brShort = s => { const d = parseISO(s); return `${W[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; };
const todayISO = () => iso(new Date());
const digits = s => (String(s ?? '').match(/\d+/) || [''])[0];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const TIPOS = ['Conteúdo', 'Interpretação', 'Atenção', 'Memória', 'Chute', 'Cálculo'];
const ORDEM = ['REDES', 'DEV', 'ARQ', 'BD', 'GOV', 'LP', 'ADM', 'RLM', 'CONST'];
document.getElementById('dlgForm').addEventListener('submit', e => e.preventDefault());
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }

/* ---------------- IndexedDB ---------------- */
let dbp;
function db() {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('estudo-ti', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('pdfs'); d.createObjectStore('erros', { keyPath: 'id', autoIncrement: true }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abortado'));
  });
}
const kvGet = k => run('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => run('kv', 'readwrite', s => s.put(v, k));
const errAll = () => run('erros', 'readonly', s => s.getAll());
const errPut = e => { scheduleSync(); return run('erros', 'readwrite', s => s.put(e)); };
const errDel = id => { scheduleSync(); return run('erros', 'readwrite', s => s.delete(id)); };
const pdfPut = (k, b) => run('pdfs', 'readwrite', s => s.put(b, k));
const pdfGet = k => run('pdfs', 'readonly', s => s.get(k));
const pdfKeys = () => run('pdfs', 'readonly', s => s.getAllKeys());

/* ---------------- estado ---------------- */
const S = { C: null, pv: {}, del: {}, prog: {}, set: { dias: [1, 3, 5], durs: [20, 5, 20, 3] }, erros: [], pdfs: new Set(), tab: 'sessao', viewN: null, lastBackup: null, filtro: { mat: '', st: 'todos' } };
const sess = n => S.C.sessoes[n - 1];
const aula = k => S.C.aulas[k];
const MAT = k => (k === 'REV' ? 'Revisão' : S.C.materias[k]);
const total = () => S.C.sessoes.length;
const curN = () => { for (const s of S.C.sessoes) if (!S.prog[s.n]?.done) return s.n; return null; };
const doneCount = () => Object.values(S.prog).filter(p => p.done).length;
const saveProg = () => { scheduleSync(); return kvSet('prog', S.prog); };
const newUid = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
const legacyUid = e => `m${e.criado || 0}-${e.sessao}-${e.pagina}-${digits(e.questao)}`;
const ets = e => e.upd || e.criado || 0;
const fileHash = async blob => { const b = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join(''); };
const outdated = A => !!(A && S.pdfs.has(A.file) && A.ver && S.pv[A.file] && S.pv[A.file] !== A.ver);
const errOld = e => { const A = aula(e.aula); return !!(A?.ver && e.aver && e.aver !== A.ver); };
// a última sessão de revisão (478) não é múltipla de 5: rev1 e rev2 param nela, senão os erros do fim nunca voltam
const lastRev = () => (lastRev.n ??= S.C.sessoes.findLast(s => s.k === 'R')?.n ?? total());
const rev1 = n => Math.min(n % 5 === 0 ? n + 5 : Math.ceil(n / 5) * 5, lastRev());
const rev2 = n => Math.min(rev1(n) + 15, lastRev());
function status(e) {
  if (!e.r1) return 'Pendente';
  if (e.r1 === 'Acertei' && (e.r2 === 'Acertei' || rev1(e.sessao) === rev2(e.sessao))) return 'Dominado';
  if (e.r1 === 'Errei' || e.r2 === 'Errei') return 'Refazer';
  return 'Em revisão';
}

/* ---------------- projeção de datas ---------------- */
const SKIP = new Set(['12-24', '12-25', '12-31', '01-01']);
const isStudyDay = d => S.set.dias.includes(d.getDay()) && !SKIP.has(`${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
function projections() {
  const out = {}; const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!S.set.dias.length) S.set.dias = [1, 3, 5];
  const t = todayISO();
  if (Object.values(S.prog).some(p => p.done && p.date === t) || !isStudyDay(d)) d.setDate(d.getDate() + 1);
  for (const s of S.C.sessoes) {
    const p = S.prog[s.n];
    if (p?.done) { out[s.n] = p.date; continue; }
    while (!isStudyDay(d)) d.setDate(d.getDate() + 1);
    out[s.n] = iso(d); d.setDate(d.getDate() + 1);
  }
  return out;
}

/* ---------------- textos dos itens ---------------- */
function qtxt(q) {
  if (!q || !q.length) return '';
  const [a, b, st] = q;
  if (a === b) return `questão ${a}`;
  if (st === 2) return `${a % 2 ? 'ímpares' : 'pares'} ${a} a ${b}`;
  return `questões ${a} a ${b}`;
}
function itemText(it) {
  if (it.t === 'T') return it.p[0] === it.p[1] ? `Teoria p. ${it.p[0]}` : `Teoria p. ${it.p[0]} a ${it.p[1]}`;
  const ti = it.ti ? ` «${esc(it.ti)}»` : '';
  if (it.t === 'L') return `Lista${ti} p. ${it.s}: <b>${qtxt(it.q)}</b>`;
  return `Comentadas${ti} p. ${it.s}: <b>${qtxt(it.q)}</b> <span class="mut">(tampe o comentário)</span>`;
}
function itemJumps(it) {
  if (it.t === 'T') return [[`Teoria p. ${it.p[0]}`, it.p[0]]];
  const j = [[`${it.t === 'L' ? 'Lista' : 'Comentadas'} p. ${it.s}`, it.s]];
  if (it.g) j.push([`Gabarito p. ${it.g}`, it.g]);
  if (it.c) j.push([`Comentários p. ${it.c}`, it.c]);
  return j;
}
const matTag = k => `<span class="mat" style="background:var(--${k})">${esc(MAT(k))}</span>`;

/* ---------------- grade de questões: ✓ acertei, ✗ errei, ? chutei ---------------- */
// marcas em S.prog[n].qm[chave][questão]; chave = índice do item ('3') ou da questão inédita da revisão ('e3')
// ✗ e ? lançam um erro com uid fixo q-<sessão>-<chave>-<questão>, que volta nas revisões como qualquer erro
const QM = ['', 'o', 'x', 'c'], QNOME = { '': 'sem marca', o: 'acertei', x: 'errei', c: 'chutei' };
function qNums(q) { const out = []; if (!q?.length) return out; for (let k = q[0]; k <= q[1]; k += q[2] || 1) out.push(k); return out; }
const qItem = (n, key) => (key[0] === 'e' ? sess(n).ev?.[+key.slice(1)] : sess(n).it?.[+key]);
const qUid = (n, key, q) => `q-${n}-${key}-${q}`;
function qGrid(n, key, it) {
  const ns = qNums(it.q); if (!ns.length) return '';
  const m = S.prog[n]?.qm?.[key] || {}; const ok = ns.filter(q => m[q] === 'o').length, er = ns.filter(q => m[q] === 'x' || m[q] === 'c').length;
  return `<div class="qw" data-qn="${n}" data-qk="${key}"><div class="qg">${ns.map(q => `<button type="button" class="qb ${m[q] || ''}" data-q="${q}" aria-label="Questão ${q}: ${QNOME[m[q] || '']}">${q}</button>`).join('')}</div>
    ${ok + er ? `<div class="small mut">${ok} certa(s) · ${er} errada(s) ou chutada(s) · ${ns.length - ok - er} sem marca</div>` : ''}</div>`;
}
async function qErro(n, key, q, st) {
  const uid = qUid(n, key, q), e = S.erros.find(x => x.uid === uid), it = qItem(n, key);
  if (st === 'x' || st === 'c') {
    const tipo = st === 'c' ? 'Chute' : e?.tipo === 'Chute' ? '' : e?.tipo || '';
    if (e) { if (e.tipo !== tipo) { e.tipo = tipo; e.upd = Date.now(); await errPut(e); } return; }
    const ne = { data: todayISO(), sessao: n, aula: it.a, pagina: String(it.s), questao: String(q), minha: '', gab: '', tipo, porque: '', assunto: '', banca: '', regra: '', alerta: '', r1: '', r2: '',
      criado: Date.now(), upd: Date.now(), exp: false, uid, aver: aula(it.a)?.ver, auto: 1 };
    ne.id = await errPut(ne); S.erros.push(ne);
  } else if (e) { await errDel(e.id); S.del[uid] = Date.now(); await kvSet('del', S.del); S.erros = S.erros.filter(x => x !== e); }
}
async function onQGrid(b) {
  const w = b.closest('.qw'), n = +w.dataset.qn, key = w.dataset.qk, q = +b.dataset.q, it = qItem(n, key);
  const pp = (S.prog[n] ??= {}), m = ((pp.qm ??= {})[key] ??= {});
  const nx = QM[(QM.indexOf(m[q] || '') + 1) % QM.length];
  const e = S.erros.find(x => x.uid === qUid(n, key, q));
  if (!nx && e && (e.porque || e.regra || e.minha || e.gab) && !confirm(`Desmarcar a questão ${q}? O erro dela, com o que você já preencheu, será apagado.`)) return;
  if (nx) m[q] = nx; else delete m[q];
  // lista toda marcada: marca o item como feito
  if (key[0] !== 'e' && qNums(it.q).every(k => m[k])) (pp.items ??= [])[+key] = true;
  pp.upd = Date.now(); await saveProg(); await qErro(n, key, q, nx);
  $$(`.qw[data-qn="${n}"][data-qk="${key}"]`).forEach(x => (x.outerHTML = qGrid(n, key, it)));
  const cb = $(`#view input[data-item="${key}"]`); if (cb && pp.items?.[+key]) { cb.checked = true; cb.closest('.item').classList.add('done'); }
}
// apagar no formulário um erro vindo da grade também tira a marca da questão
async function qDesmarca(uid) {
  const [, n, key, q] = String(uid).split('-'); const m = S.prog[n]?.qm?.[key];
  if (!uid.startsWith('q-') || !m?.[q]) return;
  delete m[q]; S.prog[n].upd = Date.now(); await saveProg();
}

/* ---------------- timer 20/5/20/3 ---------------- */
const PH = ['Bloco A', 'Pausa', 'Bloco B', 'Fechamento'];
let T = null; let ac = null; let wl = null;
function tLoad() { try { T = JSON.parse(localStorage.getItem('timer') || 'null'); } catch { T = null; } if (!T) tReset(false); }
function tSave() { try { localStorage.setItem('timer', JSON.stringify(T)); } catch {} }
const tLeft = () => (T.run ? Math.max(0, Math.round((T.endsAt - Date.now()) / 1000)) : T.left);
function tReset(save = true) { T = { ph: 0, left: S.set.durs[0] * 60, run: false, endsAt: 0 }; if (save) tSave(); wlOff(); }
async function wlOn() { try { wl = await navigator.wakeLock?.request('screen'); } catch {} }
function wlOff() { try { wl?.release(); } catch {} wl = null; }
function tStart() {
  try { ac ??= new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch {}
  if (tLeft() === 0) tNext(false);
  T.endsAt = Date.now() + tLeft() * 1000; T.run = true; tSave(); wlOn(); tPaint();
}
function tPause() { T.left = tLeft(); T.run = false; tSave(); wlOff(); tPaint(); }
function tNext(paint = true) { T.ph = (T.ph + 1) % 4; T.left = S.set.durs[T.ph] * 60; if (T.run) T.endsAt = Date.now() + T.left * 1000; tSave(); if (paint) tPaint(); }
function alarm() {
  navigator.vibrate?.([400, 200, 400, 200, 400]);
  try {
    ac ??= new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.4, 0.8].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      const s = ac.currentTime + t; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3); o.start(s); o.stop(s + 0.32);
    });
  } catch {}
}
function tPaint() {
  const el = $('#timer'); if (!el) return;
  const left = tLeft(), dur = S.set.durs[T.ph] * 60;
  $('.tclock', el).textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
  $('.tphase', el).textContent = `${PH[T.ph]} · ${S.set.durs[T.ph]} min${T.ph === 3 ? ': explique o tópico sem consultar' : ''}`;
  $('.tbar>i', el).style.width = `${100 - (left / dur) * 100}%`;
  $('#tGo', el).textContent = T.run ? 'Pausar' : 'Iniciar';
}
setInterval(() => {
  if (!T?.run) return;
  if (tLeft() === 0) {
    alarm();
    if (T.ph < 3) { T.left = 0; tNext(false); } else { T.run = false; T.left = 0; tSave(); wlOff(); toast('Sessão no tempo. Conclua quando terminar o fechamento.'); }
  }
  tPaint();
}, 500);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (T?.run) wlOn(); tPaint(); } });

/* ---------------- render: topo e abas ---------------- */
function paintTop() {
  $('#syncBtn')?.classList.toggle('warn', !!(syncDir && S.syncOff));
  const d = doneCount(), pr = projections(), n = curN();
  const fim = pr[total()];
  $('#topProg').textContent = n ? `${d}/${total()} · fim ${br(fim).slice(0, 6)}${br(fim).slice(8)}` : `${d}/${total()} concluídas`;
}
function setTab(t) { S.tab = t; $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); window.scrollTo(0, 0); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { if (b.dataset.tab === 'sessao') S.viewN = null; setTab(b.dataset.tab); } });
let diaRender = null;
function render() {
  diaRender = todayISO(); paintTop();
  ({ sessao: renderSessao, erros: renderErros, crono: renderCrono, mais: renderMais })[S.tab]();
}

/* ---------------- render: sessão ---------------- */
function banners() {
  let h = '';
  const od = Object.values(S.C.aulas).filter(outdated).length;
  if (od) h += `<div class="banner warn">${od} PDF(s) importado(s) em versão diferente da do cronograma. Reimporte em <b>Mais › PDFs</b>.</div>`;
  if (syncDir && S.syncOff) h += `<div class="banner warn">Sincronização pausada: toque em ⇅ no topo para reconectar a pasta.</div>`;
  if (!S.pdfs.size) h += `<div class="banner">Importe os PDFs em <b>Mais › PDFs</b> para abrir as páginas direto no app.</div>`;
  const dias = S.lastBackup ? (Date.now() - new Date(S.lastBackup).getTime()) / 864e5 : Infinity;
  if (S.erros.length && dias > 7) h += `<div class="banner warn">Backup ${S.lastBackup ? 'há ' + Math.floor(dias) + ' dias' : 'nunca feito'}. Vá em <b>Mais › Backup</b>.</div>`;
  return h;
}
function renderSessao() {
  const v = $('#view'); const cn = curN(); const n = S.viewN ?? cn;
  if (n == null) { v.innerHTML = `<div class="card"><h2>Cronograma concluído</h2><p>${total()} sessões feitas. Hora de focar no edital.</p></div>`; return; }
  const s = sess(n), p = S.prog[n] || {}, pr = projections();
  let h = banners();
  h += `<div class="card"><div class="row"><button class="ib" data-nav="-1" aria-label="Sessão anterior" ${n <= 1 ? 'disabled' : ''}>‹</button>
    <div class="sp"><div class="small mut">Sessão ${n} de ${total()} · ${p.done ? 'feita em ' + br(p.date) : 'prevista ' + brShort(pr[n])}</div>
    <h2>${matTag(s.m)}</h2></div>
    <button class="ib" data-nav="1" aria-label="Próxima sessão" ${n >= total() ? 'disabled' : ''}>›</button></div>
    ${n !== cn && cn ? `<button class="chip" data-goto="${cn}">Voltar para a sessão atual (${cn})</button>` : ''}</div>`;
  h += `<div class="card" id="timer"><div class="timer"><div class="sp"><div class="tclock">00:00</div><div class="tphase"></div></div>
    <button class="btn pri" id="tGo">Iniciar</button><button class="btn" id="tSkip" aria-label="Próxima fase">»</button><button class="btn" id="tRst" aria-label="Zerar">↺</button></div>
    <div class="tbar"><i></i></div></div>`;
  h += s.k === 'C' ? contentCard(s, p) : revCard(s);
  h += `<div class="card"><label for="fech">Fechamento: explique o tópico em 3 linhas, sem consultar</label>
    <textarea id="fech" placeholder="O que eu aprendi hoje...">${esc(p.fech || '')}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="addErr">+ Lançar erro</button><span class="sp"></span>
    ${p.done ? `<button class="btn" id="undo">Desfazer conclusão</button>` : `<button class="btn pri" id="concl">Concluir sessão</button>`}</div></div>`;
  v.innerHTML = h; tPaint();
  v.onclick = onSessaoClick;
  $('#fech').oninput = e => { const pp = (S.prog[n] ??= {}); pp.fech = e.target.value; pp.upd = Date.now(); clearTimeout(renderSessao.t); renderSessao.t = setTimeout(saveProg, 500); };
  v.onchange = e => {
    const cb = e.target.closest('input[data-item]'); if (!cb) return;
    const pp = (S.prog[n] ??= {}); (pp.items ??= [])[+cb.dataset.item] = cb.checked; pp.upd = Date.now(); saveProg();
    cb.closest('.item').classList.toggle('done', cb.checked);
  };
}
function contentCard(s, p) {
  let h = `<div class="card"><h3>O que fazer</h3>`; let cur = null;
  s.it.forEach((it, i) => {
    if (it.a !== cur) {
      cur = it.a; const A = aula(it.a);
      h += `<div class="aulah">${esc(A.lab)} · ${A.v === 'C' ? 'Completo' : 'Simplificado'}</div>`;
      if (!S.pdfs.has(A.file)) h += `<div class="small warn">PDF não importado: ${esc(A.file)}</div>`;
      else if (outdated(A)) h += `<div class="small warn">PDF desatualizado: o cronograma usa uma versão nova deste arquivo. Reimporte em Mais › PDFs.</div>`;
    }
    const done = !!p.items?.[i];
    h += `<div class="item ${done ? 'done' : ''}"><input type="checkbox" data-item="${i}" ${done ? 'checked' : ''} aria-label="Feito">
      <div><div class="txt">${itemText(it)}</div><div class="acts">${itemJumps(it).map(([lab, pg]) => `<button class="chip" data-open="${it.a}" data-page="${pg}" data-i="${i}">${esc(lab)}</button>`).join('')}</div>
      ${it.t !== 'T' ? qGrid(s.n, String(i), it) : ''}</div></div>`;
  });
  return h + (s.it.some(it => it.t !== 'T') ? `<div class="small mut" style="margin-top:8px">Questões: toque uma vez para ✓ acertei, duas para ✗ errei, três para ? chutei. Errada e chutada viram erro e voltam nas revisões.</div>` : '') + `</div>`;
}
function errLine(e) {
  const A = aula(e.aula);
  return `S${e.sessao} · ${esc(A ? MAT(A.sj) : '')} · ${esc(A?.lab || '')} · p. ${esc(e.pagina)} · ${esc(e.questao)}${errOld(e) ? ' · <span class="warn">versão antiga do PDF</span>' : ''}`;
}
function revList(list, key, titulo) {
  if (!list.length) return `<div class="small mut">${titulo}: nenhum erro lançado.</div>`;
  return `<div class="aulah">${titulo} (${list.length})</div>` + list.map(e => `<div class="item"><span></span><div>
    <div class="txt small">${errLine(e)}</div><div class="small mut">${esc(e.assunto || e.porque || '')}</div>
    <div class="acts"><button class="chip" data-open="${esc(e.aula)}" data-page="${esc(e.pagina)}">Abrir p. ${esc(e.pagina)}</button>
    <button class="chip ${e[key] === 'Acertei' ? 'on' : ''}" data-res="${e.id}" data-k="${key}" data-v="Acertei">Acertei</button>
    <button class="chip ${e[key] === 'Errei' ? 'on' : ''}" data-res="${e.id}" data-k="${key}" data-v="Errei">Errei</button></div></div></div>`).join('');
}
function revCard(s) {
  const l1 = S.erros.filter(e => rev1(e.sessao) === s.n), l2 = S.erros.filter(e => rev2(e.sessao) === s.n && rev1(e.sessao) !== s.n);
  let h = `<div class="card"><h3>Revisão</h3><div class="small mut">Refaça no PDF sem olhar a resposta. Erros das sessões ${s.de} a ${s.ate} e, na 2ª passada, de cerca de 1 mês antes.</div>`;
  h += revList(l1, 'r1', '1ª revisão') + revList(l2, 'r2', '2ª passada');
  if (s.ev?.length) {
    h += `<div class="aulah">Questões inéditas</div>`;
    s.ev.forEach((e, j) => { const A = aula(e.a); h += `<div class="item"><span></span><div><div class="txt">${esc(MAT(A.sj))}, ${esc(A.lab)}, ${e.t === 'L' ? 'Lista' : 'Comentadas'} p. ${e.s}: <b>${qtxt(e.q)}</b></div>
      <div class="acts"><button class="chip" data-open="${e.a}" data-page="${e.s}">Abrir p. ${e.s}</button></div>${qGrid(s.n, 'e' + j, e)}</div></div>`; });
  }
  return h + `</div>`;
}
async function onSessaoClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('qb')) return onQGrid(b);
  const n = S.viewN ?? curN();
  if (b.dataset.nav) { S.viewN = Math.min(total(), Math.max(1, n + +b.dataset.nav)); render(); return; }
  if (b.dataset.goto) { S.viewN = null; render(); return; }
  if (b.dataset.open) {
    const s = sess(n); const jumps = []; const seen = new Set();
    if (s.k === 'C') s.it.filter(it => it.a === b.dataset.open).forEach(it => itemJumps(it).forEach(([l, pg]) => { if (!seen.has(l)) { seen.add(l); jumps.push([l, pg]); } }));
    openPDF(b.dataset.open, +b.dataset.page, { sess: n, jumps }); return;
  }
  if (b.dataset.res) { const er = S.erros.find(x => x.id === +b.dataset.res); er[b.dataset.k] = er[b.dataset.k] === b.dataset.v ? '' : b.dataset.v; er.upd = Date.now(); await errPut(er); render(); return; }
  if (b.id === 'tGo') { T.run ? tPause() : tStart(); return; }
  if (b.id === 'tSkip') { tNext(); return; }
  if (b.id === 'tRst') { tReset(); tPaint(); return; }
  if (b.id === 'addErr') { errForm({ sessao: n, aula: defaultAula(n) }); return; }
  if (b.id === 'concl') {
    const pp = (S.prog[n] ??= {}); pp.done = true; pp.date = todayISO(); pp.fech = $('#fech').value; pp.upd = Date.now();
    await saveProg(); tReset(); S.viewN = null; toast(`Sessão ${n} concluída`); render(); window.scrollTo(0, 0); return;
  }
  if (b.id === 'undo') { S.prog[n].done = false; S.prog[n].upd = Date.now(); await saveProg(); render(); }
}
function defaultAula(n) {
  const s = sess(n);
  if (s.k === 'C') return s.it[0].a;
  const back = S.C.sessoes.slice(0, n - 1).reverse().find(x => x.k === 'C');
  return back ? back.it[0].a : Object.keys(S.C.aulas)[0];
}

/* ---------------- formulário de erro ---------------- */
function aulaOptions(sel) {
  return ORDEM.map(m => `<optgroup label="${esc(MAT(m))}">` + Object.entries(S.C.aulas).filter(([, a]) => a.sj === m).sort((x, y) => x[1].n - y[1].n)
    .map(([k, a]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(a.lab)} · ${a.v}</option>`).join('') + `</optgroup>`).join('');
}
function errForm(pre = {}) {
  const e = { data: todayISO(), sessao: curN() || total(), aula: '', pagina: '', questao: '', minha: '', gab: '', tipo: '', porque: '', assunto: '', banca: '', regra: '', alerta: '', r1: '', r2: '', ...pre };
  const f = $('#dlgForm');
  f.innerHTML = `<h3>${e.id ? 'Editar erro' : 'Lançar erro'}</h3>
  <div class="grid2"><div><label>Sessão</label><input id="fSes" type="number" inputmode="numeric" value="${esc(e.sessao)}"></div>
  <div><label>Data</label><input id="fData" type="date" value="${esc(e.data)}"></div></div>
  <label>Aula</label><select id="fAula">${aulaOptions(e.aula)}</select>
  <div class="grid2"><div><label>Página</label><input id="fPag" type="number" inputmode="numeric" value="${esc(e.pagina)}"></div>
  <div><label>Questão nº</label><input id="fQ" type="text" inputmode="numeric" value="${esc(e.questao)}" placeholder="13"></div></div>
  <div class="grid2"><div><label>Minha resposta</label><input id="fMinha" type="text" value="${esc(e.minha)}" placeholder="C"></div>
  <div><label>Gabarito</label><input id="fGab" type="text" value="${esc(e.gab)}" placeholder="E"></div></div>
  <label>Tipo de erro</label><div class="row wrap" id="fTipo">${TIPOS.map(t => `<button type="button" class="chip ${e.tipo === t ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
  <label>Por que errei</label><textarea id="fPorque" placeholder="Ex.: confundi 2FN com 3FN">${esc(e.porque)}</textarea>
  <details ${e.regra || e.assunto ? 'open' : ''}><summary class="small mut">Mais campos (a IA pode preencher depois)</summary>
  <label>Assunto</label><input id="fAss" type="text" value="${esc(e.assunto)}">
  <label>Banca/Ano</label><input id="fBanca" type="text" value="${esc(e.banca)}" placeholder="FGV/2023">
  <label>Regra correta</label><textarea id="fRegra">${esc(e.regra)}</textarea>
  <label>Alerta</label><input id="fAlerta" type="text" value="${esc(e.alerta)}">
  <div class="grid2"><div><label>Resultado rev. 1</label><select id="fR1">${['', 'Acertei', 'Errei'].map(v => `<option ${e.r1 === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div><label>Resultado rev. 2</label><select id="fR2">${['', 'Acertei', 'Errei'].map(v => `<option ${e.r2 === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
  </details>
  <div class="row" style="margin-top:14px">${e.id ? `<button type="button" class="btn bad" id="fDel">Excluir</button>` : ''}<span class="sp"></span>
  <button type="button" class="btn" id="fCancel">Cancelar</button><button type="button" class="btn pri" id="fSave">Salvar</button></div>`;
  let tipo = e.tipo;
  $('#fTipo', f).onclick = ev => { const b = ev.target.closest('[data-t]'); if (!b) return; tipo = tipo === b.dataset.t ? '' : b.dataset.t; $$('#fTipo .chip', f).forEach(x => x.classList.toggle('on', x.dataset.t === tipo)); };
  $('#fCancel', f).onclick = () => $('#dlg').close();
  if (e.id) $('#fDel', f).onclick = async () => { if (!confirm('Excluir este erro?')) return; await errDel(e.id); if (e.uid) { S.del[e.uid] = Date.now(); await kvSet('del', S.del); await qDesmarca(e.uid); } S.erros = S.erros.filter(x => x.id !== e.id); $('#dlg').close(); render(); };
  $('#fSave', f).onclick = async () => {
    const out = { ...e, sessao: +$('#fSes', f).value || e.sessao, data: $('#fData', f).value || todayISO(), aula: $('#fAula', f).value, pagina: $('#fPag', f).value, questao: $('#fQ', f).value.trim(),
      minha: $('#fMinha', f).value.trim(), gab: $('#fGab', f).value.trim(), tipo, porque: $('#fPorque', f).value.trim(), assunto: $('#fAss', f).value.trim(), banca: $('#fBanca', f).value.trim(),
      regra: $('#fRegra', f).value.trim(), alerta: $('#fAlerta', f).value.trim(), r1: $('#fR1', f).value, r2: $('#fR2', f).value, upd: Date.now() };
    if (!out.pagina || !out.questao) { toast('Informe página e número da questão.'); return; }
    if (!out.id) { delete out.id; out.criado = Date.now(); out.exp = false; out.uid = newUid(); out.aver = aula(out.aula)?.ver; }
    const id = await errPut(out); out.id = out.id ?? id;
    S.erros = S.erros.filter(x => x.id !== out.id).concat(out);
    $('#dlg').close(); toast('Erro salvo'); render();
  };
  $('#dlg').showModal();
}

/* ---------------- render: erros ---------------- */
function renderErros() {
  const { mat, st } = S.filtro;
  let L = S.erros.slice().sort((a, b) => b.sessao - a.sessao || b.id - a.id);
  if (mat) L = L.filter(e => aula(e.aula)?.sj === mat);
  if (st === 'semregra') L = L.filter(e => !e.regra);
  if (st === 'refazer') L = L.filter(e => status(e) === 'Refazer');
  if (st === 'pendente') L = L.filter(e => status(e) === 'Pendente');
  let h = `<div class="row" style="margin-bottom:10px"><h2 class="sp">Caderno de erros</h2><button class="btn pri" id="eNew">+ Novo</button></div>
  <div class="card"><select id="eMat"><option value="">Todas as matérias</option>${ORDEM.map(m => `<option value="${m}" ${m === mat ? 'selected' : ''}>${esc(MAT(m))}</option>`).join('')}</select>
  <div class="row wrap" style="margin-top:8px" id="eSt">${[['todos', 'Todos'], ['semregra', 'Sem regra'], ['pendente', 'Pendentes'], ['refazer', 'Refazer']].map(([k, l]) => `<button class="chip ${st === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
  <div class="small mut" style="margin-top:8px">${L.length} de ${S.erros.length} erros</div></div>`;
  h += `<div class="card list">${L.length ? L.map(e => `<div class="li" data-id="${e.id}"><div class="small">${errLine(e)}</div>
    <div>${esc(e.assunto || e.porque || '(sem descrição)')}</div>
    <div class="row wrap small" style="margin-top:4px"><span class="mut">${esc(e.tipo || 'sem tipo')}</span><span class="mut">·</span><span class="${status(e) === 'Dominado' ? 'good' : status(e) === 'Refazer' ? 'bad' : 'mut'}">${status(e)}</span>
    <span class="mut">· rev. ${rev1(e.sessao)}${rev2(e.sessao) !== rev1(e.sessao) ? ' e ' + rev2(e.sessao) : ''}</span>${e.regra ? '' : '<span class="warn">· sem regra</span>'}</div></div>`).join('') : '<div class="empty">Nenhum erro aqui.</div>'}</div>`;
  const v = $('#view'); v.innerHTML = h;
  v.onchange = ev => { if (ev.target.id === 'eMat') { S.filtro.mat = ev.target.value; render(); } };
  v.onclick = ev => {
    if (ev.target.id === 'eNew') return errForm({ sessao: curN() || total(), aula: defaultAula(curN() || total()) });
    const c = ev.target.closest('[data-st]'); if (c) { S.filtro.st = c.dataset.st; render(); return; }
    const li = ev.target.closest('.li'); if (li) errForm(S.erros.find(x => x.id === +li.dataset.id));
  };
}

/* ---------------- render: cronograma ---------------- */
function renderCrono() {
  const pr = projections(), cn = curN();
  let h = `<div class="card"><div class="row"><input id="cGo" type="number" inputmode="numeric" placeholder="Ir para a sessão nº" min="1" max="${total()}"><button class="btn pri" id="cBtn">Ir</button></div>
  <div class="small mut" style="margin-top:8px">${doneCount()} feitas · ${total() - doneCount()} restantes · término previsto ${br(pr[total()])} com ${S.set.dias.length} sessões por semana</div></div><div class="card">`;
  let mes = '';
  for (const s of S.C.sessoes) {
    const d = parseISO(pr[s.n]); const m = `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
    if (m !== mes) { mes = m; h += `<div class="mh">${m[0].toUpperCase() + m.slice(1)}</div>`; }
    const lab = s.k === 'C' ? [...new Set(s.it.map(it => aula(it.a).lab))].join(', ') : `erros das sessões ${s.de} a ${s.ate}`;
    h += `<div class="sess ${s.n === cn ? 'cur' : ''} ${S.prog[s.n]?.done ? 'ok' : ''}" data-n="${s.n}"><span class="n">${s.n}</span><span class="small mut">${brShort(pr[s.n])}</span>
      <span>${matTag(s.m)} <span class="small">${esc(lab)}</span></span></div>`;
  }
  const v = $('#view'); v.innerHTML = h + `</div>`;
  v.onclick = ev => {
    if (ev.target.id === 'cBtn') { const n = +$('#cGo').value; if (n >= 1 && n <= total()) { S.viewN = n; setTab('sessao'); } return; }
    const r = ev.target.closest('.sess'); if (r) { S.viewN = +r.dataset.n; setTab('sessao'); }
  };
  v.onchange = null;
  const c = $('.sess.cur'); if (c) c.scrollIntoView({ block: 'center' });
}

/* ---------------- exportação, IA e backup ---------------- */
const cell = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ; ').trim();
function rowAO(e) {
  const A = aula(e.aula) || {};
  return [br(e.data), e.sessao, MAT(A.sj), A.lab, A.v, e.pagina, e.questao ? `q.${digits(e.questao) || e.questao}` : '', e.banca, e.assunto, e.tipo, e.minha, e.gab, e.porque, e.regra, e.alerta].map(cell);
}
// sem área de transferência, mostra o texto para copiar à mão e só devolve true se o usuário confirmar que copiou
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch {
    const f = $('#dlgForm'), dlg = $('#dlg'); let ok = false;
    f.innerHTML = `<h3>Copie o texto</h3><textarea style="min-height:50vh">${esc(txt)}</textarea><div class="row" style="margin-top:10px"><span class="sp"></span><button type="button" class="btn" id="xNo">Cancelar</button><button type="button" class="btn pri" id="xOk">Copiei</button></div>`;
    $('#xNo', f).onclick = () => dlg.close(); $('#xOk', f).onclick = () => { ok = true; dlg.close(); };
    dlg.showModal(); $('textarea', f).select();
    return new Promise(res => dlg.addEventListener('close', () => res(ok), { once: true }));
  }
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function exportNovos() {
  const L = S.erros.filter(e => !e.exp).sort((a, b) => a.sessao - b.sessao || a.id - b.id);
  if (!L.length) return toast('Nenhum erro novo para exportar.');
  if (!(await copyText(L.map(e => rowAO(e).join('\t')).join('\n')))) return toast('Nada foi marcado como exportado.');
  toast(`${L.length} linhas copiadas. Cole na coluna A da planilha.`);
  for (const e of L) { e.exp = true; await errPut(e); }
  render();
}
async function exportTudo() {
  const H = ['Data', 'Sessão', 'Matéria', 'Aula', 'Versão', 'Página', 'Questão', 'Banca/Ano', 'Assunto', 'Tipo de erro', 'Minha resposta', 'Gabarito', 'Por que errei', 'Regra correta', 'Alerta', 'Revisão 1 (sessão)', 'Revisão 2 (sessão)', 'Resultado rev. 1', 'Resultado rev. 2', 'Status'];
  const L = S.erros.slice().sort((a, b) => a.sessao - b.sessao || a.id - b.id).map(e => [...rowAO(e), rev1(e.sessao), rev2(e.sessao), e.r1, e.r2, status(e)].map(cell).join('\t'));
  download(`caderno-erros-${todayISO()}.tsv`, '﻿' + [H.join('\t'), ...L].join('\n'), 'text/tab-separated-values');
}
async function copiarIA() {
  const L = S.erros.filter(e => !e.regra).sort((a, b) => a.sessao - b.sessao || a.id - b.id);
  if (!L.length) return toast('Todos os erros já têm Regra correta.');
  const groups = new Map();
  for (const e of L) { const k = `${e.sessao}|${e.aula}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  let out = [];
  for (const [, g] of groups) {
    const e0 = g[0], A = aula(e0.aula);
    out.push(`SESSÃO ${e0.sessao} | ${br(e0.data)} | ${MAT(A.sj)} | ${A.lab} | ${A.v}`);
    for (const e of g) {
      out.push(`p. ${e.pagina} | q. ${digits(e.questao) || e.questao} | marquei ${e.minha || '?'} | gab ${e.gab || '?'}${e.tipo === 'Chute' ? ' | chute' : ''}`);
      out.push('Enunciado: (cole o texto ou anexe o print da questão)');
      if (e.porque) out.push(`Dúvida: ${e.porque}`);
      out.push('');
    }
  }
  if (await copyText(out.join('\n'))) toast(`${L.length} erros copiados. Cole na conversa com a IA e anexe os prints.`);
}
function parseAI(text) {
  const rows = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/^\s*```.*$/, '').replace(/\s+$/, ''); if (!line) continue;
    let f = line.split('\t');
    if (f.length < 12) { const g = line.split(/ {2,}/); if (g.length === 15) f = g; else continue; }
    rows.push(f.map(x => x.trim()));
  }
  return rows;
}
async function aplicarIA(text) {
  const rows = parseAI(text); let upd = 0, novo = 0, ign = 0;
  for (const f of rows) {
    const ses = parseInt(f[1], 10), pg = parseInt(f[5], 10), pag = String(pg), q = digits(f[6]);
    if (!ses || !pg || !q) { ign++; continue; }
    let e = S.erros.find(x => x.sessao === ses && String(parseInt(x.pagina, 10)) === pag && digits(x.questao) === q);
    if (!e) {
      const k = Object.keys(S.C.aulas).find(k => MAT(S.C.aulas[k].sj) === f[2] && S.C.aulas[k].lab === f[3]);
      if (!k) { ign++; continue; }
      const m = f[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      e = { data: m ? `${m[3]}-${m[2]}-${m[1]}` : todayISO(), sessao: ses, aula: k, pagina: pag, questao: q, minha: f[10] || '', gab: f[11] || '', porque: '', r1: '', r2: '', criado: Date.now(), exp: false, uid: newUid(), aver: S.C.aulas[k]?.ver };
      novo++;
    } else upd++;
    e.banca = f[7] || e.banca || ''; e.assunto = f[8] || e.assunto || '';
    if (TIPOS.includes(f[9])) e.tipo = f[9];
    e.minha ||= f[10] || ''; e.gab ||= f[11] || ''; e.porque ||= f[12] || '';
    e.regra = f[13] || e.regra || ''; e.alerta = f[14] || e.alerta || ''; e.upd = Date.now();
    const id = await errPut(e); e.id ??= id;
    S.erros = S.erros.filter(x => x.id !== e.id).concat(e);
  }
  return { upd, novo, ign };
}
function dlgColarIA() {
  const f = $('#dlgForm');
  f.innerHTML = `<h3>Colar retorno da IA</h3><p class="small mut">Cole o bloco que a IA devolveu. As linhas são casadas com seus erros por sessão, página e questão; linhas sem correspondência viram erros novos.</p>
  <textarea id="aiTxt" style="min-height:40vh" placeholder="Cole aqui"></textarea>
  <div class="row" style="margin-top:10px"><span class="sp"></span><button type="button" class="btn" id="aiC">Cancelar</button><button type="button" class="btn pri" id="aiOk">Aplicar</button></div>`;
  $('#aiC', f).onclick = () => $('#dlg').close();
  $('#aiOk', f).onclick = async () => { const r = await aplicarIA($('#aiTxt', f).value); $('#dlg').close(); toast(`${r.upd} atualizados, ${r.novo} novos, ${r.ign} linhas ignoradas`, 4000); render(); };
  $('#dlg').showModal();
}
async function backup() {
  const data = await buildBackup();
  download(`estudo-ti-backup-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  S.lastBackup = data.criado; await kvSet('lastBackup', S.lastBackup); render();
}
async function restaurar(file) {
  let data; try { data = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido.'); }
  if (data?.app !== 'estudo-ti') return toast('Este arquivo não é um backup do Estudo TI.');
  if (!Array.isArray(data.erros)) return toast('Backup incompleto: falta a lista de erros. Nada foi alterado.');
  if (!confirm(`Substituir o progresso e os ${S.erros.length} erros atuais pelo backup de ${br(String(data.criado || '').slice(0, 10)) || 'data desconhecida'} (${data.erros.length} erros)?`)) return;
  await run('erros', 'readwrite', s => s.clear());
  for (const e of data.erros) await errPut(e);
  if (data.anot) { await anotClear(); for (const [k, v] of Object.entries(data.anot)) await kvSet(k, v); V.ann = new Map(); V.annFile = null; }
  S.prog = data.prog || {}; S.set = { ...S.set, ...(data.set || {}), device: S.set.device }; S.del = data.del || {}; await kvSet('del', S.del); S.erros = await errAll(); await migrarUids();
  await kvSet('prog', S.prog); await kvSet('set', S.set); toast('Backup restaurado.'); render();
}
async function migrarUids() {
  for (const e of S.erros) {
    let ch = false;
    if (!e.uid) { e.uid = legacyUid(e); ch = true; }
    if (!e.aver && aula(e.aula)?.ver) { e.aver = aula(e.aula).ver; ch = true; }
    if (ch) await errPut(e);
  }
}
async function mergeData(data) {
  const r = { novos: 0, atual: 0, rem: 0, ses: 0, pags: 0 };
  const del = { ...S.del };
  for (const [u, t] of Object.entries(data.del || {})) del[u] = Math.max(del[u] || 0, t);
  const byU = new Map(S.erros.map(e => [e.uid, e]));
  for (const re0 of data.erros || []) {
    const re = { ...re0, uid: re0.uid || legacyUid(re0) };
    if (del[re.uid] && del[re.uid] >= ets(re)) continue;
    const le = byU.get(re.uid);
    if (!le) { delete re.id; re.id = await errPut(re); S.erros.push(re); byU.set(re.uid, re); r.novos++; }
    else if (ets(re) > ets(le)) { const m = { ...re, id: le.id, exp: !!(le.exp || re.exp) }; await errPut(m); S.erros = S.erros.map(x => (x.id === le.id ? m : x)); byU.set(m.uid, m); r.atual++; }
    else if (re.exp && !le.exp) { le.exp = true; await errPut(le); }
  }
  for (const e of [...S.erros]) if (del[e.uid] && del[e.uid] >= ets(e)) { await errDel(e.id); S.erros = S.erros.filter(x => x.id !== e.id); r.rem++; }
  S.del = del; await kvSet('del', del);
  for (const [n, rp] of Object.entries(data.prog || {})) {
    const lp = S.prog[n]; const tl = lp?.upd || 0, tr = rp?.upd || 0;
    if (!lp || tr > tl || (tr === tl && rp.done && !lp.done)) { if (JSON.stringify(lp) !== JSON.stringify(rp)) { S.prog[n] = rp; r.ses++; } }
  }
  // só grava (e marca para sincronizar) se algo mudou: senão dois aparelhos com pasta ficam se regravando a cada 90 s
  if (r.ses) await saveProg();
  if (data.anot) {
    const local = await anotAll(); const ts = v => (v == null ? -1 : Array.isArray(v) ? 0 : v.u || 0);
    for (const [k, v] of Object.entries(data.anot)) if (ts(v) > ts(local[k])) { await kvSet(k, v); r.pags++; }
    if (V.file) { await loadAnn(V.file); [...V.rendered.keys()].forEach(drawInk); }
  }
  return r;
}
const mergeMsg = r => `Mesclado. Erros: ${r.novos} novo(s), ${r.atual} atualizado(s), ${r.rem} removido(s). Sessões: ${r.ses}. Páginas com marcações: ${r.pags}.`;
async function mesclarArquivos(files) {
  const tot = { novos: 0, atual: 0, rem: 0, ses: 0, pags: 0 }; let bad = 0;
  for (const f of files) {
    let data; try { data = JSON.parse(await f.text()); } catch { bad++; continue; }
    if (data?.app !== 'estudo-ti') { bad++; continue; }
    const r = await mergeData(data); for (const k in tot) tot[k] += r[k];
  }
  toast(mergeMsg(tot) + (bad ? ` ${bad} arquivo(s) ignorado(s).` : ''), 6000); render(); return tot;
}

/* ---------------- PDFs: importação ---------------- */
async function importarPDFs(files) {
  const byName = new Map(Object.values(S.C.aulas).map(a => [a.file, a]));
  let ok = 0, dif = 0; const fora = [];
  const f = $('#dlgForm'); f.innerHTML = `<h3>Importando PDFs</h3><p id="impP" class="mut">0 de ${files.length}</p>`; $('#dlg').showModal();
  for (const [i, file] of [...files].entries()) {
    $('#impP').textContent = `${i + 1} de ${files.length}: ${file.name}`;
    if (byName.has(file.name)) {
      await pdfPut(file.name, file); S.pdfs.add(file.name); ok++;
      try { const h = await fileHash(file); S.pv[file.name] = h; await kvSet('pv|' + file.name, h); if (byName.get(file.name).ver && h !== byName.get(file.name).ver) dif++; } catch {}
    } else fora.push(file.name);
  }
  $('#dlg').close();
  try { await navigator.storage?.persist?.(); } catch {}
  toast(`${ok} ${ok === 1 ? 'PDF importado' : 'PDFs importados'}${fora.length ? `, ${fora.length} ignorado(s) por não estar no cronograma` : ''}${dif ? `, ${dif} em versão diferente da do cronograma` : ''}.`, 5000);
  render();
}
$('#pdfInput').onchange = e => { if (e.target.files.length) importarPDFs(e.target.files); e.target.value = ''; };
$('#bkInput').onchange = async e => {
  const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return;
  if (S.bkMode === 'replace') return restaurar(fs[0]);
  await mesclarArquivos(fs);
  if (S.bkMode === 'sync') await salvarEste();
};
$('#bkInput').addEventListener('cancel', () => { if (S.bkMode === 'sync') salvarEste(); });

/* ---------------- render: mais ---------------- */
async function renderMais() {
  const aulas = Object.values(S.C.aulas); const falt = aulas.filter(a => !S.pdfs.has(a.file));
  const desat = aulas.filter(outdated); const nomes = new Set(aulas.map(a => a.file)); const orf = [...S.pdfs].filter(f => !nomes.has(f));
  const mb = aulas.filter(a => S.pdfs.has(a.file)).reduce((t, a) => t + a.size, 0) / 1048576;
  const novos = S.erros.filter(e => !e.exp).length, semRegra = S.erros.filter(e => !e.regra).length;
  let pers = '', est = '';
  try { pers = (await navigator.storage?.persisted?.()) ? '<span class="good">armazenamento protegido</span>' : '<span class="warn">armazenamento não protegido</span>'; } catch {}
  try { const e = await navigator.storage?.estimate?.(); if (e) est = ` · ${(e.usage / 1048576).toFixed(0)} MB usados`; } catch {}
  const v = $('#view');
  v.innerHTML = `<h2>Mais</h2>
  <div class="card"><h3>PDFs</h3><div>${aulas.length - falt.length} de ${aulas.length} importados · ${mb.toFixed(0)} MB</div>
   <p class="small mut">Copie a pasta do pacote para o celular, toque em Importar e selecione os PDFs (pode importar uma pasta de cada vez). Só os arquivos do cronograma entram.</p>
   <div class="row wrap"><button class="btn pri" id="mImp">Importar PDFs</button>${S.pdfs.size ? '<button class="btn bad" id="mDelPdf">Apagar PDFs</button>' : ''}</div>
   ${desat.length ? `<details style="margin-top:8px" open><summary class="small warn">Versão diferente do cronograma (${desat.length}): reimporte</summary><div class="small mut">${desat.map(a => `${esc(MAT(a.sj))}: ${esc(a.file)}`).join('<br>')}</div></details>` : ''}
   ${orf.length ? `<details style="margin-top:8px"><summary class="small">Fora do cronograma (${orf.length})</summary><div class="small mut">${orf.map(esc).join('<br>')}</div><button class="btn bad" id="mDelOrf" style="margin-top:6px">Apagar estes</button></details>` : ''}
   ${falt.length ? `<details style="margin-top:8px"><summary class="small">Faltando (${falt.length})</summary><div class="small mut">${falt.map(a => `${esc(MAT(a.sj))}: ${esc(a.file)}`).join('<br>')}</div></details>` : ''}</div>
  <div class="card"><h3>Planilha</h3><p class="small mut">Complete os erros com a IA antes de exportar: o que já foi exportado não volta para a planilha sozinho.</p>
   <div class="row wrap"><button class="btn pri" id="mNovos">Copiar ${novos} erros novos</button><button class="btn" id="mTudo">Baixar tudo (.tsv)</button></div></div>
  <div class="card"><h3>IA (precisa de internet)</h3><p class="small mut">${semRegra} erros sem Regra correta. Use com o prompt do arquivo "Prompt Caderno de Erros.txt".</p>
   <div class="row wrap"><button class="btn pri" id="mIA">Copiar para a IA</button><button class="btn" id="mCola">Colar retorno da IA</button></div></div>
  ${syncCard()}
  <div class="card"><h3>Backup</h3><div class="small">${S.lastBackup ? 'Último: ' + br(S.lastBackup.slice(0, 10)) : '<span class="warn">Nenhum backup feito</span>'} · ${pers}${est}</div>
   <p class="small mut">O backup guarda progresso, erros e marcações (os PDFs não). Salve o arquivo fora do aparelho, no Drive, toda semana.</p>
   <p class="small mut"><b>Celular e PC:</b> ao terminar num aparelho, toque em Baixar backup e ponha o arquivo no Drive. No outro, use Mesclar: ele junta os dois, sem apagar o que só existe aqui.</p>
   <div class="row wrap"><button class="btn pri" id="mBk">Baixar backup</button><button class="btn pri" id="mMerge">Mesclar backup</button><button class="btn bad" id="mRest">Restaurar (substitui tudo)</button></div></div>
  <div class="card"><h3>Configurações</h3><label>Dias de estudo</label>
   <div class="row wrap" id="mDias">${W.map((d, i) => `<button class="chip ${S.set.dias.includes(i) ? 'on' : ''}" data-d="${i}">${d}</button>`).join('')}</div>
   <label>Minutos: bloco A, pausa, bloco B, fechamento</label>
   <div class="grid2">${S.set.durs.map((m, i) => `<input type="number" inputmode="numeric" min="1" max="90" data-dur="${i}" value="${m}" aria-label="${PH[i]}">`).join('')}</div></div>
  <p class="small mut">Estudo TI · cronograma de ${br(S.C.versao)} · funciona sem internet depois de instalado.</p>`;
  v.onclick = async ev => {
    const id = ev.target.id;
    if (id === 'mImp') $('#pdfInput').click();
    else if (id === 'mDelPdf') { if (confirm('Apagar todos os PDFs importados? Progresso e erros ficam.')) { await run('pdfs', 'readwrite', s => s.clear()); S.pdfs.clear(); render(); } }
    else if (id === 'mDelOrf') { if (confirm('Apagar do app os PDFs que não estão mais no cronograma?')) { const nomes = new Set(Object.values(S.C.aulas).map(a => a.file)); for (const f of [...S.pdfs]) if (!nomes.has(f)) { await run('pdfs', 'readwrite', s => s.delete(f)); await run('kv', 'readwrite', s => s.delete('pv|' + f)); S.pdfs.delete(f); delete S.pv[f]; } render(); } }
    else if (id === 'mNovos') exportNovos();
    else if (id === 'mTudo') exportTudo();
    else if (id === 'mIA') copiarIA();
    else if (id === 'mCola') dlgColarIA();
    else if (id === 'mBk') backup();
    else if (id === 'mRest') { S.bkMode = 'replace'; $('#bkInput').click(); }
    else if (id === 'mMerge') { S.bkMode = 'merge'; $('#bkInput').click(); }
    else if (id === 'mPasta') escolherPasta();
    else if (id === 'mSyncNow') syncNow(true);
    else if (id === 'mSyncOff') { syncDir = null; S.syncOff = false; await run('kv', 'readwrite', s => s.delete('syncDir')); render(); }
    else if (id === 'mSyncCel') syncCelular();
    else if (id === 'mSalvar') salvarEste();
    const d = ev.target.closest('[data-d]');
    if (d) { const i = +d.dataset.d; const s = new Set(S.set.dias); s.has(i) ? s.delete(i) : s.add(i); if (!s.size) return toast('Escolha ao menos um dia.'); S.set.dias = [...s].sort(); await kvSet('set', S.set); render(); }
  };
  v.onchange = async ev => {
    if (ev.target.id === 'mDev') { S.set.device = ev.target.value.trim() || devPadrao(); await kvSet('set', S.set); S.syncDirty = true; toast(`Arquivo deste aparelho: ${ownFile()}`); render(); return; }
    const i = ev.target.dataset.dur; if (i == null) return;
    S.set.durs[+i] = Math.max(1, Math.min(90, +ev.target.value || S.set.durs[+i])); await kvSet('set', S.set);
    if (!T.run) { T.left = S.set.durs[T.ph] * 60; tSave(); } toast('Duração salva');
  };
}

/* ---------------- leitor de PDF ---------------- */
const V = { doc: null, file: null, aula: null, scale: 1, w: 0, h: 0, cur: 1, ctx: null, obs: null, rendered: new Map(), gen: 0, pr: new Map() };
const vp = $('#vPages');
// altura de cada página pela proporção dela (V.pr: altura/largura); a página ainda não renderizada usa a da página 1
const pgH = p => Math.round(V.w * (V.pr.get(p) ?? V.pr.get(1) ?? 1.414));
async function openPDF(aulaKey, page, ctx = {}) {
  const A = aula(aulaKey);
  const blob = await pdfGet(A.file);
  if (!blob) { toast('PDF não importado. Vá em Mais › PDFs.'); return; }
  $('#viewer').hidden = false; document.body.style.overflow = 'hidden';
  if (!history.state?.viewer) history.pushState({ viewer: 1 }, '');
  $('#vName').textContent = `${MAT(A.sj)} · ${A.lab}`; V.ctx = ctx; V.aula = aulaKey;
  $('#vJump').innerHTML = (ctx.jumps || []).map(([l, p]) => `<button class="chip" data-p="${p}">${esc(l)}</button>`).join('');
  paintVGrid();
  if (V.file !== A.file) {
    $('#vPage').textContent = 'abrindo...';
    try { await V.doc?.destroy(); } catch {}
    V.doc = null; V.file = null; V.txt = new Map(); V.pr = new Map();
    const data = new Uint8Array(await blob.arrayBuffer());
    V.doc = await pdfjs.getDocument({ data, standardFontDataUrl: './vendor/standard_fonts/', isEvalSupported: false }).promise;
    V.file = A.file; await loadAnn(A.file); await layout();
  }
  goPage(page);
}
async function layout() {
  const g = ++V.gen; V.rendered.clear(); V.obs?.disconnect();
  if (!V.pr.has(1)) { const v1 = (await V.doc.getPage(1)).getViewport({ scale: 1 }); V.pr.set(1, v1.height / v1.width); }
  if (g !== V.gen) return;
  V.w = Math.round(Math.min(vp.clientWidth - 16, 900) * V.scale); V.h = pgH(1);
  const fr = document.createDocumentFragment();
  for (let i = 1; i <= V.doc.numPages; i++) {
    const d = document.createElement('div'); d.className = 'pg'; d.dataset.p = i; d.style.width = V.w + 'px'; d.style.height = pgH(i) + 'px';
    d.innerHTML = `<span class="pn">${i}</span>`; fr.append(d);
  }
  vp.replaceChildren(fr);
  V.obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(+e.target.dataset.p, g); }), { root: vp, rootMargin: '700px 0px' });
  $$('.pg', vp).forEach(d => V.obs.observe(d));
  $('#vGo').max = V.doc.numPages;
}
async function renderPage(i, g) {
  if (V.rendered.has(i) || g !== V.gen) return;
  V.rendered.set(i, null);
  try {
    const page = await V.doc.getPage(i); if (g !== V.gen) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const v1 = page.getViewport({ scale: 1 }); const v = page.getViewport({ scale: (V.w / v1.width) * dpr }); V.pr.set(i, v1.height / v1.width);
    const c = document.createElement('canvas'); c.width = Math.floor(v.width); c.height = Math.floor(v.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    if (g !== V.gen) return;
    const d = vp.querySelector(`.pg[data-p="${i}"]`); if (!d) return;
    const h = pgH(i);
    if (d.offsetHeight !== h) { const acima = d.getBoundingClientRect().top < vp.getBoundingClientRect().top, dh = h - d.offsetHeight; d.style.height = h + 'px'; if (acima) vp.scrollTop += dh; }
    d.prepend(c); V.rendered.set(i, c); ensureInk(d, i); if (V.tool === 'h') textLines(i);
    if (V.rendered.size > 12) {
      [...V.rendered.keys()].sort((a, b) => Math.abs(b - V.cur) - Math.abs(a - V.cur)).slice(0, V.rendered.size - 12).forEach(k => { V.rendered.get(k)?.remove(); vp.querySelector(`.pg[data-p="${k}"] .ink`)?.remove(); V.rendered.delete(k); });
    }
  } catch (err) { V.rendered.delete(i); console.warn(err); }
}
function goPage(p) {
  if (!V.doc) return; p = Math.max(1, Math.min(V.doc.numPages, p | 0));
  const d = vp.querySelector(`.pg[data-p="${p}"]`); if (d) vp.scrollTop += d.getBoundingClientRect().top - vp.getBoundingClientRect().top - 8;
  V.cur = p; paintPage();
}
function paintPage() { $('#vPage').textContent = `p. ${V.cur} de ${V.doc?.numPages || '?'}`; $('#vGo').value = V.cur; }
vp.addEventListener('scroll', () => {
  if (!V.doc) return; cancelAnimationFrame(vp.raf);
  vp.raf = requestAnimationFrame(() => {
    const r = vp.getBoundingClientRect(), d = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.3)?.closest('.pg');
    if (d && +d.dataset.p !== V.cur) { V.cur = +d.dataset.p; paintPage(); }
  });
}, { passive: true });
function closeViewer(fromPop = false) {
  V.tool = null; paintTools(); $('#viewer').hidden = true; document.body.style.overflow = ''; if (!fromPop && history.state?.viewer) history.back();
  if (S.reloadPending) { S.reloadPending = false; location.reload(); }
}
window.addEventListener('popstate', () => { if (!$('#viewer').hidden) closeViewer(true); });
$('#vClose').onclick = () => closeViewer();
$('#vPrev').onclick = () => goPage(V.cur - 1);
$('#vNext').onclick = () => goPage(V.cur + 1);
$('#vGo').onchange = e => goPage(+e.target.value);
$('#vJump').onclick = e => { const b = e.target.closest('[data-p]'); if (b) goPage(+b.dataset.p); };
async function zoom(dz) { const p = V.cur; V.scale = Math.max(1, Math.min(3, +(V.scale + dz).toFixed(2))); await layout(); goPage(p); }
$('#vZi').onclick = () => zoom(0.25);
$('#vZo').onclick = () => zoom(-0.25);
// grade das questões desta aula na sessão de origem, para marcar sem fechar o PDF
function paintVGrid() {
  const n = V.ctx?.sess, s = n && sess(n), g = $('#vGrid'); let h = '';
  if (s) {
    (s.it || []).forEach((it, i) => { if (it.a === V.aula && it.t !== 'T') h += `<div class="small">${itemText(it)}</div>${qGrid(n, String(i), it)}`; });
    (s.ev || []).forEach((e, j) => { if (e.a === V.aula) h += `<div class="small">${e.t === 'L' ? 'Lista' : 'Comentadas'} p. ${e.s}: <b>${qtxt(e.q)}</b></div>${qGrid(n, 'e' + j, e)}`; });
  }
  g.innerHTML = h; $('#vQ').hidden = !h; if (!h) g.hidden = true;
  $('#vQ').classList.toggle('on', !g.hidden);
}
$('#vQ').onclick = () => { $('#vGrid').hidden = !$('#vGrid').hidden; paintVGrid(); };
$('#vGrid').onclick = e => { const b = e.target.closest('.qb'); if (b) onQGrid(b); };
$('#vErr').onclick = () => errForm({ sessao: V.ctx?.sess || curN() || total(), aula: V.aula, pagina: String(V.cur) });
let rsz; window.addEventListener('resize', () => { if ($('#viewer').hidden || !V.doc) return; clearTimeout(rsz); rsz = setTimeout(async () => { const p = V.cur; await layout(); goPage(p); }, 250); });


/* ---------------- marcações (caneta, marca-texto, borracha, texto) ---------------- */
const PEN = ['#DC2626', '#2563EB', '#111827'], HL = ['#FFE600', '#22C55E', '#EF4444', '#3B82F6', '#A855F7'], HA = 0.3;
const CNOME = { '#FFE600': 'Amarelo', '#22C55E': 'Verde', '#EF4444': 'Vermelho', '#3B82F6': 'Azul', '#A855F7': 'Roxo', '#DC2626': 'Vermelho', '#2563EB': 'Azul', '#111827': 'Preto' };
Object.assign(V, { ann: new Map(), annFile: null, tool: null, color: { p: PEN[0], h: HL[0], x: PEN[0] }, txt: new Map(), undo: [], ptrs: new Map(), stroke: null, pan: null });
const akey = (f, p) => `a|${f}|${p}`;
const aRange = f => IDBKeyRange.bound(`a|${f ?? ''}`, `a|${f ?? ''}￿`);
async function loadAnn(file) {
  V.ann = new Map(); V.annFile = file; V.undo = [];
  const [ks, vs] = await Promise.all([run('kv', 'readonly', s => s.getAllKeys(aRange(file + '|'))), run('kv', 'readonly', s => s.getAll(aRange(file + '|')))]);
  const ver = aula(V.aula)?.file === file ? aula(V.aula)?.ver : null; V.annOld = 0;
  ks.forEach((k, i) => { const r = vs[i]; const ops = Array.isArray(r) ? r : r?.o || []; V.ann.set(+k.split('|').pop(), ops); if (ver && r?.v && r.v !== ver && ops.length) V.annOld++; });
  paintNote();
}
async function anotAll() {
  const [ks, vs] = await Promise.all([run('kv', 'readonly', s => s.getAllKeys(aRange(''))), run('kv', 'readonly', s => s.getAll(aRange('')))]);
  return Object.fromEntries(ks.map((k, i) => [k, vs[i]]));
}
async function anotClear() { const ks = await run('kv', 'readonly', s => s.getAllKeys(aRange(''))); for (const k of ks) await run('kv', 'readwrite', s => s.delete(k)); }
async function saveAnn(p) {
  const ops = V.ann.get(p) || [];
  scheduleSync(); await kvSet(akey(V.file, p), { u: Date.now(), o: ops, v: aula(V.aula)?.ver });
}
function snapshot(p) { V.undo.push({ p, ops: JSON.parse(JSON.stringify(V.ann.get(p) || [])) }); if (V.undo.length > 100) V.undo.shift(); }
function ensureInk(d, i) {
  let ink = d.querySelector('canvas.ink');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  if (!ink) { ink = document.createElement('canvas'); ink.className = 'ink'; d.append(ink); }
  const w = Math.floor(V.w * dpr), h = Math.floor(pgH(i) * dpr);
  if (ink.width !== w || ink.height !== h) { ink.width = w; ink.height = h; }
  drawInk(i);
  return ink;
}
function strokePath(ctx, pts, W, H) {
  ctx.beginPath(); ctx.moveTo(pts[0] * W, pts[1] * H);
  if (pts.length === 2) { ctx.lineTo(pts[0] * W + 0.01, pts[1] * H); return; }
  for (let k = 2; k < pts.length - 2; k += 2) {
    const mx = (pts[k] + pts[k + 2]) / 2, my = (pts[k + 1] + pts[k + 3]) / 2;
    ctx.quadraticCurveTo(pts[k] * W, pts[k + 1] * H, mx * W, my * H);
  }
  ctx.lineTo(pts[pts.length - 2] * W, pts[pts.length - 1] * H);
}
function drawOp(ctx, op, W, H) {
  if (op.t === 'x') {
    ctx.fillStyle = op.c; ctx.font = `600 ${op.z * W}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    String(op.s).split('\n').forEach((ln, j) => ctx.fillText(ln, op.x * W, op.y * H + j * op.z * W * 1.2));
    return;
  }
  ctx.strokeStyle = op.c; ctx.lineWidth = op.w * W; ctx.lineCap = op.t === 'h' ? 'butt' : 'round'; ctx.lineJoin = 'round';
  strokePath(ctx, op.pts, W, H); ctx.stroke();
}
function drawHL(ctx, ops, W, H) {
  // marca-texto reto: retângulos da mesma cor viram um só caminho, então sobreposição não escurece
  const g = new Map();
  for (const op of ops) { const k = op.c + '|' + (op.a ?? HA); if (!g.has(k)) g.set(k, []); g.get(k).push(op); }
  for (const [k, list] of g) {
    ctx.globalAlpha = +k.split('|')[1]; ctx.fillStyle = k.split('|')[0]; ctx.beginPath();
    for (const op of list) for (const [x, y, w, h] of op.r) ctx.rect(x * W, y * H, w * W, h * H);
    ctx.fill(); ctx.globalAlpha = 1;
  }
}
function drawInk(i, extra) {
  const ink = vp.querySelector(`.pg[data-p="${i}"] .ink`); if (!ink) return;
  const ctx = ink.getContext('2d'); ctx.clearRect(0, 0, ink.width, ink.height);
  const ops = [...(V.ann.get(i) || []), ...(extra ? [extra] : [])];
  drawHL(ctx, ops.filter(o => o.t === 'r'), ink.width, ink.height);
  for (const op of ops.filter(o => o.t === 'h')) drawOp(ctx, op, ink.width, ink.height);
  for (const op of ops.filter(o => o.t !== 'h' && o.t !== 'r')) drawOp(ctx, op, ink.width, ink.height);
}

/* linhas de texto da página (para o marca-texto se encaixar na linha) */
let mctx;
function textLines(p) {
  if (V.txt.has(p)) return V.txt.get(p);
  const doc = V.doc; if (!doc) return null;
  const pr = (async () => {
    try {
      const page = await doc.getPage(p); const v = page.getViewport({ scale: 1 });
      if (v.rotation % 180) return [];
      const tc = await page.getTextContent(); const W = v.width, H = v.height;
      mctx ||= document.createElement('canvas').getContext('2d'); mctx.font = '100px sans-serif';
      const cw = new Map(); const wch = ch => { if (!cw.has(ch)) cw.set(ch, mctx.measureText(ch).width || 50); return cw.get(ch); };
      const its = [];
      for (const o of tc.items) {
        if (!o.str || !o.str.trim() || !(o.width > 0)) continue;
        const m = pdfjs.Util.transform(v.transform, o.transform);
        if (Math.abs(m[1]) > 0.02 * Math.abs(m[0]) || Math.abs(m[2]) > 0.02 * Math.abs(m[3]) || m[0] <= 0) continue; // texto girado (marca d'água)
        const fh = Math.hypot(m[2], m[3]); if (fh < 3) continue;
        const st = tc.styles[o.fontName] || {};
        const asc = Math.min(1, Math.max(0.65, st.ascent || 0.8)), dsc = Math.min(0.35, Math.max(0.12, Math.abs(st.descent || 0.22)));
        const l = m[4], r = m[4] + o.width, chars = [...o.str]; const tot = chars.reduce((a, c) => a + wch(c), 0) || 1;
        const xs = [l]; let acc = 0; for (const c of chars) { acc += wch(c); xs.push(l + (r - l) * acc / tot); }
        its.push({ l, r, base: m[5], fh, t: m[5] - asc * fh - 0.08 * fh, b: m[5] + dsc * fh + 0.04 * fh, xs });
      }
      its.sort((a, b) => a.base - b.base || a.l - b.l);
      const lines = [];
      for (const it of its) { const L = lines[lines.length - 1]; if (L && Math.abs(it.base - L.base) < 0.45 * Math.min(it.fh, L.fh)) L.its.push(it); else lines.push({ base: it.base, fh: it.fh, its: [it] }); }
      const segs = [];
      for (const L of lines) {
        L.its.sort((a, b) => a.l - b.l); let cur = null;
        for (const it of L.its) {
          if (cur && it.l - cur.r <= 1.8 * Math.max(it.fh, cur.fh)) { cur.r = Math.max(cur.r, it.r); cur.t = Math.min(cur.t, it.t); cur.b = Math.max(cur.b, it.b); cur.fh = Math.max(cur.fh, it.fh); cur.xs.push(...it.xs); }
          else { cur = { l: it.l, r: it.r, t: it.t, b: it.b, fh: it.fh, xs: [...it.xs] }; segs.push(cur); }
        }
      }
      const out = segs.map(g => ({ l: g.l / W, r: g.r / W, t: g.t / H, b: g.b / H, xs: [...new Set(g.xs.map(x => x / W))].sort((a, b) => a - b) }));
      if (V.doc === doc) V.txt.set(p, out);
      return out;
    } catch (err) { console.warn(err); if (V.doc === doc) V.txt.set(p, []); return []; }
  })();
  V.txt.set(p, pr); return pr;
}
function segAt(L, x, y, strict, ratio) {
  let best = null, bd = Infinity;
  for (const g of L) {
    const dy = Math.max(0, g.t - y, y - g.b) * ratio, dx = Math.max(0, g.l - x, x - g.r);
    if (strict && (dx > 0.03 || dy > 0.6 * (g.b - g.t) * ratio)) continue;
    const d = dy + 0.5 * dx + (strict ? Math.abs(y - (g.t + g.b) / 2) * ratio * 0.01 : 0);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}
const snapX = (g, x) => { let b = g.xs[0], bd = Infinity; for (const v of g.xs) { const d = Math.abs(v - x); if (d < bd) { bd = d; b = v; } } return b; };
function hlRects(p, x0, y0, x1, y1) {
  const L = V.txt.get(p), ra = pgH(p) / V.w; let out = [];
  const a = Array.isArray(L) && L.length ? segAt(L, x0, y0, true, ra) : null;
  if (a) {
    const b = segAt(L, x1, y1, false, ra) || a;
    if (a === b) { const l = snapX(a, Math.min(x0, x1)), r = snapX(a, Math.max(x0, x1)); out = [[l, a.t, r - l, a.b - a.t]]; }
    else {
      const ia = L.indexOf(a), ib = L.indexOf(b);
      const [s, e, xs, xe] = ia < ib ? [a, b, x0, x1] : [b, a, x1, x0]; const i0 = Math.min(ia, ib), i1 = Math.max(ia, ib);
      const lo = Math.min(s.l, e.l), hi = Math.max(s.r, e.r); const sx = snapX(s, xs);
      out = [[sx, s.t, s.r - sx, s.b - s.t]];
      for (let k = i0 + 1; k < i1; k++) { const g = L[k]; if (g.r > lo && g.l < hi) out.push([g.l, g.t, g.r - g.l, g.b - g.t]); }
      const ex = snapX(e, xe); out.push([e.l, e.t, ex - e.l, e.b - e.t]);
    }
  } else {
    // página sem texto (imagem): faixa reta na altura do toque
    const h = 0.016, l = Math.min(x0, x1); out = [[l, y0 - h / 2, Math.abs(x1 - x0), h]];
  }
  return out.filter(q => q[2] > 0.003).map(q => q.map(rnd));
}
function pageAt(x, y) {
  const d = document.elementFromPoint(x, y)?.closest('.pg'); if (!d) return null;
  const r = d.getBoundingClientRect();
  return { d, p: +d.dataset.p, nx: (x - r.left) / r.width, ny: (y - r.top) / r.height };
}
const rnd = v => Math.round(v * 10000) / 10000;
function eraseAt(hit) {
  const ops = V.ann.get(hit.p); if (!ops?.length) return false;
  const R = 0.02, ratio = pgH(hit.p) / V.w;
  const keep = ops.filter(op => {
    if (op.t === 'x') { const lines = String(op.s).split('\n'); const wd = Math.max(...lines.map(l => l.length)) * op.z * 0.6, ht = lines.length * op.z * 1.2 / ratio; return !(hit.nx >= op.x - R && hit.nx <= op.x + wd + R && hit.ny >= op.y - R && hit.ny <= op.y + ht + R); }
    if (op.t === 'r') return !op.r.some(([x, y, w, h]) => hit.nx >= x - 0.006 && hit.nx <= x + w + 0.006 && hit.ny >= y - 0.004 && hit.ny <= y + h + 0.004);
    for (let k = 0; k < op.pts.length; k += 2) { const dx = op.pts[k] - hit.nx, dy = (op.pts[k + 1] - hit.ny) * ratio; if (dx * dx + dy * dy < (R + op.w / 2) ** 2) return false; }
    return true;
  });
  if (keep.length === ops.length) return false;
  snapshot(hit.p); V.ann.set(hit.p, keep); drawInk(hit.p); saveAnn(hit.p); return true;
}
function textAt(hit, existing) {
  const f = $('#dlgForm');
  f.innerHTML = `<h3>${existing ? 'Editar texto' : 'Texto na página ' + hit.p}</h3><textarea id="tTxt" placeholder="Ex.: B, ou: caiu na prova">${esc(existing?.s || '')}</textarea>
  <div class="row" style="margin-top:10px">${existing ? '<button type="button" class="btn bad" id="tDel">Excluir</button>' : ''}<span class="sp"></span><button type="button" class="btn" id="tC">Cancelar</button><button type="button" class="btn pri" id="tOk">Salvar</button></div>`;
  const done = async (txt) => {
    snapshot(hit.p); const ops = (V.ann.get(hit.p) || []).filter(o => o !== existing);
    if (txt) ops.push({ t: 'x', x: existing?.x ?? rnd(hit.nx), y: existing?.y ?? rnd(hit.ny), s: txt, c: existing?.c ?? V.color.x, z: 0.032 });
    V.ann.set(hit.p, ops); drawInk(hit.p); await saveAnn(hit.p); $('#dlg').close();
  };
  $('#tC', f).onclick = () => $('#dlg').close();
  $('#tOk', f).onclick = () => done($('#tTxt', f).value.trim());
  if (existing) $('#tDel', f).onclick = () => done('');
  $('#dlg').showModal(); setTimeout(() => $('#tTxt', f).focus(), 50);
}
function textHit(hit) {
  const ratio = pgH(hit.p) / V.w;
  return (V.ann.get(hit.p) || []).find(op => op.t === 'x' && hit.nx >= op.x - 0.01 && hit.nx <= op.x + String(op.s).length * op.z * 0.6 + 0.01 && hit.ny >= op.y - 0.01 && hit.ny <= op.y + String(op.s).split('\n').length * op.z * 1.2 / ratio + 0.01);
}
vp.addEventListener('pointerdown', e => {
  if (!V.tool) return;
  e.preventDefault(); vp.setPointerCapture?.(e.pointerId);
  V.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), x0: e.clientX, y0: e.clientY });
  if (V.ptrs.size >= 2) {
    if (V.stroke) { const { p } = V.stroke; V.stroke = null; drawInk(p); }
    const [a, b] = [...V.ptrs.values()]; V.pan = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return;
  }
  const hit = pageAt(e.clientX, e.clientY); if (!hit) return;
  if (V.tool === 'e') { V.erasing = true; eraseAt(hit); return; }
  if (V.tool === 'h') {
    const ink = ensureInk(hit.d, hit.p); textLines(hit.p);
    V.stroke = { p: hit.p, ink, hl: true, x0: hit.nx, y0: hit.ny, op: { t: 'r', c: V.color.h, a: HA, r: [] } };
    return;
  }
  if (V.tool === 'p') {
    const ink = ensureInk(hit.d, hit.p); const ctx = ink.getContext('2d');
    V.stroke = { p: hit.p, ink, ctx, op: { t: 'p', c: V.color.p, w: 0.004, pts: [rnd(hit.nx), rnd(hit.ny)] } };
    ctx.strokeStyle = V.stroke.op.c; ctx.lineWidth = V.stroke.op.w * ink.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
}, { passive: false });
vp.addEventListener('pointermove', e => {
  if (!V.tool || !V.ptrs.has(e.pointerId)) return;
  e.preventDefault();
  const pt = V.ptrs.get(e.pointerId); pt.x = e.clientX; pt.y = e.clientY;
  if (V.pan && V.ptrs.size >= 2) {
    const [a, b] = [...V.ptrs.values()]; const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    vp.scrollBy(V.pan.x - m.x, V.pan.y - m.y); V.pan = m; return;
  }
  if (V.erasing) { const hit = pageAt(e.clientX, e.clientY); if (hit) eraseAt(hit); return; }
  const s = V.stroke; if (!s) return;
  const r = s.ink.getBoundingClientRect(); const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
  if (s.hl) {
    s.x1 = nx; s.y1 = ny;
    if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; if (V.stroke !== s) return; s.op.r = hlRects(s.p, s.x0, s.y0, s.x1, s.y1); drawInk(s.p, s.op); });
    return;
  }
  const P = s.op.pts, lx = P[P.length - 2], ly = P[P.length - 1];
  if (Math.hypot(nx - lx, (ny - ly) * pgH(s.p) / V.w) < 0.0025) return;
  s.ctx.beginPath(); s.ctx.moveTo(lx * s.ink.width, ly * s.ink.height); s.ctx.lineTo(nx * s.ink.width, ny * s.ink.height); s.ctx.stroke();
  P.push(rnd(nx), rnd(ny));
}, { passive: false });
function endPointer(e) {
  if (!V.ptrs.has(e.pointerId)) return;
  const pt = V.ptrs.get(e.pointerId); V.ptrs.delete(e.pointerId);
  if (V.pan) { if (!V.ptrs.size) V.pan = null; return; }
  V.erasing = false;
  if (V.tool === 'x' && Math.hypot(pt.x - pt.x0, pt.y - pt.y0) < 12 && Date.now() - pt.t < 600) {
    const hit = pageAt(pt.x, pt.y); if (hit) textAt(hit, textHit(hit)); return;
  }
  const s = V.stroke; V.stroke = null; if (!s) return;
  if (s.hl) {
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.x1 != null) s.op.r = hlRects(s.p, s.x0, s.y0, s.x1, s.y1);
    if (!s.op.r.length) { drawInk(s.p); return; }
  }
  snapshot(s.p); const ops = V.ann.get(s.p) || []; ops.push(s.op); V.ann.set(s.p, ops); drawInk(s.p); saveAnn(s.p);
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);

function paintNote() {
  const el = $('#vNote'); if (!el) return;
  el.hidden = !V.annOld;
  if (V.annOld) el.innerHTML = `Marcações em ${V.annOld} página(s) foram feitas na versão antiga deste PDF e podem estar fora do lugar. <button class="chip" id="vClearOld">Apagar marcações deste PDF</button>`;
}
async function limparMarcacoes() {
  if (!V.file || !confirm('Apagar todas as marcações deste PDF? Dá para desfazer só restaurando um backup.')) return;
  const ks = await run('kv', 'readonly', s => s.getAllKeys(aRange(V.file + '|'))); const ver = aula(V.aula)?.ver;
  for (const k of ks) await kvSet(k, { u: Date.now(), o: [], v: ver });
  V.ann = new Map(); V.undo = []; V.annOld = 0; [...V.rendered.keys()].forEach(drawInk); paintNote(); scheduleSync(); toast('Marcações deste PDF apagadas.');
}
$('#vNote').onclick = e => { if (e.target.id === 'vClearOld') limparMarcacoes(); };

function paintTools() {
  const on = !!V.tool;
  $('#vTools').hidden = !on; $('#vPen').classList.toggle('on', on);
  vp.style.touchAction = on ? 'none' : '';
  $$('#vTools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === V.tool));
  const pal = V.tool === 'h' ? HL : V.tool === 'e' ? [] : PEN;
  $('#vColors').innerHTML = pal.map(c => `<button class="sw ${V.color[V.tool] === c ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${CNOME[c] || 'Cor'}" title="${CNOME[c] || ''}"></button>`).join('');
  if (V.tool === 'h' && V.doc) for (let k = Math.max(1, V.cur - 1); k <= Math.min(V.doc.numPages, V.cur + 2); k++) textLines(k);
}
$('#vPen').onclick = () => { V.tool = V.tool ? null : 'p'; paintTools(); };
$('#vTools').onclick = async e => {
  const t = e.target.closest('[data-tool]'); if (t) { V.tool = t.dataset.tool; paintTools(); return; }
  const c = e.target.closest('[data-c]'); if (c) { V.color[V.tool] = c.dataset.c; paintTools(); return; }
  const id = e.target.closest('button')?.id;
  if (id === 'vUndo') { const u = V.undo.pop(); if (!u) return toast('Nada para desfazer.'); V.ann.set(u.p, u.ops); drawInk(u.p); await saveAnn(u.p); if (u.p !== V.cur) goPage(u.p); }
  if (id === 'vDone') { V.tool = null; paintTools(); }
  if (id === 'vClear') limparMarcacoes();
};


/* ---------------- sincronização entre aparelhos (pasta do Drive + FolderSync) ---------------- */
const hasFS = 'showDirectoryPicker' in window;
const devPadrao = () => /iPad|Tablet/i.test(navigator.userAgent) || (/Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent)) ? 'tablet' : /Android|iPhone|Mobile/i.test(navigator.userAgent) ? 'celular' : 'pc';
const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'aparelho';
const ownFile = () => `estudo-ti-${slug(S.set.device)}.json`;
const brHora = isoS => { const d = new Date(isoS); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
let syncDir = null, syncBusy = false, syncTimer = null;
async function buildBackup() {
  return { app: 'estudo-ti', versao: 3, device: S.set.device, criado: new Date().toISOString(), prog: S.prog, set: S.set, erros: S.erros, del: S.del, anot: await anotAll() };
}
async function salvarEste() {
  const data = await buildBackup();
  download(ownFile(), JSON.stringify(data), 'application/json');
  S.lastBackup = S.lastSync = data.criado; await kvSet('lastBackup', S.lastBackup); await kvSet('lastSync', S.lastSync);
  toast(`${ownFile()} salvo em Downloads.`); render();
}
function syncCelular() { S.bkMode = 'sync'; $('#bkInput').click(); }
async function syncPerm(ask) {
  if (!syncDir) return false; const o = { mode: 'readwrite' };
  try { if ((await syncDir.queryPermission(o)) === 'granted') return true; if (ask) return (await syncDir.requestPermission(o)) === 'granted'; } catch {}
  return false;
}
async function escolherPasta() {
  try {
    const h = await window.showDirectoryPicker({ id: 'estudo-ti-sync', mode: 'readwrite' });
    syncDir = h; await kvSet('syncDir', h); await kvSet('syncSeen', {}); S.syncDirty = true; await syncNow(true); render();
  } catch (e) { if (e?.name !== 'AbortError') toast('Não consegui usar essa pasta.'); }
}
async function syncNow(ask = false, silent = false) {
  if (!syncDir || syncBusy) return;
  if (!(await syncPerm(ask))) { S.syncOff = true; paintTop(); return; }
  if (S.syncOff) { S.syncOff = false; paintTop(); }
  syncBusy = true;
  try {
    const own = ownFile(); const seen = (await kvGet('syncSeen')) || {}; const tot = { novos: 0, atual: 0, rem: 0, ses: 0, pags: 0 };
    let ownExists = false;
    for await (const [name, h] of syncDir.entries()) {
      if (name === own) { ownExists = true; continue; }
      if (h.kind !== 'file' || !/^estudo-ti-.*\.json$/i.test(name)) continue;
      const f = await h.getFile(); if (seen[name] === f.lastModified) continue;
      try {
        const data = JSON.parse(await f.text());
        if (data?.app === 'estudo-ti') { const r = await mergeData(data); for (const k in tot) tot[k] += r[k]; }
        seen[name] = f.lastModified;
        if (/ \(\d+\)\.json$/i.test(name)) { await syncDir.removeEntry(name); delete seen[name]; }
      } catch (err) { console.warn('sync', name, err); }
    }
    await kvSet('syncSeen', seen);
    const n = Object.values(tot).reduce((a, b) => a + b, 0);
    if (S.syncDirty || n || !ownExists) {
      const fh = await syncDir.getFileHandle(own, { create: true }); const w = await fh.createWritable();
      await w.write(JSON.stringify(await buildBackup())); await w.close(); S.syncDirty = false;
      S.lastSync = S.lastBackup = new Date().toISOString(); await kvSet('lastSync', S.lastSync); await kvSet('lastBackup', S.lastBackup);
    }
    if (n) { if (!silent) toast(mergeMsg(tot), 5000); render(); } else if (S.tab === 'mais') render(); else paintTop();
  } catch (err) { console.warn('sync', err); } finally { syncBusy = false; clearTimeout(syncTimer); }
}
function scheduleSync() {
  S.syncDirty = true; if (!syncDir || S.syncOff) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 4000);
}
setInterval(() => { if (syncDir && document.visibilityState === 'visible') syncNow(); }, 90000);
document.addEventListener('visibilitychange', () => { if (syncDir) syncNow(false, true); });
$('#syncBtn').onclick = () => { if (hasFS) { if (syncDir) syncNow(true); else setTab('mais'); } else syncCelular(); };
function syncCard() {
  const dev = `<label>Nome deste aparelho</label><input id="mDev" type="text" value="${esc(S.set.device)}">`;
  const ult = S.lastSync ? `Última: ${brHora(S.lastSync)}` : 'Nunca sincronizado';
  if (hasFS) return `<div class="card"><h3>Sincronização</h3>${dev}
   <div class="small" style="margin-top:8px">Pasta: <b>${syncDir ? esc(syncDir.name) : 'nenhuma'}</b>${syncDir ? (S.syncOff ? ' · <span class="warn">sem permissão</span>' : ' · <span class="good">conectada</span>') : ''} · ${ult}</div>
   <p class="small mut">Escolha a pasta sincronizada: no PC, a pasta EstudoTI do Google Drive; no Android, uma pasta como Documents › EstudoTI que o FolderSync espelha com o Drive (o Android não deixa usar a raiz de Download). Cada aparelho precisa de um nome diferente. O app grava ${esc(ownFile())} nela e mescla sozinho os arquivos dos outros aparelhos, ao abrir, a cada 90 s e depois de cada mudança.</p>
   <div class="row wrap"><button class="btn pri" id="mPasta">${syncDir ? 'Trocar pasta' : 'Escolher pasta'}</button>${syncDir ? '<button class="btn" id="mSyncNow">Sincronizar agora</button><button class="btn bad" id="mSyncOff">Desligar</button>' : ''}</div></div>`;
  return `<div class="card"><h3>Sincronização</h3>${dev}
   <p class="small mut">Sincronizar (também no ⇅ do topo): você escolhe o arquivo do outro aparelho (ex.: estudo-ti-pc.json), o app mescla e salva ${esc(ownFile())} em Downloads. O FolderSync leva os arquivos entre Downloads e a pasta do Drive.</p>
   <div class="small">${ult}</div>
   <div class="row wrap" style="margin-top:8px"><button class="btn pri" id="mSyncCel">Sincronizar</button><button class="btn" id="mSalvar">Só salvar este aparelho</button></div></div>`;
}

async function hashPendentes() {
  let any = false;
  for (const f of [...S.pdfs]) {
    if (S.pv[f]) continue;
    try { const b = await pdfGet(f); if (!b) continue; const h = await fileHash(b); S.pv[f] = h; await kvSet('pv|' + f, h); any = true; } catch {}
  }
  if (any && Object.values(S.C.aulas).some(outdated)) render();
}
/* ---------------- inicialização ---------------- */
async function init() {
  S.C = await (await fetch('cronograma.json')).json();
  S.prog = (await kvGet('prog')) || {};
  S.set = { ...S.set, ...((await kvGet('set')) || {}) };
  S.erros = await errAll(); S.del = (await kvGet('del')) || {}; await migrarUids();
  S.pdfs = new Set(await pdfKeys());
  { const ks = await run('kv', 'readonly', s => s.getAllKeys(IDBKeyRange.bound('pv|', 'pv|\uffff'))); const vs = await run('kv', 'readonly', s => s.getAll(IDBKeyRange.bound('pv|', 'pv|\uffff'))); ks.forEach((k, i) => (S.pv[k.slice(3)] = vs[i])); }
  S.lastBackup = (await kvGet('lastBackup')) || null;
  S.set.device ||= devPadrao(); S.lastSync = (await kvGet('lastSync')) || null; S.syncDirty = true;
  if (hasFS) syncDir = (await kvGet('syncDir')) || null;
  tLoad(); render();
  if (syncDir) syncNow(false, true);
  hashPendentes();
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}
if ('serviceWorker' in navigator) {
  let tinhaSW = !!navigator.serviceWorker.controller, recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaSW) { tinhaSW = true; return; }
    if (recarregou) return;
    recarregou = true;
    if ($('#viewer').hidden) location.reload();
    else { S.reloadPending = true; toast('Nova versão pronta. Ela entra quando você fechar o PDF.', 6000); }
  });
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; reg.update?.(); }).catch(() => {});
}
// o app instalado fica dias aberto em segundo plano (Android): ao voltar, refaz as datas se o dia mudou e procura versão nova
let swReg = null;
function aoVoltar() {
  if (document.visibilityState !== 'visible') return;
  if (diaRender && diaRender !== todayISO()) render();
  swReg?.update?.().catch(() => {});
}
document.addEventListener('visibilitychange', aoVoltar);
window.addEventListener('pageshow', aoVoltar);
setInterval(() => { if (document.visibilityState === 'visible' && diaRender && diaRender !== todayISO()) render(); }, 60000);
init().catch(err => { $('#view').innerHTML = `<div class="card bad">Erro ao iniciar: ${esc(err.message)}</div>`; console.error(err); });
