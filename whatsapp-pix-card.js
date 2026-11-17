'use strict';
// Presentation only: reads payment proof, never changes charges, wallet or delivery.
function createPixCard(d){
 let schema;
 const now=d.now||Date.now;const fingerprint=x=>require('crypto').createHash('sha256').update(x).digest('hex');
 const log=(event,data={})=>d.diagnostic('PIX_'+event,data);
 async function init(){if(!schema)schema=(async()=>{await d.run(`CREATE TABLE IF NOT EXISTS whatsapp_pix_cards (
  gateway TEXT NOT NULL,payment_id TEXT NOT NULL,phone TEXT NOT NULL,
  reference TEXT NOT NULL,amount REAL NOT NULL,created_ms INTEGER NOT NULL,
  shown_status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(gateway,payment_id)
 )`);await d.run(`CREATE TABLE IF NOT EXISTS whatsapp_pix_order_refs(order_id INTEGER PRIMARY KEY,phone TEXT NOT NULL,gateway TEXT NOT NULL,payment_id TEXT NOT NULL,reference TEXT,fingerprint TEXT)`);})().catch(e=>{schema=null;throw e;});return schema;}
 async function eligible(phone){return await d.enabled(phone)&&(await d.settings()).pixFormat==='compact';}
 async function begin(phone){try{if(!await eligible(phone))return null;const c=await d.connection(phone);if(!c)return null;const to=await d.resolve(phone,c.socket),m=await c.socket.sendMessage(to,{text:'⏳ Gerando seu Pix…'});return m?.key?{key:m.key,sessionId:c.id,sentAt:now()}:null;}catch(_){log('PROGRESS_FAILED');return null;}}
 async function original(reference,phone){const c=await d.connection(phone);return c&&String(c.id)===String(reference.sessionId)?c:null;}
 async function endProgress(phone,reference,text='ℹ️ Confira a atualização do pagamento abaixo.'){if(!reference||!text)return false;try{const c=await original(reference,phone);if(!c||now()-Number(reference.sentAt)>14*60000)return false;await c.socket.sendMessage(reference.key.remoteJid,{text,edit:reference.key});return true;}catch(_){log('PROGRESS_UPDATE_FAILED');return false;}}
 function confirmed(p){return ['completed','delivery_pending','delivered'].includes(String(p?.status));}
 async function proof(phone,gateway,id){const p=await d.get('SELECT * FROM pix_pedidos WHERE payment_id=? AND gateway=?',[String(id),gateway]);return p&&p.cliente_jid==='wa:'+phone?p:null;}
 function statusText(p,amount){if(confirmed(p))return '✅ Pagamento confirmado!\n💰 Valor: '+d.brl(amount)+(p.tipo_pagamento==='SERVICO'?'\n📦 Pagamento recebido. Acompanhe a entrega do pedido.':'\n💳 Confira seu saldo na carteira.');return '⌛ Pix '+(p.status==='expired'?'expirado':p.status==='refunded'?'reembolsado':'cancelado')+'.\nNão utilize este código para pagar.';}
 const updating=new Set();
 async function update(phone,gateway,id){let lock,acquired=false;try{await init();lock=String(gateway)+':'+String(id);if(updating.has(lock))return false;updating.add(lock);acquired=true;
  const row=await d.get('SELECT * FROM whatsapp_pix_cards WHERE gateway=? AND payment_id=? AND phone=?',[gateway,String(id),phone]);if(!row)return false;
  const p=await proof(phone,gateway,id);if(!p||Number(p.valor)!==Number(row.amount)||!confirmed(p)&&!['expired','cancelled','refunded'].includes(p.status))return false;
  const state=confirmed(p)?'confirmed':p.status;if(row.shown_status===state)return true;
  // WhatsApp edits are best effort, bounded by the original message age.
  const reference=JSON.parse(row.reference);const c=await original(reference,phone);const within=now()-Number(reference.sentAt)<=14*60000;
  if(c&&within){try{await c.socket.sendMessage(reference.key.remoteJid,{text:statusText(p,row.amount),edit:reference.key});await d.run('UPDATE whatsapp_pix_cards SET shown_status=? WHERE gateway=? AND payment_id=? AND phone=?',[state,gateway,String(id),phone]);log('EDIT_SUBMITTED',{state,id:reference.key.id});return true;}catch(_){log('EDIT_FAILED');}}
  if(confirmed(p)&&p.tipo_pagamento==='SERVICO'){log('AWAIT_DELIVERY',{reason:within?'edit_failed':'edit_window_expired'});return true;}
  const fresh=await write(phone,null,{text:statusText(p,row.amount)});await d.run('UPDATE whatsapp_pix_cards SET shown_status=?,reference=? WHERE gateway=? AND payment_id=? AND phone=?',[state,JSON.stringify(fresh),gateway,String(id),phone]);log('STATUS_NEW_REFERENCE',{state});return true;
 }catch(_){log('EDIT_FAILED');return false;}finally{if(acquired)updating.delete(lock);}}
 async function ready(phone,{paymentId,gateway,amount,code,progress=null,detail=''}){try{
  if(!await eligible(phone))return false;code=String(code||'').replace(/[\r\n\t]/g,'').trim();if(!code||code.length>2048||!paymentId||!Number.isFinite(Number(amount)))return false;
  await init();const p=await proof(phone,gateway,paymentId);if(!p||Number(p.valor)!==Number(amount))return false;
  const old=await d.get('SELECT * FROM whatsapp_pix_cards WHERE gateway=? AND payment_id=?',[gateway,String(paymentId)]);if(old){if(old.phone!==phone)return false;if(progress?.key?.id!==JSON.parse(old.reference).key?.id)await endProgress(phone,progress,'ℹ️ Este Pix já foi gerado. Utilize o cartão existente.');await update(phone,gateway,paymentId);return true;}
  if(confirmed(p)||['expired','cancelled','refunded'].includes(p.status)){if(!await endProgress(phone,progress,statusText(p,amount)))await d.rawText(phone,statusText(p,amount));return true;}
  // Build the QR from the exact full copy code, never from a visual mockup.
  const buffer=await d.qrBuffer(code);if(!buffer?.length)throw Error('QR_EMPTY');
  const body='💰 Valor: '+d.brl(amount)+'\n⏳ Aguardando pagamento'+(detail?'\n'+detail:'')+'\n\nEscaneie o QR Code para pagar ou copie o código Pix abaixo.\n\n'+code;
  // iPhone can accept a protocol edit without displaying its new media type.
  // Always create the complete card as a new message; progress receives text only.
  const sent=await d.sendNative(phone,body,code,buffer);if(!sent?.handled)return false;
  if(progress)await endProgress(phone,progress,'✅ Pix gerado. Confira abaixo.');

  try{await d.run('INSERT INTO whatsapp_pix_cards(gateway,payment_id,phone,reference,amount,created_ms) VALUES(?,?,?,?,?,?)',[gateway,String(paymentId),phone,JSON.stringify(sent.reference),Number(amount),now()]);}catch(_){log('REFERENCE_SAVE_FAILED');}
  await update(phone,gateway,paymentId);log('READY',{id:sent.reference?.key?.id});return true;
 }catch(_){log('READY_FAILED');return false;}}

 async function reference(phone,gateway,id){try{await init();const row=await d.get('SELECT * FROM whatsapp_pix_cards WHERE gateway=? AND payment_id=? AND phone=?',[gateway,String(id),phone]);if(!row)return null;const p=await proof(phone,gateway,id);if(!p||!confirmed(p)||Number(p.valor)!==Number(row.amount))return null;return {...JSON.parse(row.reference),transport:'whatsapp',pixCard:true};}catch(_){return null;}}
 async function write(phone,reference,content){
  const c=await d.connection(phone);if(!c?.socket)throw Error('DISCONNECTED');
  if(reference&&String(c.id)===String(reference.sessionId)&&now()-Number(reference.sentAt)<=14*60000){try{await c.socket.sendMessage(reference.key.remoteJid,{...content,edit:reference.key});return reference;}catch(_){log('DELIVERY_EDIT_FAILED');}}
  const to=await d.resolve(phone,c.socket);if(!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(to||''))throw Error('INVALID_DESTINATION');
  const result=await c.socket.sendMessage(to,content);if(!result?.key?.id)throw Error('NO_REFERENCE');
  return {transport:'whatsapp',key:result.key,sessionId:c.id,sentAt:now()};
 }
 async function linkOrder(phone,orderId,gateway,id){try{await init();const p=await proof(phone,gateway,id);if(!p||!confirmed(p))return false;const order=await d.get('SELECT revenda_id FROM pedidos WHERE id=?',[Number(orderId)]);if(!order||Number(order.revenda_id)!==Number(p.revenda_id))return false;
  // A multi-item purchase gives the Pix card to its first order only.
  const other=await d.get('SELECT order_id FROM whatsapp_pix_order_refs WHERE gateway=? AND payment_id=? AND reference IS NOT NULL',[gateway,String(id)]);
  const ref=other?null:await reference(phone,gateway,id);
  await d.run('INSERT OR IGNORE INTO whatsapp_pix_order_refs(order_id,phone,gateway,payment_id,reference) VALUES(?,?,?,?,?)',[Number(orderId),phone,gateway,String(id),ref?JSON.stringify(ref):null]);return true;
 }catch(_){log('LINK_FAILED');return false;}}
 const deliveryQueues=new Map();
 async function deliverOrder(phone,orderId,text,imageBuffer=null){const key=phone+':'+orderId;const previous=deliveryQueues.get(key)||Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{try{await init();const row=await d.get('SELECT * FROM whatsapp_pix_order_refs WHERE order_id=? AND phone=?',[Number(orderId),phone]);if(!row)return false;
  const p=await proof(phone,row.gateway,row.payment_id);const order=await d.get('SELECT revenda_id FROM pedidos WHERE id=?',[Number(orderId)]);if(!p||!confirmed(p)||!order||Number(order.revenda_id)!==Number(p.revenda_id))return false;
  const fp=fingerprint(String(text)+(imageBuffer?fingerprint(imageBuffer):''));if(row.fingerprint===fp)return true;
  const ref=row.reference?JSON.parse(row.reference):null;const fresh=await write(phone,ref,imageBuffer?{image:imageBuffer,caption:String(text)}:{text:String(text)});
  await d.run('UPDATE whatsapp_pix_order_refs SET reference=?,fingerprint=? WHERE order_id=? AND phone=?',[JSON.stringify(fresh),fp,Number(orderId),phone]);log('DELIVERY_REFERENCE',{orderId:Number(orderId),id:fresh.key.id});return true;
 }catch(_){log('DELIVERY_FAILED');return false;}});deliveryQueues.set(key,job);try{return await job;}finally{if(deliveryQueues.get(key)===job)deliveryQueues.delete(key);}}
 return {begin,ready,update,endProgress,reference,linkOrder,deliverOrder};
}
module.exports={createPixCard};
