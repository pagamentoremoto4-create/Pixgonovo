'use strict';
// V280: orquestrador injetável. Não ativa cobranças até adaptadores financeiros serem homologados.
const {validateQuote,parseActivation} = require('./hero-sms-order-guard');
const VALID_METHODS = new Set(['pix','saldo']);
function cents(v){if(!Number.isSafeInteger(v)||v<=0)return false;return true;}
function createCheckout({store,payments,provider,notify}){
  for(const [name,obj] of Object.entries({store,payments,provider,notify}))if(!obj)throw new Error(`Adaptador ${name} ausente`);
  const required={store:['create','get','claim','patch'],payments:['createPix','verifyPix','debitBalance','refundBalance'],provider:['getNumber','getStatus','cancel'],notify:['send']};
  for(const [name,methods] of Object.entries(required))for(const m of methods)if(typeof ({store,payments,provider,notify}[name][m])!=='function')throw new Error(`${name}.${m} ausente`);
  async function create({quote,method,customerJid,idempotencyKey}){
    const q=validateQuote(quote);
    if(!VALID_METHODS.has(method))throw new Error('Método de pagamento inválido');
    if(!/^.{6,160}$/.test(String(idempotencyKey||'')))throw new Error('Chave de idempotência inválida');
    if(!customerJid || String(customerJid).length>160)throw new Error('Destinatário inválido');
    // store.create DEVE impor UNIQUE(idempotencyKey) e devolver pedido existente em repetição.
    const order=await store.create({...q,method,customerJid,idempotencyKey});
    if(order.method!==method||order.priceCents!==q.priceCents||order.customerId!==q.customerId)throw new Error('Conflito de idempotência');
    return order;
  }
  async function preparePayment(orderId){
    const o=await store.get(orderId);
    if(!o||o.status!=='awaiting_payment')return o;
    if(o.method==='pix'){
      if(o.paymentId)return o;
      // Reserva exclusiva antes de chamar gateway; timeout ambíguo requer conciliação.
      if(!await store.claim(o.id,'awaiting_payment','payment_creating'))return store.get(o.id);
      try{
        const p=await payments.createPix({orderId:o.id,amountCents:o.priceCents,idempotencyKey:`hero:${o.id}`});
        if(!p?.paymentId)throw new Error('Gateway não retornou identificação');
        await store.patch(o.id,{paymentId:String(p.paymentId),pixCode:p.pixCode||null,status:'awaiting_payment'});
      }catch(e){await store.patch(o.id,{status:'payment_reconciliation',lastError:String(e.message).slice(0,200)});throw e;}
    }else{
      if(!await store.claim(o.id,'awaiting_payment','balance_debiting'))return store.get(o.id);
      try{
        // debitBalance DEVE ser transação atômica com UNIQUE(orderId), saldo >= preço.
        await payments.debitBalance({orderId:o.id,customerId:o.customerId,amountCents:o.priceCents});
        await store.patch(o.id,{status:'paid'});
      }catch(e){await store.patch(o.id,{status:'balance_reconciliation',lastError:String(e.message).slice(0,200)});throw e;}
    }
    return store.get(o.id);
  }
  async function confirmPix(orderId){
    const o=await store.get(orderId);
    if(!o||o.method!=='pix'||!o.paymentId)return o;
    if(o.status!=='awaiting_payment')return o;
    // NUNCA confiar em webhook sem consultar gateway e validar valor e identificação.
    const result=await payments.verifyPix({paymentId:o.paymentId,amountCents:o.priceCents});
    if(!result||result.confirmed!==true||result.paymentId!==o.paymentId||result.amountCents!==o.priceCents)return o;
    await store.claim(o.id,'awaiting_payment','paid');
    return store.get(o.id);
  }
  async function purchase(orderId){
    const o=await store.get(orderId);
    if(!o||o.status!=='paid')return o;
    if(!await store.claim(o.id,'paid','purchasing'))return store.get(o.id);
    try{
      const result=parseActivation(await provider.getNumber(o.service,o.country));
      await store.patch(o.id,{activationId:result.activationId,phone:result.phoneNumber,status:'number_delivered'});
      await notify.send(o.customerJid,`📱 Seu número temporário: ${result.phoneNumber}`);
    }catch(e){
      // Se a chamada externa tiver sido executada, NUNCA repetir automaticamente.
      await store.patch(o.id,{status:'reconciliation_required',lastError:String(e.message).slice(0,200)});
      throw e;
    }
    return store.get(o.id);
  }
  async function pollSms(orderId){
    const o=await store.get(orderId);
    if(!o||o.status!=='number_delivered'||!o.activationId)return o;
    const result=await provider.getStatus(o.activationId);
    const code=typeof result==='object' ? result?.code : null;
    if(!code||!/^\d{3,10}$/.test(String(code)))return o;
    if(await store.claim(o.id,'number_delivered','sms_received')){
      await store.patch(o.id,{smsCode:String(code)});
      await notify.send(o.customerJid,`📩 Código SMS: ${code}`);
    }
    return store.get(o.id);
  }
  async function requestCancellation(orderId){
    const o=await store.get(orderId);
    if(!o||o.status!=='number_delivered')return o;
    if(!await store.claim(o.id,'number_delivered','cancel_requested'))return store.get(o.id);
    try{
      const confirmation=await provider.cancel(o.activationId);
      // Apenas confirmação explícita do provedor permite iniciar reembolso.
      if(confirmation?.cancelled===true)await store.patch(o.id,{status:'refund_pending'});
      else await store.patch(o.id,{status:'cancel_denied'});
    }catch(e){await store.patch(o.id,{status:'reconciliation_required',lastError:String(e.message).slice(0,200)});throw e;}
    return store.get(o.id);
  }
  async function refund(orderId){
    const o=await store.get(orderId);
    if(!o||o.status!=='refund_pending')return o;
    if(o.method==='pix')return o; // PIX requer estorno real no gateway, não crédito artificial.
    if(!await store.claim(o.id,'refund_pending','refunding'))return store.get(o.id);
    try{
      // refundBalance DEVE impor UNIQUE(orderId), exatamente uma vez.
      await payments.refundBalance({orderId:o.id,customerId:o.customerId,amountCents:o.priceCents});
      await store.patch(o.id,{status:'refunded'});
    }catch(e){await store.patch(o.id,{status:'refund_reconciliation',lastError:String(e.message).slice(0,200)});throw e;}
    return store.get(o.id);
  }
  return {create,preparePayment,confirmPix,purchase,pollSms,requestCancellation,refund};
}
module.exports={createCheckout};
