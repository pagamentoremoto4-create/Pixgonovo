'use strict';
// Adaptador SQLite para o orquestrador V280. Não habilita vendas sozinho.
const {validateQuote}=require('./hero-sms-order-guard');
const allowed=new Set(['awaiting_payment','payment_creating','payment_reconciliation','balance_debiting','balance_reconciliation','paid','purchasing','number_delivered','sms_received','cancel_requested','cancel_denied','refund_pending','refunding','refunded','refund_reconciliation','reconciliation_required','completed']);
function createSqliteStore(db){
  if(!db||typeof db.run!=='function'||typeof db.get!=='function')throw new Error('SQLite inválido');
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve({changes:this.changes,lastID:this.lastID});}));
  const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
  async function init(){
    await run(`CREATE TABLE IF NOT EXISTS hero_sms_checkout_v281 (
      id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL, customer_jid TEXT NOT NULL, service TEXT NOT NULL,
      country TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>0),
      method TEXT NOT NULL CHECK(method IN ('pix','saldo')),
      status TEXT NOT NULL DEFAULT 'awaiting_payment', payment_id TEXT UNIQUE,
      pix_code TEXT, activation_id TEXT UNIQUE, phone TEXT, sms_code TEXT,
      last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  function normalize(r){if(!r)return null;const out={};for(const [k,v] of Object.entries(r))out[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return out;}
  async function byId(id){return normalize(await get('SELECT * FROM hero_sms_checkout_v281 WHERE id=?',[id]));}
  async function create(input){
    const q=validateQuote(input);
    if(!['pix','saldo'].includes(input.method)||!input.customerJid||!/^[\w:.-]{6,160}$/.test(input.idempotencyKey))throw new Error('Pedido inválido');
    await run(`INSERT OR IGNORE INTO hero_sms_checkout_v281(idempotency_key,customer_id,customer_jid,service,country,price_cents,method)
      VALUES(?,?,?,?,?,?,?)`,[input.idempotencyKey,q.customerId,input.customerJid,q.service,q.country,q.priceCents,input.method]);
    return normalize(await get('SELECT * FROM hero_sms_checkout_v281 WHERE idempotency_key=?',[input.idempotencyKey]));
  }
  async function claim(id,from,to){
    if(!allowed.has(from)||!allowed.has(to))throw new Error('Estado inválido');
    const result=await run('UPDATE hero_sms_checkout_v281 SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?',[to,id,from]);
    return result.changes===1;
  }
  async function patch(id,fields){
    const map={status:'status',paymentId:'payment_id',pixCode:'pix_code',activationId:'activation_id',phone:'phone',smsCode:'sms_code',lastError:'last_error'};
    const entries=Object.entries(fields||{});
    if(!entries.length)return byId(id);
    if(entries.some(([k,v])=>!map[k]||(k==='status'&&!allowed.has(v))))throw new Error('Campo inválido');
    const result=await run(`UPDATE hero_sms_checkout_v281 SET ${entries.map(([k])=>map[k]+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`,[...entries.map(([,v])=>v),id]);
    if(result.changes!==1)throw new Error('Pedido não encontrado');
    return byId(id);
  }
  return {init,create,get:byId,claim,patch};
}
module.exports={createSqliteStore};
