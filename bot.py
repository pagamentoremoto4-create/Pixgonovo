# -*- coding: utf-8 -*-

import os
import sqlite3
import threading
import requests
import time
import shutil
from datetime import datetime
from flask import Flask, request, jsonify
import telebot
from telebot import types

# =========================
# CONFIGURAÇÕES
# =========================
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
PIXGO_API_KEY = os.getenv("PIXGO_API_KEY", "")
BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
BACKUP_INTERVAL_HOURS = int(os.getenv("BACKUP_INTERVAL_HOURS", "6"))
SUPORTE_TELEGRAM = os.getenv("SUPORTE_TELEGRAM", "alinesantos3360").replace("@", "")

PIXGO_URL = "https://pixgo.org/api/v1/payment/create"
DB = "database.db"

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

usuarios_deposito = {}
aguardando_ddd = {}
entrega_manual = {}

# =========================
# BANCO
# =========================
def db():
    conn = sqlite3.connect(DB, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs("backups", exist_ok=True)

    conn = db()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS usuarios (
        user_id INTEGER PRIMARY KEY,
        saldo REAL DEFAULT 0
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS planos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        gb TEXT,
        validade TEXT,
        preco REAL,
        quantidade INTEGER DEFAULT 0,
        ativo INTEGER DEFAULT 1
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plano_id INTEGER,
        valor REAL,
        tipo TEXT,
        pixgo_id TEXT,
        status TEXT DEFAULT 'pendente',
        ddd TEXT,
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        pago_em TEXT,
        entregue_em TEXT
    )
    """)

    # Atualização automática para bancos antigos
    colunas = [c[1] for c in cur.execute("PRAGMA table_info(pedidos)").fetchall()]
    if "ddd" not in colunas:
        cur.execute("ALTER TABLE pedidos ADD COLUMN ddd TEXT")
    if "criado_em" not in colunas:
        cur.execute("ALTER TABLE pedidos ADD COLUMN criado_em TEXT DEFAULT CURRENT_TIMESTAMP")
    if "pago_em" not in colunas:
        cur.execute("ALTER TABLE pedidos ADD COLUMN pago_em TEXT")
    if "entregue_em" not in colunas:
        cur.execute("ALTER TABLE pedidos ADD COLUMN entregue_em TEXT")

    conn.commit()
    conn.close()


init_db()


# =========================
# FUNÇÕES GERAIS
# =========================
def criar_usuario(user_id):
    conn = db()
    conn.execute(
        "INSERT OR IGNORE INTO usuarios (user_id, saldo) VALUES (?, 0)",
        (user_id,)
    )
    conn.commit()
    conn.close()


def menu():
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row("💰 Meu Saldo", "💳 Depositar")
    kb.row("📱 Comprar eSIM", "📦 Meus Pedidos")
    kb.row("👥 Indicar Amigos", "🆘 Suporte")
    return kb


def is_claro_pre(nome):
    n = nome.upper().replace("É", "E")
    return "CLARO" in n and "PRE" in n


def gerar_pix(valor, descricao, pedido_id):
    payload = {
        "amount": float(valor),
        "description": descricao,
        "webhook_url": f"{BASE_URL}/webhook/pixgo",
        "external_reference": str(pedido_id),
        "external_id": str(pedido_id)
    }

    headers = {
        "X-API-Key": PIXGO_API_KEY,
        "Content-Type": "application/json"
    }

    try:
        r = requests.post(PIXGO_URL, json=payload, headers=headers, timeout=20)
        resposta = r.json()
        print("PIXGO RESPOSTA:", resposta)

        data = resposta.get("data", resposta)

        pix_id = (
            data.get("payment_id")
            or data.get("id")
            or data.get("transaction_id")
        )

        pix_copia = (
            data.get("qr_code")
            or data.get("pix_copy_paste")
            or data.get("copy_paste")
            or data.get("pix")
            or data.get("brcode")
        )

        if not pix_copia:
            return 400, resposta, None, None

        return 200, resposta, pix_id, pix_copia

    except Exception as e:
        print("ERRO PIXGO:", e)
        return 500, {"erro": str(e)}, None, None


def gerar_backup():
    os.makedirs("backups", exist_ok=True)
    agora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    arquivo_backup = f"backups/backup_{agora}.db"
    shutil.copy(DB, arquivo_backup)
    return arquivo_backup


def backup_automatico():
    time.sleep(30)

    while True:
        try:
            arquivo_backup = gerar_backup()

            with open(arquivo_backup, "rb") as arquivo:
                bot.send_document(
                    ADMIN_ID,
                    arquivo,
                    caption="💾 Backup automático do banco de dados"
                )

            print("BACKUP AUTOMATICO ENVIADO:", arquivo_backup)

        except Exception as e:
            print("ERRO BACKUP AUTOMATICO:", e)

        time.sleep(max(1, BACKUP_INTERVAL_HOURS) * 3600)


def texto_instalacao(ddd=None):
    extra_ddd = ""
    if ddd:
        extra_ddd = f"\n📍 *DDD escolhido:* {ddd}\n"

    return (
        "🎉 *eSIM Adquirido!*\n"
        "━━━━━━━━━━━━━━\n\n"
        "📲 Escaneie o QR Code enviado acima para instalar seu eSIM.\n"
        f"{extra_ddd}\n"
        "🍎 *iPhone (iOS)*\n"
        "1. Ajustes\n"
        "2. Celular\n"
        "3. Adicionar eSIM\n"
        "4. Usar QR Code\n\n"
        "🤖 *Android*\n"
        "1. Configurações\n"
        "2. Conexões\n"
        "3. Gerenciador SIM\n"
        "4. Adicionar eSIM\n"
        "5. Escanear QR Code\n\n"
        "━━━━━━━━━━━━━━\n"
        "⚠️ QR Code de uso único.\n"
        "Guarde com segurança."
    )


def avisar_admin_pedido(pedido_id):
    conn = db()
    pedido = conn.execute("""
        SELECT pedidos.*, planos.nome, planos.gb, planos.validade
        FROM pedidos
        LEFT JOIN planos ON planos.id = pedidos.plano_id
        WHERE pedidos.id=?
    """, (pedido_id,)).fetchone()
    conn.close()

    if not pedido:
        return

    ddd_txt = f"\n📍 DDD: *{pedido['ddd']}*" if pedido["ddd"] else ""

    bot.send_message(
        ADMIN_ID,
        f"🚨 *Novo pedido aprovado!*\n\n"
        f"🆔 Pedido: *#{pedido['id']}*\n"
        f"👤 Cliente: `{pedido['user_id']}`\n"
        f"📱 Plano: *{pedido['nome']}*\n"
        f"📶 {pedido['gb']} · ⏱ {pedido['validade']}"
        f"{ddd_txt}\n"
        f"💰 Valor: *R$ {pedido['valor']:.2f}*\n\n"
        f"➡️ Para entregar:\n"
        f"`/entregar {pedido['id']}`",
        parse_mode="Markdown"
    )


# =========================
# CLIENTE
# =========================
@bot.message_handler(commands=["start"])
def start(msg):
    criar_usuario(msg.from_user.id)
    usuarios_deposito.pop(msg.from_user.id, None)
    aguardando_ddd.pop(msg.from_user.id, None)

    bot.send_message(
        msg.chat.id,
        "👋 Bem-vindo ao *Esim_bot*\n\nEscolha uma opção abaixo:",
        parse_mode="Markdown",
        reply_markup=menu()
    )


@bot.message_handler(commands=["cancel", "cancelar"])
def cancelar(msg):
    usuarios_deposito.pop(msg.from_user.id, None)
    aguardando_ddd.pop(msg.from_user.id, None)
    bot.send_message(msg.chat.id, "❌ Operação cancelada.", reply_markup=menu())


@bot.message_handler(commands=["id"])
def ver_id(msg):
    criar_usuario(msg.from_user.id)
    bot.send_message(
        msg.chat.id,
        f"🆔 Seu ID é:\n\n`{msg.from_user.id}`",
        parse_mode="Markdown"
    )


@bot.message_handler(func=lambda m: m.text == "💰 Meu Saldo")
def meu_saldo(msg):
    criar_usuario(msg.from_user.id)

    conn = db()
    user = conn.execute(
        "SELECT saldo FROM usuarios WHERE user_id=?",
        (msg.from_user.id,)
    ).fetchone()
    conn.close()

    bot.send_message(
        msg.chat.id,
        f"💰 Seu saldo atual: *R$ {user['saldo']:.2f}*",
        parse_mode="Markdown"
    )


@bot.message_handler(func=lambda m: m.text == "💳 Depositar")
def depositar(msg):
    criar_usuario(msg.from_user.id)
    usuarios_deposito[msg.from_user.id] = True
    aguardando_ddd.pop(msg.from_user.id, None)

    bot.send_message(
        msg.chat.id,
        "💳 Digite o valor que deseja adicionar de saldo.\n\nExemplo: `20`\n\nPara cancelar, envie /cancelar",
        parse_mode="Markdown"
    )


@bot.message_handler(
    func=lambda m:
    usuarios_deposito.get(m.from_user.id)
    and m.text
    and m.text.replace(",", "").replace(".", "").isdigit()
)
def receber_valor_deposito(msg):
    try:
        valor = float(msg.text.replace(",", "."))

        if valor < 10:
            bot.send_message(msg.chat.id, "❌ Valor mínimo para depósito: R$ 10,00")
            return

        usuarios_deposito.pop(msg.from_user.id, None)

        conn = db()
        cur = conn.cursor()

        cur.execute(
            "INSERT INTO pedidos (user_id, plano_id, valor, tipo, status) VALUES (?, NULL, ?, 'deposito', 'pendente')",
            (msg.from_user.id, valor)
        )

        pedido_id = cur.lastrowid
        conn.commit()
        conn.close()

        status, data, pixgo_id, pix_copia = gerar_pix(
            valor,
            f"Depósito de saldo #{pedido_id}",
            pedido_id
        )

        if status != 200 or not pix_copia:
            bot.send_message(msg.chat.id, f"❌ Erro ao gerar Pix:\n{data}")
            return

        conn = db()
        conn.execute("UPDATE pedidos SET pixgo_id=? WHERE id=?", (pixgo_id, pedido_id))
        conn.commit()
        conn.close()

        bot.send_message(
            msg.chat.id,
            f"✅ *PIX GERADO*\n\n"
            f"💰 Valor: *R$ {valor:.2f}*\n\n"
            f"📋 *PIX COPIA E COLA*\n\n"
            f"`{pix_copia}`\n\n"
            f"⏳ Após o pagamento, seu saldo será adicionado automaticamente.",
            parse_mode="Markdown"
        )

    except Exception:
        bot.send_message(msg.chat.id, "❌ Digite apenas o valor. Exemplo: 20")


@bot.message_handler(func=lambda m: usuarios_deposito.get(m.from_user.id))
def deposito_texto_invalido(msg):
    bot.send_message(msg.chat.id, "❌ Digite apenas o valor. Exemplo: 20\n\nOu envie /cancelar")


@bot.message_handler(func=lambda m: m.text == "📱 Comprar eSIM")
def comprar_esim(msg):
    criar_usuario(msg.from_user.id)
    usuarios_deposito.pop(msg.from_user.id, None)
    aguardando_ddd.pop(msg.from_user.id, None)

    conn = db()
    planos = conn.execute("""
        SELECT *
        FROM planos
        WHERE ativo=1
        ORDER BY id DESC
    """).fetchall()
    conn.close()

    if not planos:
        bot.send_message(msg.chat.id, "❌ Nenhum plano disponível no momento.")
        return

    texto = "📱 *Planos Disponíveis*\n"
    texto += "─────────────────────\n\n"

    kb = types.InlineKeyboardMarkup()

    for p in planos:
        estoque = f"✅ {p['quantidade']} disponível" if p["quantidade"] > 0 else "❌ Esgotado"

        texto += (
            f"┌ 📱 {p['nome']}\n"
            f"├ 📶 {p['gb']} · ⏱ {p['validade']}\n"
            f"├ 💰 R$ {p['preco']:.2f}\n"
            f"└ {estoque}\n\n"
        )

        if p["quantidade"] > 0:
            kb.add(
                types.InlineKeyboardButton(
                    f"Comprar {p['nome']} - R$ {p['preco']:.2f}",
                    callback_data=f"plano_{p['id']}"
                )
            )

    texto += "─────────────────────\nSelecione um plano abaixo 👇"

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown", reply_markup=kb)


@bot.callback_query_handler(func=lambda call: call.data.startswith("plano_"))
def escolher_plano(call):
    plano_id = int(call.data.split("_", 1)[1])
    user_id = call.from_user.id

    conn = db()
    plano = conn.execute(
        "SELECT * FROM planos WHERE id=? AND ativo=1",
        (plano_id,)
    ).fetchone()
    user = conn.execute(
        "SELECT saldo FROM usuarios WHERE user_id=?",
        (user_id,)
    ).fetchone()
    conn.close()

    if not plano or plano["quantidade"] <= 0:
        bot.answer_callback_query(call.id, "Esse plano está esgotado.")
        return

    saldo = user["saldo"] if user else 0

    if is_claro_pre(plano["nome"]):
        aguardando_ddd[user_id] = plano_id
        bot.send_message(
            call.message.chat.id,
            "📍 *Digite o DDD desejado para o CLARO PRÉ.*\n\n"
            "Exemplos:\n"
            "`11`, `21`, `31`, `71`, `75`\n\n"
            "Para cancelar, envie /cancelar",
            parse_mode="Markdown"
        )
        return

    mostrar_formas_pagamento(call.message.chat.id, plano, saldo)


def mostrar_formas_pagamento(chat_id, plano, saldo, ddd=None):
    kb = types.InlineKeyboardMarkup()
    callback_saldo = f"saldo_{plano['id']}"
    callback_pix = f"pix_{plano['id']}"

    if ddd:
        callback_saldo = f"saldo_{plano['id']}_{ddd}"
        callback_pix = f"pix_{plano['id']}_{ddd}"

    kb.add(types.InlineKeyboardButton("✅ Comprar com saldo", callback_data=callback_saldo))
    kb.add(types.InlineKeyboardButton("💳 Pagar direto no Pix", callback_data=callback_pix))

    ddd_txt = f"\n📍 DDD: *{ddd}*" if ddd else ""

    bot.send_message(
        chat_id,
        f"📱 *{plano['nome']}*\n"
        f"📶 {plano['gb']} · ⏱ {plano['validade']}\n"
        f"💰 Valor: *R$ {plano['preco']:.2f}*"
        f"{ddd_txt}\n"
        f"📦 Estoque: *{plano['quantidade']} disponível*\n\n"
        f"💵 Seu saldo: *R$ {saldo:.2f}*",
        parse_mode="Markdown",
        reply_markup=kb
    )


@bot.message_handler(func=lambda m: aguardando_ddd.get(m.from_user.id))
def receber_ddd_claro_pre(msg):
    user_id = msg.from_user.id
    texto = (msg.text or "").strip()

    if not texto.isdigit() or len(texto) != 2:
        bot.send_message(
            msg.chat.id,
            "❌ DDD inválido.\n\nDigite apenas 2 números.\nExemplo: `71`",
            parse_mode="Markdown"
        )
        return

    plano_id = aguardando_ddd.pop(user_id)

    conn = db()
    plano = conn.execute("SELECT * FROM planos WHERE id=? AND ativo=1", (plano_id,)).fetchone()
    user = conn.execute("SELECT saldo FROM usuarios WHERE user_id=?", (user_id,)).fetchone()
    conn.close()

    if not plano or plano["quantidade"] <= 0:
        bot.send_message(msg.chat.id, "❌ Esse plano está esgotado.")
        return

    saldo = user["saldo"] if user else 0

    bot.send_message(msg.chat.id, f"✅ DDD selecionado: *{texto}*", parse_mode="Markdown")
    mostrar_formas_pagamento(msg.chat.id, plano, saldo, ddd=texto)


@bot.callback_query_handler(func=lambda call: call.data.startswith("saldo_"))
def comprar_com_saldo(call):
    partes = call.data.split("_")
    plano_id = int(partes[1])
    ddd = partes[2] if len(partes) >= 3 else None
    user_id = call.from_user.id

    conn = db()
    cur = conn.cursor()

    plano = cur.execute(
        "SELECT * FROM planos WHERE id=? AND ativo=1",
        (plano_id,)
    ).fetchone()

    user = cur.execute(
        "SELECT saldo FROM usuarios WHERE user_id=?",
        (user_id,)
    ).fetchone()

    if not plano or plano["quantidade"] <= 0:
        conn.close()
        bot.answer_callback_query(call.id, "Esse plano está esgotado.")
        return

    saldo = user["saldo"] if user else 0

    if saldo < plano["preco"]:
        falta = plano["preco"] - saldo
        conn.close()

        bot.send_message(
            call.message.chat.id,
            f"❌ Saldo insuficiente.\n\n"
            f"💰 Seu saldo: R$ {saldo:.2f}\n"
            f"📱 Valor do plano: R$ {plano['preco']:.2f}\n"
            f"💳 Falta depositar: R$ {falta:.2f}"
        )
        return

    novo_saldo = saldo - plano["preco"]

    cur.execute("UPDATE usuarios SET saldo=? WHERE user_id=?", (novo_saldo, user_id))
    cur.execute("UPDATE planos SET quantidade = quantidade - 1 WHERE id=? AND quantidade > 0", (plano_id,))
    cur.execute(
        "INSERT INTO pedidos (user_id, plano_id, valor, tipo, status, ddd, pago_em) VALUES (?, ?, ?, 'compra_saldo', 'aguardando_envio', ?, CURRENT_TIMESTAMP)",
        (user_id, plano_id, plano["preco"], ddd)
    )

    pedido_id = cur.lastrowid

    conn.commit()
    conn.close()

    bot.send_message(
        call.message.chat.id,
        f"✅ Pedido aprovado!\n\n"
        f"🆔 Pedido: #{pedido_id}\n"
        f"📦 Seu eSIM será enviado em breve.\n"
        f"💰 Saldo restante: R$ {novo_saldo:.2f}"
    )

    avisar_admin_pedido(pedido_id)


@bot.callback_query_handler(func=lambda call: call.data.startswith("pix_"))
def comprar_pix(call):
    partes = call.data.split("_")
    plano_id = int(partes[1])
    ddd = partes[2] if len(partes) >= 3 else None
    user_id = call.from_user.id

    conn = db()
    cur = conn.cursor()

    plano = cur.execute(
        "SELECT * FROM planos WHERE id=? AND ativo=1",
        (plano_id,)
    ).fetchone()

    if not plano or plano["quantidade"] <= 0:
        conn.close()
        bot.answer_callback_query(call.id, "Esse plano está esgotado.")
        return

    cur.execute(
        "INSERT INTO pedidos (user_id, plano_id, valor, tipo, status, ddd) VALUES (?, ?, ?, 'compra_pix', 'pendente', ?)",
        (user_id, plano_id, plano["preco"], ddd)
    )

    pedido_id = cur.lastrowid
    conn.commit()
    conn.close()

    status, data, pixgo_id, pix_copia = gerar_pix(
        plano["preco"],
        f"Compra eSIM #{pedido_id}",
        pedido_id
    )

    if status != 200 or not pix_copia:
        bot.send_message(call.message.chat.id, f"❌ Erro ao gerar Pix:\n{data}")
        return

    conn = db()
    conn.execute("UPDATE pedidos SET pixgo_id=? WHERE id=?", (pixgo_id, pedido_id))
    conn.commit()
    conn.close()

    ddd_txt = f"\n📍 DDD: *{ddd}*" if ddd else ""

    bot.send_message(
        call.message.chat.id,
        f"✅ *PIX GERADO*\n\n"
        f"🆔 Pedido: *#{pedido_id}*\n"
        f"📱 Produto: *{plano['nome']}*"
        f"{ddd_txt}\n"
        f"💰 Valor: *R$ {plano['preco']:.2f}*\n\n"
        f"📋 *PIX COPIA E COLA*\n\n"
        f"`{pix_copia}`\n\n"
        f"⏳ Após o pagamento, seu pedido será enviado para separação.",
        parse_mode="Markdown"
    )


@bot.message_handler(func=lambda m: m.text == "📦 Meus Pedidos")
def meus_pedidos(msg):
    conn = db()
    pedidos = conn.execute(
        """
        SELECT pedidos.*, planos.nome, planos.gb
        FROM pedidos
        LEFT JOIN planos ON planos.id = pedidos.plano_id
        WHERE pedidos.user_id=?
        ORDER BY pedidos.id DESC
        LIMIT 10
        """,
        (msg.from_user.id,)
    ).fetchall()
    conn.close()

    if not pedidos:
        bot.send_message(msg.chat.id, "📦 Você ainda não tem pedidos.")
        return

    texto = "📦 *Meus Pedidos:*\n\n"

    for p in pedidos:
        ddd_txt = f" DDD {p['ddd']}" if p["ddd"] else ""
        if p["tipo"] == "deposito":
            texto += f"#{p['id']} - Depósito R$ {p['valor']:.2f} - {p['status']}\n"
        else:
            texto += f"#{p['id']} - {p['nome']} {p['gb']}{ddd_txt} - {p['status']}\n"

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown")


@bot.message_handler(func=lambda m: m.text == "👥 Indicar Amigos")
def indicar(msg):
    bot.send_message(
        msg.chat.id,
        f"👥 Indique amigos usando seu link:\n\nhttps://t.me/{bot.get_me().username}?start={msg.from_user.id}"
    )


@bot.message_handler(func=lambda m: m.text == "🆘 Suporte")
def suporte(msg):
    kb = types.InlineKeyboardMarkup()
    kb.add(
        types.InlineKeyboardButton(
            "💬 Falar com Suporte",
            url=f"https://t.me/{SUPORTE_TELEGRAM}"
        )
    )

    bot.send_message(
        msg.chat.id,
        "🆘 *Precisa de ajuda?*\n\nClique no botão abaixo para falar diretamente com o suporte:",
        parse_mode="Markdown",
        reply_markup=kb
    )


# =========================
# ADMIN
# =========================
@bot.message_handler(commands=["addplano"])
def add_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        conteudo = msg.text.replace("/addplano ", "").strip()
        nome, gb, validade, preco, quantidade = conteudo.split("|")

        preco_float = float(preco.replace(",", "."))
        quantidade_int = int(quantidade)

        conn = db()
        conn.execute(
            """
            INSERT INTO planos (nome, gb, validade, preco, quantidade, ativo)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (
                nome.strip().upper(),
                gb.strip().upper(),
                validade.strip().lower(),
                preco_float,
                quantidade_int
            )
        )
        conn.commit()
        conn.close()

        bot.send_message(
            msg.chat.id,
            f"✅ Plano cadastrado com sucesso.\n\n"
            f"📱 {nome.strip().upper()}\n"
            f"📶 {gb.strip().upper()} · ⏱ {validade.strip().lower()}\n"
            f"💰 R$ {preco_float:.2f}\n"
            f"📦 Quantidade: {quantidade_int}"
        )

    except Exception:
        bot.send_message(
            msg.chat.id,
            "❌ Use assim:\n\n"
            "/addplano NOME|GB_OU_TIPO|VALIDADE|PRECO|QUANTIDADE\n\n"
            "Exemplo:\n"
            "/addplano CLARO PRÉ|PRÉ-PAGO|30 dias|55.00|50"
        )


@bot.message_handler(commands=["planos"])
def listar_planos_admin(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    conn = db()
    planos = conn.execute(
        "SELECT * FROM planos ORDER BY id DESC"
    ).fetchall()
    conn.close()

    if not planos:
        bot.send_message(msg.chat.id, "📦 Nenhum plano cadastrado.")
        return

    texto = "📦 *Planos Cadastrados*\n"
    texto += "─────────────────────\n\n"

    for p in planos:
        status = "✅ Ativo" if p["ativo"] == 1 else "❌ Inativo"
        texto += (
            f"🆔 {p['id']}\n"
            f"📱 {p['nome']}\n"
            f"📶 {p['gb']} · ⏱ {p['validade']}\n"
            f"💰 R$ {p['preco']:.2f}\n"
            f"📦 Quantidade: {p['quantidade']}\n"
            f"{status}\n\n"
        )

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown")


@bot.message_handler(commands=["apagarplano"])
def apagar_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id = msg.text.split()
        plano_id = int(plano_id)

        conn = db()
        plano = conn.execute("SELECT * FROM planos WHERE id=?", (plano_id,)).fetchone()

        if not plano:
            conn.close()
            bot.send_message(msg.chat.id, "❌ Plano não encontrado.")
            return

        conn.execute("DELETE FROM planos WHERE id=?", (plano_id,))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, f"✅ Plano #{plano_id} apagado.")

    except Exception:
        bot.send_message(msg.chat.id, "Use assim:\n/apagarplano ID")


@bot.message_handler(commands=["estoque"])
def estoque_admin(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    listar_planos_admin(msg)


@bot.message_handler(commands=["saldo"])
def add_saldo_manual(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, user_id, valor = msg.text.split()
        user_id = int(user_id)
        valor = float(valor.replace(",", "."))

        conn = db()
        conn.execute(
            "INSERT OR IGNORE INTO usuarios (user_id, saldo) VALUES (?, 0)",
            (user_id,)
        )
        conn.execute(
            "UPDATE usuarios SET saldo = saldo + ? WHERE user_id=?",
            (valor, user_id)
        )
        conn.commit()
        conn.close()

        bot.send_message(
            msg.chat.id,
            f"✅ Saldo adicionado.\n\n👤 Cliente: {user_id}\n💰 Valor: R$ {valor:.2f}"
        )

        bot.send_message(
            user_id,
            f"💰 *Saldo recebido!*\n\nValor adicionado: *R$ {valor:.2f}*",
            parse_mode="Markdown"
        )

    except Exception:
        bot.send_message(msg.chat.id, "Use assim:\n/saldo ID_DO_CLIENTE 20")


@bot.message_handler(commands=["msg"])
def enviar_msg(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    texto = msg.text.replace("/msg ", "").strip()

    if not texto:
        bot.send_message(msg.chat.id, "Use assim:\n\n/msg SUA MENSAGEM")
        return

    conn = db()
    usuarios = conn.execute("SELECT user_id FROM usuarios").fetchall()
    conn.close()

    enviados = 0
    erros = 0

    for u in usuarios:
        try:
            bot.send_message(u["user_id"], texto, parse_mode="Markdown")
            enviados += 1
        except Exception:
            erros += 1

    bot.send_message(
        msg.chat.id,
        f"✅ Mensagem enviada!\n\n📨 Enviados: {enviados}\n❌ Erros: {erros}"
    )


@bot.message_handler(commands=["backup"])
def backup_db(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        arquivo_backup = gerar_backup()
        with open(arquivo_backup, "rb") as arquivo:
            bot.send_document(msg.chat.id, arquivo, caption="💾 Backup do banco de dados")
    except Exception as e:
        bot.send_message(msg.chat.id, f"Erro ao gerar backup:\n{e}")


@bot.message_handler(commands=["pedidos"])
def pedidos_pendentes(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        conn = db()
        pedidos = conn.execute(
            """
            SELECT pedidos.*, planos.nome, planos.gb, planos.validade
            FROM pedidos
            LEFT JOIN planos ON planos.id = pedidos.plano_id
            WHERE pedidos.status='aguardando_envio'
            ORDER BY pedidos.id ASC
            LIMIT 50
            """
        ).fetchall()
        conn.close()

        if not pedidos:
            bot.send_message(msg.chat.id, "✅ Nenhum pedido pendente de entrega.")
            return

        texto = "📦 *Pedidos pendentes de entrega:*\n\n"

        for p in pedidos:
            ddd_txt = f"\n📍 DDD: *{p['ddd']}*" if p["ddd"] else ""

            texto += (
                f"🆔 Pedido: *#{p['id']}*\n"
                f"👤 Cliente: `{p['user_id']}`\n"
                f"📱 Plano: *{p['nome']}*\n"
                f"📶 {p['gb']} · ⏱ {p['validade']}"
                f"{ddd_txt}\n"
                f"💰 Valor: *R$ {p['valor']:.2f}*\n"
                f"📌 Status: *{p['status']}*\n\n"
                f"➡️ Para entregar:\n"
                f"`/entregar {p['id']}`\n\n"
                f"━━━━━━━━━━━━━━\n\n"
            )

        bot.send_message(msg.chat.id, texto, parse_mode="Markdown")

    except Exception as e:
        bot.send_message(msg.chat.id, f"❌ Erro ao buscar pedidos:\n{e}")


@bot.message_handler(commands=["entregar"])
def preparar_entrega(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, pedido_id = msg.text.split()
        pedido_id = int(pedido_id)

        conn = db()
        pedido = conn.execute(
            """
            SELECT pedidos.*, planos.nome
            FROM pedidos
            LEFT JOIN planos ON planos.id = pedidos.plano_id
            WHERE pedidos.id=?
            """,
            (pedido_id,)
        ).fetchone()
        conn.close()

        if not pedido:
            bot.send_message(msg.chat.id, "❌ Pedido não encontrado.")
            return

        if pedido["status"] != "aguardando_envio":
            bot.send_message(
                msg.chat.id,
                f"❌ Esse pedido não está aguardando envio.\nStatus atual: {pedido['status']}"
            )
            return

        entrega_manual[msg.from_user.id] = pedido_id

        ddd_txt = f"\n📍 DDD: {pedido['ddd']}" if pedido["ddd"] else ""

        bot.send_message(
            msg.chat.id,
            f"📸 Envie agora a FOTO do QR Code do pedido *#{pedido_id}*.\n\n"
            f"📱 Plano: *{pedido['nome']}*"
            f"{ddd_txt}",
            parse_mode="Markdown"
        )

    except Exception:
        bot.send_message(msg.chat.id, "Use assim:\n/entregar NUMERO_DO_PEDIDO")


@bot.message_handler(content_types=["photo"])
def receber_qr_entrega(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    if msg.from_user.id not in entrega_manual:
        return

    pedido_id = entrega_manual[msg.from_user.id]

    try:
        conn = db()
        pedido = conn.execute(
            """
            SELECT pedidos.*, planos.nome
            FROM pedidos
            LEFT JOIN planos ON planos.id = pedidos.plano_id
            WHERE pedidos.id=?
            """,
            (pedido_id,)
        ).fetchone()

        if not pedido or pedido["status"] != "aguardando_envio":
            conn.close()
            entrega_manual.pop(msg.from_user.id, None)
            bot.send_message(msg.chat.id, "❌ Pedido não está mais aguardando envio.")
            return

        file_id = msg.photo[-1].file_id

        bot.send_photo(
            pedido["user_id"],
            file_id,
            caption=texto_instalacao(pedido["ddd"]),
            parse_mode="Markdown"
        )

        conn.execute(
            "UPDATE pedidos SET status='entregue', entregue_em=CURRENT_TIMESTAMP WHERE id=?",
            (pedido_id,)
        )
        conn.commit()
        conn.close()

        entrega_manual.pop(msg.from_user.id, None)

        bot.send_message(
            ADMIN_ID,
            f"✅ QR Code enviado com sucesso.\n\n🆔 Pedido: #{pedido_id}"
        )

    except Exception as e:
        bot.send_message(ADMIN_ID, f"❌ Erro ao enviar QR:\n{e}")


@bot.message_handler(content_types=["document"])
def restaurar_backup(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    arquivo = msg.document

    if not arquivo.file_name.endswith(".db"):
        return

    try:
        os.makedirs("backups", exist_ok=True)

        agora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        copia_atual = f"backups/antes_restaurar_{agora}.db"

        if os.path.exists(DB):
            shutil.copy(DB, copia_atual)

        file_info = bot.get_file(arquivo.file_id)
        downloaded = bot.download_file(file_info.file_path)

        with open(DB, "wb") as novo_db:
            novo_db.write(downloaded)

        bot.send_message(
            msg.chat.id,
            "✅ Backup restaurado com sucesso.\n\n"
            "🔄 Agora reinicie o serviço no Render."
        )

    except Exception as e:
        bot.send_message(msg.chat.id, f"❌ Erro ao restaurar backup:\n{e}")


# =========================
# WEBHOOK PIXGO
# =========================
@app.route("/webhook/pixgo", methods=["GET"])
def webhook_pixgo_get():
    return "Webhook PixGo online ✅", 200


@app.route("/webhook/pixgo", methods=["POST"])
def webhook_pixgo():
    try:
        data = request.json or {}
        print("WEBHOOK PIXGO:", data)

        event = request.headers.get("X-Webhook-Event") or data.get("event")

        if event and event not in ["payment.completed", "payment.paid", "payment.approved"]:
            return jsonify({"ok": True}), 200

        body_data = data.get("data", data)

        pedido_id = (
            data.get("external_reference")
            or data.get("externalReference")
            or data.get("external_id")
            or data.get("externalId")
            or body_data.get("external_reference")
            or body_data.get("externalReference")
            or body_data.get("external_id")
            or body_data.get("externalId")
            or data.get("metadata", {}).get("external_reference")
            or body_data.get("metadata", {}).get("external_reference")
        )

        if not pedido_id:
            print("Webhook PixGo sem pedido_id")
            return jsonify({"ok": True}), 200

        conn = db()
        cur = conn.cursor()

        pedido = cur.execute(
            "SELECT * FROM pedidos WHERE id=?",
            (pedido_id,)
        ).fetchone()

        if not pedido or pedido["status"] in ["pago", "aguardando_envio", "entregue"]:
            conn.close()
            return jsonify({"ok": True}), 200

        if pedido["tipo"] == "deposito":
            user = cur.execute(
                "SELECT saldo FROM usuarios WHERE user_id=?",
                (pedido["user_id"],)
            ).fetchone()

            saldo_atual = user["saldo"] if user else 0
            novo_saldo = saldo_atual + pedido["valor"]

            cur.execute(
                "INSERT OR IGNORE INTO usuarios (user_id, saldo) VALUES (?, 0)",
                (pedido["user_id"],)
            )

            cur.execute(
                "UPDATE usuarios SET saldo=? WHERE user_id=?",
                (novo_saldo, pedido["user_id"])
            )

            cur.execute(
                "UPDATE pedidos SET status='pago', pago_em=CURRENT_TIMESTAMP WHERE id=?",
                (pedido_id,)
            )

            conn.commit()
            conn.close()

            bot.send_message(
                pedido["user_id"],
                f"✅ *Saldo adicionado com sucesso!*\n\n"
                f"💰 Valor adicionado: *R$ {pedido['valor']:.2f}*\n"
                f"💵 Novo saldo: *R$ {novo_saldo:.2f}*",
                parse_mode="Markdown"
            )

            return jsonify({"ok": True}), 200

        if pedido["tipo"] == "compra_pix":
            plano = cur.execute(
                "SELECT * FROM planos WHERE id=?",
                (pedido["plano_id"],)
            ).fetchone()

            if not plano or plano["quantidade"] <= 0:
                conn.close()
                return jsonify({"ok": True}), 200

            cur.execute(
                "UPDATE pedidos SET status='aguardando_envio', pago_em=CURRENT_TIMESTAMP WHERE id=?",
                (pedido_id,)
            )

            cur.execute(
                "UPDATE planos SET quantidade = quantidade - 1 WHERE id=? AND quantidade > 0",
                (pedido["plano_id"],)
            )

            conn.commit()
            conn.close()

            bot.send_message(
                pedido["user_id"],
                f"✅ *Pedido aprovado!*\n\n"
                f"🆔 Pedido: *#{pedido_id}*\n"
                f"📦 Seu eSIM está sendo separado e será enviado em breve.",
                parse_mode="Markdown"
            )

            avisar_admin_pedido(pedido_id)

            return jsonify({"ok": True}), 200

        conn.close()
        return jsonify({"ok": True}), 200

    except Exception as e:
        print("ERRO GERAL WEBHOOK PIXGO:", e)
        return jsonify({"ok": True}), 200


@app.route("/")
def home():
    return "Bot eSIM online ✅"


def run_bot():
    bot.infinity_polling(skip_pending=True)


if __name__ == "__main__":
    threading.Thread(target=run_bot, daemon=True).start()
    threading.Thread(target=backup_automatico, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 10000)))
