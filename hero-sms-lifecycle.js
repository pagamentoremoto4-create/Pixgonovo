'use strict';
const crypto=require('node:crypto');
function isoTime(value){if(!value)return null;let s=String(value).replace(' ','T');if(!/(?:Z|[+-]\d\d:\d\d)$/.test(s))s+='Z';const n=Date.parse(s);return Number.isFinite(n)?new Date(n).toISOString():null;}
function createHeroLifecycle({run,get,all,api,compat,credit,notify=async()=>{},now=()=>Date.now()}){
 const busy=new Set();let syncing=false,polling=false;
 async function sms(order,entry){
  if(entry.type&&entry.type!=='sms')return false;
  const current=await get('SELECT status,refund_status,activation_id FROM hero_sms_orders WHERE id=?',[order.id]);
  if(!current||current.status==='test_closed'||['credited','external_pending','credited_external','not_charged'].includes(current.refund_status)||String(current.activation_id)!==String(order.activation_id))return false;
  const code=entry.smsCode??entry.code??null,text=entry.smsText??entry.text??null;
  if(!String(code??'').trim()&&!String(text??'').trim())return false;
  const activation=String(order.activation_id),realId=entry.id!=null?String(entry.id):null;
  const eventKey=realId?'id:'+realId:'fallback:'+crypto.createHash('sha256').update(String(code||'')+'|'+String(code?'':text||'')).digest('hex');
  let added=false;
  const existing=await get('SELECT id FROM hero_sms_sms_events WHERE order_id=? AND activation_id=? AND event_key=?',[order.id,activation,eventKey]);
  if(!existing){
   const fallback=await get("SELECT id,event_key FROM hero_sms_sms_events WHERE order_id=? AND activation_id=? AND ((code IS NOT NULL AND code=?) OR (code IS NULL AND text=?)) ORDER BY id LIMIT 1",[order.id,activation,code==null?null:String(code),String(text||'')]);
   if(fallback&&(!realId||fallback.event_key.startsWith('fallback:'))){
    if(realId)await run('UPDATE OR IGNORE hero_sms_sms_events SET event_key=?,received_at=COALESCE(?,received_at),text=COALESCE(?,text) WHERE id=?',[eventKey,isoTime(entry.receivedAt||entry.date),text,fallback.id]);
   }else {added=true;await run('INSERT OR IGNORE INTO hero_sms_sms_events(order_id,activation_id,event_key,code,text,received_at) VALUES(?,?,?,?,?,?)',[order.id,activation,eventKey,code==null?null:String(code),text==null?null:String(text),isoTime(entry.receivedAt||entry.date)||new Date(now()).toISOString()]);}
  }
  if(added)await run('UPDATE hero_sms_orders SET display_sms_page=-1 WHERE id=?',[order.id]);
  await run("UPDATE hero_sms_orders SET sms_received=1,sms_code=COALESCE(sms_code,?),status=CASE WHEN status IN ('number_received','replace_pending','replace_uncertain','cancel_pending','uncertain','purchasing') THEN 'sms_received' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND activation_id=? AND refund_status!='credited'",[code==null?null:String(code),order.id,activation]);
  await notify(order.id);
  return true;
 }
 async function snapshot(order,row){
  if(String(row.id)!==String(order.activation_id))throw new Error('Ativação divergente na resposta Hero.');
  const expiry=isoTime(row.expiredAt),created=isoTime(row.createdAt);
  await run('UPDATE hero_sms_orders SET expires_at=COALESCE(?,expires_at),provider_created_at=COALESCE(?,provider_created_at),provider_cost=COALESCE(?,provider_cost),provider_currency=COALESCE(?,provider_currency),provider_status=COALESCE(?,provider_status),sms_received=CASE WHEN ?>0 THEN 1 ELSE sms_received END WHERE id=? AND activation_id=?',[expiry,created,Number.isFinite(Number(row.price))&&row.price!=null?Number(row.price):null,row.currency??null,row.status??null,Number(row.otpTotalCount||0),order.id,String(row.id)]);
  if(row.phone&&/^[+]?\d{6,20}$/.test(String(row.phone)))await run("UPDATE hero_sms_orders SET phone=?,status=CASE WHEN sms_received=1 THEN 'sms_received' ELSE 'number_received' END,last_error=NULL WHERE id=? AND activation_id=? AND status IN ('number_received','sms_received','replace_pending','replace_uncertain','uncertain','purchasing')",[String(row.phone),order.id,String(row.id)]);
  for(const item of row.otpList||[])await sms(order,item);
  if(row.otpLast)await sms(order,row.otpLast);
 }
 async function otp(order){
  let page=1;
  while(page<=100){
   const response=await api('GET','/activations/'+encodeURIComponent(order.activation_id)+'/otp?'+new URLSearchParams({page:String(page),size:'25','sort[id]':'asc',verificationType:'sms'}));
   if(!Array.isArray(response?.data))throw new Error('Lista de SMS incompleta; operação adiada.');
   for(const item of response.data)await sms(order,item);
   const more=typeof response.meta?.hasMore==='boolean'?response.meta.hasMore:response.meta?.total!=null?page*25<Number(response.meta.total):response.data.length===25;
   if(!more)return;
   page++;
  }
  throw new Error('Histórico de SMS parcial; operação adiada.');
 }
 async function markCanceled(id,activation){const saved=await run("UPDATE hero_sms_orders SET status='canceled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND activation_id=? AND status!='test_closed'",[id,String(activation)]);if(saved.changes)await notify(id);}
 async function preflight(order){
  await otp(order);
  const status=String(await compat('getStatus',{id:order.activation_id})).replace(/^"|"$/g,'').trim();
  if(status.startsWith('STATUS_OK:'))await sms(order,{code:status.slice(10),type:'sms'});
  const fresh=await get('SELECT * FROM hero_sms_orders WHERE id=?',[order.id]);
  if(!fresh||String(fresh.activation_id)!==String(order.activation_id))throw new Error('Ativação alterada durante a consulta; conferir novamente.');
  if(status==='STATUS_CANCEL'){await markCanceled(order.id,order.activation_id);return {...fresh,providerCanceled:true};}
  if(!status.startsWith('STATUS_WAIT_')&&!status.startsWith('STATUS_OK:'))throw new Error('Estado da Hero em verificação; tente novamente após a conferência.');
  return fresh;
 }
 async function finish(jid,id){
  if(busy.has(Number(id)))throw new Error('Operação em andamento.');busy.add(Number(id));
  try{
   let o=await get('SELECT * FROM hero_sms_orders WHERE id=? AND customer_jid=?',[Number(id),jid]);
   if(!o)throw new Error('Pedido não encontrado.');
   if(o.status==='finished')return;
   if(!['number_received','sms_received'].includes(o.status)||!o.activation_id)throw new Error('Finalização indisponível ou em verificação.');
   o=await preflight(o);
   if(o.providerCanceled)throw new Error('Ativação já cancelada na Hero.');
   if(!o.sms_received&&!o.sms_code)throw new Error('Sem SMS recebido: utilize cancelamento, quando permitido.');
   const lock=await run("UPDATE hero_sms_orders SET status='finish_pending',last_error=NULL WHERE id=? AND status IN ('number_received','sms_received')",[o.id]);if(!lock.changes)return;
   try{await api('POST','/activations/'+encodeURIComponent(o.activation_id)+'/finish');await run("UPDATE hero_sms_orders SET status='finished',provider_status=6,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='finish_pending'",[o.id]);}
   catch(e){await run("UPDATE hero_sms_orders SET last_error=? WHERE id=?",['Finalização em verificação: '+String(e.message).slice(0,220),o.id]);throw e;}
   await notify(o.id);
  }finally{busy.delete(Number(id));}
 }
 async function settleRefund(order){
  const fresh=await get('SELECT * FROM hero_sms_orders WHERE id=?',[order.id]);
  if(!fresh||String(fresh.activation_id)!==String(order.activation_id)||fresh.status==='test_closed'||['credited','not_charged'].includes(fresh.refund_status))return;
  if(fresh.sms_received||fresh.sms_code){await run('UPDATE hero_sms_orders SET last_error=? WHERE id=?',['Reembolso com SMS recebido exige conferência administrativa.',order.id]);return;}
  await run('INSERT OR IGNORE INTO hero_sms_refund_receipts(order_id,activation_id,provider_status) VALUES(?,?,10)',[fresh.id,String(fresh.activation_id)]);
  await markCanceled(fresh.id,fresh.activation_id);
  try{await credit(fresh,false);await notify(order.id);}catch(e){await run('UPDATE hero_sms_orders SET last_error=? WHERE id=?',['Reembolso confirmado; crédito pendente: '+String(e.message).slice(0,180),fresh.id]);}
 }
 async function sync(){
  if(syncing)return;syncing=true;
  try{
   const orders=await all("SELECT * FROM hero_sms_orders WHERE activation_id IS NOT NULL AND status!='test_closed' AND (status IN ('number_received','sms_received','replace_pending','replace_uncertain','cancel_pending','finish_pending','uncertain','purchasing') OR (status='canceled' AND refund_status NOT IN ('credited','external_pending','credited_external','not_charged'))) ORDER BY COALESCE(last_reconciled_at,''),id LIMIT 50");
   if(!orders.length)return;
   const map=new Map(orders.map(o=>[String(o.activation_id),o]));
   for(const o of orders)await run('UPDATE hero_sms_orders SET last_reconciled_at=? WHERE id=?',[new Date(now()).toISOString(),o.id]);
   try{for(let page=1;page<=100;page++){
    const r=await api('GET','/activations?'+new URLSearchParams({page:String(page),size:'25'}));if(!Array.isArray(r?.data))throw new Error('Lista ativa inválida.');
    for(const row of r.data){const o=map.get(String(row.id));if(o){await snapshot(o,row);await otp(o);
      const fresh=await get('SELECT * FROM hero_sms_orders WHERE id=?',[o.id]);
      if(fresh.status==='cancel_pending'&&fresh.last_error&&!fresh.sms_received&&!fresh.sms_code){
       const receipt=await get('SELECT order_id FROM hero_sms_cancel_receipts WHERE order_id=?',[o.id]);
       if(!receipt)await run("UPDATE hero_sms_orders SET status='number_received' WHERE id=? AND status='cancel_pending' AND sms_received=0 AND sms_code IS NULL",[o.id]);
      }
      if(fresh.status==='finish_pending'&&fresh.last_error&&!busy.has(Number(o.id))){
       await run("UPDATE hero_sms_orders SET status='sms_received' WHERE id=? AND status='finish_pending'",[o.id]);
       try{await finish(fresh.customer_jid,fresh.id);}catch(e){await run('UPDATE hero_sms_orders SET last_error=? WHERE id=?',[String(e.message).slice(0,250),o.id]);}
      }
     }}
    if(r.meta?.hasMore===false||(!r.meta?.hasMore&&r.data.length<25))break;
   }}catch(e){for(const o of orders)await run('UPDATE hero_sms_orders SET last_error=? WHERE id=?',[String(e.message).slice(0,250),o.id]);}
   const dates=orders.map(o=>Date.parse(isoTime(o.created_at)||'')).filter(Number.isFinite);
   const from=new Date((dates.length?Math.min(...dates):now())-86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
   const to=new Date(now()).toISOString().replace(/\.\d{3}Z$/,'Z');let found=new Set();
   for(let page=1;page<=100;page++){
    const r=await api('GET','/activations/history?'+new URLSearchParams({from,to,page:String(page),size:'25'}));if(!Array.isArray(r?.data))throw new Error('Histórico Hero inválido.');
    for(const row of r.data){const o=map.get(String(row.id));if(!o)continue;found.add(String(row.id));
     if(row.moreCodes)await sms(o,{text:row.moreCodes,code:(String(row.moreCodes).match(/(?:^|\D)(\d{4,8})(?!\d)/)||[])[1]||null,type:'sms'});
     await run('UPDATE hero_sms_orders SET provider_status=? WHERE id=? AND activation_id=?',[row.status,o.id,String(row.id)]);
     if(Number(row.status)===10)await settleRefund(o);
     else if(Number(row.status)===8)await markCanceled(o.id,o.activation_id);
     else if(Number(row.status)===6){await run("UPDATE hero_sms_orders SET status='finished',last_error=NULL WHERE id=? AND activation_id=? AND status NOT IN ('canceled','test_closed')",[o.id,String(row.id)]);await notify(o.id);}
    }
    if(r.meta?.hasMore===false||(!r.meta?.hasMore&&r.data.length<25)||found.size===map.size)break;
   }
  }finally{syncing=false;}
 }
 async function poll(){
  if(polling)return;polling=true;
  try{
   const orders=await all("SELECT * FROM hero_sms_orders WHERE activation_id IS NOT NULL AND status IN ('number_received','sms_received','cancel_pending','uncertain','finish_pending') AND NOT EXISTS(SELECT 1 FROM hero_sms_cancel_receipts c WHERE c.order_id=hero_sms_orders.id AND c.activation_id=hero_sms_orders.activation_id) ORDER BY COALESCE(last_polled_at,''),id LIMIT 100");
   for(const o of orders){
    await run('UPDATE hero_sms_orders SET last_polled_at=? WHERE id=?',[new Date(now()).toISOString(),o.id]);
    try{
     const fresh=await preflight(o);
     if(!fresh.providerCanceled&&fresh.expires_at&&Date.parse(fresh.expires_at)<=now()&&['number_received','sms_received'].includes(fresh.status)){
      if(fresh.refund_status==='credited')continue;
      if(fresh.sms_received||fresh.sms_code)await finish(fresh.customer_jid,fresh.id);
      else {
       const lock=await run("UPDATE hero_sms_orders SET status='cancel_pending' WHERE id=? AND status='number_received' AND sms_received=0 AND sms_code IS NULL",[fresh.id]);
       if(lock.changes){
        const result=String(await compat('setStatus',{id:fresh.activation_id,status:8})).replace(/^"|"$/g,'').trim();
        if(result==='ACCESS_CANCEL'){
         await run('INSERT OR IGNORE INTO hero_sms_cancel_receipts(order_id,activation_id) VALUES(?,?)',[fresh.id,String(fresh.activation_id)]);
         await credit(fresh,true);await notify(fresh.id);
        }else if(/EARLY_CANCEL_DENIED|OTP_RECEIVED|NEW_OTP_RECEIVED|FREE_CANCELLATION_EXPIRED|BAD_STATUS/.test(result))await run("UPDATE hero_sms_orders SET status='number_received',last_error=? WHERE id=? AND status='cancel_pending'",['Cancelamento recusado: '+result.slice(0,180),fresh.id]);
        else throw new Error('Encerramento em verificação: '+result.slice(0,120));
       }
      }
     }
    }catch(e){await run('UPDATE hero_sms_orders SET last_error=? WHERE id=?',[String(e.message).slice(0,250),o.id]);}
   }
  }finally{polling=false;}
 }
 return {sms,snapshot,otp,preflight,finish,sync,poll};
}
module.exports={createHeroLifecycle,isoTime};

// A webhook is only a signal. SMS data is fetched again from the authenticated
// provider endpoint; incoming payload never authorizes wallet or status changes.
function createHeroWebhook({secret,findOrder,lifecycle,update}){
 return async function(req,res){
  const expected=String(secret()||''),supplied=String(req.params?.token||'');
  if(expected.length<32||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return res.sendStatus(404);
  const body=req.body;
  if(!body||JSON.stringify(body).length>16000||!/^\d{1,30}$/.test(String(body.activationId||'')))return res.sendStatus(400);
  try{
   const order=await findOrder(String(body.activationId));
   if(!order||order.status==='test_closed'||order.refund_status==='credited')return res.sendStatus(200);
   if(body.country!=null&&String(body.country)!==String(order.country)||body.service!=null&&String(body.service)!==String(order.service))return res.sendStatus(400);
   await lifecycle().otp(order);await update(order.id);return res.sendStatus(200);
  }catch{return res.sendStatus(503);}
 };
}
module.exports.createHeroWebhook=createHeroWebhook;
