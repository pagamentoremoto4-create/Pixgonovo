'use strict';
function checkoutError(code,message){
 const error=new Error(message);error.name='HeroCheckoutError';error.code=code;return error;
}
function checkoutMessage(error,reference){
 if(error?.name==='HeroCheckoutError')return '⚠️ '+error.message;
 return `⚠️ Não foi possível concluir o pedido. Referência: ${reference}. Confira seus pedidos antes de tentar novamente.`;
}
function checkoutDiagnostic(error,reference){
 const message=String(error?.message||'Erro não identificado')
  .replace(/https?:\/\/\S+/gi,'[URL omitida]')
  .replace(/((?:api[_-]?key|access[_-]?token|authorization|password|senha)\s*[:=]\s*)[^\s,;]+/gi,'$1[omitido]')
  .slice(0,350);
 return {reference,code:String(error?.code||'CHECKOUT_ERROR'),name:String(error?.name||'Error'),httpStatus:Number(error?.httpStatus||error?.response?.status)||null,message};
}
module.exports={checkoutError,checkoutMessage,checkoutDiagnostic};
