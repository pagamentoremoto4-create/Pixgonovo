'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sqlite3=require('sqlite3');
const protocol=require('../hero-sms-pix');
const heroProtocol=require('../hero-sms-protocol');
const errors=require('../hero-sms-checkout-errors');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
function section(a,b){const i=source.indexOf(a);assert.ok(i>=0,a);const j=source.indexOf(b,i);assert.ok(j>i,b);return source.slice(i,j);}
async function fixture(t,{gateway='depixpay',document='12345678901'}={}){
 const db=new sqlite3.Database(':memory:');t.after(()=>new Promise(resolve=>db.close(()=>resolve())));
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const messages=[],charges=[],purchases=[],sessions=new Map(),images=[];
 let starts=0;
 const ctx=vm.createContext({whatsappMenu:{copyPix:async()=>false,enabled:async()=>false},run,get,all,...protocol,...errors,heroProtocol,console,Number,String,Set,Date,JSON,Buffer,
  addColumnIfMissing:async()=>{},heroSmsVitrine:async()=>[{country:'73',service:'wa',cost:1,stock:100,nome:'WhatsApp'}],heroLifecycle:()=>({snapshot:async()=>{}}),heroValidCountry:require('../hero-sms-countries').heroValidCountry,heroPrecoCliente:async()=>25,
  gatewayPagamentoCliente:async()=>assert.fail('Hero must use the panel default, not the customer gateway'),gatewaysPagamentoAtivos:async()=>({lista:[gateway],padrao:gateway}),documentoPixCliente:async()=>String((await get('SELECT pix_documento FROM revendas WHERE id=1'))?.pix_documento||''),
  salvarSessaoPedido:async(jid,s)=>sessions.set(jid,s),apagarSessaoPedido:async jid=>sessions.delete(jid),
  enviarTexto:async(jid,text)=>{messages.push({jid,text});return true;},TEXTO_CPF_PAGAMENTO_V257:'Informe seu CPF',
  gerarPix:async(...args)=>{charges.push(args);return {paymentId:'pix-1',qrCode:'000201-PIX'};},
  verificarPagamento:()=>{starts++;},brl:v=>'R$ '+Number(v).toFixed(2),avisoTokenizacaoPix:()=>'',
  QRCode:{toBuffer:async()=>Buffer.from('image')},isTgJid:j=>String(j).startsWith('tg:'),tgIdFromJid:j=>String(j).slice(3),
  heroReportCheckoutError:e=>errors.checkoutMessage(e,'test'),onlyDigits:v=>String(v).replace(/\D/g,''),documentoPixValido:v=>/^\d{11}$/.test(v),
  heroSmsV1:async(method,path,payload)=>{assert.equal(method,'POST');assert.equal(path,'/activations');assert.equal(payload.amount,1);assert.equal(payload.country,73);assert.equal(payload.verificationType,'sms');purchases.push(true);return {data:[{id:123,phone:5511999999999}]};},
  heroWhatsMenuPedido:async(jid,id)=>messages.push({jid,text:'card #'+id}),
  depixDelayedElegivel:async()=>true,
  consultarStatus:async paymentId=>({success:true,data:{payment_id:paymentId,amount:25,status:'completed'}})
 });
 vm.runInContext(section('async function heroPedidosInit(){','async function heroCatalogInit(){'),ctx);
 await ctx.heroPedidosInit();
 await run('CREATE TABLE revendas(id INTEGER PRIMARY KEY,nome TEXT,saldo REAL,pix_documento TEXT,atualizado_em TEXT)');
 await run('INSERT INTO revendas(id,nome,saldo,pix_documento) VALUES(1,?,?,?)',['Cliente',50,document]);
 await run("CREATE TABLE pix_pedidos(payment_id TEXT PRIMARY KEY,revenda_id INTEGER,revenda_jid TEXT,cliente_jid TEXT,valor REAL,status TEXT,tipo_pagamento TEXT,contexto_json TEXT,gateway TEXT,criado_em TEXT DEFAULT CURRENT_TIMESTAMP)");
 vm.runInContext(section('async function heroHandlePixDocument(','function heroReportCheckoutError('),ctx);
 ctx.heroSendPixImage=async(jid,image)=>images.push({jid,image});
 vm.runInContext(section('const heroCheckoutInFlight = new Set();','// Cancellation is only refunded'),ctx);
 vm.runInContext(section('async function heroPixConfirmed(','// Reconciles operations made directly'),ctx);
 const buy=()=>ctx.heroCheckout('wa:5511',{id:1,nome:'Cliente'},{country:'73',service:'wa'},'pix');
 return {ctx,run,get,all,messages,charges,purchases,sessions,images,buy,starts:()=>starts};
}
test('DePix requests document before creating a charge or an order',async t=>{
 const f=await fixture(t,{document:''});assert.equal(await f.buy(),null);
 assert.equal(f.charges.length,0);assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_orders')).n,0);
 assert.equal(f.sessions.get('wa:5511').etapa,'hero_cpf_pix');assert.match(f.messages[0].text,/CPF/);
});
test('DePix passes the stored document and creates a linked pending payment without debiting balance',async t=>{
 const f=await fixture(t);assert.equal(await f.buy(),1);
 assert.equal(f.charges[0][1],'Cliente');assert.equal(f.charges[0][2],'12345678901');assert.equal(f.charges[0][3],'depixpay');assert.equal(f.charges[0][4].throwOnError,true);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'awaiting_payment');
 assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);assert.equal(f.purchases.length,0);assert.equal(f.starts(),1);assert.equal(f.images.length,1);
 assert.equal(JSON.parse((await f.get('SELECT contexto_json FROM pix_pedidos')).contexto_json).heroOrderId,1);
});
test('CPF reply validates input, saves it and resumes the Hero checkout instead of a generic service',async t=>{
 const f=await fixture(t,{document:''});await f.buy();const session=f.sessions.get('wa:5511');
 await f.ctx.heroHandlePixDocument('wa:5511',{id:1,nome:'Cliente'},session,'bad');assert.equal(f.charges.length,0);
 await f.ctx.heroHandlePixDocument('wa:5511',{id:1,nome:'Cliente'},session,'12345678901');
 assert.equal(f.charges.length,1);assert.equal(f.sessions.has('wa:5511'),false);assert.equal((await f.get('SELECT pix_documento FROM revendas')).pix_documento,'12345678901');
});
test('expired or canceled CPF collection never generates a charge',async t=>{
 const f=await fixture(t,{document:''});await f.buy();const session=f.sessions.get('wa:5511');
 await f.ctx.heroHandlePixDocument('wa:5511',{id:1},session,'0');assert.equal(f.charges.length,0);
 await f.ctx.heroHandlePixDocument('wa:5511',{id:1},{...session,requestedAt:Date.now()-11*60*1000},'12345678901');assert.equal(f.charges.length,0);
});
test('Mercado Pago does not require the DePix-specific CPF step',async t=>{
 const f=await fixture(t,{gateway:'mercadopago',document:''});await f.buy();assert.equal(f.charges.length,1);assert.equal(f.charges[0][3],'mercadopago');assert.equal(f.sessions.size,0);
});
test('a generation timeout is held for reconciliation and blocks a second charge',async t=>{
 const f=await fixture(t);let calls=0;f.ctx.gerarPix=async()=>{calls++;throw new Error('timeout');};
 await assert.rejects(f.buy(),e=>e.code==='PIX_CREATION_FAILED');
 assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'payment_reconciliation');
 await assert.rejects(f.buy(),e=>e.code==='ORDER_RECONCILIATION');assert.equal(calls,1);
});
test('an explicit HTTP rejection is recorded as failed without purchasing a number',async t=>{
 const f=await fixture(t);f.ctx.gerarPix=async()=>{const e=new Error('bad request');e.response={status:422};throw e;};
 await assert.rejects(f.buy());assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'payment_failed');assert.equal(f.purchases.length,0);
});
test('duplicate confirmations purchase exactly one activation and never credit or debit the wallet',async t=>{
 const f=await fixture(t);await f.buy();await Promise.all([f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1}),f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1})]);
 await f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1});
 assert.equal(f.purchases.length,1);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivered');assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
 assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_pix_receipts')).n,1);
});
test('wrong amount, missing amount, wrong id or wrong customer never authorizes delivery',async t=>{
 const f=await fixture(t);await f.buy();const context={tipoCompra:'HERO_SMS',heroOrderId:1};
 for(const data of [{payment_id:'pix-1',amount:1,status:'completed'},{payment_id:'pix-1',status:'completed'},{payment_id:'other',amount:25,status:'completed'}])await assert.rejects(f.ctx.heroPixConfirmed('pix-1',context,{success:true,data}));
 await f.run('UPDATE pix_pedidos SET revenda_id=999');await assert.rejects(f.ctx.heroPixConfirmed('pix-1',context));
 assert.equal(f.purchases.length,0);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'pending');
});
test('paid PIX with an uncertain provider purchase is delivery_pending and is never bought again',async t=>{
 const f=await fixture(t);await f.buy();let calls=0;f.ctx.heroSmsV1=async()=>{calls++;throw new Error('timeout');};
 assert.equal(await f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1}),false);
 assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivery_pending');
 await f.ctx.heroRecoverPix();assert.equal(calls,1);assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'uncertain');
});
test('persistent recovery finds a paid Pix after polling memory was lost',async t=>{
 const f=await fixture(t);await f.buy();assert.equal(f.purchases.length,0);
 await f.ctx.heroRecoverPix();assert.equal(f.purchases.length,1);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivered');
});
test('recovery resumes a confirmed payment left in paid before the activation claim',async t=>{
 const f=await fixture(t);await f.buy();await f.run("UPDATE hero_sms_orders SET status='paid'");await f.run("UPDATE pix_pedidos SET status='completed'");
 await f.ctx.heroRecoverPix();assert.equal(f.purchases.length,1);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivered');
});
test('recovery on Mercado Pago is independent of the DePix-only worker',async t=>{
 const f=await fixture(t,{gateway:'mercadopago'});await f.buy();await f.ctx.heroRecoverPix();assert.equal(f.purchases.length,1);
});
test('expired charge is not purchased, but later authenticated payment can still be delivered',async t=>{
 const f=await fixture(t);await f.buy();f.ctx.consultarStatus=async id=>({success:true,data:{payment_id:id,amount:25,status:'expired'}});
 await f.ctx.heroRecoverPix();assert.equal(f.purchases.length,0);assert.equal((await f.get('SELECT status FROM hero_sms_orders')).status,'payment_expired');
 f.ctx.consultarStatus=async id=>({success:true,data:{payment_id:id,amount:25,status:'completed'}});await f.ctx.heroRecoverPix();assert.equal(f.purchases.length,1);
});
test('delayed is accepted only under the existing DePix eligibility rule',async t=>{
 const f=await fixture(t);await f.buy();f.ctx.depixDelayedElegivel=async()=>false;
 const verified={success:true,data:{payment_id:'pix-1',amount:25,status:'delayed'}};
 await assert.rejects(f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1},verified));assert.equal(f.purchases.length,0);
 f.ctx.depixDelayedElegivel=async()=>true;await f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1},verified);assert.equal(f.purchases.length,1);
});

test('the real generic polling entrypoint routes Hero Pix without wallet credit or false delivery',async t=>{
 const f=await fixture(t);const immediate=[];
 f.ctx.setInterval=()=>123;f.ctx.clearInterval=()=>{};f.ctx.setTimeout=fn=>immediate.push(fn);
 vm.runInContext(section('const pagamentosEmVerificacao = new Set();','async function finalizarPedido('),f.ctx);
 await f.buy();assert.equal(immediate.length,1);await immediate[0]();
 assert.equal(f.purchases.length,1);assert.equal((await f.get('SELECT saldo FROM revendas')).saldo,50);
 assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivered');
});

test('Mercado Pago status adapter preserves authenticated payment id and gross amount',async()=>{
 const ctx=vm.createContext({String,clienteMercadoPago:()=>({get:async()=>({data:{id:123,transaction_amount:25,status:'approved'}})}),obterTokenMercadoPago:()=> 'test'});
 vm.runInContext(section('async function consultarStatus(','async function escolherGatewayParaSessao('),ctx);
 const result=await ctx.consultarStatus('123','mercadopago');assert.equal(result.data.payment_id,'123');assert.equal(result.data.amount,25);assert.equal(result.data.status,'completed');
});
test('MisticPay status adapter retains identity and amount, and missing identity never authorizes Hero delivery',async()=>{
 const transaction={transactionId:'mist-1',amount:25,transactionState:'COMPLETO'};
 const ctx=vm.createContext({String,clienteMisticPay:async()=>({api:{post:async()=>({data:{transaction}})}})});
 vm.runInContext(section('async function consultarStatus(','async function escolherGatewayParaSessao('),ctx);
 const result=await ctx.consultarStatus('mist-1','misticpay');assert.equal(result.data.payment_id,'mist-1');assert.equal(result.data.amount,25);
 const payment={payment_id:'mist-1',revenda_id:1,valor:25,gateway:'misticpay'},order={payment_id:'mist-1',customer_id:1,payment_method:'pix',price_brl:25};
 assert.equal(protocol.validateHeroPix(payment,order,result),true);delete transaction.transactionId;
 assert.equal(protocol.validateHeroPix(payment,order,await ctx.consultarStatus('mist-1','misticpay')),false);
});

test('Hero Pix uses the active panel default even when the customer profile specifies another gateway',async t=>{
 const f=await fixture(t,{gateway:'mercadopago'});
 f.ctx.gatewayPagamentoCliente=async()=>({gateway:'depixpay'});
 f.ctx.gatewaysPagamentoAtivos=async()=>({lista:['depixpay','mercadopago'],padrao:'mercadopago'});
 await f.buy();assert.equal(f.charges[0][3],'mercadopago');
});
test('an inactive panel default blocks Pix without choosing another active gateway',async t=>{
 const f=await fixture(t);
 f.ctx.gatewaysPagamentoAtivos=async()=>({lista:['mercadopago'],padrao:'depixpay'});
 await assert.rejects(f.buy(),e=>e.code==='PIX_UNAVAILABLE');
 assert.equal(f.charges.length,0);assert.equal((await f.get('SELECT COUNT(*) n FROM hero_sms_orders')).n,0);
});

test('an incomplete provider purchase preserves its activation id for later external reconciliation',async t=>{
  const f=await fixture(t);await f.buy();f.ctx.heroSmsV1=async()=>({data:[{id:123}]});
  await f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1});
  const order=await f.get('SELECT activation_id,status,phone FROM hero_sms_orders');
  assert.equal(order.activation_id,'123');assert.equal(order.status,'uncertain');assert.equal(order.phone,null);
});

test('MisticPay documented check response reads transaction.value in BRL without subtracting fees',async()=>{
 const ctx=vm.createContext({String,clienteMisticPay:async()=>({api:{post:async()=>({data:{message:'Transação encontrada com sucesso!',transaction:{transactionId:'central-test',value:25,fee:0.31,transactionState:'COMPLETO',transactionType:'DEPOSITO',transactionMethod:'PIX'}}})}})});
 vm.runInContext(section('async function consultarStatus(','async function escolherGatewayParaSessao('),ctx);
 const result=await ctx.consultarStatus('central-test','misticpay');
 assert.equal(result.data.amount,25);assert.equal(result.data.payment_id,'central-test');assert.equal(result.data.status,'completed');
 const payment={payment_id:'central-test',revenda_id:1,valor:25,gateway:'misticpay'},order={payment_id:'central-test',customer_id:1,payment_method:'pix',price_brl:25};
 assert.equal(protocol.validateHeroPix(payment,order,result),true);
});
test('Pix diagnostics distinguish missing amount from wrong identity without exposing payer details',()=>{
 const payment={payment_id:'pix',revenda_id:1,valor:25,gateway:'misticpay'},order={payment_id:'pix',customer_id:1,payment_method:'pix',price_brl:25};
 const missing=protocol.heroPixValidation(payment,order,{success:true,data:{payment_id:'pix',status:'completed'}});
 assert.equal(missing.reason,'PROVIDER_AMOUNT_MISSING');assert.equal(missing.expected_amount_cents,2500);assert.equal(missing.provider_amount_cents,null);
 const mismatch=protocol.heroPixValidation(payment,order,{success:true,data:{payment_id:'other',amount:25,status:'completed',payerDocument:'private',api_key:'private'}});
 assert.equal(mismatch.reason,'PROVIDER_PAYMENT_ID_MISMATCH');assert.ok(!JSON.stringify(mismatch).includes('private'));
});
test('a paid MisticPay Pix using the documented value field is recovered without a new charge',async t=>{
 const f=await fixture(t,{gateway:'misticpay'});await f.buy();
 f.ctx.clienteMisticPay=async()=>({api:{post:async()=>({data:{transaction:{transactionId:'pix-1',value:25,fee:0.31,transactionState:'COMPLETO'}}})}});
 vm.runInContext(section('async function consultarStatus(','async function escolherGatewayParaSessao('),f.ctx);
 await f.ctx.heroRecoverPix();await f.ctx.heroRecoverPix();
 assert.equal(f.charges.length,1);assert.equal(f.purchases.length,1);assert.equal((await f.get('SELECT status FROM pix_pedidos')).status,'delivered');
});
test('a real value mismatch remains blocked and saves a specific diagnostic',async t=>{
 const f=await fixture(t,{gateway:'misticpay'});await f.buy();
 await assert.rejects(f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1},{success:true,data:{payment_id:'pix-1',amount:24,status:'completed'}}),e=>e.code==='PROVIDER_AMOUNT_MISMATCH');
 const row=await f.get('SELECT last_error,status FROM hero_sms_orders');assert.match(row.last_error,/PROVIDER_AMOUNT_MISMATCH/);assert.equal(row.status,'awaiting_payment');assert.equal(f.purchases.length,0);
});

test('closed test is excluded from Pix recovery and does not block a new purchase',async t=>{
 const f=await fixture(t);await f.buy();await f.run("UPDATE hero_sms_orders SET status='uncertain',last_error='Request failed with status code 404'");
 vm.runInContext(section('async function heroCloseTestOrder(','async function heroReconcileExternalCancellation('),f.ctx);
 await f.ctx.heroCloseTestOrder(1);await f.ctx.heroRecoverPix();
 assert.equal(f.purchases.length,0);assert.equal(await f.ctx.heroPixConfirmed('pix-1',{tipoCompra:'HERO_SMS',heroOrderId:1}),false);
 f.ctx.gerarPix=async()=>({paymentId:'pix-2',qrCode:'000201-PIX2'});assert.equal(await f.buy(),2);
 assert.equal((await f.get('SELECT status FROM hero_sms_orders WHERE id=1')).status,'test_closed');
});
