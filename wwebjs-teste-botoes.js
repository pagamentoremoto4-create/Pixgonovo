const { Client, LocalAuth, Buttons, List } = require('whatsapp-web.js');
const QRCode = require('qrcode');

let status = 'INICIANDO';
let qrDataUrl = '';
let ultimoErro = '';
let client = null;

function pagina() {
  const qr = qrDataUrl
    ? `<img src="${qrDataUrl}" style="width:320px;max-width:90vw;border:12px solid white;border-radius:12px">`
    : '<p>Nenhum QR pendente.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Teste WWEBJS</title></head><body style="font-family:Arial;background:#111;color:#eee;text-align:center;padding:30px"><h1>🧪 whatsapp-web.js — teste</h1><h2>Status: ${status}</h2>${qr}<p>${ultimoErro || ''}</p><p>Quando ficar <b>PRONTO</b>, envie de outro número:</p><p><code>ww botoes</code></p><p><code>ww lista</code></p><p style="opacity:.7">Sessão separada de teste. Não altera PIX nem pagamentos.</p><script>setTimeout(()=>location.reload(),5000)</script></body></html>`;
}

async function iniciarTesteWwebjs(app) {
  app.get('/wwebjs-teste', (req,res) => res.type('html').send(pagina()));
  app.get('/wwebjs-teste/status', (req,res) => res.json({status, temQr:!!qrDataUrl, ultimoErro}));

  const dataPath = process.env.DATA_DIR ? `${process.env.DATA_DIR}/wwebjs-test` : './.wwebjs-test';
  client = new Client({
    authStrategy: new LocalAuth({ clientId:'teste-botoes', dataPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    }
  });

  client.on('qr', async qr => {
    status='AGUARDANDO QR';
    try { qrDataUrl = await QRCode.toDataURL(qr, {margin:2,width:360}); } catch(e) { ultimoErro=e.message; }
    console.log('🧪 WWEBJS TESTE: QR disponível em /wwebjs-teste');
  });
  client.on('authenticated', () => { status='AUTENTICADO'; qrDataUrl=''; console.log('🧪 WWEBJS TESTE: autenticado'); });
  client.on('ready', () => { status='PRONTO'; qrDataUrl=''; console.log('🧪 WWEBJS TESTE: PRONTO — envie "ww botoes" ou "ww lista"'); });
  client.on('auth_failure', m => { status='FALHA AUTENTICAÇÃO'; ultimoErro=String(m||''); console.error('🧪 WWEBJS auth_failure',m); });
  client.on('disconnected', r => { status='DESCONECTADO'; console.warn('🧪 WWEBJS desconectado',r); });

  client.on('message', async msg => {
    const t=(msg.body||'').trim().toLowerCase();
    if (t==='ww botoes' || t==='/ww_botoes') {
      try {
        const b = new Buttons('🧪 Teste de botões via whatsapp-web.js', [
          {body:'✅ BOTÃO 1'}, {body:'📱 BOTÃO 2'}
        ], 'Teste WWEBJS', 'Se aparecerem, o teste funcionou.');
        const r=await msg.reply(b);
        console.log('🧪 WWEBJS BOTÕES: tentativa enviada', r?.id?._serialized || 'sem-id');
      } catch(e) { ultimoErro=e.stack||e.message; console.error('🧪 WWEBJS BOTÕES ERRO:',e); await msg.reply('❌ Erro no teste de botões: '+e.message).catch(()=>{}); }
    }
    if (t==='ww lista' || t==='/ww_lista') {
      try {
        const l = new List('🧪 Teste de lista via whatsapp-web.js','ABRIR MENU',[
          {title:'Teste',rows:[{title:'Opção 1',description:'Primeira opção',id:'ww_op1'},{title:'Opção 2',description:'Segunda opção',id:'ww_op2'}]}
        ],'Teste WWEBJS','Se abrir, a lista funcionou.');
        const r=await msg.reply(l);
        console.log('🧪 WWEBJS LISTA: tentativa enviada', r?.id?._serialized || 'sem-id');
      } catch(e) { ultimoErro=e.stack||e.message; console.error('🧪 WWEBJS LISTA ERRO:',e); await msg.reply('❌ Erro no teste de lista: '+e.message).catch(()=>{}); }
    }
  });

  status='INICIALIZANDO CLIENTE';
  client.initialize().catch(e => { status='ERRO AO INICIAR'; ultimoErro=e.stack||e.message; console.error('🧪 WWEBJS initialize erro:',e); });
}

module.exports={iniciarTesteWwebjs};
