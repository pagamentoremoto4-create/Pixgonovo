require('dotenv').config();

const express = require('express');
const axios = require('axios');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PIXGO_API = 'https://pixgo.org/api/v1';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const DB_DIR = path.dirname(DB_PATH);
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const ADMIN_NUMBER = onlyDigits(process.env.ADMIN_NUMBER || '');
const ADMIN_PANEL_USER = process.env.ADMIN_PANEL_USER || 'admin';
const ADMIN_PANEL_PASS = process.env.ADMIN_PANEL_PASS || '123456';

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let sock = null;
let qrCodeBase64 = null;
let conectado = false;
let db = new sqlite3.Database(DB_PATH);

const pedidoSessao = new Map();
const adminSessao = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}
function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
function jidToNumber(jid) { return onlyDigits(String(jid || '').split('@')[0]); }
function numberToJid(number) { return `${onlyDigits(number)}@s.whatsapp.net`; }
function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function today() { return new Date().toISOString().slice(0, 10); }
function dateSql(d = new Date()) { return d.toISOString().slice(0, 19).replace('T', ' '); }
function getText(msg) { return msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || ''; }
function isGroup(jid) { return String(jid || '').endsWith('@g.us'); }
function isAdminNumber(n) { return ADMIN_NUMBER && onlyDigits(n) === ADMIN_NUMBER; }
function isAdminJid(jid) { return isAdminNumber(jidToNumber(jid)); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function statusClass(status) { return String(status||'').replace(/\s+/g,'-').toLowerCase(); }

async function addColumnIfMissing(table, column, definition) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS revendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    whatsapp TEXT,
    jid TEXT,
    login TEXT UNIQUE,
    senha TEXT,
    status TEXT DEFAULT 'ATIVA',
    saldo REAL DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS servicos_catalogo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    preco_padrao REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS precos_revenda (
    revenda_id INTEGER,
    servico_id INTEGER,
    preco REAL DEFAULT 0,
    PRIMARY KEY (revenda_id, servico_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origem TEXT DEFAULT 'REVENDA',
    cliente_nome TEXT,
    cliente_numero TEXT,
    cliente_jid TEXT,
    revenda_id INTEGER,
    revenda_nome TEXT,
    revenda_jid TEXT,
    revenda_numero TEXT,
    servico_id INTEGER,
    servico_nome TEXT,
    imei TEXT,
    valor REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDENTE',
    motivo_cancelamento TEXT,
    cobrado INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revenda_id INTEGER,
    revenda_nome TEXT,
    cliente_jid TEXT,
    cliente_numero TEXT,
    valor REAL,
    origem TEXT,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pix_pedidos (
    payment_id TEXT PRIMARY KEY,
    revenda_id INTEGER,
    revenda_jid TEXT,
    cliente_jid TEXT,
    cliente_numero TEXT,
    valor REAL,
    status TEXT DEFAULT 'pending',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await addColumnIfMissing('revendas', 'jid', 'TEXT');
  await addColumnIfMissing('revendas', 'login', 'TEXT');
  await addColumnIfMissing('revendas', 'senha', 'TEXT');
  await addColumnIfMissing('pedidos', 'origem', "TEXT DEFAULT 'REVENDA'");
  await addColumnIfMissing('pedidos', 'cliente_nome', 'TEXT');
  await addColumnIfMissing('pedidos', 'cliente_numero', 'TEXT');
  await addColumnIfMissing('pedidos', 'cliente_jid', 'TEXT');
  await addColumnIfMissing('pix_pedidos', 'cliente_jid', 'TEXT');
  await addColumnIfMissing('pix_pedidos', 'cliente_numero', 'TEXT');
  await addColumnIfMissing('pagamentos', 'cliente_jid', 'TEXT');
  await addColumnIfMissing('pagamentos', 'cliente_numero', 'TEXT');

  const qtdServ = await get('SELECT COUNT(*) as qtd FROM servicos_catalogo');
  if (!qtdServ.qtd) {
    await run('INSERT INTO servicos_catalogo (nome, preco_padrao) VALUES (?, ?)', ['Desbloqueio TIM', 0]);
    await run('INSERT INTO servicos_catalogo (nome, preco_padrao) VALUES (?, ?)', ['Bloqueio TIM', 0]);
    await run('INSERT INTO servicos_catalogo (nome, preco_padrao) VALUES (?, ?)', ['Desbloqueio Claro', 0]);
    await run('INSERT INTO servicos_catalogo (nome, preco_padrao) VALUES (?, ?)', ['Desbloqueio SSP', 0]);
  }
}

function basicAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const [type, token] = h.split(' ');
  if (type === 'Basic' && token) {
    const [u, p] = Buffer.from(token, 'base64').toString().split(':');
    if (u === ADMIN_PANEL_USER && p === ADMIN_PANEL_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="CentralUnlocker Admin"');
  return res.status(401).send('Login necessário');
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>
  :root{--bg:#07111f;--panel:#0b1728;--panel2:#101d32;--line:#21324d;--txt:#e5eefc;--muted:#8fa2bf;--blue:#2563eb;--green:#16a34a;--red:#dc2626;--orange:#f97316;--cyan:#06b6d4}*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#06111f,#111827);color:var(--txt);margin:0}a{color:#93c5fd;text-decoration:none}.layout{display:flex;min-height:100vh}.side{width:245px;background:#07101d;border-right:1px solid var(--line);padding:18px;position:sticky;top:0;height:100vh}.brand{font-weight:800;font-size:20px;margin-bottom:24px;color:white}.side a{display:block;padding:12px 14px;border-radius:12px;margin:6px 0;color:#cbd5e1}.side a:hover{background:#13243c}.main{flex:1}.topbar{height:64px;background:rgba(15,23,42,.7);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 22px;position:sticky;top:0;backdrop-filter:blur(8px);z-index:2}.wrap{max-width:1400px;margin:0 auto;padding:22px}.card{background:rgba(15,29,50,.9);border:1px solid var(--line);border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 10px 30px rgba(0,0,0,.2)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.metric h2{font-size:15px;color:var(--muted);margin:0 0 10px}.metric h1{margin:0;font-size:32px}.btn{display:inline-block;background:var(--blue);color:white!important;padding:9px 12px;border-radius:10px;border:0;cursor:pointer;margin:3px;font-weight:700}.btn.red{background:var(--red)}.btn.green{background:var(--green)}.btn.gray{background:#475569}.btn.orange{background:var(--orange)}.btn.cyan{background:var(--cyan)}input,select,textarea{padding:10px;border-radius:10px;border:1px solid #334155;background:#020617;color:#e5e7eb;width:100%;box-sizing:border-box;margin:4px 0}table{width:100%;border-collapse:separate;border-spacing:0 8px}th{color:#9fb1ce;font-size:13px;text-transform:uppercase;text-align:left;padding:8px}td{background:#0f1b2d;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px}td:first-child{border-left:1px solid var(--line);border-radius:12px 0 0 12px}td:last-child{border-right:1px solid var(--line);border-radius:0 12px 12px 0}.muted{color:var(--muted)}.status{font-weight:800}.status.pendente{color:#facc15}.status.em-processo{color:#fb923c}.status.finalizado{color:#22c55e}.status.cancelado{color:#f87171}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.search{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.search>div{min-width:220px}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#17243b;color:#cbd5e1;font-size:12px}
  @media(max-width:800px){.layout{display:block}.side{width:auto;height:auto;position:relative}.side a{display:inline-block}.topbar{position:relative}.wrap{padding:12px}table{font-size:12px}.btn{padding:8px 9px}}
  </style></head><body><div class="layout"><aside class="side"><div class="brand">🏢 CentralUnlocker</div><a href="/admin">📊 Dashboard</a><a href="/admin/pedidos">📋 Pedidos</a><a href="/admin/revendas">🏪 Revendas</a><a href="/admin/servicos">🛠 Serviços</a><a href="/admin/financeiro">💰 Financeiro</a><a href="/admin/relatorios">📈 Relatórios</a><a href="/admin/backup">💾 Backup</a><a href="/admin/logout">🚪 Sair</a></aside><main class="main"><div class="topbar"><b>${title}</b><span class="muted">Admin</span></div><div class="wrap">${body}</div></main></div></body></html>`;
}

async function precoDaRevenda(revendaId, servicoId) {
  const pr = await get('SELECT preco FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [revendaId, servicoId]);
  if (pr && Number(pr.preco) > 0) return Number(pr.preco);
  const s = await get('SELECT preco_padrao FROM servicos_catalogo WHERE id=?', [servicoId]);
  return Number(s?.preco_padrao || 0);
}

async function getRevendaByJidOrNumber(jid) {
  const numero = jidToNumber(jid);
  let r = await get('SELECT * FROM revendas WHERE status="ATIVA" AND (jid=? OR whatsapp=?)', [jid, numero]);
  if (!r) return null;
  if (r.jid !== jid) await run('UPDATE revendas SET jid=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [jid, r.id]);
  return await get('SELECT * FROM revendas WHERE id=?', [r.id]);
}

async function textoMenuRevenda(revenda) {
  return `🏪 ${revenda.nome}\n\n1️⃣ Serviços\n2️⃣ Histórico\n3️⃣ Conta\n\nDigite uma opção:`;
}
async function listarServicosParaRevenda(revenda) {
  const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let texto = `🛠 Serviços Disponíveis\n\n`;
  for (let i = 0; i < servicos.length; i++) {
    const preco = await precoDaRevenda(revenda.id, servicos[i].id);
    texto += `${i + 1} - ${servicos[i].nome} - ${brl(preco)}\n`;
  }
  texto += '\nDigite o número do serviço:';
  return texto;
}
async function enviarTexto(to, text) { if (sock && to) await sock.sendMessage(to, { text }); }

async function iniciarWhatsApp() {
  await initDB();
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['Ubuntu', 'Chrome', '20.0.04'] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log('✅ QR CODE GERADO'); qrCodeBase64 = await QRCode.toDataURL(qr); conectado = false; }
    if (connection === 'open') { console.log('✅ WHATSAPP CONECTADO'); qrCodeBase64 = null; conectado = true; }
    if (connection === 'close') {
      conectado = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ WHATSAPP DESCONECTOU:', statusCode);
      if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => iniciarWhatsApp(), 5000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    const remote = msg.key.remoteJid;
    if (isGroup(remote)) return;
    const textoOriginal = getText(msg).trim();
    if (!textoOriginal) return;
    const texto = textoOriginal.toLowerCase();
    console.log('📩', remote, 'fromMe=', msg.key.fromMe, textoOriginal);
    try { await tratarWhatsApp(msg, remote, textoOriginal, texto); }
    catch (e) { console.log('❌ ERRO WA:', e); await enviarTexto(remote, '❌ Erro interno. Tente novamente.'); }
  });
}

async function tratarWhatsApp(msg, from, textoOriginal, texto) {
  const numero = jidToNumber(from);
  const partes = textoOriginal.trim().split(/\s+/);
  const fromMe = !!msg.key.fromMe;
  const nomeContato = msg.pushName || 'Cliente';

  // PIX LIVRE PARA QUALQUER PESSOA
  if (texto.startsWith('pagar')) {
    const valor = Number(String(partes[1] || '0').replace(',', '.'));
    if (!valor || valor < 10) { await enviarTexto(from, '❌ Informe um valor mínimo R$10.\n\nExemplo:\npagar 180'); return; }
    await enviarTexto(from, '⏳ Gerando PIX...');
    const pix = await gerarPix(valor, from);
    if (!pix) { await enviarTexto(from, '❌ Erro ao gerar PIX.'); return; }
    const paymentId = pix?.data?.payment_id || pix?.payment_id || pix?.data?.id || pix?.id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.qr_code;
    await enviarTexto(from, `✅ PIX GERADO\n\n💰 Valor: ${brl(valor)}\n\nVou enviar o copia e cola na próxima mensagem.\n⏳ Expira em 20 minutos.`);
    await enviarTexto(from, qrCode || 'PIX indisponível');
    if (paymentId) {
      const rev = await getRevendaByJidOrNumber(from);
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, cliente_numero, valor, status) VALUES (?, ?, ?, ?, ?, ?, "pending")', [paymentId, rev ? rev.id : null, rev ? from : null, from, numero, valor]);
      verificarPagamento(paymentId, rev ? rev.id : null, from, valor);
    }
    return;
  }

  // ADMIN WHATSAPP
  if ((isAdminJid(from) || fromMe) && texto === '/admin') { await enviarTexto(from, await adminMenuResumo()); return; }
  if (isAdminJid(from) && texto === 'backup') { const arq = await criarBackup(); await enviarTexto(from, `✅ BACKUP GERADO\n\n📁 ${path.basename(arq)}\n\n🏢 CentralUnlocker`); return; }

  // CADASTRO RÁPIDO DE CLIENTE FINAL: servico nome do servico valor imei
  if (fromMe && texto.startsWith('servico ')) {
    const imei = onlyDigits(partes[partes.length - 1]);
    const valor = Number(String(partes[partes.length - 2] || '0').replace(',', '.'));
    const nomeServico = partes.slice(1, -2).join(' ').trim();
    if (!nomeServico || !valor || !/^\d{14,17}$/.test(imei)) {
      await enviarTexto(from, '❌ Formato inválido.\n\nUse:\nservico desbloqueio tim 180 356789123456789');
      return;
    }
    const serv = await acharOuCriarServico(nomeServico, valor);
    const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
    if (duplicado) { await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return; }
    await run(`INSERT INTO pedidos (origem, cliente_nome, cliente_numero, cliente_jid, servico_id, servico_nome, imei, valor, status)
      VALUES ('CLIENTE', ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [nomeContato, numero, from, serv.id, serv.nome, imei, valor]);
    await enviarTexto(from, `✅ Serviço cadastrado\n\n🛠 ${serv.nome}\n📱 ${imei}\n💰 ${brl(valor)}\n\n📍 Pendente`);
    return;
  }

  const revenda = await getRevendaByJidOrNumber(from);
  if (!revenda) {
    if (texto === 'menu' || texto === 'servicos' || texto === '/servicos') await enviarTexto(from, '❌ Número não cadastrado como revenda.\n\nEntre em contato com a CentralUnlocker.');
    return;
  }

  if (texto === 'menu' || texto === '/menu') { pedidoSessao.set(from, { etapa: 'menu' }); await enviarTexto(from, await textoMenuRevenda(revenda)); return; }

  const sess = pedidoSessao.get(from);
  if (sess?.etapa === 'menu') {
    if (texto === '1') { pedidoSessao.set(from, { etapa: 'servico' }); await enviarTexto(from, await listarServicosParaRevenda(revenda)); return; }
    if (texto === '2') { pedidoSessao.delete(from); await enviarTexto(from, await textoHistoricoRevenda(revenda.id)); return; }
    if (texto === '3') { pedidoSessao.delete(from); await enviarTexto(from, textoContaRevenda(revenda)); return; }
  }

  if (texto === 'servicos' || texto === '/servicos') { pedidoSessao.set(from, { etapa: 'servico' }); await enviarTexto(from, await listarServicosParaRevenda(revenda)); return; }
  if (texto === 'historico' || texto === '/historico') { await enviarTexto(from, await textoHistoricoRevenda(revenda.id)); return; }
  if (texto === 'conta' || texto === '/conta' || texto === 'saldo' || texto === '/saldo') { await enviarTexto(from, textoContaRevenda(revenda)); return; }

  if (sess?.etapa === 'imei') {
    const imei = onlyDigits(textoOriginal);
    if (!/^\d{14,17}$/.test(imei)) { await enviarTexto(from, '❌ IMEI inválido. Envie apenas os números.'); return; }
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sess.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }
    const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
    if (duplicado) { pedidoSessao.delete(from); await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return; }
    const valor = await precoDaRevenda(revenda.id, servico.id);
    await run(`INSERT INTO pedidos (origem, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, valor, status)
      VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [revenda.id, revenda.nome, from, numero, servico.id, servico.nome, imei, valor]);
    pedidoSessao.delete(from);
    await enviarTexto(from, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n📱 ${imei}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`);
    return;
  }

  if ((sess?.etapa === 'servico') && /^\d+$/.test(texto)) {
    const pos = Number(texto);
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[pos - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'imei', servicoId: servico.id });
    await enviarTexto(from, '📱 Informe o IMEI:');
    return;
  }
}

async function acharOuCriarServico(nome, precoPadrao = 0) {
  const normal = nome.trim().replace(/\s+/g, ' ');
  let s = await get('SELECT * FROM servicos_catalogo WHERE lower(nome)=lower(?)', [normal]);
  if (!s) {
    const r = await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [normal, precoPadrao || 0]);
    s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [r.lastID]);
  }
  return s;
}
function textoContaRevenda(revenda) {
  return `💳 CONTA\n\n🏪 ${revenda.nome}\n\n💰 Saldo em aberto:\n${brl(revenda.saldo)}\n\nPara gerar PIX digite:\npagar valor\n\nExemplos:\npagar 100\npagar ${Number(revenda.saldo||0).toFixed(2)}`;
}
async function textoHistoricoRevenda(revendaId) {
  const rows = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 20', [revendaId]);
  if (!rows.length) return '📋 HISTÓRICO\n\nNenhum pedido encontrado.';
  let t = '📋 HISTÓRICO\n\n';
  for (const p of rows) t += `🛠 ${p.servico_nome}\n📱 ${p.imei}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
  return t.trim();
}
async function adminMenuResumo() {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas');
  return `🏢 CENTRALUNLOCKER ADMIN\n\n📊 Dashboard\n🟡 Pendentes: ${p.qtd}\n🔄 Em Processo: ${ep.qtd}\n✅ Finalizados: ${f.qtd}\n💰 A receber: ${brl(saldo.total)}\n\nComandos rápidos:\nbackup\n\nPainel Web:\n/admin`;
}

async function gerarPix(valor, cliente) {
  try {
    const response = await axios.post(`${PIXGO_API}/payment/create`, {
      amount: Number(valor), description: `Pagamento CentralUnlocker ${cliente}`,
      customer_name: 'Cliente WhatsApp', customer_cpf: '12345678901', customer_email: 'cliente@exemplo.com', customer_phone: '11999999999', customer_address: 'Rua Principal, 123', external_id: `pedido_${Date.now()}`
    }, { headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.PIXGO_API_KEY }, timeout: 30000 });
    return response.data;
  } catch (e) { console.log('ERRO PIXGO:', e.response?.data || e.message); return null; }
}
async function consultarStatus(paymentId) {
  try { return (await axios.get(`${PIXGO_API}/payment/${paymentId}/status`, { headers: { 'X-API-Key': process.env.PIXGO_API_KEY }, timeout: 15000 })).data; }
  catch (e) { return null; }
}
async function verificarPagamento(paymentId, revendaId, jid, valorPix) {
  let tentativas = 0;
  const interval = setInterval(async () => {
    tentativas++;
    const status = await consultarStatus(paymentId);
    if (status?.success && status.data?.status === 'completed') {
      clearInterval(interval);
      await run('UPDATE pix_pedidos SET status="completed" WHERE payment_id=?', [paymentId]);
      let msg = `✅ Pagamento confirmado\n\n💰 Valor: ${brl(valorPix)}\n\n🏢 CentralUnlocker`;
      if (revendaId) {
        const rev = await get('SELECT * FROM revendas WHERE id=?', [revendaId]);
        if (rev) {
          const novo = Math.max(0, Number(rev.saldo || 0) - Number(valorPix || 0));
          await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, revendaId]);
          await run('INSERT INTO pagamentos (revenda_id, revenda_nome, cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, ?, ?, "pixgo")', [revendaId, rev.nome, jid, jidToNumber(jid), valorPix]);
          msg = `✅ Pagamento confirmado\n\n💰 Valor: ${brl(valorPix)}\n💳 Novo saldo:\n${brl(novo)}\n\n🏢 CentralUnlocker`;
        }
      } else {
        await run('INSERT INTO pagamentos (cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, "pixgo_cliente")', [jid, jidToNumber(jid), valorPix]);
      }
      await enviarTexto(jid, msg);
    }
    if (status?.success && status.data?.status === 'expired') {
      clearInterval(interval); await run('UPDATE pix_pedidos SET status="expired" WHERE payment_id=?', [paymentId]); await enviarTexto(jid, '⌛ PIX expirado. Digite pagar valor para gerar outro.');
    }
    if (tentativas >= 40) clearInterval(interval);
  }, 30000);
}

async function notificarPedido(pedido, tipo, motivo = '') {
  const jid = pedido.revenda_jid || pedido.cliente_jid;
  if (!jid) return;
  if (tipo === 'processo') await enviarTexto(jid, `🔄 Serviço em processo\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n💰 Valor: ${brl(pedido.valor)}`);
  if (tipo === 'finalizar') {
    if (pedido.origem === 'REVENDA') {
      const rev = await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]);
      await enviarTexto(jid, `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\n💰 Valor: ${brl(pedido.valor)}\n\n💳 Saldo:\n${brl(rev?.saldo || 0)}\n\n🏢 CentralUnlocker`);
    } else {
      await enviarTexto(jid, `✅ Seu serviço foi concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\nDigite:\npagar ${Number(pedido.valor).toFixed(2)}\n\n🏢 CentralUnlocker`);
    }
  }
  if (tipo === 'cancelar') await enviarTexto(jid, `❌ Serviço cancelado\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\nMotivo:\n${motivo || 'Não informado'}\n\n🏢 CentralUnlocker`);
}

// HOME/QR
app.get('/', (req, res) => {
  if (qrCodeBase64) return res.send(page('QR', `<div class="card" style="text-align:center"><h1>📱 ESCANEIE O QR</h1><img src="${qrCodeBase64}" width="300"><p>WhatsApp > Aparelhos conectados</p></div>`));
  res.send(page('Online', `<div class="card" style="text-align:center"><h1>✅ CENTRALUNLOCKER ONLINE</h1><p>${conectado ? 'WhatsApp conectado ✅' : 'Aguardando QR...'}</p><p><a class="btn" href="/admin">Acessar painel admin</a></p></div>`));
});

app.use('/admin', basicAuth);
app.get('/admin/logout', (req, res) => res.status(401).send(page('Sair', '<h1>🚪 Sessão encerrada</h1><p>Feche o navegador para sair totalmente.</p>')));

app.get('/admin', async (req, res) => {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const c = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="CANCELADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas');
  const rev = await get('SELECT COUNT(*) qtd FROM revendas WHERE status="ATIVA"');
  const hoje = await get("SELECT COALESCE(SUM(valor),0) total FROM pedidos WHERE status='FINALIZADO' AND date(finalizado_em)=date('now','localtime')");
  res.send(page('Dashboard', `<h1>📊 Dashboard</h1><div class="grid">
  <div class="card metric"><h2>🟡 Pendentes</h2><h1>${p.qtd}</h1></div><div class="card metric"><h2>🔄 Em Processo</h2><h1>${ep.qtd}</h1></div><div class="card metric"><h2>✅ Finalizados</h2><h1>${f.qtd}</h1></div><div class="card metric"><h2>❌ Cancelados</h2><h1>${c.qtd}</h1></div><div class="card metric"><h2>💰 Total a receber</h2><h1>${brl(saldo.total)}</h1></div><div class="card metric"><h2>💵 Faturado hoje</h2><h1>${brl(hoje.total)}</h1></div><div class="card metric"><h2>🏪 Revendas ativas</h2><h1>${rev.qtd}</h1></div>
  </div>`));
});

function pedidoNome(o) { return o.origem === 'CLIENTE' ? (o.cliente_nome || 'Cliente') : (o.revenda_nome || 'Revenda'); }
function pedidoNumero(o) { return o.origem === 'CLIENTE' ? (o.cliente_numero || '-') : (o.revenda_numero || '-'); }
function pedidoRow(o, includeServico=true) {
  return `<tr><td>#${o.id}</td><td>${escapeHtml(o.imei)}</td>${includeServico?`<td>${escapeHtml(o.servico_nome)}</td>`:''}<td>${escapeHtml(pedidoNome(o))}</td><td>${escapeHtml(pedidoNumero(o))}</td><td>${brl(o.valor)}</td><td class="status ${statusClass(o.status)}">${o.status}</td><td style="white-space:nowrap">
  <form style="display:inline" method="post" action="/admin/pedido/${o.id}/editar-imei"><input name="imei" placeholder="Novo IMEI" style="width:135px"><button class="btn gray">✏️</button></form>
  <form style="display:inline" method="post" action="/admin/pedido/${o.id}/processo"><button class="btn orange">🔄</button></form>
  <form style="display:inline" method="post" action="/admin/pedido/${o.id}/finalizar"><button class="btn green">✅</button></form>
  <form style="display:inline" method="post" action="/admin/pedido/${o.id}/cancelar"><input name="motivo" placeholder="Motivo" style="width:120px"><button class="btn red">❌</button></form>
  </td></tr>`;
}

app.get('/admin/pedidos', async (req, res) => {
  const status = req.query.status || '';
  const q = (req.query.q || '').trim();
  const params = [];
  let where = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (q) { where.push('(imei LIKE ? OR cliente_numero LIKE ? OR cliente_nome LIKE ? OR revenda_numero LIKE ? OR revenda_nome LIKE ? OR servico_nome LIKE ?)'); for(let i=0;i<6;i++) params.push(`%${q}%`); }
  const rows = await all(`SELECT * FROM pedidos ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`, params);
  let html = `<div class="top"><h1>📋 Pedidos</h1><div><a class="btn gray" href="/admin/pedidos">Todos</a><a class="btn" href="/admin/pedidos?status=PENDENTE">Pendentes</a><a class="btn orange" href="/admin/pedidos?status=EM PROCESSO">Em Processo</a><a class="btn green" href="/admin/pedidos?status=FINALIZADO">Finalizados</a><a class="btn red" href="/admin/pedidos?status=CANCELADO">Cancelados</a></div></div>
  <div class="card"><form class="search"><div><label>🔍 Buscar IMEI, WhatsApp, nome ou serviço</label><input name="q" value="${escapeHtml(q)}"></div><button class="btn">Buscar</button></form></div>
  <table><tr><th>ID</th><th>IMEI</th><th>Serviço</th><th>Cliente/Revenda</th><th>WhatsApp</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const o of rows) html += pedidoRow(o, true);
  html += '</table>';
  res.send(page('Pedidos', html));
});

app.post('/admin/pedido/:id/editar-imei', async (req, res) => {
  const imei = onlyDigits(req.body.imei || '');
  if (/^\d{14,17}$/.test(imei)) await run('UPDATE pedidos SET imei=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [imei, req.params.id]);
  res.redirect(req.headers.referer || '/admin/pedidos');
});
app.post('/admin/pedido/:id/processo', async (req, res) => {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) { await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.id]); await notificarPedido(pedido, 'processo'); }
  res.redirect(req.headers.referer || '/admin/pedidos');
});
app.post('/admin/pedido/:id/finalizar', async (req, res) => {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) {
    await run('UPDATE pedidos SET status="FINALIZADO", finalizado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.id]);
    if (pedido.origem === 'REVENDA' && !pedido.cobrado) {
      await run('UPDATE revendas SET saldo=saldo+?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.valor, pedido.revenda_id]);
      await run('UPDATE pedidos SET cobrado=1 WHERE id=?', [pedido.id]);
    }
    const atualizado = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
    await notificarPedido(atualizado, 'finalizar');
  }
  res.redirect(req.headers.referer || '/admin/pedidos');
});
app.post('/admin/pedido/:id/cancelar', async (req, res) => {
  const motivo = req.body.motivo || 'Não informado';
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) { await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, pedido.id]); await notificarPedido(pedido, 'cancelar', motivo); }
  res.redirect(req.headers.referer || '/admin/pedidos');
});

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas WHERE status!="REMOVIDA" ORDER BY id DESC');
  let html = `<h1>🏪 Revendas</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome da revenda" required><input name="whatsapp" placeholder="WhatsApp 5575..." required></div><button class="btn green">Adicionar Revenda</button></form></div><table><tr><th>ID</th><th>Nome</th><th>WhatsApp</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) html += `<tr><td>${r.id}</td><td><form method="post" action="/admin/revenda/${r.id}/editar" class="search"><input name="nome" value="${escapeHtml(r.nome)}" style="width:180px"><input name="whatsapp" value="${escapeHtml(r.whatsapp||'')}" style="width:150px"><button class="btn gray">✏️</button></form></td><td>${r.whatsapp || '-'}</td><td>${r.status}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/precos">Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">Conta</a><form style="display:inline" method="post" action="/admin/revenda/${r.id}/toggle"><button class="btn orange">${r.status==='ATIVA'?'🔒 Bloquear':'🔓 Desbloquear'}</button></form><form style="display:inline" method="post" action="/admin/revenda/${r.id}/remover"><button class="btn red" onclick="return confirm('Remover revenda?')">🗑️</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Revendas', html));
});
app.post('/admin/revendas', async (req, res) => {
  const whatsapp = onlyDigits(req.body.whatsapp);
  await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status) VALUES (?, ?, ?, ?, ?, "ATIVA")', [req.body.nome, whatsapp, numberToJid(whatsapp), `rev_${whatsapp}`, `rev_${Date.now()}`]);
  res.redirect('/admin/revendas');
});
app.post('/admin/revenda/:id/editar', async (req, res) => {
  const whatsapp = onlyDigits(req.body.whatsapp);
  await run('UPDATE revendas SET nome=?, whatsapp=?, jid=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.nome, whatsapp, numberToJid(whatsapp), req.params.id]);
  res.redirect('/admin/revendas');
});
app.post('/admin/revenda/:id/toggle', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (r) await run('UPDATE revendas SET status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [r.status === 'ATIVA' ? 'BLOQUEADA' : 'ATIVA', r.id]);
  res.redirect('/admin/revendas');
});
app.post('/admin/revenda/:id/remover', async (req, res) => { await run('UPDATE revendas SET status="REMOVIDA", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.params.id]); res.redirect('/admin/revendas'); });

app.get('/admin/revenda/:id/precos', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let html = `<h1>💰 Preços - ${escapeHtml(r.nome)}</h1><form method="post"><table><tr><th>Serviço</th><th>Preço da revenda</th></tr>`;
  for (const s of servs) { const preco = await precoDaRevenda(r.id, s.id); html += `<tr><td>${escapeHtml(s.nome)}</td><td><input name="preco_${s.id}" value="${preco}"></td></tr>`; }
  html += `</table><button class="btn green">Salvar preços</button></form>`;
  res.send(page('Preços', html));
});
app.post('/admin/revenda/:id/precos', async (req, res) => {
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1');
  for (const s of servs) await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, Number(String(req.body[`preco_${s.id}`] || '0').replace(',', '.'))]);
  res.redirect('/admin/revendas');
});
app.get('/admin/revenda/:id/conta', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 100', [r.id]);
  let html = `<h1>💳 Conta da Revenda</h1><div class="card"><h2>${escapeHtml(r.nome)}</h2><h1>${brl(r.saldo)}</h1><form method="post" action="/admin/revenda/${r.id}/pagamento"><input name="valor" placeholder="Valor pago"><button class="btn green">Registrar Pagamento</button></form></div><h2>Histórico</h2><table><tr><th>ID</th><th>Serviço</th><th>IMEI</th><th>Valor</th><th>Status</th></tr>`;
  for (const p of pedidos) html += `<tr><td>#${p.id}</td><td>${escapeHtml(p.servico_nome)}</td><td>${p.imei}</td><td>${brl(p.valor)}</td><td>${p.status}</td></tr>`;
  html += '</table>';
  res.send(page('Conta', html));
});
app.post('/admin/revenda/:id/pagamento', async (req, res) => {
  const valor = Number(String(req.body.valor || '0').replace(',', '.'));
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (valor > 0 && r) {
    const novo = Math.max(0, Number(r.saldo || 0) - valor);
    await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, r.id]);
    await run('INSERT INTO pagamentos (revenda_id, revenda_nome, valor, origem) VALUES (?, ?, ?, "manual")', [r.id, r.nome, valor]);
    if (r.jid) await enviarTexto(r.jid, `✅ Pagamento registrado\n\n💰 Valor: ${brl(valor)}\n💳 Saldo: ${brl(novo)}\n\n🏢 CentralUnlocker`);
  }
  res.redirect(`/admin/revenda/${req.params.id}/conta`);
});

app.get('/admin/servicos', async (req, res) => {
  const rows = await all('SELECT s.*, (SELECT COUNT(*) FROM pedidos p WHERE p.servico_id=s.id) total FROM servicos_catalogo s ORDER BY s.id ASC');
  let html = `<h1>🛠 Serviços</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome do serviço" required><input name="preco" placeholder="Preço padrão"></div><button class="btn green">Adicionar Serviço</button></form></div><table><tr><th>ID</th><th>Serviço</th><th>Preço padrão</th><th>Status</th><th>IMEIs</th><th>Ações</th></tr>`;
  for (const s of rows) html += `<tr><td>${s.id}</td><td><a href="/admin/servico/${s.id}/imeis">${escapeHtml(s.nome)}</a></td><td>${brl(s.preco_padrao)}</td><td>${s.ativo ? 'Ativo' : 'Inativo'}</td><td>${s.total}</td><td><form style="display:inline" method="post" action="/admin/servico/${s.id}/editar"><input name="nome" value="${escapeHtml(s.nome)}" style="width:170px"><input name="preco" value="${s.preco_padrao}" style="width:90px"><button class="btn gray">✏️</button></form><form style="display:inline" method="post" action="/admin/servico/${s.id}/toggle"><button class="btn orange">${s.ativo ? 'Desativar' : 'Ativar'}</button></form><form style="display:inline" method="post" action="/admin/servico/${s.id}/excluir"><button class="btn red" onclick="return confirm('Excluir serviço e pedidos vinculados?')">🗑️</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Serviços', html));
});
app.post('/admin/servicos', async (req, res) => {
  await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.'))]);
  const revs = await all('SELECT * FROM revendas WHERE status="ATIVA" AND jid IS NOT NULL');
  for (const r of revs) await enviarTexto(r.jid, `🆕 Novo serviço disponível\n\n🛠 ${req.body.nome}\n\nDigite menu para ver sua tabela.`);
  res.redirect('/admin/servicos');
});
app.post('/admin/servico/:id/editar', async (req, res) => { await run('UPDATE servicos_catalogo SET nome=?, preco_padrao=? WHERE id=?', [req.body.nome, Number(String(req.body.preco||'0').replace(',', '.')), req.params.id]); res.redirect('/admin/servicos'); });
app.post('/admin/servico/:id/toggle', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); if (s) await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [s.ativo ? 0 : 1, s.id]); res.redirect('/admin/servicos'); });
app.post('/admin/servico/:id/excluir', async (req, res) => { await run('DELETE FROM pedidos WHERE servico_id=?', [req.params.id]); await run('DELETE FROM precos_revenda WHERE servico_id=?', [req.params.id]); await run('DELETE FROM servicos_catalogo WHERE id=?', [req.params.id]); res.redirect('/admin/servicos'); });
app.get('/admin/servico/:id/imeis', async (req, res) => {
  const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]);
  const rows = await all('SELECT * FROM pedidos WHERE servico_id=? ORDER BY id DESC LIMIT 500', [req.params.id]);
  let html = `<h1>📱 IMEIs - ${escapeHtml(s.nome)}</h1><table><tr><th>ID</th><th>IMEI</th><th>Cliente/Revenda</th><th>WhatsApp</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const p of rows) html += pedidoRow(p, false);
  html += '</table>';
  res.send(page('IMEIs', html));
});

app.get('/admin/financeiro', async (req, res) => {
  const revs = await all('SELECT * FROM revendas WHERE status!="REMOVIDA" ORDER BY saldo DESC');
  let total = 0;
  let html = '<h1>💰 Financeiro</h1><table><tr><th>Revenda</th><th>WhatsApp</th><th>Saldo</th><th>Ação</th></tr>';
  for (const r of revs) { total += Number(r.saldo || 0); html += `<tr><td>${escapeHtml(r.nome)}</td><td>${r.whatsapp||'-'}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/conta">Conta</a></td></tr>`; }
  html += `</table><div class="card"><h2>Total em aberto: ${brl(total)}</h2></div>`;
  res.send(page('Financeiro', html));
});

app.get('/admin/relatorios', async (req, res) => {
  const tipo = req.query.tipo || 'mensal';
  const di = req.query.di || today();
  const df = req.query.df || today();
  let where = "status='FINALIZADO'";
  if (tipo === 'diario') where += " AND date(finalizado_em)=date('now','localtime')";
  else if (tipo === 'mensal') where += " AND strftime('%Y-%m', finalizado_em)=strftime('%Y-%m','now','localtime')";
  else if (tipo === 'anual') where += " AND strftime('%Y', finalizado_em)=strftime('%Y','now','localtime')";
  else where += ` AND date(finalizado_em) BETWEEN date('${di}') AND date('${df}')`;
  const fat = await get(`SELECT COUNT(*) qtd, COALESCE(SUM(valor),0) total FROM pedidos WHERE ${where}`);
  const top = await get(`SELECT servico_nome, COUNT(*) qtd FROM pedidos WHERE ${where} GROUP BY servico_nome ORDER BY qtd DESC LIMIT 1`);
  res.send(page('Relatórios', `<h1>📈 Relatórios</h1><div class="card"><a class="btn" href="/admin/relatorios?tipo=diario">Diário</a><a class="btn" href="/admin/relatorios?tipo=mensal">Mensal</a><a class="btn" href="/admin/relatorios?tipo=anual">Anual</a><form class="search" style="margin-top:10px"><input type="hidden" name="tipo" value="personalizado"><div><label>Data inicial</label><input type="date" name="di" value="${di}"></div><div><label>Data final</label><input type="date" name="df" value="${df}"></div><button class="btn green">Gerar</button></form></div><div class="grid"><div class="card metric"><h2>Tipo</h2><h1>${tipo}</h1></div><div class="card metric"><h2>Faturamento</h2><h1>${brl(fat.total)}</h1></div><div class="card metric"><h2>Serviços Finalizados</h2><h1>${fat.qtd}</h1></div><div class="card metric"><h2>Serviço Mais Vendido</h2><h1>${escapeHtml(top?.servico_nome || '-')}</h1></div></div>`));
});

async function criarBackup() {
  const destino = path.join(BACKUP_DIR, `backup-${today()}-${Date.now()}.db`);
  await new Promise((resolve, reject) => db.backup(destino, (err) => err ? reject(err) : resolve()));
  console.log('✅ BACKUP CRIADO:', destino);
  return destino;
}
function listarBackups() { if (!fs.existsSync(BACKUP_DIR)) return []; return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse(); }
app.get('/admin/backup', async (req, res) => {
  const backs = listarBackups();
  let html = `<h1>💾 Backup</h1><form method="post" action="/admin/backup/criar"><button class="btn green">📦 Criar Backup</button></form><table><tr><th>#</th><th>Arquivo</th><th>Ações</th></tr>`;
  backs.forEach((b, i) => html += `<tr><td>${i + 1}</td><td>${b}</td><td><a class="btn" href="/admin/backup/download/${encodeURIComponent(b)}">⬇️ Baixar</a><form style="display:inline" method="post" action="/admin/backup/restaurar"><input type="hidden" name="file" value="${b}"><button class="btn red" onclick="return confirm('Restaurar este backup?')">🔄 Restaurar</button></form></td></tr>`);
  html += '</table>';
  res.send(page('Backup', html));
});
app.post('/admin/backup/criar', async (req, res) => { await criarBackup(); res.redirect('/admin/backup'); });
app.get('/admin/backup/download/:file', (req, res) => { res.download(path.join(BACKUP_DIR, path.basename(req.params.file))); });
app.post('/admin/backup/restaurar', async (req, res) => {
  const file = path.basename(req.body.file || '');
  const origem = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(origem)) return res.send(page('Erro', '<h1>Backup não encontrado</h1>'));
  const antes = await criarBackup();
  db.close((err) => {
    if (err) console.log(err);
    fs.copyFileSync(origem, DB_PATH);
    console.log('✅ RESTAURADO:', origem, 'backup antes:', antes);
    res.send(page('Restaurado', '<h1>✅ Backup restaurado</h1><p>O serviço será reiniciado para carregar o banco restaurado.</p>'));
    setTimeout(() => process.exit(0), 1500);
  });
});

cron.schedule('0 2 * * *', async () => { try { await criarBackup(); } catch (e) { console.log('❌ BACKUP AUTOMÁTICO:', e); } }, { timezone: 'America/Sao_Paulo' });

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR ONLINE NA PORTA ${PORT}`));
iniciarWhatsApp();
