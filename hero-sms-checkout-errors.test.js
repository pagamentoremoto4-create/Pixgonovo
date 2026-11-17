'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sqlite3=require('sqlite3');
const {checkoutError,checkoutMessage,checkoutDiagnostic}=require('../hero-sms-checkout-errors');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
function section(a,b){const i=source.indexOf(a);return source.slice(i,source.indexOf(b,i));}
async function fixture(t,saldo=50){
 const db=new sqlite3.Database(':memory:');t.after(()=>new Promise(resolve=>db.close(()=>resolve())));
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 let purchases=0;const notifications=[];
 const ctx=vm.createContext({customerBilling:{heroMode:async()=>'PRE_PAGO'},run,get,DB_PATH:':memory:',debitHeroOrder:async(_,id)=>{const o=await get('SELECT * FROM hero_sms_orders WHERE id=?',[id]);const debit=await run('UPDATE revendas SET saldo=saldo-?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND saldo>=?',[o.price_brl,o.customer_id,o.price_brl]);if(debit.changes)await run("UPDATE hero_sms_orders SET status='paid' WHERE id=?",[id]);return debit;},checkoutError,Number,String,Set,heroPedidosInit:async()=>{},heroSmsVitrine:async()=>[{country:'73',service:'wa',cost:1,stock:100,nome:'WhatsApp'}],heroValidCountry:require('../hero-sms-countries').heroValidCountry,heroPrecoCliente:async()=>25,brl:v=>'R$ '+Number(v).toFixed(2),heroBuyPaid:async()=>purchases++,enviarTexto:async(jid,text)=>notifications.push(text)});
 await run('CREATE TABLE revendas(id INTEGER PRIMARY KEY,saldo REAL,atualizado_em TEXT)');
 await run('INSERT INTO revendas(id,saldo) VALUES(1,?)',[saldo]);
 await run("CREATE TABLE hero_sms_orders(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,customer_jid TEXT,service TEXT,country TEXT,price_brl REAL,cost_at_quote REAL,payment_method TEXT,status TEXT DEFAULT 'awaiting_payment')");
 vm.runInContext(section('const heroCheckoutInFlight = new Set();','async function heroBuyPaid('),ctx);
 return {ctx,run,get,purchases:()=>purchases,notifications};
}
test('wallet checkout uses the real current database balance and debits the selected customer',async t=>{
 const f=await fixture(t);const id=await f.ctx.heroCheckout('wa:5511',{id:1,saldo:0},{country:'73',service:'wa'},'saldo');
 assert.equal(id,1);assert.equal(f.purchases(),1);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,25);
});
test('insufficient balance produces an actionable message without buying or debiting',async t=>{
 const f=await fixture(t,10);let error;
 try{await f.ctx.heroCheckout('wa:5511',{id:1},{country:'73',service:'wa'},'saldo');}catch(e){error=e;}
 assert.equal(error.code,'INSUFFICIENT_BALANCE');assert.match(checkoutMessage(error,'test'),/R\$ 25.00/);assert.match(checkoutMessage(error,'test'),/R\$ 10.00/);
 assert.equal(f.purchases(),0);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,10);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'insufficient_balance');
});
test('a paid unresolved order blocks another purchase and identifies the existing order',async t=>{
 const f=await fixture(t);await f.run("INSERT INTO hero_sms_orders(customer_id,customer_jid,status) VALUES(1,'wa:5511','uncertain')");
 await assert.rejects(f.ctx.heroCheckout('wa:5511',{id:1},{country:'73',service:'wa'},'saldo'),e=>e.code==='ORDER_RECONCILIATION'&&e.message.includes('#1'));
 assert.equal(f.purchases(),0);assert.equal((await f.get('SELECT saldo FROM revendas WHERE id=1')).saldo,50);
});
test('WhatsApp confirmation reuses the already identified customer without a second phone lookup',async()=>{
 const cliente={id:7,whatsapp:'+55 (11) 99999-9999'};let purchases=0;
 const ctx=vm.createContext({cliente,sess:{etapa:'hero_oferta',heroOferta:{country:'73',service:'wa'}},from:'wa:5511999999999',opcao:'1',lower:'1',get:async()=>assert.fail('must not reidentify customer by phone'),heroCheckout:async(jid,c)=>{assert.equal(c.id,7);assert.equal(c,cliente);purchases++;},enviarTexto:async()=>assert.fail('unexpected failure')});
 const branch=section("  if(sess?.etapa==='hero_oferta'){","  if (sess?.etapa === 'online_categorias')");
 await vm.runInContext('(async()=>{'+branch+'})()',ctx);assert.equal(purchases,1);
});
test('unknown errors expose only a reference to the customer and redact diagnostics',()=>{
 const error=new Error('Request failed https://example.com/?api_key=private api_key=secret');
 const message=checkoutMessage(error,'HERO-TEST');assert.ok(message.includes('HERO-TEST'));assert.ok(!message.includes('secret'));assert.ok(!message.includes('private'));
 const diag=checkoutDiagnostic(error,'HERO-TEST');assert.ok(!diag.message.includes('private'));assert.ok(!diag.message.includes('secret'));
 assert.match(checkoutMessage(checkoutError('OUT_OF_STOCK','Oferta sem estoque.'),'test'),/Oferta sem estoque/);
});
