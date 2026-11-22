'use strict';
// HIZLI YARIŞMA - web sunucusu (ek kütüphane gerekmez, sadece Node.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

// ===== AYARLAR =====
const PORT = process.env.PORT || 3000;
const SORU_SURESI = 30;     // saniye
const SORULAR_ARASI = 1;    // saniye
const CEVAPSIZ_LIMIT = 3;   // üst üste bu kadar soru cevapsız kalırsa duraklar
// ===================

const dosya = (ad) => path.join(__dirname, ad);
const norm = (s) => s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
  .replace(/[çğıöşüâîû]/g, (c) => 'cgiosuaiu'['çğıöşüâîû'.indexOf(c)])
  .replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean).join(' ');
const karistir = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pubOf = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);
const harfMi = (c) => /[\p{L}\p{N}]/u.test(c);

const sorular = [];
for (let satir of fs.readFileSync(dosya('sorular.txt'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  satir = satir.trim();
  const i = satir.lastIndexOf('*');
  if (!satir || satir[0] === '#' || i < 0) continue;
  const cevaplar = satir.slice(i + 1).split('|').map((c) => c.trim()).filter(Boolean);
  if (satir.slice(0, i).trim() && cevaplar.length) sorular.push({ soru: satir.slice(0, i).trim(), cevaplar });
}
if (!sorular.length) { console.log('HATA: sorular.txt içinde soru yok.'); process.exit(1); }

let puanlar = {};
try { puanlar = JSON.parse(fs.readFileSync(dosya('puanlar.json'), 'utf8')); } catch (e) {}
let kayitBekliyor = false;
const puanKaydet = () => { if (kayitBekliyor) return; kayitBekliyor = true;
  setTimeout(() => { kayitBekliyor = false; try { fs.writeFileSync(dosya('puanlar.json'), JSON.stringify(puanlar)); } catch (e) {} }, 2000); };
const liste = () => Object.entries(puanlar).map(([id, k]) => ({ nick: k.nick, puan: k.puan, pub: pubOf(id) }))
  .sort((a, b) => b.puan - a.puan).slice(0, 10);

const istemciler = new Map(); // id -> {res, nick, pub, son}
const yayinla = (olay, veri) => { const m = `event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`; for (const c of istemciler.values()) c.res.write(m); };

let deste = [];
const oyun = { durum: 'bos', soru: '', cevaplar: [], gosterilen: '', baslangic: 0, sonraki: 0, ipucuSeviye: 0, sira: [], ipucu: '', cevapsiz: 0 };

function yeniSoru() {
  if (!deste.length) deste = karistir([...sorular]);
  const s = deste.pop();
  Object.assign(oyun, { soru: s.soru, gosterilen: s.cevaplar[0], cevaplar: s.cevaplar.map(norm), durum: 'soru', baslangic: Date.now(), ipucuSeviye: 0, ipucu: '' });
  oyun.sira = karistir([...oyun.gosterilen].map((c, i) => (harfMi(c) ? i : -1)).filter((i) => i >= 0));
  yayinla('soru', { soru: oyun.soru, sure: SORU_SURESI });
}
function ipucuUret(oran) {
  const n = oyun.sira.length; let k = Math.max(1, Math.ceil(n * oran)); if (k >= n) k = n - 1;
  const acik = new Set(oyun.sira.slice(0, k));
  return [...oyun.gosterilen].map((c, i) => (harfMi(c) ? (acik.has(i) ? c : '_') : c)).join(' ');
}
function ara(cevapsizMi) {
  oyun.durum = 'ara'; oyun.sonraki = Date.now() + SORULAR_ARASI * 1000;
  oyun.cevapsiz = cevapsizMi ? oyun.cevapsiz + 1 : 0;
}
setInterval(() => {
  const simdi = Date.now();
  if (istemciler.size === 0) { oyun.durum = 'bos'; return; }
  if (oyun.durum === 'soru') {
    const gecen = (simdi - oyun.baslangic) / 1000;
    if (oyun.ipucuSeviye === 0 && gecen >= SORU_SURESI / 3) { oyun.ipucuSeviye = 1; oyun.ipucu = ipucuUret(0.25); yayinla('ipucu', { metin: oyun.ipucu }); }
    else if (oyun.ipucuSeviye === 1 && gecen >= SORU_SURESI * 2 / 3) { oyun.ipucuSeviye = 2; oyun.ipucu = ipucuUret(0.5); yayinla('ipucu', { metin: oyun.ipucu }); }
    if (gecen >= SORU_SURESI) {
      ara(true); yayinla('sureDoldu', { cevap: oyun.gosterilen });
      if (oyun.cevapsiz >= CEVAPSIZ_LIMIT) { oyun.durum = 'duraklat'; yayinla('duraklat', {}); }
    }
  } else if (oyun.durum === 'ara' && simdi >= oyun.sonraki) yeniSoru();
}, 250);
setInterval(() => { for (const c of istemciler.values()) c.res.write(': ping\n\n'); }, 20000);

function dogru(id) {
  const c = istemciler.get(id), sure = Math.round((Date.now() - oyun.baslangic) / 100) / 10;
  ara(false);
  const k = puanlar[id] || (puanlar[id] = { nick: c.nick, puan: 0 }); k.nick = c.nick; k.puan++; puanKaydet();
  yayinla('dogru', { nick: c.nick, pub: c.pub, sure, cevap: oyun.gosterilen, puan: k.puan });
  yayinla('puanlar', liste());
}

const sayfa = fs.readFileSync(dosya('index.html'));
const govde = (req, cb) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 2000) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (e) { cb(null); } }); };
const json = (res, kod, o) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }); return res.end(sayfa);
  }
  if (u.pathname === '/saglik') return res.end('ok');
  if (req.method === 'GET' && u.pathname === '/olaylar') {
    const id = u.searchParams.get('id') || '';
    const nick = (u.searchParams.get('nick') || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Oyuncu';
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || (istemciler.size >= 300 && !istemciler.has(id))) { res.writeHead(400); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const eski = istemciler.get(id); if (eski) eski.res.end();
    const c = { res, nick, pub: pubOf(id), son: 0 };
    istemciler.set(id, c);
    if (oyun.durum === 'bos' || oyun.durum === 'duraklat') { oyun.durum = 'ara'; oyun.sonraki = Date.now() + 3000; oyun.cevapsiz = 0; }
    const soruda = oyun.durum === 'soru';
    res.write(`event: durum\ndata: ${JSON.stringify({ pub: c.pub, durum: oyun.durum, soru: soruda ? oyun.soru : '', kalanMs: soruda ? Math.max(0, SORU_SURESI * 1000 - (Date.now() - oyun.baslangic)) : 0, sure: SORU_SURESI, ipucu: soruda ? oyun.ipucu : '', puanlar: liste() })}\n\n`);
    yayinla('cevrimici', { sayi: istemciler.size });
    req.on('close', () => { if (istemciler.get(id) === c) { istemciler.delete(id); yayinla('cevrimici', { sayi: istemciler.size }); } });
    return;
  }
  if (req.method === 'POST' && (u.pathname === '/api/cevap' || u.pathname === '/api/devam')) {
    return govde(req, (b) => {
      const c = b && istemciler.get(b.id);
      if (!c) return json(res, 400, { ok: false });
      if (u.pathname === '/api/devam') { if (oyun.durum === 'duraklat') { oyun.durum = 'ara'; oyun.sonraki = Date.now() + 2000; oyun.cevapsiz = 0; } return json(res, 200, { ok: true }); }
      const simdi = Date.now(); if (simdi - c.son < 250) return json(res, 429, { ok: false }); c.son = simdi;
      if (oyun.durum !== 'soru' || typeof b.metin !== 'string') return json(res, 200, { ok: false });
      if (oyun.cevaplar.includes(norm(b.metin.slice(0, 100)))) { dogru(b.id); return json(res, 200, { ok: true, dogru: true }); }
      json(res, 200, { ok: true, dogru: false });
    });
  }
  res.writeHead(404); res.end('Bulunamadı');
}).listen(PORT, () => console.log('Yarışma sunucusu çalışıyor: http://localhost:' + PORT));
