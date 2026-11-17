'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderOrderCard,createOrderMessenger}=require('../hero-sms-order-card');
function fixture(){
 const order={id:1,customer_jid:'wa:5511',status:'number_received',phone:'5511999999999',refund_status:'none'};
 const refs=new Map(),calls={send:[],edit:[]};
 const options={loadOrder:async()=>({...order}),loadReference:async id=>refs.get(id),saveReference:async(id,reference,fingerprint)=>refs.set(id,{reference,fingerprint}),render:o=>renderOrderCard(o,0),send:async(o,c)=>{calls.send.push(c);return {transport:'whatsapp',key:{id:'msg-'+calls.send.length},sentAt:Date.now()};},edit:async(r,c)=>calls.edit.push({r,c})};
 return {order,refs,calls,options,messenger:createOrderMessenger(options)};
}
test('waiting card becomes SMS card by editing, without another send or manual code actions',async()=>{
 const f=fixture();await f.messenger.update(1);
 f.order.status='sms_received';f.order.sms_code='012345';await f.messenger.update(1);await f.messenger.update(1);
 assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,1);
 const card=f.calls.edit[0].c;assert.ok(card.text.includes('012345'));
 assert.ok(!/Consultar|Atualizar|Solicitar troca|Solicitar cancelamento|ajuda/i.test(card.text));
});
test('persisted reference is reused by a new messenger after restart',async()=>{
 const f=fixture();await f.messenger.update(1);f.order.sms_code='123456';f.order.status='sms_received';
 await createOrderMessenger(f.options).update(1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,1);
});
test('known edit expiration creates one replacement, reused on repeated refreshes',async()=>{
 const f=fixture();await f.messenger.update(1);
 f.options.edit=async()=>{const error=new Error('expired');error.cannotEdit=true;throw error;};
 const m=createOrderMessenger(f.options);f.order.sms_code='123456';f.order.status='sms_received';
 await m.update(1);await m.update(1);await m.update(1);assert.equal(f.calls.send.length,2);
});
test('temporary edit failure retains reference for retry without a fallback send',async()=>{
 const f=fixture();await f.messenger.update(1);f.order.sms_code='123456';f.order.status='sms_received';
 f.options.edit=async()=>{throw new Error('offline');};
 await assert.rejects(createOrderMessenger(f.options).update(1));assert.equal(f.calls.send.length,1);
 await f.messenger.update(1);assert.equal(f.calls.edit.length,1);
});
test('concurrent updates serialize and do not send duplicate initial messages',async()=>{
 const f=fixture();await Promise.all([f.messenger.update(1),f.messenger.update(1),f.messenger.update(1)]);
 assert.equal(f.calls.send.length,1);
});
test('failed initial send never persists a success fingerprint',async()=>{
 const f=fixture();f.options.send=async()=>false;
 await assert.rejects(createOrderMessenger(f.options).update(1));assert.equal(f.refs.size,0);
});
test('Telegram buttons disappear after receiving a code and after cancellation',()=>{
 const o={id:123,status:'number_received',phone:'5511999999999'};
 assert.equal(renderOrderCard(o,0,true).buttons.length,3);
 assert.equal(renderOrderCard(o,120,true).buttons.length,1);
 o.status='sms_received';o.sms_code='001234';assert.equal(renderOrderCard(o,0,true).buttons.length,2);
 o.status='canceled';o.sms_code=null;o.refund_status='credited';
 assert.match(renderOrderCard(o,0,true).text,/devolvido à sua carteira/);
});

test('unresolved purchase and payment states explain the block without offering cancellation or another payment',()=>{
 for(const status of ['uncertain','payment_reconciliation']){
  const card=renderOrderCard({id:15,status,refund_status:'none'},0);
  assert.match(card.text,/#15/);assert.match(card.text,/confer|verifica/i);assert.match(card.text,/administrador/);
  assert.ok(!card.text.includes('Solicitar cancelamento'));assert.ok(!card.text.includes('Pagar'));
 }
});

test('explicit navigation adopts the current Telegram message, and future SMS edits reuse it',async()=>{
 const f=fixture();await f.messenger.update(1);
 await f.messenger.update(1,{reference:{transport:'telegram',messageId:77,kind:'caption'}});
 f.order.status='sms_received';f.order.sms_code='012345';await f.messenger.update(1);
 assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,2);assert.equal(f.calls.edit[1].r.messageId,77);
});

test('opening an order adopts the visible WhatsApp list even when its old card has unchanged content',async()=>{
 const f=fixture();await f.messenger.update(1);
 const list={transport:'whatsapp',key:{id:'visible-list'},sentAt:Date.now()};
 await f.messenger.update(1,{reference:list});
 assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,1);
 assert.equal(f.calls.edit[0].r.key.id,'visible-list');
 assert.match(f.calls.edit[0].c.text,/Número: \+5511999999999/);
 assert.match(f.calls.edit[0].c.text,/Solicitar troca/);assert.match(f.calls.edit[0].c.text,/Solicitar cancelamento/);
 f.order.status='sms_received';f.order.sms_code='789012';await f.messenger.update(1);
 assert.equal(f.calls.edit[1].r.key.id,'visible-list');
});
test('older sessions without a list reference open a fresh card once and reuse it for automatic updates',async()=>{
 const f=fixture();await f.messenger.update(1);await f.messenger.update(1,{forceNewMessage:true});
 assert.equal(f.calls.send.length,2);await f.messenger.update(1);assert.equal(f.calls.send.length,2);
});

test('canceled credited notice is not replayed when the live wallet balance changes',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',refund_status:'credited',wallet_balance:91.5});await f.messenger.update(1);f.order.wallet_balance=101.5;f.options.edit=async()=>{const e=new Error('expired');e.cannotEdit=true;throw e;};await createOrderMessenger(f.options).update(1);await createOrderMessenger(f.options).update(1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,0);});
test('old pre-fix fingerprints suppress replay after restart and country-label changes',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',refund_status:'credited',wallet_balance:101.5,country:73,country_name:'Brasil'});const old=renderOrderCard({...f.order,wallet_balance:91.5,country_name:'Brazil'},0);f.refs.set(1,{reference:{key:{id:'OLD'},sentAt:0},fingerprint:JSON.stringify(old)});f.options.edit=async()=>{throw Object.assign(Error('expired'),{cannotEdit:true});};await createOrderMessenger(f.options).update(1);assert.equal(f.calls.send.length+f.calls.edit.length,0);});
test('first cancellation is communicated once while later balance changes stay silent',async()=>{const f=fixture();await f.messenger.update(1);Object.assign(f.order,{status:'canceled',refund_status:'credited',wallet_balance:75});await f.messenger.update(1);f.order.wallet_balance=100;await f.messenger.update(1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,1);assert.match(f.calls.edit[0].c.text,/Valor devolvido/);});
test('a newly confirmed refund is still communicated after cancellation was already shown pending',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',refund_status:'none'});await f.messenger.update(1);assert.doesNotMatch(f.calls.send[0].text,/Valor devolvido/);Object.assign(f.order,{refund_status:'credited',wallet_balance:75});await f.messenger.update(1);await f.messenger.update(1);assert.equal(f.calls.edit.length,1);assert.match(f.calls.edit[0].c.text,/Valor devolvido/);});
test('explicit order opening can show current balance without enabling background replay',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',refund_status:'credited',wallet_balance:75});await f.messenger.update(1);f.order.wallet_balance=90;await f.messenger.update(1,{forceNewMessage:true});assert.equal(f.calls.send.length,2);assert.match(f.calls.send[1].text,/90,00/);f.order.wallet_balance=100;await f.messenger.update(1);assert.equal(f.calls.send.length,2);});
test('postpaid not-charged cancellation remains silent after balance changes',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',payment_method:'postpaid',refund_status:'none',wallet_balance:50});await f.messenger.update(1);f.order.wallet_balance=90;await createOrderMessenger(f.options).update(1);assert.equal(f.calls.send.length,1);assert.equal(f.calls.edit.length,0);assert.match(f.calls.send[0].text,/Nenhum valor foi cobrado/);});
test('failed first cancellation send is retried because no delivered fingerprint was recorded',async()=>{const f=fixture();Object.assign(f.order,{status:'canceled',refund_status:'credited'});const send=f.options.send;f.options.send=async()=>false;await assert.rejects(createOrderMessenger(f.options).update(1));assert.equal(f.refs.size,0);f.options.send=send;await createOrderMessenger(f.options).update(1);assert.equal(f.calls.send.length,1);});
