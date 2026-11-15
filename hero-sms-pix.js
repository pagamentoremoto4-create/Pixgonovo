'use strict';
function cents(value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const amount=Number(value);return Number.isFinite(amount)&&amount>0?Math.round(amount*100):null;
}
function validateHeroPix(payment,order,result,{allowDelayed=false}={}){
 if(!payment||!order||payment.payment_id!==order.payment_id||Number(payment.revenda_id)!==Number(order.customer_id)||order.payment_method!=='pix')return false;
 const expected=cents(order.price_brl);
 if(expected===null||cents(payment.valor)!==expected||result?.success!==true)return false;
 const data=result.data;
 if(!data||String(data.payment_id??'')!==String(payment.payment_id)||cents(data.amount)!==expected)return false;
 return data.status==='completed'||(payment.gateway==='depixpay'&&allowDelayed&&data.status==='delayed');
}
function parseHeroPixContext(value){
 try{const context=typeof value==='string'?JSON.parse(value):value;return context?.tipoCompra==='HERO_SMS'&&Number.isSafeInteger(Number(context.heroOrderId))&&Number(context.heroOrderId)>0?context:null;}catch{return null;}
}
function heroPixDelivered(order){return !!order?.activation_id&&['number_received','sms_received','finished','canceled'].includes(order.status);}
module.exports={validateHeroPix,parseHeroPixContext,heroPixDelivered};
