# -*- coding: utf-8 -*-

import os
import sqlite3
import threading
import requests
import hmac
import hashlib
import time
import shutil
from datetime import datetime
from flask import Flask, request, jsonify
import telebot
from telebot import types

BOT_TOKEN = os.getenv("BOT_TOKEN")
PIXGO_API_KEY = os.getenv("PIXGO_API_KEY")
PIXGO_WEBHOOK_SECRET = os.getenv("PIXGO_WEBHOOK_SECRET", "")
BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
BACKUP_INTERVAL_HOURS = int(os.getenv("BACKUP_INTERVAL_HOURS", "6"))

PIXGO_URL = "https://pixgo.org/api/v1/payment/create"
DB = "database.db"

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)

usuarios_deposito = {}
aguardando_qr_manual = {}


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

    # PLANOS: aqui você cadastra só o plano/quantidade, SEM QR Code.
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
        criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
        pago_em TEXT
    )
    """)

    conn.commit()
    conn.close()


init_db()


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
    kb.row("👥 Indicar Amigos", "🎁 Gift Card")
    kb.row("🆘 Suporte")
    return kb


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
        try:
            resposta = r.json()
        except Exception:
            resposta = {"status_code": r.status_code, "text": r.text}

        print("PIXGO RESPOSTA:", resposta)
        data = resposta.get("data", resposta) if isinstance(resposta, dict) else {}

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


def legenda_entrega_qr():
    return (
        "🎉 *eSIM Adquirido!*\n"
        "━━━━━━━━━━━━━━\n\n"
        "📲 Escaneie o QR Code enviado acima para instalar seu eSIM.\n\n"
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


def avisar_admin_entrega_manual(pedido_id, pedido, plano):
    aguardando_qr_manual[ADMIN_ID] = {
        "cliente": pedido["user_id"],
        "pedido_id": pedido_id,
        "plano_id": pedido["plano_id"],
    }

    bot.send_message(
        ADMIN_ID,
        f"🚨 *Novo pagamento aprovado!*\n\n"
        f"👤 Cliente: `{pedido['user_id']}`\n"
        f"📦 Pedido: `#{pedido_id}`\n"
        f"📱 Plano: *{plano['nome']}*\n"
        f"📶 Internet: *{plano['gb']}*\n"
        f"⏱ Validade: *{plano['validade']}*\n"
        f"💰 Valor: *R$ {plano['preco']:.2f}*\n\n"
        f"📸 Envie agora a FOTO do QR Code neste chat para entregar ao cliente.",
        parse_mode="Markdown"
    )


@bot.message_handler(commands=["start"])
def start(msg):
    criar_usuario(msg.from_user.id)
    usuarios_deposito.pop(msg.from_user.id, None)

    bot.send_message(
        msg.chat.id,
        "👋 Bem-vindo ao *Esim_bot*\n\nEscolha uma opção abaixo:",
        parse_mode="Markdown",
        reply_markup=menu()
    )


@bot.message_handler(commands=["cancel", "cancelar"])
def cancelar(msg):
    usuarios_deposito.pop(msg.from_user.id, None)
    if msg.from_user.id == ADMIN_ID:
        aguardando_qr_manual.pop(ADMIN_ID, None)
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

    except Exception as e:
        print("ERRO DEPOSITO:", e)
        bot.send_message(msg.chat.id, "❌ Digite apenas o valor. Exemplo: 20")


@bot.message_handler(func=lambda m: usuarios_deposito.get(m.from_user.id))
def deposito_texto_invalido(msg):
    bot.send_message(msg.chat.id, "❌ Digite apenas o valor. Exemplo: 20\n\nOu envie /cancelar")


@bot.message_handler(func=lambda m: m.text == "📱 Comprar eSIM")
def comprar_esim(msg):
    criar_usuario(msg.from_user.id)
    usuarios_deposito.pop(msg.from_user.id, None)

    conn = db()
    planos = conn.execute("""
        SELECT * FROM planos
        WHERE ativo=1 AND quantidade > 0
        ORDER BY nome ASC
    """).fetchall()
    conn.close()

    if not planos:
        bot.send_message(msg.chat.id, "❌ Nenhum plano disponível no momento.")
        return

    texto = "📱 *Planos Disponíveis*\n"
    texto += "─────────────────────\n\n"

    kb = types.InlineKeyboardMarkup()

    for p in planos:
        texto += (
            f"┌ 📱 {p['nome']}\n"
            f"├ 📶 {p['gb']} · ⏱ {p['validade']}\n"
            f"├ 💰 R$ {p['preco']:.2f}\n"
            f"└ ✅ {p['quantidade']} disponível\n\n"
        )

        kb.add(
            types.InlineKeyboardButton(
                f"Comprar {p['nome']} - R$ {p['preco']:.2f}",
                callback_data=f"plano_{p['id']}"
            )
        )

    texto += "─────────────────────\nSelecione um plano abaixo 👇"

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown", reply_markup=kb)


@bot.callback_query_handler(func=lambda call: call.data.startswith("plano_"))
def ver_plano(call):
    plano_id = int(call.data.split("_", 1)[1])

    conn = db()
    plano = conn.execute(
        "SELECT * FROM planos WHERE id=? AND ativo=1",
        (plano_id,)
    ).fetchone()
    user = conn.execute(
        "SELECT saldo FROM usuarios WHERE user_id=?",
        (call.from_user.id,)
    ).fetchone()
    conn.close()

    if not plano or plano["quantidade"] <= 0:
        bot.answer_callback_query(call.id, "Esse plano está esgotado.")
        return

    saldo = user["saldo"] if user else 0

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton("✅ Comprar com saldo", callback_data=f"saldo_{plano_id}"))
    kb.add(types.InlineKeyboardButton("💳 Pagar direto no Pix", callback_data=f"pix_{plano_id}"))

    bot.send_message(
        call.message.chat.id,
        f"📱 *{plano['nome']}*\n"
        f"📶 {plano['gb']} · ⏱ {plano['validade']}\n"
        f"💰 Valor: *R$ {plano['preco']:.2f}*\n"
        f"📦 Estoque: *{plano['quantidade']} disponível*\n\n"
        f"💵 Seu saldo: *R$ {saldo:.2f}*",
        parse_mode="Markdown",
        reply_markup=kb
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("saldo_"))
def comprar_com_saldo(call):
    plano_id = int(call.data.split("_", 1)[1])
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
            f"📱 Valor do eSIM: R$ {plano['preco']:.2f}\n"
            f"💳 Falta depositar: R$ {falta:.2f}"
        )
        return

    novo_saldo = saldo - plano["preco"]

    cur.execute("UPDATE usuarios SET saldo=? WHERE user_id=?", (novo_saldo, user_id))
    cur.execute("UPDATE planos SET quantidade = quantidade - 1 WHERE id=?", (plano_id,))
    cur.execute(
        "INSERT INTO pedidos (user_id, plano_id, valor, tipo, status, pago_em) VALUES (?, ?, ?, 'compra_saldo', 'pago', CURRENT_TIMESTAMP)",
        (user_id, plano_id, plano["preco"])
    )
    pedido_id = cur.lastrowid

    conn.commit()
    conn.close()

    bot.send_message(
        user_id,
        "📦 *Pedido confirmado!*\n\n"
        "Seu eSIM será enviado em instantes.",
        parse_mode="Markdown"
    )

    avisar_admin_entrega_manual(pedido_id, {"user_id": user_id, "plano_id": plano_id}, plano)

    bot.send_message(
        call.message.chat.id,
        f"✅ Compra realizada com saldo.\n💰 Saldo restante: R$ {novo_saldo:.2f}"
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("pix_"))
def comprar_pix(call):
    plano_id = int(call.data.split("_", 1)[1])
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
        "INSERT INTO pedidos (user_id, plano_id, valor, tipo, status) VALUES (?, ?, ?, 'compra_pix', 'pendente')",
        (user_id, plano_id, plano["preco"])
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

    bot.send_message(
        call.message.chat.id,
        f"✅ *PIX GERADO*\n\n"
        f"📱 Produto: *{plano['nome']}*\n"
        f"💰 Valor: *R$ {plano['preco']:.2f}*\n\n"
        f"📋 *PIX COPIA E COLA*\n\n"
        f"`{pix_copia}`\n\n"
        f"⏳ Após o pagamento, seu pedido será confirmado e o eSIM será enviado em breve.",
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
        if p["tipo"] == "deposito":
            texto += f"#{p['id']} - Depósito R$ {p['valor']:.2f} - {p['status']}\n"
        else:
            texto += f"#{p['id']} - {p['nome'] or 'eSIM'} {p['gb'] or ''} - {p['status']}\n"

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown")


@bot.message_handler(func=lambda m: m.text == "👥 Indicar Amigos")
def indicar(msg):
    bot.send_message(
        msg.chat.id,
        f"👥 Indique amigos usando seu link:\n\nhttps://t.me/{bot.get_me().username}?start={msg.from_user.id}"
    )


@bot.message_handler(func=lambda m: m.text == "🎁 Gift Card")
def gift(msg):
    bot.send_message(msg.chat.id, "🎁 Gift Card em breve.")


@bot.message_handler(func=lambda m: m.text == "🆘 Suporte")
def suporte(msg):
    bot.send_message(msg.chat.id, "🆘 Suporte: chame o administrador.")


# ==============================
# ADMIN - PLANOS SEM QR CODE
# ==============================
@bot.message_handler(commands=["addplano"])
def add_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        conteudo = msg.text.replace("/addplano ", "", 1).strip()
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

        bot.send_message(msg.chat.id, "✅ Plano cadastrado com sucesso.")

    except Exception as e:
        bot.send_message(
            msg.chat.id,
            "❌ Use assim:\n\n"
            "/addplano TIM|67GB|30 dias|55.00|20\n\n"
            "Onde o último número é a quantidade disponível."
        )


@bot.message_handler(commands=["planos"])
def listar_planos_admin(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    conn = db()
    planos = conn.execute("SELECT * FROM planos ORDER BY id DESC").fetchall()
    conn.close()

    if not planos:
        bot.send_message(msg.chat.id, "📦 Nenhum plano cadastrado.")
        return

    texto = "📦 *Planos Cadastrados*\n─────────────────────\n\n"
    for p in planos:
        status = "✅ Ativo" if p["ativo"] == 1 else "⛔ Inativo"
        texto += (
            f"🆔 `{p['id']}`\n"
            f"📱 {p['nome']}\n"
            f"📶 {p['gb']} · ⏱ {p['validade']}\n"
            f"💰 R$ {p['preco']:.2f}\n"
            f"📦 Quantidade: {p['quantidade']}\n"
            f"{status}\n\n"
        )

    bot.send_message(msg.chat.id, texto, parse_mode="Markdown")


@bot.message_handler(commands=["addestoque"])
def add_estoque(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id, qtd = msg.text.split()
        plano_id = int(plano_id)
        qtd = int(qtd)

        conn = db()
        conn.execute("UPDATE planos SET quantidade = quantidade + ? WHERE id=?", (qtd, plano_id))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, f"✅ Estoque atualizado. Adicionado: {qtd}")

    except Exception:
        bot.send_message(msg.chat.id, "❌ Use assim:\n/addestoque ID_DO_PLANO QUANTIDADE")


@bot.message_handler(commands=["setpreco"])
def set_preco(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id, preco = msg.text.split()
        plano_id = int(plano_id)
        preco = float(preco.replace(",", "."))

        conn = db()
        conn.execute("UPDATE planos SET preco=? WHERE id=?", (preco, plano_id))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, f"✅ Preço atualizado para R$ {preco:.2f}")

    except Exception:
        bot.send_message(msg.chat.id, "❌ Use assim:\n/setpreco ID_DO_PLANO 55.00")


@bot.message_handler(commands=["apagarplano"])
def apagar_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id = msg.text.split()
        plano_id = int(plano_id)

        conn = db()
        conn.execute("DELETE FROM planos WHERE id=?", (plano_id,))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, "✅ Plano apagado.")

    except Exception:
        bot.send_message(msg.chat.id, "❌ Use assim:\n/apagarplano ID_DO_PLANO")


@bot.message_handler(commands=["desativarplano"])
def desativar_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id = msg.text.split()
        plano_id = int(plano_id)

        conn = db()
        conn.execute("UPDATE planos SET ativo=0 WHERE id=?", (plano_id,))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, "✅ Plano desativado.")

    except Exception:
        bot.send_message(msg.chat.id, "❌ Use assim:\n/desativarplano ID_DO_PLANO")


@bot.message_handler(commands=["ativarplano"])
def ativar_plano(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    try:
        _, plano_id = msg.text.split()
        plano_id = int(plano_id)

        conn = db()
        conn.execute("UPDATE planos SET ativo=1 WHERE id=?", (plano_id,))
        conn.commit()
        conn.close()

        bot.send_message(msg.chat.id, "✅ Plano ativado.")

    except Exception:
        bot.send_message(msg.chat.id, "❌ Use assim:\n/ativarplano ID_DO_PLANO")


# Compatibilidade: /estoque mostra planos
@bot.message_handler(commands=["estoque"])
def estoque_admin(msg):
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


def gerar_backup():
    os.makedirs("backups", exist_ok=True)
    agora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    arquivo_backup = f"backups/backup_{agora}.db"
    shutil.copy(DB, arquivo_backup)
    return arquivo_backup


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


@bot.message_handler(content_types=["document"])
def restaurar_backup(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    arquivo = msg.document

    if not arquivo.file_name.endswith(".db"):
        return

    try:
        os.makedirs("backups", exist_ok=True)

        if os.path.exists(DB):
            agora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            shutil.copy(DB, f"backups/antes_restaurar_{agora}.db")

        file_info = bot.get_file(arquivo.file_id)
        downloaded = bot.download_file(file_info.file_path)

        with open(DB, "wb") as novo_db:
            novo_db.write(downloaded)

        bot.send_message(
            msg.chat.id,
            "✅ Backup restaurado com sucesso.\n\n"
            "🔄 Reinicie o serviço no Render para garantir que tudo carregue corretamente."
        )

    except Exception as e:
        bot.send_message(msg.chat.id, f"❌ Erro ao restaurar backup:\n{e}")


@bot.message_handler(content_types=["photo"])
def receber_qr_manual(msg):
    if msg.from_user.id != ADMIN_ID:
        return

    if ADMIN_ID not in aguardando_qr_manual:
        bot.send_message(
            msg.chat.id,
            "❌ Nenhum cliente aguardando QR Code agora.\n\n"
            "Aguarde um pagamento aprovado ou envie /cancelar."
        )
        return

    info = aguardando_qr_manual[ADMIN_ID]
    cliente = info["cliente"]
    pedido_id = info["pedido_id"]

    try:
        file_id = msg.photo[-1].file_id

        bot.send_photo(
            cliente,
            file_id,
            caption=legenda_entrega_qr(),
            parse_mode="Markdown"
        )

        bot.send_message(
            ADMIN_ID,
            f"✅ QR Code enviado para o cliente.\n📦 Pedido: #{pedido_id}"
        )

        aguardando_qr_manual.pop(ADMIN_ID, None)

    except Exception as e:
        bot.send_message(ADMIN_ID, f"❌ Erro ao enviar QR para o cliente:\n{e}")


@app.route("/webhook/pixgo", methods=["GET"])
def webhook_pixgo_get():
    return "Webhook PixGo online ✅", 200


@app.route("/webhook/pixgo", methods=["POST"])
def webhook_pixgo():
    try:
        raw_body = request.get_data()
        signature = request.headers.get("X-Webhook-Signature", "")

        if PIXGO_WEBHOOK_SECRET and signature:
            expected = hmac.new(
                PIXGO_WEBHOOK_SECRET.encode(),
                raw_body,
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(signature, expected):
                print("ASSINATURA INVALIDA PIXGO")
                return jsonify({"ok": True}), 200

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

        if not pedido or pedido["status"] == "pago":
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

            if not plano:
                conn.close()
                return jsonify({"ok": True}), 200

            cur.execute(
                "UPDATE pedidos SET status='pago', pago_em=CURRENT_TIMESTAMP WHERE id=?",
                (pedido_id,)
            )

            # Só baixa o estoque quando o pagamento confirma.
            cur.execute(
                "UPDATE planos SET quantidade = CASE WHEN quantidade > 0 THEN quantidade - 1 ELSE 0 END WHERE id=?",
                (pedido["plano_id"],)
            )

            conn.commit()
            conn.close()

            bot.send_message(
                pedido["user_id"],
                "📦 *Pedido confirmado!*\n\n"
                "Seu eSIM será enviado em instantes.",
                parse_mode="Markdown"
            )

            avisar_admin_entrega_manual(pedido_id, pedido, plano)

            return jsonify({"ok": True}), 200

        conn.close()
        return jsonify({"ok": True}), 200

    except Exception as e:
        print("ERRO GERAL WEBHOOK PIXGO:", e)
        return jsonify({"ok": True}), 200


@app.route("/")
def home():
    return "Bot eSIM online ✅"


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
            print("BACKUP AUTOMATICO ENVIADO")
        except Exception as e:
            print("ERRO BACKUP AUTOMATICO:", e)

        time.sleep(max(1, BACKUP_INTERVAL_HOURS) * 3600)


def run_bot():
    bot.infinity_polling(skip_pending=True)


if __name__ == "__main__":
    threading.Thread(target=run_bot, daemon=True).start()
    threading.Thread(target=backup_automatico, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 10000)))
