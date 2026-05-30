require("dotenv").config();

const express = require("express");
const axios = require("axios");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PIXGO_API = "https://pixgo.org/api/v1";
const ADMIN_NUMBER = onlyDigits(process.env.ADMIN_NUMBER || "");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "database.db");
const DB_DIR = path.dirname(DB_PATH);
const BACKUP_DIR = path.join(DB_DIR, "backups");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

let sock = null;
let qrCodeBase64 = null;
let conectado = false;

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS clientes (
    jid TEXT PRIMARY KEY,
    numero TEXT,
    nome TEXT,
    saldo REAL DEFAULT 0,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS servicos (
    protocolo INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_jid TEXT,
    numero TEXT,
    nome TEXT,
    imei TEXT,
    descricao TEXT,
    valor REAL,
    status TEXT DEFAULT 'EM ANDAMENTO',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    concluido_em TEXT,
    pago INTEGER DEFAULT 0
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_jid TEXT,
    numero TEXT,
    nome TEXT,
    valor REAL,
    origem TEXT,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS pix_pedidos (
    payment_id TEXT PRIMARY KEY,
    cliente_jid TEXT,
    valor REAL,
    status TEXT DEFAULT 'pending',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function getChatJid(msg) {
  return (
    msg?.key?.remoteJidAlt ||
    msg?.key?.remoteJid ||
    ""
  );
}

function jidToNumber(jid) {
  return onlyDigits(String(jid || "").split("@")[0]);
}

function nomeSeguro(nome) {
  const n = String(nome || "").trim();
  if (!n) return "Cliente";
  // Quando a mensagem é enviada pelo próprio admin, o pushName pode ser o nome do bot.
  // Não queremos salvar CentralUnlocker como nome do cliente.
  if (/central\s*unlocker|centralunlocker/i.test(n)) return "Cliente";
  return n;
}

async function obterClienteDaConversa(msg, fallbackNome = "Cliente") {
  const jid = getChatJid(msg);
  const existente = await get("SELECT * FROM clientes WHERE jid = ?", [jid]);

  let nome = "Cliente";

  if (msg?.key?.fromMe) {
    // Admin digitando na conversa do cliente: usa o nome já salvo anteriormente.
    nome = existente?.nome || nomeSeguro(fallbackNome);
  } else {
    nome = nomeSeguro(msg.pushName || fallbackNome || existente?.nome || "Cliente");
  }

  return await ensureCliente(jid, nome);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function todayFileDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function dateBR(dateString) {
  if (!dateString) return "-";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return String(dateString);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function isAdminMessage(msg) {
  if (msg.key.fromMe) return true;

  const participant = msg.key.participant || msg.participant || "";
  const senderNumber = jidToNumber(participant || msg.key.remoteJid);

  return ADMIN_NUMBER && senderNumber === ADMIN_NUMBER;
}

function isGroupJid(jid) {
  return String(jid || "").endsWith("@g.us");
}

function getTextMessage(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  );
}

async function ensureCliente(jid, nome = "Cliente") {
  const numero = jidToNumber(jid);
  const existente = await get("SELECT * FROM clientes WHERE jid = ?", [jid]);

  if (!existente) {
    await run(
      "INSERT INTO clientes (jid, numero, nome, saldo) VALUES (?, ?, ?, 0)",
      [jid, numero, nome || "Cliente"]
    );
  } else if (nome && nome !== "Cliente" && existente.nome !== nome) {
    await run(
      "UPDATE clientes SET nome = ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?",
      [nome, jid]
    );
  }

  return await get("SELECT * FROM clientes WHERE jid = ?", [jid]);
}

async function iniciarWhatsApp() {
  await initDB();

  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("✅ QR CODE GERADO");
      qrCodeBase64 = await QRCode.toDataURL(qr);
      conectado = false;
    }

    if (connection === "open") {
      console.log("✅ WHATSAPP CONECTADO");
      qrCodeBase64 = null;
      conectado = true;
    }

    if (connection === "close") {
      conectado = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ WHATSAPP DESCONECTOU:", statusCode);

      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => iniciarWhatsApp(), 5000);
      } else {
        console.log("⚠️ Sessão encerrada. Apague a pasta auth e escaneie novo QR.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = getChatJid(msg);
    if (isGroupJid(from)) return;

    const textoOriginal = getTextMessage(msg).trim();
    if (!textoOriginal) return;

    const comando = textoOriginal.toLowerCase();
    const admin = isAdminMessage(msg);
    const nomeCliente = nomeSeguro(msg.pushName || "Cliente");

    console.log("📩 MENSAGEM:", comando, "FROM:", from, "ADMIN:", admin);

    try {
      // Admin digitando na conversa do cliente aparece como fromMe e remoteJid = cliente.
      if (admin) {
        if (await tratarComandoAdmin(msg, from, textoOriginal, comando, nomeCliente)) return;
      } else {
        await ensureCliente(from, nomeCliente);
      }

      await tratarComandoCliente(msg, from, textoOriginal, comando, nomeCliente);
    } catch (error) {
      console.log("❌ ERRO AO PROCESSAR MENSAGEM:", error);
      await enviarTexto(from, "❌ Erro interno. Tente novamente.");
    }
  });
}

async function tratarComandoAdmin(msg, from, textoOriginal, comando, nomeCliente) {
  const partes = textoOriginal.trim().split(/\s+/);
  const cmd = partes[0].toLowerCase();

  if (cmd === "nome") {
    const novoNome = partes.slice(1).join(" ").trim();
    if (!novoNome) {
      await enviarTexto(from, "❌ Use: nome Adriana Silva");
      return true;
    }

    const jid = getChatJid(msg);
    await ensureCliente(jid, novoNome);
    await run("UPDATE clientes SET nome = ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?", [novoNome, jid]);

    await enviarTexto(from,
`✅ *NOME DO CLIENTE ATUALIZADO*

👤 Cliente: ${novoNome}

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "numero") {
    const novoNumero = onlyDigits(partes[1] || "");
    if (!novoNumero) {
      await enviarTexto(from, "❌ Use: numero 5575999999999");
      return true;
    }

    const jid = getChatJid(msg);
    await ensureCliente(jid, nomeCliente);
    await run("UPDATE clientes SET numero = ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?", [novoNumero, jid]);

    await enviarTexto(from,
`✅ *NÚMERO DO CLIENTE ATUALIZADO*

📱 Número: ${novoNumero}

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "servico") {
    const valor = Number(partes[1]?.replace(",", "."));
    const imei = partes[partes.length - 1];
    const descricao = partes.slice(2, -1).join(" ");

    if (!valor || !descricao || !/^\d{14,17}$/.test(imei)) {
      await enviarTexto(from,
`❌ Formato inválido.

Use:
servico 180 desbloqueio tim 356789123456789`
      );
      return true;
    }

    const cliente = await obterClienteDaConversa(msg, nomeCliente);

    const result = await run(
      `INSERT INTO servicos (cliente_jid, numero, nome, imei, descricao, valor, status)
       VALUES (?, ?, ?, ?, ?, ?, 'EM ANDAMENTO')`,
      [cliente.jid, cliente.numero, cliente.nome, imei, descricao, valor]
    );

    const protocolo = result.lastID;

    await enviarTexto(from,
`📌 *SERVIÇO REGISTRADO*

🔢 Protocolo: #${protocolo}

👤 Cliente: ${cliente.nome}
📱 Número: ${cliente.numero}

📱 IMEI:
${imei}

🛠 Serviço:
${descricao}

💰 Valor:
${formatMoney(valor)}

📍 Status:
EM ANDAMENTO

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "pendentes") {
    const rows = await all("SELECT * FROM servicos WHERE status = 'EM ANDAMENTO' ORDER BY protocolo ASC LIMIT 50");

    if (!rows.length) {
      await enviarTexto(from, "✅ Nenhum serviço pendente.\n\n🏢 *CentralUnlocker*");
      return true;
    }

    let texto = "📋 *SERVIÇOS PENDENTES*\n\n";
    for (const s of rows) {
      texto += `🔢 #${s.protocolo}\n👤 ${s.nome}\n📱 ${s.numero}\n📱 IMEI: ${s.imei}\n🛠 ${s.descricao}\n💰 ${formatMoney(s.valor)}\n\n━━━━━━━━━━━━━━\n\n`;
    }
    texto += `📌 Total: ${rows.length} serviço(s) pendente(s)\n\n🏢 *CentralUnlocker*`;
    await enviarTexto(from, texto);
    return true;
  }

  if (cmd === "feito") {
    const protocolo = Number(partes[1]);
    if (!protocolo) {
      await enviarTexto(from, "❌ Use: feito 1001");
      return true;
    }

    const servico = await get("SELECT * FROM servicos WHERE protocolo = ?", [protocolo]);
    if (!servico) {
      await enviarTexto(from, "❌ Protocolo não encontrado.");
      return true;
    }

    await run("UPDATE servicos SET status = 'CONCLUÍDO', concluido_em = CURRENT_TIMESTAMP WHERE protocolo = ?", [protocolo]);

    // Soma como saldo em aberto do cliente.
    await ensureCliente(servico.cliente_jid, servico.nome);
    await run(
      "UPDATE clientes SET saldo = saldo + ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?",
      [servico.valor, servico.cliente_jid]
    );

    await enviarTexto(servico.cliente_jid,
`✅ *SERVIÇO CONCLUÍDO*

🔢 Protocolo: #${servico.protocolo}

📱 IMEI:
${servico.imei}

🛠 Serviço:
${servico.descricao}

💰 Valor em aberto:
${formatMoney(servico.valor)}

📌 *COMO PAGAR*

Digite:
*pagar ${Number(servico.valor).toFixed(2)}*

O sistema irá gerar automaticamente o PIX.

🏢 *CentralUnlocker*`
    );

    await enviarTexto(from,
`✅ Serviço #${servico.protocolo} marcado como concluído.

Mensagem enviada ao cliente.

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "buscarimei") {
    const imei = partes[1];
    if (!imei) {
      await enviarTexto(from, "❌ Use: buscarimei 356789123456789");
      return true;
    }

    const rows = await all("SELECT * FROM servicos WHERE imei = ? ORDER BY protocolo DESC", [imei]);
    if (!rows.length) {
      await enviarTexto(from,
`❌ *IMEI NÃO ENCONTRADO*

IMEI:
${imei}

🏢 *CentralUnlocker*`
      );
      return true;
    }

    let texto = "🔎 *RESULTADO DA CONSULTA*\n\n";
    for (const s of rows.slice(0, 10)) {
      texto += `🔢 Protocolo: #${s.protocolo}\n👤 Cliente: ${s.nome}\n📱 Número: ${s.numero}\n\n📱 IMEI:\n${s.imei}\n\n🛠 Serviço:\n${s.descricao}\n\n💰 Valor:\n${formatMoney(s.valor)}\n\n📍 Status:\n${s.status}\n\n📅 Data:\n${dateBR(s.criado_em)}\n\n━━━━━━━━━━━━━━\n\n`;
    }
    texto += "🏢 *CentralUnlocker*";
    await enviarTexto(from, texto);
    return true;
  }

  if (cmd === "debito") {
    const valor = Number(partes[1]?.replace(",", "."));
    if (!valor || valor <= 0) {
      await enviarTexto(from, "❌ Use: debito 180");
      return true;
    }

    const cliente = await obterClienteDaConversa(msg, nomeCliente);
    await run("UPDATE clientes SET saldo = saldo + ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?", [valor, cliente.jid]);
    const atualizado = await get("SELECT * FROM clientes WHERE jid = ?", [cliente.jid]);

    await enviarTexto(from,
`📌 *DÉBITO ADICIONADO*

👤 Cliente: ${atualizado.nome}

💵 Valor adicionado:
${formatMoney(valor)}

💰 Saldo em aberto:
${formatMoney(atualizado.saldo)}

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "pagou") {
    const valor = Number(partes[1]?.replace(",", "."));
    if (!valor || valor <= 0) {
      await enviarTexto(from, "❌ Use: pagou 180");
      return true;
    }

    const cliente = await obterClienteDaConversa(msg, nomeCliente);
    const novoSaldo = Math.max(0, Number(cliente.saldo || 0) - valor);

    await run("UPDATE clientes SET saldo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?", [novoSaldo, cliente.jid]);
    await run(
      "INSERT INTO pagamentos (cliente_jid, numero, nome, valor, origem) VALUES (?, ?, ?, ?, 'manual')",
      [cliente.jid, cliente.numero, cliente.nome, valor]
    );

    if (novoSaldo <= 0) {
      await enviarTexto(from,
`✅ *CONTA QUITADA!*

👤 Cliente: ${cliente.nome}

📱 Número: ${cliente.numero}

Obrigado pelo pagamento e pela confiança em nosso trabalho. 💚

🏢 *CentralUnlocker*

Será um prazer atendê-lo novamente.`
      );
    } else {
      await enviarTexto(from,
`✅ *PAGAMENTO REGISTRADO*

👤 ${cliente.nome}

💵 Valor pago:
${formatMoney(valor)}

💰 Saldo em aberto:
${formatMoney(novoSaldo)}

🏢 *CentralUnlocker*`
      );
    }
    return true;
  }

  if (cmd === "devedores") {
    const rows = await all("SELECT * FROM clientes WHERE saldo > 0 ORDER BY saldo DESC");
    if (!rows.length) {
      await enviarTexto(from, "✅ Nenhum cliente com saldo em aberto.\n\n🏢 *CentralUnlocker*");
      return true;
    }

    let total = 0;
    let texto = "📊 *CLIENTES COM SALDO EM ABERTO*\n\n";
    for (const c of rows) {
      total += Number(c.saldo || 0);
      texto += `👤 ${c.nome}\n📱 ${c.numero}\n💰 ${formatMoney(c.saldo)}\n\n`;
    }
    texto += `━━━━━━━━━━━━━━\n\n👥 Clientes: ${rows.length}\n\n💵 Total a receber:\n${formatMoney(total)}\n\n🏢 *CentralUnlocker*`;
    await enviarTexto(from, texto);
    return true;
  }

  if (cmd === "total") {
    const clientes = await get("SELECT COUNT(*) as qtd, COALESCE(SUM(saldo),0) as total FROM clientes WHERE saldo > 0");
    const pendentes = await get("SELECT COUNT(*) as qtd FROM servicos WHERE status = 'EM ANDAMENTO'");

    await enviarTexto(from,
`📈 *RESUMO FINANCEIRO*

📋 Serviços pendentes:
${pendentes.qtd}

👥 Clientes devendo:
${clientes.qtd}

💵 Total a receber:
${formatMoney(clientes.total)}

🏢 *CentralUnlocker*`
    );
    return true;
  }

  if (cmd === "historico") {
    const rows = await all("SELECT * FROM pagamentos ORDER BY id DESC LIMIT 20");
    if (!rows.length) {
      await enviarTexto(from, "📜 Nenhum pagamento registrado ainda.\n\n🏢 *CentralUnlocker*");
      return true;
    }

    let texto = "📜 *HISTÓRICO DE PAGAMENTOS*\n\n";
    for (const p of rows) {
      texto += `👤 ${p.nome}\n📱 ${p.numero}\n💰 ${formatMoney(p.valor)}\n📅 ${dateBR(p.criado_em)}\n\n`;
    }
    texto += "🏢 *CentralUnlocker*";
    await enviarTexto(from, texto);
    return true;
  }

  if (cmd === "cliente") {
    const numero = onlyDigits(partes[1] || "");
    if (!numero) {
      await enviarTexto(from, "❌ Use: cliente 5575999999999");
      return true;
    }

    const c = await get("SELECT * FROM clientes WHERE numero LIKE ?", [`%${numero}%`]);
    if (!c) {
      await enviarTexto(from, "❌ Cliente não encontrado.");
      return true;
    }

    const servicos = await all("SELECT * FROM servicos WHERE cliente_jid = ? ORDER BY protocolo DESC LIMIT 10", [c.jid]);
    let texto = `👤 *CLIENTE*\n\n👤 ${c.nome}\n📱 ${c.numero}\n\n💰 Saldo em aberto:\n${formatMoney(c.saldo)}\n\n`;

    if (servicos.length) {
      texto += "📋 Últimos serviços:\n\n";
      for (const s of servicos) {
        texto += `#${s.protocolo} - ${s.descricao} - ${s.status}\n`;
      }
    }
    texto += "\n🏢 *CentralUnlocker*";
    await enviarTexto(from, texto);
    return true;
  }

  if (cmd === "backup") {
    const arquivo = await criarBackup();
    await enviarTexto(from,
`✅ *BACKUP GERADO*

📅 Data: ${todayFileDate()}
📁 Arquivo: ${path.basename(arquivo)}

🏢 *CentralUnlocker*`
    );
    return true;
  }

  return false;
}

async function tratarComandoCliente(msg, from, textoOriginal, comando, nomeCliente) {
  if (comando === "menu") {
    await enviarTexto(from,
`🤖 *CENTRALUNLOCKER*

Digite:
*pagar 10*

Ou consulte sua conta:
*saldo*`
    );
    return;
  }

  if (comando === "saldo") {
    const cliente = await ensureCliente(from, nomeCliente);

    await enviarTexto(from,
`📋 *SUA CONTA*

👤 ${cliente.nome}

💰 Saldo em aberto:
${formatMoney(cliente.saldo)}

Status:
${Number(cliente.saldo || 0) > 0 ? "PENDENTE" : "SEM DÉBITOS"}

${Number(cliente.saldo || 0) > 0 ? `Para pagar digite:\n*pagar ${Number(cliente.saldo).toFixed(2)}*` : ""}

🏢 *CentralUnlocker*`
    );
    return;
  }

  if (!comando.startsWith("pagar")) return;

  const valor = Number(comando.split(" ")[1]?.replace(",", "."));

  if (!valor || valor < 10) {
    await enviarTexto(from, "❌ Valor mínimo R$10");
    return;
  }

  await enviarTexto(from, "⏳ Gerando PIX...");

  const pix = await gerarPix(valor, from);

  if (!pix) {
    await enviarTexto(from,
`❌ Erro ao gerar PIX

Confira:
- API Key PixGo
- Conta validada
- Saldo disponível`
    );
    return;
  }

  const paymentId = pix?.data?.payment_id || pix?.payment_id;
  const qrCode =
    pix?.data?.qr_code ||
    pix?.data?.qr_code_text ||
    pix?.data?.pix_code ||
    pix?.data?.copy_paste ||
    pix?.qr_code;

  await enviarTexto(from,
`✅ *PIX GERADO COM SUCESSO!*

💰 Valor: ${formatMoney(valor)}

📋 Vou enviar o código Pix copia e cola na próxima mensagem.

👉 Toque e segure na próxima mensagem para copiar.

⏳ Expira em 20 minutos.`
  );

  await enviarTexto(from, qrCode || "PIX indisponível");

  if (paymentId) {
    await run(
      "INSERT OR REPLACE INTO pix_pedidos (payment_id, cliente_jid, valor, status) VALUES (?, ?, ?, 'pending')",
      [paymentId, from, valor]
    );
    verificarPagamento(paymentId, from, valor);
  }
}

async function enviarTexto(to, text) {
  if (!sock) return;
  await sock.sendMessage(to, { text });
}

async function gerarPix(valor, cliente) {
  try {
    const body = {
      amount: Number(valor),
      description: `Pagamento WhatsApp ${cliente}`,
      customer_name: "Cliente WhatsApp",
      customer_cpf: "12345678901",
      customer_email: "cliente@exemplo.com",
      customer_phone: "11999999999",
      customer_address: "Rua Principal, 123",
      external_id: `pedido_${Date.now()}`
    };

    const response = await axios.post(
      `${PIXGO_API}/payment/create`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": process.env.PIXGO_API_KEY
        },
        timeout: 30000
      }
    );

    console.log("✅ PIX GERADO:", response.data);
    return response.data;
  } catch (error) {
    console.log("========== ERRO PIXGO ==========");
    console.log("STATUS:", error.response?.status);
    console.log("DATA:", error.response?.data);
    console.log("MESSAGE:", error.message);
    console.log("================================");
    return null;
  }
}

async function consultarStatus(paymentId) {
  try {
    const response = await axios.get(`${PIXGO_API}/payment/${paymentId}/status`, {
      headers: { "X-API-Key": process.env.PIXGO_API_KEY },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.log("ERRO STATUS:", error.response?.data || error.message);
    return null;
  }
}

async function verificarPagamento(paymentId, numeroCliente, valorPix = 0) {
  let tentativas = 0;

  const intervalo = setInterval(async () => {
    tentativas++;
    const status = await consultarStatus(paymentId);
    console.log("STATUS PAGAMENTO:", status);

    if (status?.success && status.data?.status === "completed") {
      clearInterval(intervalo);
      await run("UPDATE pix_pedidos SET status = 'completed' WHERE payment_id = ?", [paymentId]);

      const cliente = await ensureCliente(numeroCliente, "Cliente");
      const valor = Number(valorPix || 0);

      if (valor > 0) {
        const novoSaldo = Math.max(0, Number(cliente.saldo || 0) - valor);
        await run("UPDATE clientes SET saldo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE jid = ?", [novoSaldo, numeroCliente]);
        await run(
          "INSERT INTO pagamentos (cliente_jid, numero, nome, valor, origem) VALUES (?, ?, ?, ?, 'pixgo')",
          [numeroCliente, cliente.numero, cliente.nome, valor]
        );
      }

      await enviarTexto(numeroCliente,
`✅ *PAGAMENTO CONFIRMADO!*

Obrigado pela compra 💚

🏢 *CentralUnlocker*`
      );
      return;
    }

    if (status?.success && status.data?.status === "expired") {
      clearInterval(intervalo);
      await run("UPDATE pix_pedidos SET status = 'expired' WHERE payment_id = ?", [paymentId]);

      await enviarTexto(numeroCliente,
`⌛ *PIX EXPIRADO*

O tempo de pagamento terminou.

Digite novamente:
*pagar valor*

Exemplo:
*pagar 10*`
      );
      return;
    }

    if (tentativas >= 40) {
      clearInterval(intervalo);
      await enviarTexto(numeroCliente,
`⌛ *PIX EXPIRADO*

Digite novamente:
*pagar valor*`
      );
    }
  }, 30000);
}

async function criarBackup() {
  const destino = path.join(BACKUP_DIR, `backup-${todayFileDate()}-${Date.now()}.db`);
  await new Promise((resolve, reject) => {
    db.backup(destino, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  console.log("✅ BACKUP CRIADO:", destino);
  return destino;
}

cron.schedule("0 2 * * *", async () => {
  try {
    await criarBackup();
  } catch (error) {
    console.log("❌ ERRO NO BACKUP AUTOMÁTICO:", error);
  }
}, {
  timezone: "America/Sao_Paulo"
});

app.get("/", (req, res) => {
  if (qrCodeBase64) {
    return res.send(`
<html>
<body style="background:#111;color:white;text-align:center;font-family:Arial;padding-top:40px;">
<h1>📱 ESCANEIE O QR</h1>
<img src="${qrCodeBase64}" width="300"/>
<p>WhatsApp > Aparelhos conectados > Conectar aparelho</p>
</body>
</html>`);
  }

  res.send(`
<html>
<body style="background:#111;color:white;text-align:center;font-family:Arial;padding-top:40px;">
<h1>✅ BOT CENTRALUNLOCKER ONLINE</h1>
<p>${conectado ? "WhatsApp conectado ✅" : "Aguardando QR..."}</p>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SERVIDOR ONLINE NA PORTA ${PORT}`);
});

iniciarWhatsApp();
