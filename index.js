require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const crypto = require('crypto');
let TelegramBot = null;
try { TelegramBot = require('node-telegram-bot-api'); } catch (e) { console.log('⚠️ node-telegram-bot-api não instalado ainda.'); }

// Telegram + WhatsApp: conexão direta via QR Code usando Baileys; webhook Evolution mantido apenas como compatibilidade opcional.

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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_ID || '').trim();
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
const WHATSAPP_PROVIDER = String(process.env.WHATSAPP_PROVIDER || 'baileys').toLowerCase();
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const WHATSAPP_WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const WHATSAPP_SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || path.join(DATA_DIR, 'whatsapp-session');
// Site do cliente removido: clientes usam Telegram ou WhatsApp.

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
if (!fs.existsSync(ESIM_DIR)) fs.mkdirSync(ESIM_DIR, { recursive: true });
if (!fs.existsSync(WHATSAPP_SESSION_DIR)) fs.mkdirSync(WHATSAPP_SESSION_DIR, { recursive: true });

let tgBot = null;
let qrCodeBase64 = null;
let conectado = false;
let whatsappSocket = null;
const whatsappJidPorNumero = new Map();
let whatsappStatus = WHATSAPP_ENABLED ? 'INICIANDO' : 'DESABILITADO';
let whatsappNumeroConectado = '';
let whatsappReconectarTimer = null;
let whatsappIniciando = false;
let whatsappUltimoErro = '';
let whatsappInicioEm = null;
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

// Controle de sessões/mensagens do Telegram
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
function tgJid(id) { return id ? `tg:${String(id).replace(/^tg:/,'')}` : ''; }
function isTgJid(jid) { return String(jid || '').startsWith('tg:'); }
function tgIdFromJid(jid) { return String(jid || '').replace(/^tg:/, ''); }
function gerarSenha(tam=8) { return crypto.randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g,'').slice(0,tam); }
function gerarLogin(nome, id) { const base = String(nome || 'cliente').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'').slice(0,10) || 'cliente'; return `${base}${String(id).slice(-4)}`; }
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
function isRevendaPosPaga(revenda) { return normalizarTipoRevenda(revenda?.tipo_revenda) === 'POS_PAGO'; }
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
  const bruto = String(texto || '').trim();
  if (!bruto) return [];

  // Correção automática: remove tudo que não for número.
  // Aceita 1 IMEI por linha, separado por espaço, vírgula, ponto, traço etc.
  const partes = bruto
    .split(/[\n,;]+/)
    .map(linha => linha.replace(/\D/g, '').trim())
    .filter(Boolean);

  let imeis = [];
  if (partes.length <= 1) {
    const todos = bruto.replace(/\D/g, '');
    if (todos.length > 15 && todos.length % 15 === 0) {
      imeis = todos.match(/.{15}/g) || [];
    } else if (todos) {
      imeis = [todos];
    }
  } else {
    for (const item of partes) {
      if (item.length > 15 && item.length % 15 === 0) {
        imeis.push(...(item.match(/.{15}/g) || []));
      } else {
        imeis.push(item);
      }
    }
  }

  return [...new Set(imeis)];
}
function validarEntradaServico(servico, textoOriginal) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  const bruto = String(textoOriginal || '').trim();
  if (tipo === 'IMEI') {
    const imeis = extrairImeisEmLote(bruto);
    if (!imeis.length) return { ok: false, erro: `❌ IMEI inválido.\n\n📱 Envie de 1 até 5 IMEIs.\nCada IMEI precisa ter 15 números.\n\nExemplo:\n356789123456789\n356789123456780` };
    if (imeis.length > 5) return { ok: false, erro: `❌ Limite excedido.\n\nVocê pode enviar no máximo 5 IMEIs por pedido.\nVocê enviou: ${imeis.length}` };

    const invalidos = imeis.filter(i => !/^\d{15}$/.test(i));
    if (invalidos.length) {
      return { ok: false, erro: `❌ IMEI inválido.\n\nOs IMEIs abaixo foram corrigidos automaticamente, mas não ficaram com 15 dígitos:\n${invalidos.join('\n')}\n\nCorrija e tente novamente.` };
    }

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

function normalizarTelegramSuporte(valor) {
  let v = String(valor || '').trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\/t\.me\//i, '').replace(/^t\.me\//i, '').replace('@', '').trim();
  v = v.split(/[\s/?#]/)[0];
  return v.replace(/[^a-zA-Z0-9_]/g, '');
}
async function getTelegramSuporte() {
  const cfg = await getConfig('telegram_suporte', process.env.SUPORTE_TELEGRAM || process.env.TELEGRAM_SUPORTE || 'alinesantos3360');
  return normalizarTelegramSuporte(cfg) || 'alinesantos3360';
}
async function enviarSuporteTelegram(chatId) {
  if (!tgBot) return;
  const usuario = await getTelegramSuporte();
  const link = `https://t.me/${usuario}`;
  return tgBot.sendMessage(chatId, `🆘 *Suporte CentralUnlocker*\n\nPrecisa de ajuda?\nClique no botão abaixo para falar diretamente com o suporte.`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '💬 Falar com o suporte', url: link }],
      [{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]
    ] }
  });
}

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
  await addColumnIfMissing('revendas', 'telegram_id', 'TEXT');
  await addColumnIfMissing('revendas', 'limite_credito', 'REAL DEFAULT 0');
  await addColumnIfMissing('revendas', 'ultimo_acesso', 'TEXT');

  await run(`CREATE TABLE IF NOT EXISTS whatsapp_vinculos (
    codigo TEXT PRIMARY KEY,
    revenda_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    expira_em INTEGER NOT NULL,
    usado INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('DELETE FROM whatsapp_vinculos WHERE usado=1 OR expira_em < ?', [Date.now()]);

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
    estornado INTEGER DEFAULT 0,
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
  await addColumnIfMissing('pedidos', 'estornado', 'INTEGER DEFAULT 0');
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


function getClienteToken(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|; )cliente_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
async function clienteAuth(req, res, next) {
  const token = getClienteToken(req);
  const id = clienteSessoes.get(token);
  if (!id) return res.redirect('/cliente');
  const cliente = await get('SELECT * FROM revendas WHERE id=? AND status != "BLOQUEADA"', [id]);
  if (!cliente) return res.redirect('/cliente?sair=1');
  req.cliente = cliente;
  next();
}
function clientePage(title, body, cliente=null) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(title)}</title><style>
  body{margin:0;background:#020617;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif}.wrap{max-width:1100px;margin:0 auto;padding:18px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}.brand{font-weight:900;color:#00ff66;font-size:22px}.card{background:#07111f;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:18px;margin:12px 0;box-shadow:0 8px 28px rgba(0,0,0,.3)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.btn{display:inline-block;background:#111827;color:white;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px 14px;text-decoration:none;font-weight:800;cursor:pointer}.btn.green{background:linear-gradient(135deg,#00ff66,#28d7ff);color:#020617}.btn.red{background:#7f1d1d}input,select,textarea{width:100%;box-sizing:border-box;border-radius:12px;background:#020617;color:#fff;border:1px solid rgba(255,255,255,.15);padding:12px;margin:6px 0 12px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}.pill{padding:5px 9px;border-radius:999px;background:#0f172a;border:1px solid rgba(255,255,255,.12)}.muted{color:#94a3b8}.menu{display:flex;gap:8px;flex-wrap:wrap}.hero{background:radial-gradient(circle at top right,#064e3b,transparent 30%),linear-gradient(135deg,#06111f,#020617);border:1px solid rgba(0,255,102,.25);border-radius:22px;padding:22px}h1,h2{margin-top:0}.imei-list{display:grid;gap:10px;margin:8px 0 12px}.imei-row{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center}.imei-label{color:#94a3b8;font-weight:800;font-size:12px}.imei-field{width:15ch!important;max-width:100%;font-family:Consolas,monospace;font-size:20px;letter-spacing:2px;text-align:center;padding:11px 10px!important;border-radius:10px!important}.imei-field.ok{border-color:#22c55e!important;box-shadow:0 0 0 3px rgba(34,197,94,.12)}.imei-field.bad{border-color:#ef4444!important}.imei-help{font-size:12px;color:#94a3b8;margin-top:-6px;margin-bottom:12px}.mini-btn{background:#111827;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}.imei-textarea{font-family:Consolas,monospace;font-size:18px;line-height:1.7;letter-spacing:1px;resize:vertical;min-height:170px}.imei-counter{font-size:12px;color:#94a3b8;margin-top:-6px;margin-bottom:8px}.imei-textarea.ok{border-color:#22c55e!important;box-shadow:0 0 0 3px rgba(34,197,94,.12)}.imei-textarea.bad{border-color:#ef4444!important}@media(max-width:700px){.top{display:block}.menu .btn{display:block;width:100%;box-sizing:border-box;margin:6px 0}table{font-size:13px;display:block;overflow-x:auto}.imei-field{font-size:18px}}
  </style><script>
  function limparImeiTexto(el){
    let linhas = String(el.value || '').split(/\r?\n/);
    let limpas = [];
    for (const linha of linhas) {
      const nums = String(linha || '').replace(/\D/g, '').slice(0, 15);
      if (nums || limpas.length) limpas.push(nums);
      if (limpas.length >= 5) break;
    }
    // Evita criar muitas linhas vazias, mas mantém a digitação natural.
    el.value = limpas.join('\n');
    atualizarContadorImeis(el);
  }
  function atualizarContadorImeis(el){
    if(!el) return;
    const form = el.closest('form');
    const linhas = String(el.value || '').split(/\r?\n/).map(x => x.replace(/\D/g,'')).filter(Boolean);
    const counter = form ? form.querySelector('.imei-counter') : null;
    const validos = linhas.filter(x => x.length === 15).length;
    if(counter) counter.textContent = 'IMEIs: '+linhas.length+'/5 · válidos: '+validos;
    el.classList.remove('ok','bad');
    if(linhas.length && linhas.every(x => x.length === 15)) el.classList.add('ok');
    else if(linhas.length) el.classList.add('bad');
  }
  function validarFormularioImei(form){
    const campo = form.querySelector('.imei-textarea');
    if(!campo) return true;
    limparImeiTexto(campo);
    const valores = String(campo.value || '').split(/\r?\n/).map(x => x.replace(/\D/g,'')).filter(Boolean);
    if(valores.length < 1){ alert('Digite pelo menos 1 IMEI.'); return false; }
    if(valores.length > 5){ alert('Limite máximo de 5 IMEIs.'); return false; }
    const repetidos = valores.filter((v,i,a)=>a.indexOf(v)!==i);
    if(repetidos.length){ alert('Não envie IMEI repetido no mesmo pedido: '+repetidos[0]); return false; }
    const ruim = valores.find(v => v.length !== 15);
    if(ruim){ alert('Cada linha precisa ter exatamente 15 números. Corrija: '+ruim); return false; }
    campo.value = valores.join('\n');
    return true;
  }
  </script></head><body><div class="wrap"><div class="top"><div class="brand">CentralUnlocker</div>${cliente?`<div class="menu"><a class="btn" href="/cliente/dashboard">🏠 Início</a><a class="btn" href="/cliente/servicos">1️⃣ Serviços</a><a class="btn" href="/cliente/esim">2️⃣ Comprar eSIM</a><a class="btn" href="/cliente/historico">3️⃣ Histórico</a><a class="btn" href="/cliente/conta">4️⃣ Conta</a><a class="btn green" href="/cliente/pagamentos">💳 Pagar</a><a class="btn red" href="/cliente/logout">Sair</a></div>`:''}</div>${body}</div></body></html>`;
}

function clienteEntradaHtml(s) {
  const tipo = normalizarTipoEntrada(s.tipo_entrada);
  const label = safeHtml(labelEntradaServico(s));
  if (tipo === 'IMEI') {
    return `<label>${label}</label>
      <textarea name="entrada" class="imei-textarea" rows="5" required inputmode="numeric" placeholder="353625361425365\n353625361425366" oninput="limparImeiTexto(this)" onpaste="setTimeout(()=>limparImeiTexto(this),0)"></textarea>
      <div class="imei-counter">IMEIs: 0/5 · válidos: 0</div>
      <div class="imei-help">Digite 1 IMEI por linha. Cada linha aceita no máximo 15 números. Máximo de 5 IMEIs.</div>`;
  }
  return `<label>${label}</label><textarea name="entrada" rows="3" required placeholder="Digite aqui."></textarea>`;
}

function page(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(title)}</title>
  <style>
  :root{--bg:#07111f;--bg2:#0c1426;--card:#101b31;--card2:#0d172a;--soft:#16223a;--line:#24324b;--text:#eaf0f8;--muted:#97a6ba;--blue:#2f80ed;--cyan:#28d7ff;--green:#28c76f;--red:#ff4d4f;--orange:#ff9f43;--purple:#9b5cff;--shadow:0 18px 45px rgba(0,0,0,.32)}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,sans-serif;color:var(--text);background:radial-gradient(circle at 18% 10%,rgba(40,215,255,.14),transparent 28%),radial-gradient(circle at 88% 4%,rgba(155,92,255,.12),transparent 30%),linear-gradient(135deg,var(--bg),var(--bg2));min-height:100vh}a{color:#a9d8ff;text-decoration:none}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.side{position:sticky;top:0;height:100vh;padding:22px;background:linear-gradient(180deg,rgba(6,12,24,.96),rgba(9,16,31,.94));border-right:1px solid rgba(255,255,255,.08);box-shadow:12px 0 40px rgba(0,0,0,.20);overflow:auto}.brand{display:flex;align-items:center;gap:12px;padding:14px 12px;margin-bottom:18px;border-radius:18px;background:linear-gradient(135deg,rgba(47,128,237,.22),rgba(40,215,255,.09));border:1px solid rgba(40,215,255,.18);font-size:20px;font-weight:900;letter-spacing:.2px}.brand:before{content:'🕶️';font-size:31px}.side .nav-title{font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:var(--muted);margin:18px 12px 8px}.side a{display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:14px;margin:5px 0;color:#cdd7e6;font-weight:750;border:1px solid transparent}.side a:hover{background:rgba(47,128,237,.16);border-color:rgba(40,215,255,.12);transform:translateX(2px)}.main{padding:26px;max-width:1560px;width:100%;margin:0 auto}.hero{position:relative;overflow:hidden;border:1px solid rgba(40,215,255,.18);border-radius:24px;padding:24px;margin-bottom:18px;background:linear-gradient(135deg,rgba(16,27,49,.96),rgba(13,23,42,.82)),radial-gradient(circle at 92% 20%,rgba(40,215,255,.2),transparent 25%);box-shadow:var(--shadow)}.hero:after{content:'</>';position:absolute;right:28px;top:8px;font-size:92px;font-weight:900;color:rgba(40,215,255,.09);transform:rotate(-8deg)}.hero h1{margin:0 0 8px;font-size:30px}.hero p{margin:0;color:var(--muted);max-width:820px}.topbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px}.card{background:linear-gradient(180deg,rgba(16,27,49,.94),rgba(13,23,42,.94));border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:18px;margin:14px 0;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.metric{position:relative;overflow:hidden}.metric:before{content:'';position:absolute;right:-34px;top:-34px;width:96px;height:96px;border-radius:50%;background:rgba(40,215,255,.10)}.metric h2{font-size:13px;color:var(--muted);margin:0 0 8px;text-transform:uppercase;letter-spacing:.8px}.metric h1{font-size:32px;margin:0}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white!important;padding:9px 13px;border-radius:12px;border:0;cursor:pointer;margin:2px;font-weight:850;box-shadow:0 10px 18px rgba(37,99,235,.18)}.btn.red{background:linear-gradient(135deg,#ef4444,#b91c1c)}.btn.green{background:linear-gradient(135deg,#22c55e,#15803d);color:white!important}.btn.gray{background:linear-gradient(135deg,#64748b,#334155)}.btn.orange{background:linear-gradient(135deg,#f97316,#c2410c)}.btn.purple{background:linear-gradient(135deg,#a855f7,#6d28d9);color:white!important}input,select,textarea{padding:12px;border-radius:13px;border:1px solid #334155;background:#08111f;color:var(--text);width:100%;min-width:130px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(40,215,255,.10)}label{font-size:12px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.8px}table{width:100%;border-collapse:separate;border-spacing:0;background:rgba(8,17,31,.84);border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}td,th{border-bottom:1px solid rgba(255,255,255,.07);padding:12px;text-align:left;vertical-align:middle}th{color:#cbd5e1;background:rgba(16,27,47,.95);font-size:12px;text-transform:uppercase;letter-spacing:.7px}tr:last-child td{border-bottom:0}tr:hover td{background:rgba(47,128,237,.06)}.muted{color:var(--muted)}.pill{padding:5px 10px;border-radius:999px;background:rgba(47,128,237,.14);border:1px solid rgba(47,128,237,.25);display:inline-block;font-weight:800}.forms-inline{display:inline}.actions{white-space:nowrap}.search{display:grid;grid-template-columns:1fr 120px;gap:8px;max-width:560px}.service-card{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:linear-gradient(135deg,rgba(13,23,42,.96),rgba(16,27,49,.92));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:16px;margin:12px 0}.service-title{font-size:18px;font-weight:900}.service-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;background:rgba(148,163,184,.12);color:#dbe7f5;font-weight:800;font-size:12px}.form-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr;gap:12px}.mini-help{background:rgba(40,215,255,.08);border:1px dashed rgba(40,215,255,.24);padding:12px;border-radius:14px;color:#cbefff}.empty{padding:28px;text-align:center;color:var(--muted)}.hero-hacker{position:relative;min-height:310px;display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:18px;overflow:hidden;border:1px solid rgba(0,255,102,.32);border-radius:26px;padding:30px;margin-bottom:18px;background:linear-gradient(90deg,rgba(0,0,0,.92),rgba(0,20,8,.52)),url('/img/hacker.png') center right/cover no-repeat;box-shadow:0 0 28px rgba(0,255,102,.14),inset 0 0 80px rgba(0,255,102,.06)}.hero-hacker:before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,255,102,.05),transparent),repeating-linear-gradient(0deg,rgba(0,255,102,.045) 0 1px,transparent 1px 34px),repeating-linear-gradient(90deg,rgba(0,255,102,.035) 0 1px,transparent 1px 45px);pointer-events:none}.hero-hacker .hero-content{position:relative;z-index:1;max-width:620px}.hero-hacker .eyebrow{color:#38ff6a;font-weight:900;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}.hero-hacker h1{font-size:42px;line-height:1.02;margin:0 0 12px;text-transform:uppercase;text-shadow:0 0 18px rgba(0,255,102,.35)}.hero-hacker h1 span{color:#39ff14}.hero-hacker p{font-size:18px;color:#d6ffe0;margin:0 0 18px}.system-card{position:relative;z-index:1;justify-self:end;width:min(360px,100%);background:rgba(0,0,0,.62);border:1px solid rgba(0,255,102,.24);border-radius:18px;padding:16px;backdrop-filter:blur(8px)}.system-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(255,255,255,.08);padding:10px 0;font-weight:800}.system-row:last-child{border-bottom:0}.online{color:#39ff14;text-shadow:0 0 12px rgba(57,255,20,.6)}.clock-box{display:inline-flex;align-items:center;gap:8px;color:#dbffe6;border:1px solid rgba(0,255,102,.2);border-radius:999px;padding:8px 12px;background:rgba(0,0,0,.32)}.card,.service-card{border-color:rgba(0,255,102,.18);box-shadow:0 18px 45px rgba(0,0,0,.35),0 0 18px rgba(0,255,102,.06)}.metric h1{color:#f5fff7}.metric:hover{transform:translateY(-2px);box-shadow:0 18px 45px rgba(0,0,0,.4),0 0 24px rgba(0,255,102,.12)}.side-profile{margin-top:16px;border:1px solid rgba(0,255,102,.18);border-radius:18px;min-height:155px;background:linear-gradient(180deg,rgba(0,0,0,.4),rgba(0,20,8,.35)),url('/img/hacker.png') center/cover no-repeat;padding:14px;display:flex;align-items:end}.side-profile b{background:rgba(0,0,0,.62);padding:6px 10px;border-radius:999px;color:#39ff14}.image-preview{width:100%;max-height:260px;object-fit:cover;border-radius:18px;border:1px solid rgba(0,255,102,.25);box-shadow:0 0 20px rgba(0,255,102,.08)}@media(max-width:900px){.layout{grid-template-columns:1fr}.side{height:auto;position:relative}.brand{margin-bottom:10px}.side .nav-title{display:none}.side a{display:inline-flex;padding:10px 12px}.main{padding:14px}.search,.form-grid{grid-template-columns:1fr}table{font-size:12px;display:block;overflow-x:auto}.actions{white-space:normal}.service-card{grid-template-columns:1fr}.hero h1{font-size:24px}.hero-hacker{grid-template-columns:1fr;min-height:420px;background-position:center}.system-card{justify-self:stretch}.hero-hacker h1{font-size:30px}}
  
  body.theme-hacker-green{--accent:#00ff66;--accent2:#28d7ff}body.theme-hacker-blue{--accent:#28d7ff;--accent2:#2f80ed}body.theme-hacker-red{--accent:#ff3b3b;--accent2:#ff9f43}body.theme-hacker-purple{--accent:#a855f7;--accent2:#28d7ff}body.theme-dark-pro{--accent:#94a3b8;--accent2:#2f80ed}.hero-hacker{background:linear-gradient(90deg,rgba(0,0,0,.84),rgba(0,0,0,.46)),url('/img/hacker.png?v=1'),radial-gradient(circle at 70% 25%,var(--accent),transparent 22%),linear-gradient(135deg,#020617,#0f172a);background-size:cover;background-position:center;border-color:color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:0 0 30px color-mix(in srgb,var(--accent) 24%,transparent)}.hero-content span,.online{color:var(--accent)}.btn.green,.metric:before{background:linear-gradient(135deg,var(--accent),var(--accent2))}.card.metric{border-color:color-mix(in srgb,var(--accent) 26%,transparent);box-shadow:0 12px 34px rgba(0,0,0,.35),0 0 18px color-mix(in srgb,var(--accent) 13%,transparent)}.theme-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.theme-card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:14px;background:#08111f}.theme-preview{height:58px;border-radius:12px;margin-bottom:10px}.preview-hacker-green{background:linear-gradient(135deg,#001b0a,#00ff66)}.preview-hacker-blue{background:linear-gradient(135deg,#00152d,#28d7ff)}.preview-hacker-red{background:linear-gradient(135deg,#230707,#ff3b3b)}.preview-hacker-purple{background:linear-gradient(135deg,#18062b,#a855f7)}.preview-dark-pro{background:linear-gradient(135deg,#020617,#64748b)}.toast-wrap{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:10px}.toast{max-width:330px;background:rgba(2,6,23,.96);border:1px solid var(--accent);box-shadow:0 0 22px color-mix(in srgb,var(--accent) 25%,transparent);border-radius:16px;padding:12px;animation:toastIn .25s ease}.toast b{display:block;color:var(--accent);margin-bottom:4px}.notif-bell{position:fixed;right:18px;top:18px;z-index:40;background:#06111f;border:1px solid var(--accent);border-radius:999px;padding:10px 13px;box-shadow:0 0 14px color-mix(in srgb,var(--accent) 22%,transparent);font-weight:900}.notif-bell span{background:#ef4444;border-radius:999px;padding:2px 6px;margin-left:4px;font-size:12px}@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}.image-preview{max-width:100%;border-radius:16px;border:1px solid rgba(255,255,255,.12)}.status-action-form{display:grid;grid-template-columns:minmax(170px,1fr) auto;gap:6px;align-items:start;min-width:240px}.status-action-form input[name=motivo]{grid-column:1/-1}.status-action-form select{min-width:170px}.status-action-form .btn{height:42px}@media(max-width:900px){.status-action-form{grid-template-columns:1fr}.status-action-form .btn{width:100%}}
</style><script src="/socket.io/socket.io.js"></script></head><body class="theme-${temaAtual()}"><div class="toast-wrap" id="toastWrap"></div><div class="layout"><aside class="side"><div class="brand">CentralUnlocker</div><div class="nav-title">Painel</div><a href="/admin">📊 Dashboard</a><a href="/admin/pedidos">📋 Pedidos</a><a href="/admin/revendas">👥 Clientes</a><a href="/admin/servicos">🛠 Serviços</a><a href="/admin/esim">📱 eSIM</a><a href="/admin/mensagens">📢 Mensagens</a><a href="/admin/financeiro">💰 Financeiro</a><a href="/admin/relatorios">📈 Relatórios</a><a href="/admin/backup">💾 Backup</a><div class="nav-title">Sistema</div><a href="/admin/whatsapp">📲 WhatsApp</a><a href="/admin/config">⚙️ Configurações</a><a href="/admin/logout">🚪 Sair</a><div class="side-profile"><b>Admin Master</b></div></aside><main class="main">${body}</main></div><script>
(function(){
 const socket=io(); let total=0;
 const wrap=document.getElementById('toastWrap');
 const bell=document.createElement('div'); bell.className='notif-bell'; bell.innerHTML='🔔 <span id="notifCount">0</span>'; document.body.appendChild(bell);
 function toast(n){ total++; const c=document.getElementById('notifCount'); if(c)c.textContent=total; const el=document.createElement('div'); el.className='toast'; el.innerHTML='<b>'+((n&&n.titulo)||'Notificação')+'</b><div>'+((n&&n.mensagem)||'Atualização recebida')+'</div><small>'+((n&&n.hora)||'')+'</small>'; wrap.appendChild(el); setTimeout(()=>el.remove(),7000); }
 window.confirmarAcaoPedido=function(form){
   const acao=form.querySelector('select[name=acao]')?.value||'';
   const motivo=form.querySelector('input[name=motivo]');
   if(!acao){ alert('Escolha uma ação.'); return false; }
   if(acao==='cancelar'){
     if(motivo){ motivo.style.display='block'; motivo.required=true; if(!motivo.value.trim()){ motivo.focus(); alert('Informe o motivo do cancelamento.'); return false; } }
     return confirm('Cancelar este pedido?');
   }
   if(motivo){ motivo.required=false; }
   if(acao==='finalizar') return confirm('Finalizar este pedido?');
   if(acao==='processo') return confirm('Colocar este pedido em processo?');
   return true;
 };
 document.addEventListener('change',function(e){
   if(e.target && e.target.matches('.status-action-form select[name=acao]')){
     const form=e.target.closest('form'); const motivo=form&&form.querySelector('input[name=motivo]');
     if(motivo){ motivo.style.display=e.target.value==='cancelar'?'block':'none'; motivo.required=e.target.value==='cancelar'; }
   }
 });
 socket.on('notificacao', toast);
 socket.on('dashboard-update', ()=>{ const live=document.querySelector('[data-live-dashboard]'); if(live){ setTimeout(()=>location.reload(),900); } });
})();
</script></body></html>`;
}
async function precoDaRevenda(revendaId, servicoId) {
  const pr = await get('SELECT preco FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [revendaId, servicoId]);
  if (pr && Number(pr.preco) > 0) return Number(pr.preco);
  const s = await get('SELECT preco_padrao FROM servicos_catalogo WHERE id=?', [servicoId]);
  return Number(s?.preco_padrao || 0);
}
async function getRevendaByJidOrNumber(jid) {
  const numeros = variantesNumero(jidToNumber(jid));
  const rows = await all('SELECT * FROM revendas WHERE status="ATIVA"');
  for (const r of rows) {
    const rvNums = new Set([...variantesNumero(r.whatsapp), ...variantesNumero(jidToNumber(r.jid))]);
    if (r.jid === jid || numeros.some(n => rvNums.has(n))) return r;
  }
  return null;
}
async function getRevendaByMsg(msg, fallbackJid) {
  const numeros = numerosPossiveisDaMensagem(msg, fallbackJid);
  const rows = await all('SELECT * FROM revendas WHERE status="ATIVA"');
  console.log('🔎 BUSCA REVENDA numeros=', numeros.join(','));
  for (const r of rows) {
    const rvNums = new Set([...variantesNumero(r.whatsapp), ...variantesNumero(jidToNumber(r.jid))]);
    if (r.jid === fallbackJid || numeros.some(n => rvNums.has(n))) {
      console.log('✅ REVENDA ENCONTRADA:', r.id, r.nome, r.whatsapp);
      return r;
    }
  }
  console.log('❌ REVENDA NÃO ENCONTRADA para:', numeros.join(','));
  return null;
}
async function listarServicosTexto(revenda) {
  const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let texto = `🛠 *SERVIÇOS DISPONÍVEIS*\n\n`;
  for (let i = 0; i < servicos.length; i++) {
    const preco = revenda ? await precoDaRevenda(revenda.id, servicos[i].id) : Number(servicos[i].preco_padrao || 0);
    texto += `${i + 1} - ${servicos[i].nome} - ${brl(preco)}\n`;
  }
  texto += '\nToque no serviço desejado abaixo.';
  return texto;
}
async function enviarWhatsAppTexto(numero, text) {
  if (!WHATSAPP_ENABLED) return false;
  const number = normalizarNumeroWhatsApp(numero);
  if (!number) return false;
  try {
    if (WHATSAPP_PROVIDER === 'baileys' || WHATSAPP_PROVIDER === 'qrcode') {
      if (!whatsappSocket || !conectado) {
        console.log('⚠️ WhatsApp QR Code ainda não está conectado.');
        return false;
      }
      const destino = whatsappJidPorNumero.get(number) || numberToJid(number);
      await whatsappSocket.sendMessage(destino, { text: String(text || '') });
      return true;
    }
    if (WHATSAPP_PROVIDER === 'evolution') {
      if (!EVOLUTION_API_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) return false;
      await axios.post(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
        number,
        text: String(text || '')
      }, {
        headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        timeout: 20000
      });
      return true;
    }
  } catch (e) {
    console.log('❌ ERRO ENVIAR TEXTO WHATSAPP:', e.response?.data || e.message);
  }
  return false;
}
async function enviarTexto(to, text) {
  try {
    if (!to) return false;
    if (isTgJid(to) || /^\d+$/.test(String(to))) {
      if (!tgBot) return false;
      const chatId = isTgJid(to) ? tgIdFromJid(to) : String(to);
      if (!/^\d+$/.test(chatId)) return false;
      await tgBot.sendMessage(chatId, String(text || ''));
      return true;
    }
    if (String(to).startsWith('wa:')) return await enviarWhatsAppTexto(String(to).slice(3), text);
    if (String(to).includes('@s.whatsapp.net')) return await enviarWhatsAppTexto(jidToNumber(to), text);
    return await enviarWhatsAppTexto(to, text);
  } catch (e) { console.log('❌ ERRO ENVIAR TEXTO:', e.message); }
  return false;
}
async function enviarImagemWhatsApp(numero, filePath, caption='') {
  if (!WHATSAPP_ENABLED) return false;
  const number = normalizarNumeroWhatsApp(numero);
  if (!number || !filePath || !fs.existsSync(filePath)) return false;
  try {
    if (WHATSAPP_PROVIDER === 'baileys' || WHATSAPP_PROVIDER === 'qrcode') {
      if (!whatsappSocket || !conectado) return false;
      await whatsappSocket.sendMessage(numberToJid(number), {
        image: fs.readFileSync(filePath),
        caption: String(caption || '')
      });
      return true;
    }
    if (WHATSAPP_PROVIDER === 'evolution') {
      if (!EVOLUTION_API_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) return false;
      const base64 = fs.readFileSync(filePath).toString('base64');
      await axios.post(`${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`, {
        number,
        mediatype: 'image',
        mimetype: 'image/png',
        caption: String(caption || ''),
        media: base64,
        fileName: path.basename(filePath)
      }, { headers: { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, timeout: 30000 });
      return true;
    }
  } catch (e) { console.log('❌ ERRO ENVIAR IMAGEM WHATSAPP:', e.response?.data || e.message); }
  return false;
}
async function enviarImagem(to, filePath, caption='') {
  try {
    if (!to || !filePath || !fs.existsSync(filePath)) return false;
    if (isTgJid(to) || /^\d+$/.test(String(to))) {
      if (!tgBot) return false;
      const chatId = isTgJid(to) ? tgIdFromJid(to) : String(to);
      if (!/^\d+$/.test(chatId)) return false;
      await tgBot.sendPhoto(chatId, fs.createReadStream(filePath), { caption: String(caption || '') });
      return true;
    }
    if (String(to).startsWith('wa:')) return await enviarImagemWhatsApp(String(to).slice(3), filePath, caption);
    if (String(to).includes('@s.whatsapp.net')) return await enviarImagemWhatsApp(jidToNumber(to), filePath, caption);
    return await enviarImagemWhatsApp(to, filePath, caption);
  } catch (e) { console.log('❌ ERRO ENVIAR IMAGEM:', e.message); }
  return false;
}
async function avisarAdminTelegram(texto) {
  if (ADMIN_TELEGRAM_ID && tgBot) {
    try { await tgBot.sendMessage(ADMIN_TELEGRAM_ID, String(texto || '')); } catch(e) { console.log('❌ ADMIN TG:', e.message); }
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function mensagemImagem(msg) {
  return msg.message?.imageMessage ||
    msg.message?.ephemeralMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage ||
    null;
}
async function salvarImagemWhatsAppEmEsim(msg) {
  // Função legada desativada. A entrega manual usa salvarArquivoTelegramEmEsim().
  return null;
}


async function salvarArquivoTelegramEmEsim(msg) {
  if (!tgBot || !msg) return null;
  try {
    let fileId = null;
    let ext = '.jpg';
    if (Array.isArray(msg.photo) && msg.photo.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      ext = '.jpg';
    } else if (msg.document?.file_id) {
      fileId = msg.document.file_id;
      const nome = String(msg.document.file_name || '').toLowerCase();
      if (nome.endsWith('.png')) ext = '.png';
      else if (nome.endsWith('.webp')) ext = '.webp';
      else if (nome.endsWith('.pdf')) ext = '.pdf';
      else if (nome.endsWith('.jpg') || nome.endsWith('.jpeg')) ext = '.jpg';
    }
    if (!fileId) return null;
    const baixado = await tgBot.downloadFile(fileId, ESIM_DIR);
    const fileName = `esim_manual_tg_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    const destino = path.join(ESIM_DIR, fileName);
    fs.renameSync(baixado, destino);
    return { fileName, filePath: destino, rel: `esim/${fileName}` };
  } catch (e) {
    console.log('❌ ERRO SALVAR ARQUIVO TELEGRAM:', e.message);
    return null;
  }
}
function adminsJids() { return ADMIN_TELEGRAM_ID ? [tgJid(ADMIN_TELEGRAM_ID)] : []; }
async function enviarParaAdmins(texto) {
  if (ADMIN_TELEGRAM_ID && tgBot) {
    try { await tgBot.sendMessage(ADMIN_TELEGRAM_ID, String(texto || '')); }
    catch (e) { console.log('⚠️ Falha ao avisar admin Telegram:', e.message); }
  }
}
async function enviarMensagemRevendas({ texto, revendaId=null, imagemPath=null }) {
  const rows = revendaId
    ? await all('SELECT * FROM revendas WHERE id=? AND status="ATIVA"', [revendaId])
    : await all('SELECT * FROM revendas WHERE status="ATIVA"');
  let enviadas = 0, falhas = 0;
  for (const r of rows) {
    const jid = r.jid || numberToJid(r.whatsapp);
    if (!jid) { falhas++; continue; }
    try {
      if (imagemPath) await enviarImagem(jid, imagemPath, texto);
      else await enviarTexto(jid, texto);
      enviadas++;
      await new Promise(resolve => setTimeout(resolve, 350));
    } catch (e) { falhas++; console.log('⚠️ Falha mensagem revenda:', r.id, e.message); }
  }
  return { total: rows.length, enviadas, falhas };
}
async function avisarNovoPedidoAdmins(pedido, extra='') {
  const entrada = textoEntradaPedido(pedido);
  const origem = pedido.revenda_nome ? `🏪 Revenda: ${pedido.revenda_nome}` : `👤 Cliente: ${pedido.cliente_nome || pedido.cliente_whatsapp || '-'}`;
  await enviarParaAdmins(`🔔 *Novo serviço recebido*

${origem}
🛠 Serviço: ${pedido.servico_nome || '-'}
${entrada}
💰 Valor: ${brl(pedido.valor)}
📍 Status: ${pedido.status || 'PENDENTE'}${extra ? `

${extra}` : ''}

🏢 Centralunlocker`);
}

async function avisarEsimManualAdminTelegram(pedido) {
  if (!ADMIN_TELEGRAM_ID || !tgBot || !pedido) return;
  const texto = `🔔 Novo pedido de eSIM

👤 Cliente: ${pedido.revenda_nome || pedido.cliente_nome || '-'}
📦 Plano: ${pedido.entrada_valor || pedido.servico_nome || '-'}
💰 Valor: ${brl(pedido.valor)}
🆔 Pedido: #${pedido.id}
📌 Status: Aguardando entrega manual

➡️ Você pode entregar o QR Code direto por aqui ou abrir o painel admin.`;
  try {
    await tgBot.sendMessage(ADMIN_TELEGRAM_ID, texto, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Enviar QR Code', callback_data: `esim_entregar_${pedido.id}` }],
          [{ text: '✅ Finalizar', callback_data: `esim_finalizar_${pedido.id}` }, { text: '❌ Cancelar', callback_data: `esim_cancelar_${pedido.id}` }]
        ]
      }
    });
  } catch (e) {
    console.log('⚠️ Falha aviso eSIM manual Telegram:', e.message);
  }
}

async function avisarEsimAutomaticoAdminTelegram(pedido, item) {
  if (!ADMIN_TELEGRAM_ID || !tgBot || !pedido) return;
  const texto = `✅ eSIM entregue automaticamente

👤 Cliente: ${pedido.revenda_nome || pedido.cliente_nome || '-'}
📦 Plano: ${pedido.entrada_valor || pedido.servico_nome || item?.nome_plano || '-'}
💰 Valor: ${brl(pedido.valor)}
🆔 Pedido: #${pedido.id}
📦 Estoque QR usado: #${item?.id || '-'}
📌 Status: FINALIZADO

🏢 Centralunlocker`;
  try {
    await tgBot.sendMessage(ADMIN_TELEGRAM_ID, texto);
  } catch (e) {
    console.log('⚠️ Falha aviso eSIM automático Telegram:', e.message);
  }
}

async function avisarNovoLoteAdmins(revenda, servico, quantidade, total) {
  await enviarParaAdmins(`📦 *Novo lote recebido*

🏪 Revenda: ${revenda.nome}
🛠 Serviço: ${servico.nome}
📦 Quantidade: ${quantidade}
💰 Total: ${brl(total)}
📍 Status: PENDENTE

🏢 Centralunlocker`);
}


async function cadastrarClienteTelegram(user) {
  const telegramId = String(user.id);
  const jid = tgJid(telegramId);
  let cliente = await get('SELECT * FROM revendas WHERE (jid=? OR telegram_id=?) AND status != "REMOVIDA"', [jid, telegramId]);
  if (cliente) return { cliente, novo:false };
  const nome = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `Cliente ${telegramId}`;
  let login = gerarLogin(user.username || user.first_name || 'cliente', telegramId);
  const existe = await get('SELECT id FROM revendas WHERE login=?', [login]);
  if (existe) login = `${login}${Date.now().toString().slice(-3)}`;
  const senha = gerarSenha(8);
  const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda, telegram_id, limite_credito) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, "PRE_PAGO", ?, 0)', [nome, telegramId, jid, login, senha, telegramId]);
  cliente = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
  notificarPainel('cliente', '👤 Novo cliente Telegram', `${nome} - ${telegramId}`);
  await avisarAdminTelegram(`👤 Novo cliente cadastrado

Nome: ${nome}
Telegram ID: ${telegramId}
Usuário: ${login}`);
  return { cliente, novo:true };
}

function gerarCodigoVinculo() {
  return String(crypto.randomInt(100000, 1000000));
}

async function criarCodigoVinculoWhatsApp(cliente) {
  if (!cliente?.id || !cliente?.telegram_id) throw new Error('Conta do Telegram inválida');
  await run('DELETE FROM whatsapp_vinculos WHERE revenda_id=? OR usado=1 OR expira_em < ?', [cliente.id, Date.now()]);
  let codigo;
  for (let i = 0; i < 10; i++) {
    const candidato = gerarCodigoVinculo();
    const existe = await get('SELECT codigo FROM whatsapp_vinculos WHERE codigo=?', [candidato]);
    if (!existe) { codigo = candidato; break; }
  }
  if (!codigo) throw new Error('Não foi possível gerar o código');
  const expiraEm = Date.now() + (10 * 60 * 1000);
  await run('INSERT INTO whatsapp_vinculos (codigo, revenda_id, telegram_id, expira_em, usado) VALUES (?, ?, ?, ?, 0)', [codigo, cliente.id, String(cliente.telegram_id), expiraEm]);
  return codigo;
}

async function vincularWhatsAppPorCodigo(codigo, numero, nomeContato='Cliente WhatsApp') {
  const numeroNorm = normalizarNumeroWhatsApp(numero);
  const vinculo = await get('SELECT * FROM whatsapp_vinculos WHERE codigo=? AND usado=0', [String(codigo)]);
  if (!vinculo) return { ok:false, erro:'Código inválido ou já utilizado.' };
  if (Number(vinculo.expira_em) < Date.now()) {
    await run('DELETE FROM whatsapp_vinculos WHERE codigo=?', [String(codigo)]);
    return { ok:false, erro:'Código expirado. Gere um novo código no Telegram.' };
  }
  const telegram = await get('SELECT * FROM revendas WHERE id=? AND telegram_id=? AND status != "REMOVIDA"', [vinculo.revenda_id, String(vinculo.telegram_id)]);
  if (!telegram) return { ok:false, erro:'Conta do Telegram não encontrada.' };
  const whatsapp = await get('SELECT * FROM revendas WHERE (whatsapp=? OR jid=?) AND status != "REMOVIDA"', [numeroNorm, `wa:${numeroNorm}`]);
  if (whatsapp && whatsapp.id !== telegram.id && whatsapp.telegram_id && String(whatsapp.telegram_id) !== String(telegram.telegram_id)) {
    return { ok:false, erro:'Este WhatsApp já está vinculado a outra conta do Telegram.' };
  }

  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    if (whatsapp && whatsapp.id !== telegram.id) {
      // O Telegram permanece como conta principal. O cadastro provisório do WhatsApp
      // é desativado sem transferir saldo, pedidos, pagamentos, preços ou histórico.
      await run('UPDATE revendas SET status="REMOVIDA", whatsapp=NULL, jid=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [whatsapp.id]);
    }
    await run('UPDATE revendas SET whatsapp=?, jid=?, nome=COALESCE(NULLIF(nome, ""), ?), atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [numeroNorm, `wa:${numeroNorm}`, nomeContato, telegram.id]);
    await run('UPDATE whatsapp_vinculos SET usado=1 WHERE codigo=?', [String(codigo)]);
    await run('COMMIT');
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    throw e;
  }
  const atualizado = await get('SELECT * FROM revendas WHERE id=?', [telegram.id]);
  return { ok:true, cliente:atualizado };
}


async function vincularContaWhatsAppPeloAdmin(whatsappId, telegramId) {
  const wa = await get('SELECT * FROM revendas WHERE id=? AND status != "REMOVIDA"', [whatsappId]);
  const tg = await get('SELECT * FROM revendas WHERE id=? AND status != "REMOVIDA"', [telegramId]);
  if (!wa) return { ok:false, erro:'Conta do WhatsApp não encontrada.' };
  if (!tg) return { ok:false, erro:'Conta do Telegram não encontrada.' };
  if (!wa.whatsapp || wa.telegram_id) return { ok:false, erro:'Selecione uma conta criada somente pelo WhatsApp.' };
  if (!tg.telegram_id) return { ok:false, erro:'Selecione uma conta antiga do Telegram.' };
  if (Number(wa.id) === Number(tg.id)) return { ok:false, erro:'As contas selecionadas são iguais.' };

  const numero = normalizarNumeroWhatsApp(wa.whatsapp || jidToNumber(wa.jid));
  if (!numero) return { ok:false, erro:'A conta do WhatsApp não possui um número válido.' };

  const outroVinculo = await get('SELECT id FROM revendas WHERE whatsapp=? AND id NOT IN (?, ?) AND status != "REMOVIDA"', [numero, wa.id, tg.id]);
  if (outroVinculo) return { ok:false, erro:'Este WhatsApp já está vinculado a outra conta.' };

  await run('BEGIN IMMEDIATE TRANSACTION');
  try {
    // A conta antiga do Telegram permanece integralmente como conta principal.
    // Nenhum saldo, pedido, pagamento, PIX, eSIM, preço ou histórico da conta
    // provisória do WhatsApp é somado ou transferido.
    await run('UPDATE revendas SET whatsapp=?, jid=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [numero, `wa:${numero}`, tg.id]);

    // Desativa a conta provisória do WhatsApp. Os registros antigos dela permanecem
    // separados no banco para auditoria, mas deixam de aparecer para o cliente.
    await run(`UPDATE revendas SET status='REMOVIDA', whatsapp=NULL, jid=NULL, login=?, senha=NULL, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,
      [`substituida_${wa.id}_${Date.now()}`, wa.id]);

    await run('COMMIT');
  } catch (e) {
    try { await run('ROLLBACK'); } catch (_) {}
    throw e;
  }

  const cliente = await get('SELECT * FROM revendas WHERE id=?', [tg.id]);
  pedidoSessao.delete(`wa:${numero}`);
  notificarPainel('cliente', '🔗 WhatsApp vinculado ao Telegram', `${cliente.nome} - WhatsApp +${numero}`);
  try {
    await enviarParaCanaisCliente(cliente, `✅ Seu WhatsApp foi vinculado à sua conta antiga do Telegram.\n\nA partir de agora, os dois canais usam exclusivamente o saldo, o histórico e os pedidos da conta do Telegram.`);
  } catch (e) {
    console.log('⚠️ Aviso após vínculo administrativo:', e.message);
  }
  return { ok:true, cliente };
}

function menuTelegramTexto(cliente) {
  const tipo = labelTipoRevenda(cliente?.tipo_revenda || 'PRE_PAGO');
  const saldo = brl(cliente?.saldo || 0);
  const linhaFinanceira = isRevendaPosPaga(cliente)
    ? `💳 Tipo: ${tipo}
📌 Débito atual: ${saldo}`
    : `💳 Tipo: ${tipo}
💰 Saldo: ${saldo}`;
  return `🏠 *MENU PRINCIPAL*

Olá, ${cliente?.nome || 'cliente'}!

${linhaFinanceira}

Toque em uma opção abaixo.`;
}
function tecladoTelegramMenu() {
  return {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Serviços', callback_data: 'menu_servicos' }, { text: '📱 Comprar eSIM', callback_data: 'menu_esim' }],
        [{ text: '📦 Histórico', callback_data: 'menu_historico' }, { text: '👤 Minha Conta', callback_data: 'menu_conta' }],
        [{ text: '💳 Pagar / Saldo', callback_data: 'menu_pagar' }, { text: '🆘 Suporte', callback_data: 'menu_suporte' }],
        [{ text: '🔗 Vincular WhatsApp', callback_data: 'menu_vincular_whatsapp' }]
      ]
    }
  };
}
async function enviarMenuTelegram(chatId, cliente) {
  if (!tgBot) return;
  await tgBot.sendMessage(chatId, menuTelegramTexto(cliente), tecladoTelegramMenu());
}
function montarLinhasBotoes(items, prefixo, nomeCampo='nome') {
  const linhas = [];
  for (let i = 0; i < items.length; i += 2) {
    const linha = items.slice(i, i + 2).map(item => ({
      text: String(item[nomeCampo] || item.nome_plano || item.nome || 'Opção').slice(0, 45),
      callback_data: `${prefixo}_${item.id}`
    }));
    linhas.push(linha);
  }
  linhas.push([{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]);
  return linhas;
}
async function enviarServicosBotoesTelegram(chatId, cliente) {
  const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  if (!servicos.length) {
    await tgBot.sendMessage(chatId, '❌ Nenhum serviço cadastrado no momento.', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]] } });
    return;
  }
  let texto = `🔓 *Escolha um serviço*\n\n`;
  for (const s of servicos) {
    const preco = cliente ? await precoDaRevenda(cliente.id, s.id) : Number(s.preco_padrao || 0);
    texto += `• ${s.nome} — ${brl(preco)}
`;
  }
  await tgBot.sendMessage(chatId, texto, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: montarLinhasBotoes(servicos, 'servico', 'nome') }
  });
}
async function enviarEsimBotoesTelegram(chatId) {
  const planos = await planosEsimDisponiveis();
  if (!planos.length) {
    await tgBot.sendMessage(chatId, '❌ Nenhum plano eSIM cadastrado no momento.', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]] } });
    return;
  }
  let texto = `📱 *Escolha um plano eSIM*

`;
  for (const p of planos) {
    const qtd = Number(p.qtd || 0);
    const entrega = qtd > 0 ? `📦 ${qtd} QR disponível${qtd > 1 ? 's' : ''}` : '👨‍💻 Entrega manual';
    texto += `• ${p.nome_plano} — ${brl(p.preco_revenda)}
${entrega}

`;
  }
  await tgBot.sendMessage(chatId, texto.trim(), {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: montarLinhasBotoes(planos, 'esim', 'nome_plano') }
  });
}
function normalizarOpcaoTelegram(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (t.includes('serviço') || t.includes('servico')) return '1';
  if (t.includes('esim')) return '2';
  if (t.includes('histórico') || t.includes('historico')) return '3';
  if (t.includes('conta')) return '4';
  if (t.includes('pagar') || t.includes('pagamento') || t.includes('pix')) return '5';
  if (t.includes('suporte')) return '6';
  return t.replace(/[️⃣\s]/g, '').slice(0, 20);
}
async function processarMensagemTelegram(msg) {
  if (!msg?.from?.id || !msg?.chat?.id) return;
  const fromAdmin = tgJid(msg.from.id);
  const sessAdmin = adminSessao.get(fromAdmin);
  if (String(msg.from.id) === String(ADMIN_TELEGRAM_ID || '') && sessAdmin?.etapa === 'entregar_esim_manual_tg') {
    const txtAdmin = String(msg.text || '').trim().toLowerCase();
    if (['cancelar', 'sair', 'voltar'].includes(txtAdmin)) {
      adminSessao.delete(fromAdmin);
      await tgBot.sendMessage(msg.chat.id, '✅ Entrega cancelada.');
      return;
    }
    await concluirEntregaEsimManualTelegram(msg.chat.id, msg);
    return;
  }
  if (!msg.text) return;
  const textoOriginal = String(msg.text || '').trim();
  const texto = textoOriginal.toLowerCase().trim();
  if (!textoOriginal) return;
  if (texto === '/start' || texto === '/senha') return;

  const { cliente } = await cadastrarClienteTelegram(msg.from);
  const from = tgJid(msg.from.id);
  const opcao = normalizarOpcaoTelegram(textoOriginal);

  if (['cancelar', 'sair', 'voltar'].includes(texto)) {
    pedidoSessao.delete(from);
    await tgBot.sendMessage(msg.chat.id, '✅ Operação cancelada.');
    await enviarMenuTelegram(msg.chat.id, cliente);
    return;
  }

  if (texto === '/menu' || texto === 'menu' || texto === 'início' || texto === 'inicio') {
    pedidoSessao.delete(from);
    await enviarMenuTelegram(msg.chat.id, cliente);
    return;
  }

  if (texto === '/vincular' || texto === 'vincular' || texto === 'vincular whatsapp') {
    pedidoSessao.delete(from);
    const codigo = await criarCodigoVinculoWhatsApp(cliente);
    await tgBot.sendMessage(msg.chat.id, `🔗 *Vincular WhatsApp*

Envie este código para o WhatsApp da CentralUnlocker:

*${codigo}*

⏳ O código é válido por 10 minutos.`, { parse_mode: 'Markdown' });
    return;
  }

  if (texto.startsWith('pagar') || texto.startsWith('/pagar')) {
    const partes = textoOriginal.trim().split(/\s+/);
    const valor = Number(String(partes[1] || '0').replace(',', '.'));
    if (!valor || valor < 10) {
      await tgBot.sendMessage(msg.chat.id, '❌ Informe um valor mínimo de R$10.\n\nExemplo:\npagar 50');
      return;
    }
    pedidoSessao.set(from, { etapa: 'aguardando_cpf_pix', valor_pix: valor });
    await tgBot.sendMessage(
      msg.chat.id,
      `📄 Informe o CPF do pagador para gerar o PIX de ${brl(valor)}.\n\nSomente este CPF poderá efetuar o pagamento do QR Code.`
    );
    return;
    const paymentId = pix?.data?.payment_id || pix?.payment_id || pix?.data?.id || pix?.id || pix?.transaction_id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.data?.pix_copy_paste || pix?.qr_code || pix?.copy_paste || pix?.brcode;
    if (paymentId) {
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, valor, status) VALUES (?, ?, ?, ?, ?, "pending")', [paymentId, cliente.id, from, from, valor]);
      verificarPagamento(paymentId, cliente.id, from, valor);
    }
    await tgBot.sendMessage(msg.chat.id, `✅ PIX GERADO\n\n💰 Valor: ${brl(valor)}\n\nCopia e cola abaixo:`);
    await tgBot.sendMessage(msg.chat.id, qrCode || 'PIX indisponível');
    return;
  }

  let sess = pedidoSessao.get(from);

  if (sess?.etapa === 'aguardando_cpf_pix') {
    const cpf = textoOriginal.replace(/\D/g, '');

    if (cpf.length !== 11) {
      await tgBot.sendMessage(msg.chat.id, '❌ CPF inválido. Envie apenas os 11 números do CPF.');
      return;
    }

    await tgBot.sendMessage(msg.chat.id, '⏳ Gerando PIX...');
    const pix = await gerarPix(sess.valor_pix, `Telegram ${cliente.nome}`, cpf);

    if (!pix) {
      await tgBot.sendMessage(msg.chat.id, '❌ Erro ao gerar PIX.');
      pedidoSessao.delete(from);
      return;
    }

    pedidoSessao.delete(from);

    const valor = sess.valor_pix;
    const paymentId = pix?.data?.payment_id || pix?.payment_id || pix?.data?.id || pix?.id || pix?.transaction_id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.data?.pix_copy_paste || pix?.qr_code || pix?.copy_paste || pix?.brcode;

    if (paymentId) {
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, valor, status) VALUES (?, ?, ?, ?, ?, "pending")',
        [paymentId, cliente.id, from, from, valor]);
      verificarPagamento(paymentId, cliente.id, from, valor);
    }

    await tgBot.sendMessage(msg.chat.id, `✅ PIX GERADO\n\n💰 Valor: ${brl(valor)}\n\nCopia e cola abaixo:`);
    await tgBot.sendMessage(msg.chat.id, qrCode || 'PIX indisponível');
    return;
  }

  sess = pedidoSessao.get(from);

  if (sess?.etapa === 'menu') {
    if (opcao === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarServicosBotoesTelegram(msg.chat.id, cliente); return; }
    if (opcao === '2') { pedidoSessao.set(from, { etapa: 'esim_escolha' }); await enviarEsimBotoesTelegram(msg.chat.id); return; }
    if (opcao === '3') { pedidoSessao.delete(from); await enviarHistoricoRevenda(from, cliente); return; }
    if (opcao === '4') { pedidoSessao.delete(from); await enviarContaRevenda(from, cliente); return; }
    if (opcao === '5') { pedidoSessao.delete(from); await tgBot.sendMessage(msg.chat.id, '💳 Para gerar PIX, digite:\n\npagar 50'); return; }
    if (opcao === '6') { pedidoSessao.delete(from); await enviarSuporteTelegram(msg.chat.id); return; }
  }

  if (!sess) {
    if (opcao === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarServicosBotoesTelegram(msg.chat.id, cliente); return; }
    if (opcao === '2') { pedidoSessao.set(from, { etapa: 'esim_escolha' }); await enviarEsimBotoesTelegram(msg.chat.id); return; }
    if (opcao === '3') { await enviarHistoricoRevenda(from, cliente); return; }
    if (opcao === '4') { await enviarContaRevenda(from, cliente); return; }
    if (opcao === '5') { await tgBot.sendMessage(msg.chat.id, '💳 Para gerar PIX, digite:\n\npagar 50'); return; }
    if (opcao === '6') { await enviarSuporteTelegram(msg.chat.id); return; }
    pedidoSessao.set(from, { etapa: 'menu' });
    await enviarMenuTelegram(msg.chat.id, cliente);
    return;
  }

  if (sess?.etapa === 'esim_escolha' && /^\d+$/.test(opcao)) {
    const planos = await planosEsimDisponiveis();
    const plano = planos[Number(opcao) - 1];
    if (!plano) { await enviarTexto(from, '❌ Plano inválido. Digite menu para começar novamente.'); return; }
    pedidoSessao.set(from, { etapa: 'esim_confirmar', plano });
    await enviarTexto(from, `📱 ${plano.nome_plano}\n\n💰 Valor: ${brl(plano.preco_revenda)}\n💳 Seu saldo: ${brl(cliente.saldo)}\n🏷 Tipo: ${labelTipoRevenda(cliente.tipo_revenda)}\n\n1️⃣ Confirmar compra\n2️⃣ Cancelar`);
    return;
  }

  if (sess?.etapa === 'esim_confirmar') {
    if (opcao === '2' || texto === 'cancelar') { pedidoSessao.delete(from); await enviarTexto(from, '✅ Compra de eSIM cancelada.'); return; }
    if (opcao !== '1') { await enviarTexto(from, 'Digite 1 para confirmar ou 2 para cancelar.'); return; }
    pedidoSessao.delete(from);
    const revAtual = await get('SELECT * FROM revendas WHERE id=?', [cliente.id]);
    await entregarEsimRevenda(from, revAtual || cliente, sess.plano);
    return;
  }

  if (sess?.etapa === 'servico_escolha' && /^\d+$/.test(opcao)) {
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[Number(opcao) - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'entrada', servicoId: servico.id });
    const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
    if (tipoEntrada === 'IMEI') {
      await enviarTexto(from, `📱 Envie os IMEIs\n\n• Máximo 5 IMEIs\n• 1 IMEI por linha\n• Cada IMEI precisa ter 15 números\n\nExemplo:\n353625361425365\n353625361425366`);
    } else {
      await enviarTexto(from, `${iconeEntradaServico(servico)} Informe o ${labelEntradaServico(servico)}:`);
    }
    return;
  }

  if (sess?.etapa === 'entrada') {
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sess.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }
    const validacao = validarEntradaServico(servico, textoOriginal);
    if (!validacao.ok) { await enviarTexto(from, validacao.erro); return; }

    const revAtual = await get('SELECT * FROM revendas WHERE id=?', [cliente.id]);
    const valor = await precoDaRevenda(cliente.id, servico.id);
    const totalPedido = valor * validacao.entradas.length;
    if (isRevendaPrePaga(revAtual || cliente) && Number((revAtual || cliente).saldo || 0) < totalPedido) {
      await enviarTexto(from, textoSaldoInsuficiente(revAtual || cliente, totalPedido, validacao.entradas.length > 1 ? `${servico.nome} (${validacao.entradas.length} itens)` : servico.nome));
      return;
    }

    const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
    const entradaLabel = labelEntradaServico(servico);
    const loteId = validacao.entradas.length > 1 ? `LOTE-${Date.now()}` : null;
    const prePago = isRevendaPrePaga(revAtual || cliente);
    let criados = [];
    let duplicados = [];
    for (const entrada of validacao.entradas) {
      const imeiBanco = tipoEntrada === 'IMEI' ? entrada : null;
      if (tipoEntrada === 'IMEI') {
        const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [entrada]);
        if (duplicado) { duplicados.push(entrada); continue; }
      }
      const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, entrada_valor, tipo_entrada, entrada_label, lote_id, valor, status, cobrado)
        VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?)`, [cliente.id, cliente.nome, from, cliente.telegram_id || String(msg.from.id), servico.id, servico.nome, imeiBanco, entrada, tipoEntrada, entradaLabel, loteId, valor, prePago ? 1 : 0]);
      criados.push({ id: ins.lastID, entrada });
    }

    pedidoSessao.delete(from);
    if (!criados.length) { await enviarTexto(from, `⚠️ Nenhum pedido novo foi criado.${duplicados.length ? `\n\nJá estavam em andamento:\n${duplicados.join('\n')}` : ''}`); return; }
    if (criados.length === 1) {
      notificarPainel('pedido', '🔔 Novo pedido Telegram', `${cliente.nome} - ${servico.nome}`);
      await avisarNovoPedidoAdmins(await get('SELECT * FROM pedidos WHERE id=?', [criados[0].id]));
      await enviarParaCanaisCliente(cliente, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n${iconeEntradaServico(servico)} ${entradaLabel}: ${criados[0].entrada}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`, from);
      return;
    }
    notificarPainel('pedido', '📦 Novo lote Telegram', `${cliente.nome} - ${criados.length} pedidos`);
    await avisarNovoLoteAdmins(cliente, servico, criados.length, valor * criados.length);
    await enviarParaCanaisCliente(cliente, `✅ Lote recebido\n\n🛠 ${servico.nome}\n📦 Pedidos criados: ${criados.length}\n💰 Valor por item: ${brl(valor)}\n💰 Total: ${brl(valor * criados.length)}\n\nCada IMEI virou um pedido separado.${duplicados.length ? `\n\n⚠️ Duplicados ignorados:\n${duplicados.join('\n')}` : ''}`, from);
    return;
  }

  await enviarMenuTelegram(msg.chat.id, cliente);
}


async function cadastrarClienteWhatsApp(numero, nomeInformado='Cliente WhatsApp') {
  const numeroNorm = normalizarNumeroWhatsApp(numero);
  const jid = `wa:${numeroNorm}`;
  let cliente = await get('SELECT * FROM revendas WHERE (jid=? OR whatsapp=?) AND status != "REMOVIDA"', [jid, numeroNorm]);
  if (cliente) return { cliente, novo:false };
  const nome = String(nomeInformado || `Cliente ${numeroNorm}`).trim().slice(0, 80);
  let login = gerarLogin(nome, numeroNorm);
  const existe = await get('SELECT id FROM revendas WHERE login=?', [login]);
  if (existe) login = `${login}${Date.now().toString().slice(-3)}`;
  const senha = gerarSenha(8);
  const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda, limite_credito) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, "PRE_PAGO", 0)', [nome, numeroNorm, jid, login, senha]);
  cliente = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
  notificarPainel('cliente', '👤 Novo cliente WhatsApp', `${nome} - ${numeroNorm}`);
  await avisarAdminTelegram(`👤 Novo cliente cadastrado pelo WhatsApp\n\nNome: ${nome}\nWhatsApp: ${numeroNorm}\nUsuário: ${login}`);
  return { cliente, novo:true };
}

function extrairMensagemWhatsApp(body) {
  const data = body?.data || body;
  const key = data?.key || body?.key || {};
  const msg = data?.message || body?.message || data?.messages?.[0]?.message || {};
  const fromRaw = key?.remoteJid || data?.remoteJid || body?.remoteJid || data?.from || body?.from || data?.sender || '';
  const numero = normalizarNumeroWhatsApp(jidToNumber(fromRaw) || fromRaw);
  const pushName = data?.pushName || body?.pushName || data?.senderName || body?.senderName || 'Cliente WhatsApp';
  const texto = data?.text || body?.text || msg?.conversation || msg?.extendedTextMessage?.text || msg?.buttonsResponseMessage?.selectedDisplayText || msg?.listResponseMessage?.title || '';
  const fromMe = Boolean(key?.fromMe || data?.fromMe || body?.fromMe);
  return { numero, nome: pushName, texto: String(texto || '').trim(), fromMe };
}

function menuWhatsAppTexto() {
  return `👋 Olá! Seja bem-vindo à CentralUnlocker.\n\nComo posso ajudar você hoje?\n\n1️⃣ Serviços\n2️⃣ Comprar eSIM\n3️⃣ Histórico\n4️⃣ Minha conta\n5️⃣ Pagar / Pix\n6️⃣ Suporte\n\nDigite uma opção:`;
}

async function processarMensagemWhatsApp({ numero, nome, texto }) {
  const numeroNorm = normalizarNumeroWhatsApp(numero);
  if (!numeroNorm || !texto) return;
  const from = `wa:${numeroNorm}`;
  const textoOriginal = String(texto || '').trim();
  const lower = textoOriginal.toLowerCase();
  const opcao = normalizarOpcaoTelegram(textoOriginal);
  const { cliente, novo } = await cadastrarClienteWhatsApp(numeroNorm, nome);

  // Código de 6 dígitos gerado no Telegram: vincula as duas contas.
  if (/^\d{6}$/.test(textoOriginal)) {
    const tentativa = await get('SELECT codigo FROM whatsapp_vinculos WHERE codigo=? AND usado=0', [textoOriginal]);
    if (tentativa) {
      try {
        const resultado = await vincularWhatsAppPorCodigo(textoOriginal, numeroNorm, nome);
        if (!resultado.ok) { await enviarTexto(from, `❌ ${resultado.erro}`); return; }
        pedidoSessao.delete(from);
        await enviarTexto(from, `✅ WhatsApp vinculado com sucesso à sua conta do Telegram.\n\nAgora seu saldo, histórico e pedidos são os mesmos nos dois canais.`);
        if (tgBot && resultado.cliente?.telegram_id) {
          await tgBot.sendMessage(String(resultado.cliente.telegram_id), `✅ WhatsApp vinculado com sucesso.

📱 Número: +${numeroNorm}

Agora você pode solicitar serviços pelo Telegram ou WhatsApp usando a mesma conta.`);
        }
        notificarPainel('cliente', '🔗 WhatsApp vinculado', `${resultado.cliente?.nome || nome} - ${numeroNorm}`);
        return;
      } catch (e) {
        console.log('❌ VINCULAR WHATSAPP:', e);
        await enviarTexto(from, '❌ Não foi possível vincular agora. Gere um novo código no Telegram e tente novamente.');
        return;
      }
    }
  }

  // Primeiro contato: cadastro silencioso e menu automático.
  if (novo) {
    pedidoSessao.set(from, { etapa: 'menu' });
    await enviarTexto(from, menuWhatsAppTexto());
    return;
  }

  if (['cancelar', 'sair', 'voltar'].includes(lower)) {
    pedidoSessao.delete(from);
    await enviarTexto(from, '✅ Operação cancelada.\n\nDigite menu para começar novamente.');
    return;
  }

  if (lower === 'menu') {
    pedidoSessao.delete(from);
    pedidoSessao.set(from, { etapa: 'menu' });
    await enviarTexto(from, menuWhatsAppTexto());
    return;
  }

  if (lower.startsWith('pagar') || lower.startsWith('/pagar')) {
    const partes = textoOriginal.split(/\s+/);
    const valor = Number(String(partes[1] || '0').replace(',', '.'));
    if (!valor || valor < 10) { await enviarTexto(from, '❌ Informe um valor mínimo de R$10.\n\nExemplo:\npagar 50'); return; }
    pedidoSessao.set(from, { etapa: 'aguardando_cpf_pix', valor_pix: valor });
    await enviarTexto(from, `📄 Informe o CPF do pagador para gerar o PIX de ${brl(valor)}.\n\nEnvie somente os 11 números.`);
    return;
  }

  let sess = pedidoSessao.get(from);
  if (sess?.etapa === 'aguardando_cpf_pix') {
    const cpf = textoOriginal.replace(/\D/g, '');
    if (cpf.length !== 11) { await enviarTexto(from, '❌ CPF inválido. Envie apenas os 11 números do CPF.'); return; }
    await enviarTexto(from, '⏳ Gerando PIX...');
    const pix = await gerarPix(sess.valor_pix, `WhatsApp ${cliente.nome}`, cpf);
    pedidoSessao.delete(from);
    if (!pix) { await enviarTexto(from, '❌ Erro ao gerar PIX.'); return; }
    const valor = sess.valor_pix;
    const paymentId = pix?.data?.payment_id || pix?.payment_id || pix?.data?.id || pix?.id || pix?.transaction_id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.data?.pix_copy_paste || pix?.qr_code || pix?.copy_paste || pix?.brcode;
    if (paymentId) {
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, valor, status) VALUES (?, ?, ?, ?, ?, "pending")', [paymentId, cliente.id, from, from, valor]);
      verificarPagamento(paymentId, cliente.id, from, valor);
    }
    await enviarTexto(from, `✅ PIX GERADO\n\n💰 Valor: ${brl(valor)}\n\nCopia e cola abaixo:`);
    await enviarTexto(from, qrCode || 'PIX indisponível');
    return;
  }

  sess = pedidoSessao.get(from);
  if (!sess) {
    // Cliente já cadastrado: não abre o menu com mensagens avulsas.
    // Para iniciar, ele precisa digitar a palavra "menu".
    return;
  }

  if (sess?.etapa === 'menu') {
    if (opcao === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarTexto(from, await listarServicosTexto(cliente)); return; }
    if (opcao === '2') { pedidoSessao.set(from, { etapa: 'esim_escolha' }); await enviarListaEsim(from); return; }
    if (opcao === '3') { pedidoSessao.delete(from); await enviarHistoricoRevenda(from, cliente); return; }
    if (opcao === '4') { pedidoSessao.delete(from); await enviarContaRevenda(from, cliente); return; }
    if (opcao === '5') { pedidoSessao.delete(from); await enviarTexto(from, `💳 Para gerar PIX, digite:\n\npagar 50`); return; }
    if (opcao === '6') { pedidoSessao.delete(from); await enviarTexto(from, `🆘 Suporte CentralUnlocker\n\nFale com o suporte pelo Telegram configurado no painel.`); return; }
    await enviarTexto(from, '❌ Opção inválida. Digite um número de 1 a 6 ou escreva menu.');
    return;
  }

  if (sess?.etapa === 'esim_escolha' && /^\d+$/.test(opcao)) {
    const planos = await planosEsimDisponiveis();
    const plano = planos[Number(opcao) - 1];
    if (!plano) { await enviarTexto(from, '❌ Plano inválido. Digite menu para começar novamente.'); return; }
    pedidoSessao.set(from, { etapa: 'esim_confirmar', plano });
    await enviarTexto(from, `📱 ${plano.nome_plano}\n\n💰 Valor: ${brl(plano.preco_revenda)}\n💳 Seu saldo: ${brl(cliente.saldo)}\n\n1️⃣ Confirmar compra\n2️⃣ Cancelar`);
    return;
  }

  if (sess?.etapa === 'esim_confirmar') {
    if (opcao === '2' || lower === 'cancelar') { pedidoSessao.delete(from); await enviarTexto(from, '✅ Compra de eSIM cancelada.'); return; }
    if (opcao !== '1') { await enviarTexto(from, 'Digite 1 para confirmar ou 2 para cancelar.'); return; }
    pedidoSessao.delete(from);
    const revAtual = await get('SELECT * FROM revendas WHERE id=?', [cliente.id]);
    await entregarEsimRevenda(from, revAtual || cliente, sess.plano);
    return;
  }

  if (sess?.etapa === 'servico_escolha' && /^\d+$/.test(opcao)) {
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[Number(opcao) - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'entrada', servicoId: servico.id });
    await enviarTexto(from, `${iconeEntradaServico(servico)} Informe o ${labelEntradaServico(servico)}:`);
    return;
  }

  if (sess?.etapa === 'entrada') {
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sess.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }
    const validacao = validarEntradaServico(servico, textoOriginal);
    if (!validacao.ok) { await enviarTexto(from, validacao.erro); return; }
    const revAtual = await get('SELECT * FROM revendas WHERE id=?', [cliente.id]);
    const valor = await precoDaRevenda(cliente.id, servico.id);
    const totalPedido = valor * validacao.entradas.length;
    if (isRevendaPrePaga(revAtual || cliente) && Number((revAtual || cliente).saldo || 0) < totalPedido) {
      await enviarTexto(from, textoSaldoInsuficiente(revAtual || cliente, totalPedido, validacao.entradas.length > 1 ? `${servico.nome} (${validacao.entradas.length} itens)` : servico.nome));
      return;
    }
    pedidoSessao.delete(from);
    const criados = [];
    for (const entrada of validacao.entradas) {
      const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, entrada_valor, tipo_entrada, entrada_label, valor, status, cobrado) VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', 0)`, [cliente.id, cliente.nome, from, numeroNorm, servico.id, servico.nome, entrada, entrada, normalizarTipoEntrada(servico.tipo_entrada), labelEntradaServico(servico), valor]);
      criados.push({ id: ins.lastID, entrada });
    }
    notificarPainel('pedido', '🔔 Novo pedido WhatsApp', `${cliente.nome} - ${servico.nome}`);
    if (criados.length === 1) await avisarNovoPedidoAdmins(await get('SELECT * FROM pedidos WHERE id=?', [criados[0].id]));
    else await avisarNovoLoteAdmins(cliente, servico, criados.length, totalPedido);
    const entradaLabel = labelEntradaServico(servico);
    const entradaIcone = iconeEntradaServico(servico);
    const detalhesEntradas = criados.length === 1
      ? `${entradaIcone} ${entradaLabel}: ${criados[0].entrada}`
      : `${entradaIcone} ${entradaLabel}s:\n${criados.map(item => item.entrada).join('\n')}`;
    await enviarParaCanaisCliente(cliente, `✅ Pedido recebido\n\n🛠 Serviço: ${servico.nome}\n${detalhesEntradas}\n📦 Quantidade: ${criados.length}\n💰 Total: ${brl(totalPedido)}\n\n📍 Status: PENDENTE`, from);
    return;
  }

  // Mensagem não reconhecida: não repetir aviso automaticamente.
  // O menu já é enviado no primeiro contato e pode ser aberto digitando "menu".
  return;
}

async function iniciarTelegram() {
  await initDB();
  if (!TELEGRAM_BOT_TOKEN || !TelegramBot) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN não configurado. Servidor online apenas com painel.');
    return;
  }
  tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('✅ BOT TELEGRAM INICIADO');
  tgBot.onText(/\/start/, async (msg) => {
    try {
      const { cliente, novo } = await cadastrarClienteTelegram(msg.from);
      if (novo) {
        const texto = `🎉 Bem-vindo à Centralunlocker

Seu cadastro foi criado e vinculado ao Telegram.

🆔 ID Telegram: ${cliente.telegram_id || msg.from.id}
👤 Nome: ${cliente.nome}
🏷 Tipo: ${labelTipoRevenda(cliente.tipo_revenda)}
💰 Saldo: ${brl(cliente.saldo)}

Use o menu abaixo para solicitar serviços, comprar eSIM, consultar histórico, ver sua conta ou gerar PIX.

Todos os avisos dos seus pedidos chegarão aqui no Telegram.`;
        await tgBot.sendMessage(msg.chat.id, texto);
      } else {
        await tgBot.sendMessage(msg.chat.id, `👋 Bem-vindo de volta, ${cliente.nome}!

Escolha uma opção abaixo.`);
      }
      await enviarMenuTelegram(msg.chat.id, cliente);
    } catch(e) { console.log('❌ /start TG:', e); }
  });
  tgBot.onText(/\/senha/, async (msg) => {
    const cliente = await get('SELECT * FROM revendas WHERE telegram_id=? OR jid=?', [String(msg.from.id), tgJid(msg.from.id)]);
    if (!cliente) return tgBot.sendMessage(msg.chat.id, 'Envie /start para criar seu cadastro.');
    await tgBot.sendMessage(msg.chat.id, `👤 Sua conta

🆔 ID Telegram: ${cliente.telegram_id || msg.from.id}
👤 Nome: ${cliente.nome}
🏷 Tipo: ${labelTipoRevenda(cliente.tipo_revenda)}
💰 Saldo: ${brl(cliente.saldo)}

Digite /menu para solicitar serviços pelo Telegram.`);
  });
  tgBot.onText(/\/menu/, async (msg) => {
    const { cliente } = await cadastrarClienteTelegram(msg.from);
    await enviarMenuTelegram(msg.chat.id, cliente);
  });
  tgBot.on('callback_query', async (q) => {
    try {
      const chatId = q.message?.chat?.id;
      const data = String(q.data || '');
      if (!chatId) return;
      // Botões do cliente no Telegram
      const ehBotaoCliente = data.startsWith('menu_') || data.startsWith('servico_') || data.startsWith('pagar_') || /^esim_(\d+|confirmar_\d+|cancelar_compra)$/.test(data);
      if (ehBotaoCliente) {
        const { cliente } = await cadastrarClienteTelegram(q.from);
        const from = tgJid(q.from.id);
        await tgBot.answerCallbackQuery(q.id);

        if (data === 'menu_voltar') {
          pedidoSessao.delete(from);
          return enviarMenuTelegram(chatId, cliente);
        }
        if (data === 'menu_servicos') {
          pedidoSessao.set(from, { etapa: 'servico_escolha' });
          return enviarServicosBotoesTelegram(chatId, cliente);
        }
        if (data === 'menu_esim') {
          pedidoSessao.set(from, { etapa: 'esim_escolha' });
          return enviarEsimBotoesTelegram(chatId);
        }
        if (data === 'menu_historico') {
          pedidoSessao.delete(from);
          return enviarHistoricoRevenda(from, cliente);
        }
        if (data === 'menu_conta') {
          pedidoSessao.delete(from);
          return enviarContaRevenda(from, cliente);
        }
        if (data === 'menu_pagar') {
          pedidoSessao.delete(from);
          return tgBot.sendMessage(chatId, `💳 Para gerar PIX, digite:

pagar 50

Ou escolha um valor:`, {
            reply_markup: { inline_keyboard: [
              [{ text: 'R$ 20', callback_data: 'pagar_20' }, { text: 'R$ 50', callback_data: 'pagar_50' }],
              [{ text: 'R$ 100', callback_data: 'pagar_100' }, { text: '⬅️ Voltar', callback_data: 'menu_voltar' }]
            ] }
          });
        }
        if (data === 'menu_suporte') {
          pedidoSessao.delete(from);
          return enviarSuporteTelegram(chatId);
        }
        if (data === 'menu_vincular_whatsapp') {
          pedidoSessao.delete(from);
          const codigo = await criarCodigoVinculoWhatsApp(cliente);
          return tgBot.sendMessage(chatId, `🔗 *Vincular WhatsApp*

Envie este código para o WhatsApp da CentralUnlocker:

*${codigo}*

⏳ O código é válido por 10 minutos.

O número que enviar o código será vinculado automaticamente à sua conta do Telegram.`, { parse_mode: 'Markdown' });
        }
        if (data.startsWith('pagar_')) {
          const valor = Number(data.replace('pagar_', ''));
          pedidoSessao.set(from, { etapa: 'aguardando_cpf_pix', valor_pix: valor });

          return tgBot.sendMessage(
            chatId,
            `📄 Informe o CPF do pagador para gerar o PIX de ${brl(valor)}.

Somente este CPF poderá efetuar o pagamento do QR Code.`
          );
        }
        const servMatch = data.match(/^servico_(\d+)$/);
        if (servMatch) {
          const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [Number(servMatch[1])]);
          if (!servico) return tgBot.sendMessage(chatId, '❌ Serviço indisponível.', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]] } });
          pedidoSessao.set(from, { etapa: 'entrada', servicoId: servico.id });
          const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
          if (tipoEntrada === 'IMEI') {
            return tgBot.sendMessage(chatId, `📱 Envie os IMEIs

• Máximo 5 IMEIs
• 1 IMEI por linha
• Cada IMEI precisa ter 15 números

Exemplo:
353625361425365
353625361425366`);
          }
          return tgBot.sendMessage(chatId, `${iconeEntradaServico(servico)} Informe o ${labelEntradaServico(servico)}:`);
        }
        const esimMatch = data.match(/^esim_(\d+)$/);
        if (esimMatch && !data.includes('entregar') && !data.includes('finalizar') && !data.includes('cancelar')) {
          const plano = await get(`SELECT p.id, p.nome_plano, p.preco_revenda, p.preco_cliente, COALESCE(SUM(CASE WHEN e.status='DISPONIVEL' THEN 1 ELSE 0 END), 0) AS qtd
            FROM esim_planos p LEFT JOIN esim_estoque e ON e.nome_plano=p.nome_plano AND e.preco_revenda=p.preco_revenda
            WHERE p.id=? AND p.ativo=1 GROUP BY p.id, p.nome_plano, p.preco_revenda, p.preco_cliente`, [Number(esimMatch[1])]);
          if (!plano) return tgBot.sendMessage(chatId, '❌ Plano indisponível.', { reply_markup: { inline_keyboard: [[{ text: '⬅️ Voltar', callback_data: 'menu_voltar' }]] } });
          pedidoSessao.set(from, { etapa: 'esim_confirmar', plano });
          return tgBot.sendMessage(chatId, `📱 ${plano.nome_plano}

💰 Valor: ${brl(plano.preco_revenda)}
💳 Seu saldo: ${brl(cliente.saldo)}
🏷 Tipo: ${labelTipoRevenda(cliente.tipo_revenda)}

Confirmar compra?`, {
            reply_markup: { inline_keyboard: [
              [{ text: '✅ Confirmar compra', callback_data: `esim_confirmar_${plano.id}` }],
              [{ text: '❌ Cancelar', callback_data: 'esim_cancelar_compra' }, { text: '⬅️ Voltar', callback_data: 'menu_esim' }]
            ] }
          });
        }
        const confMatch = data.match(/^esim_confirmar_(\d+)$/);
        if (confMatch) {
          const plano = await get('SELECT * FROM esim_planos WHERE id=? AND ativo=1', [Number(confMatch[1])]);
          if (!plano) return tgBot.sendMessage(chatId, '❌ Plano indisponível.');
          pedidoSessao.delete(from);
          const revAtual = await get('SELECT * FROM revendas WHERE id=?', [cliente.id]);
          return entregarEsimRevenda(from, revAtual || cliente, plano);
        }
        if (data === 'esim_cancelar_compra') {
          pedidoSessao.delete(from);
          return tgBot.sendMessage(chatId, '✅ Compra de eSIM cancelada.', { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu_voltar' }]] } });
        }
        return;
      }

      if (String(q.from?.id) !== String(ADMIN_TELEGRAM_ID || '')) {
        await tgBot.answerCallbackQuery(q.id, { text: 'Apenas o admin pode usar este botão.', show_alert: true });
        return;
      }
      const m = data.match(/^esim_(entregar|finalizar|cancelar)_(\d+)$/);
      if (!m) return;
      const acao = m[1];
      const id = Number(m[2]);
      await tgBot.answerCallbackQuery(q.id);
      if (acao === 'entregar') return iniciarEntregaEsimManualTelegram(chatId, id);
      if (acao === 'finalizar') return finalizarEsimManualSemArquivoTelegram(chatId, id);
      if (acao === 'cancelar') {
        const r = await cancelarPedidoComEstorno(id, 'Cancelado pelo admin no Telegram');
        return tgBot.sendMessage(chatId, r.ok ? `❌ Pedido #${id} cancelado.${r.estornou ? `
💰 Estorno: ${brl(r.valor)}` : ''}` : `❌ ${r.erro || 'Erro ao cancelar.'}`);
      }
    } catch (e) {
      console.log('❌ CALLBACK TG:', e);
      try { await tgBot.answerCallbackQuery(q.id, { text: 'Erro interno.' }); } catch (_) {}
    }
  });
  tgBot.on('message', async (msg) => {
    try { await processarMensagemTelegram(msg); }
    catch (e) {
      console.log('❌ ERRO FLUXO TG:', e);
      try { await tgBot.sendMessage(msg.chat.id, '❌ Erro interno. Tente novamente ou digite /menu.'); } catch (_) {}
    }
  });
}

async function iniciarWhatsAppRemovido() {
  console.log('ℹ️ WhatsApp/Baileys removido. Sistema operando somente via Telegram.');
}


async function tratarWhatsAppLegadoDesativado(msg, from, textoOriginal, texto, admin, nomeContato) {
  const numero = jidToNumber(from);
  const partes = textoOriginal.trim().split(/\s+/);

  // Comandos que limpam qualquer fluxo preso, principalmente aguardando IMEI
  if (['cancelar', 'sair', 'voltar'].includes(texto)) {
    pedidoSessao.delete(from);
    adminSessao.delete(from);
    await enviarTexto(from, '✅ Operação cancelada.\n\nDigite menu para começar novamente.');
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
    try {
      const revendaPix = await getRevendaByMsg(msg, from);

      if (paymentId) {
        await run(
          'INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, cliente_jid, valor, status) VALUES (?, ?, ?, ?, ?, "pending")',
          [paymentId, revendaPix?.id || null, revendaPix ? from : null, from, valor]
        );

        verificarPagamento(paymentId, revendaPix?.id || null, from, valor);
      }
    } catch (e) {
      console.log('⚠️ ERRO PÓS-PIX:', e.message);
    }

    return;
  }

  if (admin) {
    // Entrega manual de eSIM pelo Telegram admin.
    const sessAdmin = adminSessao.get(from);
    if (sessAdmin?.etapa === 'entregar_esim_manual') {
      await concluirEntregaEsimManualAdmin(from, msg, textoOriginal);
      return;
    }
    if (['/esimpendentes', 'esimpendentes', '/pendentesesim', 'pendentesesim'].includes(texto)) {
      await listarEsimManuaisAdmin(from);
      return;
    }
    if (texto.startsWith('botão 📤 Enviar QR Code') || texto.startsWith('entregaresim')) {
      const id = partes[1];
      if (!id) { await enviarTexto(from, 'Use o botão 📤 Enviar QR Code no Telegram do admin.'); return; }
      await iniciarEntregaEsimManualAdmin(from, Number(id));
      return;
    }

    // Cadastro de cliente/revenda pelo Telegram
    if (await tratarCadastroRevendaConversa(from, textoOriginal, texto)) return;

    // Fluxo antigo por WhatsApp removido. Use o Telegram e o painel administrativo.
    if (texto === 'backup') {
      const arq = await criarBackup();
      await enviarTexto(from, `✅ BACKUP GERADO

📁 ${path.basename(arq)}

🏢 CentralUnlocker`);
      return;
    }
    if (await tratarServicoClienteFinal(msg, from, textoOriginal, texto, nomeContato)) return;
  }

  // menu/servicos/historico/conta sempre limpam fluxo anterior antes de validar revenda
  if (['menu', 'servicos', '/servicos', 'historico', '/historico', 'conta', '/conta', 'saldo', '/saldo'].includes(texto)) {
    pedidoSessao.delete(from);
  }

  const revenda = await getRevendaByMsg(msg, from);
  if (!revenda) {
    if (texto === 'menu' || texto === 'servicos' || texto === 'historico' || texto === 'conta') {
      await enviarTexto(from, '❌ Número não cadastrado como revenda.');
    }
    return;
  }

  // atualiza jid se mudou
  if (revenda.jid !== from) await run('UPDATE revendas SET jid=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [from, revenda.id]);

  if (texto === 'menu') {
    pedidoSessao.delete(from);
    pedidoSessao.set(from, { etapa: 'menu' });
    await enviarTexto(from, `🏪 *${revenda.nome}*\n\n1️⃣ Serviços\n2️⃣ Comprar eSIM\n3️⃣ Histórico\n4️⃣ Conta\n\nDigite uma opção:`);
    return;
  }

  if (texto === 'servicos' || texto === '/servicos') {
    pedidoSessao.set(from, { etapa: 'servico_escolha' });
    await enviarTexto(from, await listarServicosTexto(revenda));
    return;
  }

  if (texto === 'historico' || texto === '/historico') { await enviarHistoricoRevenda(from, revenda); return; }
  if (texto === 'conta' || texto === '/conta' || texto === 'saldo' || texto === '/saldo') { await enviarContaRevenda(from, revenda); return; }

  sess = pedidoSessao.get(from);
  if (sess?.etapa === 'menu') {
    if (texto === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarTexto(from, await listarServicosTexto(revenda)); return; }
    if (texto === '2') { pedidoSessao.set(from, { etapa: 'esim_escolha' }); await enviarListaEsim(from); return; }
    if (texto === '3') { pedidoSessao.delete(from); await enviarHistoricoRevenda(from, revenda); return; }
    if (texto === '4') { pedidoSessao.delete(from); await enviarContaRevenda(from, revenda); return; }
  }

  if (sess?.etapa === 'esim_escolha' && /^\d+$/.test(texto)) {
    const planos = await planosEsimDisponiveis();
    const plano = planos[Number(texto) - 1];
    if (!plano) { await enviarTexto(from, '❌ Plano inválido. Digite menu para começar novamente.'); return; }
    pedidoSessao.set(from, { etapa: 'esim_confirmar', plano });
    await enviarTexto(from, `📱 *${plano.nome_plano}*

💰 Valor: ${brl(plano.preco_revenda)}
💳 Seu saldo: ${brl(revenda.saldo)}
🏷 Tipo: ${labelTipoRevenda(revenda.tipo_revenda)}

1️⃣ Confirmar compra
2️⃣ Cancelar`);
    return;
  }

  if (sess?.etapa === 'esim_confirmar') {
    if (texto === '2' || texto === 'cancelar') { pedidoSessao.delete(from); await enviarTexto(from, '✅ Compra de eSIM cancelada.'); return; }
    if (texto !== '1') { await enviarTexto(from, 'Digite 1 para confirmar ou 2 para cancelar.'); return; }
    const plano = sess.plano;
    pedidoSessao.delete(from);
    await entregarEsimRevenda(from, revenda, plano);
    return;
  }

  if (sess?.etapa === 'servico_escolha' && /^\d+$/.test(texto)) {
    const pos = Number(texto);
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[pos - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'entrada', servicoId: servico.id });
    const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
    if (tipoEntrada === 'IMEI') {
      await enviarTexto(from, `📱 Informe o IMEI:

Pode enviar de 1 até 5 IMEIs. O sistema corrige automaticamente espaços, pontos, traços e símbolos.`);
    } else {
      await enviarTexto(from, `${iconeEntradaServico(servico)} Informe o ${labelEntradaServico(servico)}:`);
    }
    return;
  }

  if (sess?.etapa === 'entrada' || sess?.etapa === 'imei') {
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sess.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }

    const validacao = validarEntradaServico(servico, textoOriginal);
    if (!validacao.ok) {
      const agora = Date.now();
      const ultima = ultimoErroImei.get(from) || 0;
      if (agora - ultima > 15000) {
        ultimoErroImei.set(from, agora);
        await enviarTexto(from, validacao.erro);
      }
      return;
    }

    const valor = await precoDaRevenda(revenda.id, servico.id);
    const totalPedido = valor * validacao.entradas.length;
    if (isRevendaPrePaga(revenda) && Number(revenda.saldo || 0) < totalPedido) {
      await enviarTexto(from, textoSaldoInsuficiente(revenda, totalPedido, validacao.entradas.length > 1 ? `${servico.nome} (${validacao.entradas.length} itens)` : servico.nome));
      return;
    }
    const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
    const entradaLabel = labelEntradaServico(servico);
    const loteId = validacao.entradas.length > 1 ? `LOTE-${Date.now()}` : null;
    const prePago = isRevendaPrePaga(revenda);
    let criados = [];
    let duplicados = [];

    for (const entrada of validacao.entradas) {
      const imeiBanco = tipoEntrada === 'IMEI' ? entrada : null;
      if (tipoEntrada === 'IMEI') {
        const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [entrada]);
        if (duplicado) { duplicados.push(entrada); continue; }
      }
      const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, entrada_valor, tipo_entrada, entrada_label, lote_id, valor, status, cobrado)
        VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?)`, [revenda.id, revenda.nome, from, revenda.whatsapp || numero, servico.id, servico.nome, imeiBanco, entrada, tipoEntrada, entradaLabel, loteId, valor, prePago ? 1 : 0]);
      criados.push({ id: ins.lastID, entrada });
    }

    if (prePago && criados.length) {
      await run('UPDATE revendas SET saldo=saldo-?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [valor * criados.length, revenda.id]);
    }

    pedidoSessao.delete(from);

    if (!criados.length) {
      await enviarTexto(from, `⚠️ Nenhum pedido novo foi criado.${duplicados.length ? `\n\nJá estavam em andamento:\n${duplicados.join('\n')}` : ''}`);
      return;
    }

    if (criados.length === 1) {
      notificarPainel('pedido', '🔔 Novo pedido recebido', `${revenda.nome} - ${servico.nome}`);
      await avisarNovoPedidoAdmins(await get('SELECT * FROM pedidos WHERE id=?', [criados[0].id]));
      await enviarParaCanaisCliente(revenda, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n${iconeEntradaServico(servico)} ${entradaLabel}: ${criados[0].entrada}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`, from);
      return;
    }

    notificarPainel('pedido', '📦 Novo lote recebido', `${revenda.nome} - ${criados.length} pedidos`);
    await avisarNovoLoteAdmins(revenda, servico, criados.length, valor * criados.length);
    await enviarParaCanaisCliente(revenda, `✅ Lote recebido\n\n🛠 ${servico.nome}\n📦 Pedidos criados: ${criados.length}\n💰 Valor por item: ${brl(valor)}\n💰 Total: ${brl(valor * criados.length)}\n\nCada IMEI virou um pedido separado e será avisado de 1 em 1 quando finalizar.${duplicados.length ? `\n\n⚠️ Duplicados ignorados:\n${duplicados.join('\n')}` : ''}`, from);
    return;
  }

}

async function tratarServicoClienteFinal(msg, from, textoOriginal, texto, nomeContato) {
  if (!texto.startsWith('servico ')) return false;
  const partes = textoOriginal.trim().split(/\s+/);
  const imei = onlyDigits(partes[partes.length - 1]);
  const valor = Number(String(partes[partes.length - 2] || '').replace(',', '.'));
  const nomeServico = partes.slice(1, -2).join(' ').trim();
  if (!nomeServico || !valor || !/^\d{15}$/.test(imei)) {
    await enviarTexto(from, '❌ Formato inválido.\n\nUse:\nservico desbloqueio tim 180 356789123456789');
    return true;
  }
  const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
  if (duplicado) { await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return true; }
  let servico = await get('SELECT * FROM servicos_catalogo WHERE lower(nome)=lower(?)', [nomeServico]);
  if (!servico) {
    const ins = await run("INSERT INTO servicos_catalogo (nome, preco_padrao, tipo_entrada, entrada_label, ativo) VALUES (?, ?, 'IMEI', 'IMEI', 1)", [nomeServico, valor]);
    servico = await get('SELECT * FROM servicos_catalogo WHERE id=?', [ins.lastID]);
  }
  const clienteJid = melhorJidCliente(msg, from);
  const clienteNumero = jidToNumber(clienteJid);
  const clienteNome = nomeContatoSeguro(msg, nomeContato || 'Cliente');

  await run(`INSERT INTO pedidos (tipo, cliente_nome, cliente_whatsapp, cliente_jid, servico_id, servico_nome, imei, entrada_valor, tipo_entrada, entrada_label, valor, status)
    VALUES ('CLIENTE', ?, ?, ?, ?, ?, ?, ?, 'IMEI', 'IMEI', ?, 'PENDENTE')`, [clienteNome || 'Cliente', clienteNumero, clienteJid, servico.id, servico.nome, imei, imei, valor]);

  notificarPainel('pedido', '🔔 Pedido cliente final', `${clienteNome || 'Cliente'} - ${servico.nome}`);
  const pedidoCriado = await get('SELECT * FROM pedidos WHERE id=(SELECT MAX(id) FROM pedidos)');
  if (pedidoCriado) await avisarNovoPedidoAdmins(pedidoCriado);
  await enviarTexto(from, `✅ Serviço cadastrado

🛠 ${servico.nome}
📱 ${imei}
💰 ${brl(valor)}

👤 Cliente: ${clienteNome || 'Cliente'}
🆔 Telegram: ${clienteNumero || '-'}

📍 Pendente`);
  return true;
}


async function planosEsimDisponiveis() {
  // Lista todos os planos cadastrados; se não tiver QR disponível, fica como entrega manual.
  return await all(`
    SELECT
      p.id,
      p.nome_plano,
      p.preco_revenda,
      p.preco_cliente,
      COALESCE(SUM(CASE WHEN e.status='DISPONIVEL' THEN 1 ELSE 0 END), 0) AS qtd
    FROM esim_planos p
    LEFT JOIN esim_estoque e
      ON e.nome_plano = p.nome_plano
     AND e.preco_revenda = p.preco_revenda
    WHERE p.ativo=1
    GROUP BY p.id, p.nome_plano, p.preco_revenda, p.preco_cliente
    ORDER BY p.nome_plano ASC
  `);
}
async function enviarListaEsim(from) {
  const planos = await planosEsimDisponiveis();
  if (!planos.length) { await enviarTexto(from, '❌ Nenhum plano eSIM cadastrado no momento.'); return; }
  let txt = '📱 *eSIM DISPONÍVEIS*\n\n';
  planos.forEach((p, i) => {
    const qtd = Number(p.qtd || 0);
    const entrega = qtd > 0 ? `📦 ${qtd} QR disponível${qtd > 1 ? 's' : ''}` : '📦 Sem QR no estoque\n👨‍💻 Entrega manual pelo admin';
    txt += `${i + 1}️⃣ ${p.nome_plano}\n💰 ${brl(p.preco_revenda)}\n${entrega}\n\n`;
  });
  txt += 'Toque no plano desejado abaixo.';
  await enviarTexto(from, txt.trim());
}

async function criarPedidoEsimManualRevenda(from, revenda, plano) {
  const valor = Number(plano.preco_revenda || 0);
  if (isRevendaPrePaga(revenda) && Number(revenda.saldo || 0) < valor) {
    await enviarTexto(from, textoSaldoInsuficiente(revenda, valor, `eSIM ${plano.nome_plano}`));
    return;
  }

  const ins = await run(`INSERT INTO pedidos
    (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_nome, entrada_valor, tipo_entrada, entrada_label, valor, status, cobrado)
    VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, 'OUTRO', 'eSIM Manual', ?, 'PENDENTE', 1)`,
    [revenda.id, revenda.nome, from, revenda.whatsapp || jidToNumber(from), `eSIM ${plano.nome_plano}`, plano.nome_plano, valor]);

  await run('UPDATE revendas SET saldo=saldo-?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [valor, revenda.id]);
  const revAtual = await get('SELECT * FROM revendas WHERE id=?', [revenda.id]);
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [ins.lastID]);

  notificarPainel('esim', '📱 eSIM manual pendente', `${revenda.nome} - ${plano.nome_plano}`);
  await avisarNovoPedidoAdmins(pedido, `\n📱 *Entrega manual eSIM*\nPedido aguardando QR Code. Use os botões enviados no Telegram do admin ou abra o painel administrativo.`);
  await avisarEsimManualAdminTelegram(pedido);

  await enviarTexto(from, `✅ Compra aprovada

📱 ${plano.nome_plano}
💰 Valor: ${brl(valor)}

💳 Situação da conta:
${textoSituacaoSaldo(revAtual?.saldo || 0)}

👨‍💻 *Entrega manual*
O estoque automático de QR acabou.
Seu pedido ficou pendente para o admin enviar o QR.

🆔 Pedido #${pedido.id}`);
}

async function entregarEsimRevenda(from, revenda, plano) {
  const item = await get(`SELECT * FROM esim_estoque WHERE status='DISPONIVEL' AND nome_plano=? AND preco_revenda=? ORDER BY id ASC LIMIT 1`, [plano.nome_plano, plano.preco_revenda]);

  // Sem QR no estoque: cria pedido manual em vez de bloquear a venda.
  if (!item) {
    await criarPedidoEsimManualRevenda(from, revenda, plano);
    return;
  }

  const valor = Number(item.preco_revenda || 0);
  if (isRevendaPrePaga(revenda) && Number(revenda.saldo || 0) < valor) {
    await enviarTexto(from, textoSaldoInsuficiente(revenda, valor, `eSIM ${item.nome_plano}`));
    return;
  }
  const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_nome, entrada_valor, tipo_entrada, entrada_label, valor, status, cobrado, finalizado_em)
    VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, 'OUTRO', 'eSIM', ?, 'FINALIZADO', 1, CURRENT_TIMESTAMP)`,
    [revenda.id, revenda.nome, from, revenda.whatsapp || jidToNumber(from), `eSIM ${item.nome_plano}`, item.nome_plano, valor]);
  await run('UPDATE revendas SET saldo=saldo-?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [valor, revenda.id]);
  await run(`UPDATE esim_estoque SET status='VENDIDO', revenda_id=?, revenda_nome=?, pedido_id=?, vendido_em=CURRENT_TIMESTAMP WHERE id=?`, [revenda.id, revenda.nome, ins.lastID, item.id]);
  const revAtual = await get('SELECT * FROM revendas WHERE id=?', [revenda.id]);
  notificarPainel('esim', '📱 eSIM vendido', `${revenda.nome} - ${item.nome_plano}`);
  const pedidoAuto = await get('SELECT * FROM pedidos WHERE id=?', [ins.lastID]);
  await avisarEsimAutomaticoAdminTelegram(pedidoAuto, item);
  const qrPath = caminhoArquivoEsim(item.arquivo_qr);
  await enviarTexto(from, `✅ Compra aprovada\n\n📱 ${item.nome_plano}\n💰 Valor: ${brl(valor)}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(revAtual?.saldo || 0)}\n\n📷 QR Code enviado abaixo.`);
  if (fs.existsSync(qrPath)) await enviarImagem(from, qrPath, `📱 eSIM ${item.nome_plano}\n⚠️ QR Code de uso único.`);
  await enviarTexto(from, mensagemInstrucaoEsim());
}


async function iniciarEntregaEsimManualTelegram(chatId, pedidoId) {
  const p = await get(`SELECT * FROM pedidos WHERE id=? AND entrada_label='eSIM Manual'`, [pedidoId]);
  if (!p) return tgBot.sendMessage(chatId, '❌ Pedido eSIM manual não encontrado.');
  if (p.status === 'FINALIZADO' || p.status === 'CANCELADO') return tgBot.sendMessage(chatId, `❌ Pedido #${p.id} está ${p.status}.`);
  adminSessao.set(tgJid(chatId), { etapa: 'entregar_esim_manual_tg', pedido_id: p.id });
  await tgBot.sendMessage(chatId, `📤 Entregar eSIM manual

Pedido #${p.id}
👤 ${p.revenda_nome || p.cliente_nome || '-'}
📱 ${p.entrada_valor || p.servico_nome || '-'}

Envie agora a foto do QR Code, documento ou texto da entrega.

Para cancelar, digite cancelar.`);
}

async function concluirEntregaEsimManualTelegram(chatId, msg) {
  const from = tgJid(chatId);
  const sess = adminSessao.get(from);
  const p = await get(`SELECT * FROM pedidos WHERE id=? AND entrada_label='eSIM Manual'`, [sess?.pedido_id]);
  if (!p) {
    adminSessao.delete(from);
    return tgBot.sendMessage(chatId, '❌ Pedido eSIM manual não encontrado.');
  }
  const destino = p.revenda_jid || p.cliente_jid || (p.revenda_numero ? numberToJid(p.revenda_numero) : null);
  if (!destino) return tgBot.sendMessage(chatId, '❌ Não encontrei o Telegram/contato do cliente para entregar.');

  const textoMsg = String(msg.caption || msg.text || '').trim();
  const textoEntrega = textoMsg || `📱 eSIM ${p.entrada_valor || p.servico_nome}
⚠️ QR Code de uso único.`;
  const arq = await salvarArquivoTelegramEmEsim(msg);

  if (arq?.filePath) await enviarImagem(destino, arq.filePath, textoEntrega);
  else await enviarTexto(destino, textoEntrega);
  await enviarTexto(destino, mensagemInstrucaoEsim());

  await run(`UPDATE pedidos SET status='FINALIZADO', finalizado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=?`, [p.id]);
  adminSessao.delete(from);
  notificarPainel('esim', '✅ eSIM manual entregue', `Pedido #${p.id} - ${p.revenda_nome || '-'}`);
  await tgBot.sendMessage(chatId, `✅ Pedido #${p.id} entregue e finalizado.`);
}

async function finalizarEsimManualSemArquivoTelegram(chatId, pedidoId) {
  const p = await get(`SELECT * FROM pedidos WHERE id=? AND entrada_label='eSIM Manual'`, [pedidoId]);
  if (!p) return tgBot.sendMessage(chatId, '❌ Pedido eSIM manual não encontrado.');
  if (p.status === 'FINALIZADO' || p.status === 'CANCELADO') return tgBot.sendMessage(chatId, `❌ Pedido #${p.id} está ${p.status}.`);
  await finalizarPedido(p);
  notificarPainel('esim', '✅ eSIM manual finalizado', `Pedido #${p.id}`);
  await tgBot.sendMessage(chatId, `✅ Pedido #${p.id} finalizado.`);
}

async function listarEsimManuaisAdmin(from) {
  const rows = await all(`SELECT * FROM pedidos
    WHERE entrada_label='eSIM Manual' AND status IN ('PENDENTE','PROCESSO')
    ORDER BY id ASC LIMIT 30`);
  if (!rows.length) return enviarTexto(from, '✅ Nenhum eSIM manual pendente.');
  let txt = '📱 *eSIM MANUAL PENDENTE*\n\n';
  for (const p of rows) {
    txt += `#${p.id}\n🏪 ${p.revenda_nome || '-'}\n📱 ${p.entrada_valor || p.servico_nome || '-'}\n💰 ${brl(p.valor)}\n➡️ Entregar pelo painel ou Telegram admin\n\n`;
  }
  await enviarTexto(from, txt.trim());
}

async function iniciarEntregaEsimManualAdmin(from, pedidoId) {
  const p = await get(`SELECT * FROM pedidos WHERE id=? AND entrada_label='eSIM Manual'`, [pedidoId]);
  if (!p) return enviarTexto(from, '❌ Pedido eSIM manual não encontrado.');
  if (p.status === 'FINALIZADO' || p.status === 'CANCELADO') return enviarTexto(from, `❌ Pedido #${p.id} está ${p.status}.`);
  adminSessao.set(from, { etapa: 'entregar_esim_manual', pedido_id: p.id });
  await enviarTexto(from, `📤 *Entregar eSIM manual*

Pedido #${p.id}
🏪 ${p.revenda_nome || '-'}
📱 ${p.entrada_valor || p.servico_nome || '-'}
🆔 ${p.revenda_jid || '-'}

Envie agora a foto do QR Code ou texto da entrega.
Para cancelar, digite *cancelar*.`);
}

async function concluirEntregaEsimManualAdmin(from, msg, textoOriginal) {
  const sess = adminSessao.get(from);
  const p = await get(`SELECT * FROM pedidos WHERE id=? AND entrada_label='eSIM Manual'`, [sess.pedido_id]);
  if (!p) {
    adminSessao.delete(from);
    return enviarTexto(from, '❌ Pedido eSIM manual não encontrado.');
  }

  const destino = p.revenda_jid || numberToJid(p.revenda_numero);
  if (!destino) return enviarTexto(from, '❌ Não encontrei o Telegram do cliente para entregar.');

  const img = await salvarImagemWhatsAppEmEsim(msg);
  const textoEntrega = String(textoOriginal || '').trim() || `📱 eSIM ${p.entrada_valor || p.servico_nome}\n⚠️ QR Code de uso único.`;

  if (img?.filePath) {
    await enviarImagem(destino, img.filePath, textoEntrega);
  } else {
    await enviarTexto(destino, textoEntrega);
  }
  await enviarTexto(destino, mensagemInstrucaoEsim());

  await run(`UPDATE pedidos SET status='FINALIZADO', finalizado_em=CURRENT_TIMESTAMP WHERE id=?`, [p.id]);
  adminSessao.delete(from);
  notificarPainel('esim', '✅ eSIM manual entregue', `Pedido #${p.id} - ${p.revenda_nome || '-'}`);
  await enviarTexto(from, `✅ Pedido #${p.id} entregue para ${p.revenda_nome || p.revenda_numero}.`);
}
function mensagemInstrucaoEsim() {
  return `📋 *COMO INSTALAR O eSIM*\n\n*iPhone*\n1️⃣ Ajustes\n2️⃣ Celular\n3️⃣ Adicionar eSIM\n4️⃣ Usar QR Code\n5️⃣ Escaneie a imagem enviada\n\n*Android*\n1️⃣ Configurações\n2️⃣ Rede e Internet\n3️⃣ SIM Cards\n4️⃣ Adicionar eSIM\n5️⃣ Escaneie a imagem enviada\n\n⚠️ *IMPORTANTE*\n• QR Code de uso único\n• Necessário internet para ativação\n• Não compartilhe o QR Code\n\n🏢 CentralUnlocker`;
}

async function enviarHistoricoRevenda(from, revenda) {
  const rows = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 10', [revenda.id]);
  if (!rows.length) { await enviarTexto(from, '📋 Nenhum pedido encontrado.'); return; }
  let txt = `📋 *HISTÓRICO*\n\n`;
  for (const p of rows) txt += `🛠 ${p.servico_nome}\n📱 ${p.imei}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function enviarContaRevenda(from, revenda) {
  await enviarTexto(from, `💳 *CONTA*\n\n🏪 ${revenda.nome}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(revenda.saldo)}\n\nPara gerar PIX digite:\n*pagar valor*\n\nExemplos:\npagar 100\npagar 420`);
}


async function mensagemBoasVindasRevenda(revenda) {
  return `🎉 *BEM-VINDO À CENTRALUNLOCKER*

Olá, *${revenda.nome}*!

Sua revenda foi cadastrada e ativada com sucesso.

Para começar, digite:

*menu*

🏢 CentralUnlocker`;
}
async function mensagemTutorialRevenda() {
  return `📚 *TUTORIAL RÁPIDO*

Digite:

*menu*

Você verá:

1️⃣ Serviços
2️⃣ Comprar eSIM
3️⃣ Histórico
4️⃣ Conta

🔹 *Solicitar serviço*
menu → 1 Serviços → escolha o serviço → envie o IMEI, Lock Code ou a informação solicitada

📦 Para serviço tipo IMEI, pode enviar vários IMEIs de uma vez, um por linha

🔹 *Ver histórico*
menu → 2 Histórico

🔹 *Ver conta*
menu → 3 Conta

🔹 *Gerar PIX*
Digite:

*pagar valor*

Exemplo:
*pagar 100*

🏢 CentralUnlocker`;
}
function destinoRevenda(revenda) {
  if (!revenda) return '';
  if (revenda.jid) return revenda.jid;
  if (revenda.telegram_id) return tgJid(revenda.telegram_id);
  const w = normalizarNumeroWhatsApp(revenda.whatsapp);
  return w ? numberToJid(w) : '';
}

async function enviarBoasVindasTutorialRevenda(revenda) {
  const jid = destinoRevenda(revenda);
  if (!jid) return false;
  try {
    const acesso = `✅ *CADASTRO ATIVO*

🆔 ID Telegram: ${revenda.telegram_id || '-'}
👤 Nome: ${revenda.nome || '-'}
🏷 Tipo: ${labelTipoRevenda(revenda.tipo_revenda)}
💰 Saldo: ${brl(revenda.saldo || 0)}

Agora os serviços são solicitados diretamente pelo Telegram.
Digite /menu para começar.

Todos os avisos serão enviados aqui no Telegram.`;
    await enviarTexto(jid, await mensagemBoasVindasRevenda(revenda));
    await enviarTexto(jid, acesso);
    await enviarTexto(jid, await mensagemTutorialRevenda());
    return true;
  } catch (e) {
    console.log('❌ ERRO BOAS-VINDAS:', e.message);
    return false;
  }
}


async function cadastrarRevendaPelaConversaAdmin(conversaJid, textoOriginal) {
  const numeroRevenda = jidToNumber(conversaJid);
  let nome = String(textoOriginal || '').replace(/^(cadastrar|ativar)\s+revenda\s*/i, '').trim();

  if (!numeroRevenda || !/^55\d{10,11}$/.test(numeroRevenda)) {
    await enviarTexto(conversaJid, '❌ Não consegui identificar o número desta conversa. Abra a conversa privada da revenda e envie:\n\ncadastrar revenda Nome da Revenda');
    return null;
  }

  if (!nome) nome = `Revenda ${numeroRevenda.slice(-4)}`;

  // Cadastra usando o próprio número/JID da conversa onde o admin digitou o comando.
  return await cadastrarRevendaDireto(conversaJid, nome, numeroRevenda);
}

async function cadastrarRevendaDireto(from, nome, whatsapp) {
  nome = String(nome || '').trim();
  const w = normalizarNumeroWhatsApp(whatsapp);
  if (!nome || nome.length < 2) {
    await enviarTexto(from, '❌ Nome inválido. Envie o nome da revenda.');
    return null;
  }
  if (!w || !/^55\d{10,11}$/.test(w)) {
    await enviarTexto(from, '❌ Número inválido. Envie com DDD.\n\nExemplo:\n75999999999\nou\n5575999999999');
    return null;
  }

  const jid = numberToJid(w);
  let revenda = await get('SELECT * FROM revendas WHERE whatsapp=? OR jid=?', [w, jid]);

  if (revenda) {
    await run('UPDATE revendas SET nome=?, whatsapp=?, jid=?, status="ATIVA", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [nome, w, jid, revenda.id]);
    revenda = await get('SELECT * FROM revendas WHERE id=?', [revenda.id]);
  } else {
    const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, ?)', [nome, w, jid, `rev${Date.now()}`, 'sem-senha', 'POS_PAGO']);
    revenda = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
  }

  notificarPainel('revenda', '🏪 Revenda cadastrada', revenda.nome);
  await enviarTexto(from, `✅ *REVENDA CADASTRADA*\n\n🏪 Nome: ${revenda.nome}\n🆔 Telegram: ${revenda.whatsapp}\n🆔 ID: #${revenda.id}\n📍 Status: ${revenda.status}\n\nO bot vai enviar as boas-vindas para a revenda agora.`);
  const enviado = await enviarBoasVindasTutorialRevenda(revenda);
  if (!enviado) await enviarTexto(from, '⚠️ Revenda salva, mas não consegui enviar mensagem para ela. Peça para ela mandar uma mensagem para o bot primeiro e reenvie as boas-vindas pelo painel.');
  return revenda;
}

async function tratarCadastroRevendaConversa(from, textoOriginal, texto) {
  const sess = adminSessao.get(from);

  // Formato rápido em uma linha:
  // addrevenda Nome | 5575999999999
  // cadastrar revenda Nome | 5575999999999
  const rapido = textoOriginal.match(/^(?:addrevenda|cadastrar\s+revenda)\s+(.+?)\s*\|\s*([+\d\s().-]+)$/i);
  if (rapido) {
    adminSessao.delete(from);
    await cadastrarRevendaDireto(from, rapido[1], rapido[2]);
    return true;
  }

  if (['cadastrar revenda', 'cadastro revenda', 'nova revenda', 'addrevenda'].includes(texto)) {
    pedidoSessao.delete(from);
    adminSessao.set(from, { etapa: 'cadastro_revenda_nome' });
    await enviarTexto(from, `🏪 *CADASTRAR REVENDA*\n\nEnvie o *nome da revenda*.\n\nExemplo:\nJoão Unlock\n\nPara cancelar, digite *cancelar*.`);
    return true;
  }

  if (sess?.etapa === 'cadastro_revenda_nome') {
    const nome = textoOriginal.trim();
    if (nome.length < 2) {
      await enviarTexto(from, '❌ Nome muito curto. Envie o nome da revenda.');
      return true;
    }
    adminSessao.set(from, { etapa: 'cadastro_revenda_numero', nome });
    await enviarTexto(from, `✅ Nome salvo: *${nome}*\n\nAgora envie o ID do Telegram do cliente/revenda.\n\nExemplo:\n5319809013`);
    return true;
  }

  if (sess?.etapa === 'cadastro_revenda_numero') {
    await cadastrarRevendaDireto(from, sess.nome, textoOriginal);
    adminSessao.delete(from);
    return true;
  }

  return false;
}

async function tratarAdminTelegramLegado(from, textoOriginal, texto, nomeContato) {
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
  if (opcao === '2') { await enviarTexto(from, `📋 *PEDIDOS*\n\nComandos:\npendentes\nprocesso\nfinalizados\ncancelados\nimei 356789123456789\nprocessar ID\nfinalizar ID\ncancelar ID motivo
/esimpendentes
Botão 📤 Enviar QR Code`); return; }
  if (opcao === '3') { await enviarTexto(from, `🏪 *REVENDAS*\n\nComandos:\nrevendas\nrevenda nome\naddrevenda Nome | 5575999999999\nbloquearrevenda ID\ndesbloquearrevenda ID\nremoverrevenda ID`); return; }
  if (opcao === '4') { await enviarTexto(from, `🛠 *SERVIÇOS*\n\nComandos:\nservicos\naddservico Nome | 100\neditarservico ID | Novo Nome | 100\ndesativarservico ID\nativarservico ID\nexcluirservico ID`); return; }
  if (opcao === '5') { await enviarTexto(from, await resumoFinanceiro()); return; }
  if (opcao === '6') { await enviarTexto(from, `📈 *RELATÓRIOS*\n\nrelatorio diario\nrelatorio mensal\nrelatorio anual\nhoje`); return; }
  if (opcao === '7') { await enviarTexto(from, `💾 *BACKUP*\n\nbackup\nbackups\n\nNo painel você também pode baixar/restaurar.`); return; }
  if (opcao === '8') { await enviarTexto(from, `⚙️ *CONFIGURAÇÕES*\n\nAdmin: ${ADMIN_NUMBER}\nDB: ${DB_PATH}\nStatus Telegram: ${conectado ? 'Conectado' : 'Desconectado'}`); return; }
  if (opcao === '9') { await enviarTexto(from, `🌐 Painel Web:\n${BASE_URL ? BASE_URL + '/admin' : '/admin'}`); return; }
}

async function textoDashboardAdmin() {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const c = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="CANCELADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas WHERE status="ATIVA"');
  const hoje = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos WHERE date(criado_em)=date("now")');
  return `📊 *DASHBOARD*\n\n🟡 Pendentes: ${p.qtd}\n🔄 Em Processo: ${ep.qtd}\n✅ Finalizados: ${f.qtd}\n❌ Cancelados: ${c.qtd}\n\n💰 Recebido hoje: ${brl(hoje.total)}\n💳 Balanço revendas: ${brl(saldo.total)}`;
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
  for (const p of rows) txt += `#${p.id}\n📱 ${p.imei}\n🛠 ${p.servico_nome}\n👤 ${p.revenda_nome || p.cliente_nome || '-'}\n🆔 ${p.revenda_jid || p.cliente_jid || '-'}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
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
  for (const r of rows) txt += `#${r.id}\n${r.nome}\n🆔 ${r.telegram_id || r.jid || '-'}\n📍 ${r.status}\n💰 ${textoSaldoCurto(r.saldo)}\n\n`;
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
  notificarPainel('finalizado', '✅ Pedido finalizado', `Pedido #${id}`);
  await enviarTexto(from, `✅ Pedido #${id} finalizado.`);
}
async function cancelarPedidoComEstorno(id, motivo = 'Não informado') {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  if (!pedido) return { ok:false, erro:'Pedido não encontrado' };

  if (pedido.status === 'CANCELADO') {
    return { ok:true, pedido, jaCancelado:true, estornou:false };
  }

  const valor = Number(pedido.valor || 0);
  const precisaEstornar = Number(pedido.cobrado || 0) === 1 && Number(pedido.estornado || 0) !== 1 && pedido.revenda_id && valor > 0;

  if (precisaEstornar) {
    await run('UPDATE revendas SET saldo=saldo+?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [valor, pedido.revenda_id]);
    const rev = await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]);
    await run('INSERT INTO pagamentos (revenda_id, revenda_nome, cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, ?, ?, ?)', [
      pedido.revenda_id, pedido.revenda_nome || rev?.nome || '', pedido.revenda_jid || pedido.cliente_jid || '', pedido.revenda_numero || pedido.cliente_whatsapp || '', valor, `ESTORNO PEDIDO #${pedido.id}`
    ]);
  }

  await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, estornado=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, precisaEstornar ? 1 : (pedido.estornado || 0), pedido.id]);
  const atual = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
  await notificarPedido(atual, 'cancelar', motivo);
  if (precisaEstornar && atual.revenda_jid) {
    const rev = await get('SELECT * FROM revendas WHERE id=?', [atual.revenda_id]);
    await enviarTexto(atual.revenda_jid, `💰 Estorno realizado\n\nPedido #${atual.id}\nValor estornado: ${brl(valor)}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(rev?.saldo || 0)}`);
  }
  notificarPainel('cancelado', '❌ Pedido cancelado', `Pedido #${pedido.id}${precisaEstornar ? ' - estornado ' + brl(valor) : ''}`);
  return { ok:true, pedido:atual, estornou:precisaEstornar, valor };
}

async function adminCancelarPedido(from, id, motivo) {
  const r = await cancelarPedidoComEstorno(id, motivo || 'Não informado');
  if (!r.ok) { await enviarTexto(from, '❌ Pedido não encontrado.'); return; }
  await enviarTexto(from, `❌ Pedido #${id} cancelado.${r.estornou ? `\n💰 Estorno: ${brl(r.valor)}` : ''}`);
}
async function adminAddRevenda(from, texto) {
  const [nome, whats] = texto.split('|').map(s => s?.trim());
  if (!nome || !whats) { await enviarTexto(from, 'Use: addrevenda Nome | 5575999999999'); return; }
  const w = onlyDigits(whats);
  await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, ?)', [nome, w, numberToJid(w), `rev${Date.now()}`, 'sem-senha', 'POS_PAGO']);
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
  for (const s of rows) txt += `#${s.id} ${s.nome}\nEntrada: ${tituloTipoEntrada(s.tipo_entrada)} (${labelEntradaServico(s)})\nPreço: ${brl(s.preco_padrao)} | ${s.ativo ? 'Ativo' : 'Inativo'}\n\n`;
  await enviarTexto(from, txt.trim());
}
async function adminAddServico(from, texto) {
  const [nome, precoTxt, tipoTxt, labelTxt] = texto.split('|').map(s => s?.trim());
  const preco = Number(String(precoTxt || '0').replace(',', '.'));
  const tipoEntrada = normalizarTipoEntrada(tipoTxt || 'IMEI');
  const label = labelTxt || (tipoEntrada === 'LOCK_CODE' ? 'Lock Code' : tipoEntrada === 'OUTRO' ? 'Informação' : 'IMEI');
  if (!nome) { await enviarTexto(from, 'Use: addservico Nome | 100 | IMEI\nOu: addservico Nome | 100 | LOCK_CODE | Lock Code'); return; }
  await run('INSERT INTO servicos_catalogo (nome, preco_padrao, tipo_entrada, entrada_label, ativo) VALUES (?, ?, ?, ?, 1)', [nome, preco, tipoEntrada, label]);
  await enviarTexto(from, `✅ Serviço adicionado:\n${nome}\nEntrada: ${tituloTipoEntrada(tipoEntrada)} (${label})\n${brl(preco)}`);
}
async function adminEditarServico(from, texto) {
  const [id, nome, precoTxt, tipoTxt, labelTxt] = texto.split('|').map(s => s?.trim());
  const preco = Number(String(precoTxt || '0').replace(',', '.'));
  const tipoEntrada = normalizarTipoEntrada(tipoTxt || 'IMEI');
  const label = labelTxt || (tipoEntrada === 'LOCK_CODE' ? 'Lock Code' : tipoEntrada === 'OUTRO' ? 'Informação' : 'IMEI');
  if (!id || !nome) { await enviarTexto(from, 'Use: editarservico ID | Novo Nome | 100 | IMEI'); return; }
  await run('UPDATE servicos_catalogo SET nome=?, preco_padrao=?, tipo_entrada=?, entrada_label=? WHERE id=?', [nome, preco, tipoEntrada, label, id]);
  await enviarTexto(from, `✅ Serviço #${id} editado.`);
}
async function adminToggleServico(from, id, ativo) { await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [ativo, id]); notificarPainel('servico', '🛠 Serviço atualizado', `#${id}: ${ativo ? 'ATIVO' : 'INATIVO'}`); await enviarTexto(from, `✅ Serviço #${id}: ${ativo ? 'ATIVO' : 'INATIVO'}`); }
async function adminExcluirServico(from, id) { await run('DELETE FROM precos_revenda WHERE servico_id=?', [id]); await run('DELETE FROM pedidos WHERE servico_id=?', [id]); await run('DELETE FROM servicos_catalogo WHERE id=?', [id]); await enviarTexto(from, `🗑️ Serviço #${id} excluído.`); }

async function resumoFinanceiro() {
  const aberto = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas WHERE status="ATIVA"');
  const recebido = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos');
  const hoje = await get('SELECT COALESCE(SUM(valor),0) total FROM pagamentos WHERE date(criado_em)=date("now")');
  return `💰 *FINANCEIRO*\n\n💳 Balanço revendas: ${brl(aberto.total)}\n✅ Recebido total: ${brl(recebido.total)}\n📅 Recebido hoje: ${brl(hoje.total)}`;
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

async function gerarPix(valor, cliente, cpf) {
  try {
    const response = await axios.post(`${PIXGO_API}/payment/create`, {
      amount: Number(valor), description: `Pagamento CentralUnlocker ${cliente}`,
      customer_name: 'Cliente Telegram', receiver_cpf: cpf,
      payer_name: cliente,
      payer_document: cpf, customer_email: 'cliente@exemplo.com', customer_phone: '11999999999', customer_address: 'Rua Principal, 123', external_id: `pedido_${Date.now()}`
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
          novo = Number(rev.saldo || 0) + Number(valorPix || 0);
          await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, revendaId]);
          await run('INSERT INTO pagamentos (revenda_id, revenda_nome, cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, ?, ?, "pixgo")', [revendaId, rev.nome, jid, jidToNumber(jid), valorPix]);
        }
      } else {
        await run('INSERT INTO pagamentos (cliente_jid, cliente_numero, valor, origem) VALUES (?, ?, ?, "pixgo")', [jid, jidToNumber(jid), valorPix]);
      }
      await run('UPDATE pix_pedidos SET status="completed" WHERE payment_id=?', [paymentId]);
      notificarPainel('pix', '💰 PIX aprovado', `${brl(valorPix)} ${revendaId ? 'revenda' : 'cliente'}`);
      await enviarTexto(jid, `✅ Pagamento confirmado\n\n💰 Valor pago: ${brl(valorPix)}${novo !== null ? `\n\n💳 Situação da conta:\n${textoSituacaoSaldo(novo)}` : ''}\n\n🏢 CentralUnlocker`);
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
    await run('UPDATE revendas SET saldo=saldo-?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.valor, pedido.revenda_id]);
    await run('UPDATE pedidos SET cobrado=1 WHERE id=?', [pedido.id]);
  }
  const atualizado = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
  notificarPainel('finalizado', '✅ Pedido finalizado', `Pedido #${pedido.id} - ${atualizado.servico_nome || ''}`);
  await notificarPedido(atualizado, 'finalizar');
}
async function enviarParaCanaisCliente(cliente, mensagem, fallbackDestino = '') {
  const destinos = new Set();
  const telegramId = cliente?.telegram_id;
  const whatsappNumero = normalizarNumeroWhatsApp(cliente?.whatsapp);
  if (telegramId) destinos.add(tgJid(telegramId));
  if (whatsappNumero) destinos.add(`wa:${whatsappNumero}`);
  if (!destinos.size && fallbackDestino) destinos.add(fallbackDestino);

  let enviados = 0;
  for (const destino of destinos) {
    try {
      const ok = await enviarTexto(destino, mensagem);
      if (ok !== false) enviados++;
    } catch (e) {
      console.log('⚠️ FALHA ENVIO MULTICANAL:', destino, e.message);
    }
  }
  return enviados;
}

async function notificarPedido(pedido, tipo, motivo = '') {
  const rev = pedido.revenda_id ? await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]) : null;
  const destinos = new Set();
  const telegramId = rev?.telegram_id || (isTgJid(pedido.revenda_jid) ? tgIdFromJid(pedido.revenda_jid) : '');
  const whatsappNumero = normalizarNumeroWhatsApp(rev?.whatsapp || pedido.revenda_numero || pedido.cliente_whatsapp);
  if (telegramId) destinos.add(tgJid(telegramId));
  if (whatsappNumero) destinos.add(`wa:${whatsappNumero}`);
  if (!destinos.size) {
    const legado = pedido.revenda_jid || pedido.cliente_jid;
    if (legado) destinos.add(legado);
  }
  if (!destinos.size) return;

  let mensagem = '';
  if (tipo === 'processo') mensagem = `🔄 Serviço em processo\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei || pedido.entrada_valor || '-'}\n💰 Valor: ${brl(pedido.valor)}`;
  if (tipo === 'finalizar') {
    if (pedido.tipo === 'REVENDA') {
      mensagem = `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei || pedido.entrada_valor || '-'}\n\n💰 Valor: ${brl(pedido.valor)}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(rev?.saldo || 0)}\n\n🏢 CentralUnlocker`;
    } else {
      mensagem = `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei || pedido.entrada_valor || '-'}\n\nPara pagar digite:\npagar ${Number(pedido.valor).toFixed(2)}\n\n🏢 CentralUnlocker`;
    }
  }
  if (tipo === 'cancelar') mensagem = `❌ Serviço cancelado\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei || pedido.entrada_valor || '-'}\n\nMotivo:\n${motivo || 'Não informado'}\n\n🏢 CentralUnlocker`;
  if (!mensagem) return;
  for (const destino of destinos) {
    try { await enviarTexto(destino, mensagem); }
    catch (e) { console.log('⚠️ FALHA NOTIFICAÇÃO DUPLA:', destino, e.message); }
  }
}


function textoMensagemBaileys(message = {}) {
  const m = message || {};
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

function comTimeoutWhatsApp(promise, ms, etapa) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tempo limite excedido em: ${etapa}`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function agendarReconexaoWhatsApp() {
  if (whatsappReconectarTimer || !WHATSAPP_ENABLED) return;
  whatsappReconectarTimer = setTimeout(() => {
    whatsappReconectarTimer = null;
    iniciarWhatsAppQrCode().catch(e => console.log('❌ RECONEXÃO WHATSAPP:', e.message));
  }, 5000);
}

async function iniciarWhatsAppQrCode() {
  if (!WHATSAPP_ENABLED || !['baileys', 'qrcode'].includes(WHATSAPP_PROVIDER)) {
    whatsappStatus = WHATSAPP_ENABLED ? 'PROVEDOR_INVALIDO' : 'DESABILITADO';
    console.log('⚠️ WhatsApp QR não iniciado:', { enabled: WHATSAPP_ENABLED, provider: WHATSAPP_PROVIDER });
    return;
  }
  if (whatsappIniciando) {
    console.log('ℹ️ WhatsApp já está em processo de inicialização.');
    return;
  }

  whatsappIniciando = true;
  whatsappInicioEm = Date.now();
  whatsappUltimoErro = '';
  whatsappStatus = 'INICIANDO';
  io.emit('whatsapp-status', { status: whatsappStatus });

  try {
    console.log('📲 Iniciando WhatsApp...');
    console.log('📁 Pasta da sessão:', WHATSAPP_SESSION_DIR);
    fs.mkdirSync(WHATSAPP_SESSION_DIR, { recursive: true });
    fs.accessSync(WHATSAPP_SESSION_DIR, fs.constants.R_OK | fs.constants.W_OK);
    console.log('✅ Pasta da sessão acessível para leitura e gravação');

    console.log('📦 Carregando Baileys...');
    const baileys = await comTimeoutWhatsApp(import('@whiskeysockets/baileys'), 20000, 'carregar Baileys');
    console.log('✅ Baileys carregado');

    const pinoModule = await comTimeoutWhatsApp(import('pino'), 10000, 'carregar logger');
    const pino = pinoModule.default || pinoModule;
    const makeWASocket = baileys.default || baileys.makeWASocket;
    if (typeof makeWASocket !== 'function') throw new Error('Função makeWASocket não encontrada no Baileys');

    console.log('🔐 Carregando sessão...');
    const { state, saveCreds } = await comTimeoutWhatsApp(
      baileys.useMultiFileAuthState(WHATSAPP_SESSION_DIR),
      15000,
      'carregar sessão'
    );
    const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' });

    console.log('🔌 Criando conexão do WhatsApp...');
    // Não consulta fetchLatestBaileysVersion: essa consulta externa pode travar no Render.
    // O Baileys usa sua versão compatível padrão quando "version" não é informada.
    whatsappSocket = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: baileys.Browsers?.ubuntu ? baileys.Browsers.ubuntu('CentralUnlocker') : ['CentralUnlocker', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 20000,
      retryRequestDelayMs: 500
    });
    console.log('✅ Conexão criada; aguardando QR Code ou restauração da sessão');

    whatsappSocket.ev.on('creds.update', saveCreds);
    whatsappSocket.ev.on('connection.update', async update => {
      try {
        const { connection, lastDisconnect, qr } = update || {};
        if (qr) {
          qrCodeBase64 = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
          conectado = false;
          whatsappStatus = 'AGUARDANDO_QR';
          whatsappUltimoErro = '';
          console.log('📷 QR Code do WhatsApp gerado');
          io.emit('whatsapp-status', { status: whatsappStatus });
        }
        if (connection === 'connecting') {
          whatsappStatus = qrCodeBase64 ? 'AGUARDANDO_QR' : 'CONECTANDO';
          io.emit('whatsapp-status', { status: whatsappStatus });
        }
        if (connection === 'open') {
          conectado = true;
          qrCodeBase64 = null;
          whatsappStatus = 'CONECTADO';
          whatsappUltimoErro = '';
          whatsappNumeroConectado = jidToNumber(whatsappSocket?.user?.id || '');
          console.log('✅ WHATSAPP CONECTADO:', whatsappNumeroConectado || 'número identificado');
          notificarPainel('whatsapp', '✅ WhatsApp conectado', whatsappNumeroConectado || 'Sessão ativa');
          io.emit('whatsapp-status', { status: whatsappStatus, numero: whatsappNumeroConectado });
        }
        if (connection === 'close') {
          conectado = false;
          qrCodeBase64 = null;
          whatsappSocket = null;
          const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
          const motivo = lastDisconnect?.error?.message || `código ${statusCode || 'desconhecido'}`;
          const loggedOut = statusCode === baileys.DisconnectReason?.loggedOut;
          whatsappStatus = loggedOut ? 'SESSAO_EXPIRADA' : 'DESCONECTADO';
          whatsappUltimoErro = motivo;
          console.log('⚠️ WHATSAPP DESCONECTADO:', statusCode || motivo);
          io.emit('whatsapp-status', { status: whatsappStatus, erro: whatsappUltimoErro });
          if (!loggedOut) agendarReconexaoWhatsApp();
        }
      } catch (eventError) {
        whatsappUltimoErro = eventError.message;
        whatsappStatus = 'ERRO';
        console.log('❌ EVENTO DE CONEXÃO WHATSAPP:', eventError.stack || eventError.message);
      }
    });

    whatsappSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages || []) {
        try {
          const jidPrincipal = msg?.key?.remoteJid || '';
          const jidAlternativo = msg?.key?.remoteJidAlt || msg?.key?.participantAlt || msg?.senderPn || '';
          if (!jidPrincipal || msg?.key?.fromMe || jidPrincipal === 'status@broadcast' || jidPrincipal.endsWith('@g.us')) continue;

          // Em contas recentes o WhatsApp pode entregar o remetente como @lid.
          // Quando existir o JID telefônico alternativo, ele deve ser usado para cadastro e respostas.
          const jidTelefone = [jidAlternativo, jidPrincipal].find(j => String(j || '').endsWith('@s.whatsapp.net')) || '';
          const numero = normalizarNumeroWhatsApp(jidToNumber(jidTelefone || jidPrincipal));
          const jidResposta = jidTelefone || jidPrincipal;
          const texto = textoMensagemBaileys(msg?.message || {});
          if (!numero || !texto) continue;

          whatsappJidPorNumero.set(numero, jidResposta);
          console.log('📩 WHATSAPP RECEBIDO:', { numero, jid: jidResposta, texto: texto.slice(0, 60) });
          await processarMensagemWhatsApp({ numero, nome: msg?.pushName || 'Cliente WhatsApp', texto });
        } catch (e) {
          console.log('❌ PROCESSAR MENSAGEM WHATSAPP:', e.message);
        }
      }
    });
  } catch (e) {
    whatsappUltimoErro = e.message || String(e);
    whatsappStatus = 'ERRO';
    conectado = false;
    whatsappSocket = null;
    console.log('❌ INICIAR WHATSAPP QR CODE:', e.stack || e.message);
    io.emit('whatsapp-status', { status: whatsappStatus, erro: whatsappUltimoErro });
  } finally {
    whatsappIniciando = false;
  }
}

async function desconectarWhatsApp() {
  try { if (whatsappSocket) await whatsappSocket.logout(); } catch (e) { console.log('⚠️ LOGOUT WHATSAPP:', e.message); }
  whatsappSocket = null;
  conectado = false;
  qrCodeBase64 = null;
  whatsappNumeroConectado = '';
  whatsappStatus = 'DESCONECTADO';
  whatsappUltimoErro = '';
  try { fs.rmSync(WHATSAPP_SESSION_DIR, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(WHATSAPP_SESSION_DIR, { recursive: true });
}

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    if (WHATSAPP_WEBHOOK_SECRET) {
      const recebido = req.headers['x-webhook-secret'] || req.query.secret || req.body?.secret;
      if (String(recebido || '') !== String(WHATSAPP_WEBHOOK_SECRET)) return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    const m = extrairMensagemWhatsApp(req.body || {});
    if (!m.fromMe && m.numero && m.texto) await processarMensagemWhatsApp({ numero: m.numero, nome: m.nome, texto: m.texto });
    res.json({ ok:true });
  } catch (e) {
    console.log('❌ WEBHOOK WHATSAPP:', e);
    res.status(200).json({ ok:false });
  }
});

app.get('/webhook/whatsapp', (req, res) => res.json({ ok:true, whatsapp: WHATSAPP_ENABLED ? 'enabled' : 'disabled' }));

app.get('/', (req, res) => {
  if (qrCodeBase64) return res.send(page('QR', `<div class="card" style="text-align:center"><h1>📱 Atendimento ativo</h1><p>Escaneie o QR Code na página WhatsApp do painel administrativo.</p></div>`));
  res.send(page('Online', `<div class="card" style="text-align:center"><h1>✅ CENTRALUNLOCKER ONLINE</h1><p>${tgBot ? 'Telegram conectado ✅' : 'Telegram aguardando token'}${conectado ? '<br>WhatsApp conectado ✅' : WHATSAPP_ENABLED ? '<br>WhatsApp aguardando conexão' : '<br>WhatsApp desabilitado'}</p><p><a class="btn green" href="/admin">Acessar painel admin</a></p></div>`));
});


// Webhook PixGo - responde HTTP 200 para evitar alerta de falha.
// O sistema já confirma pagamento por consulta automática, então este endpoint
// serve para receber notificações da PixGo sem quebrar o fluxo atual.


// =========================
// SITE DO CLIENTE REMOVIDO
// =========================
// O cliente agora solicita tudo pelo Telegram.
// Mantemos esta rota apenas para evitar 404 e orientar quem tentar acessar.
app.get('/cliente', (req, res) => {
  res.send(adminPage('Cliente via Telegram', `<div class="card"><h1>🤖 Atendimento pelo Telegram</h1><p>O painel do cliente foi removido.</p><p>Agora os clientes solicitam serviços, compram eSIM, consultam histórico, veem conta e geram PIX diretamente pelo bot do Telegram.</p><p>Digite <b>/start</b> ou <b>/menu</b> no bot.</p></div>`));
});
app.get('/cliente/*', (req, res) => res.redirect('/cliente'));

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
  res.send(page('Dashboard', `<div data-live-dashboard="1"></div><div class="hero-hacker"><div class="hero-content"><div class="eyebrow">Painel seguro</div><h1>Painel <span>CentralUnlocker</span></h1><p>Controle total de pedidos, revendas, saldo, IMEI, Lock Code e serviços manuais.</p></div><div class="system-card"><h3>Status do sistema</h3><div class="system-row"><span>API Principal</span><span class="online">ONLINE</span></div><div class="system-row"><span>Bot Telegram</span><span class="online">${tgBot ? 'CONECTADO' : 'OFFLINE'}</span></div><div class="system-row"><span>WhatsApp</span><span class="online">${conectado ? 'CONECTADO' : whatsappStatus}</span></div><div class="system-row"><span>Processador</span><span class="online">ONLINE</span></div><div class="system-row"><span>Banco de Dados</span><span class="online">ONLINE</span></div></div></div><div class="topbar"><h1>Resumo geral</h1><span class="clock-box">🕒 ${dateBR(new Date())}</span></div><div class="grid">
  <div class="card metric"><h2>🟡 Pendentes</h2><h1>${p.qtd}</h1></div><div class="card metric"><h2>🔄 Em Processo</h2><h1>${ep.qtd}</h1></div><div class="card metric"><h2>✅ Finalizados</h2><h1>${f.qtd}</h1></div><div class="card metric"><h2>❌ Cancelados</h2><h1>${c.qtd}</h1></div><div class="card metric"><h2>💰 Hoje</h2><h1>${brl(hoje.total)}</h1></div><div class="card metric"><h2>💳 Balanço revendas</h2><h1>${brl(saldo.total)}</h1></div><div class="card metric"><h2>🏪 Revendas ativas</h2><h1>${rev.qtd}</h1></div>
  </div><div class="card"><h2>Últimos pedidos</h2>${table}</div>`));
});

function isPedidoEsimManual(o) {
  const servico = String(o?.servico_nome || '').toLowerCase();
  const label = String(o?.entrada_label || '').toLowerCase();
  const status = String(o?.status || '').toUpperCase();
  return (
    (label.includes('esim') || servico.includes('esim')) &&
    !['FINALIZADO', 'CANCELADO'].includes(status)
  );
}
function pedidoActions(o, back = '/admin/pedidos') {
  const botaoQr = isPedidoEsimManual(o)
    ? `<a class="btn purple" href="/admin/pedido/${o.id}/entregar-esim">📤 Enviar QR Code</a>`
    : '';
  return `${botaoQr}
  <form class="status-action-form" method="post" action="/admin/pedido/${o.id}/acao" onsubmit="return confirmarAcaoPedido(this)">
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
  let html = `<table><tr><th>ID</th><th>Entrada</th>${showServico ? '<th>Serviço</th>' : ''}<th>Cliente/Revenda</th><th>Telegram/Contato</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const o of rows) html += `<tr><td>#${o.id}</td><td>${safeHtml(o.entrada_valor || o.imei || '-')}<br><span class="muted">${safeHtml(o.entrada_label || 'IMEI')}</span></td>${showServico ? `<td>${safeHtml(o.servico_nome)}</td>` : ''}<td>${safeHtml(o.revenda_nome || o.cliente_nome || '-')}</td><td>${safeHtml(o.revenda_numero || o.cliente_whatsapp || o.revenda_jid || o.cliente_jid || '-')}</td><td>${brl(o.valor)}</td><td><span class="pill">${safeHtml(o.status)}</span></td><td>${pedidoActions(o)}</td></tr>`;
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
  <div class="card"><form class="search" method="get"><input name="q" value="${safeHtml(q)}" placeholder="Buscar entrada, IMEI, Telegram ou nome"><button class="btn">Buscar</button></form></div>${pedidoTable(rows)}`;
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
    await cancelarPedidoComEstorno(p.id, motivo || 'Não informado');
  }

  res.redirect(req.get('referer') || '/admin/pedidos');
});

app.get('/admin/pedido/:id/entregar-esim', async (req, res) => {
  const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (!p) return res.send(page('Pedido não encontrado', '<h1>❌ Pedido não encontrado</h1><a class="btn" href="/admin/pedidos">Voltar</a>'));
  if (!isPedidoEsimManual(p)) return res.send(page('Não é entrega manual', '<h1>❌ Este pedido não está disponível para entrega manual de eSIM.</h1><a class="btn" href="/admin/pedidos">Voltar</a>'));
  const html = `<h1>📤 Enviar QR Code eSIM</h1>
  <div class="card">
    <h2>Pedido #${p.id}</h2>
    <p><b>Cliente/Revenda:</b> ${safeHtml(p.revenda_nome || p.cliente_nome || '-')}</p>
    <p><b>Plano:</b> ${safeHtml(p.entrada_valor || p.servico_nome || '-')}</p>
    <p><b>Valor:</b> ${brl(p.valor)}</p>
    <p><b>Status:</b> <span class="pill">${safeHtml(p.status)}</span></p>
  </div>
  <div class="card">
    <form method="post" action="/admin/pedido/${p.id}/entregar-esim" enctype="multipart/form-data">
      <label>Imagem do QR Code</label>
      <input type="file" name="qr" accept="image/*">
      <label>Texto/instruções da entrega</label>
      <textarea name="texto" rows="7" placeholder="Opcional. Ex: instruções, código manual ou observação para o cliente."></textarea>
      <p class="muted">Você pode enviar imagem, texto, ou os dois. Ao enviar, o pedido será finalizado e o cliente receberá no Telegram.</p>
      <button class="btn green">✅ Enviar e finalizar pedido</button>
      <a class="btn gray" href="/admin/pedidos">Voltar</a>
    </form>
  </div>`;
  res.send(page('Enviar QR eSIM', html));
});

app.post('/admin/pedido/:id/entregar-esim', uploadEsim.single('qr'), async (req, res) => {
  const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (!p || !isPedidoEsimManual(p)) return res.redirect('/admin/pedidos');
  const destino = p.revenda_jid || p.cliente_jid || '';
  const textoExtra = String(req.body.texto || '').trim();
  const plano = p.entrada_valor || p.servico_nome || 'eSIM';
  const caption = `✅ eSIM entregue com sucesso!\n\n📦 Pedido #${p.id}\n📱 Plano: ${plano}\n\n${textoExtra ? textoExtra + '\n\n' : ''}⚠️ QR Code de uso único.\n🏢 CentralUnlocker`;

  if (destino) {
    if (req.file?.path) await enviarImagem(destino, req.file.path, caption);
    else await enviarTexto(destino, caption);
    await enviarTexto(destino, mensagemInstrucaoEsim());
  }

  await run('UPDATE pedidos SET status="FINALIZADO", finalizado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [p.id]);
  notificarPainel('esim', '✅ eSIM manual entregue', `Pedido #${p.id} - ${p.revenda_nome || p.cliente_nome || '-'}`);
  await avisarAdminTelegram(`✅ eSIM manual entregue

Pedido #${p.id}
Cliente: ${p.revenda_nome || p.cliente_nome || '-'}
Plano: ${plano}`);
  res.redirect('/admin/pedidos');
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
app.post('/admin/pedido/:id/cancelar', async (req, res) => { const motivo = req.body.motivo || 'Não informado'; await cancelarPedidoComEstorno(req.params.id, motivo); res.redirect(req.get('referer') || '/admin/pedidos'); });



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
  const manuais = await all(`SELECT * FROM pedidos WHERE (entrada_label='eSIM Manual' OR servico_nome LIKE '%eSIM%') AND status NOT IN ('FINALIZADO','CANCELADO') ORDER BY id DESC LIMIT 100`);

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
    manualTable += `<tr><td>#${p.id}</td><td>${safeHtml(p.revenda_nome || '-')}<br><span class="muted">${safeHtml(p.revenda_numero || '-')}</span></td><td>${safeHtml(p.entrada_valor || p.servico_nome || '-')}</td><td>${brl(p.valor)}</td><td><span class="pill">${safeHtml(p.status)}</span></td><td><span class="muted">Entregue pelo painel<br>ou botão no Telegram admin</span></td></tr>`;
  }
  manualTable += '</table>';

  let table = '<table><tr><th>ID</th><th>Plano</th><th>Preço Revenda</th><th>Status</th><th>Revenda/Pedido</th><th>QR</th><th>Ações</th></tr>';
  for (const i of itens) {
    const img = i.arquivo_qr ? `<a href="/${safeHtml(i.arquivo_qr)}" target="_blank">Visualizar</a>` : '-';
    table += `<tr><td>#${i.id}</td><td>${safeHtml(i.nome_plano)}</td><td>${brl(i.preco_revenda)}</td><td><span class="pill">${safeHtml(i.status)}</span></td><td>${safeHtml(i.revenda_nome || '-')}${i.pedido_id ? `<br><span class="muted">Pedido #${i.pedido_id}</span>` : ''}</td><td>${img}</td><td><form class="forms-inline" method="post" action="/admin/esim/${i.id}/apagar"><button class="btn red" onclick="return confirm('Apagar este QR do estoque?')">🗑️ Apagar</button></form></td></tr>`;
  }
  table += '</table>';

  res.send(page('eSIM', `<h1>📱 eSIM</h1>${formPlano}${formQr}${cards}<div class="card"><h2>📋 Planos cadastrados</h2>${planosTable}</div><div class="card"><h2>👨‍💻 Entregas manuais pendentes</h2><p class="muted">Use o botão Enviar QR Code no pedido ou o aviso recebido no Telegram admin.</p>${manualTable}</div><div class="card"><h2>📦 Estoque QR Codes</h2>${table}</div>`));
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
    const duplicado = await get(
      `SELECT id FROM esim_planos
       WHERE nome_plano=? AND preco_revenda=? AND id != ?`,
      [nomeNovo, precoNovo, id]
    );

    if (duplicado) {
      return res.status(400).send('Já existe um plano com este nome e preço.');
    }

    try {
      // Atualiza o catálogo.
      await run(`UPDATE esim_planos
        SET nome_plano=?, preco_revenda=?, preco_cliente=?, ativo=?
        WHERE id=?`,
        [nomeNovo, precoNovo, precoClienteNovo || precoNovo, ativo, id]);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(400).send('Já existe um plano com este nome e preço.');
      }
      console.error(err);
      return res.status(500).send('Erro interno ao atualizar plano.');
    }

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
    const jid = r?.jid || (r?.telegram_id ? tgJid(r.telegram_id) : '');
    const qrPath = caminhoArquivoEsim(item.arquivo_qr);
    if (jid && fs.existsSync(qrPath)) {
      await enviarImagem(jid, qrPath, `📱 eSIM ${item.nome_plano}\n⚠️ Reenvio do QR Code.`);
      await enviarTexto(jid, mensagemInstrucaoEsim());
    }
  }
  res.redirect('/admin/esim');
});

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY id DESC');
  let html = `<h1>👥 Clientes Telegram e WhatsApp</h1>
  <div class="card">
    <h2>➕ Cadastrar pelo ID do Telegram</h2>
    <form method="post">
      <div class="grid">
        <div><label>Nome</label><input name="nome" placeholder="Nome do cliente" required></div>
        <div><label>ID do Telegram</label><input name="telegram_id" placeholder="Ex: 5319809013" required></div>
        <div><label>Usuário de login</label><input name="login" placeholder="Deixe vazio para gerar automático"></div>
        <div><label>Senha</label><input name="senha" placeholder="Deixe vazio para gerar automático"></div>
        <div><label>Tipo</label><select name="tipo_revenda"><option value="PRE_PAGO">Pré-pago</option><option value="POS_PAGO" selected>Pós-pago</option></select></div>
      </div>
      <button class="btn green">Adicionar / Atualizar</button>
    </form>
    <p class="muted">Clientes novos do WhatsApp são cadastrados automaticamente. Para recuperar o histórico antigo do Telegram, use o botão <b>Vincular ao Telegram</b> na conta criada pelo WhatsApp.</p>
  </div>
  <table><tr><th>ID</th><th>Nome</th><th>Telegram</th><th>WhatsApp</th><th>Tipo</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) {
    const somenteWhatsApp = Boolean(r.whatsapp && !r.telegram_id);
    const vinculo = somenteWhatsApp ? `<a class="btn green" href="/admin/revenda/${r.id}/vincular-telegram">🔗 Vincular ao Telegram</a>` : '';
    html += `<tr><td>#${r.id}</td><td>${safeHtml(r.nome)}</td><td>${safeHtml(r.telegram_id || '-')}</td><td>${safeHtml(r.whatsapp ? '+' + r.whatsapp : '-')}</td><td><span class="pill">${labelTipoRevenda(r.tipo_revenda)}</span></td><td><span class="pill">${safeHtml(r.status)}</span></td><td>${brl(r.saldo)}</td><td class="actions">${vinculo}<a class="btn" href="/admin/revenda/${r.id}/editar">✏️ Editar</a><a class="btn" href="/admin/revenda/${r.id}/precos">💰 Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">💳 Conta</a><a class="btn" href="/admin/revenda/${r.id}/historico">Histórico</a><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="${r.status === 'BLOQUEADA' ? 'ATIVA' : 'BLOQUEADA'}"><button class="btn orange">${r.status === 'BLOQUEADA' ? '🔓 Desbloquear' : '🔒 Bloquear'}</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/remover"><button class="btn red" onclick="return confirm('Remover cliente? O histórico será mantido no banco.')">🗑️ Remover</button></form></td></tr>`;
  }
  html += '</table>';
  res.send(page('Clientes', html));
});

app.get('/admin/revenda/:id/vincular-telegram', async (req, res) => {
  const wa = await get('SELECT * FROM revendas WHERE id=? AND status != "REMOVIDA"', [req.params.id]);
  if (!wa || !wa.whatsapp || wa.telegram_id) return res.redirect('/admin/revendas');
  const telegrams = await all('SELECT * FROM revendas WHERE telegram_id IS NOT NULL AND telegram_id != "" AND status != "REMOVIDA" ORDER BY nome COLLATE NOCASE ASC');
  let opcoes = telegrams.map(t => `<option value="${t.id}">${safeHtml(t.nome)} — Telegram ${safeHtml(t.telegram_id)} — ${brl(t.saldo)}</option>`).join('');
  const html = `<h1>🔗 Vincular WhatsApp ao Telegram</h1>
    <div class="card"><h2>${safeHtml(wa.nome)}</h2><p>WhatsApp: <b>+${safeHtml(wa.whatsapp)}</b></p>
    <p>Escolha abaixo a conta antiga do Telegram deste mesmo cliente.</p>
    <form method="post">
      <label>Conta antiga do Telegram</label>
      <select name="telegram_revenda_id" required><option value="">Selecione...</option>${opcoes}</select><br><br>
      <div class="card"><b>Importante:</b><br>A conta antiga do Telegram será mantida integralmente. Nenhum saldo, pedido, pagamento, PIX, eSIM, preço ou histórico da conta provisória do WhatsApp será somado ou transferido. O WhatsApp passará a acessar somente os dados da conta do Telegram.</div>
      <button class="btn green" onclick="return confirm('Confirma a vinculação? Os dados da conta provisória do WhatsApp NÃO serão somados nem transferidos. O WhatsApp passará a usar somente a conta do Telegram.')">Confirmar vinculação</button>
      <a class="btn gray" href="/admin/revendas">Cancelar</a>
    </form></div>`;
  res.send(page('Vincular contas', html));
});

app.post('/admin/revenda/:id/vincular-telegram', async (req, res) => {
  try {
    const resultado = await vincularContaWhatsAppPeloAdmin(Number(req.params.id), Number(req.body.telegram_revenda_id));
    if (!resultado.ok) return res.status(400).send(page('Erro ao vincular', `<h1>❌ Não foi possível vincular</h1><div class="card"><p>${safeHtml(resultado.erro)}</p><a class="btn" href="/admin/revendas">Voltar</a></div>`));
    res.send(page('Contas vinculadas', `<h1>✅ Contas vinculadas</h1><div class="card"><p>O WhatsApp foi associado à conta antiga do Telegram de <b>${safeHtml(resultado.cliente.nome)}</b>.</p><p>Agora Telegram e WhatsApp usam exclusivamente o saldo, o histórico e os pedidos da conta antiga do Telegram.</p><a class="btn green" href="/admin/revendas">Voltar aos clientes</a></div>`));
  } catch (e) {
    console.log('❌ VÍNCULO ADMIN:', e);
    res.status(500).send(page('Erro ao vincular', `<h1>❌ Erro interno</h1><div class="card"><p>${safeHtml(e.message)}</p><a class="btn" href="/admin/revendas">Voltar</a></div>`));
  }
});

app.post('/admin/revendas', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const telegramId = onlyDigits(req.body.telegram_id || '');
  const tipoRevenda = normalizarTipoRevenda(req.body.tipo_revenda);
  if (!nome || !telegramId) return res.redirect('/admin/revendas');
  let login = String(req.body.login || '').trim() || gerarLogin(nome, telegramId);
  const senha = String(req.body.senha || '').trim() || gerarSenha(8);
  const jid = tgJid(telegramId);
  const existeLogin = await get('SELECT id FROM revendas WHERE login=? AND (telegram_id IS NULL OR telegram_id != ?)', [login, telegramId]);
  if (existeLogin) login = `${login}${Date.now().toString().slice(-3)}`;
  let existe = await get('SELECT * FROM revendas WHERE (telegram_id=? OR jid=?) AND status != "REMOVIDA"', [telegramId, jid]);
  if (existe) {
    await run('UPDATE revendas SET nome=?, telegram_id=?, jid=?, login=?, senha=?, status="ATIVA", tipo_revenda=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [nome, telegramId, jid, login, senha, tipoRevenda, existe.id]);
    existe = await get('SELECT * FROM revendas WHERE id=?', [existe.id]);
    await enviarBoasVindasTutorialRevenda(existe);
  } else {
    const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo, tipo_revenda, telegram_id) VALUES (?, ?, ?, ?, ?, "ATIVA", 0, ?, ?)', [nome, telegramId, jid, login, senha, tipoRevenda, telegramId]);
    existe = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
    await enviarBoasVindasTutorialRevenda(existe);
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
    const jidAviso = rStatus.jid || (rStatus.telegram_id ? tgJid(rStatus.telegram_id) : '');
    if (req.body.status === 'BLOQUEADA') await enviarTexto(jidAviso, '🔒 Sua revenda foi bloqueada. Entre em contato com a CentralUnlocker.');
    if (req.body.status === 'ATIVA') await enviarTexto(jidAviso, '🔓 Sua revenda foi reativada. Digite menu para continuar.');
  }
  res.redirect('/admin/revendas');
});

app.post('/admin/revenda/:id/remover', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (!r) return res.redirect('/admin/revendas');

  // Remove o vínculo do Telegram para permitir novo cadastro com /start.
  // Mantém pedidos, pagamentos e histórico financeiro pelo revenda_id antigo.
  const sufixo = `removido_${r.id}_${Date.now()}`;
  await run(`UPDATE revendas SET
    status='REMOVIDA',
    telegram_id=NULL,
    jid=NULL,
    whatsapp=NULL,
    login=?,
    senha=NULL,
    atualizado_em=CURRENT_TIMESTAMP
    WHERE id=?`, [sufixo, r.id]);

  pedidoSessao.delete(tgJid(r.telegram_id || ''));
  pedidoSessao.delete(String(r.telegram_id || ''));
  res.redirect('/admin/revendas');
});

app.post('/admin/revenda/:id/excluir-permanente', async (req, res) => {
  const id = req.params.id;
  await run('DELETE FROM precos_revenda WHERE revenda_id=?', [id]);
  await run('DELETE FROM pagamentos WHERE revenda_id=?', [id]);
  await run('DELETE FROM pedidos WHERE revenda_id=?', [id]);
  await run('DELETE FROM revendas WHERE id=?', [id]);
  res.redirect('/admin/revendas');
});
app.get('/admin/revenda/:id/editar', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  res.send(page('Editar Revenda', `<h1>✏️ Editar Revenda</h1><div class="card"><form method="post">
    <label>Nome</label><input name="nome" value="${safeHtml(r.nome)}" required><br><br>
    <label>ID do Telegram</label><input name="telegram_id" value="${safeHtml(r.telegram_id || '')}" placeholder="Ex: 5319809013"><br><br>
    <label>Usuário de login</label><input name="login" value="${safeHtml(r.login || '')}"><br><br>
    <label>Senha</label><input name="senha" value="${safeHtml(r.senha || '')}"><br><br>
    <label>WhatsApp</label><input name="whatsapp" value="${safeHtml(r.whatsapp || '')}"><br><br>
    <label>Tipo da revenda</label><select name="tipo_revenda"><option value="PRE_PAGO" ${normalizarTipoRevenda(r.tipo_revenda)==='PRE_PAGO'?'selected':''}>Pré-pago</option><option value="POS_PAGO" ${normalizarTipoRevenda(r.tipo_revenda)==='POS_PAGO'?'selected':''}>Pós-pago</option></select><br><br>
    <label>Status</label><select name="status"><option ${r.status==='ATIVA'?'selected':''}>ATIVA</option><option ${r.status==='BLOQUEADA'?'selected':''}>BLOQUEADA</option><option ${r.status==='REMOVIDA'?'selected':''}>REMOVIDA</option></select><br><br>
    <button class="btn green">Salvar</button>
  </form></div>`));
});
app.post('/admin/revenda/:id/editar', async (req, res) => {
  const telegramId = onlyDigits(req.body.telegram_id || '');
  const jid = telegramId ? tgJid(telegramId) : '';
  const w = normalizarNumeroWhatsApp(req.body.whatsapp || '');
  await run('UPDATE revendas SET nome=?, whatsapp=?, telegram_id=?, jid=?, login=?, senha=?, status=?, tipo_revenda=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.nome, w || null, telegramId || null, jid || (w ? `wa:${w}` : null), req.body.login, req.body.senha, req.body.status, normalizarTipoRevenda(req.body.tipo_revenda), req.params.id]);
  res.redirect('/admin/revendas');
});
app.get('/admin/revenda/:id/precos', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let html = `<h1>💰 Preços dos serviços</h1><div class="card"><h2>${safeHtml(r.nome)}</h2><p class="muted">Telegram ID: ${safeHtml(r.telegram_id || '-')} | Login: ${safeHtml(r.login || '-')}</p><p>Coloque aqui o preço que essa revenda vai pagar em cada serviço. Se deixar 0, usa o preço padrão do serviço.</p></div><form method="post"><table><tr><th>Serviço</th><th>Preço padrão</th><th>Preço dessa revenda</th></tr>`;
  for (const s of servs) {
    const pr = await get('SELECT preco FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [r.id, s.id]);
    const preco = pr ? Number(pr.preco || 0) : 0;
    html += `<tr><td>${safeHtml(s.nome)}<br><span class="muted">${safeHtml(labelEntradaServico(s))}</span></td><td>${brl(s.preco_padrao)}</td><td><input name="preco_${s.id}" value="${preco || ''}" placeholder="0 = preço padrão"></td></tr>`;
  }
  html += `</table><br><button class="btn green">Salvar preços</button> <a class="btn gray" href="/admin/revendas">Voltar</a></form>`;
  res.send(page('Preços', html));
});
app.post('/admin/revenda/:id/precos', async (req, res) => {
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1');
  for (const s of servs) {
    const raw = String(req.body[`preco_${s.id}`] || '').trim();
    const preco = Number(raw.replace(',', '.'));
    if (!raw || !preco || preco <= 0) await run('DELETE FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [req.params.id, s.id]);
    else await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, preco]);
  }
  res.redirect('/admin/revendas');
});
app.get('/admin/revenda/:id/conta', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  if (!r) return res.redirect('/admin/revendas');
  const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 50', [r.id]);
  const tipo = normalizarTipoRevenda(r.tipo_revenda);
  const saldoAtual = Number(r.saldo || 0);
  const tituloSaldo = tipo === 'PRE_PAGO' ? 'Saldo / Crédito atual' : 'Situação financeira';
  const ajudaPagamento = tipo === 'PRE_PAGO'
    ? 'Use para adicionar crédito ao cliente pré-pago.'
    : 'Use para abater a dívida do cliente pós-pago.';
  const ajudaDebito = tipo === 'PRE_PAGO'
    ? 'Use para retirar saldo manualmente do cliente pré-pago.'
    : 'Use para lançar uma nova cobrança/débito ao cliente pós-pago.';

  let html = `<h1>💳 Conta do Cliente</h1>
  <div class="card">
    <h2>${safeHtml(r.nome)}</h2>
    <p><span class="pill">${labelTipoRevenda(r.tipo_revenda)}</span></p>
    <p class="muted">${tituloSaldo}</p>
    <h1>${textoSituacaoSaldo(saldoAtual).replace(/\n/g, '<br>')}</h1>
  </div>

  <div class="grid">
    <div class="card">
      <h2>💰 Registrar pagamento</h2>
      <p class="muted">${ajudaPagamento}</p>
      <form method="post" action="/admin/revenda/${r.id}/pagamento">
        <input name="valor" placeholder="Valor pago. Ex: 100" required>
        <br><br>
        <button class="btn green">Registrar Pagamento</button>
      </form>
    </div>

    <div class="card">
      <h2>➖ Debitar saldo / lançar débito</h2>
      <p class="muted">${ajudaDebito}</p>
      <form method="post" action="/admin/revenda/${r.id}/debito">
        <input name="valor" placeholder="Valor do débito. Ex: 50" required>
        <br><br>
        <input name="descricao" placeholder="Descrição opcional. Ex: ajuste manual">
        <br><br>
        <button class="btn red" onclick="return confirm('Confirmar débito manual na conta deste cliente?')">Debitar</button>
      </form>
    </div>
  </div>

  <h2>Histórico</h2>${pedidoTable(pedidos)}`;
  res.send(page('Conta', html));
});
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

app.post('/admin/revenda/:id/debito', async (req, res) => {
  const valor = Number(String(req.body.valor || '0').replace(',', '.'));
  const descricao = String(req.body.descricao || '').trim();
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);

  if (valor > 0 && r) {
    // Regra única do financeiro:
    // saldo positivo = crédito disponível; saldo negativo = débito em aberto.
    // Portanto, debitar sempre subtrai o valor da conta.
    const novo = Number(r.saldo || 0) - valor;

    await run(
      'UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?',
      [novo, r.id]
    );

    await run(
      'INSERT INTO pagamentos (revenda_id, revenda_nome, valor, origem) VALUES (?, ?, ?, ?)',
      [r.id, r.nome, -Math.abs(valor), descricao ? `debito_manual: ${descricao}` : 'debito_manual']
    );

    notificarPainel('debito', '➖ Débito manual', `${r.nome} - ${brl(valor)}`);
    if (r.jid) {
      await enviarTexto(
        r.jid,
        `➖ Débito lançado

💰 Valor: ${brl(valor)}${descricao ? `
📝 Motivo: ${descricao}` : ''}

💳 Situação da conta:
${textoSituacaoSaldo(novo)}

🏢 CentralUnlocker`
      );
    }
  }

  res.redirect(`/admin/revenda/${req.params.id}/conta`);
});

app.get('/admin/servicos', async (req, res) => {
  const rows = await all('SELECT s.*, (SELECT COUNT(*) FROM pedidos p WHERE p.servico_id=s.id) total FROM servicos_catalogo s ORDER BY s.id ASC');
  let html = `<div class="hero"><h1>🛠 Catálogo de Serviços</h1><p>Cadastre serviços como IMEI, Lock Code ou Outro. O Telegram solicita a entrada conforme o tipo escolhido.</p></div>
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

app.get('/admin/whatsapp', async (req, res) => {
  const statusLabel = conectado ? '🟢 CONECTADO' : whatsappStatus === 'AGUARDANDO_QR' ? '🟡 AGUARDANDO LEITURA DO QR CODE' : whatsappStatus === 'CONECTANDO' ? '🟡 CONECTANDO' : `🔴 ${safeHtml(whatsappStatus)}`;
  const erroHtml = whatsappUltimoErro ? `<div class="card" style="border-color:#ef4444"><h3>⚠️ Detalhe do erro</h3><p>${safeHtml(whatsappUltimoErro)}</p><p class="mini-help">Confira também os Logs do Render.</p></div>` : '';
  const qrHtml = qrCodeBase64
    ? `<div style="text-align:center"><img src="${qrCodeBase64}" alt="QR Code do WhatsApp" style="width:min(360px,100%);background:#fff;padding:12px;border-radius:18px"><p class="mini-help">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie este QR Code.</p></div>`
    : conectado
      ? `<div class="card"><h2>✅ WhatsApp conectado</h2><p><b>Número:</b> ${safeHtml(whatsappNumeroConectado || 'identificado pela sessão')}</p><p>A sessão será restaurada automaticamente depois de reiniciar, desde que a pasta persistente não seja apagada.</p></div>`
      : `<div class="card"><p>O QR Code ainda está sendo preparado. Use o botão abaixo para iniciar ou atualizar a conexão.</p></div>`;
  res.send(page('WhatsApp', `<h1>📲 Conexão do WhatsApp</h1><div class="grid"><div class="card metric"><h2>Status</h2><h1 style="font-size:22px">${statusLabel}</h1></div><div class="card metric"><h2>Provedor</h2><h1 style="font-size:22px">QR CODE DIRETO</h1></div></div>${erroHtml}<div class="card">${qrHtml}<form class="forms-inline" method="post" action="/admin/whatsapp/conectar"><button class="btn green">🔄 Gerar/Atualizar QR Code</button></form><form class="forms-inline" method="post" action="/admin/whatsapp/desconectar"><button class="btn red" onclick="return confirm('Desconectar o WhatsApp e apagar a sessão?')">🔌 Desconectar</button></form></div><script>setTimeout(()=>location.reload(),5000)</script>`));
});
app.post('/admin/whatsapp/conectar', async (req, res) => {
  if (!conectado) {
    console.log('🔄 Reinício manual do WhatsApp solicitado pelo painel');
    if (whatsappReconectarTimer) { clearTimeout(whatsappReconectarTimer); whatsappReconectarTimer = null; }
    try { if (whatsappSocket?.end) whatsappSocket.end(new Error('reinicio manual')); } catch (_) {}
    whatsappSocket = null;
    qrCodeBase64 = null;
    whatsappStatus = 'INICIANDO';
    await iniciarWhatsAppQrCode();
  }
  res.redirect('/admin/whatsapp');
});
app.post('/admin/whatsapp/desconectar', async (req, res) => {
  await desconectarWhatsApp();
  res.redirect('/admin/whatsapp');
});

app.get('/admin/config', async (req, res) => {
  const suporteTelegram = await getTelegramSuporte();
  const temasHtml = Object.entries(TEMAS_PAINEL).map(([id, t]) => `<div class="theme-card"><div class="theme-preview preview-${id}"></div><b>${safeHtml(t.nome)}</b><p class="muted">${id === PAINEL_TEMA ? 'Tema atual ✅' : 'Clique para aplicar'}</p><form method="post" action="/admin/config/theme"><input type="hidden" name="theme" value="${id}"><button class="btn ${id===PAINEL_TEMA?'green':''}">Aplicar</button></form></div>`).join('');
  res.send(page('Configurações', `<h1>⚙️ Configurações</h1><div class="grid"><div class="card"><h2>Dados do sistema</h2><p><b>Admin:</b> ${safeHtml(ADMIN_NUMBER)}</p><p><b>DB:</b> ${safeHtml(DB_PATH)}</p><p><b>Status Telegram:</b> ${tgBot ? 'Conectado ✅' : 'Desconectado ❌'}</p><p><b>Tema atual:</b> ${safeHtml(TEMAS_PAINEL[temaAtual()].nome)}</p></div><div class="card"><h2>🆘 Suporte do cliente</h2><p class="muted">Esse usuário será usado no botão Suporte do Telegram.</p><form method="post" action="/admin/config/suporte"><label>Telegram do suporte</label><input name="telegram_suporte" value="@${safeHtml(suporteTelegram)}" placeholder="@alinesantos3360"><p class="mini-help">Aceita @usuario ou https://t.me/usuario</p><button class="btn green">Salvar suporte</button></form><p><b>Link atual:</b> <a href="https://t.me/${safeHtml(suporteTelegram)}" target="_blank">https://t.me/${safeHtml(suporteTelegram)}</a></p></div><div class="card"><h2>🎨 Temas prontos</h2><p class="muted">Escolha um tema e aplique com 1 clique.</p><div class="theme-grid">${temasHtml}</div></div><div class="card"><h2>🖼️ Banner personalizado</h2><p class="muted">Opcional: escolha uma imagem do celular. Ela substitui o banner do tema e salva como <b>/img/hacker.png</b>.</p><img class="image-preview" src="/img/hacker.png?v=${Date.now()}" onerror="this.style.display='none'"><br><br><form method="post" action="/admin/config/hacker-image"><input id="hackerFile" type="file" accept="image/png,image/jpeg,image/webp"><input id="hackerData" type="hidden" name="imageData"><br><button class="btn green" id="sendBtn" disabled>Salvar banner manual</button></form><p class="mini-help">A troca manual fica somente aqui em Configurações.</p><script>const f=document.getElementById('hackerFile'),d=document.getElementById('hackerData'),b=document.getElementById('sendBtn');f&&f.addEventListener('change',()=>{const file=f.files&&f.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{d.value=r.result;b.disabled=false;b.textContent='Salvar banner manual';};b.disabled=true;b.textContent='Carregando imagem...';r.readAsDataURL(file);});</script></div></div>`));
});
app.post('/admin/config/theme', async (req, res) => { const theme = String(req.body.theme || 'hacker-green'); if (TEMAS_PAINEL[theme]) { PAINEL_TEMA = theme; await setConfig('painel_tema', theme); notificarPainel('tema', '🎨 Tema alterado', TEMAS_PAINEL[theme].nome); } res.redirect('/admin/config'); });
app.post('/admin/config/suporte', async (req, res) => {
  const usuario = normalizarTelegramSuporte(req.body.telegram_suporte || '');
  if (usuario) {
    await setConfig('telegram_suporte', usuario);
    notificarPainel('config', '🆘 Suporte atualizado', `@${usuario}`);
  }
  res.redirect('/admin/config');
});
app.post('/admin/config/hacker-image', async (req, res) => {
  try {
    const data = String(req.body.imageData || '');
    const m = data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!m) return res.send(page('Erro', '<h1>❌ Imagem inválida</h1><p>Envie uma imagem PNG, JPG ou WEBP.</p><a class="btn" href="/admin/config">Voltar</a>'));
    if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
if (!fs.existsSync(ESIM_DIR)) fs.mkdirSync(ESIM_DIR, { recursive: true });
    fs.writeFileSync(HACKER_IMAGE_PATH, Buffer.from(m[2], 'base64'));
    notificarPainel('banner', '🖼️ Banner atualizado', 'Foto do hacker alterada manualmente');
    res.redirect('/admin/config?ok=1');
  } catch (e) {
    console.log('❌ ERRO SALVAR IMAGEM:', e.message);
    res.send(page('Erro', '<h1>❌ Erro ao salvar imagem</h1><a class="btn" href="/admin/config">Voltar</a>'));
  }
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
iniciarTelegram();
iniciarWhatsAppQrCode().catch(e => console.log('❌ WHATSAPP START:', e.message));
