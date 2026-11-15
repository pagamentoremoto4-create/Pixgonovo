'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const sqlite=require('sqlite3');
const {createHeroLifecycle,createHeroWebhook}=require('../hero-sms-lifecycle');
const {creditHeroRefund}=require('../hero-sms-refunds');
const {renderOrderCard}=require('../hero-sms-order-card');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hero-v7-'));const filename=path.join(dir,'test.db');const db=new sqlite.Database(filename);db.configure('busyTimeout',5000);
 t.after(async()=>{await new Promise(r=>db.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const ctx=vm.createContext({run,get,all,addColumnIfMissing:async()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function heroPedidosInit(){'),source.indexOf('async function heroCatalogInit(){')),ctx);await ctx.heroPedidosInit();
 await run('CREATE TABLE revendas(id INTEGER PRIMARY KEY,saldo REAL,atualizado_em TEXT)');await run('INSERT INTO revendas(id,saldo) VALUES(1,25)');
 await run("INSERT INTO hero_sms_orders(customer_id,customer_jid,service,country,price_brl,cost_at_quote,payment_method,activation_id,phone,status,created_at,number_received_at) VALUES(1,'wa:5511','wa','73',25,1,'saldo','123','5511999999999','number_received',datetime('now','-3 minutes'),datetime('now','-3 minutes'))");
 const calls=[],events=[];let entries=[],history=[],active=[],status='STATUS_WAIT_CODE',failFinish=false;
 const options={run,get,all,credit:(o,requireReceipt)=>creditHeroRefund(filename,o.id,{requireReceipt}),notify:async id=>events.push(id),compat:async(action,args)=>{calls.push({action,args});return action==='setStatus'?'ACCESS_CANCEL':status;},api:async(method,url)=>{
  calls.push({method,url});
  if(method==='POST'){if(failFinish)throw new Error('timeout');return undefined;}
  return {data:url.startsWith('/activations/history?')?history:url.startsWith('/activations?')?active:entries,meta:{hasMore:false}};
 }};
 const lifecycle=createHeroLifecycle(options);
 return {run,get,all,filename,options,lifecycle,calls,events,order:()=>get('SELECT * FROM hero_sms_orders WHERE id=1'),sms:v=>entries=v,history:v=>history=v,active:v=>active=v,status:v=>status=v,failFinish:v=>failFinish=v};
}
test('all SMS are persisted once by provider ID; fallback merges and equal codes from distinct real SMS remain distinct',async t=>{
 const f=await fixture(t),o=await f.order();
 await f.lifecycle.sms(o,{code:'012345',type:'sms'});
 await f.lifecycle.sms(o,{id:'a',smsCode:'012345',receivedAt:'2026-11-15T14:05:00Z',type:'sms'});
 await f.lifecycle.sms(o,{id:'a',smsCode:'012345',type:'sms'});
 await f.lifecycle.sms(o,{id:'b',smsCode:'012345',receivedAt:'2026-11-15T14:06:00Z',type:'sms'});
 await f.lifecycle.sms(o,{id:'c',smsCode:'654321',receivedAt:'2026-11-15T14:07:00Z',type:'sms'});
 const messages=await f.all('SELECT * FROM hero_sms_sms_events ORDER BY received_at,id');assert.equal(messages.length,3);
 const card=renderOrderCard({...await f.order(),messages},0);assert.match(card.text,/Código 1: 012345/);assert.match(card.text,/Código 3: 654321/);assert.match(card.text,/1️⃣ ✅ Finalizar/);assert.doesNotMatch(card.text,/Solicitar troca|Solicitar cancelamento|Saldo|Pago com/);
});
test('SMS text without a code prevents cancellation and enables numeric finalization',async t=>{
 const f=await fixture(t);f.sms([{id:'x',smsText:'Mensagem recebida sem código',type:'sms'}]);
 const checked=await f.lifecycle.preflight(await f.order());assert.equal(checked.sms_received,1);assert.equal(checked.sms_code,null);
 const messages=await f.all('SELECT * FROM hero_sms_sms_events');const c=renderOrderCard({...checked,messages},0);assert.match(c.text,/SMS 1: Mensagem/);assert.match(c.text,/Finalizar/);assert.doesNotMatch(c.text,/Solicitar troca|Solicitar cancelamento/);
});
test('finish checks ownership, persists successful 204, preserves SMS and offers another purchase without refund',async t=>{
 const f=await fixture(t);f.sms([{id:'1',smsCode:'123456',type:'sms'}]);await f.lifecycle.otp(await f.order());
 await assert.rejects(f.lifecycle.finish('wa:other',1));await f.lifecycle.finish('wa:5511',1);await f.lifecycle.finish('wa:5511',1);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal((await f.order()).status,'finished');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);assert.equal((await f.all('SELECT * FROM hero_sms_sms_events')).length,1);
 const card=renderOrderCard(await f.order());assert.match(card.text,/Comprar outro número/);assert.doesNotMatch(card.text,/Solicitar troca|Solicitar cancelamento/);
});
test('finish timeout stays pending until history confirms completion; no false success or refund',async t=>{
 const f=await fixture(t);await f.lifecycle.sms(await f.order(),{id:'1',code:'123456',type:'sms'});f.failFinish(true);
 await assert.rejects(f.lifecycle.finish('wa:5511',1));assert.equal((await f.order()).status,'finish_pending');
 f.history([{id:123,status:6}]);await f.lifecycle.sync();assert.equal((await f.order()).status,'finished');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);
});
test('real provider expiration is persisted and expiration with SMS automatically finishes',async t=>{
 const f=await fixture(t);const expired=new Date(Date.now()-5000).toISOString();
 await f.lifecycle.snapshot(await f.order(),{id:123,expiredAt:expired,createdAt:'2026-11-15T00:00:00Z',price:1.5,currency:840,otpTotalCount:1,otpLast:{id:'a',smsCode:'123456',type:'sms'}});
 assert.equal((await f.order()).expires_at,expired);assert.equal((await f.order()).provider_cost,1.5);
 await f.lifecycle.poll();assert.equal((await f.order()).status,'finished');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('expiration without SMS cancels only after provider preflight and credits once',async t=>{
 const f=await fixture(t);await f.run('UPDATE hero_sms_orders SET expires_at=?',[new Date(Date.now()-1000).toISOString()]);
 await f.lifecycle.poll();await f.lifecycle.poll();assert.equal((await f.order()).refund_status,'credited');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
 assert.equal(f.calls.filter(c=>c.action==='setStatus').length,1);assert.equal((await f.all('SELECT * FROM hero_sms_refund_ledger')).length,1);
});
test('expiration never credits based on clock alone when provider read fails',async t=>{
 const f=await fixture(t);await f.run('UPDATE hero_sms_orders SET expires_at=?',[new Date(Date.now()-1000).toISOString()]);
 f.options.api=async()=>{throw new Error('offline');};const lifecycle=createHeroLifecycle(f.options);await lifecycle.poll();
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);assert.equal((await f.order()).status,'number_received');assert.equal(f.calls.filter(c=>c.action==='setStatus').length,0);
});
test('manual Hero cancellation waits for status 10 then credits the full customer price exactly once, including older orders',async t=>{
 const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET created_at='2025-01-01 00:00:00'");f.status('STATUS_CANCEL');await f.lifecycle.poll();
 assert.equal((await f.order()).status,'canceled');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);
 f.history([{id:123,status:8}]);await f.lifecycle.sync();assert.equal((await f.order()).refund_status,'none');
 f.history([{id:123,status:10}]);await f.lifecycle.sync();await f.lifecycle.sync();
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);assert.equal((await f.order()).refund_status,'credited');assert.ok(f.calls.some(c=>c.url?.includes('from=2024-12-31')));
});
test('unconfirmed history refund cannot credit; confirmed refund with SMS is held for review',async t=>{
 const f=await fixture(t);await assert.rejects(creditHeroRefund(f.filename,1,{requireReceipt:false}));
 await f.lifecycle.sms(await f.order(),{id:'1',code:'123456',type:'sms'});f.history([{id:123,status:10}]);await f.lifecycle.sync();
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);assert.match((await f.order()).last_error,/conferência/);
});
test('old activation SMS after replacement is ignored and cannot contaminate the new activation',async t=>{
 const f=await fixture(t),old=await f.order();await f.run("UPDATE hero_sms_orders SET activation_id='999'");
 assert.equal(await f.lifecycle.sms(old,{id:'old',code:'123456',type:'sms'}),false);assert.equal((await f.all('SELECT * FROM hero_sms_sms_events')).length,0);
});
test('large SMS history has stable global numbering and navigable pages within Telegram limits',()=>{
 const messages=Array.from({length:30},(_,i)=>({code:String(100000+i),received_at:'2026-11-15T14:00:00Z'}));
 const last=renderOrderCard({id:1,status:'sms_received',messages,display_sms_page:-1},0,true);assert.match(last.text,/Código 25:/);assert.ok(last.text.length<4000);assert.ok(last.buttons.some(row=>row[0].callback_data==='hero_sms_codes_1_2'));
 const first=renderOrderCard({id:1,status:'sms_received',messages,display_sms_page:0},0);assert.match(first.text,/Código 1:/);assert.match(first.text,/4️⃣ Próximos SMS/);
});
test('webhook requires secret, checks country/service, and fetches SMS upstream instead of trusting payload',async t=>{
 const f=await fixture(t);let updates=0;f.sms([{id:'real',code:'222222',type:'sms'}]);
 const handler=createHeroWebhook({secret:()=> 's'.repeat(40),findOrder:()=>f.order(),lifecycle:()=>f.lifecycle,update:async()=>updates++});
 const res={status:null,sendStatus(n){this.status=n;return this;}};
 await handler({params:{token:'wrong'},body:{activationId:123}},res);assert.equal(res.status,404);
 await handler({params:{token:'s'.repeat(40)},body:{activationId:123,service:'tg'}},res);assert.equal(res.status,400);
 await handler({params:{token:'s'.repeat(40)},body:{activationId:123,country:73,service:'wa',code:'FAKE'}},res);
 assert.equal(res.status,200);assert.equal(updates,1);assert.equal((await f.all('SELECT code FROM hero_sms_sms_events'))[0].code,'222222');
});

test('real cancellation and replacement handlers reject a newly arrived SMS without making the mutation request',async t=>{
 const f=await fixture(t);f.sms([{id:'race',smsText:'SMS sem código identificado',type:'sms'}]);
 const ctx=vm.createContext({run:f.run,get:f.get,all:f.all,heroPedidosInit:async()=>{},heroLifecycle:()=>f.lifecycle,heroSmsV1:f.options.api,heroSmsApi:f.options.compat,heroProtocol:require('../hero-sms-protocol')});
 let start=source.indexOf('async function heroCancelOrder(');vm.runInContext(source.slice(start,source.indexOf('let heroOrderMessenger=null;',start)),ctx);
 start=source.indexOf('async function heroReplaceOrder(');vm.runInContext(source.slice(start,source.indexOf('async function heroOrderHistory(',start)),ctx);
 await assert.rejects(ctx.heroCancelOrder('wa:5511',1),/SMS recebido/);await assert.rejects(ctx.heroReplaceOrder('wa:5511',1),/Troca indisponível/);
 assert.equal(f.calls.filter(c=>c.method==='POST'||c.action==='setStatus').length,0);
});
test('wallet debit and paid state are atomic and idempotent under concurrent confirmations',async t=>{
 const {debitHeroOrder}=require('../hero-sms-refunds');const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='awaiting_payment'");
 await Promise.all([debitHeroOrder(f.filename,1),debitHeroOrder(f.filename,1)]);
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,0);assert.equal((await f.order()).status,'paid');assert.equal((await f.all('SELECT * FROM hero_sms_wallet_debits')).length,1);
});
test('wallet debit rolls back if recording paid state fails',async t=>{
 const {debitHeroOrder}=require('../hero-sms-refunds');const f=await fixture(t);await f.run("UPDATE hero_sms_orders SET status='awaiting_payment'");
 await f.run("CREATE TRIGGER fail_paid BEFORE UPDATE OF status ON hero_sms_orders WHEN NEW.status='paid' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
 await assert.rejects(debitHeroOrder(f.filename,1));assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);assert.equal((await f.order()).status,'awaiting_payment');assert.equal((await f.all('SELECT * FROM hero_sms_wallet_debits')).length,0);
});
test('external refund proof survives wallet failure and permits recovery without a second provider refund',async t=>{
 const f=await fixture(t);await f.run('DELETE FROM revendas');f.history([{id:123,status:10}]);await f.lifecycle.sync();
 assert.equal((await f.order()).status,'canceled');assert.equal((await f.order()).refund_status,'none');assert.equal((await f.all('SELECT * FROM hero_sms_refund_receipts')).length,1);
 await f.run('INSERT INTO revendas(id,saldo) VALUES(1,25)');await creditHeroRefund(f.filename,1,{requireReceipt:false});await creditHeroRefund(f.filename,1,{requireReceipt:false});
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
});
test('webhook cannot mark fake incoming SMS as received when authenticated provider list is empty',async t=>{
 const f=await fixture(t);const handler=createHeroWebhook({secret:()=> 'x'.repeat(40),findOrder:()=>f.order(),lifecycle:()=>f.lifecycle,update:async()=>{}});
 const res={sendStatus(n){this.status=n;return this;}};await handler({params:{token:'x'.repeat(40)},body:{activationId:123,code:'123456',service:'wa',country:73}},res);
 assert.equal(res.status,200);assert.equal((await f.order()).sms_received,0);assert.equal((await f.all('SELECT * FROM hero_sms_sms_events')).length,0);
});

test('WhatsApp option 1 opens finish confirmation after SMS and opens countries after finalization',async()=>{
 const start=source.indexOf("  if(sess?.etapa==='hero_pedido_menu'){");const branch=source.slice(start,source.indexOf("  if(/^trocar (?:número|numero|hero)",start));
 let saved,selected=0;let order={id:25,status:'sms_received',sms_received:1,sms_code:null};
 const ctx=vm.createContext({sess:{etapa:'hero_pedido_menu',heroPedidoId:25,heroCardVersion:3},opcao:'1',from:'wa:5511',cliente:{id:1},get:async()=>order,salvarSessaoPedido:async(_,s)=>saved=s,enviarTexto:async()=>{},heroSmsWaPaises:async()=>selected++,heroWaitSeconds:()=>0});
 await vm.runInContext('(async()=>{'+branch+'})()',ctx);assert.equal(saved.etapa,'hero_finalizar_confirmar');assert.equal(selected,0);
 order={id:25,status:'finished'};await vm.runInContext('(async()=>{'+branch+'})()',ctx);assert.equal(selected,1);
});
test('WhatsApp finish confirmation uses numeric option 1',async()=>{
 const start=source.indexOf("  if(sess?.etapa==='hero_finalizar_confirmar'){");const branch=source.slice(start,source.indexOf("  if(sess?.etapa==='hero_pedido_confirmar'){",start));
 let finishes=0,cards=0;const ctx=vm.createContext({sess:{etapa:'hero_finalizar_confirmar',heroPedidoId:25},opcao:'1',from:'wa:5511',heroFinishOrder:async(jid,id)=>{assert.equal(jid,'wa:5511');assert.equal(id,25);finishes++;},heroWhatsMenuPedido:async()=>cards++,enviarTexto:async()=>assert.fail('unexpected error')});
 await vm.runInContext('(async()=>{'+branch+'})()',ctx);assert.equal(finishes,1);assert.equal(cards,1);
});

for(const status of [6,8,10])test('stale history status '+status+' for an old activation cannot finish, cancel or refund a replacement',async t=>{
 const f=await fixture(t);const api=f.options.api;
 f.options.api=async(method,url)=>{
  if(url.startsWith('/activations/history?')){await f.run("UPDATE hero_sms_orders SET activation_id='999',phone='5511888888888' WHERE id=1");return {data:[{id:123,status}],meta:{hasMore:false}};}
  return api(method,url);
 };
 await createHeroLifecycle(f.options).sync();const order=await f.order();
 assert.equal(order.activation_id,'999');assert.equal(order.status,'number_received');assert.equal(order.refund_status,'none');assert.equal(order.provider_status,null);
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,25);assert.equal((await f.all('SELECT * FROM hero_sms_refund_receipts')).length,0);
});

test('SMS pagination respects documented maximum size 25 and retrieves later codes using total metadata',async t=>{
 const f=await fixture(t);const rows=Array.from({length:26},(_,i)=>({id:'sms-'+i,code:String(100000+i),type:'sms'}));let pages=0;
 f.options.api=async(method,url)=>{const query=new URL('https://local'+url).searchParams;assert.equal(query.get('size'),'25');assert.equal(query.get('sort[id]'),'asc');const page=Number(query.get('page'));pages++;return {data:rows.slice((page-1)*25,page*25),meta:{total:26}};};
 await createHeroLifecycle(f.options).otp(await f.order());assert.equal(pages,2);assert.equal((await f.all('SELECT * FROM hero_sms_sms_events')).length,26);
});
test('history pagination respects maximum 25 and finds a refund beyond the first page',async t=>{
 const f=await fixture(t);f.options.api=async(method,url)=>{
  const query=new URL('https://local'+url).searchParams;assert.equal(query.get('size'),'25');
  if(url.startsWith('/activations?'))return {data:[],meta:{hasMore:false}};
  return Number(query.get('page'))===1?{data:Array.from({length:25},(_,i)=>({id:1000+i,status:6})),meta:{hasMore:true}}:{data:[{id:123,status:10}],meta:{hasMore:false}};
 };
 await createHeroLifecycle(f.options).sync();assert.equal((await f.order()).refund_status,'credited');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
});
