require("dotenv").config();

const express = require("express");
const axios = require("axios");
const QRCode = require("qrcode");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

let sock = null;
let qrCodeBase64 = null;
let conectado = false;

async function iniciarWhatsApp() {

  const { state, saveCreds } =
    await useMultiFileAuthState("./auth");

  const { version } =
    await fetchLatestBaileysVersion();

  sock = makeWASocket({

    version,

    auth: state,

    logger: pino({
      level: "silent"
    }),

    browser: [
      "Ubuntu",
      "Chrome",
      "20.0.04"
    ]
  });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    async (update) => {

      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {

        console.log(
          "✅ QR CODE GERADO"
        );

        qrCodeBase64 =
          await QRCode.toDataURL(qr);

        conectado = false;
      }

      if (connection === "open") {

        console.log(
          "✅ WHATSAPP CONECTADO"
        );

        qrCodeBase64 = null;

        conectado = true;
      }

      if (connection === "close") {

        conectado = false;

        const statusCode =
          lastDisconnect?.error
          ?.output?.statusCode;

        console.log(
          "❌ WHATSAPP DESCONECTOU:",
          statusCode
        );

        if (
          statusCode !==
          DisconnectReason.loggedOut
        ) {

          setTimeout(() => {

            iniciarWhatsApp();

          }, 5000);

        } else {

          console.log(
            "⚠️ Sessão encerrada"
          );
        }
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {

      const msg = messages[0];

      if (!msg.message) return;

      if (msg.key.fromMe) return;

      const from =
        msg.key.remoteJid;

      const texto =

        msg.message.conversation ||

        msg.message.extendedTextMessage?.text ||

        "";

      const comando =
        texto.trim().toLowerCase();

      console.log(
        "📩 MENSAGEM:",
        comando
      );

      if (comando === "menu") {

        await enviarTexto(

          from,

`🤖 *BOT PIXGO*

Digite:

*pagar 10*

Exemplo:
*pagar 25*`

        );

        return;
      }

      if (
        !comando.startsWith("pagar")
      ) return;

      const valor =
        Number(
          comando
          .split(" ")[1]
          ?.replace(",", ".")
        );

      if (
        !valor ||
        valor < 10
      ) {

        await enviarTexto(
          from,
          "❌ Valor mínimo R$10"
        );

        return;
      }

      await enviarTexto(
        from,
        "⏳ Gerando PIX..."
      );

      const pix =
        await gerarPix(
          valor,
          from
        );

      if (!pix) {

        await enviarTexto(

          from,

`❌ Erro ao gerar PIX

Confira:
- API Key PixGo
- Conta validada
- Saldo disponível`

        );

        return;
      }

      const paymentId =

        pix?.data?.payment_id ||

        pix?.payment_id;

      const qrCode =

        pix?.data?.qr_code ||

        pix?.data?.qr_code_text ||

        pix?.data?.pix_code ||

        pix?.data?.copy_paste ||

        pix?.qr_code;

      await enviarTexto(
        from,

`✅ *PIX GERADO COM SUCESSO!*

💰 Valor: R$ ${valor.toFixed(2)}

📋 *COPIA E COLA (PIX):*

━━━━━━━━━━━━━━━━━━
${qrCode}
━━━━━━━━━━━━━━━━━━

👉 Toque e segure para copiar o código acima.

⏳ Expira em 20 minutos.`
      );

      if (paymentId) {

        verificarPagamento(
          paymentId,
          from
        );
      }
    }
  );
}

async function enviarTexto(
  to,
  text
) {

  await sock.sendMessage(
    to,
    { text }
  );
}

async function gerarPix(
  valor,
  cliente
) {

  try {

    const body = {

      amount:
        Number(valor),

      description:
        `Pagamento WhatsApp ${cliente}`,

      customer_name:
        "Cliente WhatsApp",

      customer_cpf:
        "12345678901",

      customer_email:
        "cliente@exemplo.com",

      customer_phone:
        "11999999999",

      customer_address:
        "Rua Principal, 123",

      external_id:
        `pedido_${Date.now()}`
    };

    const response =
      await axios.post(

        "https://pixgo.org/api/v1/payment/create",

        body,

        {
          headers: {

            "Content-Type":
              "application/json",

            "X-API-Key":
              process.env.PIXGO_API_KEY
          },

          timeout: 30000
        }
      );

    console.log(
      "✅ PIX GERADO:",
      response.data
    );

    return response.data;

  } catch (error) {

    console.log(
      "========== ERRO PIXGO =========="
    );

    console.log(
      "STATUS:",
      error.response?.status
    );

    console.log(
      "DATA:",
      error.response?.data
    );

    console.log(
      "MESSAGE:",
      error.message
    );

    console.log(
      "================================"
    );

    return null;
  }
}

async function consultarStatus(
  paymentId
) {

  try {

    const response =
      await axios.get(

        `https://pixgo.org/api/v1/payment/${paymentId}/status`,

        {
          headers: {

            "X-API-Key":
              process.env.PIXGO_API_KEY
          }
        }
      );

    return response.data;

  } catch (error) {

    console.log(
      "ERRO STATUS:",
      error.response?.data ||
      error.message
    );

    return null;
  }
}

async function verificarPagamento(
  paymentId,
  numeroCliente
) {

  let tentativas = 0;

  const intervalo =
    setInterval(async () => {

      tentativas++;

      const status =
        await consultarStatus(
          paymentId
        );

      console.log(
        "STATUS PAGAMENTO:",
        status
      );

      if (
        status?.success &&
        status.data?.status ===
        "completed"
      ) {

        clearInterval(intervalo);

        await enviarTexto(

          numeroCliente,

`✅ *PAGAMENTO CONFIRMADO!*

Obrigado pela compra.`

        );
      }

      if (
        tentativas >= 40
      ) {

        clearInterval(intervalo);
      }

    }, 30000);
}

app.get("/", (req, res) => {

  if (qrCodeBase64) {

    return res.send(`

<html>

<body style="
background:#111;
color:white;
text-align:center;
font-family:Arial;
padding-top:40px;
">

<h1>
📱 ESCANEIE O QR
</h1>

<img
src="${qrCodeBase64}"
width="300"
/>

<p>
WhatsApp > Aparelhos conectados > Conectar aparelho
</p>

</body>

</html>

    `);
  }

  res.send(`

<html>

<body style="
background:#111;
color:white;
text-align:center;
font-family:Arial;
padding-top:40px;
">

<h1>
✅ BOT PIXGO ONLINE
</h1>

<p>
${conectado
? "WhatsApp conectado ✅"
: "Aguardando QR..."}

</p>

</body>

</html>

  `);
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `🚀 SERVIDOR ONLINE NA PORTA ${PORT}`
    );

  }
);

iniciarWhatsApp();
