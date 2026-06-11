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

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;
const PIXGO_API = 'https://pixgo.org/api/v1';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');
const DB_DIR = path.dirname(DB_PATH);
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_IMG_DIR = path.join(PUBLIC_DIR, 'img');
const ESIM_IMG_DIR = path.join(PUBLIC_DIR, 'esim');
const HACKER_IMAGE_PATH = path.join(PUBLIC_IMG_DIR, 'hacker.png');
const ADMIN_NUMBER = onlyDigits(process.env.ADMIN_NUMBER || '');
const ADMIN_PANEL_USER = process.env.ADMIN_PANEL_USER || 'admin';
const ADMIN_PANEL_PASS = process.env.ADMIN_PANEL_PASS || '123456';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
if (!fs.existsSync(ESIM_IMG_DIR)) fs.mkdirSync(ESIM_IMG_DIR, { recursive: true });

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

function normalizarTipoEntrada(v) {
  const t = String(v || 'IMEI').toUpperCase().replace(/[^A-Z_]/g, '');
  return ['IMEI', 'LOCK_CODE', 'OUTRO', 'ESIM'].includes(t) ? t : 'IMEI';
}
function labelEntradaServico(servico) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  if (String(servico?.entrada_label || '').trim()) return String(servico.entrada_label).trim();
  if (tipo === 'LOCK_CODE') return 'Lock Code';
  if (tipo === 'OUTRO') return 'Informação';
  if (tipo === 'ESIM') return 'eSIM';
  return 'IMEI';
}
function tituloTipoEntrada(tipo) {
  tipo = normalizarTipoEntrada(tipo);
  if (tipo === 'LOCK_CODE') return 'Lock Code';
  if (tipo === 'OUTRO') return 'Outro';
  if (tipo === 'ESIM') return 'eSIM';
  return 'IMEI';
}
function iconeEntradaServico(servico) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  if (tipo === 'LOCK_CODE') return '🔐';
  if (tipo === 'OUTRO') return '📝';
  if (tipo === 'ESIM') return '📲';
  return '📱';
}
function imeiPassaLuhn(imei) {
  imei = onlyDigits(imei);
  if (!/^\d{15}$/.test(imei)) return false;

  let soma = 0;
  for (let i = 0; i < 15; i++) {
    let numero = Number(imei[i]);

    // IMEI usa Luhn: dobra as posições pares considerando contagem humana,
    // que são índices 1, 3, 5... no JavaScript.
    if (i % 2 === 1) {
      numero *= 2;
      if (numero > 9) numero -= 9;
    }

    soma += numero;
  }

  return soma % 10 === 0;
}

function imeiSequenciaFalsa(imei) {
  imei = onlyDigits(imei);
  if (/^(\d)\1{14}$/.test(imei)) return true; // 000..., 111..., 999...
  const bloqueados = new Set([
    '123456789012345',
    '012345678901234',
    '987654321098765'
  ]);
  return bloqueados.has(imei);
}

function validarIMEI(imei) {
  imei = onlyDigits(imei);
  return /^\d{15}$/.test(imei) && !imeiSequenciaFalsa(imei) && imeiPassaLuhn(imei);
}

function extrairImeisEmLote(texto) {
  const numeros = String(texto || '').match(/\d+/g) || [];
  return [...new Set(numeros.filter(n => n.length === 15))];
}

function validarEntradaServico(servico, textoOriginal) {
  const tipo = normalizarTipoEntrada(servico?.tipo_entrada);
  const bruto = String(textoOriginal || '').trim();
  if (tipo === 'IMEI') {
    const numeros = bruto.match(/\d+/g) || [];
    const sobras = bruto.replace(/[\d\s,;.\-_/()]+/g, '');

    if (!numeros.length) {
      return { ok: false, erro: `❌ IMEI inválido.\n\n📱 Envie 1 IMEI com 15 dígitos válidos ou vários IMEIs, um por linha.\n\nDica: digite *#06# no aparelho e copie o IMEI da tela.\n\nDigite cancelar para sair.` };
    }

    const formatoErrado = numeros.filter(n => n.length !== 15);
    if (formatoErrado.length || sobras) {
      return { ok: false, erro: `❌ Formato inválido.\n\nO IMEI precisa ter exatamente 15 números.\n\n📦 Em lote, envie um IMEI por linha ou separados por espaço.\n\nDigite cancelar para sair.` };
    }

    const imeis = [...new Set(numeros)];
    const invalidos = imeis.filter(imei => !validarIMEI(imei));
    if (invalidos.length) {
      return { ok: false, erro: `❌ IMEI inválido pelo verificador.\n\nEstes IMEIs têm 15 dígitos, mas não passaram na validação:\n${invalidos.join('\n')}\n\n📱 Peça ao cliente para digitar *#06# no aparelho e enviar o IMEI exibido na tela.\n\nDigite cancelar para sair.` };
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
function isAdminJid(jid) { return ADMIN_NUMBER && jidToNumber(jid) === ADMIN_NUMBER; }
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

  await run(`CREATE TABLE IF NOT EXISTS configs (
    chave TEXT PRIMARY KEY,
    valor TEXT,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS esim_qrcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plano_nome TEXT NOT NULL,
    validade TEXT,
    preco_revenda REAL DEFAULT 0,
    preco_cliente REAL DEFAULT 0,
    arquivo_qr TEXT NOT NULL,
    status TEXT DEFAULT 'DISPONIVEL',
    revenda_id INTEGER,
    revenda_nome TEXT,
    comprador_jid TEXT,
    pedido_id INTEGER,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    vendido_em TEXT
  )`);
  await addColumnIfMissing('esim_qrcodes', 'validade', 'TEXT');
  await addColumnIfMissing('esim_qrcodes', 'preco_revenda', 'REAL DEFAULT 0');
  await addColumnIfMissing('esim_qrcodes', 'preco_cliente', 'REAL DEFAULT 0');
  await addColumnIfMissing('esim_qrcodes', 'revenda_id', 'INTEGER');
  await addColumnIfMissing('esim_qrcodes', 'revenda_nome', 'TEXT');
  await addColumnIfMissing('esim_qrcodes', 'comprador_jid', 'TEXT');
  await addColumnIfMissing('esim_qrcodes', 'pedido_id', 'INTEGER');
  await addColumnIfMissing('esim_qrcodes', 'vendido_em', 'TEXT');
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

function page(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHtml(title)}</title>
  <style>
  :root{--bg:#07111f;--bg2:#0c1426;--card:#101b31;--card2:#0d172a;--soft:#16223a;--line:#24324b;--text:#eaf0f8;--muted:#97a6ba;--blue:#2f80ed;--cyan:#28d7ff;--green:#28c76f;--red:#ff4d4f;--orange:#ff9f43;--purple:#9b5cff;--shadow:0 18px 45px rgba(0,0,0,.32)}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,Arial,sans-serif;color:var(--text);background:radial-gradient(circle at 18% 10%,rgba(40,215,255,.14),transparent 28%),radial-gradient(circle at 88% 4%,rgba(155,92,255,.12),transparent 30%),linear-gradient(135deg,var(--bg),var(--bg2));min-height:100vh}a{color:#a9d8ff;text-decoration:none}.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.side{position:sticky;top:0;height:100vh;padding:22px;background:linear-gradient(180deg,rgba(6,12,24,.96),rgba(9,16,31,.94));border-right:1px solid rgba(255,255,255,.08);box-shadow:12px 0 40px rgba(0,0,0,.20);overflow:auto}.brand{display:flex;align-items:center;gap:12px;padding:14px 12px;margin-bottom:18px;border-radius:18px;background:linear-gradient(135deg,rgba(47,128,237,.22),rgba(40,215,255,.09));border:1px solid rgba(40,215,255,.18);font-size:20px;font-weight:900;letter-spacing:.2px}.brand:before{content:'🕶️';font-size:31px}.side .nav-title{font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:var(--muted);margin:18px 12px 8px}.side a{display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:14px;margin:5px 0;color:#cdd7e6;font-weight:750;border:1px solid transparent}.side a:hover{background:rgba(47,128,237,.16);border-color:rgba(40,215,255,.12);transform:translateX(2px)}.main{padding:26px;max-width:1560px;width:100%;margin:0 auto}.hero{position:relative;overflow:hidden;border:1px solid rgba(40,215,255,.18);border-radius:24px;padding:24px;margin-bottom:18px;background:linear-gradient(135deg,rgba(16,27,49,.96),rgba(13,23,42,.82)),radial-gradient(circle at 92% 20%,rgba(40,215,255,.2),transparent 25%);box-shadow:var(--shadow)}.hero:after{content:'</>';position:absolute;right:28px;top:8px;font-size:92px;font-weight:900;color:rgba(40,215,255,.09);transform:rotate(-8deg)}.hero h1{margin:0 0 8px;font-size:30px}.hero p{margin:0;color:var(--muted);max-width:820px}.topbar{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:16px}.card{background:linear-gradient(180deg,rgba(16,27,49,.94),rgba(13,23,42,.94));border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:18px;margin:14px 0;box-shadow:var(--shadow)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.metric{position:relative;overflow:hidden}.metric:before{content:'';position:absolute;right:-34px;top:-34px;width:96px;height:96px;border-radius:50%;background:rgba(40,215,255,.10)}.metric h2{font-size:13px;color:var(--muted);margin:0 0 8px;text-transform:uppercase;letter-spacing:.8px}.metric h1{font-size:32px;margin:0}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white!important;padding:9px 13px;border-radius:12px;border:0;cursor:pointer;margin:2px;font-weight:850;box-shadow:0 10px 18px rgba(37,99,235,.18)}.btn.red{background:linear-gradient(135deg,#ef4444,#b91c1c)}.btn.green{background:linear-gradient(135deg,#22c55e,#15803d);color:white!important}.btn.gray{background:linear-gradient(135deg,#64748b,#334155)}.btn.orange{background:linear-gradient(135deg,#f97316,#c2410c)}.btn.purple{background:linear-gradient(135deg,#a855f7,#6d28d9);color:white!important}input,select,textarea{padding:12px;border-radius:13px;border:1px solid #334155;background:#08111f;color:var(--text);width:100%;min-width:130px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(40,215,255,.10)}label{font-size:12px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.8px}table{width:100%;border-collapse:separate;border-spacing:0;background:rgba(8,17,31,.84);border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}td,th{border-bottom:1px solid rgba(255,255,255,.07);padding:12px;text-align:left;vertical-align:middle}th{color:#cbd5e1;background:rgba(16,27,47,.95);font-size:12px;text-transform:uppercase;letter-spacing:.7px}tr:last-child td{border-bottom:0}tr:hover td{background:rgba(47,128,237,.06)}.muted{color:var(--muted)}.pill{padding:5px 10px;border-radius:999px;background:rgba(47,128,237,.14);border:1px solid rgba(47,128,237,.25);display:inline-block;font-weight:800}.forms-inline{display:inline}.actions{white-space:nowrap}.search{display:grid;grid-template-columns:1fr 120px;gap:8px;max-width:560px}.service-card{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:linear-gradient(135deg,rgba(13,23,42,.96),rgba(16,27,49,.92));border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:16px;margin:12px 0}.service-title{font-size:18px;font-weight:900}.service-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 10px;background:rgba(148,163,184,.12);color:#dbe7f5;font-weight:800;font-size:12px}.form-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr;gap:12px}.mini-help{background:rgba(40,215,255,.08);border:1px dashed rgba(40,215,255,.24);padding:12px;border-radius:14px;color:#cbefff}.empty{padding:28px;text-align:center;color:var(--muted)}.hero-hacker{position:relative;min-height:310px;display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:18px;overflow:hidden;border:1px solid rgba(0,255,102,.32);border-radius:26px;padding:30px;margin-bottom:18px;background:linear-gradient(90deg,rgba(0,0,0,.92),rgba(0,20,8,.52)),url('/img/hacker.png') center right/cover no-repeat;box-shadow:0 0 28px rgba(0,255,102,.14),inset 0 0 80px rgba(0,255,102,.06)}.hero-hacker:before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,255,102,.05),transparent),repeating-linear-gradient(0deg,rgba(0,255,102,.045) 0 1px,transparent 1px 34px),repeating-linear-gradient(90deg,rgba(0,255,102,.035) 0 1px,transparent 1px 45px);pointer-events:none}.hero-hacker .hero-content{position:relative;z-index:1;max-width:620px}.hero-hacker .eyebrow{color:#38ff6a;font-weight:900;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}.hero-hacker h1{font-size:42px;line-height:1.02;margin:0 0 12px;text-transform:uppercase;text-shadow:0 0 18px rgba(0,255,102,.35)}.hero-hacker h1 span{color:#39ff14}.hero-hacker p{font-size:18px;color:#d6ffe0;margin:0 0 18px}.system-card{position:relative;z-index:1;justify-self:end;width:min(360px,100%);background:rgba(0,0,0,.62);border:1px solid rgba(0,255,102,.24);border-radius:18px;padding:16px;backdrop-filter:blur(8px)}.system-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(255,255,255,.08);padding:10px 0;font-weight:800}.system-row:last-child{border-bottom:0}.online{color:#39ff14;text-shadow:0 0 12px rgba(57,255,20,.6)}.clock-box{display:inline-flex;align-items:center;gap:8px;color:#dbffe6;border:1px solid rgba(0,255,102,.2);border-radius:999px;padding:8px 12px;background:rgba(0,0,0,.32)}.card,.service-card{border-color:rgba(0,255,102,.18);box-shadow:0 18px 45px rgba(0,0,0,.35),0 0 18px rgba(0,255,102,.06)}.metric h1{color:#f5fff7}.metric:hover{transform:translateY(-2px);box-shadow:0 18px 45px rgba(0,0,0,.4),0 0 24px rgba(0,255,102,.12)}.side-profile{margin-top:16px;border:1px solid rgba(0,255,102,.18);border-radius:18px;min-height:155px;background:linear-gradient(180deg,rgba(0,0,0,.4),rgba(0,20,8,.35)),url('/img/hacker.png') center/cover no-repeat;padding:14px;display:flex;align-items:end}.side-profile b{background:rgba(0,0,0,.62);padding:6px 10px;border-radius:999px;color:#39ff14}.image-preview{width:100%;max-height:260px;object-fit:cover;border-radius:18px;border:1px solid rgba(0,255,102,.25);box-shadow:0 0 20px rgba(0,255,102,.08)}@media(max-width:900px){.layout{grid-template-columns:1fr}.side{height:auto;position:relative}.brand{margin-bottom:10px}.side .nav-title{display:none}.side a{display:inline-flex;padding:10px 12px}.main{padding:14px}.search,.form-grid{grid-template-columns:1fr}table{font-size:12px;display:block;overflow-x:auto}.actions{white-space:normal}.service-card{grid-template-columns:1fr}.hero h1{font-size:24px}.hero-hacker{grid-template-columns:1fr;min-height:420px;background-position:center}.system-card{justify-self:stretch}.hero-hacker h1{font-size:30px}}
  
  body.theme-hacker-green{--accent:#00ff66;--accent2:#28d7ff}body.theme-hacker-blue{--accent:#28d7ff;--accent2:#2f80ed}body.theme-hacker-red{--accent:#ff3b3b;--accent2:#ff9f43}body.theme-hacker-purple{--accent:#a855f7;--accent2:#28d7ff}body.theme-dark-pro{--accent:#94a3b8;--accent2:#2f80ed}.hero-hacker{background:linear-gradient(90deg,rgba(0,0,0,.84),rgba(0,0,0,.46)),url('/img/hacker.png?v=1'),radial-gradient(circle at 70% 25%,var(--accent),transparent 22%),linear-gradient(135deg,#020617,#0f172a);background-size:cover;background-position:center;border-color:color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:0 0 30px color-mix(in srgb,var(--accent) 24%,transparent)}.hero-content span,.online{color:var(--accent)}.btn.green,.metric:before{background:linear-gradient(135deg,var(--accent),var(--accent2))}.card.metric{border-color:color-mix(in srgb,var(--accent) 26%,transparent);box-shadow:0 12px 34px rgba(0,0,0,.35),0 0 18px color-mix(in srgb,var(--accent) 13%,transparent)}.theme-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.theme-card{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:14px;background:#08111f}.theme-preview{height:58px;border-radius:12px;margin-bottom:10px}.preview-hacker-green{background:linear-gradient(135deg,#001b0a,#00ff66)}.preview-hacker-blue{background:linear-gradient(135deg,#00152d,#28d7ff)}.preview-hacker-red{background:linear-gradient(135deg,#230707,#ff3b3b)}.preview-hacker-purple{background:linear-gradient(135deg,#18062b,#a855f7)}.preview-dark-pro{background:linear-gradient(135deg,#020617,#64748b)}.toast-wrap{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:10px}.toast{max-width:330px;background:rgba(2,6,23,.96);border:1px solid var(--accent);box-shadow:0 0 22px color-mix(in srgb,var(--accent) 25%,transparent);border-radius:16px;padding:12px;animation:toastIn .25s ease}.toast b{display:block;color:var(--accent);margin-bottom:4px}.notif-bell{position:fixed;right:18px;top:18px;z-index:40;background:#06111f;border:1px solid var(--accent);border-radius:999px;padding:10px 13px;box-shadow:0 0 14px color-mix(in srgb,var(--accent) 22%,transparent);font-weight:900}.notif-bell span{background:#ef4444;border-radius:999px;padding:2px 6px;margin-left:4px;font-size:12px}@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}.image-preview{max-width:100%;border-radius:16px;border:1px solid rgba(255,255,255,.12)}.status-action-form{display:grid;grid-template-columns:minmax(170px,1fr) auto;gap:6px;align-items:start;min-width:240px}.status-action-form input[name=motivo]{grid-column:1/-1}.status-action-form select{min-width:170px}.status-action-form .btn{height:42px}@media(max-width:900px){.status-action-form{grid-template-columns:1fr}.status-action-form .btn{width:100%}}
</style><script src="/socket.io/socket.io.js"></script></head><body class="theme-${temaAtual()}"><div class="toast-wrap" id="toastWrap"></div><div class="layout"><aside class="side"><div class="brand">CentralUnlocker</div><div class="nav-title">Painel</div><a href="/admin">📊 Dashboard</a><a href="/admin/pedidos">📋 Pedidos</a><a href="/admin/revendas">🏪 Revendas</a><a href="/admin/servicos">🛠 Serviços</a><a href="/admin/esim">📱 eSIM</a><a href="/admin/financeiro">💰 Financeiro</a><a href="/admin/relatorios">📈 Relatórios</a><a href="/admin/backup">💾 Backup</a><div class="nav-title">Sistema</div><a href="/admin/config">⚙️ Configurações</a><a href="/admin/logout">🚪 Sair</a><div class="side-profile"><b>Admin Master</b></div></aside><main class="main">${body}</main></div><script>
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
  texto += '\nDigite o número do serviço.';
  return texto;
}
async function enviarTexto(to, text) { if (sock && to) await sock.sendMessage(to, { text }); }

function parseMoney(v) { return Number(String(v || '0').replace(',', '.')) || 0; }
function limparNomePlano(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function keyPlanoEsim(row) { return `${row.plano_nome}|||${row.validade || ''}|||${Number(row.preco_revenda || 0)}|||${Number(row.preco_cliente || 0)}`; }
function textoInstrucoesEsim(plano) {
  return `📋 *COMO INSTALAR O eSIM*\n\n📱 Plano: *${plano}*\n\n*iPhone*\n1️⃣ Ajustes\n2️⃣ Celular\n3️⃣ Adicionar eSIM\n4️⃣ Usar QR Code\n5️⃣ Escaneie o QR Code enviado\n\n*Android*\n1️⃣ Configurações\n2️⃣ Rede e Internet / Conexões\n3️⃣ SIM Cards / Gerenciador de SIM\n4️⃣ Adicionar eSIM\n5️⃣ Escaneie o QR Code enviado\n\n⚠️ *Importante*\n• QR Code de uso único\n• Ative com internet conectada\n• Não compartilhe o QR Code\n• Depois de usado, ele não pode ser reutilizado\n\n🏢 CentralUnlocker`;
}
async function enviarImagemEsim(to, qr, caption) {
  const rel = String(qr.arquivo_qr || '').replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel.replace(/^public\//, ''));
  if (!fs.existsSync(file)) {
    await enviarTexto(to, `⚠️ QR Code não encontrado no servidor. Pedido #${qr.pedido_id || '-'}. Chame o suporte.`);
    return false;
  }
  await sock.sendMessage(to, { image: fs.readFileSync(file), caption });
  return true;
}
async function gruposEsimDisponiveis() {
  return await all(`SELECT plano_nome, validade, preco_revenda, preco_cliente, COUNT(*) qtd
    FROM esim_qrcodes
    WHERE status='DISPONIVEL'
    GROUP BY plano_nome, validade, preco_revenda, preco_cliente
    ORDER BY plano_nome ASC, preco_revenda ASC`);
}
async function iniciarCompraEsim(from, revenda) {
  const grupos = await gruposEsimDisponiveis();
  if (!grupos.length) {
    await enviarTexto(from, '📱 *eSIM*\n\n❌ Nenhum eSIM disponível no momento.');
    return;
  }
  pedidoSessao.set(from, { etapa: 'esim_escolha', grupos: grupos.map(g => ({ plano_nome: g.plano_nome, validade: g.validade || '', preco_revenda: Number(g.preco_revenda || 0), preco_cliente: Number(g.preco_cliente || 0), qtd: g.qtd })) });
  let txt = '📱 *eSIM DISPONÍVEIS*\n\n';
  grupos.forEach((g, i) => {
    txt += `${i + 1}️⃣ ${g.plano_nome}${g.validade ? ` - ${g.validade}` : ''}\n💰 ${brl(g.preco_revenda)}\n📦 Disponível: ${g.qtd}\n\n`;
  });
  txt += 'Digite o número do plano.\n\nDigite cancelar para sair.';
  await enviarTexto(from, txt.trim());
}
async function confirmarCompraEsim(from, revenda, escolha) {
  const sess = pedidoSessao.get(from);
  const g = sess?.grupos?.[Number(escolha) - 1];
  if (!g) { await enviarTexto(from, '❌ Plano inválido. Digite menu para começar novamente.'); return; }
  pedidoSessao.set(from, { etapa: 'esim_confirmar', plano: g });
  await enviarTexto(from, `📱 *${g.plano_nome}*${g.validade ? `\n⏱️ Validade: ${g.validade}` : ''}\n\n💰 Valor: ${brl(g.preco_revenda)}\n💳 Seu saldo atual: ${brl(revenda.saldo)}\n\n1️⃣ Confirmar compra\n2️⃣ Cancelar`);
}
async function concluirCompraEsim(from, revenda) {
  const sess = pedidoSessao.get(from);
  const g = sess?.plano;
  if (!g) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Sessão expirada. Digite menu.'); return; }
  const qr = await get(`SELECT * FROM esim_qrcodes WHERE status='DISPONIVEL' AND plano_nome=? AND IFNULL(validade,'')=? AND preco_revenda=? AND preco_cliente=? ORDER BY id ASC LIMIT 1`, [g.plano_nome, g.validade || '', g.preco_revenda, g.preco_cliente]);
  if (!qr) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Esse plano acabou no estoque. Digite menu para escolher outro.'); return; }
  const novoSaldo = Number(revenda.saldo || 0) - Number(g.preco_revenda || 0);
  const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_nome, entrada_valor, tipo_entrada, entrada_label, valor, status, cobrado, finalizado_em)
    VALUES ('ESIM', ?, ?, ?, ?, ?, ?, 'ESIM', 'QR Code', ?, 'FINALIZADO', 1, CURRENT_TIMESTAMP)`, [revenda.id, revenda.nome, from, revenda.whatsapp || jidToNumber(from), `eSIM ${g.plano_nome}`, `QR #${qr.id}`, g.preco_revenda]);
  await run(`UPDATE esim_qrcodes SET status='VENDIDO', revenda_id=?, revenda_nome=?, comprador_jid=?, pedido_id=?, vendido_em=CURRENT_TIMESTAMP WHERE id=?`, [revenda.id, revenda.nome, from, ins.lastID, qr.id]);
  await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novoSaldo, revenda.id]);
  pedidoSessao.delete(from);
  notificarPainel('esim', '📱 Venda eSIM', `${revenda.nome} - ${g.plano_nome}`);
  await enviarTexto(from, `✅ *Compra aprovada*\n\n📱 ${g.plano_nome}${g.validade ? `\n⏱️ ${g.validade}` : ''}\n💰 ${brl(g.preco_revenda)} descontado do saldo\n💳 Novo saldo: ${brl(novoSaldo)}\n🆔 Pedido #${ins.lastID}\n\nVou enviar o QR Code agora.`);
  const qrAtualizado = { ...qr, pedido_id: ins.lastID };
  await enviarImagemEsim(from, qrAtualizado, `📱 ${g.plano_nome}\n🆔 Pedido #${ins.lastID}\n\n⚠️ QR Code de uso único.`);
  await enviarTexto(from, textoInstrucoesEsim(g.plano_nome));
}

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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg || !msg.message) return;

    // TRAVA CRÍTICA: por padrão não processa mensagens enviadas pelo próprio WhatsApp/bot.
    // Exceção segura: quando o administrador digita na conversa da revenda:
    // cadastrar revenda Nome da Revenda
    // Assim o bot usa o número daquela conversa como WhatsApp da revenda.
    if (msg.key?.fromMe) {
      if (type && type !== 'notify') return;
      if (msg.key?.remoteJid === 'status@broadcast') return;
      if (isGroup(msg.key?.remoteJid)) return;

      const textoFromMe = getText(msg).trim();

      if (/^(cadastrar|ativar)\s+revenda(\s+.+)?$/i.test(textoFromMe)) {
        try {
          await cadastrarRevendaPelaConversaAdmin(msg.key.remoteJid, textoFromMe);
        } catch (e) {
          console.log('❌ ERRO CADASTRO FROMME:', e);
          await enviarTexto(msg.key.remoteJid, '❌ Erro ao cadastrar revenda.');
        }
        return;
      }

      // Permite que o admin cadastre serviço para cliente final direto na conversa do cliente.
      // Exemplo: servico desbloqueio tim 180 356789123456789
      if (/^servico\s+/i.test(textoFromMe)) {
        try {
          await tratarServicoClienteFinal(
            msg,
            msg.key.remoteJid,
            textoFromMe,
            textoFromMe.toLowerCase(),
            'Cliente'
          );
        } catch (e) {
          console.log('❌ ERRO SERVIÇO CLIENTE FROMME:', e);
          await enviarTexto(msg.key.remoteJid, '❌ Erro ao cadastrar serviço do cliente.');
        }
        return;
      }

      return;
    }

    if (type && type !== 'notify') return;
    if (msg.key?.remoteJid === 'status@broadcast') return;

    // Evita processar histórico antigo quando reconecta/reinicia no Render
    const tsRaw = Number(msg.messageTimestamp || 0);
    const msgTime = tsRaw > 9999999999 ? tsRaw : tsRaw * 1000;
    if (msgTime && msgTime < BOT_START_TIME - 60000) return;

    // Evita processar a mesma mensagem várias vezes
    const msgId = `${msg.key?.remoteJid || ''}:${msg.key?.id || ''}:${msg.key?.fromMe ? 'me' : 'in'}`;
    if (msg.key?.id && mensagensProcessadas.has(msgId)) return;
    if (msg.key?.id) mensagensProcessadas.add(msgId);
    if (mensagensProcessadas.size > 5000) mensagensProcessadas.clear();

    const from = msg.key.remoteJid;
    if (isGroup(from)) return;
    const textoOriginal = getText(msg).trim();
    if (!textoOriginal) return;
    const texto = textoOriginal.toLowerCase();
    const admin = msg.key.fromMe || isAdminJid(from);
    const nomeContato = nomeContatoSeguro(msg);
    console.log('📩', from, msg.key.fromMe ? 'FROMME' : '', textoOriginal);
    try { await tratarWhatsApp(msg, from, textoOriginal, texto, admin, nomeContato); }
    catch (e) { console.log('❌ ERRO WA:', e); await enviarTexto(from, '❌ Erro interno. Tente novamente.'); }
  });
}

async function tratarWhatsApp(msg, from, textoOriginal, texto, admin, nomeContato) {
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
    // Cadastro de revenda direto na conversa do WhatsApp
    if (await tratarCadastroRevendaConversa(from, textoOriginal, texto)) return;

    // Painel admin pelo WhatsApp removido. Mantém apenas backup manual e cadastro rápido de serviço em conversas de clientes.
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
  if (texto === 'esim' || texto === '/esim') { await iniciarCompraEsim(from, revenda); return; }

  const sess = pedidoSessao.get(from);
  if (sess?.etapa === 'menu') {
    if (texto === '1') { pedidoSessao.set(from, { etapa: 'servico_escolha' }); await enviarTexto(from, await listarServicosTexto(revenda)); return; }
    if (texto === '2') { await iniciarCompraEsim(from, revenda); return; }
    if (texto === '3') { pedidoSessao.delete(from); await enviarHistoricoRevenda(from, revenda); return; }
    if (texto === '4') { pedidoSessao.delete(from); await enviarContaRevenda(from, revenda); return; }
  }

  if (sess?.etapa === 'esim_escolha' && /^\d+$/.test(texto)) {
    await confirmarCompraEsim(from, revenda, texto);
    return;
  }

  if (sess?.etapa === 'esim_confirmar') {
    if (texto === '1' || texto === 'confirmar' || texto === 'sim') { await concluirCompraEsim(from, revenda); return; }
    if (texto === '2' || texto === 'cancelar' || texto === 'nao' || texto === 'não') { pedidoSessao.delete(from); await enviarTexto(from, '✅ Compra eSIM cancelada.'); return; }
    await enviarTexto(from, 'Digite 1 para confirmar ou 2 para cancelar.');
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

Pode enviar 1 IMEI ou vários em lote, um por linha.`);
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
    const tipoEntrada = normalizarTipoEntrada(servico.tipo_entrada);
    const entradaLabel = labelEntradaServico(servico);
    const loteId = validacao.entradas.length > 1 ? `LOTE-${Date.now()}` : null;
    let criados = [];
    let duplicados = [];

    for (const entrada of validacao.entradas) {
      const imeiBanco = tipoEntrada === 'IMEI' ? entrada : null;
      if (tipoEntrada === 'IMEI') {
        const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [entrada]);
        if (duplicado) { duplicados.push(entrada); continue; }
      }
      const ins = await run(`INSERT INTO pedidos (tipo, revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, entrada_valor, tipo_entrada, entrada_label, lote_id, valor, status)
        VALUES ('REVENDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [revenda.id, revenda.nome, from, revenda.whatsapp || numero, servico.id, servico.nome, imeiBanco, entrada, tipoEntrada, entradaLabel, loteId, valor]);
      criados.push({ id: ins.lastID, entrada });
    }

    pedidoSessao.delete(from);

    if (!criados.length) {
      await enviarTexto(from, `⚠️ Nenhum pedido novo foi criado.${duplicados.length ? `\n\nJá estavam em andamento:\n${duplicados.join('\n')}` : ''}`);
      return;
    }

    if (criados.length === 1) {
      notificarPainel('pedido', '🔔 Novo pedido recebido', `${revenda.nome} - ${servico.nome}`);
      await enviarTexto(from, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n${iconeEntradaServico(servico)} ${entradaLabel}: ${criados[0].entrada}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`);
      return;
    }

    notificarPainel('pedido', '📦 Novo lote recebido', `${revenda.nome} - ${criados.length} pedidos`);
    await enviarTexto(from, `✅ Lote recebido\n\n🛠 ${servico.nome}\n📦 Pedidos criados: ${criados.length}\n💰 Valor por item: ${brl(valor)}\n💰 Total: ${brl(valor * criados.length)}\n\nCada IMEI virou um pedido separado e será avisado de 1 em 1 quando finalizar.${duplicados.length ? `\n\n⚠️ Duplicados ignorados:\n${duplicados.join('\n')}` : ''}`);
    return;
  }

}

async function tratarServicoClienteFinal(msg, from, textoOriginal, texto, nomeContato) {
  if (!texto.startsWith('servico ')) return false;
  const partes = textoOriginal.trim().split(/\s+/);
  const imei = onlyDigits(partes[partes.length - 1]);
  const valor = Number(String(partes[partes.length - 2] || '').replace(',', '.'));
  const nomeServico = partes.slice(1, -2).join(' ').trim();
  if (!nomeServico || !valor || !validarIMEI(imei)) {
    await enviarTexto(from, '❌ Formato inválido ou IMEI inválido pelo verificador.\n\nUse:\nservico desbloqueio tim 180 356938035643809\n\nDica: peça ao cliente para digitar *#06# no aparelho.');
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
  await enviarTexto(from, `✅ Serviço cadastrado

🛠 ${servico.nome}
📱 ${imei}
💰 ${brl(valor)}

👤 Cliente: ${clienteNome || 'Cliente'}
📞 WhatsApp: ${clienteNumero || '-'}

📍 Pendente`);
  return true;
}

async function enviarHistoricoRevenda(from, revenda) {
  const rows = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 10', [revenda.id]);
  if (!rows.length) { await enviarTexto(from, '📋 Nenhum pedido encontrado.'); return; }
  let txt = `📋 *HISTÓRICO*\n\n`;
  for (const p of rows) txt += `${p.tipo === 'ESIM' ? '📱' : '🛠'} ${p.servico_nome}\n${textoEntradaPedido(p)}\n💰 ${brl(p.valor)}\n📍 ${p.status}\n\n`;
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
menu → 3 Histórico

🔹 *Ver conta*
menu → 4 Conta

🔹 *Gerar PIX*
Digite:

*pagar valor*

Exemplo:
*pagar 100*

🏢 CentralUnlocker`;
}
async function enviarBoasVindasTutorialRevenda(revenda) {
  const w = normalizarNumeroWhatsApp(revenda.whatsapp);
  const jid = revenda.jid || numberToJid(w);
  if (!jid) return false;
  try {
    await enviarTexto(jid, await mensagemBoasVindasRevenda(revenda));
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
    const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo) VALUES (?, ?, ?, ?, ?, "ATIVA", 0)', [nome, w, jid, `rev${Date.now()}`, 'sem-senha']);
    revenda = await get('SELECT * FROM revendas WHERE id=?', [ins.lastID]);
  }

  notificarPainel('revenda', '🏪 Revenda cadastrada', revenda.nome);
  await enviarTexto(from, `✅ *REVENDA CADASTRADA*\n\n🏪 Nome: ${revenda.nome}\n📞 WhatsApp: ${revenda.whatsapp}\n🆔 ID: #${revenda.id}\n📍 Status: ${revenda.status}\n\nO bot vai enviar as boas-vindas para a revenda agora.`);
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
    await enviarTexto(from, `✅ Nome salvo: *${nome}*\n\nAgora envie o WhatsApp da revenda com DDD.\n\nExemplo:\n75999999999\nou\n5575999999999`);
    return true;
  }

  if (sess?.etapa === 'cadastro_revenda_numero') {
    await cadastrarRevendaDireto(from, sess.nome, textoOriginal);
    adminSessao.delete(from);
    return true;
  }

  return false;
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
  if (opcao === '2') { await enviarTexto(from, `📋 *PEDIDOS*\n\nComandos:\npendentes\nprocesso\nfinalizados\ncancelados\nimei 356789123456789\nprocessar ID\nfinalizar ID\ncancelar ID motivo`); return; }
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
  for (const r of rows) txt += `#${r.id}\n${r.nome}\n📞 ${r.whatsapp || '-'}\n📍 ${r.status}\n💰 ${textoSaldoCurto(r.saldo)}\n\n`;
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
async function adminCancelarPedido(from, id, motivo) {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  if (!pedido) { await enviarTexto(from, '❌ Pedido não encontrado.'); return; }
  await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, id]);
  const atual = await get('SELECT * FROM pedidos WHERE id=?', [id]);
  await notificarPedido(atual, 'cancelar', motivo);
  notificarPainel('cancelado', '❌ Pedido cancelado', `Pedido #${id}`);
  await enviarTexto(from, `❌ Pedido #${id} cancelado.`);
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
async function notificarPedido(pedido, tipo, motivo = '') {
  let jid = pedido.revenda_jid || pedido.cliente_jid;
  if (!jid && pedido.revenda_numero) jid = numberToJid(pedido.revenda_numero);
  if (!jid && pedido.cliente_whatsapp) jid = numberToJid(pedido.cliente_whatsapp);
  if (!jid) return;
  if (tipo === 'processo') await enviarTexto(jid, `🔄 Serviço em processo\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n💰 Valor: ${brl(pedido.valor)}`);
  if (tipo === 'finalizar') {
    if (pedido.tipo === 'REVENDA') {
      const rev = await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]);
      await enviarTexto(jid, `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\n💰 Valor: ${brl(pedido.valor)}\n\n💳 Situação da conta:\n${textoSituacaoSaldo(rev?.saldo || 0)}\n\n🏢 CentralUnlocker`);
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
app.post('/admin/pedido/:id/processo', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'processo'); } res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/finalizar', async (req, res) => { const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) await finalizarPedido(p); res.redirect(req.get('referer') || '/admin/pedidos'); });
app.post('/admin/pedido/:id/cancelar', async (req, res) => { const motivo = req.body.motivo || 'Não informado'; const p = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]); if (p) { await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, p.id]); const a = await get('SELECT * FROM pedidos WHERE id=?', [p.id]); await notificarPedido(a, 'cancelar', motivo); } res.redirect(req.get('referer') || '/admin/pedidos'); });

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas WHERE status != "REMOVIDA" ORDER BY id DESC');
  let html = `<h1>🏪 Revendas</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome da revenda" required><input name="whatsapp" placeholder="WhatsApp 5575..." required></div><button class="btn green">Adicionar Revenda</button></form></div><table><tr><th>ID</th><th>Nome</th><th>WhatsApp</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) html += `<tr><td>#${r.id}</td><td>${safeHtml(r.nome)}</td><td>${safeHtml(r.whatsapp || '-')}</td><td><span class="pill">${safeHtml(r.status)}</span></td><td>${brl(r.saldo)}</td><td class="actions"><a class="btn" href="/admin/revenda/${r.id}/editar">✏️ Editar</a><a class="btn" href="/admin/revenda/${r.id}/precos">Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">💳 Conta</a><a class="btn" href="/admin/revenda/${r.id}/historico">Histórico</a><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/boasvindas"><button class="btn green">📨 Boas-vindas</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="${r.status === 'BLOQUEADA' ? 'ATIVA' : 'BLOQUEADA'}"><button class="btn orange">${r.status === 'BLOQUEADA' ? '🔓 Desbloquear' : '🔒 Bloquear'}</button></form><form class="forms-inline" method="post" action="/admin/revenda/${r.id}/status"><input type="hidden" name="status" value="REMOVIDA"><button class="btn red" onclick="return confirm('Remover revenda?')">🗑️ Remover</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Revendas', html));
});
app.post('/admin/revendas', async (req, res) => {
  const w = normalizarNumeroWhatsApp(req.body.whatsapp);
  const nome = String(req.body.nome || '').trim();
  const existe = await get('SELECT * FROM revendas WHERE whatsapp=? AND status != "REMOVIDA"', [w]);
  if (existe) {
    await run('UPDATE revendas SET nome=?, status="ATIVA", jid=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [nome, numberToJid(w), existe.id]);
    await enviarBoasVindasTutorialRevenda({ ...existe, nome, whatsapp: w, jid: numberToJid(w) });
  } else {
    const ins = await run('INSERT INTO revendas (nome, whatsapp, jid, login, senha, status, saldo) VALUES (?, ?, ?, ?, ?, "ATIVA", 0)', [nome, w, numberToJid(w), `rev${Date.now()}`, 'sem-senha']);
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
app.get('/admin/revenda/:id/editar', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); res.send(page('Editar Revenda', `<h1>✏️ Editar Revenda</h1><div class="card"><form method="post"><input name="nome" value="${safeHtml(r.nome)}" required><br><br><input name="whatsapp" value="${safeHtml(r.whatsapp)}" required><br><br><select name="status"><option ${r.status==='ATIVA'?'selected':''}>ATIVA</option><option ${r.status==='BLOQUEADA'?'selected':''}>BLOQUEADA</option><option ${r.status==='REMOVIDA'?'selected':''}>REMOVIDA</option></select><br><br><button class="btn green">Salvar</button></form></div>`)); });
app.post('/admin/revenda/:id/editar', async (req, res) => { const w = normalizarNumeroWhatsApp(req.body.whatsapp); await run('UPDATE revendas SET nome=?, whatsapp=?, jid=?, status=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [req.body.nome, w, numberToJid(w), req.body.status, req.params.id]); res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/precos', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC'); let html = `<h1>💰 Preços - ${safeHtml(r.nome)}</h1><form method="post"><table><tr><th>Serviço</th><th>Preço da revenda</th></tr>`; for (const s of servs) { const preco = await precoDaRevenda(r.id, s.id); html += `<tr><td>${safeHtml(s.nome)}</td><td><input name="preco_${s.id}" value="${preco}"></td></tr>`; } html += `</table><br><button class="btn green">Salvar preços</button></form>`; res.send(page('Preços', html)); });
app.post('/admin/revenda/:id/precos', async (req, res) => { const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1'); for (const s of servs) { const preco = Number(String(req.body[`preco_${s.id}`] || '0').replace(',', '.')); await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, preco]); } res.redirect('/admin/revendas'); });
app.get('/admin/revenda/:id/conta', async (req, res) => { const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]); const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 50', [r.id]); let html = `<h1>💳 Conta da Revenda</h1><div class="card"><h2>${safeHtml(r.nome)}</h2><h1>${brl(r.saldo)}</h1><form method="post" action="/admin/revenda/${r.id}/pagamento"><input name="valor" placeholder="Valor pago"><br><br><button class="btn green">Registrar Pagamento</button></form></div><h2>Histórico</h2>${pedidoTable(pedidos)}`; res.send(page('Conta', html)); });
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


app.get('/admin/esim', async (req, res) => {
  const grupos = await all(`SELECT plano_nome, validade, preco_revenda, preco_cliente,
    SUM(CASE WHEN status='DISPONIVEL' THEN 1 ELSE 0 END) disponiveis,
    SUM(CASE WHEN status='VENDIDO' THEN 1 ELSE 0 END) vendidos,
    COUNT(*) total
    FROM esim_qrcodes GROUP BY plano_nome, validade, preco_revenda, preco_cliente ORDER BY plano_nome ASC`);
  const rows = await all('SELECT * FROM esim_qrcodes ORDER BY id DESC LIMIT 200');
  let html = `<div class="hero"><h1>📱 eSIM</h1><p>Adicione QR Codes digitando o nome do plano. A revenda compra pelo WhatsApp e o sistema entrega automaticamente com instruções.</p></div>`;
  html += `<div class="card"><h2>➕ Adicionar QR Code</h2><form method="post" action="/admin/esim/upload"><div class="form-grid"><div><label>Nome do plano</label><input name="plano_nome" placeholder="Ex: TIM 70GB" required></div><div><label>Validade</label><input name="validade" placeholder="Ex: 30 dias"></div><div><label>Preço revenda</label><input name="preco_revenda" placeholder="Ex: 55" required></div><div><label>Preço cliente</label><input name="preco_cliente" placeholder="Opcional"></div></div><br><label>Imagem do QR Code</label><input id="esimFile" type="file" accept="image/png,image/jpeg,image/webp" required><input id="esimData" type="hidden" name="imageData"><br><br><button class="btn green" id="esimBtn" disabled>Salvar QR Code</button></form><p class="mini-help">Você só envia a imagem do QR Code. Não precisa código manual.</p><script>const ef=document.getElementById('esimFile'),ed=document.getElementById('esimData'),eb=document.getElementById('esimBtn');ef&&ef.addEventListener('change',()=>{const file=ef.files&&ef.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{ed.value=r.result;eb.disabled=false;eb.textContent='Salvar QR Code';};eb.disabled=true;eb.textContent='Carregando imagem...';r.readAsDataURL(file);});</script></div>`;
  html += `<div class="card"><h2>📦 Resumo do estoque</h2><table><tr><th>Plano</th><th>Validade</th><th>Preço revenda</th><th>Disponível</th><th>Vendido</th><th>Total</th></tr>`;
  if (!grupos.length) html += `<tr><td colspan="6" class="empty">Nenhum QR cadastrado ainda.</td></tr>`;
  for (const g of grupos) html += `<tr><td>${safeHtml(g.plano_nome)}</td><td>${safeHtml(g.validade || '-')}</td><td>${brl(g.preco_revenda)}</td><td><span class="pill">${g.disponiveis || 0}</span></td><td>${g.vendidos || 0}</td><td>${g.total}</td></tr>`;
  html += `</table></div>`;
  html += `<div class="card"><h2>🖼️ QR Codes cadastrados</h2><table><tr><th>ID</th><th>QR</th><th>Plano</th><th>Preço</th><th>Status</th><th>Pedido</th><th>Ações</th></tr>`;
  for (const q of rows) {
    html += `<tr><td>#${q.id}</td><td><img src="/${safeHtml(q.arquivo_qr)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px"></td><td>${safeHtml(q.plano_nome)}<br><span class="muted">${safeHtml(q.validade || '')}</span></td><td>${brl(q.preco_revenda)}</td><td>${q.status === 'DISPONIVEL' ? '✅ Disponível' : '✅ Vendido'}</td><td>${q.pedido_id ? `#${q.pedido_id}` : '-'}</td><td><a class="btn" href="/${safeHtml(q.arquivo_qr)}" target="_blank">Ver</a>${q.status === 'DISPONIVEL' ? `<form class="forms-inline" method="post" action="/admin/esim/${q.id}/excluir"><button class="btn red" onclick="return confirm('Excluir este QR?')">Excluir</button></form>` : `<form class="forms-inline" method="post" action="/admin/esim/${q.id}/reenviar"><button class="btn green">Reenviar</button></form>`}</td></tr>`;
  }
  html += `</table></div>`;
  res.send(page('eSIM', html));
});

app.post('/admin/esim/upload', async (req, res) => {
  const plano = limparNomePlano(req.body.plano_nome);
  const validade = String(req.body.validade || '').trim();
  const precoRevenda = parseMoney(req.body.preco_revenda);
  const precoCliente = parseMoney(req.body.preco_cliente);
  const data = String(req.body.imageData || '');
  const m = data.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!plano || !precoRevenda || !m) return res.status(400).send(page('Erro', '<h1>❌ Dados inválidos</h1><p>Volte e confira plano, preço e imagem.</p>'));
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const filename = `esim_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
  const filepath = path.join(ESIM_IMG_DIR, filename);
  fs.writeFileSync(filepath, Buffer.from(m[2], 'base64'));
  const rel = `esim/${filename}`;
  await run(`INSERT INTO esim_qrcodes (plano_nome, validade, preco_revenda, preco_cliente, arquivo_qr, status) VALUES (?, ?, ?, ?, ?, 'DISPONIVEL')`, [plano, validade, precoRevenda, precoCliente, rel]);
  notificarPainel('esim', '📱 QR eSIM adicionado', plano);
  res.redirect('/admin/esim');
});

app.post('/admin/esim/:id/excluir', async (req, res) => {
  const q = await get('SELECT * FROM esim_qrcodes WHERE id=? AND status="DISPONIVEL"', [req.params.id]);
  if (q) {
    try { fs.unlinkSync(path.join(PUBLIC_DIR, String(q.arquivo_qr || '').replace(/^\/+/, ''))); } catch(e) {}
    await run('DELETE FROM esim_qrcodes WHERE id=?', [q.id]);
  }
  res.redirect('/admin/esim');
});

app.post('/admin/esim/:id/reenviar', async (req, res) => {
  const q = await get('SELECT * FROM esim_qrcodes WHERE id=?', [req.params.id]);
  if (q && q.comprador_jid) {
    await enviarImagemEsim(q.comprador_jid, q, `📱 ${q.plano_nome}\n${q.pedido_id ? `🆔 Pedido #${q.pedido_id}\n` : ''}\n⚠️ QR Code de uso único.`);
    await enviarTexto(q.comprador_jid, textoInstrucoesEsim(q.plano_nome));
  }
  res.redirect('/admin/esim');
});

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
if (!fs.existsSync(ESIM_IMG_DIR)) fs.mkdirSync(ESIM_IMG_DIR, { recursive: true });
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
iniciarWhatsApp();
