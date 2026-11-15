'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const sqlite3=require('sqlite3');
const {creditHeroRefund}=require('../hero-sms-refunds');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
async function fixture(t,{method='saldo',customer=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hero-refund-'));const filename=path.join(dir,'db.sqlite');
 const db=new sqlite3.Database(filename);db.configure('busyTimeout',5000);
 t.after(async()=>{await new Promise(resolve=>db.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});});
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,row)=>e?reject(e):resolve(row)));
 const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,row)=>e?reject(e):resolve(row)));
 let calls=0;
 const ctx=vm.createContext({run,get,all,URLSearchParams,DB_PATH:filename,creditHeroRefund,createHeroLifecycle:require('../hero-sms-lifecycle').createHeroLifecycle,heroSmsV1:async()=>({data:[],meta:{hasMore:false}}),heroProtocol:require('../hero-sms-protocol'),addColumnIfMissing:async()=>{},brl:v=>'R$ '+v,heroSmsApi:async(action,p)=>{if(action==='getStatus')return 'STATUS_WAIT_CODE';assert.equal(action,'setStatus');assert.equal(p.status,8);calls++;return 'ACCESS_CANCEL';}});
 vm.runInContext(section('async function heroPedidosInit(){','async function heroCatalogInit(){'),ctx);
 vm.runInContext(section('async function heroCancelOrder(','let heroOrderMessenger=null;'),ctx);
 vm.runInContext(section('async function heroCreditConfirmedRefund(','let heroSyncExternalRunning'),ctx);
 await ctx.heroPedidosInit();
 const realLifecycle=ctx.heroLifecycle;ctx.heroLifecycle=()=>{const lifecycle=realLifecycle();return {...lifecycle,preflight:async o=>{await lifecycle.otp(o);return get('SELECT * FROM hero_sms_orders WHERE id=?',[o.id]);}};};
 await run('CREATE TABLE revendas(id INTEGER PRIMARY KEY,saldo REAL,atualizado_em TEXT)');
 if(customer)await run('INSERT INTO revendas(id,saldo) VALUES(1,50)');
 await run("INSERT INTO hero_sms_orders(customer_id,customer_jid,service,country,price_brl,cost_at_quote,payment_method,activation_id,phone,status,created_at,number_received_at) VALUES(1,'wa:5511','wa','73',25,1,?,'123','5511999999999','number_received',datetime('now','-1 hour'),datetime('now','-3 minutes'))",[method]);
 return {ctx,run,get,filename,calls:()=>calls};
}
test('confirmed cancellation credits the full sale price once, including concurrent requests',async t=>{
 const f=await fixture(t);
 await Promise.all([f.ctx.heroCancelOrder('wa:5511',1),f.ctx.heroCancelOrder('wa:5511',1)]);
 await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal(f.calls(),1);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,75);
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_refund_ledger')).n,1);
 assert.equal((await f.get('SELECT refund_status FROM hero_sms_orders WHERE id=1')).refund_status,'credited');
});
test('PIX cancellation credits the wallet; it does not claim a bank refund',async t=>{
 const f=await fixture(t,{method:'pix'});const message=await f.ctx.heroCancelOrder('wa:5511',1);
 assert.match(message,/carteira/);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,75);assert.equal(f.calls(),1);
});
test('provider rejection does not credit the customer',async t=>{
 const f=await fixture(t);f.ctx.heroSmsApi=async()=> 'EARLY_CANCEL_DENIED';await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,50);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'number_received');
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_cancel_receipts')).n,0);
});
test('timeout leaves cancellation pending without a wallet credit',async t=>{
 const f=await fixture(t);f.ctx.heroSmsApi=async()=>{throw new Error('timeout');};
 await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,50);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'cancel_pending');
});
test('confirmed cancellation with failed credit preserves proof and later retries without another API call',async t=>{
 const f=await fixture(t,{customer:false});await f.ctx.heroCancelOrder('wa:5511',1);
 assert.ok(await f.get('SELECT * FROM hero_sms_cancel_receipts WHERE order_id=1'));
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_refund_ledger')).n,0);
 await f.run('INSERT INTO revendas(id,saldo) VALUES(1,50)');await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal(f.calls(),1);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,75);
});
test('received SMS, another customer, and a newly delivered number block cancellation',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.ctx.heroCancelOrder('wa:another',1));
 await f.run("UPDATE hero_sms_orders SET number_received_at=CURRENT_TIMESTAMP WHERE id=1");
 await assert.rejects(f.ctx.heroCancelOrder('wa:5511',1));
 await f.run("UPDATE hero_sms_orders SET number_received_at=datetime('now','-3 minutes'),sms_code='123456',status='sms_received' WHERE id=1");
 await assert.rejects(f.ctx.heroCancelOrder('wa:5511',1));assert.equal(f.calls(),0);
});
test('dedicated refund transactions serialize and require persisted provider confirmation',async t=>{
 const f=await fixture(t);
 await assert.rejects(creditHeroRefund(f.filename,1));
 await f.run("INSERT INTO hero_sms_cancel_receipts(order_id,activation_id) VALUES(1,'123')");
 await Promise.all([creditHeroRefund(f.filename,1),creditHeroRefund(f.filename,1)]);
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,75);
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_refund_ledger')).n,1);
});

test('HTTP 409 rejection returns to an active order without crediting the wallet',async t=>{
 const f=await fixture(t);f.ctx.heroSmsApi=async()=>{const e=new Error('HTTP 409');e.response={status:409};throw e;};
 await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'number_received');
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,50);
});
test('unknown successful HTTP response is held for reconciliation without credit or blind retries',async t=>{
 const f=await fixture(t);let calls=0;f.ctx.heroSmsApi=async()=>{calls++;return '<html>proxy error</html>';};
 await f.ctx.heroCancelOrder('wa:5511',1);await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal(calls,1);assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'cancel_pending');
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,50);
});
test('JSON-encoded ACCESS_CANCEL is accepted as the documented string response',async t=>{
 const f=await fixture(t);f.ctx.heroSmsApi=async()=>JSON.stringify('ACCESS_CANCEL');await f.ctx.heroCancelOrder('wa:5511',1);
 assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,75);
});

test('closing an explicitly declared test changes only that order, leaving Pix and wallet untouched',async t=>{
 const f=await fixture(t,{method:'pix'});
 await f.run("UPDATE hero_sms_orders SET status='uncertain',activation_id=NULL,phone=NULL,payment_id='pix15',last_error='Request failed with status code 404' WHERE id=1");
 await f.run('CREATE TABLE pix_pedidos(payment_id TEXT PRIMARY KEY,status TEXT)');await f.run("INSERT INTO pix_pedidos VALUES('pix15','delivery_pending')");
 await f.ctx.heroCloseTestOrder(1);await f.ctx.heroCloseTestOrder(1);
 const order=await f.get('SELECT status,refund_status,last_error FROM hero_sms_orders WHERE id=1');
 assert.equal(order.status,'test_closed');assert.equal(order.refund_status,'none');assert.match(order.last_error,/404/);
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivery_pending');
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_test_closures')).n,1);assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_refund_ledger')).n,0);
});
test('test closure refuses an order with a real activation and preserves its state',async t=>{
 const f=await fixture(t);await assert.rejects(f.ctx.heroCloseTestOrder(1));assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'number_received');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
});
