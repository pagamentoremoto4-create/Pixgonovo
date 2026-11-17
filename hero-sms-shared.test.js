'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),sqlite=require('sqlite3');
const {createSharedHeroService,mountSharedHeroRoutes}=require('../hero-sms-shared');
const {creditHeroRefund}=require('../hero-sms-refunds');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hero-shared-')),filename=path.join(dir,'db.sqlite'),db=new sqlite.Database(filename);db.configure('busyTimeout',10000);
 t.after(async()=>{await new Promise(r=>db.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const ctx=vm.createContext({run,get,all,addColumnIfMissing:async()=>{}});const a=source.indexOf('async function heroPedidosInit(){');vm.runInContext(source.slice(a,source.indexOf('async function heroCatalogInit(){',a)),ctx);await ctx.heroPedidosInit();
 await run('CREATE TABLE revendas(id INTEGER PRIMARY KEY,saldo REAL,atualizado_em TEXT)');await run('INSERT INTO revendas(id,saldo) VALUES(1,100)');
 let purchases=0,actions=0,available=true,uncertain=false;
 const catalog=async()=>available?[{country:'73',service:'wa',pais:'Brasil',stock:100,cost:1}]:[];
 let service;const opts={filename,run,get,all,ensureOrders:ctx.heroPedidosInit,catalog,purchase:async id=>{
  const lock=await run("UPDATE hero_sms_orders SET status='purchasing' WHERE id=? AND status='paid'",[id]);if(!lock.changes)return;purchases++;
  await run("UPDATE hero_sms_orders SET status=?,activation_id=?,phone=?,number_received_at=datetime('now','-3 minutes'),expires_at=datetime('now','+20 minutes') WHERE id=?",[uncertain?'uncertain':'number_received',uncertain?null:'123'+id,uncertain?null:'5511999999999',id]);
 },cancel:async(jid,id)=>{actions++;const o=await get('SELECT * FROM hero_sms_orders WHERE id=?',[id]);assert.equal(o.customer_jid,jid);await run('INSERT OR IGNORE INTO hero_sms_cancel_receipts(order_id,activation_id) VALUES(?,?)',[id,o.activation_id]);return service.confirmRefund(id,true);},replace:async(_,id)=>{actions++;await run("UPDATE hero_sms_orders SET phone='5511888888888',activation_id='999' WHERE id=?",[id]);},finish:async(_,id)=>{actions++;await run("UPDATE hero_sms_orders SET status='finished' WHERE id=?",[id]);}};
 service=createSharedHeroService(opts);await service.init();const input={source:'TELEGRAMESIM',customer_id:'1001',external_order_id:'tg-test-1',country:'73',sale_price_brl:25};
 return {service,run,get,all,filename,input,catalog,purchases:()=>purchases,actions:()=>actions,stock:v=>available=v,uncertain:v=>uncertain=v};
}
test('shared purchase is idempotent across duplicate requests and leaves central customer wallets untouched',async t=>{
 const f=await fixture(t);const results=await Promise.all([f.service.create(f.input),f.service.create(f.input)]);await f.service.create(f.input);
 assert.equal(f.purchases(),1);assert.equal(results[0].central_order_id,results[1].central_order_id);assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,100);assert.equal((await f.all('SELECT * FROM hero_sms_shared_orders')).length,1);
});
test('uncertain external purchase is never repeated and unavailable offers are rejected before purchase',async t=>{
 const f=await fixture(t);f.uncertain(true);const o=await f.service.create(f.input);assert.equal(o.status,'uncertain');await f.service.create(f.input);await f.service.recover();assert.equal(f.purchases(),1);
 f.stock(false);await assert.rejects(f.service.create({...f.input,external_order_id:'new'}),e=>e.definitive&&e.code==='OUT_OF_STOCK');assert.equal(f.purchases(),1);
});
test('source, external customer and sale price cannot be changed on a reused order ID',async t=>{
 const f=await fixture(t);await f.service.create(f.input);await assert.rejects(f.service.read({...f.input,customer_id:'2002'}));await assert.rejects(f.service.read({...f.input,source:'OTHER'}));await assert.rejects(f.service.create({...f.input,sale_price_brl:1}),e=>e.code==='IDEMPOTENCY_CONFLICT'&&!e.definitive);assert.equal(f.purchases(),1);
});
test('shared replacement action executes once for the same request ID and exposes the updated phone',async t=>{
 const f=await fixture(t);await f.service.create(f.input);const input={...f.input,action:'replace',request_id:'replace-request-1'};const result=await f.service.action(input);await f.service.action(input);assert.equal(f.actions(),1);assert.equal(result.phone,'5511888888888');
 await assert.rejects(f.service.action({...input,action:'cancel'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
test('external refund proof is published once, acknowledged idempotently, and never credited to central revendas',async t=>{
 const f=await fixture(t);const o=await f.service.create(f.input);const result=await f.service.action({...f.input,action:'cancel',request_id:'cancel-request-1'});
 assert.equal(result.refund.amount_brl,25);assert.equal(result.refund.state,'confirmed');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,100);
 await assert.rejects(creditHeroRefund(f.filename,o.central_order_id));await assert.rejects(f.service.acknowledge({...f.input,reference:'wrong'}));
 await f.service.acknowledge({...f.input,reference:result.refund.reference});await f.service.acknowledge({...f.input,reference:result.refund.reference});
 assert.equal((await f.service.read(f.input)).refund.state,'acknowledged');assert.equal((await f.get('SELECT refund_status FROM hero_sms_orders')).refund_status,'credited_external');assert.equal((await f.all('SELECT * FROM hero_sms_refund_ledger')).length,0);
});
test('SMS history is returned in sequence and external refund without proof or with SMS is denied',async t=>{
 const f=await fixture(t),o=await f.service.create(f.input);await assert.rejects(f.service.confirmRefund(o.central_order_id,true));
 await f.run("INSERT INTO hero_sms_sms_events(order_id,activation_id,event_key,code,received_at) VALUES(?,?,'id:sms1','123456','2026-11-15T14:00:00Z')",[o.central_order_id,'123'+o.central_order_id]);
 await f.run('UPDATE hero_sms_orders SET sms_received=1 WHERE id=?',[o.central_order_id]);const result=await f.service.read(f.input);assert.equal(result.messages[0].sequence,1);assert.equal(result.actions.cancel,false);assert.equal(result.actions.replace,false);assert.equal(result.actions.finish,true);await assert.rejects(f.service.confirmRefund(o.central_order_id,true));
});
test('shared API requires connection authentication and never exposes the Hero credential',async t=>{
 const f=await fixture(t),express=require('express'),app=express();app.use(express.json());mountSharedHeroRoutes(app,{service:f.service,authorized:async req=>req.get('x-shared-esim-key')==='test-key',catalog:f.catalog});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/shared-herosms/catalog')).status,401);const response=await fetch(base+'/api/shared-herosms/orders',{method:'POST',headers:{'x-shared-esim-key':'test-key','content-type':'application/json'},body:JSON.stringify(f.input)});assert.equal(response.status,200);const body=await response.json();assert.equal(body.order.phone,'5511999999999');assert.ok(!JSON.stringify(body).includes('ApiKey'));
});

test('a definitive stock rejection is durable: the same paid order ID can never buy later after refund',async t=>{
 const f=await fixture(t);f.stock(false);await assert.rejects(f.service.create(f.input),e=>e.code==='OUT_OF_STOCK'&&e.definitive);f.stock(true);await assert.rejects(f.service.create(f.input),e=>e.code==='OUT_OF_STOCK'&&e.definitive);assert.equal(f.purchases(),0);assert.equal((await f.all('SELECT * FROM hero_sms_shared_rejections')).length,1);
});
