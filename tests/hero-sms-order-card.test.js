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
 o.status='sms_received';o.sms_code='001234';assert.equal(renderOrderCard(o,0,true).buttons.length,1);
 o.status='canceled';o.sms_code=null;o.refund_status='credited';
 assert.match(renderOrderCard(o,0,true).text,/devolvido à sua carteira/);
});
