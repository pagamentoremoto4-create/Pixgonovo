'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sqlite3=require('sqlite3');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
const protocol=require('../hero-sms-protocol');
const {renderOrderCard,createOrderMessenger}=require('../hero-sms-order-card');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
async function fixture(t){
  const db=new sqlite3.Database(':memory:');
  t.after(()=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve())));
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
  const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
  const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
  const sent=[];
  const ctx=vm.createContext({run,get,all,heroProtocol:protocol,renderOrderCard,createOrderMessenger,console,URLSearchParams,Date,Number,Map,Set,JSON,String,
    enviarTexto:async(jid,msg)=>{sent.push({jid,msg});return {transport:'test',messageId:sent.length};},
    isTgJid:jid=>String(jid).startsWith('tg:'),salvarSessaoPedido:async()=>{},
    addColumnIfMissing:async()=>{},heroSmsV1:async()=>({data:[],meta:{hasMore:false}}),
    heroSmsApi:async()=> 'STATUS_WAIT_CODE',heroWaitSeconds:()=>0,brl:v=>'R$ '+v});
  vm.runInContext(section('async function heroPedidosInit(){','async function heroCatalogInit(){'),ctx);
  vm.runInContext(section('async function heroReplaceOrder(','async function heroOrderHistory('),ctx);
  vm.runInContext(section('async function heroCreditConfirmedRefund(','setInterval(()=>heroPollSms()'),ctx);
  vm.runInContext(section('let heroOrderMessenger=null;','async function heroWhatsListarPedidos('),ctx);
  ctx.heroEditOrderMessage=async(reference,card)=>sent.push({reference,msg:card.text,edit:true});
  await ctx.heroPedidosInit();
  await run("INSERT INTO hero_sms_orders(customer_id,customer_jid,service,country,price_brl,cost_at_quote,payment_method,activation_id,phone,status) VALUES(1,'test','wa','73',25,1,'saldo','123','5511000000000','number_received')");
  return {ctx,run,get,all,sent};
}
test('real replacement handler saves the documented array response and sends line breaks',async t=>{
  const f=await fixture(t);
  f.ctx.heroSmsV1=async(method,path)=>{assert.equal(method,'POST');assert.equal(path,'/activations/123/replace');return {data:[{id:123,phone:'5511999999999'}]};};
  const text=await f.ctx.heroReplaceOrder('test',1);
  const o=await f.get('SELECT * FROM hero_sms_orders WHERE id=1');
  assert.equal(o.phone,'5511999999999');assert.equal(o.activation_id,'123');assert.equal(o.status,'number_received');
  assert.ok(text.includes('\n'));assert.ok(!text.includes('\\n'));
});
test('ambiguous replacement is held for reconciliation and cannot be repeated',async t=>{
  const f=await fixture(t);let calls=0;
  f.ctx.heroSmsV1=async()=>{calls++;return {data:[{id:999,phone:'5511999999999'}]};};
  await f.ctx.heroReplaceOrder('test',1);
  assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'replace_uncertain');
  await assert.rejects(f.ctx.heroReplaceOrder('test',1));assert.equal(calls,1);
});
test('active OTP sync stores code once and polling delivers a single notification',async t=>{
  const f=await fixture(t);
  f.ctx.heroSmsV1=async(method,path)=>path.startsWith('/activations?')?{data:[{id:123,phone:'5511000000000',otpLast:{smsCode:'012345',type:'sms'}}],meta:{hasMore:false}}:{data:[],meta:{hasMore:false}};
  await f.ctx.heroSyncExternal();await f.ctx.heroSyncExternal();
  assert.equal((await f.get('SELECT sms_code FROM hero_sms_orders WHERE id=1')).sms_code,'012345');
  await f.ctx.heroPollSms();await f.ctx.heroPollSms();assert.equal(f.sent.length,1);
});
test('history extracts SMS text and preserves a finished activation',async t=>{
  const f=await fixture(t);
  f.ctx.heroSmsV1=async(method,path)=>path.startsWith('/activations/history?')?{data:[{id:123,status:6,phone:'5511000000000',moreCodes:'Your code is 012345'}],meta:{hasMore:false}}:{data:[],meta:{hasMore:false}};
  await f.ctx.heroSyncExternal();
  const row=await f.get('SELECT status,sms_code FROM hero_sms_orders WHERE id=1');
  assert.equal(row.status,'finished');assert.equal(row.sms_code,'012345');
});
test('a failed card edit is retried without sending a duplicate message',async t=>{
  const f=await fixture(t);await f.ctx.heroUpdateOrderCard(1);
  await f.run("UPDATE hero_sms_orders SET phone='5511999999999' WHERE id=1");
  let attempts=0;f.ctx.heroEditOrderMessage=async()=>{if(++attempts===1)throw new Error('temporary failure');};
  await f.ctx.heroStatusUpdates();await f.ctx.heroStatusUpdates();await f.ctx.heroStatusUpdates();
  assert.equal(attempts,2);assert.equal(f.sent.length,1);
});
test('overlapping sync cycles do not duplicate provider requests',async t=>{
  const f=await fixture(t);let release,calls=0;
  const gate=new Promise(resolve=>release=resolve);
  f.ctx.heroSmsV1=async()=>{calls++;await gate;return {data:[],meta:{hasMore:false}};};
  const first=f.ctx.heroSyncExternal();
  // Wait until the first cycle reaches its mocked HTTP call.
  while(!calls)await new Promise(resolve=>setImmediate(resolve));
  await f.ctx.heroSyncExternal();assert.equal(calls,1);release();await first;assert.equal(calls,2);
});

test('an existing order card is edited when polling receives the SMS',async t=>{
  const f=await fixture(t);await f.ctx.heroUpdateOrderCard(1);
  f.ctx.heroSmsApi=async()=> 'STATUS_OK:012345';
  await f.ctx.heroPollSms();await f.ctx.heroPollSms();
  assert.equal(f.sent.filter(x=>!x.edit).length,1);
  assert.equal(f.sent.filter(x=>x.edit).length,1);
  assert.match(f.sent.find(x=>x.edit).msg,/012345/);
  assert.equal((await f.get('SELECT delivered FROM hero_sms_notifications WHERE order_id=1')).delivered,1);
});
test('a failed channel send keeps SMS pending and retries after reconnect',async t=>{
  const f=await fixture(t);const send=f.ctx.enviarTexto;
  f.ctx.heroSmsApi=async()=> 'STATUS_OK:012345';f.ctx.enviarTexto=async()=>false;
  await f.ctx.heroPollSms();
  const pending=await f.get('SELECT delivered,attempts FROM hero_sms_notifications WHERE order_id=1');
  assert.equal(pending.delivered,0);assert.equal(pending.attempts,1);
  f.ctx.enviarTexto=send;await f.ctx.heroPollSms();
  assert.equal((await f.get('SELECT delivered FROM hero_sms_notifications WHERE order_id=1')).delivered,1);
  assert.equal(f.sent.length,1);
});

test('an SMS arriving after an ambiguous cancellation is still delivered without a wallet credit',async t=>{
  const f=await fixture(t);await f.ctx.heroUpdateOrderCard(1);
  await f.run("UPDATE hero_sms_orders SET status='cancel_pending' WHERE id=1");
  f.ctx.heroSmsApi=async()=> 'STATUS_OK:012345';await f.ctx.heroPollSms();
  const row=await f.get('SELECT status,sms_code,refund_status FROM hero_sms_orders WHERE id=1');
  assert.equal(row.status,'sms_received');assert.equal(row.sms_code,'012345');assert.equal(row.refund_status,'none');
  assert.equal(f.sent.filter(x=>!x.edit).length,1);assert.equal(f.sent.filter(x=>x.edit).length,1);
});
test('a confirmed provider cancellation is excluded from SMS delivery while its wallet credit is pending',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='cancel_pending' WHERE id=1");
  await f.run("INSERT INTO hero_sms_cancel_receipts(order_id,activation_id) VALUES(1,'123')");
  let calls=0;f.ctx.heroSmsApi=async()=>{calls++;return 'STATUS_OK:012345';};await f.ctx.heroPollSms();
  assert.equal(calls,0);assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'cancel_pending');
});

test('provider STATUS_CANCEL updates the existing client card once without crediting a refund',async t=>{
  const f=await fixture(t);await f.ctx.heroUpdateOrderCard(1);
  f.ctx.heroSmsApi=async()=> 'STATUS_CANCEL';
  await f.ctx.heroPollSms();await f.ctx.heroStatusUpdates();await f.ctx.heroStatusUpdates();
  const o=await f.get('SELECT status,refund_status FROM hero_sms_orders WHERE id=1');
  assert.equal(o.status,'canceled');assert.equal(o.refund_status,'none');
  assert.equal(f.sent.filter(x=>!x.edit).length,1);assert.equal(f.sent.filter(x=>x.edit).length,1);
  assert.match(f.sent.find(x=>x.edit).msg,/ATIVAÇÃO CANCELADA/);
});
test('external history cancellation notifies an order with no existing message reference',async t=>{
  const f=await fixture(t);
  f.ctx.heroSmsV1=async(method,path)=>path.startsWith('/activations/history?')?{data:[{id:123,status:8}],meta:{hasMore:false}}:{data:[],meta:{hasMore:false}};
  await f.ctx.heroSyncExternal();await f.ctx.heroStatusUpdates();await f.ctx.heroSyncExternal();await f.ctx.heroStatusUpdates();
  assert.equal(f.sent.length,1);assert.match(f.sent[0].msg,/ATIVAÇÃO CANCELADA/);
  assert.equal((await f.get('SELECT delivered FROM hero_sms_external_events WHERE order_id=1')).delivered,1);
});
test('an uncertain purchase with a known activation id is checked for external cancellation',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='uncertain',phone=NULL WHERE id=1");
  f.ctx.heroSmsApi=async()=> 'STATUS_CANCEL';await f.ctx.heroPollSms();await f.ctx.heroStatusUpdates();
  assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'canceled');assert.equal(f.sent.length,1);
});
test('a missing activation id is never guessed from unrelated supplier orders',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='uncertain',phone=NULL,activation_id=NULL WHERE id=1");
  let calls=0;f.ctx.heroSmsApi=async()=>{calls++;return 'STATUS_CANCEL';};await f.ctx.heroPollSms();await f.ctx.heroSyncExternal();
  assert.equal(calls,0);assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'uncertain');assert.equal(f.sent.length,0);
});
test('an admin-supplied activation id is linked only after read-only provider cancellation confirmation',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='uncertain',phone=NULL,activation_id=NULL WHERE id=1");
  let calls=0;f.ctx.heroSmsApi=async(action,params)=>{assert.equal(action,'getStatus');assert.equal(params.id,'123');calls++;return 'STATUS_CANCEL';};
  await f.ctx.heroReconcileExternalCancellation(1,'123');await f.ctx.heroStatusUpdates();
  const o=await f.get('SELECT activation_id,status,refund_status FROM hero_sms_orders WHERE id=1');
  assert.equal(o.activation_id,'123');assert.equal(o.status,'canceled');assert.equal(o.refund_status,'none');assert.equal(calls,1);assert.equal(f.sent.length,1);
});
test('unconfirmed manual reconciliation preserves the order and its balance state',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='uncertain',activation_id=NULL WHERE id=1");
  f.ctx.heroSmsApi=async()=> 'STATUS_WAIT_CODE';await assert.rejects(f.ctx.heroReconcileExternalCancellation(1,'123'));
  const o=await f.get('SELECT activation_id,status,refund_status FROM hero_sms_orders WHERE id=1');assert.equal(o.activation_id,null);assert.equal(o.status,'uncertain');assert.equal(o.refund_status,'none');
});
test('manual reconciliation rejects an activation already linked to another order',async t=>{
  const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='uncertain' WHERE id=1");
  await f.run("INSERT INTO hero_sms_orders(customer_id,customer_jid,service,country,price_brl,cost_at_quote,payment_method,activation_id,status) VALUES(1,'test','wa','73',25,1,'saldo','999','number_received')");
  await assert.rejects(f.ctx.heroReconcileExternalCancellation(1,'999'));
  assert.equal((await f.get('SELECT activation_id FROM hero_sms_orders WHERE id=1')).activation_id,'123');
});
test('an unsuccessful cancellation notification remains queued for retry',async t=>{
  const f=await fixture(t);f.ctx.heroSmsApi=async()=> 'STATUS_CANCEL';await f.ctx.heroPollSms();
  const send=f.ctx.enviarTexto;f.ctx.enviarTexto=async()=>false;await f.ctx.heroStatusUpdates();
  assert.equal((await f.get('SELECT delivered FROM hero_sms_external_events WHERE order_id=1')).delivered,0);
  f.ctx.enviarTexto=send;await f.ctx.heroStatusUpdates();assert.equal(f.sent.length,1);
  assert.equal((await f.get('SELECT delivered FROM hero_sms_external_events WHERE order_id=1')).delivered,1);
});
