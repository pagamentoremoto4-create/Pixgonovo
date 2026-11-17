'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
const start=source.indexOf('async function heroEditOrderMessage(');
const end=source.indexOf('async function heroUpdateOrderCard(',start);
function fixture(){
 const sent=[];
 const ctx=vm.createContext({Date,Number,String,whatsappSessoes:new Map(),conectado:false,whatsappSocket:null,tgBot:{editMessageText:async(...args)=>sent.push(args)}});
 vm.runInContext(source.slice(start,end),ctx);return {ctx,sent};
}
test('WhatsApp edit uses the original account and exact message key',async()=>{
 const f=fixture();const key={remoteJid:'5511@s.whatsapp.net',id:'original',fromMe:true};
 f.ctx.whatsappSessoes.set(7,{conectado:true,socket:{sendMessage:async(...args)=>f.sent.push(args)}});
 await f.ctx.heroEditOrderMessage({transport:'whatsapp',key,sessionId:7,sentAt:Date.now()},{text:'SMS 012345'});
 assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],key.remoteJid);assert.equal(f.sent[0][1].edit.id,'original');
});
test('disconnected WhatsApp original account is a retryable error, not edit expiration',async()=>{
 const f=fixture();
 await assert.rejects(f.ctx.heroEditOrderMessage({transport:'whatsapp',key:{},sessionId:7,sentAt:Date.now()},{text:'SMS'}),e=>!e.cannotEdit);
});
test('old WhatsApp message permits replacement without attempting an edit',async()=>{
 const f=fixture();f.ctx.whatsappSessoes.set(7,{conectado:true,socket:{sendMessage:async()=>assert.fail('expired edit')}});
 await assert.rejects(f.ctx.heroEditOrderMessage({transport:'whatsapp',key:{},sessionId:7,sentAt:Date.now()-16*60*1000},{text:'SMS'}),e=>e.cannotEdit===true);
});
test('Telegram edits the saved message id and replaces the keyboard',async()=>{
 const f=fixture();await f.ctx.heroEditOrderMessage({transport:'telegram',chatId:'123',messageId:55},{text:'SMS 012345',buttons:[]});
 assert.equal(f.sent[0][1].message_id,55);assert.equal(f.sent[0][1].chat_id,'123');assert.equal(f.sent[0][1].reply_markup.inline_keyboard.length,0);
});
test('Telegram unchanged content is success, missing message permits fallback, network failure does not',async()=>{
 const f=fixture();const ref={transport:'telegram',chatId:'123',messageId:55};
 f.ctx.tgBot.editMessageText=async()=>{throw new Error('Bad Request: message is not modified');};await f.ctx.heroEditOrderMessage(ref,{text:'SMS'});
 f.ctx.tgBot.editMessageText=async()=>{throw new Error('Bad Request: message to edit not found');};await assert.rejects(f.ctx.heroEditOrderMessage(ref,{text:'SMS'}),e=>e.cannotEdit===true);
 f.ctx.tgBot.editMessageText=async()=>{throw new Error('ECONNRESET');};await assert.rejects(f.ctx.heroEditOrderMessage(ref,{text:'SMS'}),e=>!e.cannotEdit);
});

test('Pix QR image uses the customer service session and resolved LID even without a primary socket',async()=>{
 const sent=[];const preferred={funcaoBot:true,conectado:true,socket:{sendMessage:async(...args)=>{sent.push(args);return {key:{id:'qr'}};}}};
 const ctx=vm.createContext({WHATSAPP_ENABLED:true,conectado:false,whatsappSocket:null,whatsappSessaoPorNumeroCliente:new Map([['5511999999999',7]]),whatsappSessoes:new Map([[7,preferred]]),isTgJid:j=>j.startsWith('tg:'),normalizarNumeroWhatsApp:x=>x,jidToNumber:x=>x,obterSessaoBotConectada:async()=>assert.fail('must reuse preferred session'),resolverJidWhatsAppEnvio:async(number,socket)=>{assert.equal(number,'5511999999999');assert.equal(socket,preferred.socket);return '12345@lid';}});
 const i=source.indexOf('async function heroSendPixImage('),j=source.indexOf('function heroReportCheckoutError(',i);
 vm.runInContext(source.slice(i,j),ctx);const image=Buffer.from('image');await ctx.heroSendPixImage('wa:5511999999999',image);
 assert.equal(sent.length,1);assert.equal(sent[0][0],'12345@lid');assert.equal(sent[0][1].image,image);
});
test('Pix QR image on Telegram uses the customer chat and buffer',async()=>{
 const sent=[];const ctx=vm.createContext({isTgJid:j=>j.startsWith('tg:'),tgIdFromJid:j=>j.slice(3),tgBot:{sendPhoto:async(...args)=>sent.push(args)}});
 const i=source.indexOf('async function heroSendPixImage('),j=source.indexOf('function heroReportCheckoutError(',i);
 vm.runInContext(source.slice(i,j),ctx);const image=Buffer.from('image');await ctx.heroSendPixImage('tg:123',image);assert.equal(sent[0][0],'123');assert.equal(sent[0][1],image);
});

test('Telegram cards shown over menu media update the caption and keyboard',async()=>{
 const f=fixture();f.ctx.tgBot.editMessageCaption=async(...args)=>f.sent.push(args);
 await f.ctx.heroEditOrderMessage({transport:'telegram',chatId:'123',messageId:77,kind:'caption'},{text:'Novo número: +5511888888888',buttons:[]});
 assert.equal(f.sent[0][1].message_id,77);assert.match(f.sent[0][0],/5511888888888/);
});
