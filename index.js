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
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let sock = null;
let qrCodeBase64 = null;
let conectado = false;
let db = new sqlite3.Database(DB_PATH);

const pedidoSessao = new Map();
const adminSessao = new Map();

// Proteções contra loop / mensagens duplicadas do Baileys
const mensagensProcessadas = new Set();
const mensagensRecentes = new Map();
const ultimoErroImei = new Map();
const BOT_START_TIME = Date.now();
let iniciandoWhatsApp = false;
let reconnectTimer = null;

function run(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
}
function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
function normalizarNumeroWhatsApp(v) {
  let d = onlyDigits(v);
  d = d.replace(/^0+/, '');
  // Se informar apenas DDD + número do Brasil, adiciona 55 automaticamente.
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
  return d;
}
function jidToNumber(jid) { return onlyDigits(String(jid || '').split('@')[0]); }
function numberToJid(n) { const d = normalizarNumeroWhatsApp(n); return d ? `${d}@s.whatsapp.net` : ''; }
function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function today() { return new Date().toISOString().slice(0, 10); }
function dateBR(v) { if (!v) return '-'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }
function isGroup(jid) { return String(jid || '').endsWith('@g.us'); }
function isAdminJid(jid) { return ADMIN_NUMBER && jidToNumber(jid) === ADMIN_NUMBER; }
function safeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function getText(msg) { return msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || ''; }

async function columnExists(table, col) {
  const cols = await all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === col);
}
async function addColumnIfMissing(table, col, definition) {
  if (!(await columnExists(table, col))) await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS revendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    whatsapp TEXT,
    jid TEXT,
    login TEXT,
    senha TEXT,
    status TEXT DEFAULT 'ATIVA',
    saldo REAL DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumnIfMissing('revendas', 'jid', 'TEXT');
  await addColumnIfMissing('revendas', 'login', 'TEXT');
  await addColumnIfMissing('revendas', 'senha', 'TEXT');
  await addColumnIfMissing('revendas', 'status', "TEXT DEFAULT 'ATIVA'");
  await addColumnIfMissing('revendas', 'saldo', 'REAL DEFAULT 0');

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
    tipo TEXT DEFAULT 'REVENDA',
    cliente_nome TEXT,
    cliente_whatsapp TEXT,
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
  await addColumnIfMissing('pedidos', 'tipo', "TEXT DEFAULT 'REVENDA'");
  await addColumnIfMissing('pedidos', 'cliente_nome', 'TEXT');
  await addColumnIfMissing('pedidos', 'cliente_whatsapp', 'TEXT');
  await addColumnIfMissing('pedidos', 'cliente_jid', 'TEXT');
  await addColumnIfMissing('pedidos', 'motivo_cancelamento', 'TEXT');
  await addColumnIfMissing('pedidos', 'cobrado', 'INTEGER DEFAULT 0');
  await addColumnIfMissing('pedidos', 'finalizado_em', 'TEXT');

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
  await addColumnIfMissing('pagamentos', 'cliente_jid', 'TEXT');
  await addColumnIfMissing('pagamentos', 'cliente_numero', 'TEXT');

  await run(`CREATE TABLE IF NOT EXISTS pix_pedidos (
    payment_id TEXT PRIMARY KEY,
    revenda_id INTEGER,
    revenda_jid TEXT,
    cliente_jid TEXT,
    valor REAL,
    status TEXT DEFAULT 'pending',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumnIfMissing('pix_pedidos', 'cliente_jid', 'TEXT');

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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(title)}</title>
  <style>
  :root{--bg:#07101d;--panel:#0d1728;--panel2:#111c31;--line:#233047;--text:#e5e7eb;--muted:#94a3b8;--green:#22c55e;--blue:#38bdf8;--red:#ef4444;--orange:#f97316;--purple:#a78bfa}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;background:linear-gradient(135deg,#07101d,#111827);color:var(--text);margin:0}a{color:#93c5fd;text-decoration:none}.layout{display:grid;grid-template-columns:235px 1fr;min-height:100vh}.side{background:#080f1d;border-right:1px solid var(--line);padding:20px;position:sticky;top:0;height:100vh}.brand{font-size:20px;font-weight:800;margin-bottom:22px}.side a{display:block;padding:12px;border-radius:10px;margin:5px 0;color:#cbd5e1}.side a:hover{background:#132238}.main{padding:22px;max-width:1500px;width:100%;margin:0 auto}.topbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px}.card{background:rgba(17,28,49,.92);border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0;box-shadow:0 12px 30px rgba(0,0,0,.18)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.metric h2{font-size:14px;color:var(--muted);margin:0 0 8px}.metric h1{font-size:30px;margin:0}.btn{display:inline-block;background:#2563eb;color:white!important;padding:8px 11px;border-radius:9px;border:0;cursor:pointer;margin:2px;font-weight:700}.btn.red{background:var(--red)}.btn.green{background:var(--green);color:#052e16!important}.btn.gray{background:#475569}.btn.orange{background:var(--orange)}.btn.purple{background:var(--purple);color:#241442!important}input,select,textarea{padding:10px;border-radius:9px;border:1px solid #334155;background:#020617;color:var(--text);width:100%;min-width:130px}table{width:100%;border-collapse:separate;border-spacing:0;background:#0b1424;border-radius:14px;overflow:hidden;border:1px solid var(--line)}td,th{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:middle}th{color:#cbd5e1;background:#101b2f;font-size:13px;text-transform:uppercase}tr:last-child td{border-bottom:0}.muted{color:var(--muted)}.status{font-weight:800}.pill{padding:4px 8px;border-radius:999px;background:#1e293b;display:inline-block}.forms-inline{display:inline}.actions{white-space:nowrap}.search{display:grid;grid-template-columns:1fr 120px;gap:8px;max-width:520px}@media(max-width:800px){.layout{grid-template-columns:1fr}.side{height:auto;position:relative}.side a{display:inline-block}.main{padding:14px}.search{grid-template-columns:1fr}table{font-size:12px}.actions .btn{padding:6px 8px}}
  </style></head><body><div class="layout"><aside class="side"><div class="brand">🏢 CentralUnlocker</div><a href="/admin">📊 Dashboard</a><a href="/admin/pedidos">📋 Pedidos</a><a href="/admin/revendas">🏪 Revendas</a><a href="/admin/servicos">🛠 Serviços</a><a href="/admin/financeiro">💰 Financeiro</a><a href="/admin/relatorios">📈 Relatórios</a><a href="/admin/backup">💾 Backup</a><a href="/admin/config">⚙️ Configurações</a><a href="/admin/logout">🚪 Sair</a></aside><main class="main">${body}</main></div></body></html>`;
}

async function precoDaRevenda(revendaId, servicoId) {
  const pr = await get('SELECT preco FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [revendaId, servicoId]);
  if (pr && Number(pr.preco) > 0) return Number(pr.preco);
  const s = await get('SELECT preco_padrao FROM servicos_catalogo WHERE id=?', [servicoId]);
  return Number(s?.preco_padrao || 0);
}
async function getRevendaByJidOrNumber(jid) {
  const numero = jidToNumber(jid);
  return await get('SELECT * FROM revendas WHERE status="ATIVA" AND (jid=? OR whatsapp=?)', [jid, numero]);
}
async function listarServicosTexto(revenda) {
  const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let texto = `🛠 *SERVIÇOS DISPONÍVEIS*\n\n`;
  for (let i = 0; i < servicos.length; i++) {
    const preco = revenda ? await precoDaRevenda(revenda.id, servicos[i].id) : Number(servicos[i].preco_padrao || 0);
    texto += `${i + 1} - ${servicos[i].nome} - ${brl(preco)}\n`;
  }
  texto += '\nDigite o número do serviço.';
  return texto;
}
async function enviarTexto(to, text) { if (sock && to) await sock.sendMessage(to, { text }); }

async function iniciarWhatsApp() {
  if (iniciandoWhatsApp) return;
  iniciandoWhatsApp = true;
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
      if (statusCode !== DisconnectReason.loggedOut) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => iniciarWhatsApp(), 8000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type && type !== 'notify') return;

    for (const msg of messages || []) {
      if (!msg || !msg.message) continue;
      const from = msg.key.remoteJid;
      if (!from || isGroup(from) || from === 'status@broadcast') continue;

      const textoOriginal = getText(msg).trim();
      if (!textoOriginal) continue;
      const texto = textoOriginal.toLowerCase();

      // Mensagens enviadas pelo próprio bot voltam como fromMe em alguns casos.
      // Só aceitamos fromMe para comandos manuais do admin na conversa: servico, revenda e backup.
      const fromMe = !!msg.key.fromMe;
      const comandoManualAdmin = /^(servico\s+|revenda\s+|backup$)/i.test(textoOriginal.trim());
      if (fromMe && !comandoManualAdmin) continue;

      // Ignora histórico antigo após reiniciar no Render.
      const tsRaw = Number(msg.messageTimestamp || 0);
      const msgTime = tsRaw > 9999999999 ? tsRaw : tsRaw * 1000;
      if (msgTime && msgTime < BOT_START_TIME - 60000) continue;

      // Ignora a mesma mensagem pelo ID.
      const msgId = `${from}:${msg.key?.id || ''}:${fromMe ? 'me' : 'in'}`;
      if (msg.key?.id && mensagensProcessadas.has(msgId)) continue;
      if (msg.key?.id) mensagensProcessadas.add(msgId);
      if (mensagensProcessadas.size > 5000) mensagensProcessadas.clear();

      // Trava extra: se a mesma conversa mandar o mesmo texto em poucos segundos, ignora.
      // Isso impede 100+ respostas quando o Baileys duplica eventos.
      const recentKey = `${from}:${texto}`;
      const agora = Date.now();
      const ultima = mensagensRecentes.get(recentKey) || 0;
      if (agora - ultima < 6000) continue;
      mensagensRecentes.set(recentKey, agora);
      if (mensagensRecentes.size > 1000) mensagensRecentes.clear();

      const admin = isAdminJid(from) || (fromMe && comandoManualAdmin);
      const nomeContato = msg.pushName || 'Cliente';
      console.log('📩', from, fromMe ? 'FROMME' : '', textoOriginal);
      try { await tratarWhatsApp(from, textoOriginal, texto, admin, nomeContato); }
      catch (e) { console.log('❌ ERRO WA:', e); await enviarTexto(from, '❌ Erro interno. Tente novamente.'); }
    }
  });

  iniciandoWhatsApp = false;
}

async function cadastrarRevendaPelaConversa(from, dadosTexto) {
  const dados = String(dadosTexto || '').replace(/^revenda\s+/i, '').split('|').map(s => s.trim());

  if (dados.length < 2 || !dados[0] || !dados[1]) {
    await enviarTexto(from, `❌ Use assim:

revenda NOME DA REVENDA | WHATSAPP

Exemplo:
revenda LIFE DESBLOQUEIOS | 5575988479931`);
    return;
  }

  const nome = dados[0];
  const whatsapp = normalizarNumeroWhatsApp(dados[1]);

  if (!whatsapp || whatsapp.length < 12) {
    await enviarTexto(from, `❌ WhatsApp inválido.

Use com DDI + DDD + número.
Exemplo:
5575988479931`);
    return;
  }

  const jidRevenda = numberToJid(whatsapp);
  const existente = await get('SELECT * FROM revendas WHERE whatsapp=? AND status != "REMOVIDA"', [whatsapp]);
  let revenda;

  if (existente) {
    await run(
      'UPDATE revendas SET nome=?, whatsapp=?, jid=?, status="ATIVA", atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
      [nome, whatsapp, jidRevenda, existente.id]
    );
    revenda = await get('SELECT * FROM revendas WHERE id=?', [existente.id]);
  } else {
    const ins = await run(
      'INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo) VALUES (?, ?, ?, ?, ?, "ATIVA", 0)',
      [nome, whatsapp, jidRevenda, `rev_${whatsapp}`, `sem_senha_${Date.now()}`]
    );
    revenda = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
  }

  await enviarTexto(from, `✅ Revenda cadastrada

🏪 ${revenda.nome}
📱 ${revenda.whatsapp}

A mensagem de boas-vindas foi enviada para a revenda.`);

  await enviarTexto(jidRevenda, `🎉 BEM-VINDO À CENTRALUNLOCKER

Olá, ${revenda.nome}!

Sua revenda foi cadastrada e ativada com sucesso.

Para começar, digite:
menu

🏢 CentralUnlocker`);

  await enviarTexto(jidRevenda, `📚 TUTORIAL RÁPIDO

Digite:
menu

Você verá:
1️⃣ Serviços
2️⃣ Histórico
3️⃣ Conta

Para solicitar serviço:
menu → 1 → escolha o serviço → envie o IMEI

Para ver sua conta:
menu → 3

Para gerar PIX parcial ou total:
pagar valor

Exemplo:
pagar 100

🏢 CentralUnlocker`);
}


async function tratarWhatsApp(from, textoOriginal, texto, admin, nomeContato) {
  const numero = jidToNumber(from);
  const partes = textoOriginal.trim().split(/\s+/);

  // cancela qualquer fluxo preso
  if (['cancelar', 'sair', 'voltar'].includes(texto)) {
    pedidoSessao.delete(from);
    adminSessao.delete(from);
    await enviarTexto(from, '✅ Operação cancelada.\n\nDigite menu para começar novamente.');
    return;
  }

  // Cadastro de revenda pelo WhatsApp do admin.
  // Use: revenda NOME DA REVENDA | 5575988479931
  if (admin && texto.startsWith('revenda ')) {
    await cadastrarRevendaPelaConversa(from, textoOriginal);
    return;
  }

  // PIX livre para qualquer pessoa
  if (texto.startsWith('pagar')) {
    const valor = Number(String(partes[1] || '0').replace(',', '.'));
    if (!valor || valor < 10) { await enviarTexto(from, '❌ Informe um valor mínimo de R$10.\n\nExemplo:\npagar 180'); return; }
    await enviarTexto(from, '⏳ Gerando PIX...');
    const pix = await gerarPix(valor, from);
    if (!pix) { await enviarTexto(from, '❌ Erro ao gerar PIX.'); return; }
    const paymentId = pix?.data?.payment_id || pix?.payment_id || pix?.data?.id || pix?.id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.data?.pix_copy_paste || pix?.qr_code || pix?.copy_paste;
    await enviarTexto(from, `✅ *PIX GERADO*\n\n💰 Valor: ${brl(valor)}\n\nVou enviar o copia e cola na próxima mensagem.\n⏳ Expira em 20 minutos.`);
    await enviarTexto(from, qrCode || 'PIX indisponível');
    const revendaPix = await getRevendaByJidOrNumber(from);
    if (paymentId) {
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, valor, status) VALUES (?, ?, ?, ?, ?, "pending")', [paymentId, revendaPix?.id || null, revendaPix ? from : null, from, valor]);
      verificarPagamento(paymentId, revendaPix?.id || null, from, valor);
    }
    return;
  }

  if (admin) {
    // Admin WhatsApp completo removido para evitar loops.
    // Mantidos apenas: backup, servico ... e revenda ...
    if (texto === 'backup') {
      const arq = await criarBackup();
      await enviarTexto(from, `✅ BACKUP GERADO\n\n📁 ${path.basename(arq)}\n\n🏢 CentralUnlocker`);
      return;
    }
    if (await tratarServicoClienteFinal(from, textoOriginal, texto, nomeContato)) return;
  }

  const revenda = await getRevendaByJidOrNumber(from);
  if (!revenda) {
    if (texto === 'menu' || texto === 'servicos' || texto === 'historico' || texto === 'conta') {
      await enviarTexto(from, '❌ Número não cadastrado como revenda.');
    }
    return;
  }

  // atualiza jid se mudou
  if (revenda.jid !== from) await run('UPDATE revendas SET jid=?, whatsapp=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [from, numero, revenda.id]);

  if (texto === 'menu') {
    pedidoSessao.delete(from);
    pedidoSessao.set(from, { etapa: 'menu' });
    await enviarTexto(from, `🏪 *${revenda.nome}*\n\n1️⃣ Serviços\n2️⃣ Histórico\n3️⃣ Conta\n\nDigite uma opção:`);
    return;
  }

  if (texto === 'servicos' || texto === '/servicos') {
    pedidoSessao.delete(from);
    pedidoSessao.set(from, { etapa: 'servico_escolha' });
    await enviarTexto(from, await listarServicosTexto(revenda));
    return;
  }

  if (texto === 'historico' || texto === '/historico') { await enviarHistoricoRevenda(from, revenda); return; }
  if (texto === 'conta' || texto === '/conta' || texto === 'saldo' || texto === '/saldo') { await enviarContaRevenda(from, revenda); return; }

  const sess = pedidoSessao.get(from);
  if (sess?.etapa === 'menu') {
    if (texto === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarTexto(from, await listarServicosTexto(revenda)); return; }
    if (texto === '2') { pedidoSessao.delete(from); await enviarHistoricoRevenda(from, revenda); return; }
    if (texto === '3') { pedidoSessao.delete(from); await enviarContaRevenda(from, revenda); return; }
  }

  if (sess?.etapa === 'servico_escolha' && /^\d+$/.test(texto)) {
    const pos = Number(texto);
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[pos - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'imei', servicoId: servico.id });
    await enviarTexto(from, '📱 Informe o IMEI:');
    return;
  }

  if (sess?.etapa === 'imei') {
    const imei = onlyDigits(textoOriginal);
    if (!/^\d{14,17}$/.test(imei)) {
      const agoraErro = Date.now();
      const ultimo = ultimoErroImei.get(from) || 0;
      if (agoraErro - ultimo > 15000) {
        ultimoErroImei.set(from, agoraErro);
        await enviarTexto(from, '❌ IMEI inválido. Envie apenas os números.\n\nDigite cancelar para sair.');
      }
      return;
    }
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sess.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }
    const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
    if (duplicado) { pedidoSessao.delete(from); await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return; }
    const valor = await precoDaRevenda(revenda.id, servico.id);
    await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, valor, status)
      VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [revenda.id, revenda.nome, from, numero, servico.id, servico.nome, imei, valor]);
    pedidoSessao.delete(from);
    await enviarTexto(from, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n📱 ${imei}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`);
    return;
  }
}

async function tratarServicoClienteFinal(from, textoOriginal, texto, nomeContato) {
  if (!texto.startsWith('servico ')) return false;
  const partes = textoOriginal.trim().split(/\s+/);
  const imei = onlyDigits(partes[partes.length - 1]);
  const valor = Number(String(partes[partes.length - 2] || '').replace(',', '.'));
  const nomeServico = partes.slice(1, -2).join(' ').trim();
  if (!nomeServico || !valor || !/^\d{14,17}$/.test(imei)) {
    await enviarTexto(from, '❌ Formato inválido.\n\nUse:\nservico desbloqueio tim 180 356789123456789');
    return true;
  }
  const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
  if (duplicado) { await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return true; }
  let servico = await get('SELECT * FROM servicos_catalogo WHERE lower(nome)=lower(?)', [nomeServico]);
  if (!servico) {
    const ins = await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [nomeServico, valor]);
    servico = await get('SELECT * FROM servicos_catalogo WHERE id=?', [ins.lastID]);
  }
  await run(`INSERT INTO pedidos (tipo, cliente_nome, cliente_whatsapp, cliente_jid, servico_id, servico_nome, imei, valor, status)
    VALUES ('CLIENTE', ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [nomeContato || 'Cliente', jidToNumber(from), from, servico.id, servico.nome, imei, valor]);
  await enviarTexto(from, `✅ Serviço cadastrado\n\n🛠 ${servico.nome}\n📱 ${imei}\n💰 ${brl(valor)}\n\n📍 Pendente`);
  return true;
}

async function enviarHistoricoRevenda(from, revenda) {
  const rows = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 10', [revenda.id]);
  if (!rows.length) { await enviarTexto(from, '📋 Nenhum pedido encontrado.'); return; }
  let txt = `📋 *HISTÓRICO*\n\n`;
  for (const p of rows) txt += `🛠 ${p.servico_nome}\n📱 ${p.imei}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function enviarContaRevenda(from, revenda) {
  await enviarTexto(from, `💳 *CONTA*\n\n🏪 ${revenda.nome}\n\n💰 Saldo em aberto:\n${brl(revenda.saldo)}\n\nPara gerar PIX digite:\n*pagar valor*\n\nExemplos:\npagar 100\npagar 420`);
}

async function tratarAdminWhatsApp(from, textoOriginal, texto, nomeContato) {
  const partes = textoOriginal.trim().split(/\s+/);
  const cmd = partes[0].toLowerCase();
  if (cmd === '/admin' || cmd === 'admin') { await enviarMenuAdmin(from); return true; }
  if (adminSessao.get(from)?.menu && /^[0-9]$/.test(texto)) { await tratarOpcaoAdmin(from, texto); return true; }

  if (cmd === 'backup') { const arq = await criarBackup(); await enviarTexto(from, `✅ BACKUP GERADO\n\n📁 ${path.basename(arq)}\n\n🏢 CentralUnlocker`); return true; }
  if (cmd === 'backups') { await enviarTexto(from, await textoBackups()); return true; }
  if (cmd === 'hoje') { await enviarTexto(from, await resumoPeriodo('daily')); return true; }
  if (cmd === 'financeiro') { await enviarTexto(from, await resumoFinanceiro()); return true; }
  if (cmd === 'pendentes' || cmd === 'processo' || cmd === 'finalizados' || cmd === 'cancelados') { await enviarListaStatus(from, cmd); return true; }
  if (cmd === 'imei') { await enviarBuscaIMEI(from, partes[1]); return true; }
  if (cmd === 'cliente') { await enviarBuscaPessoa(from, partes[1]); return true; }
  if (cmd === 'revenda') { await enviarBuscaRevenda(from, partes.slice(1).join(' ')); return true; }

  if (cmd === 'processar' || cmd === 'processo') { await adminMudarStatus(from, partes[1], 'EM PROCESSO'); return true; }
  if (cmd === 'finalizar') { await adminFinalizarPedido(from, partes[1]); return true; }
  if (cmd === 'cancelar') { await adminCancelarPedido(from, partes[1], partes.slice(2).join(' ') || 'Não informado'); return true; }
  if (cmd === 'editarimei') { await adminEditarIMEI(from, partes[1], partes[2]); return true; }

  if (cmd === 'addrevenda') { await adminAddRevenda(from, textoOriginal.replace(/^addrevenda\s+/i, '')); return true; }
  if (cmd === 'revendas') { await adminListRevendas(from); return true; }
  if (cmd === 'bloquearrevenda') { await adminSetRevendaStatus(from, partes[1], 'BLOQUEADA'); return true; }
  if (cmd === 'desbloquearrevenda') { await adminSetRevendaStatus(from, partes[1], 'ATIVA'); return true; }
  if (cmd === 'removerrevenda') { await adminSetRevendaStatus(from, partes[1], 'REMOVIDA'); return true; }

  if (cmd === 'servicos') { await adminListServicos(from); return true; }
  if (cmd === 'addservico') { await adminAddServico(from, textoOriginal.replace(/^addservico\s+/i, '')); return true; }
  if (cmd === 'editarservico') { await adminEditarServico(from, textoOriginal.replace(/^editarservico\s+/i, '')); return true; }
  if (cmd === 'desativarservico') { await adminToggleServico(from, partes[1], 0); return true; }
  if (cmd === 'ativarservico') { await adminToggleServico(from, partes[1], 1); return true; }
  if (cmd === 'excluirservico') { await adminExcluirServico(from, partes[1]); return true; }
  if (cmd === 'relatorio') { await enviarTexto(from, await resumoPeriodo(partes[1] || 'daily')); return true; }
  return false;
}
async function enviarMenuAdmin(from) {
  adminSessao.set(from, { menu: true });
  await enviarTexto(from, `🏢 *CENTRALUNLOCKER ADMIN*\n\n1️⃣ Dashboard\n2️⃣ Pedidos\n3️⃣ Revendas\n4️⃣ Serviços\n5️⃣ Financeiro\n6️⃣ Relatórios\n7️⃣ Backup\n8️⃣ Configurações\n9️⃣ Painel Web\n0️⃣ Sair\n\nDigite uma opção:`);
}
async function tratarOpcaoAdmin(from, opcao) {
  if (opcao === '0') { adminSessao.delete(from); await enviarTexto(from, '✅ Menu encerrado.'); return; }
  if (opcao === '1') { await enviarTexto(from, await textoDashboardAdmin()); return; }
  if (opcao === '2') { await enviarTexto(from, `📋 *PEDIDOS*\n\nComandos:\npendentes\nprocesso\nfinalizados\ncancelados\nimei 356789123456789\nprocessar ID\nfinalizar ID\ncancelar ID motivo\neditarimei ID novoimei`); return; }
  if (opcao === '3') { await enviarTexto(from, `🏪 *REVENDAS*\n\nComandos:\nrevendas\nrevenda nome\naddrevenda Nome | 5575999999999\nbloquearrevenda ID\ndesbloquearrevenda ID\nremoverrevenda ID`); return; }
  if (opcao === '4') { await enviarTexto(from, `🛠 *SERVIÇOS*\n\nComandos:\nservicos\naddservico Nome | 100\neditarservico ID | Novo Nome | 100\ndesativarservico ID\nativarservico ID\nexcluirservico ID`); return; }
  if (opcao === '5') { await enviarTexto(from, await resumoFinanceiro()); return; }
  if (opcao === '6') { await enviarTexto(from, `📈 *RELATÓRIOS*\n\nrelatorio diario\nrelatorio mensal\nrelatorio anual\nhoje`); return; }
  if (opcao === '7') { await enviarTexto(from, `💾 *BACKUP*\n\nbackup\nbackups\n\nNo painel você também pode baixar/restaurar.`); return; }
  if (opcao === '8') { await enviarTexto(from, `⚙️ *CONFIGURAÇÕES*\n\nAdmin: ${ADMIN_NUMBER}\nDB: ${DB_PATH}\nStatus WhatsApp: ${conectado ? 'Conectado' : 'Desconectado'}`); return; }
  if (opcao === '9') { await enviarTexto(from, `🌐 Painel Web:\n${BASE_URL ? BASE_URL + '/admin' : '/admin'}`); return; }
}

async function textoDashboardAdmin() {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const c = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="CANCELADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas WHERE status="ATIVA"');
  const hoje = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos WHERE date(criado_em)=date("now")');
  return `📊 *DASHBOARD*\n\n🟡 Pendentes: ${p.qtd}\n🔄 Em Processo: ${ep.qtd}\n✅ Finalizados: ${f.qtd}\n❌ Cancelados: ${c.qtd}\n\n💰 Recebido hoje: ${brl(hoje.total)}\n💳 A receber: ${brl(saldo.total)}`;
}
async function enviarListaStatus(from, cmd) {
  const mapa = { pendentes:'PENDENTE', processo:'EM PROCESSO', finalizados:'FINALIZADO', cancelados:'CANCELADO' };
  const st = mapa[cmd];
  const rows = await all('SELECT * FROM pedidos WHERE status=? ORDER BY id DESC LIMIT 20', [st]);
  if (!rows.length) { await enviarTexto(from, `Nenhum pedido ${st}.`); return; }
  let txt = `📋 *${st}*\n\n`;
  for (const p of rows) txt += `#${p.id} | ${p.imei}\n${p.servico_nome}\n${p.revenda_nome || p.cliente_nome || '-'} | ${brl(p.valor)}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function enviarBuscaIMEI(from, imei) {
  imei = onlyDigits(imei || '');
  if (!imei) { await enviarTexto(from, 'Use: imei 356789123456789'); return; }
  const rows = await all('SELECT * FROM pedidos WHERE imei LIKE ? ORDER BY id DESC LIMIT 10', [`%${imei}%`]);
  if (!rows.length) { await enviarTexto(from, '❌ IMEI não encontrado.'); return; }
  let txt = '🔍 *RESULTADO IMEI*\n\n';
  for (const p of rows) txt += `#${p.id}\n📱 ${p.imei}\n🛠 ${p.servico_nome}\n👤 ${p.revenda_nome || p.cliente_nome || '-'}\n📞 ${p.revenda_numero || p.cliente_whatsapp || '-'}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function enviarBuscaPessoa(from, termo) {
  termo = onlyDigits(termo || '');
  if (!termo) { await enviarTexto(from, 'Use: cliente 5575999999999'); return; }
  const rows = await all('SELECT * FROM pedidos WHERE cliente_whatsapp LIKE ? OR revenda_numero LIKE ? ORDER BY id DESC LIMIT 10', [`%${termo}%`, `%${termo}%`]);
  if (!rows.length) { await enviarTexto(from, '❌ Nenhum pedido encontrado.'); return; }
  let txt = '👤 *PEDIDOS DO NÚMERO*\n\n';
  for (const p of rows) txt += `#${p.id} | ${p.imei}\n${p.servico_nome} | ${brl(p.valor)} | ${p.status}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function enviarBuscaRevenda(from, termo) {
  if (!termo) { await enviarTexto(from, 'Use: revenda nome'); return; }
  const rows = await all('SELECT * FROM revendas WHERE nome LIKE ? OR whatsapp LIKE ? ORDER BY id DESC LIMIT 10', [`%${termo}%`, `%${onlyDigits(termo)}%`]);
  if (!rows.length) { await enviarTexto(from, '❌ Revenda não encontrada.'); return; }
  let txt = '🏪 *REVENDAS*\n\n';
  for (const r of rows) txt += `#${r.id}\n${r.nome}\n📞 ${r.whatsapp || '-'}\n📍 ${r.status}\n💰 ${brl(r.saldo)}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function adminMudarStatus(from, id, status) {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  if (!pedido) { await enviarTexto(from, '❌ Pedido não encontrado.'); return; }
  await run('UPDATE pedidos SET status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [status, pedido.id]);
  const atual = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
  await notificarPedido(atual, 'processo');
  await enviarTexto(from, `✅ Pedido #${id} atualizado para ${status}.`);
}
async function adminFinalizarPedido(from, id) {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  if (!pedido) { await enviarTexto(from, '❌ Pedido não encontrado.'); return; }
  await finalizarPedido(pedido);
  await enviarTexto(from, `✅ Pedido #${id} finalizado.`);
}
async function adminCancelarPedido(from, id, motivo) {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  if (!pedido) { await enviarTexto(from, '❌ Pedido não encontrado.'); return; }
  await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, id]);
  const atual = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  await notificarPedido(atual, 'cancelar', motivo);
  await enviarTexto(from, `❌ Pedido #${id} cancelado.`);
}
async function adminEditarIMEI(from, id, novoImei) {
  novoImei = onlyDigits(novoImei || '');
  if (!/^\d{14,17}$/.test(novoImei)) { await enviarTexto(from, 'Use: editarimei ID novoimei'); return; }
  await run('UPDATE pedidos SET imei=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novoImei, id]);
  await enviarTexto(from, `✅ IMEI do pedido #${id} atualizado para ${novoImei}.`);
}
async function adminAddRevenda(from, texto) {
  const [nome, whats] = texto.split('|').map(s => s?.trim());
  if (!nome || !whats) { await enviarTexto(from, 'Use: addrevenda Nome | 5575999999999'); return; }
  const w = onlyDigits(whats);
  await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo) VALUES (?, ?, ?, ?, ?, "ATIVA", 0)', [nome, w, numberToJid(w), `rev${Date.now()}`, 'sem-senha']);
  await enviarTexto(from, `✅ Revenda adicionada:\n${nome}\n${w}`);
}
async function adminListRevendas(from) { await enviarBuscaRevenda(from, ''); }
async function adminSetRevendaStatus(from, id, status) {
  if (!id) { await enviarTexto(from, `Use o ID da revenda.`); return; }
  await run('UPDATE revendas SET status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [status, id]);
  await enviarTexto(from, `✅ Revenda #${id}: ${status}`);
}
async function adminListServicos(from) {
  const rows = await all('SELECT * FROM servicos_catalogo ORDER BY id ASC');
  let txt = '🛠 *SERVIÇOS*\n\n';
  for (const s of rows) txt += `#${s.id} ${s.nome}\nPreço: ${brl(s.preco_padrao)} | ${s.ativo ? 'Ativo' : 'Inativo'}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function adminAddServico(from, texto) {
  const [nome, precoTxt] = texto.split('|').map(s => s?.trim());
  const preco = Number(String(precoTxt || '0').replace(',', '.'));
  if (!nome) { await enviarTexto(from, 'Use: addservico Nome | 100'); return; }
  await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [nome, preco]);
  await enviarTexto(from, `✅ Serviço adicionado:\n${nome}\n${brl(preco)}`);
}
async function adminEditarServico(from, texto) {
  const [id, nome, precoTxt] = texto.split('|').map(s => s?.trim());
  const preco = Number(String(precoTxt || '0').replace(',', '.'));
  if (!id || !nome) { await enviarTexto(from, 'Use: editarservico ID | Novo Nome | 100'); return; }
  await run('UPDATE servicos_catalogo SET nome=?, preco_padrao=? WHERE id=?', [nome, preco, id]);
  await enviarTexto(from, `✅ Serviço #${id} editado.`);
}
async function adminToggleServico(from, id, ativo) { await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [ativo, id]); await enviarTexto(from, `✅ Serviço #${id}: ${ativo ? 'ATIVO' : 'INATIVO'}`); }
async function adminExcluirServico(from, id) { await run('DELETE FROM precos_revenda WHERE servico_id=?', [id]); await run('DELETE FROM pedidos WHERE servico_id=?', [id]); await run('DELETE FROM servicos_catalogo WHERE id=?', [id]); await enviarTexto(from, `🗑️ Serviço #${id} excluído.`); }

async function resumoFinanceiro() {
  const aberto = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas WHERE status="ATIVA"');
  const recebido = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos');
  const hoje = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos WHERE date(criado_em)=date("now")');
  return `💰 *FINANCEIRO*\n\n💳 A receber: ${brl(aberto.total)}\n✅ Recebido total: ${brl(recebido.total)}\n📅 Recebido hoje: ${brl(hoje.total)}`;
}
async function resumoPeriodo(tipo) {
  let label = 'DIÁRIO', where = 'date(criado_em)=date("now")';
  if (['mensal','mes','month'].includes(tipo)) { label = 'MENSAL'; where = `date(criado_em)>=date('${monthStart()}')`; }
  if (['anual','ano','year'].includes(tipo)) { label = 'ANUAL'; where = `date(criado_em)>=date('${yearStart()}')`; }
  const pag = await get(`SELECT COALESCE(SUM(valor),0) total, COUNT(*) qtd FROM pagamentos WHERE ${where}`);
  const fin = await get(`SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO" AND ${where.replace('criado_em','finalizado_em')}`);
  return `📈 *RELATÓRIO ${label}*\n\n💰 Faturamento: ${brl(pag.total)}\n✅ Pagamentos: ${pag.qtd}\n🛠 Serviços finalizados: ${fin.qtd}`;
}
async function textoBackups() {
  const backs = listarBackups();
  if (!backs.length) return 'Nenhum backup encontrado.';
  return '💾 *BACKUPS*\n\n' + backs.slice(0, 10).map((b,i)=>`${i+1}. ${b}`).join('\n');
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
      let novo = null;
      if (revendaId) {
        const rev = await get('SELECT * FROM revendas WHERE id=?', [revendaId]);
        if (rev) {
          novo = Math.max(0, Number(rev.saldo || 0) - Number(valorPix || 0));
          await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, revendaId]);
          await run('INSERT INTO pagamentos (revenda_id, revenda_nome, cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, ?, ?, "pixgo")', [revendaId, rev.nome, jid, jidToNumber(jid), valorPix]);
        }
      } else {
        await run('INSERT INTO pagamentos (cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, "pixgo")', [jid, jidToNumber(jid), valorPix]);
      }
      await run('UPDATE pix_pedidos SET status="completed" WHERE payment_id=?', [paymentId]);
      await enviarTexto(jid, `✅ Pagamento confirmado\n\n💰 Valor: ${brl(valorPix)}${novo !== null ? `\n\n💳 Novo saldo:\n${brl(novo)}` : ''}\n\n🏢 CentralUnlocker`);
    }
    if (status?.success && status.data?.status === 'expired') {
      clearInterval(interval); await run('UPDATE pix_pedidos SET status="expired" WHERE payment_id=?', [paymentId]); await enviarTexto(jid, '⌛ PIX expirado. Digite pagar valor para gerar outro.');
    }
    if (tentativas >= 40) clearInterval(interval);
  }, 30000);
}

async function finalizarPedido(pedido) {
  await run('UPDATE pedidos SET status="FINALIZADO", finalizado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.id]);
  if (pedido.tipo === 'REVENDA' && !pedido.cobrado && pedido.revenda_id) {
    await run('UPDATE revendas SET saldo=saldo+?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.valor, pedido.revenda_id]);
    await run('UPDATE pedidos SET cobrado=1 WHERE id=?', [pedido.id]);
  }
  const atualizado = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
  await notificarPedido(atualizado, 'finalizar');
}
async function notificarPedido(pedido, tipo, motivo = '') {
  let jid = pedido.revenda_jid || pedido.cliente_jid;
  if (!jid && pedido.revenda_numero) jid = numberToJid(pedido.revenda_numero);
  if (!jid && pedido.cliente_whatsapp) jid = numberToJid(pedido.cliente_whatsapp);
  if (!jid) return;
  if (tipo === 'processo') await enviarTexto(jid, `🔄 Serviço em processo\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n💰 Valor: ${brl(pedido.valor)}`);
  if (tipo === 'finalizar') {
    if (pedido.tipo === 'REVENDA') {
      const rev = await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]);
      await enviarTexto(jid, `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\n💰 Valor: ${brl(pedido.valor)}\n\n💳 Saldo:\n${brl(rev?.saldo || 0)}\n\n🏢 CentralUnlocker`);
    } else {
      await enviarTexto(jid, `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\nPara pagar digite:\npagar ${Number(pedido.valor).toFixed(2)}\n\n🏢 CentralUnlocker`);
    }
  }
  if (tipo === 'cancelar') await enviarTexto(jid, `❌ Serviço cancelado\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\nMotivo:\n${motivo || 'Não informado'}\n\n🏢 CentralUnlocker`);
}

app.get('/', (req, res) => {
  if (qrCodeBase64) return res.send(page('QR', `<div class="card" style="text-align:center"><h1>📱 ESCANEIE O QR</h1><img src="${qrCodeBase64}" width="300"><p>WhatsApp > Aparelhos conectados</p></div>`));
  res.send(page('Online', `<div class="card" style="text-align:center"><h1>✅ CENTRALUNLOCKER ONLINE</h1><p>${conectado ? 'WhatsApp conectado ✅' : 'Aguardando QR...'}</p><p><a class="btn green" href="/admin">Acessar painel admin</a></p></div>`));
});

app.use('/admin', basicAuth);

app.get('/admin', async (req, res) => {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const c = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="CANCELADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas WHERE status="ATIVA"');
  const hoje = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos WHERE date(criado_em)=date("now")');
  const rev = await get('SELECT COUNT(*) qtd FROM revendas WHERE status="ATIVA"');
  const ult = await all('SELECT * FROM pedidos ORDER BY id DESC LIMIT 8');
  let table = '<table><tr><th>ID</th><th>IMEI</th><th>Serviço</th><th>Cliente/Revenda</th><th>Status</th></tr>';
  for (const o of ult) table += `<tr><td>#${o.id}</td><td>${safeHtml(o.imei)}</td><td>${safeHtml(o.servico_nome)}</td><td>${safeHtml(o.revenda_nome || o.cliente_nome || '-')}</td><td><span class="pill">${safeHtml(o.status)}</span></td></tr>`;
  table += '</table>';
  res.send(page('Dashboard', `<div class="topbar"><h1>📊 Dashboard</h1><span class="muted">${dateBR(new Date())}</span></div><div class="grid">
  <div class="card metric"><h2>🟡 Pendentes</h2><h1>${p.qtd}</h1></div><div class="card metric"><h2>🔄 Em Processo</h2><h1>${ep.qtd}</h1></div><div class="card metric"><h2>✅ Finalizados</h2><h1>${f.qtd}</h1></div><div class="card metric"><h2>❌ Cancelados</h2><h1>${c.qtd}</h1></div><div class="card metric"><h2>💰 Hoje</h2><h1>${brl(hoje.total)}</h1></div><div class="card metric"><h2>💳 A receber</h2><h1>${brl(saldo.total)}</h1></div><div class="card metric"><h2>🏪 Revendas ativas</h2><h1>${rev.qtd}</h1></div>
  </div><div class="card"><h2>Últimos pedidos</h2>${table}</div>`));
});

function pedidoActions(o, back = '/admin/pedidos') {
  return `<div class="actions"><form class="forms-inline" method="post" action="/admin/pedido/${o.id}/editarimei"><input name="imei" placeholder="Novo IMEI" style="width:145px"><button class="btn purple">✏️</button></form>
  <form class="forms-inline" method="post" action="/admin/pedido/${o.id}/processo"><button class="btn orange">🔄</button></form>
  <form class="forms-inline" method="post" action="/admin/pedido/${o.id}/finalizar"><button class="btn green">✅</button></form>
  <form class="forms-inline" method="post" action="/admin/pedido/${o.id}/cancelar"><input name="motivo" placeholder="Motivo" style="width:120px"><button class="btn red">❌</button></form></div>`;
}
function pedidoTable(rows, showServico = true) {
  let html = `<table><tr><th>ID</th><th>IMEI</th>${showServico ? '<th>Serviço</th>' : ''}<th>Cliente/Revenda</th><th>WhatsApp</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const o of rows) html += `<tr><td>#${o.id}</td><td>${safeHtml(o.imei)}</td>${showServico ? `<td>${safeHtml(o.servico_nome)}</td>` : ''}<td>${safeHtml(o.revenda_nome || o.cliente_nome || '-')}</td><td>${safeHtml(o.revenda_numero || o.cliente_whatsapp || '-')}</td><td>${brl(o.valor)}</td><td><span class="pill">${safeHtml(o.status)}</span></td><td>${pedidoActions(o)}</td></tr>`;
  html += '</table>';
  return html;
}
app.get('/admin/pedidos', async (req, res) => {
  const status = req.query.status || '';
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (q) { where.push('(imei LIKE ? OR cliente_whatsapp LIKE ? OR cliente_nome LIKE ? OR revenda_numero LIKE ? OR revenda_nome LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`); }
  const sql = `SELECT * FROM pedidos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`;
  const rows = await all(sql, params);
  const html = `<div class="topbar"><h1>📋 Pedidos</h1><div><a class="btn gray" href="/admin/pedidos">Todos</a><a class="btn" href="/admin/pedidos?status=PENDENTE">Pendentes</a><a class="btn orange" href="/admin/pedidos?status=EM PROCESSO">Em Processo</a><a class="btn green" href="/admin/pedidos?status=FINALIZADO">Finalizados</a><a class="btn red" href="/admin/pedidos?status=CANCELADO">Cancelados</a></div></div>
  <div class="card"><form class="search" method="get"><input name="q" value="${safeHtml(q)}" placeholder="Buscar IMEI, WhatsApp ou nome"><button class="btn">Buscar</button></form></div>${pedidoTable(rows)}`;
  res.send(page('Pedidos', html));
});
app.post('/admin/pedido/:id/editarimei', async (req, res) => { const imei = onlyDigits(req.body.imei); if (/^\d{14,17}$/.test(imei)) await run('UPDATE pedidos SET imei=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [imei, req.params.id]); res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/processo', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'processo'); } res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/finalizar', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) await finalizarPedido(p); res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/cancelar', async (req, res) => { const motivo = req.body.motivo || 'Não informado'; const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'cancelar', motivo); } res.redirect(req.get('referer') || '/admin/pedidos'); });

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY id DESC');
  let html = `<h1>🏪 Revendas</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome da revenda" required><input name="whatsapp" placeholder="WhatsApp 5575..." required></div><button class="btn green">Adicionar Revenda</button></form></div><table><tr><th>ID</th><th>Nome</th><th>WhatsApp</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) html += `<tr><td>#${r.id}</td><td>${safeHtml(r.nome)}</td><td>${safeHtml(r.whatsapp || '-')}</td><td><span class="pill">${safeHtml(r.status)}</span></td><td>${brl(r.saldo)}</td><td class="actions"><a class="btn" href="/admin/revenda/${r.id}/editar">✏️ Editar</a><a class="btn" href="/admin/revenda/${r.id}/precos">Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">💳 Conta</a><a class="btn" href="/admin/revenda/${r.id}/historico">Histórico</a><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="${r.status === 'BLOQUEADA' ? 'ATIVA' : 'BLOQUEADA'}"><button class="btn orange">${r.status === 'BLOQUEADA' ? '🔓 Desbloquear' : '🔒 Bloquear'}</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="REMOVIDA"><button class="btn red" onclick="return confirm('Remover revenda?')">🗑️ Remover</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Revendas', html));
});
app.post('/admin/revendas', async (req, res) => { const w = onlyDigits(req.body.whatsapp); await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo) VALUES (?, ?, ?, ?, ?, "ATIVA", 0)', [req.body.nome, w, numberToJid(w), `rev${Date.now()}`, 'sem-senha']); res.redirect('/admin/revendas'); });
app.post('/admin/revenda/:id/status', async (req, res) => { await run('UPDATE revendas SET status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.status, req.params.id]); res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/editar', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); res.send(page('Editar Revenda', `<h1>✏️ Editar Revenda</h1><div class="card"><form method="post"><input name="nome" value="${safeHtml(r.nome)}" required><br><br><input name="whatsapp" value="${safeHtml(r.whatsapp)}" required><br><br><select name="status"><option ${r.status==='ATIVA'?'selected':''}>ATIVA</option><option ${r.status==='BLOQUEADA'?'selected':''}>BLOQUEADA</option><option ${r.status==='REMOVIDA'?'selected':''}>REMOVIDA</option></select><br><br><button class="btn green">Salvar</button></form></div>`)); });
app.post('/admin/revenda/:id/editar', async (req, res) => { const w = onlyDigits(req.body.whatsapp); await run('UPDATE revendas SET nome=?, whatsapp=?, jid=?, status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.nome, w, numberToJid(w), req.body.status, req.params.id]); res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/precos', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC'); let html = `<h1>💰 Preços - ${safeHtml(r.nome)}</h1><form method="post"><table><tr><th>Serviço</th><th>Preço da revenda</th></tr>`; for (const s of servs) { const preco = await precoDaRevenda(r.id, s.id); html += `<tr><td>${safeHtml(s.nome)}</td><td><input name="preco_${s.id}" value="${preco}"></td></tr>`; } html += `</table><br><button class="btn green">Salvar preços</button></form>`; res.send(page('Preços', html)); });
app.post('/admin/revenda/:id/precos', async (req, res) => { const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1'); for (const s of servs) { const preco = Number(String(req.body[`preco_${s.id}`] || '0').replace(',', '.')); await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, preco]); } res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/conta', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 50', [r.id]); let html = `<h1>💳 Conta da Revenda</h1><div class="card"><h2>${safeHtml(r.nome)}</h2><h1>${brl(r.saldo)}</h1><form method="post" action="/admin/revenda/${r.id}/pagamento"><input name="valor" placeholder="Valor pago"><br><br><button class="btn green">Registrar Pagamento</button></form></div><h2>Histórico</h2>${pedidoTable(pedidos)}`; res.send(page('Conta', html)); });
app.get('/admin/revenda/:id/historico', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 300', [r.id]); res.send(page('Histórico', `<h1>📋 Histórico - ${safeHtml(r.nome)}</h1>${pedidoTable(pedidos)}`)); });
app.post('/admin/revenda/:id/pagamento', async (req, res) => { const valor = Number(String(req.body.valor || '0').replace(',', '.')); const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); if (valor > 0 && r) { const novo = Math.max(0, Number(r.saldo || 0) - valor); await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, r.id]); await run('INSERT INTO pagamentos (revenda_id, revenda_nome, valor, origem) VALUES (?, ?, ?, "manual")', [r.id, r.nome, valor]); if (r.jid) await enviarTexto(r.jid, `✅ Pagamento registrado\n\n💰 Valor: ${brl(valor)}\n💳 Saldo: ${brl(novo)}\n\n🏢 CentralUnlocker`); } res.redirect(`/admin/revenda/${req.params.id}/conta`); });

app.get('/admin/servicos', async (req, res) => { const rows = await all('SELECT s.*, (SELECT COUNT(*) FROM pedidos p WHERE p.servico_id=s.id) total FROM servicos_catalogo s ORDER BY s.id ASC'); let html = `<h1>🛠 Serviços</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome do serviço" required><input name="preco" placeholder="Preço padrão"></div><button class="btn green">Adicionar Serviço</button></form></div><table><tr><th>ID</th><th>Serviço</th><th>Preço padrão</th><th>Status</th><th>IMEIs</th><th>Ações</th></tr>`; for (const s of rows) html += `<tr><td>#${s.id}</td><td><a href="/admin/servico/${s.id}/imeis">${safeHtml(s.nome)}</a></td><td>${brl(s.preco_padrao)}</td><td><span class="pill">${s.ativo ? 'Ativo' : 'Inativo'}</span></td><td>${s.total}</td><td class="actions"><a class="btn" href="/admin/servico/${s.id}/imeis">📱 IMEIs</a><a class="btn purple" href="/admin/servico/${s.id}/editar">✏️ Editar</a><form class="forms-inline" method="post" action="/admin/servico/${s.id}/toggle"><button class="btn gray">${s.ativo ? 'Desativar' : 'Ativar'}</button></form><form class="forms-inline" method="post" action="/admin/servico/${s.id}/excluir"><button class="btn red" onclick="return confirm('Excluir serviço e pedidos vinculados?')">🗑️ Excluir</button></form></td></tr>`; html += '</table>'; res.send(page('Serviços', html)); });
app.post('/admin/servicos', async (req, res) => { await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.'))]); const revs = await all('SELECT * FROM revendas WHERE status="ATIVA" AND jid IS NOT NULL'); for (const r of revs) await enviarTexto(r.jid, `🆕 Novo serviço disponível\n\n🛠 ${req.body.nome}\n\nDigite menu para ver sua tabela.`); res.redirect('/admin/servicos'); });
app.get('/admin/servico/:id/editar', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); res.send(page('Editar Serviço', `<h1>✏️ Editar Serviço</h1><div class="card"><form method="post"><input name="nome" value="${safeHtml(s.nome)}" required><br><br><input name="preco" value="${s.preco_padrao}"><br><br><button class="btn green">Salvar</button></form></div>`)); });
app.post('/admin/servico/:id/editar', async (req, res) => { await run('UPDATE servicos_catalogo SET nome=?, preco_padrao=? WHERE id=?', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.')), req.params.id]); res.redirect('/admin/servicos'); });
app.post('/admin/servico/:id/toggle', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); if (s) await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [s.ativo ? 0 : 1, s.id]); res.redirect('/admin/servicos'); });
app.post('/admin/servico/:id/excluir', async (req, res) => { await run('DELETE FROM precos_revenda WHERE servico_id=?', [req.params.id]); await run('DELETE FROM pedidos WHERE servico_id=?', [req.params.id]); await run('DELETE FROM servicos_catalogo WHERE id=?', [req.params.id]); res.redirect('/admin/servicos'); });
app.get('/admin/servico/:id/imeis', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); const rows = await all('SELECT * FROM pedidos WHERE servico_id=? ORDER BY id DESC LIMIT 500', [req.params.id]); res.send(page('IMEIs', `<h1>📱 IMEIs - ${safeHtml(s.nome)}</h1>${pedidoTable(rows, false)}`)); });

app.get('/admin/financeiro', async (req, res) => { const revs = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY saldo DESC'); const pags = await all('SELECT * FROM pagamentos ORDER BY id DESC LIMIT 50'); let total = 0; let html = '<h1>💰 Financeiro</h1><div class="card"><h2>Saldos das Revendas</h2><table><tr><th>Revenda</th><th>Saldo</th><th>Ação</th></tr>'; for (const r of revs) { total += Number(r.saldo || 0); html += `<tr><td>${safeHtml(r.nome)}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/conta">Conta</a></td></tr>`; } html += `</table><h2>Total em aberto: ${brl(total)}</h2></div><div class="card"><h2>Últimos pagamentos</h2><table><tr><th>Data</th><th>Revenda/Cliente</th><th>Valor</th><th>Origem</th></tr>`; for (const p of pags) html += `<tr><td>${dateBR(p.criado_em)}</td><td>${safeHtml(p.revenda_nome || p.cliente_numero || '-')}</td><td>${brl(p.valor)}</td><td>${safeHtml(p.origem)}</td></tr>`; html += '</table></div>'; res.send(page('Financeiro', html)); });
app.get('/admin/relatorios', async (req, res) => { const tipo = req.query.tipo || 'diario'; const txt = await resumoPeriodo(tipo); const parts = txt.replace(/\*/g,'').split('\n').filter(Boolean); res.send(page('Relatórios', `<h1>📈 Relatórios</h1><div class="card"><a class="btn" href="/admin/relatorios?tipo=diario">Diário</a><a class="btn" href="/admin/relatorios?tipo=mensal">Mensal</a><a class="btn" href="/admin/relatorios?tipo=anual">Anual</a></div><div class="card"><pre style="white-space:pre-wrap;font-size:18px">${safeHtml(parts.join('\n'))}</pre></div>`)); });
app.get('/admin/config', (req, res) => res.send(page('Configurações', `<h1>⚙️ Configurações</h1><div class="card"><p><b>Admin:</b> ${safeHtml(ADMIN_NUMBER)}</p><p><b>DB:</b> ${safeHtml(DB_PATH)}</p><p><b>Status WhatsApp:</b> ${conectado ? 'Conectado ✅' : 'Desconectado ❌'}</p></div>`)));
app.get('/admin/logout', (req, res) => { res.status(401).set('WWW-Authenticate', 'Basic realm="CentralUnlocker Admin"').send(page('Sair', '<h1>🚪 Sessão encerrada</h1><p>Feche esta aba ou entre novamente.</p>')); });

async function criarBackup() { const destino = path.join(BACKUP_DIR, `backup-${today()}-${Date.now()}.db`); await new Promise((resolve, reject) => db.backup(destino, (err) => err ? reject(err) : resolve())); console.log('✅ BACKUP CRIADO:', destino); return destino; }
function listarBackups() { if (!fs.existsSync(BACKUP_DIR)) return []; return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse(); }
app.get('/admin/backup', async (req, res) => { const backs = listarBackups(); let html = `<h1>💾 Backup</h1><form method="post" action="/admin/backup/criar"><button class="btn green">📦 Criar Backup</button></form><table><tr><th>#</th><th>Arquivo</th><th>Ações</th></tr>`; backs.forEach((b, i) => html += `<tr><td>${i + 1}</td><td>${safeHtml(b)}</td><td><a class="btn" href="/admin/backup/download/${encodeURIComponent(b)}">⬇️ Baixar</a><form class="forms-inline" method="post" action="/admin/backup/restaurar"><input type="hidden" name="file" value="${safeHtml(b)}"><button class="btn red" onclick="return confirm('Restaurar este backup?')">🔄 Restaurar</button></form></td></tr>`); html += '</table>'; res.send(page('Backup', html)); });
app.post('/admin/backup/criar', async (req, res) => { await criarBackup(); res.redirect('/admin/backup'); });
app.get('/admin/backup/download/:file', (req, res) => { const file = path.basename(req.params.file); res.download(path.join(BACKUP_DIR, file)); });
app.post('/admin/backup/restaurar', async (req, res) => { const file = path.basename(req.body.file || ''); const origem = path.join(BACKUP_DIR, file); if (!fs.existsSync(origem)) return res.send(page('Erro', '<h1>Backup não encontrado</h1>')); criarBackup().then(() => db.close((err) => { if (err) console.log(err); fs.copyFileSync(origem, DB_PATH); console.log('✅ RESTAURADO:', origem); res.send(page('Restaurado', '<h1>✅ Backup restaurado</h1><p>O serviço será reiniciado para carregar o banco restaurado.</p>')); setTimeout(() => process.exit(0), 1500); })); });

cron.schedule('0 2 * * *', async () => { try { await criarBackup(); } catch (e) { console.log('❌ BACKUP AUTOMÁTICO:', e); } }, { timezone: 'America/Sao_Paulo' });

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR ONLINE NA PORTA ${PORT}`));
iniciarWhatsApp();
