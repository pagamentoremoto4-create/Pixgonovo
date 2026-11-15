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
    if(requireReceipt){
      const receipt=await get('SELECT activation_id FROM hero_sms_cancel_receipts WHERE order_id=?',[orderId]);
      if(!receipt||String(receipt.activation_id)!==String(order.activation_id))throw new Error('Cancelamento sem confirmação persistida para esta ativação.');
    }
    const amount=Number(order.price_brl);
    if(!Number.isFinite(amount)||amount<=0)throw new Error('Valor de estorno inválido.');
    const existing=await get('SELECT order_id FROM hero_sms_refund_ledger WHERE order_id=?',[orderId]);
    if(existing)throw new Error('Registro de estorno inconsistente; conferência necessária.');
    await run('INSERT INTO hero_sms_refund_ledger(order_id,customer_id,amount_brl,source) VALUES(?,?,?,?)',[order.id,order.customer_id,amount,requireReceipt?'ACCESS_CANCEL':'legacy_history_status_10']);
    const credit=await run('UPDATE revendas SET saldo=COALESCE(saldo,0)+?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?',[amount,order.customer_id]);
    if(!credit.changes)throw new Error('Conta não encontrada para estorno.');
    await run("UPDATE hero_sms_orders SET status='canceled',refund_status='credited',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",[orderId]);
    await run('COMMIT');transaction=false;
    return {credited:true,alreadyCredited:false,amount};
  }catch(e){if(transaction)await run('ROLLBACK').catch(()=>{});throw e;}
  finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
module.exports={creditHeroRefund};
