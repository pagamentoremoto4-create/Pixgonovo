'use strict';
// Presentation only: reads payment proof, never changes charges, wallet or delivery.
function createPixCard(d){
 let schema;
 const now=d.now||Date.now;
 const log=(event,data={})=>d.diagnostic('PIX_'+event,data);
 async function init(){if(!schema)schema=d.run(`CREATE TABLE IF NOT EXISTS whatsapp_pix_cards (
  gateway TEXT NOT NULL,payment_id TEXT NOT NULL,phone TEXT NOT NULL,
  reference TEXT NOT NULL,amount REAL NOT NULL,created_ms INTEGER NOT NULL,
  shown_status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(gateway,payment_id)
 )`).catch(e=>{schema=null;throw e;});return schema;}
 async function eligible(phone){return await d.enabled(phone)&&(await d.settings()).pixFormat==='compact';}
 async function begin(phone){try{if(!await eligible(phone))return null;const c=await d.connection(phone);if(!c)return null;const to=await d.resolve(phone,c.socket),m=await c.socket.sendMessage(to,{text:'⏳ Gerando seu Pix…'});return m?.key?{key:m.key,sessionId:c.id,sentAt:now()}:null;}catch(_){log('PROGRESS_FAILED');return null;}}
 async function original(reference,phone){const c=await d.connection(phone);return c&&String(c.id)===String(reference.sessionId)?c:null;}
 async function endProgress(phone,reference,text=null){if(!reference)return false;try{const c=await original(reference,phone);if(!c)return false;await c.socket.sendMessage(reference.key.remoteJid,text?{text,edit:reference.key}:{delete:reference.key});return true;}catch(_){log('PROGRESS_UPDATE_FAILED');return false;}}
 function confirmed(p){return ['completed','delivery_pending','delivered'].includes(String(p?.status));}
 async function proof(phone,gateway,id){const p=await d.get('SELECT * FROM pix_pedidos WHERE payment_id=? AND gateway=?',[String(id),gateway]);return p&&p.cliente_jid==='wa:'+phone?p:null;}
 function statusText(p,amount){if(confirmed(p))return '✅ Pagamento confirmado!\n💰 Valor: '+d.brl(amount)+(p.tipo_pagamento==='SERVICO'?'\n📦 Pagamento recebido. Acompanhe a entrega do pedido.':'\n💳 Confira seu saldo na carteira.');return '⌛ Pix '+(p.status==='expired'?'expirado':p.status==='refunded'?'reembolsado':'cancelado')+'.\nNão utilize este código para pagar.';}
 const updating=new Set();
 async function update(phone,gateway,id){let lock,acquired=false;try{await init();lock=String(gateway)+':'+String(id);if(updating.has(lock))return false;updating.add(lock);acquired=true;
  const row=await d.get('SELECT * FROM whatsapp_pix_cards WHERE gateway=? AND payment_id=? AND phone=?',[gateway,String(id),phone]);if(!row)return false;
  const p=await proof(phone,gateway,id);if(!p||Number(p.valor)!==Number(row.amount)||!confirmed(p)&&!['expired','cancelled','refunded'].includes(p.status))return false;
  const state=confirmed(p)?'confirmed':p.status;if(row.shown_status===state)return true;
  // WhatsApp edits are best effort, bounded by the original message age.
  const reference=JSON.parse(row.reference);if(now()-Number(reference.sentAt)>14*60000){log('EDIT_WINDOW_EXPIRED');return false;}
  const c=await original(reference,phone);if(!c)return false;
  await c.socket.sendMessage(reference.key.remoteJid,{text:statusText(p,row.amount),edit:reference.key});
  await d.run('UPDATE whatsapp_pix_cards SET shown_status=? WHERE gateway=? AND payment_id=? AND phone=?',[state,gateway,String(id),phone]);log('EDIT_SUBMITTED',{state,id:reference.key.id});return true;
 }catch(_){log('EDIT_FAILED');return false;}finally{if(acquired)updating.delete(lock);}}
 async function ready(phone,{paymentId,gateway,amount,code,progress=null,detail=''}){try{
  if(!await eligible(phone))return false;code=String(code||'').replace(/[\r\n\t]/g,'').trim();if(!code||code.length>2048||!paymentId||!Number.isFinite(Number(amount)))return false;
  await init();const p=await proof(phone,gateway,paymentId);if(!p||Number(p.valor)!==Number(amount))return false;
  const old=await d.get('SELECT * FROM whatsapp_pix_cards WHERE gateway=? AND payment_id=?',[gateway,String(paymentId)]);if(old){if(old.phone!==phone)return false;await endProgress(phone,progress);await update(phone,gateway,paymentId);return true;}
  if(confirmed(p)||['expired','cancelled','refunded'].includes(p.status)){if(!await endProgress(phone,progress,statusText(p,amount)))await d.rawText(phone,statusText(p,amount));return true;}
  // Build the QR from the exact full copy code, never from a visual mockup.
  const buffer=await d.qrBuffer(code);if(!buffer?.length)throw Error('QR_EMPTY');
  const body='💰 Valor: '+d.brl(amount)+'\n⏳ Aguardando pagamento'+(detail?'\n'+detail:'')+'\n\nEscaneie o QR Code para pagar ou copie o código Pix abaixo.\n\n'+code;
  const sent=await d.sendNative(phone,body,code,buffer);if(!sent?.handled)return false;
  try{await d.run('INSERT INTO whatsapp_pix_cards(gateway,payment_id,phone,reference,amount,created_ms) VALUES(?,?,?,?,?,?)',[gateway,String(paymentId),phone,JSON.stringify(sent.reference),Number(amount),now()]);}catch(_){log('REFERENCE_SAVE_FAILED');}
  await endProgress(phone,progress);await update(phone,gateway,paymentId);log('READY',{id:sent.reference?.key?.id});return true;
 }catch(_){log('READY_FAILED');return false;}}
 return {begin,ready,update,endProgress};
}
module.exports={createPixCard};
