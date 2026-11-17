'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createCheckout}=require('../hero-sms-v280-checkout');
function fixture(){
 let next=1,charged=0,purchased=0,refunded=0;const orders=new Map(),keys=new Map();
 const store={async create(q){if(keys.has(q.idempotencyKey))return orders.get(keys.get(q.idempotencyKey));const o={...q,id:next++,status:'awaiting_payment'};orders.set(o.id,o);keys.set(q.idempotencyKey,o.id);return o;},async get(id){return orders.get(id);},async claim(id,from,to){const o=orders.get(id);if(o.status!==from)return false;o.status=to;return true;},async patch(id,fields){Object.assign(orders.get(id),fields);}};
 const payments={async createPix(){return {paymentId:'pix1',pixCode:'000'};},async verifyPix(){return {confirmed:true,paymentId:'pix1',amountCents:3000};},async debitBalance(){charged++;},async refundBalance(){refunded++;}};
 const provider={async getNumber(){purchased++;return {activationId:'123',phoneNumber:'+5511999999999'};},async getStatus(){return {code:'123456'};},async cancel(){return {cancelled:true};}};
 const sent=[];const checkout=createCheckout({store,payments,provider,notify:{async send(_,msg){sent.push(msg);}}});
 const quote={service:'wa',country:'73',priceCents:3000,customerId:1};
 return {checkout,quote,sent,metrics:()=>({charged,purchased,refunded})};
}
test('idempotência do pedido e saldo, compra e reembolso',async()=>{const f=fixture();const args={quote:f.quote,method:'saldo',customerJid:'user',idempotencyKey:'requisicao-123'};const a=await f.checkout.create(args),b=await f.checkout.create(args);assert.equal(a.id,b.id);await f.checkout.preparePayment(a.id);await f.checkout.preparePayment(a.id);await f.checkout.purchase(a.id);await f.checkout.purchase(a.id);await f.checkout.pollSms(a.id);assert.equal(f.metrics().charged,1);assert.equal(f.metrics().purchased,1);assert.equal(f.sent.length,2);});
test('PIX só libera compra com confirmação do gateway',async()=>{const f=fixture();const o=await f.checkout.create({quote:f.quote,method:'pix',customerJid:'user',idempotencyKey:'requisicao-pix'});await f.checkout.preparePayment(o.id);await f.checkout.purchase(o.id);assert.equal(f.metrics().purchased,0);await f.checkout.confirmPix(o.id);await f.checkout.purchase(o.id);assert.equal(f.metrics().purchased,1);});
test('cancelamento confirmado permite um único estorno de saldo',async()=>{const f=fixture();const o=await f.checkout.create({quote:f.quote,method:'saldo',customerJid:'user',idempotencyKey:'requisicao-cancel'});await f.checkout.preparePayment(o.id);await f.checkout.purchase(o.id);await f.checkout.requestCancellation(o.id);await f.checkout.refund(o.id);await f.checkout.refund(o.id);assert.equal(f.metrics().refunded,1);});
test('PIX não é estornado artificialmente em saldo',async()=>{const f=fixture();const o=await f.checkout.create({quote:f.quote,method:'pix',customerJid:'user',idempotencyKey:'requisicao-pix-refund'});await f.checkout.preparePayment(o.id);await f.checkout.confirmPix(o.id);await f.checkout.purchase(o.id);await f.checkout.requestCancellation(o.id);await f.checkout.refund(o.id);assert.equal(f.metrics().refunded,0);});
