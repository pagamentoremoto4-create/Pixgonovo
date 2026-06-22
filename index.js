require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;
const PIXGO_API = 'https://pixgo.org/api/v1';

// Tudo que precisa sobreviver a restart/deploy do Render fica no Persistent Disk.
// Configure DATA_DIR=/data no Render e crie o Disk com mount path /data.
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : __dirname);
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'database.db');
const DB_DIR = path.dirname(DB_PATH);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_IMG_DIR = path.join(PUBLIC_DIR, 'img');
const HACKER_IMAGE_PATH = path.join(PUBLIC_IMG_DIR, 'hacker.png');
const THEME_DIR = process.env.THEME_DIR || path.join(DATA_DIR, 'themes');
const ESIM_DIR = process.env.ESIM_DIR || path.join(DATA_DIR, 'esim');

// Mantém os QR Codes eSIM acessíveis pela URL /esim/arquivo.png,
// mas os arquivos ficam salvos em /data/esim.
app.use('/esim', express.static(ESIM_DIR));
const ADMIN_NUMBER = onlyDigits(process.env.ADMIN_NUMBER || '');
const ADMIN_NUMBERS = Array.from(new Set([
  ADMIN_NUMBER,
  ...String(process.env.ADMIN_NUMBERS || '').split(',').map(onlyDigits)
].filter(Boolean)));
const ADMIN_PANEL_USER = process.env.ADMIN_PANEL_USER || 'admin';
const ADMIN_PANEL_PASS = process.env.ADMIN_PANEL_PASS || '123456';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
if (!fs.existsSync(ESIM_DIR)) fs.mkdirSync(ESIM_DIR, { recursive: true });
if (!fs.existsSync(THEME_DIR)) fs.mkdirSync(THEME_DIR, { recursive: true });
app.use('/themes', express.static(THEME_DIR));

let sock = null;
let qrCodeBase64 = null;
let conectado = false;
let db = new sqlite3.Database(DB_PATH);
let PAINEL_TEMA = 'hacker-green';
const TEMAS_PAINEL = {
  'hacker-green': { nome: '🟢 Hacker Verde', cor: '#00ff66', cor2: '#28d7ff' },
  'hacker-blue': { nome: '🔵 Hacker Azul', cor: '#28d7ff', cor2: '#2f80ed' },
  'hacker-red': { nome: '🔴 Hacker Vermelho', cor: '#ff3b3b', cor2: '#ff9f43' },
  'hacker-purple': { nome: '🟣 Hacker Roxo', cor: '#a855f7', cor2: '#28d7ff' },
  'dark-pro': { nome: '⚫ Dark Pro', cor: '#94a3b8', cor2: '#2f80ed' }
};

const pedidoSessao = new Map();
const adminSessao = new Map();

function temaAtualPainel() {
  return PAINEL_TEMA || 'hacker-green';
}
function temaVars(nome) {
  const temas = {
    'hacker-green': { bg:'#07111f', bg2:'#0c1426', card:'#101b31', card2:'#0d172a', line:'#24324b', text:'#eaf0f8', muted:'#97a6ba', accent:'#00ff66', accent2:'#28d7ff' },
    'hacker-blue': { bg:'#061122', bg2:'#081a34', card:'#0d1b33', card2:'#0b1730', line:'#1f3b67', text:'#eaf6ff', muted:'#9ab4d3', accent:'#28d7ff', accent2:'#2f80ed' },
    'hacker-red': { bg:'#120707', bg2:'#1d0b0b', card:'#201010', card2:'#160b0b', line:'#4a1d1d', text:'#fff1f1', muted:'#d6a2a2', accent:'#ff3b3b', accent2:'#ff9f43' },
    'hacker-purple': { bg:'#0b0716', bg2:'#130b28', card:'#19112e', card2:'#110b22', line:'#3a2465', text:'#f5efff', muted:'#b8a6d9', accent:'#a855f7', accent2:'#28d7ff' },
    'dark-pro': { bg:'#05070b', bg2:'#0b1020', card:'#101827', card2:'#0b1220', line:'#263143', text:'#f8fafc', muted:'#94a3b8', accent:'#94a3b8', accent2:'#2f80ed' },
    'gold-vip': { bg:'#111006', bg2:'#1c1709', card:'#211b0c', card2:'#151106', line:'#4a3b14', text:'#fff8df', muted:'#d7c58b', accent:'#ffd166', accent2:'#ff9f1c' }
  };
  return temas[nome] || temas['hacker-green'];
}
function hackerImagemAtual() {
  return getConfig ? getConfig('painel_hacker_image', '') : '';
}
function ensureHackerModelos() {
  const modelos = [
    ['hacker_green.svg', '#00ff66', '#28d7ff', 'CENTRALUNLOCKER'],
    ['hacker_blue.svg', '#28d7ff', '#2f80ed', 'SECURE PANEL'],
    ['hacker_red.svg', '#ff3b3b', '#ff9f43', 'FAST MODE'],
    ['hacker_purple.svg', '#a855f7', '#28d7ff', 'CYBER ADMIN']
  ];
  for (const [file, c1, c2, title] of modelos) {
    const fp = path.join(THEME_DIR, file);
    if (!fs.existsSync(fp)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="650" viewBox="0 0 1200 650">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#05070b"/><stop offset="1" stop-color="#111827"/></linearGradient><radialGradient id="r" cx="70%" cy="35%" r="60%"><stop offset="0" stop-color="${c1}" stop-opacity=".35"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="650" fill="url(#g)"/><rect width="1200" height="650" fill="url(#r)"/>
<g opacity=".17" font-family="monospace" font-size="22" fill="${c1}">
${Array.from({length:18}).map((_,i)=>`<text x="${20+(i%3)*390}" y="${40+i*34}">010101  ACCESS  ${title}  101010</text>`).join('')}
</g>
<g transform="translate(710 80)">
<circle cx="160" cy="120" r="92" fill="#0b1220" stroke="${c1}" stroke-width="5"/>
<path d="M55 315c35-110 175-145 255-45 30 37 44 90 48 155H10c7-45 20-82 45-110z" fill="#0b1220" stroke="${c1}" stroke-width="6"/>
<path d="M88 116c55 40 110 43 172 0 0 70-26 115-86 132-60-16-86-62-86-132z" fill="#111827" stroke="${c2}" stroke-width="5"/>
<rect x="94" y="141" width="160" height="42" rx="20" fill="#020617" stroke="${c1}" stroke-width="4"/>
<circle cx="140" cy="162" r="7" fill="${c1}"/><circle cx="210" cy="162" r="7" fill="${c1}"/>
</g>
<text x="70" y="510" font-family="Arial Black, Arial" font-size="58" fill="${c1}">${title}</text>
<text x="72" y="560" font-family="Arial" font-size="28" fill="#eaf0f8">Painel profissional • eSIM • Revendas • PIX</text>
</svg>`;
      fs.writeFileSync(fp, svg);
    }
  }
}


const uploadTema = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, THEME_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.jpg') || '.jpg';
      cb(null, `hacker_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || ''))
});

const uploadEsim = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ESIM_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.png') || '.png';
      cb(null, `esim_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || ''))
});

// Travas anti-loop/anti-mensagens antigas do Baileys
const mensagensProcessadas = new Set();
const ultimoErroImei = new Map();
const BOT_START_TIME = Date.now();

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

function caminhoArquivoEsim(arquivoQr) {
  if (!arquivoQr) return '';
  return path.join(ESIM_DIR, path.basename(String(arquivoQr)));
}

function normalizarNumeroWhatsApp(v) {
  let d = onlyDigits(v);
  // remove zeros na frente
  d = d.replace(/^0+/, '');
  // Se vier só DDD + número, adiciona Brasil 55
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
  return d;
}
function variantesNumero(v) {
  const base = normalizarNumeroWhatsApp(v);
  const set = new Set();
  if (!base) return [];
  set.add(base);
  // sem DDI 55
  if (base.startsWith('55')) set.add(base.slice(2));
  // Brasil móvel: tenta com e sem o nono dígito depois do DDD
  if (base.startsWith('55') && base.length === 13) {
    // 55 + DD + 9 + 8 dígitos => remove o 9
    set.add(base.slice(0, 4) + base.slice(5));
    set.add((base.slice(0, 4) + base.slice(5)).slice(2));
  }
  if (base.startsWith('55') && base.length === 12) {
    // 55 + DD + 8 dígitos => adiciona o 9
    set.add(base.slice(0, 4) + '9' + base.slice(4));
    set.add((base.slice(0, 4) + '9' + base.slice(4)).slice(2));
  }
  return Array.from(set).filter(Boolean);
}
function jidToNumber(jid) {
  const raw = String(jid || '').split('@')[0].split(':')[0];
  return normalizarNumeroWhatsApp(raw);
}
function numberToJid(n) { const d = normalizarNumeroWhatsApp(n); return d ? `${d}@s.whatsapp.net` : ''; }
function numerosPossiveisDaMensagem(msg, fallbackJid) {
  const valores = [
    msg?.key?.remoteJid,
    msg?.key?.remoteJidAlt,
    msg?.key?.participant,
    msg?.key?.participantAlt,
    msg?.participant,
    msg?.participantAlt,
    msg?.senderPn,
    msg?.key?.senderPn,
    msg?.message?.extendedTextMessage?.contextInfo?.participant,
    fallbackJid
  ].filter(Boolean);
  const set = new Set();
  for (const v of valores) {
    const n = jidToNumber(v);
    for (const alt of variantesNumero(n)) set.add(alt);
  }
  return Array.from(set).filter(Boolean);
}
function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function textoSituacaoSaldo(saldo) {
  const v = Number(saldo || 0);
  if (v < 0) return `⚠️ Débito em aberto:\n${brl(Math.abs(v))}`;
  if (v > 0) return `💰 Crédito disponível:\n${brl(v)}`;
  return '✅ Conta quitada';
}
function textoSaldoCurto(saldo) {
  const v = Number(saldo || 0);
  if (v < 0) return `Débito: ${brl(Math.abs(v))}`;
  if (v > 0) return `Crédito: ${brl(v)}`;
  return 'Quitado';
}

function normalizarTipoRevenda(v) {
  const t = String(v || 'POS_PAGO').toUpperCase().replace(/[ÁÀÃÂ]/g, 'A').replace(/[ÉÊ]/g, 'E').replace(/[^A-Z_]/g, '_');
  return t.includes('PRE') ? 'PRE_PAGO' : 'POS_PAGO';
}
function labelTipoRevenda(v) { return normalizarTipoRevenda(v) === 'PRE_PAGO' ? 'Pré-pago' : 'Pós-pago'; }
function isRevendaPrePaga(revenda) { return normalizarTipoRevenda(revenda?.tipo_revenda) === 'PRE_PAGO'; }
function textoSaldoInsuficiente(revenda, valor, item='serviço') {
  const saldo = Number(revenda?.saldo || 0);
  const falta = Math.max(0, Number(valor || 0) - saldo);
  return `❌ Saldo insuficiente.

${item ? `🛠 ${item}
` : ''}💰 Valor: ${brl(valor)}
💳 Seu saldo atual: ${brl(saldo)}

Faltam: ${brl(falta)}

Para adicionar saldo, digite:

*pagar ${falta.toFixed(2).replace('.', ',')}*

Ou digite outro valor, exemplo:
*pagar 100*
*pagar 200*

Após a confirmação do PIX, seu saldo será liberado automaticamente.`;
}

function normalizarTipoEntrada(v) {
  const t = String(v || 'IMEI').toUpperCase().replace(/[^A-Z_]/g, '');
  return ['IMEI', 'LOCK_CODE', 'OUTRO'].includes(t) ? t : 'IMEI';
}
function labelEntradaServico(servico) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  if (String(servico?.entrada_label || '').trim()) return String(servico.entrada_label).trim();
  if (tipo === 'LOCK_CODE') return 'Lock Code';
  if (tipo === 'OUTRO') return 'Informação';
  return 'IMEI';
}
function tituloTipoEntrada(tipo) {
  tipo = normalizarTipoEntrada(tipo);
  if (tipo === 'LOCK_CODE') return 'Lock Code';
  if (tipo === 'OUTRO') return 'Outro';
  return 'IMEI';
}
function iconeEntradaServico(servico) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  if (tipo === 'LOCK_CODE') return '🔐';
  if (tipo === 'OUTRO') return '📝';
  return '📱';
}
function extrairImeisEmLote(texto) {
  const matches = String(texto || '').match(/\d{15}/g) || [];
  return [...new Set(matches)];
}
function validarEntradaServico(servico, textoOriginal) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  const bruto = String(textoOriginal || '').trim();
  if (tipo === 'IMEI') {
    const imeis = extrairImeisEmLote(bruto);
    if (!imeis.length) return { ok: false, erro: `❌ IMEI inválido.\n\n📱 Envie 1 IMEI com 15 dígitos ou vários IMEIs, um por linha.\n\nExemplo:\n356789123456789\n356789123456780\n\nDigite cancelar para sair.` };
    const sobras = bruto.replace(/\d{15}/g, '').replace(/[\s,;.\-_/]+/g, '');
    if (sobras) return { ok: false, erro: `❌ Envio em lote aceito somente com IMEIs de 15 dígitos.\n\nEnvie um IMEI por linha ou separados por espaço.\n\nDigite cancelar para sair.` };
    return { ok: true, entradas: imeis };
  }
  if (!bruto || bruto.length < 2) return { ok: false, erro: `❌ ${labelEntradaServico(servico)} inválido.\n\nEnvie a informação solicitada ou digite cancelar.` };
  return { ok: true, entradas: [bruto] };
}
function textoEntradaPedido(pedido) {
  const label = pedido.entrada_label || (normalizarTipoEntrada(pedido.tipo_entrada) === 'LOCK_CODE' ? 'Lock Code' : normalizarTipoEntrada(pedido.tipo_entrada) === 'OUTRO' ? 'Informação' : 'IMEI');
  const valor = pedido.entrada_valor || pedido.imei || '-';
  return `${iconeEntradaServico(pedido)} ${label}: ${valor}`;
}
function today() { return new Date().toISOString().slice(0, 10); }
function dateBR(v) { if (!v) return '-'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }
function isGroup(jid) { return String(jid || '').endsWith('@g.us'); }
function isAdminJid(jid) { const n = jidToNumber(jid); return ADMIN_NUMBERS.includes(n); }
function isPhoneJid(jid) { return String(jid || '').endsWith('@s.whatsapp.net'); }
function isLidJid(jid) { return String(jid || '').endsWith('@lid'); }
function melhorJidCliente(msg, fallback) {
  const candidates = [
    msg?.key?.remoteJidAlt,
    msg?.key?.remoteJid,
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.participantAlt,
    msg?.participant,
    msg?.senderPn,
    msg?.key?.senderPn,
    msg?.message?.extendedTextMessage?.contextInfo?.participant,
    fallback
  ].filter(Boolean);
  const phone = candidates.find(isPhoneJid);
  if (phone) return phone;
  return candidates[0] || fallback;
}
function nomeContatoSeguro(msg, fallback = 'Cliente') {
  if (msg?.key?.fromMe) return fallback;
  return msg?.pushName || msg?.notifyName || msg?.verifiedBizName || fallback;
}
function safeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function temaAtual() { return TEMAS_PAINEL[PAINEL_TEMA] ? PAINEL_TEMA : 'hacker-green'; }
function temCor() { return TEMAS_PAINEL[temaAtual()].cor; }
async function getConfig(chave, padrao='') { const r = await get('SELECT valor FROM configs WHERE chave=?', [chave]); return r ? r.valor : padrao; }
async function setConfig(chave, valor) { await run('INSERT OR REPLACE INTO configs (chave, valor, atualizado_em) VALUES (?, ?, CURRENT_TIMESTAMP)', [chave, valor]); }
function notificarPainel(tipo, titulo, mensagem) {
  const n = { tipo, titulo, mensagem, hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) };
  io.emit('notificacao', n);
  io.emit('dashboard-update', { at: Date.now() });
  console.log('🔔 PAINEL:', titulo, mensagem || '');
}

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
  await addColumnIfMissing('revendas', 'tipo_revenda', "TEXT DEFAULT 'POS_PAGO'");

  await run(`CREATE TABLE IF NOT EXISTS servicos_catalogo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    preco_padrao REAL DEFAULT 0,
    tipo_entrada TEXT DEFAULT 'IMEI',
    entrada_label TEXT DEFAULT 'IMEI',
    ativo INTEGER DEFAULT 1,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await addColumnIfMissing('servicos_catalogo', 'tipo_entrada', "TEXT DEFAULT 'IMEI'");
  await addColumnIfMissing('servicos_catalogo', 'entrada_label', "TEXT DEFAULT 'IMEI'");

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
    entrada_valor TEXT,
    tipo_entrada TEXT DEFAULT 'IMEI',
    entrada_label TEXT DEFAULT 'IMEI',
    lote_id TEXT,
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
  await addColumnIfMissing('pedidos', 'entrada_valor', 'TEXT');
  await addColumnIfMissing('pedidos', 'tipo_entrada', "TEXT DEFAULT 'IMEI'");
  await addColumnIfMissing('pedidos', 'entrada_label', "TEXT DEFAULT 'IMEI'");
  await addColumnIfMissing('pedidos', 'lote_id', 'TEXT');

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

  await run(`CREATE TABLE IF NOT EXISTS esim_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_plano TEXT NOT NULL,
    preco_revenda REAL DEFAULT 0,
    preco_cliente REAL DEFAULT 0,
    arquivo_qr TEXT,
    status TEXT DEFAULT 'DISPONIVEL',
    revenda_id INTEGER,
    revenda_nome TEXT,
    pedido_id INTEGER,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    vendido_em TEXT
  )`);
  await addColumnIfMissing('esim_estoque', 'preco_revenda', 'REAL DEFAULT 0');
  await addColumnIfMissing('esim_estoque', 'preco_cliente', 'REAL DEFAULT 0');
  await addColumnIfMissing('esim_estoque', 'revenda_id', 'INTEGER');
  await addColumnIfMissing('esim_estoque', 'revenda_nome', 'TEXT');
  await addColumnIfMissing('esim_estoque', 'pedido_id', 'INTEGER');

  // Catálogo de planos eSIM: permite vender manualmente mesmo sem QR disponível no estoque.
  await run(`CREATE TABLE IF NOT EXISTS esim_planos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_plano TEXT NOT NULL,
    preco_revenda REAL DEFAULT 0,
    preco_cliente REAL DEFAULT 0,
    ativo INTEGER DEFAULT 1,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(nome_plano, preco_revenda)
  )`);
  await addColumnIfMissing('esim_planos', 'preco_cliente', 'REAL DEFAULT 0');
  await addColumnIfMissing('esim_planos', 'ativo', 'INTEGER DEFAULT 1');

  // Migra os planos já existentes no estoque para o catálogo.
  await run(`INSERT OR IGNORE INTO esim_planos (nome_plano, preco_revenda, preco_cliente, ativo)
    SELECT nome_plano, preco_revenda, COALESCE(preco_cliente, preco_revenda), 1
    FROM esim_estoque
    WHERE nome_plano IS NOT NULL AND TRIM(nome_plano) != ''`);

  await run(`CREATE TABLE IF NOT EXISTS configs (
    chave TEXT PRIMARY KEY,
    valor TEXT,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS mensagens_envio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destino TEXT,
    revenda_id INTEGER,
    mensagem TEXT,
    imagem TEXT,
    total INTEGER DEFAULT 0,
    enviadas INTEGER DEFAULT 0,
    falhas INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  PAINEL_TEMA = await getConfig('painel_tema', 'hacker-green');
  ensureHackerModelos();

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
  const tv = temaVars(temaAtualPainel());
  const img = hackerImagemAtual();
  const imgCss = img ? `body:before{content:"";position:fixed;inset:0;background:linear-gradient(90deg,rgba(7,17,31,.96),rgba(7,17,31,.82)),url('${img}') right bottom/520px auto no-repeat;pointer-events:none;z-index:-1}` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(title)}</title>
  <style>
  :root{--bg:${tv.bg};--bg2:${tv.bg2};--card:${tv.card};--card2:${tv.card2};--soft:#16223a;--line:${tv.line};--text:${tv.text};--muted:${tv.muted};--blue:#2f80ed;--cyan:${tv.accent2};--green:${tv.accent};--red:#ff4d4f;--orange:#ff9f43;--purple:#9b5cff;--shadow:0 18px 45px rgba(0,0,0,.35)}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,${tv.accent}22,transparent 32%),linear-gradient(135deg,var(--bg),var(--bg2));color:var(--text);font-family:Inter,Arial,sans-serif;min-height:100vh}${imgCss}
  .layout{display:grid;grid-template-columns:270px 1fr;min-height:100vh}.side{background:linear-gradient(180deg,rgba(8,17,31,.98),rgba(8,17,31,.88));backdrop-filter:blur(12px);border-right:1px solid var(--line);padding:18px;position:sticky;top:0;height:100vh;overflow:auto}
  .brand{font-size:21px;font-weight:900;margin:4px 0 18px;letter-spacing:.3px}.brand span{color:var(--green)}.side a{display:flex;gap:10px;align-items:center;color:var(--text);text-decoration:none;padding:11px 12px;border-radius:14px;margin:6px 0;background:transparent;border:1px solid transparent}.side a:hover{background:rgba(255,255,255,.05);border-color:var(--line);transform:translateX(2px)}
  .main{padding:24px;max-width:1400px;width:100%}h1{font-size:30px;margin:0 0 18px}h2{margin:0 0 12px}.card{background:linear-gradient(180deg,rgba(16,27,49,.96),rgba(13,23,42,.94));border:1px solid var(--line);border-radius:20px;padding:18px;margin:14px 0;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.metric h1{font-size:36px;color:var(--green);text-shadow:0 0 18px ${tv.accent}55}
  input,select,textarea{width:100%;padding:12px 13px;border-radius:14px;border:1px solid var(--line);background:#050b16;color:var(--text);margin:6px 0 12px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px ${tv.accent}22}
  .btn,button{background:linear-gradient(135deg,var(--blue),var(--cyan));color:white;border:0;border-radius:13px;padding:10px 14px;text-decoration:none;font-weight:800;display:inline-block;margin:2px;cursor:pointer;box-shadow:0 8px 18px rgba(0,0,0,.22)}.green{background:linear-gradient(135deg,var(--green),var(--cyan))}.red{background:linear-gradient(135deg,var(--red),#b91c1c)}.orange{background:linear-gradient(135deg,var(--orange),#ef4444)}
  .muted{color:var(--muted)}table{width:100%;border-collapse:collapse;background:#08111f;border-radius:16px;overflow:hidden}td,th{padding:11px;border-bottom:1px solid var(--line);text-align:left}th{background:rgba(255,255,255,.05)}.pill{padding:6px 10px;border-radius:999px;background:${tv.accent}22;color:var(--green);font-weight:900}
  .hero{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;align-items:center}.hero img{max-width:100%;border-radius:20px;border:1px solid var(--line);box-shadow:var(--shadow)}
  @media(max-width:900px){.layout{grid-template-columns:1fr}.side{position:relative;height:auto}.main{padding:14px}.hero{grid-template-columns:1fr}}
  </style></head><body><div class="layout"><div class="side"><div class="brand">⚡ <span>Central</span>unlocker</div><a href="/admin">📊 Dashboard</a><a href="/admin/produtos">📦 Produtos</a><a href="/admin/estoque">📥 Estoque QR</a><a href="/admin/esim">📱 eSIM</a><a href="/admin/pedidos">📋 Pedidos</a><a href="/admin/revendas">🏪 Revendas</a><a href="/admin/mensagem">📢 Mensagem</a><a href="/admin/financeiro">💵 Financeiro</a><a href="/admin/temas">🎨 Temas</a><a href="/admin/config">⚙️ Config</a><a href="/admin/logout">🚪 Sair</a></div><div class="main">${body}</div></div></body></html>`;
}

app.get('/', (req, res) => {
  if (qrCodeBase64) return res.send(page('QR', `<div class="card" style="text-align:center"><h1>📱 ESCANEIE O QR</h1><img src="${qrCodeBase64}" width="300"><p>WhatsApp > Aparelhos conectados</p></div>`));
  res.send(page('Online', `<div class="card" style="text-align:center"><h1>✅ CENTRALUNLOCKER ONLINE</h1><p>${conectado ? 'WhatsApp conectado ✅' : 'Aguardando QR...'}</p><p><a class="btn green" href="/admin">Acessar painel admin</a></p></div>`));
});


// Webhook PixGo - responde HTTP 200 para evitar alerta de falha.
// O sistema já confirma pagamento por consulta automática, então este endpoint
// serve para receber notificações da PixGo sem quebrar o fluxo atual.
app.all('/webhook/pixgo', async (req, res) => {
  try {
    console.log('📩 WEBHOOK PIXGO:', req.method, req.body || {});
    return res.status(200).json({ success: true, received: true });
  } catch (e) {
    console.log('❌ ERRO WEBHOOK PIXGO:', e.message);
    return res.status(200).json({ success: true, received: false });
  }
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
  let table = '<table><tr><th>ID</th><th>Entrada</th><th>Serviço</th><th>Cliente/Revenda</th><th>Status</th></tr>';
  for (const o of ult) table += `<tr><td>#${o.id}</td><td>${safeHtml(o.entrada_valor || o.imei || '-')}</td><td>${safeHtml(o.servico_nome)}</td><td>${safeHtml(o.revenda_nome || o.cliente_nome || '-')}</td><td><span class="pill">${safeHtml(o.status)}</span></td></tr>`;
  table += '</table>';
  res.send(page('Dashboard', `<div data-live-dashboard="1"></div><div class="hero-hacker"><div class="hero-content"><div class="eyebrow">Painel seguro</div><h1>Painel <span>CentralUnlocker</span></h1><p>Controle total de pedidos, revendas, saldo, IMEI, Lock Code e serviços manuais.</p></div><div class="system-card"><h3>Status do sistema</h3><div class="system-row"><span>API Principal</span><span class="online">ONLINE</span></div><div class="system-row"><span>Bot WhatsApp</span><span class="online">${conectado ? 'CONECTADO' : 'OFFLINE'}</span></div><div class="system-row"><span>Processador</span><span class="online">ONLINE</span></div><div class="system-row"><span>Banco de Dados</span><span class="online">ONLINE</span></div></div></div><div class="topbar"><h1>Resumo geral</h1><span class="clock-box">🕒 ${dateBR(new Date())}</span></div><div class="grid">
  <div class="card metric"><h2>🟡 Pendentes</h2><h1>${p.qtd}</h1></div><div class="card metric"><h2>🔄 Em Processo</h2><h1>${ep.qtd}</h1></div><div class="card metric"><h2>✅ Finalizados</h2><h1>${f.qtd}</h1></div><div class="card metric"><h2>❌ Cancelados</h2><h1>${c.qtd}</h1></div><div class="card metric"><h2>💰 Hoje</h2><h1>${brl(hoje.total)}</h1></div><div class="card metric"><h2>💳 Balanço revendas</h2><h1>${brl(saldo.total)}</h1></div><div class="card metric"><h2>🏪 Revendas ativas</h2><h1>${rev.qtd}</h1></div>
  </div><div class="card"><h2>Últimos pedidos</h2>${table}</div>`));
});

function pedidoActions(o, back = '/admin/pedidos') {
  return `<form class="status-action-form" method="post" action="/admin/pedido/${o.id}/acao" onsubmit="return confirmarAcaoPedido(this)">
    <select name="acao" required>
      <option value="">Escolher ação</option>
      <option value="processo">🔄 Colocar em processo</option>
      <option value="finalizar">✅ Finalizar</option>
      <option value="cancelar">❌ Cancelar</option>
    </select>
    <input name="motivo" placeholder="Motivo do cancelamento" style="display:none;margin-top:6px" oninput="this.dataset.changed='1'">
    <button class="btn green">Aplicar</button>
  </form>
  <form class="forms-inline" method="post" action="/admin/pedido/${o.id}/apagar" onsubmit="return confirm('Apagar definitivamente o pedido #${o.id}?')">
    <button class="btn red">🗑️ Apagar</button>
  </form>`;
}
function pedidoTable(rows, showServico = true) {
  let html = `<table><tr><th>ID</th><th>Entrada</th>${showServico ? '<th>Serviço</th>' : ''}<th>Cliente/Revenda</th><th>WhatsApp</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const o of rows) html += `<tr><td>#${o.id}</td><td>${safeHtml(o.entrada_valor || o.imei || '-')}<br><span class="muted">${safeHtml(o.entrada_label || 'IMEI')}</span></td>${showServico ? `<td>${safeHtml(o.servico_nome)}</td>` : ''}<td>${safeHtml(o.revenda_nome || o.cliente_nome || '-')}</td><td>${safeHtml(o.revenda_numero || o.cliente_whatsapp || '-')}</td><td>${brl(o.valor)}</td><td><span class="pill">${safeHtml(o.status)}</span></td><td>${pedidoActions(o)}</td></tr>`;
  html += '</table>';
  return html;
}
app.get('/admin/pedidos', async (req, res) => {
  const status = req.query.status || '';
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (q) { where.push('(imei LIKE ? OR entrada_valor LIKE ? OR cliente_whatsapp LIKE ? OR cliente_nome LIKE ? OR revenda_numero LIKE ? OR revenda_nome LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`); }
  const sql = `SELECT * FROM pedidos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`;
  const rows = await all(sql, params);
  const html = `<div class="topbar"><h1>📋 Pedidos</h1><div><a class="btn gray" href="/admin/pedidos">Todos</a><a class="btn" href="/admin/pedidos?status=PENDENTE">Pendentes</a><a class="btn orange" href="/admin/pedidos?status=EM PROCESSO">Em Processo</a><a class="btn green" href="/admin/pedidos?status=FINALIZADO">Finalizados</a><a class="btn red" href="/admin/pedidos?status=CANCELADO">Cancelados</a></div></div>
  <div class="card"><form class="search" method="get"><input name="q" value="${safeHtml(q)}" placeholder="Buscar entrada, IMEI, WhatsApp ou nome"><button class="btn">Buscar</button></form></div>${pedidoTable(rows)}`;
  res.send(page('Pedidos', html));
});
app.post('/admin/pedido/:id/acao', async (req, res) => {
  const acao = String(req.body.acao || '').toLowerCase();
  const motivo = String(req.body.motivo || '').trim() || 'Não informado';
  const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (!p) return res.redirect(req.get('referer') || '/admin/pedidos');

  if (acao === 'processo') {
    await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [p.id]);
    const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]);
    await notificarPedido(a, 'processo');
  }

  if (acao === 'finalizar') {
    await finalizarPedido(p);
  }

  if (acao === 'cancelar') {
    await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, p.id]);
    const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]);
    await notificarPedido(a, 'cancelar', motivo);
  }

  res.redirect(req.get('referer') || '/admin/pedidos');
});
app.post('/admin/pedido/:id/apagar', async (req, res) => {
  const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (p) {
    await run('DELETE FROM pedidos WHERE id=?', [p.id]);
    notificarPainel('pedido', '🗑️ Pedido apagado', `Pedido #${p.id} removido do painel`);
  }
  res.redirect(req.get('referer') || '/admin/pedidos');
});
app.post('/admin/pedido/:id/processo', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'processo'); } res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/finalizar', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) await finalizarPedido(p); res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/cancelar', async (req, res) => { const motivo = req.body.motivo || 'Não informado'; const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'cancelar', motivo); } res.redirect(req.get('referer') || '/admin/pedidos'); });



app.get('/admin/mensagens', async (req, res) => {
  const revendas = await all('SELECT id,nome,whatsapp FROM revendas WHERE status="ATIVA" ORDER BY nome ASC');
  const hist = await all('SELECT * FROM mensagens_envio ORDER BY id DESC LIMIT 30');
  const opts = revendas.map(r => `<option value="${r.id}">${safeHtml(r.nome)} - ${safeHtml(r.whatsapp || '')}</option>`).join('');
  let table = '<table><tr><th>Data</th><th>Destino</th><th>Mensagem</th><th>Resultado</th></tr>';
  for (const h of hist) table += `<tr><td>${dateBR(h.criado_em)}</td><td>${safeHtml(h.destino || '-')}</td><td>${safeHtml(String(h.mensagem || '').slice(0,120))}</td><td>${h.enviadas || 0}/${h.total || 0} enviadas<br><span class="muted">Falhas: ${h.falhas || 0}</span></td></tr>`;
  table += '</table>';
  const body = `<h1>📢 Mensagens</h1><div class="card"><h2>Enviar mensagem livre</h2><form method="post" enctype="multipart/form-data"><label>Destino</label><select name="destino" onchange="document.getElementById('revendaBox').style.display=this.value==='revenda'?'block':'none'"><option value="todas">Todas as revendas ativas</option><option value="revenda">Revenda específica</option></select><div id="revendaBox" style="display:none;margin-top:10px"><label>Revenda</label><select name="revenda_id">${opts}</select></div><br><br><label>Mensagem</label><textarea name="mensagem" rows="8" placeholder="Digite sua mensagem livre aqui..." required></textarea><br><br><label>Imagem opcional</label><input type="file" name="imagem" accept="image/*"><br><br><button class="btn green" onclick="return confirm('Enviar mensagem agora?')">📤 Enviar</button></form></div><div class="card"><h2>Histórico de envios</h2>${table}</div>`;
  res.send(page('Mensagens', body));
});

app.post('/admin/mensagens', uploadEsim.single('imagem'), async (req, res) => {
  const mensagem = String(req.body.mensagem || '').trim();
  const destino = req.body.destino === 'revenda' ? 'REVENDA_ESPECIFICA' : 'TODAS_REVENDAS';
  const revendaId = req.body.destino === 'revenda' ? Number(req.body.revenda_id || 0) : null;
  const imagemRel = req.file ? `esim/${req.file.filename}` : null;
  const imagemPath = req.file ? path.join(ESIM_DIR, req.file.filename) : null;
  if (mensagem) {
    const r = await enviarMensagemRevendas({ texto: mensagem, revendaId, imagemPath });
    await run('INSERT INTO mensagens_envio (destino, revenda_id, mensagem, imagem, total, enviadas, falhas) VALUES (?, ?, ?, ?, ?, ?, ?)', [destino, revendaId, mensagem, imagemRel, r.total, r.enviadas, r.falhas]);
    notificarPainel('mensagem', '📢 Mensagem enviada', `${r.enviadas}/${r.total} enviadas`);
  }
  res.redirect('/admin/mensagens');
});

app.get('/admin/esim', async (req, res) => {
  const planos = await all(`
    SELECT p.*,
      COALESCE(SUM(CASE WHEN e.status='DISPONIVEL' THEN 1 ELSE 0 END),0) AS qtd
    FROM esim_planos p
    LEFT JOIN esim_estoque e
      ON e.nome_plano=p.nome_plano
     AND e.preco_revenda=p.preco_revenda
    WHERE p.ativo=1
    GROUP BY p.id
    ORDER BY p.nome_plano ASC
  `);

  const itens = await all('SELECT * FROM esim_estoque ORDER BY id DESC LIMIT 300');
  const manuais = await all(`SELECT * FROM pedidos WHERE entrada_label='eSIM Manual' AND status IN ('PENDENTE','PROCESSO') ORDER BY id DESC LIMIT 100`);

  let cards = '<div class="grid">';
  for (const p of planos) {
    const qtd = Number(p.qtd || 0);
    const status = qtd > 0 ? `🟢 ${qtd} QR disponível${qtd > 1 ? 's' : ''}` : '🔴 Sem QR · venda manual';
    cards += `<div class="card metric">
      <h2>📱 ${safeHtml(p.nome_plano)}</h2>
      <h1>${qtd}</h1>
      <p class="muted">${brl(p.preco_revenda)}<br>${status}</p>
      <a class="btn" href="/admin/esim/plano/${p.id}/editar">✏️ Editar</a>
      <form method="post" action="/admin/esim/plano/${p.id}/apagar" onsubmit="return confirm('Apagar este plano? Os QR Codes disponíveis desse plano também serão removidos. Pedidos antigos não serão apagados.')" style="display:inline">
        <button class="btn red">🗑️ Apagar plano</button>
      </form>
    </div>`;
  }
  cards += '</div>';

  let planosTable = '<table><tr><th>ID</th><th>Plano</th><th>Preço</th><th>QR Disponíveis</th><th>Ação</th></tr>';
  for (const p of planos) {
    planosTable += `<tr>
      <td>#${p.id}</td>
      <td>${safeHtml(p.nome_plano)}</td>
      <td>${brl(p.preco_revenda)}</td>
      <td>${Number(p.qtd || 0)}</td>
      <td>
        <a class="btn" href="/admin/esim/plano/${p.id}/editar">✏️ Editar</a>
        <form method="post" action="/admin/esim/plano/${p.id}/apagar" onsubmit="return confirm('Apagar este plano? Os QR Codes disponíveis desse plano também serão removidos. Pedidos antigos não serão apagados.')" style="display:inline">
          <button class="btn red">🗑️ Apagar plano</button>
        </form>
      </td>
    </tr>`;
  }
  planosTable += '</table>';


  const options = planos.map(p =>
    `<option value="${p.id}">${safeHtml(p.nome_plano)} - ${brl(p.preco_revenda)} - ${Number(p.qtd || 0)} QR</option>`
  ).join('');

  const formPlano = `<div class="card">
    <h2>➕ Cadastrar plano eSIM</h2>
    <form method="post" action="/admin/esim/plano">
      <div class="grid">
        <input name="nome_plano" placeholder="Nome do plano. Ex: TIM 50GB" required>
        <input name="preco_revenda" placeholder="Preço revenda. Ex: 55" required>
      </div>
      <button class="btn green">Salvar plano</button>
    </form>
    <p class="muted">O plano fica disponível para venda manual mesmo sem QR no estoque.</p>
  </div>`;

  const formQr = `<div class="card">
    <h2>📥 Adicionar QR Code ao plano</h2>
    <form method="post" action="/admin/esim/qrcode" enctype="multipart/form-data">
      <div class="grid">
        <select name="plano_id" required>
          <option value="">Selecione o plano</option>
          ${options}
        </select>
        <input type="file" name="qr" accept="image/*" required>
      </div>
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px">
        <input type="checkbox" name="avisar_revendas" value="1" style="width:auto;min-width:0">
        Avisar revendas com mensagem simples
      </label>
      <br>
      <button class="btn green">Salvar QR no estoque</button>
    </form>
    <p class="muted">Com QR disponível, entrega automática. Quando o estoque chegar a 0, a venda vira manual.</p>
  </div>`;

  let manualTable = '<table><tr><th>Pedido</th><th>Revenda</th><th>Plano</th><th>Valor</th><th>Status</th><th>Ação</th></tr>';
  for (const p of manuais) {
    manualTable += `<tr><td>#${p.id}</td><td>${safeHtml(p.revenda_nome || '-')}<br><span class="muted">${safeHtml(p.revenda_numero || '-')}</span></td><td>${safeHtml(p.entrada_valor || p.servico_nome || '-')}</td><td>${brl(p.valor)}</td><td><span class="pill">${safeHtml(p.status)}</span></td><td><span class="muted">WhatsApp admin:<br>/entregaresim ${p.id}</span></td></tr>`;
  }
  manualTable += '</table>';

  let table = '<table><tr><th>ID</th><th>Plano</th><th>Preço Revenda</th><th>Status</th><th>Revenda/Pedido</th><th>QR</th><th>Ações</th></tr>';
  for (const i of itens) {
    const img = i.arquivo_qr ? `<a href="/${safeHtml(i.arquivo_qr)}" target="_blank">Visualizar</a>` : '-';
    table += `<tr><td>#${i.id}</td><td>${safeHtml(i.nome_plano)}</td><td>${brl(i.preco_revenda)}</td><td><span class="pill">${safeHtml(i.status)}</span></td><td>${safeHtml(i.revenda_nome || '-')}${i.pedido_id ? `<br><span class="muted">Pedido #${i.pedido_id}</span>` : ''}</td><td>${img}</td><td><form class="forms-inline" method="post" action="/admin/esim/${i.id}/apagar"><button class="btn red" onclick="return confirm('Apagar este QR do estoque?')">🗑️ Apagar</button></form></td></tr>`;
  }
  table += '</table>';

  res.send(page('eSIM', `<h1>📱 eSIM</h1>${formPlano}${formQr}${cards}<div class="card"><h2>📋 Planos cadastrados</h2>${planosTable}</div><div class="card"><h2>👨‍💻 Entregas manuais pendentes</h2><p class="muted">Use /esimpendentes ou /entregaresim ID no WhatsApp admin.</p>${manualTable}</div><div class="card"><h2>📦 Estoque QR Codes</h2>${table}</div>`));
});

app.post('/admin/esim/plano', async (req, res) => {
  const nome = String(req.body.nome_plano || '').trim();
  const preco = Number(String(req.body.preco_revenda || '0').replace(',', '.'));
  if (nome && preco > 0) {
    await run(`INSERT OR IGNORE INTO esim_planos (nome_plano, preco_revenda, preco_cliente, ativo) VALUES (?, ?, ?, 1)`, [nome, preco, preco]);
    notificarPainel('esim', '📱 Plano eSIM cadastrado', `${nome} - disponível para venda manual`);
  }
  res.redirect('/admin/esim');
});



app.get('/admin/esim/plano/:id/editar', async (req, res) => {
  const plano = await get('SELECT * FROM esim_planos WHERE id=?', [req.params.id]);
  if (!plano) return res.redirect('/admin/esim');

  const qtd = await get(`SELECT COUNT(*) qtd FROM esim_estoque
    WHERE nome_plano=? AND preco_revenda=? AND status='DISPONIVEL'`,
    [plano.nome_plano, plano.preco_revenda]);

  const html = `<h1>✏️ Editar plano eSIM</h1>
  <div class="card">
    <form method="post">
      <label>Nome do plano</label>
      <input name="nome_plano" value="${safeHtml(plano.nome_plano || '')}" required>

      <label>Preço revenda</label>
      <input name="preco_revenda" value="${Number(plano.preco_revenda || 0).toFixed(2).replace('.', ',')}" required>

      <label>Preço cliente</label>
      <input name="preco_cliente" value="${Number(plano.preco_cliente || plano.preco_revenda || 0).toFixed(2).replace('.', ',')}">

      <label>Status</label>
      <select name="ativo">
        <option value="1" ${plano.ativo ? 'selected' : ''}>Ativo</option>
        <option value="0" ${!plano.ativo ? 'selected' : ''}>Inativo</option>
      </select>

      <p class="muted">QR disponíveis neste plano: ${qtd?.qtd || 0}</p>

      <button class="btn green">Salvar alterações</button>
      <a class="btn" href="/admin/esim">Voltar</a>
    </form>
  </div>`;

  res.send(page('Editar plano eSIM', html));
});

app.post('/admin/esim/plano/:id/editar', async (req, res) => {
  const id = Number(req.params.id || 0);
  const plano = await get('SELECT * FROM esim_planos WHERE id=?', [id]);
  if (!plano) return res.redirect('/admin/esim');

  const nomeNovo = String(req.body.nome_plano || '').trim();
  const precoNovo = Number(String(req.body.preco_revenda || '0').replace(',', '.'));
  const precoClienteNovo = Number(String(req.body.preco_cliente || req.body.preco_revenda || '0').replace(',', '.'));
  const ativo = req.body.ativo === '1' ? 1 : 0;

  if (nomeNovo && precoNovo > 0) {
    // Atualiza o catálogo.
    await run(`UPDATE esim_planos
      SET nome_plano=?, preco_revenda=?, preco_cliente=?, ativo=?
      WHERE id=?`,
      [nomeNovo, precoNovo, precoClienteNovo || precoNovo, ativo, id]);

    // Atualiza apenas QR disponíveis, para não alterar histórico de QR vendidos.
    await run(`UPDATE esim_estoque
      SET nome_plano=?, preco_revenda=?, preco_cliente=?
      WHERE nome_plano=? AND preco_revenda=? AND status='DISPONIVEL'`,
      [nomeNovo, precoNovo, precoClienteNovo || precoNovo, plano.nome_plano, plano.preco_revenda]);

    notificarPainel('esim', '✏️ Plano eSIM alterado', `${plano.nome_plano} → ${nomeNovo}`);
  }

  res.redirect('/admin/esim');
});

app.post('/admin/esim/plano/:id/apagar', async (req, res) => {
  const id = Number(req.params.id || 0);
  const plano = await get('SELECT * FROM esim_planos WHERE id=?', [id]);
  if (plano) {
    // Não apaga pedidos antigos. Apenas desativa o plano e remove QR disponíveis não vendidos.
    const qrs = await all(`SELECT * FROM esim_estoque
      WHERE nome_plano=? AND preco_revenda=? AND status='DISPONIVEL'`,
      [plano.nome_plano, plano.preco_revenda]);

    for (const q of qrs) {
      try {
        if (q.arquivo_qr) fs.unlinkSync(caminhoArquivoEsim(q.arquivo_qr));
      } catch(e) {}
    }

    await run(`DELETE FROM esim_estoque
      WHERE nome_plano=? AND preco_revenda=? AND status='DISPONIVEL'`,
      [plano.nome_plano, plano.preco_revenda]);

    await run('UPDATE esim_planos SET ativo=0 WHERE id=?', [id]);

    notificarPainel('esim', '🗑️ Plano eSIM apagado', plano.nome_plano);
  }
  res.redirect('/admin/esim');
});

app.post('/admin/esim/qrcode', uploadEsim.single('qr'), async (req, res) => {
  const planoId = Number(req.body.plano_id || 0);
  const plano = await get('SELECT * FROM esim_planos WHERE id=? AND ativo=1', [planoId]);
  if (plano && req.file) {
    await run(`INSERT INTO esim_estoque (nome_plano, preco_revenda, preco_cliente, arquivo_qr, status) VALUES (?, ?, ?, ?, 'DISPONIVEL')`,
      [plano.nome_plano, plano.preco_revenda, plano.preco_cliente || plano.preco_revenda, `esim/${req.file.filename}`]);
    notificarPainel('esim', '📱 QR eSIM adicionado', plano.nome_plano);

    if (req.body.avisar_revendas === '1') {
      const aviso = `🚀 QR Code eSIM disponível

📱 ${plano.nome_plano}

Digite:

menu

2️⃣ Comprar eSIM

🏢 Centralunlocker`;
      const r = await enviarMensagemRevendas({ texto: aviso });
      await run('INSERT INTO mensagens_envio (destino, mensagem, total, enviadas, falhas) VALUES (?, ?, ?, ?, ?)', ['TODAS_REVENDAS', aviso, r.total, r.enviadas, r.falhas]);
    }
  }
  res.redirect('/admin/esim');
});

app.post('/admin/esim', uploadEsim.single('qr'), async (req, res) => {
  const nome = String(req.body.nome_plano || '').trim();
  const preco = Number(String(req.body.preco_revenda || '0').replace(',', '.'));
  if (nome && preco > 0) {
    await run(`INSERT OR IGNORE INTO esim_planos (nome_plano, preco_revenda, preco_cliente, ativo) VALUES (?, ?, ?, 1)`, [nome, preco, preco]);
    if (req.file) {
      await run(`INSERT INTO esim_estoque (nome_plano, preco_revenda, preco_cliente, arquivo_qr, status) VALUES (?, ?, ?, ?, 'DISPONIVEL')`,
        [nome, preco, preco, `esim/${req.file.filename}`]);
    }
  }
  res.redirect('/admin/esim');
});
app.post('/admin/esim/:id/apagar', async (req, res) => {
  const item = await get('SELECT * FROM esim_estoque WHERE id=?', [req.params.id]);
  if (item) {
    try { if (item.arquivo_qr) fs.unlinkSync(caminhoArquivoEsim(item.arquivo_qr)); } catch(e) {}
    await run('DELETE FROM esim_estoque WHERE id=?', [item.id]);
  }
  res.redirect('/admin/esim');
});
app.post('/admin/esim/:id/reenviar', async (req, res) => {
  const item = await get('SELECT * FROM esim_estoque WHERE id=?', [req.params.id]);
  if (item?.revenda_id) {
    const r = await get('SELECT * FROM revendas WHERE id=?', [item.revenda_id]);
    const jid = r?.jid || numberToJid(r?.whatsapp);
    const qrPath = caminhoArquivoEsim(item.arquivo_qr);
    if (jid && fs.existsSync(qrPath)) {
      await sock.sendMessage(jid, { image: fs.readFileSync(qrPath), caption: `📱 eSIM ${item.nome_plano}\n⚠️ Reenvio do QR Code.` });
      await enviarTexto(jid, mensagemInstrucaoEsim());
    }
  }
  res.redirect('/admin/esim');
});

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY id DESC');
  let html = `<h1>🏪 Revendas</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome da revenda" required><input name="whatsapp" placeholder="WhatsApp 5575..." required><select name="tipo_revenda"><option value="PRE_PAGO">Pré-pago</option><option value="POS_PAGO" selected>Pós-pago</option></select></div><button class="btn green">Adicionar Revenda</button></form><p class="muted">Pré-pago bloqueia compra sem saldo. Pós-pago permite comprar e fica negativo.</p></div><table><tr><th>ID</th><th>Nome</th><th>WhatsApp</th><th>Tipo</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) html += `<tr><td>#${r.id}</td><td>${safeHtml(r.nome)}</td><td>${safeHtml(r.whatsapp || '-')}</td><td><span class="pill">${labelTipoRevenda(r.tipo_revenda)}</span></td><td><span class="pill">${safeHtml(r.status)}</span></td><td>${brl(r.saldo)}</td><td class="actions"><a class="btn" href="/admin/revenda/${r.id}/editar">✏️ Editar</a><a class="btn" href="/admin/revenda/${r.id}/precos">Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">💳 Conta</a><a class="btn" href="/admin/revenda/${r.id}/historico">Histórico</a><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/boasvindas"><button class="btn green">📨 Boas-vindas</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="${r.status === 'BLOQUEADA' ? 'ATIVA' : 'BLOQUEADA'}"><button class="btn orange">${r.status === 'BLOQUEADA' ? '🔓 Desbloquear' : '🔒 Bloquear'}</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="REMOVIDA"><button class="btn red" onclick="return confirm('Remover revenda?')">🗑️ Remover</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Revendas', html));
});
app.post('/admin/revendas', async (req, res) => {
  const w = normalizarNumeroWhatsApp(req.body.whatsapp);
  const nome = String(req.body.nome || '').trim();
  const tipoRevenda = normalizarTipoRevenda(req.body.tipo_revenda);
  const existe = await get('SELECT * FROM revendas WHERE whatsapp=? AND status != "REMOVIDA"', [w]);
  if (existe) {
    await run('UPDATE revendas SET nome=?, status="ATIVA", jid=?, tipo_revenda=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [nome, numberToJid(w), tipoRevenda, existe.id]);
    await enviarBoasVindasTutorialRevenda({ ...existe, nome, whatsapp: w, jid: numberToJid(w) });
  } else {
    const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, ?)', [nome, w, numberToJid(w), `rev${Date.now()}`, 'sem-senha', tipoRevenda]);
    await enviarBoasVindasTutorialRevenda({ id: ins.lastID, nome, whatsapp: w, jid: numberToJid(w) });
  }
  res.redirect('/admin/revendas');
});
app.post('/admin/revenda/:id/boasvindas', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (r) await enviarBoasVindasTutorialRevenda(r);
  res.redirect('/admin/revendas');
});
app.post('/admin/revenda/:id/status', async (req, res) => {
  await run('UPDATE revendas SET status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.status, req.params.id]);
  const rStatus = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (rStatus?.jid || rStatus?.whatsapp) {
    const jidAviso = rStatus.jid || numberToJid(rStatus.whatsapp);
    if (req.body.status === 'BLOQUEADA') await enviarTexto(jidAviso, '🔒 Sua revenda foi bloqueada. Entre em contato com a CentralUnlocker.');
    if (req.body.status === 'ATIVA') await enviarTexto(jidAviso, '🔓 Sua revenda foi reativada. Digite menu para continuar.');
  }
  res.redirect('/admin/revendas');
});
app.get('/admin/revenda/:id/editar', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); res.send(page('Editar Revenda', `<h1>✏️ Editar Revenda</h1><div class="card"><form method="post"><label>Nome</label><input name="nome" value="${safeHtml(r.nome)}" required><br><br><label>WhatsApp</label><input name="whatsapp" value="${safeHtml(r.whatsapp)}" required><br><br><label>Tipo da revenda</label><select name="tipo_revenda"><option value="PRE_PAGO" ${normalizarTipoRevenda(r.tipo_revenda)==='PRE_PAGO'?'selected':''}>Pré-pago</option><option value="POS_PAGO" ${normalizarTipoRevenda(r.tipo_revenda)==='POS_PAGO'?'selected':''}>Pós-pago</option></select><br><br><label>Status</label><select name="status"><option ${r.status==='ATIVA'?'selected':''}>ATIVA</option><option ${r.status==='BLOQUEADA'?'selected':''}>BLOQUEADA</option><option ${r.status==='REMOVIDA'?'selected':''}>REMOVIDA</option></select><br><br><button class="btn green">Salvar</button></form></div>`)); });
app.post('/admin/revenda/:id/editar', async (req, res) => { const w = normalizarNumeroWhatsApp(req.body.whatsapp); await run('UPDATE revendas SET nome=?, whatsapp=?, jid=?, status=?, tipo_revenda=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.nome, w, numberToJid(w), req.body.status, normalizarTipoRevenda(req.body.tipo_revenda), req.params.id]); res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/precos', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC'); let html = `<h1>💰 Preços - ${safeHtml(r.nome)}</h1><form method="post"><table><tr><th>Serviço</th><th>Preço da revenda</th></tr>`; for (const s of servs) { const preco = await precoDaRevenda(r.id, s.id); html += `<tr><td>${safeHtml(s.nome)}</td><td><input name="preco_${s.id}" value="${preco}"></td></tr>`; } html += `</table><br><button class="btn green">Salvar preços</button></form>`; res.send(page('Preços', html)); });
app.post('/admin/revenda/:id/precos', async (req, res) => { const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1'); for (const s of servs) { const preco = Number(String(req.body[`preco_${s.id}`] || '0').replace(',', '.')); await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, preco]); } res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/conta', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 50', [r.id]); let html = `<h1>💳 Conta da Revenda</h1><div class="card"><h2>${safeHtml(r.nome)}</h2><p><span class="pill">${labelTipoRevenda(r.tipo_revenda)}</span></p><h1>${brl(r.saldo)}</h1><form method="post" action="/admin/revenda/${r.id}/pagamento"><input name="valor" placeholder="Valor pago"><br><br><button class="btn green">Registrar Pagamento</button></form></div><h2>Histórico</h2>${pedidoTable(pedidos)}`; res.send(page('Conta', html)); });
app.get('/admin/revenda/:id/historico', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 300', [r.id]); res.send(page('Histórico', `<h1>📋 Histórico - ${safeHtml(r.nome)}</h1>${pedidoTable(pedidos)}`)); });
app.post('/admin/revenda/:id/pagamento', async (req, res) => {
  const valor = Number(String(req.body.valor || '0').replace(',', '.'));
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);

  if (valor > 0 && r) {
    const novo = Number(r.saldo || 0) + valor;

    await run(
      'UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
      [novo, r.id]
    );

    await run(
      'INSERT INTO pagamentos (revenda_id, revenda_nome, valor, origem) VALUES (?, ?, ?, "manual")',
      [r.id, r.nome, valor]
    );

    notificarPainel('pagamento', '💰 Pagamento manual', `${r.nome} - ${brl(valor)}`);
    if (r.jid) {
      await enviarTexto(
        r.jid,
        `✅ Pagamento registrado\n\n💰 Valor pago: ${brl(valor)}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(novo)}\n\n🏢 CentralUnlocker`
      );
    }
  }

  res.redirect(`/admin/revenda/${req.params.id}/conta`);
});

app.get('/admin/servicos', async (req, res) => {
  const rows = await all('SELECT s.*, (SELECT COUNT(*) FROM pedidos p WHERE p.servico_id=s.id) total FROM servicos_catalogo s ORDER BY s.id ASC');
  let html = `<div class="hero"><h1>🛠 Catálogo de Serviços</h1><p>Cadastre serviços como IMEI, Lock Code ou Outro. O WhatsApp muda a pergunta automaticamente conforme o tipo escolhido.</p></div>
  <div class="card"><h2>➕ Novo serviço</h2><form method="post"><div class="form-grid"><div><label>Nome do serviço</label><input name="nome" placeholder="Ex: Samsung FRP, iCloud FMI OFF" required></div><div><label>Preço padrão</label><input name="preco" placeholder="Ex: 25"></div><div><label>Tipo</label><select name="tipo_entrada"><option value="IMEI">📱 IMEI</option><option value="LOCK_CODE">🔑 Lock Code</option><option value="OUTRO">✍️ Outro</option></select></div><div><label>Nome da entrada</label><input name="entrada_label" placeholder="IMEI, Lock Code, Serial, CPF..."></div></div><p class="mini-help">📱 IMEI aceita envio em lote, um por linha. 🔑 Lock Code e ✍️ Outro criam apenas um pedido por vez.</p><button class="btn green">✅ Adicionar Serviço</button></form></div>`;
  html += `<div class="topbar"><h1>Serviços cadastrados</h1><span class="muted">${rows.length} serviço(s)</span></div>`;
  if (!rows.length) html += `<div class="card empty">Nenhum serviço cadastrado ainda.</div>`;
  for (const s of rows) {
    const tipo = normalizarTipoEntrada(s.tipo_entrada);
    const icon = tipo === 'LOCK_CODE' ? '🔑' : tipo === 'OUTRO' ? '✍️' : '📱';
    html += `<div class="service-card"><div><div class="service-title">${icon} ${safeHtml(s.nome)}</div><div class="service-meta"><span class="tag">Entrada: ${safeHtml(tituloTipoEntrada(s.tipo_entrada))}</span><span class="tag">Campo: ${safeHtml(labelEntradaServico(s))}</span><span class="tag">Preço: ${brl(s.preco_padrao)}</span><span class="tag">Pedidos: ${s.total}</span><span class="tag">${s.ativo ? '✅ Ativo' : '⛔ Inativo'}</span></div></div><div class="actions"><a class="btn" href="/admin/servico/${s.id}/imeis">📋 Pedidos</a><a class="btn purple" href="/admin/servico/${s.id}/editar">✏️ Editar</a><form class="forms-inline" method="post" action="/admin/servico/${s.id}/toggle"><button class="btn gray">${s.ativo ? 'Desativar' : 'Ativar'}</button></form><form class="forms-inline" method="post" action="/admin/servico/${s.id}/excluir"><button class="btn red" onclick="return confirm('Excluir serviço e pedidos vinculados?')">🗑️</button></form></div></div>`;
  }
  res.send(page('Serviços', html));
});
app.post('/admin/servicos', async (req, res) => {
  const tipoEntrada = normalizarTipoEntrada(req.body.tipo_entrada);
  const label = String(req.body.entrada_label || '').trim() || (tipoEntrada === 'LOCK_CODE' ? 'Lock Code' : tipoEntrada === 'OUTRO' ? 'Informação' : 'IMEI');
  await run('INSERT INTO servicos_catalogo (nome, preco_padrao, tipo_entrada, entrada_label, ativo) VALUES (?, ?, ?, ?, 1)', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.')), tipoEntrada, label]);
  notificarPainel('servico', '🛠 Novo serviço', req.body.nome);
  const revs = await all('SELECT * FROM revendas WHERE status="ATIVA" AND jid IS NOT NULL');
  for (const r of revs) await enviarTexto(r.jid, `🆕 Novo serviço disponível\n\n🛠 ${req.body.nome}\n🔎 Entrada: ${tituloTipoEntrada(tipoEntrada)}\n\nDigite menu para ver sua tabela.`);
  res.redirect('/admin/servicos');
});
app.get('/admin/servico/:id/editar', async (req, res) => {
  const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]);
  res.send(page('Editar Serviço', `<h1>✏️ Editar Serviço</h1><div class="card"><form method="post"><label>Nome</label><input name="nome" value="${safeHtml(s.nome)}" required><br><br><label>Preço padrão</label><input name="preco" value="${s.preco_padrao}"><br><br><label>Tipo de entrada</label><select name="tipo_entrada"><option value="IMEI" ${normalizarTipoEntrada(s.tipo_entrada)==='IMEI'?'selected':''}>IMEI</option><option value="LOCK_CODE" ${normalizarTipoEntrada(s.tipo_entrada)==='LOCK_CODE'?'selected':''}>Lock Code</option><option value="OUTRO" ${normalizarTipoEntrada(s.tipo_entrada)==='OUTRO'?'selected':''}>Outro</option></select><br><br><label>Nome da entrada</label><input name="entrada_label" value="${safeHtml(labelEntradaServico(s))}" placeholder="Ex: Serial, CPF, Login"><br><br><button class="btn green">Salvar</button></form></div>`));
});
app.post('/admin/servico/:id/editar', async (req, res) => {
  const tipoEntrada = normalizarTipoEntrada(req.body.tipo_entrada);
  const label = String(req.body.entrada_label || '').trim() || (tipoEntrada === 'LOCK_CODE' ? 'Lock Code' : tipoEntrada === 'OUTRO' ? 'Informação' : 'IMEI');
  await run('UPDATE servicos_catalogo SET nome=?, preco_padrao=?, tipo_entrada=?, entrada_label=? WHERE id=?', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.')), tipoEntrada, label, req.params.id]);
  res.redirect('/admin/servicos');
});
app.post('/admin/servico/:id/toggle', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); if (s) await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [s.ativo ? 0 : 1, s.id]); res.redirect('/admin/servicos'); });
app.post('/admin/servico/:id/excluir', async (req, res) => { await run('DELETE FROM precos_revenda WHERE servico_id=?', [req.params.id]); await run('DELETE FROM pedidos WHERE servico_id=?', [req.params.id]); await run('DELETE FROM servicos_catalogo WHERE id=?', [req.params.id]); res.redirect('/admin/servicos'); });
app.get('/admin/servico/:id/imeis', async (req, res) => { const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]); const rows = await all('SELECT * FROM pedidos WHERE servico_id=? ORDER BY id DESC LIMIT 500', [req.params.id]); res.send(page('IMEIs', `<h1>📋 Pedidos - ${safeHtml(s.nome)}</h1>${pedidoTable(rows, false)}`)); });

app.get('/admin/financeiro', async (req, res) => { const revs = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY saldo DESC'); const pags = await all('SELECT * FROM pagamentos ORDER BY id DESC LIMIT 50'); let total = 0; let html = '<h1>💰 Financeiro</h1><div class="card"><h2>Saldos das Revendas</h2><table><tr><th>Revenda</th><th>Saldo</th><th>Ação</th></tr>'; for (const r of revs) { total += Number(r.saldo || 0); html += `<tr><td>${safeHtml(r.nome)}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/conta">Conta</a></td></tr>`; } html += `</table><h2>Total em aberto: ${brl(total)}</h2></div><div class="card"><h2>Últimos pagamentos</h2><table><tr><th>Data</th><th>Revenda/Cliente</th><th>Valor</th><th>Origem</th></tr>`; for (const p of pags) html += `<tr><td>${dateBR(p.criado_em)}</td><td>${safeHtml(p.revenda_nome || p.cliente_numero || '-')}</td><td>${brl(p.valor)}</td><td>${safeHtml(p.origem)}</td></tr>`; html += '</table></div>'; res.send(page('Financeiro', html)); });
app.get('/admin/relatorios', async (req, res) => { const tipo = req.query.tipo || 'diario'; const txt = await resumoPeriodo(tipo); const parts = txt.replace(/\*/g,'').split('\n').filter(Boolean); res.send(page('Relatórios', `<h1>📈 Relatórios</h1><div class="card"><a class="btn" href="/admin/relatorios?tipo=diario">Diário</a><a class="btn" href="/admin/relatorios?tipo=mensal">Mensal</a><a class="btn" href="/admin/relatorios?tipo=anual">Anual</a></div><div class="card"><pre style="white-space:pre-wrap;font-size:18px">${safeHtml(parts.join('\n'))}</pre></div>`)); });
app.get('/admin/config', (req, res) => {
  const temasHtml = Object.entries(TEMAS_PAINEL).map(([id, t]) => `<div class="theme-card"><div class="theme-preview preview-${id}"></div><b>${safeHtml(t.nome)}</b><p class="muted">${id === PAINEL_TEMA ? 'Tema atual ✅' : 'Clique para aplicar'}</p><form method="post" action="/admin/config/theme"><input type="hidden" name="theme" value="${id}"><button class="btn ${id===PAINEL_TEMA?'green':''}">Aplicar</button></form></div>`).join('');
  res.send(page('Configurações', `<h1>⚙️ Configurações</h1><div class="grid"><div class="card"><h2>Dados do sistema</h2><p><b>Admin:</b> ${safeHtml(ADMIN_NUMBER)}</p><p><b>DB:</b> ${safeHtml(DB_PATH)}</p><p><b>Status WhatsApp:</b> ${conectado ? 'Conectado ✅' : 'Desconectado ❌'}</p><p><b>Tema atual:</b> ${safeHtml(TEMAS_PAINEL[temaAtual()].nome)}</p></div><div class="card"><h2>🎨 Temas prontos</h2><p class="muted">Escolha um tema e aplique com 1 clique.</p><div class="theme-grid">${temasHtml}</div></div><div class="card"><h2>🖼️ Banner personalizado</h2><p class="muted">Opcional: escolha uma imagem do celular. Ela substitui o banner do tema e salva como <b>/img/hacker.png</b>.</p><img class="image-preview" src="/img/hacker.png?v=${Date.now()}" onerror="this.style.display='none'"><br><br><form method="post" action="/admin/config/hacker-image"><input id="hackerFile" type="file" accept="image/png,image/jpeg,image/webp"><input id="hackerData" type="hidden" name="imageData"><br><button class="btn green" id="sendBtn" disabled>Salvar banner manual</button></form><p class="mini-help">A troca manual fica somente aqui em Configurações.</p><script>const f=document.getElementById('hackerFile'),d=document.getElementById('hackerData'),b=document.getElementById('sendBtn');f&&f.addEventListener('change',()=>{const file=f.files&&f.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{d.value=r.result;b.disabled=false;b.textContent='Salvar banner manual';};b.disabled=true;b.textContent='Carregando imagem...';r.readAsDataURL(file);});</script></div></div>`));
});
app.post('/admin/config/theme', async (req, res) => { const theme = String(req.body.theme || 'hacker-green'); if (TEMAS_PAINEL[theme]) { PAINEL_TEMA = theme; await setConfig('painel_tema', theme); notificarPainel('tema', '🎨 Tema alterado', TEMAS_PAINEL[theme].nome); } res.redirect('/admin/config'); });
app.post('/admin/config/hacker-image', async (req, res) => {
  try {
    const data = String(req.body.imageData || '');
    const m = data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!m) return res.send(page('Erro', '<h1>❌ Imagem inválida</h1><p>Envie uma imagem PNG, JPG ou WEBP.</p><a class="btn" href="/admin/config">Voltar</a>'));
    if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
if (!fs.existsSync(ESIM_DIR)) fs.mkdirSync(ESIM_DIR, { recursive: true });
if (!fs.existsSync(THEME_DIR)) fs.mkdirSync(THEME_DIR, { recursive: true });
app.use('/themes', express.static(THEME_DIR));
    fs.writeFileSync(HACKER_IMAGE_PATH, Buffer.from(m[2], 'base64'));
    notificarPainel('banner', '🖼️ Banner atualizado', 'Foto do hacker alterada manualmente');
    res.redirect('/admin/config?ok=1');
  } catch (e) {
    console.log('❌ ERRO SALVAR IMAGEM:', e.message);
    res.send(page('Erro', '<h1>❌ Erro ao salvar imagem</h1><a class="btn" href="/admin/config">Voltar</a>'));
  }
});

app.get('/admin/temas', async (req, res) => {
  ensureHackerModelos();
  const tema = temaAtualPainel();
  const atualImg = hackerImagemAtual();
  const modelos = fs.readdirSync(THEME_DIR).filter(f => /\.(png|jpg|jpeg|webp|svg)$/i.test(f));
  const temaOptions = Object.entries(TEMAS_PAINEL).concat([['gold-vip',{nome:'🟡 Gold VIP'}]]).map(([k,v]) =>
    `<option value="${k}" ${k===tema?'selected':''}>${safeHtml(v.nome || k)}</option>`).join('');

  let galeria = '<div class="grid">';
  for (const f of modelos) {
    const url = `/themes/${encodeURIComponent(f)}`;
    galeria += `<div class="card"><img src="${url}" style="width:100%;border-radius:16px;max-height:190px;object-fit:cover"><p class="muted">${safeHtml(f)}</p><form method="post" action="/admin/temas/imagem"><input type="hidden" name="imagem" value="${url}"><button class="btn green">Usar esta imagem</button></form></div>`;
  }
  galeria += '</div>';

  const preview = atualImg ? `<img src="${safeHtml(atualImg)}">` : `<p class="muted">Nenhuma imagem ativa.</p>`;

  res.send(page('Temas', `<h1>🎨 Temas e fotos hacker</h1>
    <div class="card hero"><div><h2>Tema atual</h2><form method="post" action="/admin/temas"><select name="tema">${temaOptions}</select><button class="btn green">Salvar tema</button></form><p class="muted">Tema e imagem ficam salvos no banco e as fotos em ${safeHtml(THEME_DIR)}. Não perde ao reiniciar o Render.</p></div><div>${preview}</div></div>
    <div class="card"><h2>📤 Enviar foto hacker</h2><form method="post" action="/admin/temas/upload" enctype="multipart/form-data"><input type="file" name="foto" accept="image/*" required><button class="btn green">Enviar e usar</button></form></div>
    <div class="card"><h2>🔗 Usar link de imagem</h2><form method="post" action="/admin/temas/imagem"><input name="imagem" placeholder="https://... ou /themes/hacker_green.svg" value="${safeHtml(atualImg)}"><button>Salvar imagem</button></form><form method="post" action="/admin/temas/imagem"><input type="hidden" name="imagem" value=""><button class="btn red">Remover imagem</button></form></div>
    <div class="card"><h2>🖼️ Modelos prontos</h2>${galeria}</div>`));
});
app.post('/admin/temas', async (req, res) => {
  const tema = String(req.body.tema || 'hacker-green');
  await setConfig('painel_tema', tema);
  PAINEL_TEMA = tema;
  notificarPainel('tema', '🎨 Tema alterado', tema);
  res.redirect('/admin/temas');
});
app.post('/admin/temas/imagem', async (req, res) => {
  await setConfig('painel_hacker_image', String(req.body.imagem || '').trim());
  notificarPainel('tema', '🖼️ Imagem do painel alterada', '');
  res.redirect('/admin/temas');
});
app.post('/admin/temas/upload', uploadTema.single('foto'), async (req, res) => {
  if (req.file) {
    await setConfig('painel_hacker_image', `/themes/${req.file.filename}`);
    notificarPainel('tema', '🖼️ Foto hacker enviada', req.file.filename);
  }
  res.redirect('/admin/temas');
});

app.get('/admin/logout', (req, res) => { res.status(401).set('WWW-Authenticate', 'Basic realm="CentralUnlocker Admin"').send(page('Sair', '<h1>🚪 Sessão encerrada</h1><p>Feche esta aba ou entre novamente.</p>')); });

async function criarBackup() { const destino = path.join(BACKUP_DIR, `backup-${today()}-${Date.now()}.db`); await new Promise((resolve, reject) => db.backup(destino, (err) => err ? reject(err) : resolve())); console.log('✅ BACKUP CRIADO:', destino); return destino; }
function listarBackups() { if (!fs.existsSync(BACKUP_DIR)) return []; return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse(); }
app.get('/admin/backup', async (req, res) => { const backs = listarBackups(); let html = `<h1>💾 Backup</h1><form method="post" action="/admin/backup/criar"><button class="btn green">📦 Criar Backup</button></form><table><tr><th>#</th><th>Arquivo</th><th>Ações</th></tr>`; backs.forEach((b, i) => html += `<tr><td>${i + 1}</td><td>${safeHtml(b)}</td><td><a class="btn" href="/admin/backup/download/${encodeURIComponent(b)}">⬇️ Baixar</a><form class="forms-inline" method="post" action="/admin/backup/restaurar"><input type="hidden" name="file" value="${safeHtml(b)}"><button class="btn red" onclick="return confirm('Restaurar este backup?')">🔄 Restaurar</button></form></td></tr>`); html += '</table>'; res.send(page('Backup', html)); });
app.post('/admin/backup/criar', async (req, res) => { await criarBackup(); res.redirect('/admin/backup'); });
app.get('/admin/backup/download/:file', (req, res) => { const file = path.basename(req.params.file); res.download(path.join(BACKUP_DIR, file)); });
app.post('/admin/backup/restaurar', async (req, res) => { const file = path.basename(req.body.file || ''); const origem = path.join(BACKUP_DIR, file); if (!fs.existsSync(origem)) return res.send(page('Erro', '<h1>Backup não encontrado</h1>')); criarBackup().then(() => db.close((err) => { if (err) console.log(err); fs.copyFileSync(origem, DB_PATH); console.log('✅ RESTAURADO:', origem); res.send(page('Restaurado', '<h1>✅ Backup restaurado</h1><p>O serviço será reiniciado para carregar o banco restaurado.</p>')); setTimeout(() => process.exit(0), 1500); })); });

cron.schedule('0 2 * * *', async () => { try { await criarBackup(); } catch (e) { console.log('❌ BACKUP AUTOMÁTICO:', e); } }, { timezone: 'America/Sao_Paulo' });

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR ONLINE NA PORTA ${PORT}`));
iniciarWhatsApp();
