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
let pendingRestoreFile = null;
let db = new sqlite3.Database(DB_PATH);

const cadastroSessao = new Map();
const pedidoSessao = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
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
function brl(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function nowBR(d = new Date()) { return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
function today() { return new Date().toISOString().slice(0, 10); }
function getText(msg) {
  return msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
}
function isGroup(jid) { return String(jid || '').endsWith('@g.us'); }
function isAdminJid(jid) { return ADMIN_NUMBER && jidToNumber(jid) === ADMIN_NUMBER; }

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS revendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    whatsapp TEXT,
    jid TEXT,
    login TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
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
    valor REAL,
    origem TEXT,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pix_pedidos (
    payment_id TEXT PRIMARY KEY,
    revenda_id INTEGER,
    revenda_jid TEXT,
    valor REAL,
    status TEXT DEFAULT 'pending',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

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
  body{font-family:Arial,sans-serif;background:#0f172a;color:#e5e7eb;margin:0} a{color:#93c5fd;text-decoration:none}.wrap{max-width:1200px;margin:0 auto;padding:20px}.nav{background:#111827;padding:14px;display:flex;gap:14px;flex-wrap:wrap}.card{background:#111827;border:1px solid #273449;border-radius:12px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.btn{display:inline-block;background:#2563eb;color:white;padding:9px 12px;border-radius:8px;border:0;cursor:pointer;margin:3px}.btn.red{background:#dc2626}.btn.green{background:#16a34a}.btn.gray{background:#475569}.btn.orange{background:#f97316}input,select,textarea{padding:10px;border-radius:8px;border:1px solid #334155;background:#020617;color:#e5e7eb;width:100%;box-sizing:border-box}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #273449;padding:9px;text-align:left}.muted{color:#94a3b8}.status{font-weight:bold}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  </style></head><body><div class="nav"><b>🏢 CentralUnlocker</b><a href="/admin">Dashboard</a><a href="/admin/pedidos">Pedidos</a><a href="/admin/revendas">Revendas</a><a href="/admin/servicos">Serviços</a><a href="/admin/financeiro">Financeiro</a><a href="/admin/backup">Backup</a></div><div class="wrap">${body}</div></body></html>`;
}

async function precoDaRevenda(revendaId, servicoId) {
  const pr = await get('SELECT preco FROM precos_revenda WHERE revenda_id=? AND servico_id=?', [revendaId, servicoId]);
  if (pr && Number(pr.preco) > 0) return Number(pr.preco);
  const s = await get('SELECT preco_padrao FROM servicos_catalogo WHERE id=?', [servicoId]);
  return Number(s?.preco_padrao || 0);
}

async function listarServicosParaRevenda(revenda) {
  const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let texto = `✅ Bem-vindo ${revenda.nome}\n\n`;
  for (let i = 0; i < servicos.length; i++) {
    const preco = await precoDaRevenda(revenda.id, servicos[i].id);
    texto += `${i + 1} - ${servicos[i].nome} - ${brl(preco)}\n`;
  }
  texto += '\nDigite o número do serviço.';
  return texto;
}

async function enviarTexto(to, text) {
  if (!sock || !to) return;
  await sock.sendMessage(to, { text });
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

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    if (isGroup(from)) return;
    const textoOriginal = getText(msg).trim();
    if (!textoOriginal) return;
    const texto = textoOriginal.toLowerCase();
    console.log('📩', from, textoOriginal);
    try { await tratarWhatsApp(from, textoOriginal, texto); }
    catch (e) { console.log('❌ ERRO WA:', e); await enviarTexto(from, '❌ Erro interno. Tente novamente.'); }
  });
}

async function tratarWhatsApp(from, textoOriginal, texto) {
  const numero = jidToNumber(from);
  const partes = textoOriginal.trim().split(/\s+/);

  if (isAdminJid(from) && texto === 'backup') {
    const arq = await criarBackup();
    await enviarTexto(from, `✅ BACKUP GERADO\n\n📁 ${path.basename(arq)}\n\n🏢 CentralUnlocker`);
    return;
  }

  if (texto === '/registrar' || texto === 'registrar') {
    cadastroSessao.set(from, { etapa: 'login' });
    await enviarTexto(from, 'Login:');
    return;
  }

  const cad = cadastroSessao.get(from);
  if (cad?.etapa === 'login') {
    cad.login = textoOriginal.trim(); cad.etapa = 'senha'; cadastroSessao.set(from, cad);
    await enviarTexto(from, 'Senha:');
    return;
  }
  if (cad?.etapa === 'senha') {
    const rev = await get('SELECT * FROM revendas WHERE login=? AND senha=? AND status="ATIVA"', [cad.login, textoOriginal.trim()]);
    if (!rev) { cadastroSessao.delete(from); await enviarTexto(from, '❌ Login ou senha inválidos.'); return; }
    await run('UPDATE revendas SET jid=?, whatsapp=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [from, numero, rev.id]);
    cadastroSessao.delete(from);
    const atual = await get('SELECT * FROM revendas WHERE id=?', [rev.id]);
    await enviarTexto(from, await listarServicosParaRevenda(atual));
    return;
  }

  let revenda = await get('SELECT * FROM revendas WHERE jid=? AND status="ATIVA"', [from]);
  if (!revenda) {
    if (texto === 'menu') await enviarTexto(from, 'Digite /registrar para acessar.');
    return;
  }

  if (texto === 'servicos' || texto === '/servicos' || texto === 'menu') {
    await enviarTexto(from, await listarServicosParaRevenda(revenda));
    return;
  }

  if (texto === 'conta' || texto === '/conta' || texto === 'saldo' || texto === '/saldo') {
    await enviarTexto(from, `🏪 ${revenda.nome}\n\n💳 Saldo em aberto:\n${brl(revenda.saldo)}\n\n🏢 CentralUnlocker`);
    return;
  }

  if (texto.startsWith('pagar')) {
    const valor = Number(partes[1]?.replace(',', '.')) || Number(revenda.saldo || 0);
    if (!valor || valor < 10) { await enviarTexto(from, '❌ Valor mínimo R$10.'); return; }
    await enviarTexto(from, '⏳ Gerando PIX...');
    const pix = await gerarPix(valor, from);
    if (!pix) { await enviarTexto(from, '❌ Erro ao gerar PIX.'); return; }
    const paymentId = pix?.data?.payment_id || pix?.payment_id;
    const qrCode = pix?.data?.qr_code || pix?.data?.qr_code_text || pix?.data?.pix_code || pix?.data?.copy_paste || pix?.qr_code;
    await enviarTexto(from, `✅ PIX GERADO\n\n💰 Valor: ${brl(valor)}\n\nVou enviar o copia e cola na próxima mensagem.\n⏳ Expira em 20 minutos.`);
    await enviarTexto(from, qrCode || 'PIX indisponível');
    if (paymentId) {
      await run('INSERT OR REPLACE INTO pix_pedidos (payment_id, revenda_id, revenda_jid, valor, status) VALUES (?, ?, ?, ?, "pending")', [paymentId, revenda.id, from, valor]);
      verificarPagamento(paymentId, revenda.id, from, valor);
    }
    return;
  }

  const sessPedido = pedidoSessao.get(from);
  if (sessPedido?.etapa === 'imei') {
    const imei = onlyDigits(textoOriginal);
    if (!/^\d{14,17}$/.test(imei)) { await enviarTexto(from, '❌ IMEI inválido. Envie apenas os números.'); return; }
    const servico = await get('SELECT * FROM servicos_catalogo WHERE id=? AND ativo=1', [sessPedido.servicoId]);
    if (!servico) { pedidoSessao.delete(from); await enviarTexto(from, '❌ Serviço indisponível.'); return; }
    const duplicado = await get('SELECT * FROM pedidos WHERE imei=? AND status IN ("PENDENTE","EM PROCESSO")', [imei]);
    if (duplicado) { pedidoSessao.delete(from); await enviarTexto(from, `⚠️ Esse IMEI já está em andamento.\n\n🛠 ${duplicado.servico_nome}\n📍 ${duplicado.status}`); return; }
    const valor = await precoDaRevenda(revenda.id, servico.id);
    await run(`INSERT INTO pedidos (revenda_id, revenda_nome, revenda_jid, revenda_numero, servico_id, servico_nome, imei, valor, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDENTE')`, [revenda.id, revenda.nome, from, numero, servico.id, servico.nome, imei, valor]);
    pedidoSessao.delete(from);
    await enviarTexto(from, `✅ Pedido recebido\n\n🛠 ${servico.nome}\n📱 ${imei}\n💰 Valor: ${brl(valor)}\n\n📍 Pendente`);
    return;
  }

  if (/^\d+$/.test(texto)) {
    const pos = Number(texto);
    const servicos = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
    const servico = servicos[pos - 1];
    if (!servico) { await enviarTexto(from, '❌ Serviço inválido. Digite menu para ver a lista.'); return; }
    pedidoSessao.set(from, { etapa: 'imei', servicoId: servico.id });
    await enviarTexto(from, '📱 Informe o IMEI:');
    return;
  }
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
      const rev = await get('SELECT * FROM revendas WHERE id=?', [revendaId]);
      const novo = Math.max(0, Number(rev.saldo || 0) - Number(valorPix || 0));
      await run('UPDATE revendas SET saldo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [novo, revendaId]);
      await run('INSERT INTO pagamentos (revenda_id, revenda_nome, valor, origem) VALUES (?, ?, ?, "pixgo")', [revendaId, rev.nome, valorPix]);
      await run('UPDATE pix_pedidos SET status="completed" WHERE payment_id=?', [paymentId]);
      await enviarTexto(jid, `✅ Pagamento confirmado\n\n💳 Novo saldo:\n${brl(novo)}\n\n🏢 CentralUnlocker`);
    }
    if (status?.success && status.data?.status === 'expired') {
      clearInterval(interval); await run('UPDATE pix_pedidos SET status="expired" WHERE payment_id=?', [paymentId]); await enviarTexto(jid, '⌛ PIX expirado. Digite pagar para gerar outro.');
    }
    if (tentativas >= 40) clearInterval(interval);
  }, 30000);
}

async function notificarPedido(pedido, tipo, motivo = '') {
  if (!pedido.revenda_jid) return;
  if (tipo === 'processo') {
    await enviarTexto(pedido.revenda_jid, `🔄 Serviço em processo\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n💰 Valor: ${brl(pedido.valor)}`);
  }
  if (tipo === 'finalizar') {
    const rev = await get('SELECT * FROM revendas WHERE id=?', [pedido.revenda_id]);
    await enviarTexto(pedido.revenda_jid, `✅ Serviço concluído\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\n💰 Valor: ${brl(pedido.valor)}\n\n💳 Saldo:\n${brl(rev.saldo)}\n\n🏢 CentralUnlocker`);
  }
  if (tipo === 'cancelar') {
    await enviarTexto(pedido.revenda_jid, `❌ Serviço cancelado\n\n🛠 ${pedido.servico_nome}\n📱 ${pedido.imei}\n\nMotivo:\n${motivo || 'Não informado'}\n\n🏢 CentralUnlocker`);
  }
}

// HOME/QR
app.get('/', (req, res) => {
  if (qrCodeBase64) return res.send(page('QR', `<div class="card" style="text-align:center"><h1>📱 ESCANEIE O QR</h1><img src="${qrCodeBase64}" width="300"><p>WhatsApp > Aparelhos conectados</p></div>`));
  res.send(page('Online', `<div class="card" style="text-align:center"><h1>✅ CENTRALUNLOCKER ONLINE</h1><p>${conectado ? 'WhatsApp conectado ✅' : 'Aguardando QR...'}</p><p><a href="/admin">Acessar painel admin</a></p></div>`));
});

app.use('/admin', basicAuth);

app.get('/admin', async (req, res) => {
  const p = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="PENDENTE"');
  const ep = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="EM PROCESSO"');
  const f = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="FINALIZADO"');
  const c = await get('SELECT COUNT(*) qtd FROM pedidos WHERE status="CANCELADO"');
  const saldo = await get('SELECT COALESCE(SUM(saldo),0) total FROM revendas');
  const rev = await get('SELECT COUNT(*) qtd FROM revendas WHERE status="ATIVA"');
  res.send(page('Dashboard', `<h1>📊 Dashboard</h1><div class="grid">
  <div class="card"><h2>🟡 Pendentes</h2><h1>${p.qtd}</h1></div><div class="card"><h2>🔄 Em Processo</h2><h1>${ep.qtd}</h1></div><div class="card"><h2>✅ Finalizados</h2><h1>${f.qtd}</h1></div><div class="card"><h2>❌ Cancelados</h2><h1>${c.qtd}</h1></div><div class="card"><h2>💰 Total a receber</h2><h1>${brl(saldo.total)}</h1></div><div class="card"><h2>🏪 Revendas ativas</h2><h1>${rev.qtd}</h1></div>
  </div>`));
});

app.get('/admin/pedidos', async (req, res) => {
  const status = req.query.status || '';
  const rows = await all(`SELECT * FROM pedidos ${status ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 300`, status ? [status] : []);
  let html = `<div class="top"><h1>📋 Pedidos</h1><div><a class="btn gray" href="/admin/pedidos">Todos</a><a class="btn" href="/admin/pedidos?status=PENDENTE">Pendentes</a><a class="btn orange" href="/admin/pedidos?status=EM PROCESSO">Em Processo</a><a class="btn green" href="/admin/pedidos?status=FINALIZADO">Finalizados</a><a class="btn red" href="/admin/pedidos?status=CANCELADO">Cancelados</a></div></div><table><tr><th>ID</th><th>Revenda</th><th>Serviço</th><th>IMEI</th><th>Valor</th><th>Status</th><th>Ações</th></tr>`;
  for (const o of rows) {
    html += `<tr><td>#${o.id}</td><td>${o.revenda_nome}</td><td>${o.servico_nome}</td><td>${o.imei}</td><td>${brl(o.valor)}</td><td class="status">${o.status}</td><td>
    <form style="display:inline" method="post" action="/admin/pedido/${o.id}/processo"><button class="btn orange">🔄 Em Processo</button></form>
    <form style="display:inline" method="post" action="/admin/pedido/${o.id}/finalizar"><button class="btn green">✅ Finalizar</button></form>
    <form style="display:inline" method="post" action="/admin/pedido/${o.id}/cancelar"><input name="motivo" placeholder="Motivo" style="width:150px"><button class="btn red">❌ Cancelar</button></form>
    </td></tr>`;
  }
  html += '</table>';
  res.send(page('Pedidos', html));
});

app.post('/admin/pedido/:id/processo', async (req, res) => {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) { await run('UPDATE pedidos SET status="EM PROCESSO", atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.id]); await notificarPedido(pedido, 'processo'); }
  res.redirect('/admin/pedidos');
});
app.post('/admin/pedido/:id/finalizar', async (req, res) => {
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) {
    await run('UPDATE pedidos SET status="FINALIZADO", finalizado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.id]);
    if (!pedido.cobrado) {
      await run('UPDATE revendas SET saldo=saldo+?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [pedido.valor, pedido.revenda_id]);
      await run('UPDATE pedidos SET cobrado=1 WHERE id=?', [pedido.id]);
    }
    const atualizado = await get('SELECT * FROM pedidos WHERE id=?', [pedido.id]);
    await notificarPedido(atualizado, 'finalizar');
  }
  res.redirect('/admin/pedidos');
});
app.post('/admin/pedido/:id/cancelar', async (req, res) => {
  const motivo = req.body.motivo || 'Não informado';
  const pedido = await get('SELECT * FROM pedidos WHERE id=?', [req.params.id]);
  if (pedido) { await run('UPDATE pedidos SET status="CANCELADO", motivo_cancelamento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?', [motivo, pedido.id]); await notificarPedido(pedido, 'cancelar', motivo); }
  res.redirect('/admin/pedidos');
});

app.get('/admin/revendas', async (req, res) => {
  const rows = await all('SELECT * FROM revendas ORDER BY id DESC');
  let html = `<h1>🏪 Revendas</h1><div class="card"><form method="post"><div class="grid"><input name="nome" placeholder="Nome da revenda" required><input name="whatsapp" placeholder="WhatsApp 5575..."><input name="login" placeholder="Login" required><input name="senha" placeholder="Senha" required></div><button class="btn green">Adicionar Revenda</button></form></div><table><tr><th>ID</th><th>Nome</th><th>WhatsApp</th><th>Login</th><th>Status</th><th>Saldo</th><th>Ações</th></tr>`;
  for (const r of rows) html += `<tr><td>${r.id}</td><td>${r.nome}</td><td>${r.whatsapp || '-'}</td><td>${r.login}</td><td>${r.status}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/precos">Preços</a><a class="btn gray" href="/admin/revenda/${r.id}/conta">Conta</a></td></tr>`;
  html += '</table>';
  res.send(page('Revendas', html));
});
app.post('/admin/revendas', async (req, res) => {
  await run('INSERT INTO revendas (nome, whatsapp, login, senha) VALUES (?, ?, ?, ?)', [req.body.nome, onlyDigits(req.body.whatsapp), req.body.login, req.body.senha]);
  res.redirect('/admin/revendas');
});

app.get('/admin/revenda/:id/precos', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1 ORDER BY id ASC');
  let html = `<h1>💰 Preços - ${r.nome}</h1><form method="post"><table><tr><th>Serviço</th><th>Preço da revenda</th></tr>`;
  for (const s of servs) { const preco = await precoDaRevenda(r.id, s.id); html += `<tr><td>${s.nome}</td><td><input name="preco_${s.id}" value="${preco}"></td></tr>`; }
  html += `</table><button class="btn green">Salvar preços</button></form>`;
  res.send(page('Preços', html));
});
app.post('/admin/revenda/:id/precos', async (req, res) => {
  const servs = await all('SELECT * FROM servicos_catalogo WHERE ativo=1');
  for (const s of servs) {
    const preco = Number(String(req.body[`preco_${s.id}`] || '0').replace(',', '.'));
    await run('INSERT OR REPLACE INTO precos_revenda (revenda_id, servico_id, preco) VALUES (?, ?, ?)', [req.params.id, s.id, preco]);
  }
  res.redirect('/admin/revendas');
});

app.get('/admin/revenda/:id/conta', async (req, res) => {
  const r = await get('SELECT * FROM revendas WHERE id=?', [req.params.id]);
  const pedidos = await all('SELECT * FROM pedidos WHERE revenda_id=? ORDER BY id DESC LIMIT 50', [r.id]);
  let html = `<h1>💳 Conta da Revenda</h1><div class="card"><h2>${r.nome}</h2><h1>${brl(r.saldo)}</h1><form method="post" action="/admin/revenda/${r.id}/pagamento"><input name="valor" placeholder="Valor pago"><button class="btn green">Registrar Pagamento</button></form></div><h2>Pedidos</h2><table><tr><th>ID</th><th>Serviço</th><th>IMEI</th><th>Valor</th><th>Status</th></tr>`;
  for (const p of pedidos) html += `<tr><td>#${p.id}</td><td>${p.servico_nome}</td><td>${p.imei}</td><td>${brl(p.valor)}</td><td>${p.status}</td></tr>`;
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
  for (const s of rows) html += `<tr><td>${s.id}</td><td><a href="/admin/servico/${s.id}/imeis">${s.nome}</a></td><td>${brl(s.preco_padrao)}</td><td>${s.ativo ? 'Ativo' : 'Inativo'}</td><td>${s.total}</td><td><form style="display:inline" method="post" action="/admin/servico/${s.id}/toggle"><button class="btn gray">${s.ativo ? 'Desativar' : 'Ativar'}</button></form></td></tr>`;
  html += '</table>';
  res.send(page('Serviços', html));
});
app.post('/admin/servicos', async (req, res) => {
  await run('INSERT INTO servicos_catalogo (nome, preco_padrao, ativo) VALUES (?, ?, 1)', [req.body.nome, Number(String(req.body.preco || '0').replace(',', '.'))]);
  const revs = await all('SELECT * FROM revendas WHERE status="ATIVA" AND jid IS NOT NULL');
  for (const r of revs) await enviarTexto(r.jid, `🆕 Novo serviço disponível\n\n🛠 ${req.body.nome}\n\nDigite menu para ver sua tabela.`);
  res.redirect('/admin/servicos');
});
app.post('/admin/servico/:id/toggle', async (req, res) => {
  const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]);
  if (s) await run('UPDATE servicos_catalogo SET ativo=? WHERE id=?', [s.ativo ? 0 : 1, s.id]);
  res.redirect('/admin/servicos');
});
app.get('/admin/servico/:id/imeis', async (req, res) => {
  const s = await get('SELECT * FROM servicos_catalogo WHERE id=?', [req.params.id]);
  const rows = await all('SELECT * FROM pedidos WHERE servico_id=? ORDER BY id DESC LIMIT 500', [req.params.id]);
  let html = `<h1>📱 IMEIs - ${s.nome}</h1><table><tr><th>ID</th><th>IMEI</th><th>Revenda</th><th>Valor</th><th>Status</th><th>Data</th></tr>`;
  for (const p of rows) html += `<tr><td>#${p.id}</td><td>${p.imei}</td><td>${p.revenda_nome}</td><td>${brl(p.valor)}</td><td>${p.status}</td><td>${p.criado_em}</td></tr>`;
  html += '</table>';
  res.send(page('IMEIs', html));
});

app.get('/admin/financeiro', async (req, res) => {
  const revs = await all('SELECT * FROM revendas ORDER BY saldo DESC');
  let total = 0;
  let html = '<h1>💰 Financeiro</h1><table><tr><th>Revenda</th><th>Saldo</th><th>Ação</th></tr>';
  for (const r of revs) { total += Number(r.saldo || 0); html += `<tr><td>${r.nome}</td><td>${brl(r.saldo)}</td><td><a class="btn" href="/admin/revenda/${r.id}/conta">Conta</a></td></tr>`; }
  html += `</table><div class="card"><h2>Total em aberto: ${brl(total)}</h2></div>`;
  res.send(page('Financeiro', html));
});

async function criarBackup() {
  const destino = path.join(BACKUP_DIR, `backup-${today()}-${Date.now()}.db`);
  await new Promise((resolve, reject) => db.backup(destino, (err) => err ? reject(err) : resolve()));
  console.log('✅ BACKUP CRIADO:', destino);
  return destino;
}
function listarBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort().reverse();
}
app.get('/admin/backup', async (req, res) => {
  const backs = listarBackups();
  let html = `<h1>💾 Backup</h1><form method="post" action="/admin/backup/criar"><button class="btn green">📦 Criar Backup</button></form><table><tr><th>#</th><th>Arquivo</th><th>Ações</th></tr>`;
  backs.forEach((b, i) => html += `<tr><td>${i + 1}</td><td>${b}</td><td><a class="btn" href="/admin/backup/download/${encodeURIComponent(b)}">⬇️ Baixar</a><form style="display:inline" method="post" action="/admin/backup/restaurar"><input type="hidden" name="file" value="${b}"><button class="btn red" onclick="return confirm('Restaurar este backup?')">🔄 Restaurar</button></form></td></tr>`);
  html += '</table>';
  res.send(page('Backup', html));
});
app.post('/admin/backup/criar', async (req, res) => { await criarBackup(); res.redirect('/admin/backup'); });
app.get('/admin/backup/download/:file', (req, res) => {
  const file = path.basename(req.params.file); res.download(path.join(BACKUP_DIR, file));
});
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
