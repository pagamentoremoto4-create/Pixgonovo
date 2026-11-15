'use strict';
function cents(value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const amount=Number(value);return Number.isFinite(amount)&&amount>0?Math.round(amount*100):null;
}
function heroPixValidation(payment,order,result,{allowDelayed=false}={}){
 const data=result?.data;
 const diagnostic={
  valid:false,reason:'UNKNOWN',gateway:payment?.gateway||null,
  local_payment_id:payment?.payment_id??null,order_payment_id:order?.payment_id??null,
  provider_payment_id:data?.payment_id??null,
  expected_amount_cents:cents(order?.price_brl),local_amount_cents:cents(payment?.valor),provider_amount_cents:cents(data?.amount),
  order_customer_id:order?.customer_id??null,payment_customer_id:payment?.revenda_id??null,
  provider_status:data?.status??null
 };
 const fail=reason=>({...diagnostic,reason});
 if(!payment)return fail('LOCAL_PAYMENT_MISSING');
 if(!order)return fail('ORDER_MISSING');
 if(payment.payment_id!==order.payment_id)return fail('LOCAL_PAYMENT_ID_MISMATCH');
 if(Number(payment.revenda_id)!==Number(order.customer_id))return fail('CUSTOMER_MISMATCH');
 if(order.payment_method!=='pix')return fail('PAYMENT_METHOD_MISMATCH');
 if(diagnostic.expected_amount_cents===null)return fail('INVALID_ORDER_AMOUNT');
 if(diagnostic.local_amount_cents!==diagnostic.expected_amount_cents)return fail('LOCAL_AMOUNT_MISMATCH');
 if(result?.success!==true||!data)return fail('PROVIDER_RESPONSE_UNCONFIRMED');
 if(data.payment_id==null||String(data.payment_id).trim()==='')return fail('PROVIDER_PAYMENT_ID_MISSING');
 if(String(data.payment_id)!==String(payment.payment_id))return fail('PROVIDER_PAYMENT_ID_MISMATCH');
 if(diagnostic.provider_amount_cents===null)return fail('PROVIDER_AMOUNT_MISSING');
 if(diagnostic.provider_amount_cents!==diagnostic.expected_amount_cents)return fail('PROVIDER_AMOUNT_MISMATCH');
 if(data.status!=='completed'&&!(payment.gateway==='depixpay'&&allowDelayed&&data.status==='delayed'))return fail('PROVIDER_STATUS_NOT_ELIGIBLE');
 return {...diagnostic,valid:true,reason:'CONFIRMED'};
}
function validateHeroPix(payment,order,result,options={}){return heroPixValidation(payment,order,result,options).valid;}
function parseHeroPixContext(value){
 try{const context=typeof value==='string'?JSON.parse(value):value;return context?.tipoCompra==='HERO_SMS'&&Number.isSafeInteger(Number(context.heroOrderId))&&Number(context.heroOrderId)>0?context:null;}catch{return null;}
}
function heroPixDelivered(order){return !!order?.activation_id&&['number_received','sms_received','finished','canceled'].includes(order.status);}
module.exports={validateHeroPix,heroPixValidation,parseHeroPixContext,heroPixDelivered};
