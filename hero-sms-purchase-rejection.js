'use strict';
const {transaction}=require('./customer-billing');
const money=v=>{const n=Number(v),c=Math.round(n*100);return Number.isFinite(n)&&n>0&&Number.isSafeInteger(c)&&Math.abs(n*100-c)<0.000001?c:null;};
function noNumbersProof(error){const status=Number(error?.httpStatus||error?.response?.status),body=error?.providerBody||error?.response?.data;
 return status===400&&error?.code==='NO_NUMBERS'&&body?.title==='NO_NUMBERS'&&!body?.data&&!body?.activation&&!body?.activationId?{code:'NO_NUMBERS',httpStatus:400}:null;}
function legacyNoNumbers(message){try{const m=String(message||'').match(/^Hero SMS recusou a operação \(HTTP 400\): (\{.*\})$/s);if(!m)return null;const body=JSON.parse(m[1]);return noNumbersProof({code:body.title,httpStatus:400,providerBody:body});}catch(_){return null;}}
async function schema(run){await run(`CREATE TABLE IF NOT EXISTS hero_sms_purchase_rejections(order_id INTEGER PRIMARY KEY,code TEXT NOT NULL,http_status INTEGER NOT NULL,source TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);}
async function recordPurchaseRejection(filename,id,error,{legacyReviewed=false}={}){const proof=noNumbersProof(error);if(!proof) return false;return transaction(filename,async({run,get})=>{
 await schema(run);const o=await get('SELECT * FROM hero_sms_orders WHERE id=?',[Number(id)]);
 if(legacyReviewed&&o?.status==='uncertain'&&!legacyNoNumbers(o.last_error))return false;
 if(!o||o.payment_method==='external'||o.activation_id||o.phone||o.sms_received||o.sms_code||!['purchasing','purchase_rejected',...(legacyReviewed?['uncertain']:[])].includes(o.status))return false;
 await run('INSERT OR IGNORE INTO hero_sms_purchase_rejections(order_id,code,http_status,source) VALUES(?,?,?,?)',[o.id,proof.code,proof.httpStatus,legacyReviewed?'admin_reviewed_legacy':'provider_purchase_response']);
 await run("UPDATE hero_sms_orders SET status='purchase_rejected',last_error='HERO_NO_NUMBERS',updated_at=CURRENT_TIMESTAMP WHERE id=?",[o.id]);return true;
 });}
async function settlePurchaseRejection(filename,id){return transaction(filename,async({run,get})=>{
 await schema(run);const o=await get('SELECT * FROM hero_sms_orders WHERE id=?',[Number(id)]),r=await get('SELECT * FROM hero_sms_purchase_rejections WHERE order_id=?',[Number(id)]);
 if(!o||!r||r.code!=='NO_NUMBERS'||r.http_status!==400||o.payment_method==='external'||o.activation_id||o.phone||o.sms_received||o.sms_code||!['purchase_rejected','canceled'].includes(o.status))throw Error('Recusa de compra sem prova válida ou pedido com ativação.');
 const amount=money(o.price_brl);if(!amount)throw Error('Valor do pedido inválido.');
 const ledger=await get('SELECT * FROM hero_sms_refund_ledger WHERE order_id=?',[o.id]);
 if(ledger){if(ledger.source!=='purchase_NO_NUMBERS'||Number(ledger.customer_id)!==Number(o.customer_id)||money(ledger.amount_brl)!==amount||o.refund_status!=='credited')throw Error('Registro de devolução exige conferência.');return {credited:true,alreadyCredited:true,amount:Number(o.price_brl)};}
 if(o.refund_status==='credited')throw Error('Crédito sem registro financeiro; confira antes de devolver.');
 if(o.payment_method==='pix'){
  const p=await get('SELECT * FROM pix_pedidos WHERE payment_id=?',[o.payment_id]),receipt=await get('SELECT * FROM hero_sms_pix_receipts WHERE payment_id=? AND order_id=?',[o.payment_id,o.id]);
  if(!p||!receipt||!['completed',...(p?.gateway==='depixpay'?['delayed']:[])].includes(receipt?.provider_status)||Number(p.revenda_id)!==Number(o.customer_id)||p.cliente_jid!==o.customer_jid||p.gateway!==receipt.gateway||receipt.order_id!==o.id||money(p.valor)!==amount||money(receipt.amount_brl)!==amount||!['completed','delivery_pending'].includes(p.status))throw Error('Pix sem confirmação financeira correspondente para devolver.');
 }else if(o.payment_method==='saldo'){
  const debit=await get('SELECT * FROM hero_sms_wallet_debits WHERE order_id=?',[o.id]);if(!debit||Number(debit.customer_id)!==Number(o.customer_id)||money(debit.amount_brl)!==amount)throw Error('Débito da carteira não confirmado.');
 }else if(o.payment_method==='postpaid'){
  if(await get('SELECT order_id FROM hero_sms_wallet_debits WHERE order_id=?',[o.id]))throw Error('Pedido pós-pago com débito exige conferência.');
  await run("UPDATE hero_sms_orders SET status='canceled',refund_status='not_charged',last_error='HERO_NO_NUMBERS',updated_at=CURRENT_TIMESTAMP WHERE id=?",[o.id]);return {credited:false,notCharged:true,amount:0};
 }else throw Error('Forma de pagamento não suportada para esta devolução.');
 await run('INSERT INTO hero_sms_refund_ledger(order_id,customer_id,amount_brl,source) VALUES(?,?,?,?)',[o.id,o.customer_id,Number(o.price_brl),'purchase_NO_NUMBERS']);
 const changed=await run('UPDATE revendas SET saldo=COALESCE(saldo,0)+?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?',[Number(o.price_brl),o.customer_id]);if(!changed.changes)throw Error('Cliente não encontrado para crédito.');
 await run("UPDATE hero_sms_orders SET status='canceled',refund_status='credited',last_error='HERO_NO_NUMBERS',updated_at=CURRENT_TIMESTAMP WHERE id=?",[o.id]);
 if(o.payment_method==='pix')await run("UPDATE pix_pedidos SET status='wallet_credited' WHERE payment_id=? AND status IN ('completed','delivery_pending')",[o.payment_id]);
 return {credited:true,alreadyCredited:false,amount:Number(o.price_brl)};
 });}
module.exports={noNumbersProof,legacyNoNumbers,recordPurchaseRejection,settlePurchaseRejection};
