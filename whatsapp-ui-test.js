'use strict';
const crypto=require('crypto');
const PREFIX='cu_test_';
const COPY_SAMPLE='CENTRALUNLOCKER-TESTE-SEM-VALOR-NAO-E-UM-PIX';
const ACTIONS=Object.freeze({api:'🌐 Serviços via API',own:'🛠 Serviços próprios',hero:'💬 Números WhatsApp SMS',esim:'📱 Comprar eSIM',premium:'⭐ Premium',orders:'📦 Meus pedidos',balance:'💰 Adicionar saldo',support:'👨‍💻 Suporte'});
function testReplyId(message){
 let m=message||{};
 for(let i=0;i<4;i++){const inner=m.deviceSentMessage?.message||m.ephemeralMessage?.message||m.viewOnceMessage?.message||m.viewOnceMessageV2?.message||m.viewOnceMessageV2Extension?.message;if(!inner)break;m=inner;}
 const ids=[m.buttonsResponseMessage?.selectedButtonId,m.listResponseMessage?.singleSelectReply?.selectedRowId,m.templateButtonReplyMessage?.selectedId];
 const raw=m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
 if(typeof raw==='string'&&raw.length<=8000){try{const p=JSON.parse(raw);ids.push(p.id,p.row_id,p.selected_id,p.button_id);}catch(_){}}
 return ids.find(id=>typeof id==='string'&&/^cu_test_[a-f0-9]{32}_[a-z]+$/.test(id))||'';
}
function privateNumber(input){const raw=String(input||'').trim();if(raw.startsWith('-')||/@|https?:|[A-Za-z]/.test(raw))throw Error('Informe somente seu número pessoal com DDI e DDD, sem link ou grupo.');const n=raw.replace(/\D/g,'');if(!/^[1-9]\d{9,14}$/.test(n))throw Error('Número inválido. Inclua DDI, DDD e número.');return n;}
function buildContent(kind,token,imageMessage=null){
 if(!['menu','menu_legacy','pix','pix_card'].includes(kind)||!/^[a-f0-9]{32}$/.test(token))throw Error('Teste inválido.');
 if(kind==='menu_legacy')return {listMessage:{title:'🔓 CENTRALUNLOCKER',description:'TESTE DE LISTA TRADICIONAL\n\nEscolha uma opção. Nenhuma compra, pagamento ou saldo é usado.',buttonText:'Abrir serviços',listType:1,footerText:'Teste privado — sem compras',sections:[{title:'Demonstração',rows:Object.entries(ACTIONS).map(([id,title])=>({rowId:PREFIX+token+'_'+id,title}))}]}};
 if(kind==='pix_card'&&!imageMessage)throw Error('QR de demonstração ausente.');
 const buttons=kind==='menu'?[{name:'single_select',buttonParamsJson:JSON.stringify({title:'📋 Abrir serviços',sections:[{title:'Demonstração — sem compras',rows:Object.entries(ACTIONS).map(([id,title])=>({id:PREFIX+token+'_'+id,title}))}]})}]:[{name:'cta_copy',buttonParamsJson:JSON.stringify({display_text:'📋 Copiar Pix',copy_code:COPY_SAMPLE})}];
 return {viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},interactiveMessage:{header:kind==='pix_card'?{hasMediaAttachment:true,imageMessage}:{hasMediaAttachment:false},body:{text:kind==='pix_card'?'💰 Valor ilustrativo: R$ 10,00\n🧪 DEMONSTRAÇÃO — NÃO PAGUE\n\nEste QR Code não é uma cobrança. Teste apenas a exibição e o botão de cópia.\n\n'+COPY_SAMPLE:kind==='menu'?'🔓 CENTRALUNLOCKER\nTESTE DO MENU COM BOTÕES\n\nAbra a lista e escolha uma opção. Este teste não compra serviços nem movimenta saldo.':'🔓 CENTRALUNLOCKER\nTESTE DO BOTÃO COPIAR PIX\n\nO botão copia um texto de demonstração, sem valor e sem cobrança. Cole o resultado nesta conversa para conferir.\n\n'+COPY_SAMPLE},footer:{text:'Teste privado · clientes continuam no menu atual'},nativeFlowMessage:{buttons,messageParamsJson:'{}'}}}}};
}
function createWhatsAppUiTest(d){let ready;const csrf=crypto.randomBytes(32).toString('hex');const now=d.now||Date.now;
 async function init(){if(!ready)ready=(async()=>{await d.run(`CREATE TABLE IF NOT EXISTS whatsapp_ui_tests(token TEXT PRIMARY KEY,kind TEXT NOT NULL,phone TEXT NOT NULL,session_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'created',message_id TEXT,destination TEXT,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,error TEXT,manual_result TEXT)`);await d.run(`CREATE TABLE IF NOT EXISTS whatsapp_ui_test_clicks(token TEXT NOT NULL,action TEXT NOT NULL,received_ms INTEGER NOT NULL,PRIMARY KEY(token,action))`);await d.run("UPDATE whatsapp_ui_tests SET state='uncertain',error='Teste interrompido; confira o celular antes de enviar novamente.' WHERE state='sending'");})().catch(e=>{ready=null;throw e;});return ready;}
 async function send({kind,phone,sessionId}){
  await init();phone=privateNumber(phone);if(!['menu','menu_legacy','pix','pix_card'].includes(kind))throw Error('Escolha menu ou copiar Pix.');
  const session=await d.session(String(sessionId||''));if(!session?.socket||!session.connected)throw Error('Escolha uma sessão WhatsApp conectada e habilitada para o bot.');
  if(d.sameNumber(phone,session.number))throw Error('Informe seu número pessoal diferente do número do bot, para testar os cliques recebidos.');
  const sdk=await d.sdk(),destination=await d.resolve(phone,session.socket);if(!/^\d+(?::\d+)?@(?:s\.whatsapp\.net|lid)$/.test(destination||''))throw Error('Não foi possível localizar esse número privado no WhatsApp.');
  const token=crypto.randomBytes(16).toString('hex'),created=now();
  let progress=null,imageMessage=null;
  if(kind==='pix_card'){
    const buffer=await d.qrBuffer(COPY_SAMPLE);
    // Upload/prepare first: a failed upload must not leave a misleading progress notice.
    const media=await sdk.prepareWAMessageMedia({image:buffer},{upload:session.socket.waUploadToServer});
    if(!media.imageMessage)throw Error('Não foi possível preparar o QR de demonstração.');
    imageMessage=media.imageMessage;
    progress=await session.socket.sendMessage(destination,{text:'⏳ Gerando seu Pix de demonstração…\nSem cobrança real.'});
  }
  const envelope=sdk.generateWAMessageFromContent(destination,sdk.proto.Message.fromObject(buildContent(kind,token,imageMessage)),{userJid:session.socket.user?.id});
  if(!envelope.key?.id)throw Error('A biblioteca não gerou a referência do teste.');
  await d.run('INSERT INTO whatsapp_ui_tests(token,kind,phone,session_id,message_id,destination,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?)',[token,kind,phone,String(session.id),envelope.key.id,destination,created,created+30*60*1000]);
  await d.run("UPDATE whatsapp_ui_tests SET state='sending' WHERE token=?",[token]);
  try{await session.socket.relayMessage(destination,envelope.message,{messageId:envelope.key.id,...(kind==='menu_legacy'?{}:{additionalNodes:[{tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{name:'mixed',v:'9'}}]}]}]})});await d.run("UPDATE whatsapp_ui_tests SET state='submitted',error=NULL WHERE token=? AND state='sending'",[token]);}
  catch(_){const row=await d.get('SELECT state FROM whatsapp_ui_tests WHERE token=?',[token]);if(['click_received','copy_pasted'].includes(row?.state))return token;await d.run("UPDATE whatsapp_ui_tests SET state='uncertain',error='Envio sem confirmação. Confira no celular antes de fazer outro teste.' WHERE token=?",[token]);throw Error('O envio ficou sem confirmação. Confira o celular e o histórico antes de tentar novamente.');}
  if(progress?.key){try{await session.socket.sendMessage(destination,{text:'✅ Pix de demonstração gerado. Confira abaixo.\nSem cobrança real.',edit:progress.key});}catch(_){await d.run("UPDATE whatsapp_ui_tests SET error='Cartão enviado; aviso inicial não pôde ser editado.' WHERE token=?",[token]);}}
  return token;
 }
 async function handleReply({numero,texto,sessaoId}){
  if(String(texto||'').trim()===COPY_SAMPLE){
   await init();const candidates=await d.all("SELECT * FROM whatsapp_ui_tests WHERE kind IN ('pix','pix_card') AND expires_ms>=? ORDER BY created_ms DESC LIMIT 30",[now()]);
   const row=candidates.find(r=>d.sameNumber(numero,r.phone)&&(sessaoId==null||String(sessaoId)===r.session_id));
   if(!row)return true;
   const changed=await d.run("UPDATE whatsapp_ui_tests SET state='copy_pasted',error=NULL WHERE token=? AND state!='copy_pasted'",[row.token]);
   if(changed.changes)try{const session=await d.session(row.session_id);if(session?.socket&&session.connected)await session.socket.sendMessage(row.destination,{text:'✅ Texto de demonstração recebido corretamente.\n\nNenhum Pix ou pagamento foi criado. A conferência do botão de cópia deve ser feita no seu celular.'});}catch(_){await d.run("UPDATE whatsapp_ui_tests SET error='Texto colado recebido; resposta não enviada.' WHERE token=?",[row.token]);}
   return true;
  }
  if(!String(texto||'').startsWith(PREFIX))return false;
  await init();const match=String(texto).match(/^cu_test_([a-f0-9]{32})_([a-z]+)$/);if(!match||!ACTIONS[match[2]])return true;
  const row=await d.get('SELECT * FROM whatsapp_ui_tests WHERE token=?',[match[1]]);
  if(!row||!['menu','menu_legacy'].includes(row.kind)||row.expires_ms<now()||!d.sameNumber(numero,row.phone)||(sessaoId!=null&&String(sessaoId)!==row.session_id))return true;
  const added=await d.run('INSERT OR IGNORE INTO whatsapp_ui_test_clicks(token,action,received_ms) VALUES(?,?,?)',[row.token,match[2],now()]);
  if(!added.changes)return true;
  await d.run("UPDATE whatsapp_ui_tests SET state='click_received',error=NULL WHERE token=?",[row.token]);
  // A demonstration never calls client registration, purchase, payment, stock or wallet handlers.
  try{const s=await d.session(row.session_id);if(s?.socket&&s.connected)await s.socket.sendMessage(row.destination,{text:'✅ Teste recebido!\n\nVocê escolheu: '+ACTIONS[match[2]]+'\n\nNenhuma compra ou cobrança foi realizada.'});}catch(_){await d.run("UPDATE whatsapp_ui_tests SET error='Clique recebido; resposta de confirmação não enviada.' WHERE token=?",[row.token]);}
  return true;
 }
 function mount(app,page){const h=d.html,wrap=fn=>async(req,res)=>{try{await init();await fn(req,res);}catch(e){res.status(400).send(page('Teste de botões WhatsApp',`<p>${h(e.message)}</p><a href="/admin/menu-whatsapp/testes">Voltar aos testes</a>`));}};
  app.get('/admin/menu-whatsapp/testes',wrap(async(req,res)=>{const sessions=await d.sessions(),rows=await d.all('SELECT t.*,(SELECT COUNT(*) FROM whatsapp_ui_test_clicks c WHERE c.token=t.token) clicks FROM whatsapp_ui_tests t ORDER BY created_ms DESC LIMIT 40');
   const sessionOptions=sessions.filter(x=>x.connected).map(s=>`<option value="${h(s.id)}">${h(s.name)} · ${h(s.number)}</option>`).join('');
   res.send(page('Teste de botões WhatsApp',`<h1>📱 Teste de botões WhatsApp</h1><p>Envie a demonstração ao seu número pessoal, diferente do número do bot. O menu dos clientes permanece como está. Saldo, compras e Pix reais não são usados aqui.</p><div class="card"><form method="post" action="/admin/menu-whatsapp/testes/enviar"><input type="hidden" name="_token" value="${csrf}"><label>Sessão conectada do bot</label><select name="session_id" required>${sessionOptions||'<option value="">Nenhuma sessão conectada</option>'}</select><label>Seu número pessoal com DDI e DDD</label><input name="phone" required placeholder="55 + DDD + número" inputmode="tel"><label>Demonstração</label><select name="kind"><option value="menu">📋 Menu com lista de serviços</option><option value="menu_legacy">📋 Lista tradicional — comparar iPhone e Android</option><option value="pix_card">🧪 Cartão Pix novo com QR — demonstração sem cobrança</option><option value="pix">📋 Botão Copiar Pix — texto sem cobrança</option></select><button class="btn green" ${sessionOptions?'':'disabled'}>Enviar teste privado</button></form></div><div class="card"><h2>Como conferir</h2><p>No cartão Pix: confira se chegou uma mensagem NOVA com QR, código e botão. O aviso inicial recebe somente edição de texto. O QR contém texto de demonstração e não serve para pagar. Depois de copiar, cole o texto de volta nesta conversa.</p><p>No menu: abra a lista e toque em uma opção. O bot responderá apenas com a confirmação do teste. Para a cópia: toque em Copiar Pix, cole de volta na conversa com o bot e confira o texto <code>${h(COPY_SAMPLE)}</code>.</p><p>submitted significa que o envio retornou, sem confirmar a exibição no celular. click_received confirma que o bot recebeu um clique. copy_pasted confirma o recebimento do texto de teste colado de volta. O WhatsApp não informa quando o conteúdo é copiado; marque o resultado manualmente após conferir.</p></div><h2>Histórico</h2><table><tr><th>Data</th><th>Tipo</th><th>Número</th><th>Estado</th><th>Cliques</th><th>Conferência no celular</th></tr>${rows.map(r=>`<tr><td>${h(new Date(r.created_ms).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</td><td>${h(r.kind)}</td><td>${h(r.phone.slice(0,4)+' *****-'+r.phone.slice(-4))}</td><td>${h(r.state)}<br>${h(r.error||'')}</td><td>${r.clicks}</td><td>${h(r.manual_result||'Não informado')}<form method="post" action="/admin/menu-whatsapp/testes/${r.token}/resultado"><input type="hidden" name="_token" value="${csrf}"><button name="result" value="funcionou">Apareceu e funcionou</button><button name="result" value="nao_apareceu">Não apareceu</button><button name="result" value="falhou">Apareceu, mas falhou</button></form></td></tr>`).join('')}</table><a class="btn" href="/admin/menu-whatsapp">Voltar ao menu WhatsApp</a>`));
  }));
  app.post('/admin/menu-whatsapp/testes/enviar',wrap(async(req,res)=>{if(req.body._token!==csrf)throw Error('Reabra a página de teste para enviar.');await send({kind:req.body.kind,phone:req.body.phone,sessionId:req.body.session_id});res.redirect('/admin/menu-whatsapp/testes');}));
  app.post('/admin/menu-whatsapp/testes/:token/resultado',wrap(async(req,res)=>{if(req.body._token!==csrf)throw Error('Reabra a página de teste.');if(!['funcionou','nao_apareceu','falhou'].includes(req.body.result))throw Error('Resultado inválido.');await d.run('UPDATE whatsapp_ui_tests SET manual_result=? WHERE token=?',[req.body.result,req.params.token]);res.redirect('/admin/menu-whatsapp/testes');}));
 }
 return {init,send,handleReply,mount};
}
module.exports={createWhatsAppUiTest,testReplyId,buildContent,privateNumber,COPY_SAMPLE,ACTIONS};
