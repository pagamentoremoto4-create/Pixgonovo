'use strict';
// Guardas puras para estados de pedidos Hero SMS. Sem efeitos financeiros ou chamadas externas.
const STATES = Object.freeze({
  awaiting_payment: ['paid','cancelled'],
  paid: ['purchasing','refund_pending'],
  purchasing: ['number_delivered','reconciliation_required'],
  number_delivered: ['sms_received','cancel_requested','completed'],
  sms_received: ['completed'],
  cancel_requested: ['cancelled_by_provider','cancel_denied','reconciliation_required'],
  cancelled_by_provider: ['refund_pending'],
  refund_pending: ['refunded','reconciliation_required'],
  cancel_denied: ['number_delivered'],
  reconciliation_required: [], completed: [], refunded: [], cancelled: []
});
function canTransition(from,to){return !!STATES[from]?.includes(to);}
function validateQuote(q){
  if(!q || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(q.service||'')) || !/^\d{1,5}$/.test(String(q.country||'')))throw new Error('Oferta inválida');
  if(!Number.isInteger(q.priceCents)||q.priceCents<1||q.priceCents>100000000)throw new Error('Preço inválido');
  if(!Number.isInteger(q.customerId)||q.customerId<1)throw new Error('Cliente inválido');
  return Object.freeze({service:q.service,country:q.country,priceCents:q.priceCents,customerId:q.customerId});
}
function parseActivation(result){
  if(!result || typeof result!=='object')throw new Error('Ativação ambígua: conciliação manual necessária');
  const id=String(result.activationId||''); const phone=String(result.phoneNumber||'');
  if(!/^\d{1,30}$/.test(id)||!/^\+?\d{7,20}$/.test(phone))throw new Error('Ativação ambígua: conciliação manual necessária');
  return {activationId:id,phoneNumber:phone};
}
module.exports={STATES,canTransition,validateQuote,parseActivation};
