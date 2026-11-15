'use strict';
function renderOrderCard(order, waitSeconds=0, telegram=false) {
  const statuses={number_received:'⏳ Aguardando SMS.',sms_received:'✅ SMS RECEBIDO',canceled:'❌ ATIVAÇÃO CANCELADA',finished:'✅ Ativação finalizada.',replace_pending:'🔄 Troca em andamento.',replace_uncertain:'⏳ Troca em conferência.',cancel_pending:'⏳ Cancelamento em conferência.'};
  const lines=['🔓 CENTRALUNLOCKER',`📦 PEDIDO #${order.id}`];
  if(order.phone)lines.push(`📱 Número: +${String(order.phone).replace(/^\+/,'')}`);
  lines.push('',statuses[order.status]||'⏳ Pedido em acompanhamento.');
  if(order.sms_code)lines.push(`🔐 Código: ${order.sms_code}`);
  else if(order.status==='number_received')lines.push('📩 O código aparecerá nesta mensagem automaticamente.');
  if(order.status==='canceled')lines.push(order.refund_status==='credited'?'💰 Valor devolvido à sua carteira.':'⏳ Crédito na carteira ainda não confirmado.');
  const eligible=order.status==='number_received'&&!order.sms_code&&waitSeconds<=0;
  if(!telegram){
    if(eligible)lines.push('','1️⃣ 🔄 Solicitar troca','2️⃣ ❌ Solicitar cancelamento');
    lines.push('','0️⃣ ⬅️ Voltar');
  }
  const buttons=[];
  if(eligible)buttons.push([{text:'🔄 Solicitar troca',callback_data:`hero_sms_replace_${order.id}`}],[{text:'❌ Solicitar cancelamento',callback_data:`hero_sms_cancel_${order.id}`}]);
  buttons.push([{text:'⬅️ Meus pedidos',callback_data:'hero_sms_orders'}]);
  return {text:lines.join('\n'),buttons};
}
function createOrderMessenger({loadOrder,loadReference,saveReference,send,edit,render}) {
  const queues=new Map();
  async function update(id,{createIfMissing=true}={}){
    const previous=queues.get(id)||Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{
      const order=await loadOrder(id);
      if(!order)throw new Error('Pedido não encontrado.');
      const card=render(order);
      const fingerprint=JSON.stringify(card);
      const stored=await loadReference(id);
      if(stored?.fingerprint===fingerprint)return true;
      if(stored){
        try{
          await edit(stored.reference,card);
          await saveReference(id,stored.reference,fingerprint);
          return true;
        }catch(error){
          // Retry temporary failures later. Only a known non-editable message
          // permits a replacement, to avoid a stream of fallback messages.
          if(!error.cannotEdit)throw error;
        }
      }else if(!createIfMissing)return false;
      const reference=await send(order,card);
      if(!reference)throw new Error('Mensagem do pedido não confirmada pelo canal.');
      await saveReference(id,reference,fingerprint);
      return true;
    });
    queues.set(id,job);
    try{return await job;}finally{if(queues.get(id)===job)queues.delete(id);}
  }
  return {update};
}
module.exports={renderOrderCard,createOrderMessenger};
