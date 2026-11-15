'use strict';
const sqlite3=require('sqlite3');const crypto=require('node:crypto');
const {isoTime}=require('./hero-sms-lifecycle');
function sharedError(code,message,definitive=false,status=409){const error=new Error(message);Object.assign(error,{code,definitive,status});return error;}
async function transaction(filename,fn){
 const db=new sqlite3.Database(filename);db.configure('busyTimeout',10000);
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,row)=>e?reject(e):resolve(row)));
 try{await run('BEGIN IMMEDIATE');const result=await fn({run,get});await run('COMMIT');return result;}
 catch(e){await run('ROLLBACK').catch(()=>{});throw e;}
 finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
function createSharedHeroService({filename,run,get,all,ensureOrders,catalog,purchase,cancel,replace,finish,now=()=>Date.now()}){
 let ready=null;
 async function init(){
  if(!ready)ready=(async()=>{
   await ensureOrders();
   await run(`CREATE TABLE IF NOT EXISTS hero_sms_shared_orders(order_id INTEGER PRIMARY KEY,source TEXT NOT NULL,external_id TEXT NOT NULL,customer_id TEXT NOT NULL,country TEXT NOT NULL,sale_price_brl REAL NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(source,external_id))`);
   await run(`CREATE TABLE IF NOT EXISTS hero_sms_shared_rejections(source TEXT NOT NULL,external_id TEXT NOT NULL,customer_id TEXT NOT NULL,country TEXT NOT NULL,sale_price_brl REAL NOT NULL,error TEXT NOT NULL,PRIMARY KEY(source,external_id))`);
   await run(`CREATE TABLE IF NOT EXISTS hero_sms_shared_actions(order_id INTEGER NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',message TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(order_id,request_id))`);
   await run(`CREATE TABLE IF NOT EXISTS hero_sms_shared_refunds(order_id INTEGER PRIMARY KEY,reference TEXT NOT NULL UNIQUE,amount_brl REAL NOT NULL,state TEXT NOT NULL DEFAULT 'confirmed',confirmed_at TEXT DEFAULT CURRENT_TIMESTAMP,acknowledged_at TEXT)`);
  })().catch(e=>{ready=null;throw e;});return ready;
 }
 function identity(input){
  const source=String(input.source||'').trim(),customer=String(input.customer_id||''),external=String(input.external_order_id||'');
  if(!source||source.length>80||!/^[1-9]\d{0,24}$/.test(customer)||!/^[a-zA-Z0-9_.-]{1,120}$/.test(external))throw sharedError('INVALID_IDENTITY','Identificação do pedido inválida.',true,400);
  return {source,customer,external};
 }
 async function lookup(input){
  await init();const id=identity(input);
  const row=await get('SELECT o.*,s.source,s.external_id,s.customer_id AS partner_customer_id,s.sale_price_brl FROM hero_sms_shared_orders s JOIN hero_sms_orders o ON o.id=s.order_id WHERE s.source=? AND s.external_id=? AND s.customer_id=?',[id.source,id.external,id.customer]);
  if(!row)throw sharedError('ORDER_NOT_FOUND','Pedido não encontrado.',false,404);return row;
 }
 async function serialize(o){
  const messages=await all('SELECT id,code,text,received_at FROM hero_sms_sms_events WHERE order_id=? AND activation_id=? ORDER BY received_at,id',[o.id,String(o.activation_id)]);
  const refund=await get('SELECT reference,amount_brl,state FROM hero_sms_shared_refunds WHERE order_id=?',[o.id]);
  const received=Boolean(o.sms_received||o.sms_code||messages.length);
  const expiry=isoTime(o.expires_at),started=Date.parse(isoTime(o.number_received_at||o.created_at)||'');
  const wait=Number.isFinite(started)?Math.max(0,Math.ceil((started+120000-now())/1000)):120;
  const expired=expiry&&Date.parse(expiry)<=now();
  return {external_order_id:o.external_id,central_order_id:o.id,country:String(o.country),phone:o.phone||null,status:o.status,expires_at:expiry,wait_seconds:wait,has_sms:received,
   messages:messages.length?messages.map((m,i)=>({...m,sequence:i+1})):(o.sms_code?[{id:'legacy',sequence:1,code:o.sms_code,text:null,received_at:null}]:[]),
   actions:{replace:o.status==='number_received'&&!received&&!expired&&wait===0,cancel:o.status==='number_received'&&!received&&!expired&&wait===0,finish:['number_received','sms_received'].includes(o.status)&&received&&!expired,buy_another:o.status==='finished'},
   refund:refund||{state:o.status==='canceled'?'awaiting_confirmation':'none'},sale_price_brl:o.sale_price_brl};
 }
 async function read(input){return serialize(await lookup(input));}
 async function create(input){
  await init();const id=identity(input),country=String(input.country??''),price=Number(input.sale_price_brl);
  if(!/^\d{1,3}$/.test(country)||!Number.isFinite(price)||price<=0||price>1000000)throw sharedError('INVALID_OFFER','País ou preço inválido.',true,400);
  let existing=await get('SELECT * FROM hero_sms_shared_orders WHERE source=? AND external_id=?',[id.source,id.external]);
  if(existing){
   if(existing.customer_id!==id.customer||existing.country!==country||Math.abs(existing.sale_price_brl-price)>.001)throw sharedError('IDEMPOTENCY_CONFLICT','Identificação já usada por outro pedido; conferir.',false);
   await purchase(existing.order_id);return read(input);
  }
  const offer=(await catalog()).find(o=>String(o.country)===country&&String(o.service).toLowerCase()==='wa'&&Number(o.stock)>0);
  const orderId=await transaction(filename,async({run,get})=>{
   const rejected=await get('SELECT * FROM hero_sms_shared_rejections WHERE source=? AND external_id=?',[id.source,id.external]);
   if(rejected){if(rejected.customer_id!==id.customer||rejected.country!==country||Math.abs(rejected.sale_price_brl-price)>.001)throw sharedError('IDEMPOTENCY_CONFLICT','Identificação divergente.',false);return {rejected:rejected.error};}
   existing=await get('SELECT * FROM hero_sms_shared_orders WHERE source=? AND external_id=?',[id.source,id.external]);
   if(existing){if(existing.customer_id!==id.customer||existing.country!==country||Math.abs(existing.sale_price_brl-price)>.001)throw sharedError('IDEMPOTENCY_CONFLICT','Conferir identificação do pedido.',false);return existing.order_id;}
   if(!offer){
    await run("INSERT INTO hero_sms_shared_rejections(source,external_id,customer_id,country,sale_price_brl,error) VALUES(?,?,?,?,?,'OUT_OF_STOCK')",[id.source,id.external,id.customer,country,price]);
    return {rejected:'OUT_OF_STOCK'};
   }
   const row=await run("INSERT INTO hero_sms_orders(customer_id,customer_jid,service,country,price_brl,cost_at_quote,payment_method,status) VALUES(0,?,'wa',?,?,?,'external','paid')",['shared-hero:'+crypto.randomUUID(),country,price,Number(offer.cost)]);
   await run('INSERT INTO hero_sms_shared_orders(order_id,source,external_id,customer_id,country,sale_price_brl) VALUES(?,?,?,?,?,?)',[row.lastID,id.source,id.external,id.customer,country,price]);return row.lastID;
  });
  if(orderId?.rejected)throw sharedError(orderId.rejected,'País indisponível; este pedido não foi comprado.',true);
  await purchase(orderId);return read(input);
 }
 async function action(input){
  const o=await lookup(input),operation=String(input.action||''),request=String(input.request_id||'');
  if(!['replace','cancel','finish'].includes(operation)||!/^[a-zA-Z0-9_.-]{8,120}$/.test(request))throw sharedError('INVALID_ACTION','Ação inválida.',true,400);
  const existing=await get('SELECT * FROM hero_sms_shared_actions WHERE order_id=? AND request_id=?',[o.id,request]);
  if(existing){if(existing.action!==operation)throw sharedError('IDEMPOTENCY_CONFLICT','Identificação da ação divergente.',false);return {...await read(input),action_state:existing.state,action_message:existing.message};}
  const claim=await run('INSERT OR IGNORE INTO hero_sms_shared_actions(order_id,request_id,action) VALUES(?,?,?)',[o.id,request,operation]);
  if(!claim.changes)return {...await read(input),action_state:'pending'};
  try{
   const result=await ({replace,cancel,finish}[operation])(o.customer_jid,o.id);
   await run("UPDATE hero_sms_shared_actions SET state='completed',message=? WHERE order_id=? AND request_id=?",[typeof result==='string'?result.slice(0,500):null,o.id,request]);
  }catch(e){await run("UPDATE hero_sms_shared_actions SET state='review',message=? WHERE order_id=? AND request_id=?",['Operação não confirmada; confira o estado atualizado antes de tentar novamente.',o.id,request]);}
  const saved=await get('SELECT state,message FROM hero_sms_shared_actions WHERE order_id=? AND request_id=?',[o.id,request]);
  return {...await read(input),action_state:saved.state,action_message:saved.message};
 }
 async function confirmRefund(orderId,requireReceipt){
  await init();return transaction(filename,async({run,get})=>{
   const o=await get('SELECT o.*,s.sale_price_brl FROM hero_sms_orders o JOIN hero_sms_shared_orders s ON s.order_id=o.id WHERE o.id=?',[orderId]);
   if(!o||o.payment_method!=='external'||o.sms_received||o.sms_code)throw sharedError('REFUND_REVIEW','Reembolso externo exige conferência.',false);
   const old=await get('SELECT * FROM hero_sms_shared_refunds WHERE order_id=?',[orderId]);if(old)return {credited:true,alreadyCredited:true,external:true,amount:old.amount_brl};
   const proof=await get(requireReceipt?'SELECT activation_id FROM hero_sms_cancel_receipts WHERE order_id=?':'SELECT activation_id FROM hero_sms_refund_receipts WHERE order_id=? AND provider_status=10',[orderId]);
   if(!proof||String(proof.activation_id)!==String(o.activation_id))throw sharedError('REFUND_UNCONFIRMED','Reembolso não confirmado para essa ativação.',false);
   await run('INSERT INTO hero_sms_shared_refunds(order_id,reference,amount_brl) VALUES(?,?,?)',[orderId,'HERO-SHARED-REFUND-'+orderId,o.sale_price_brl]);
   await run("UPDATE hero_sms_orders SET status='canceled',refund_status='external_pending',last_error=NULL WHERE id=?",[orderId]);
   return {credited:true,alreadyCredited:false,external:true,amount:o.sale_price_brl};
  });
 }
 async function acknowledge(input){
  const o=await lookup(input);const ref=String(input.reference||'');
  await transaction(filename,async({run,get})=>{
   const refund=await get('SELECT * FROM hero_sms_shared_refunds WHERE order_id=?',[o.id]);
   if(!refund||refund.reference!==ref)throw sharedError('REFUND_UNCONFIRMED','Comprovante de devolução inválido.',false);
   await run("UPDATE hero_sms_shared_refunds SET state='acknowledged',acknowledged_at=COALESCE(acknowledged_at,CURRENT_TIMESTAMP) WHERE order_id=?",[o.id]);
   await run("UPDATE hero_sms_orders SET refund_status='credited_external' WHERE id=? AND payment_method='external'",[o.id]);
  });return read(input);
 }
 async function recover(){await init();for(const o of await all("SELECT o.id FROM hero_sms_orders o JOIN hero_sms_shared_orders s ON s.order_id=o.id WHERE o.status='paid' AND o.payment_method='external' LIMIT 50"))await purchase(o.id);}
 return {init,read,create,action,confirmRefund,acknowledge,recover};
}
function mountSharedHeroRoutes(app,{service,authorized,catalog}){
 const handler=fn=>async(req,res)=>{
  try{
   if(!await authorized(req))return res.status(401).json({ok:false,error:'UNAUTHORIZED',definitive:false});
   const value=await fn(req);res.json({ok:true,...value});}
  catch(e){res.status(e.status||503).json({ok:false,error:e.code||'TEMPORARY',definitive:e.definitive===true});}
 };
 const identity=req=>({...req.query,...req.body,external_order_id:req.params.externalId||req.body?.external_order_id});
 app.get('/api/shared-herosms/health',handler(async()=>({service:'shared-herosms',version:1})));
 app.get('/api/shared-herosms/catalog',handler(async()=>({countries:(await catalog()).filter(r=>r.service.toLowerCase()==='wa').map(r=>({country:String(r.country),name:r.pais,stock:Number(r.stock),default_price_brl:25}))})));
 app.post('/api/shared-herosms/orders',handler(async req=>({order:await service.create(identity(req))})));
 app.get('/api/shared-herosms/orders/:externalId',handler(async req=>({order:await service.read(identity(req))})));
 app.post('/api/shared-herosms/orders/:externalId/actions',handler(async req=>({order:await service.action(identity(req))})));
 app.post('/api/shared-herosms/orders/:externalId/refund-ack',handler(async req=>({order:await service.acknowledge(identity(req))})));
}
module.exports={createSharedHeroService,mountSharedHeroRoutes};
