'use strict';
// Public communication is deliberately isolated from financial operations and private notices.
const crypto=require('crypto');
const fs=require('fs');
const slots={tg_ads:'Canal Telegram — anúncios',tg_sales:'Grupo Telegram — vendas',wa_ads:'Canal WhatsApp — anúncios',wa_sales:'Grupo WhatsApp — vendas'};
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const maskName=s=>String(s||'Cliente').trim().split(/\s+/).slice(0,3).map(x=>Array.from(x).slice(0,Array.from(x).length>2?2:1).join('')+'***').join(' ');
function maskPhone(s){s=String(s||'');if(/@|telegram|tg:/i.test(s))return '';const n=s.replace(/\D/g,'');return n.length>=10&&n.length<=15?n.slice(0,Math.min(4,n.length-8))+' *****-'+n.slice(-4):'';}
function target(slot,s){s=String(s||'').trim();if(!s)return '';if(slot.startsWith('tg_')){if(!/^-\d{5,20}$/.test(s)&&!/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s))throw Error('Telegram: informe @canal ou ID negativo do grupo/canal.');return s;}if(slot==='wa_sales'&&/^\d+-?\d*@g\.us$/.test(s))return s;if(slot==='wa_ads'&&/^\d+@newsletter$/.test(s))return s;throw Error('Destino WhatsApp inválido. Escolha o grupo ou informe o JID do canal.');}
function allowedCallback(data){return /^(hero_sms_(orders|status_\d+|codes_\d+_\d+|cancel_\d+|cancel_confirm_\d+|finish_\d+|finish_confirm_\d+|replace_\d+|replace_menu)|menu_(voltar|historico|conta|suporte)|esim_manual_\d+|historico.*|suporte.*|pedido_.*)$/.test(data);}
const member=r=>['creator','administrator','member'].includes(r?.status)||(r?.status==='restricted'&&r.is_member===true);
function registeredContact(r){if(!r)return '';const phone=String(r.whatsapp||'');return phone.replace(/\D/g,'')===String(r.telegram_id||'')?'':phone;}
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function createHub(d){
 let ready,timer,busy=false;
 async function init(){if(!ready)ready=(async()=>{
 await d.run('CREATE TABLE IF NOT EXISTS community_settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');
 await d.run('CREATE TABLE IF NOT EXISTS community_baselines(source TEXT PRIMARY KEY,last_id INTEGER NOT NULL)');
 await d.run('CREATE TABLE IF NOT EXISTS community_intents(user_id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
 await d.run(`CREATE TABLE IF NOT EXISTS community_events(event_key TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 await d.run(`CREATE TABLE IF NOT EXISTS community_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL,slot TEXT NOT NULL,destination TEXT NOT NULL,body TEXT NOT NULL,fingerprint TEXT NOT NULL,sent_fingerprint TEXT,ref TEXT,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER DEFAULT 0,error TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_key,slot,destination))`);
 // An interrupted send may have reached the provider. Require human review, never blind replay.
 await d.run("UPDATE community_outbox SET state=CASE WHEN body=? AND ref IS NOT NULL THEN 'retry' ELSE 'uncertain' END,error='Envio interrompido; confira o destino antes de reenviar.' WHERE state='sending'",[JSON.stringify({action:'delete'})]);
 await migratePublicPolicy();
 })().catch(e=>{ready=null;throw e});return ready;}
 async function config(){await init();return {enabled:false,required:false,...JSON.parse((await d.get('SELECT body FROM community_settings WHERE id=1'))?.body||'{}')};}
 async function hasTable(name){return !!await d.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[name]);}
 const sources={pedido:'pedidos',hero:'hero_sms_orders',consulta:'consulta_assinatura_pagamentos'};
 async function baseline(){for(const [s,t]of Object.entries(sources)){const n=await hasTable(t)?Number((await d.get(`SELECT MAX(id) n FROM ${t}`))?.n||0):0;await d.run('INSERT OR IGNORE INTO community_baselines VALUES(?,?)',[s,n]);}}
 async function validate(slot,value){let v=value;
 if(slot==='wa_ads'&&/^https:\/\/(www\.)?whatsapp.com\/channel\/[A-Za-z0-9_-]+\/?$/.test(v)){const sock=await d.socket();if(!sock)throw Error('Conecte o WhatsApp de anúncios.');const meta=await sock.newsletterMetadata('invite',v.split('/').filter(Boolean).pop());v=meta?.id;}
 v=target(slot,v);if(!v)return '';
 if(slot.startsWith('tg_')){const bot=d.bot();if(!bot)throw Error('Telegram desconectado.');const chat=await bot.getChat(v);if(slot==='tg_ads'&&chat.type!=='channel')throw Error('Escolha um canal de anúncios.');if(slot==='tg_sales'&&!['group','supergroup'].includes(chat.type))throw Error('Escolha um grupo de vendas.');const me=await bot.getMe(),m=await bot.getChatMember(chat.id,me.id);if(!['administrator','creator'].includes(m.status))throw Error('O bot deve ser administrador do destino Telegram.');if(chat.type==='channel'&&m.status!=='creator'&&m.can_post_messages!==true)throw Error('Autorize o bot a publicar no canal.');return String(chat.id);}
 const sock=await d.socket();if(!sock)throw Error('Conecte o WhatsApp de anúncios.');
 if(slot==='wa_sales'){const g=await sock.groupMetadata(v),own=String(sock.user?.id||'').split(':')[0].split('@')[0];const p=g.participants?.find(x=>String(x.id||'').split(':')[0].split('@')[0]===own||String(x.phoneNumber||'').split('@')[0]===own);if(!p)throw Error('O WhatsApp conectado precisa participar do grupo.');if(g.announce&&!p.admin)throw Error('Somente administradores podem publicar neste grupo.');}
 else {const m=await sock.newsletterMetadata('jid',v);const role=m?.viewer_metadata?.role||m?.viewerMetadata?.role||m?.role;if(!['ADMIN','OWNER','admin','owner'].includes(role))throw Error('Não foi possível confirmar permissão de administrador no canal WhatsApp.');}
 return v;}
 async function save(input){const old=await config(),c={...old};for(const s of Object.keys(slots)){const value=String(input[s]||'').trim();c[s]=value!==String(old[s]||'')||(!old.enabled&&input.enabled)||(!old.required&&input.required)?await validate(s,value):value;}
 c.enabled=!!input.enabled;c.required=!!input.required;c.invite=String(input.invite||'').trim();
 if(c.required&&(!c.tg_sales||!/^https:\/\/t.me\/[A-Za-z0-9_+/-]+$/.test(c.invite)))throw Error('Informe o grupo Telegram de vendas e seu link de entrada t.me.');
 if(c.enabled&&!c.tg_sales&&!c.wa_sales)throw Error('Selecione pelo menos um grupo de vendas.');
 if(c.enabled&&!old.enabled)await baseline();
 await d.run('INSERT OR REPLACE INTO community_settings VALUES(1,?)',[JSON.stringify(c)]);return c;}
 async function access(userId,payload){const c=await config();if(!c.required||String(userId)===String(d.adminId||''))return true;if(payload)await d.run('INSERT OR REPLACE INTO community_intents VALUES(?,?)',[String(userId),payload]);let result;
 try{result=await d.bot()?.getChatMember(c.tg_sales,userId);}catch(_){result=null;}
 if(member(result))return true;
 const kb=[[{text:'Entrar no grupo',url:c.invite}],[{text:'Já entrei — Verificar acesso',callback_data:'community_verify'}],[{text:'Meus números e códigos',callback_data:'hero_sms_orders'},{text:'Meu histórico',callback_data:'menu_historico'}],[{text:'Suporte',callback_data:'menu_suporte'}]];
 await d.bot()?.sendMessage(userId,result?'Para fazer novas compras, entre no nosso grupo de vendas. Seus pedidos continuam disponíveis.':'Não consegui verificar sua participação agora. Tente novamente; seus pedidos continuam disponíveis.',{reply_markup:{inline_keyboard:kb}});return false;}
 async function takeIntent(id){const r=await d.get('SELECT payload FROM community_intents WHERE user_id=?',[String(id)]);await d.run('DELETE FROM community_intents WHERE user_id=?',[String(id)]);return r?.payload;}
 async function links(payload){return d.links(payload);}
 async function enqueue(key,slot,destination,body){await init();const b=JSON.stringify(body),f=digest(b);await d.run(`INSERT INTO community_outbox(event_key,slot,destination,body,fingerprint) VALUES(?,?,?,?,?) ON CONFLICT(event_key,slot,destination) DO UPDATE SET body=excluded.body,fingerprint=excluded.fingerprint,state=CASE WHEN community_outbox.state IN ('sent','pending','retry') AND community_outbox.fingerprint<>excluded.fingerprint THEN 'pending' ELSE community_outbox.state END`,[key,slot,destination,b,f]);}
 function saleText(p){return `🔓 CENTRALUNLOCKER\n✅ Compra realizada\n\n📦 ${p.service}\n👤 ${p.name}${p.contact?'\n📞 '+p.contact:''}`;}
 function publicBody(p,url){return p.canceled?{action:'delete'}:{text:saleText(p),url:url||''};}
 async function migratePublicPolicy(){
  // Upgrade existing public posts as well as pending ones; never change financial tables.
  for(const row of await d.all('SELECT event_key,body FROM community_events')){
   const p=JSON.parse(row.body);delete p.amount;p.publicPolicy=2;
   await d.run('UPDATE community_events SET body=? WHERE event_key=?',[JSON.stringify(p),row.event_key]);
  }
  for(const row of await d.all("SELECT * FROM community_outbox WHERE slot IN ('tg_sales','wa_sales') AND event_key NOT LIKE 'ad:%'")){
   const event=await d.get('SELECT body FROM community_events WHERE event_key=?',[row.event_key]);
   const old=JSON.parse(row.body),p=event?JSON.parse(event.body):null;
   // Older versions always stored the canonical event before enqueueing a sale.
   // An orphaned price-bearing row must not be published without a trusted event.
   if(!p){if(/💰|R\$|Pedido cancelado|Crédito devolvido/.test(old.text||'')){const body=JSON.stringify({action:'delete'});await d.run("UPDATE community_outbox SET body=?,fingerprint=?,state=?,error=? WHERE id=?",[body,digest(body),row.ref?'pending':row.state==='uncertain'?'uncertain':'removed',row.ref?null:'Aviso antigo sem referência: confira e remova manualmente no destino.',row.id]);}continue;}
   const body=JSON.stringify(publicBody(p,old.url)),fingerprint=digest(body);
   if(row.body===body)continue;
   const state=p.canceled&&!row.ref?(row.state==='uncertain'?'uncertain':'removed'):
    row.state==='dismissed'?'dismissed':row.state==='uncertain'&&!row.ref?'uncertain':'pending';
   await d.run('UPDATE community_outbox SET body=?,fingerprint=?,state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [body,fingerprint,state,state==='uncertain'?'Confira o destino: envio antigo sem referência, remoção manual necessária.':null,row.id]);
  }
 }
 async function removePublicPosts(key){
  const body=JSON.stringify({action:'delete'}),fingerprint=digest(body);
  // Include original destinations even if the administrator has since changed the group.
  await d.run(`UPDATE community_outbox SET body=?,fingerprint=?,state=CASE
    WHEN state='removed' THEN 'removed'
    WHEN state='sending' THEN 'sending'
    WHEN ref IS NOT NULL THEN CASE WHEN state='failed' AND fingerprint=? THEN 'failed' ELSE 'pending' END
    WHEN state='uncertain' THEN 'uncertain'
    ELSE 'removed' END,
    error=CASE WHEN ref IS NULL AND state='uncertain' THEN 'Confira o destino: envio sem referência, remoção manual necessária.' ELSE error END,
    updated_at=CURRENT_TIMESTAMP WHERE event_key=? AND slot IN ('tg_sales','wa_sales')`,[body,fingerprint,fingerprint,key]);
 }
 async function record(key,raw){const c=await config();const p={key,service:String(raw.service||'Serviço').slice(0,90),name:maskName(raw.name),contact:maskPhone(raw.contact),canceled:!!raw.canceled,refunded:!!raw.refunded,finished:!!raw.finished,payload:raw.payload||'menu',publicPolicy:2};
 const previous=await d.get('SELECT body FROM community_events WHERE event_key=?',[key]);
 if(previous?.body===JSON.stringify(p))return;
 await d.run('INSERT OR REPLACE INTO community_events(event_key,body) VALUES(?,?)',[key,JSON.stringify(p)]);
 if(p.canceled){await removePublicPosts(key);return;}
 if(!c.enabled)return;
 for(const slot of ['tg_sales','wa_sales'])if(c[slot]){const l=await links(p.payload);await enqueue(key,slot,c[slot],publicBody(p,slot==='tg_sales'?l.telegram:l.whatsapp));}
 }
 async function collect(){const c=await config();if(c.enabled)await baseline();
 for(const [source,t]of Object.entries(sources)){if(!await hasTable(t))continue;const b=(await d.get('SELECT last_id FROM community_baselines WHERE source=?',[source]))?.last_id||0;
 const rows=await d.all(`SELECT * FROM ${t} WHERE (?=1 AND id>?) OR EXISTS(SELECT 1 FROM community_events e WHERE e.event_key=? || ${t}.id)`,[c.enabled?1:0,b,source+':']);
 for(const r of rows){const key=source+':'+r.id;let p;
 if(source==='pedido'){if(!Number(r.cobrado)&&!await d.get('SELECT event_key FROM community_events WHERE event_key=?',[key]))continue;const rev=r.revenda_id?await d.get('SELECT * FROM revendas WHERE id=?',[r.revenda_id]):null;p={service:r.servico_nome,name:rev?.nome||r.revenda_nome||r.cliente_nome,contact:rev?registeredContact(rev):/^(?:tg|cvtg):/.test(r.revenda_jid||r.cliente_jid||'')?'':r.revenda_numero||r.cliente_whatsapp,amount:r.valor,canceled:/CANCEL/i.test(r.status),refunded:Number(r.estornado)>0,finished:r.status==='FINALIZADO',payload:d.orderPayload?await d.orderPayload(r):r.servico_id?'servico_'+r.servico_id:'menu'};}
 if(source==='hero'){if(r.payment_method==='external'||r.status==='test_closed')continue;let proof=false;if(await hasTable('hero_sms_wallet_debits'))proof=!!await d.get('SELECT order_id FROM hero_sms_wallet_debits WHERE order_id=?',[r.id]);if(!proof&&await hasTable('hero_sms_pix_receipts'))proof=!!await d.get('SELECT order_id FROM hero_sms_pix_receipts WHERE order_id=?',[r.id]);if(!proof)continue;const rev=await d.get('SELECT * FROM revendas WHERE id=?',[r.customer_id]);p={service:'Número WhatsApp SMS',name:rev?.nome,contact:registeredContact(rev),amount:r.price_brl,canceled:r.status==='canceled',refunded:r.refund_status==='credited',finished:r.status==='finished',payload:'hero'};}
 if(source==='consulta'){const canceled=/CANCEL|ESTORN|REFUND/i.test(r.status);if(r.status!=='PAGO'&&(!canceled||!await d.get('SELECT event_key FROM community_events WHERE event_key=?',[key])))continue;const telegram=/^(?:tg|cvtg):/.test(r.cliente_jid||'');const rev=telegram?await d.get('SELECT * FROM revendas WHERE telegram_id=?',[String(r.cliente_jid).split(':')[1]]):null;p={service:'Assinatura ConsultaVIP',name:r.cliente_nome,contact:telegram?registeredContact(rev):r.cliente_numero,amount:r.valor_pago,canceled,finished:true,payload:'consulta'};}
 if(!p||(!p.canceled&&(!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)))continue;
 if(p.canceled&&!await d.get('SELECT event_key FROM community_events WHERE event_key=?',[key]))continue;
 await record(key,p);
 }}}
 async function send(row){const body=JSON.parse(row.body),old=row.ref?JSON.parse(row.ref):null;
 if(body.action==='delete'){
  if(!old)return null;
  if(row.slot==='tg_sales'){const bot=d.bot();if(!bot)throw Object.assign(Error('Telegram desconectado.'),{beforeSend:true});try{await bot.deleteMessage(row.destination,old.message_id);}catch(e){const description=e.response?.body?.description||e.message||'';if(!/message to delete not found/i.test(description))throw e;}return old;}
  const sock=await d.socket();if(!sock)throw Object.assign(Error('WhatsApp desconectado.'),{beforeSend:true});await sock.sendMessage(row.destination,{delete:old.key});return old;
 }
 if(row.slot.startsWith('tg_')){const bot=d.bot();if(!bot)throw Object.assign(Error('Telegram desconectado.'),{beforeSend:true});const text=body.text;
 const buttons=body.url?{reply_markup:{inline_keyboard:[[{text:'🛒 Comprar também',url:body.url}]]}}:{reply_markup:{inline_keyboard:[]}};
 if(old){await bot.editMessageText(text,{chat_id:row.destination,message_id:old.message_id,disable_web_page_preview:true,...buttons});return old;}
 const m=body.image?await bot.sendPhoto(row.destination,body.image,{caption:text.slice(0,1024),...buttons}):await bot.sendMessage(row.destination,text,{disable_web_page_preview:true,...buttons});return {message_id:m.message_id};}
 const sock=await d.socket();if(!sock)throw Object.assign(Error('WhatsApp desconectado.'),{beforeSend:true});const text=body.text+(body.url?'\n\n🛒 Comprar também: '+body.url:'');
 if(old){await sock.sendMessage(row.destination,{text,edit:old.key});return old;}
 const m=await sock.sendMessage(row.destination,body.image?{image:fs.readFileSync(body.image),caption:text}:{text});if(!m?.key)throw Error('WhatsApp não retornou a referência da mensagem.');return {key:m.key};}
 async function flush(){const c=await config();for(const row of await d.all("SELECT * FROM community_outbox WHERE state IN ('pending','retry') ORDER BY id LIMIT 30")){
 const deleting=JSON.parse(row.body).action==='delete';
 if(!c.enabled&&!row.event_key.startsWith('ad:')&&!row.ref&&!deleting)continue;
 if(c[row.slot]!==row.destination&&!(deleting&&row.ref))continue;
 if(deleting&&!row.ref){if(row.state!=='uncertain')await d.run("UPDATE community_outbox SET state='removed',error=NULL WHERE id=?",[row.id]);continue;}
 const claim=await d.run("UPDATE community_outbox SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('pending','retry') AND fingerprint=?",[row.id,row.fingerprint]);if(!claim.changes)continue;
 try{const ref=await send(row);await d.run("UPDATE community_outbox SET ref=?,sent_fingerprint=?,state=CASE WHEN fingerprint=? THEN ? ELSE 'pending' END,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(ref),row.fingerprint,row.fingerprint,deleting?'removed':'sent',row.id]);}
 catch(e){const code=e.response?.body?.error_code||e.response?.statusCode;let state=e.beforeSend?'retry':code===429?'retry':code>=400&&code<500?'failed':deleting?'retry':'uncertain';if(/message is not modified/i.test(e.message)){state='sent';}
 await d.run('UPDATE community_outbox SET state=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[state,state==='sent'?null:(deleting?'Falha ao remover aviso; verifique permissões e prazo da plataforma. Resultado: ':'Falha no envio; verifique conexão e permissões. Resultado: ')+(code||state),row.id]);}
 }}
 async function tick(){if(busy)return;busy=true;try{await collect();await flush();}finally{busy=false;}}
 function start(){if(timer)return;timer=setInterval(()=>tick().catch(e=>console.log('COMMUNITY_WORKER',e.message)),30000);timer.unref();}
 async function ads(campaign,text,image){const c=await config();for(const s of ['tg_ads','wa_ads'])if(Number(campaign['community_'+s])===1){if(!c[s])throw Error('Configure o destino em Canais e vendas.');const l=await d.adLinks(campaign);const round=campaign.community_round||campaign.proximo_envio||campaign.ultimo_envio||'manual';await enqueue('ad:'+campaign.id+':'+round,s,c[s],{text,url:s==='tg_ads'?l.telegram:l.whatsapp,image:image||null});}return {total:0,enviadas:0,falhas:0,detalhes:['Canais públicos: envio registrado na fila.']};}
 function mount(app,page){const wrap=fn=>async(req,res)=>{try{await init();await fn(req,res);}catch(e){res.status(400).send(page('Canais e vendas',`<p>${html(e.message)}</p><a href="/admin/comunidade">Voltar</a>`));}};
 app.get('/admin/comunidade',wrap(async(req,res)=>{const c=await config();let groups=[];try{groups=await d.groups();}catch(_){}const rows=await d.all('SELECT id,event_key,slot,state,attempts,error,updated_at FROM community_outbox ORDER BY id DESC LIMIT 80');const field=s=>`<label>${slots[s]}</label>${s==='wa_sales'?`<select name="${s}"><option value="">Desativado</option>${!groups.some(g=>g.id===c[s])&&c[s]?`<option selected>${html(c[s])}</option>`:''}${groups.map(g=>`<option value="${html(g.id)}" ${g.id===c[s]?'selected':''}>${html(g.nome)}</option>`).join('')}</select>`:`<input name="${s}" value="${html(c[s]||'')}" placeholder="${s.startsWith('tg')?'ID negativo ou @canal':'Link whatsapp.com/channel/... ou JID @newsletter'}">`}`;
 res.send(page('Canais e vendas',`<h1>Canais e vendas</h1><p>Configure quatro destinos separados. O bot Telegram deve ser administrador. No WhatsApp, utilize a sessão habilitada para anúncios. Salvar valida permissões sem publicar mensagens.</p><form method="post" action="/admin/comunidade">${Object.keys(slots).map(field).join('')}<label>Link de entrada no grupo Telegram</label><input name="invite" value="${html(c.invite||'')}" placeholder="https://t.me/+..."><label><input type="checkbox" name="enabled" ${c.enabled?'checked':''}> Publicar novas vendas confirmadas</label><br><label><input type="checkbox" name="required" ${c.required?'checked':''}> Exigir entrada no grupo Telegram para novas compras</label><button>Validar e salvar</button></form><h2>Exemplo público</h2><pre>${html(saleText({service:'Número WhatsApp SMS',name:maskName('Adriano Silva'),contact:maskPhone('5575999991234'),key:'hero:21'}))}</pre><p>As recargas não são publicadas. Nenhum pedido antigo será anunciado ao ativar. Configure os canais de anúncios nas campanhas.</p><h2>Testar destinos</h2><p>Cada botão abaixo envia uma mensagem de teste ao destino configurado.</p>${Object.keys(slots).map(s=>`<form method="post" action="/admin/comunidade/teste/${s}"><button ${c[s]?'':'disabled'}>Enviar teste: ${slots[s]}</button></form>`).join('')}<h2>Fila e histórico</h2><p>uncertain: confira a mensagem no destino antes de autorizar reenvio. Os avisos públicos não mostram valores. Cancelamentos removem o aviso original; falhas de remoção ficam visíveis aqui.</p><table><tr><th>Evento</th><th>Destino</th><th>Estado</th><th>Tentativas</th><th>Detalhe</th><th>Ação</th></tr>${rows.map(r=>`<tr><td>${html(r.event_key)}</td><td>${html(r.slot)}</td><td>${html(r.state)}</td><td>${r.attempts}</td><td>${html(r.error||r.updated_at)}</td><td>${['uncertain','failed'].includes(r.state)?`<form method="post" action="/admin/comunidade/fila/${r.id}"><button name="action" value="retry">Reenviar após conferir</button><button name="action" value="dismiss">Arquivar sem reenviar</button></form>`:''}</td></tr>`).join('')}</table><a href="/admin/anuncios">Campanhas</a>`));}));
 app.post('/admin/comunidade',wrap(async(req,res)=>{await save(req.body);res.redirect('/admin/comunidade');}));
 app.post('/admin/comunidade/teste/:slot',wrap(async(req,res)=>{const c=await config(),s=req.params.slot;if(!slots[s]||!c[s])throw Error('Destino não configurado.');await validate(s,c[s]);await send({slot:s,destination:c[s],body:JSON.stringify({text:'🔓 CENTRALUNLOCKER — Teste de conexão. Nenhuma compra foi realizada.'})});res.redirect('/admin/comunidade');}));
 app.post('/admin/comunidade/fila/:id',wrap(async(req,res)=>{if(!['retry','dismiss'].includes(req.body.action))throw Error('Ação inválida.');await d.run("UPDATE community_outbox SET state=?,error=NULL WHERE id=? AND state IN ('failed','uncertain')",[req.body.action==='retry'?'pending':'dismissed',Number(req.params.id)]);res.redirect('/admin/comunidade');}));
 }
 return {init,config,save,validate,access,takeIntent,record,collect,enqueue,flush,tick,start,ads,mount,stop:()=>clearInterval(timer)};
}
module.exports={createHub,maskName,maskPhone,target,member,allowedCallback};
