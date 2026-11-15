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
