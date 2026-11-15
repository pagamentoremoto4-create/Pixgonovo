'use strict';
const sqlite3=require('sqlite3');
// A dedicated connection prevents unrelated application SQL from interleaving
// with this wallet transaction on the server's shared SQLite connection.
async function creditHeroRefund(filename,orderId,{requireReceipt=true}={}){
  const db=new sqlite3.Database(filename);
  db.configure('busyTimeout',5000);
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
  const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,row)=>e?reject(e):resolve(row)));
  let transaction=false;
  try{
    await run('BEGIN IMMEDIATE');transaction=true;
    const order=await get('SELECT * FROM hero_sms_orders WHERE id=?',[orderId]);
    if(!order)throw new Error('Pedido não encontrado.');
    if(order.refund_status==='credited'){await run('COMMIT');transaction=false;return {credited:true,alreadyCredited:true,amount:order.price_brl};}
    if(order.payment_method==='external')throw new Error('Pedido externo: devolução deve ocorrer no bot de origem.');
    if(order.status==='test_closed'||order.sms_received||order.sms_code)throw new Error('Pedido com SMS ou teste encerrado exige conferência; crédito automático bloqueado.');
    if(requireReceipt){
      const receipt=await get('SELECT activation_id FROM hero_sms_cancel_receipts WHERE order_id=?',[orderId]);
      if(!receipt||String(receipt.activation_id)!==String(order.activation_id))throw new Error('Cancelamento sem confirmação persistida para esta ativação.');
    }
    if(!requireReceipt){
      const receipt=await get('SELECT activation_id,provider_status FROM hero_sms_refund_receipts WHERE order_id=?',[orderId]);
      if(!receipt||receipt.provider_status!==10||String(receipt.activation_id)!==String(order.activation_id))throw new Error('Reembolso sem confirmação persistida da Hero.');
    }
    const amount=Number(order.price_brl);
    if(!Number.isFinite(amount)||amount<=0)throw new Error('Valor de estorno inválido.');
    const existing=await get('SELECT order_id FROM hero_sms_refund_ledger WHERE order_id=?',[orderId]);
    if(existing)throw new Error('Registro de estorno inconsistente; conferência necessária.');
    await run('INSERT INTO hero_sms_refund_ledger(order_id,customer_id,amount_brl,source) VALUES(?,?,?,?)',[order.id,order.customer_id,amount,requireReceipt?'ACCESS_CANCEL':'history_status_10']);
    const credit=await run('UPDATE revendas SET saldo=COALESCE(saldo,0)+?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?',[amount,order.customer_id]);
    if(!credit.changes)throw new Error('Conta não encontrada para estorno.');
    await run("UPDATE hero_sms_orders SET status='canceled',refund_status='credited',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[orderId]);
    await run('COMMIT');transaction=false;
    return {credited:true,alreadyCredited:false,amount};
  }catch(e){if(transaction)await run('ROLLBACK').catch(()=>{});throw e;}
  finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
module.exports={creditHeroRefund};

// Wallet debit and paid state commit together: a restart cannot leave a debit
// attached to an order still marked as awaiting payment.
async function debitHeroOrder(filename,orderId){
 const db=new sqlite3.Database(filename);db.configure('busyTimeout',5000);
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this);}));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 let transaction=false;
 try{
  await run('BEGIN IMMEDIATE');transaction=true;
  const o=await get('SELECT * FROM hero_sms_orders WHERE id=?',[orderId]);
  if(!o||o.payment_method!=='saldo')throw new Error('Pedido inválido para débito da carteira.');
  const prior=await get('SELECT order_id FROM hero_sms_wallet_debits WHERE order_id=?',[orderId]);
  if(prior){await run('COMMIT');transaction=false;return {changes:1,alreadyDebited:true};}
  if(o.status!=='awaiting_payment'||!Number.isFinite(Number(o.price_brl))||Number(o.price_brl)<=0)throw new Error('Estado ou valor inválido para débito.');
  const debit=await run('UPDATE revendas SET saldo=saldo-?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND saldo>=?',[o.price_brl,o.customer_id,o.price_brl]);
  if(!debit.changes){await run("UPDATE hero_sms_orders SET status='insufficient_balance' WHERE id=?",[orderId]);await run('COMMIT');transaction=false;return {changes:0};}
  await run('INSERT INTO hero_sms_wallet_debits(order_id,customer_id,amount_brl) VALUES(?,?,?)',[o.id,o.customer_id,o.price_brl]);
  await run("UPDATE hero_sms_orders SET status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?",[orderId]);
  await run('COMMIT');transaction=false;return {changes:1,alreadyDebited:false};
 }catch(e){if(transaction)await run('ROLLBACK').catch(()=>{});throw e;}
 finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
module.exports.debitHeroOrder=debitHeroOrder;
