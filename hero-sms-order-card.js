'use strict';
const {heroCountryLabel}=require('./hero-sms-countries');
const {isoTime}=require('./hero-sms-lifecycle');
function renderOrderCard(order, waitSeconds=0, telegram=false) {
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const statuses={test_closed:'🧪 Pedido de teste encerrado.',awaiting_payment:'💠 Aguardando pagamento Pix.',payment_expired:'⌛ Pix expirado ou encerrado.',payment_creating:'⏳ Gerando pagamento Pix.',payment_reconciliation:'⏳ Pagamento Pix em conferência.',payment_failed:'❌ Não foi possível gerar o pagamento.',insufficient_balance:'❌ Saldo insuficiente.',paid:'✅ Pagamento confirmado. Aguardando compra do número.',purchasing:'⏳ Solicitando número ao fornecedor.',uncertain:'⚠️ Compra em verificação. Nenhum número foi confirmado neste pedido.',number_received:'⏳ Aguardando SMS.',sms_received:'✅ SMS RECEBIDOS',canceled:order.activation_id?'❌ ATIVAÇÃO CANCELADA':'❌ COMPRA ENCERRADA',finished:'✅ ATIVAÇÃO FINALIZADA',replace_pending:'🔄 Troca em andamento.',replace_uncertain:'⏳ Troca em conferência.',cancel_pending:'⏳ Cancelamento em conferência.',finish_pending:'⏳ Encerramento em verificação.'};
  const lines=['🔓 CENTRALUNLOCKER',`📦 PEDIDO #${order.id}`];
  if(order.country!=null)lines.push('🌎 País: '+heroCountryLabel(order.country,order.country_name));
  if(order.phone)lines.push(`📱 Número: +${String(order.phone).replace(/^\+/,'')}`);
  const expiration=isoTime(order.expires_at),remaining=expiration?Math.max(0,Math.ceil((Date.parse(expiration)-Date.now())/60000)):null;
  const ongoing=['number_received','sms_received','replace_pending','replace_uncertain','cancel_pending','finish_pending'].includes(order.status);
  if(ongoing)lines.push(remaining==null?'⌛ Prazo em sincronização com a Hero.':remaining>0?`⌛ Tempo restante: ${remaining}min`:'⌛ Prazo encerrado. Conferindo ativação na Hero.');
  lines.push('',statuses[order.status]||'⏳ Pedido em acompanhamento.');
  if(['uncertain','payment_reconciliation'].includes(order.status))lines.push('Confira este pedido com o administrador antes de tentar comprar ou pagar novamente.');
  if(order.status==='test_closed')lines.push('O encerramento do teste não altera o pagamento nem o saldo.');
  const messages=order.messages?.length?order.messages:(order.sms_code?[{code:order.sms_code}]:[]);
  const pages=Math.max(1,Math.ceil(messages.length/8));
  const page=Number(order.display_sms_page)>=0?Math.min(Number(order.display_sms_page),pages-1):pages-1;
  if(messages.length){
    lines.push('','📩 SMS RECEBIDOS'+(pages>1?` (${page+1}/${pages})`:''));
    messages.slice(page*8,page*8+8).forEach((m,i)=>{
      lines.push('',m.code?`Código ${page*8+i+1}: ${String(m.code).slice(0,100)}`:`SMS ${page*8+i+1}: ${String(m.text||'SMS recebido').slice(0,240)}`);
      const time=isoTime(m.received_at);if(time)lines.push('🕒 '+new Date(time).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}));
    });
  }else if(order.status==='number_received')lines.push('📩 Os códigos aparecerão nesta mensagem automaticamente.');
  if(order.status==='canceled'){
    if(order.refund_status==='not_charged'||(order.payment_method==='postpaid'&&order.refund_status==='none')){lines.push('Nenhum valor foi cobrado da sua conta.');}
    else if(order.refund_status==='credited'){
      lines.push('💰 Valor devolvido à sua carteira: '+money(order.price_brl));
      if(order.wallet_balance!=null)lines.push('💳 Saldo atual: '+money(order.wallet_balance));
    }else lines.push('⏳ Devolução do crédito em verificação.');
  }
  const received=Boolean(order.sms_received||order.sms_code||messages.length);
  const expired=remaining===0;
  const eligible=order.status==='number_received'&&!received&&waitSeconds<=0&&!expired;
  const canFinish=['number_received','sms_received'].includes(order.status)&&received&&!expired;
  const buttons=[];
  if(eligible)buttons.push([{text:'🔄 Solicitar troca',callback_data:`hero_sms_replace_${order.id}`}],[{text:'❌ Solicitar cancelamento',callback_data:`hero_sms_cancel_${order.id}`}]);
  if(canFinish)buttons.push([{text:'✅ Finalizar ativação',callback_data:`hero_sms_finish_${order.id}`}]);
  if(order.status==='finished')buttons.push([{text:'🛒 Comprar outro número',callback_data:'hero_sms_cat_whatsapp'}]);
  if(page>0)buttons.push([{text:'SMS anteriores',callback_data:`hero_sms_codes_${order.id}_${page-1}`}]);
  if(page<pages-1)buttons.push([{text:'Próximos SMS',callback_data:`hero_sms_codes_${order.id}_${page+1}`}]);
  if(!telegram){
    if(eligible)lines.push('','1️⃣ 🔄 Solicitar troca','2️⃣ ❌ Solicitar cancelamento');
    if(canFinish)lines.push('','1️⃣ ✅ Finalizar ativação');
    if(order.status==='finished')lines.push('','1️⃣ 🛒 Comprar outro número');
    if(page>0)lines.push('3️⃣ SMS anteriores');
    if(page<pages-1)lines.push('4️⃣ Próximos SMS');
    lines.push('','0️⃣ ⬅️ Voltar');
  }
  buttons.push([{text:'⬅️ Meus pedidos',callback_data:'hero_sms_orders'}]);
  return {text:lines.join('\n'),buttons};
}
function createOrderMessenger({loadOrder,loadReference,saveReference,send,edit,render}) {
  const queues=new Map();
  async function update(id,{createIfMissing=true,reference:targetReference=null,forceNewMessage=false}={}){
    const previous=queues.get(id)||Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{
      const order=await loadOrder(id);
      if(!order)throw new Error('Pedido não encontrado.');
      const card=render(order);
      const fingerprint=JSON.stringify(card);
      const stored=targetReference?{reference:targetReference,fingerprint:null}:(forceNewMessage?null:await loadReference(id));
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
