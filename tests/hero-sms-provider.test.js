'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
const fragment=source.slice(source.indexOf('async function heroSmsV1('),source.indexOf('async function heroReplaceOrder('));
test('REST activation purchase transmits the documented body and ApiKey header once',async()=>{
 let calls=0;const ctx=vm.createContext({heroProtocol:require('../hero-sms-protocol'),heroSmsChave:async()=> 'test-key',axios:async opts=>{calls++;assert.equal(opts.url,'https://hero-sms.com/api/v1/activations');assert.equal(opts.method,'POST');assert.equal(opts.headers.Authorization,'ApiKey test-key');assert.equal(opts.data.amount,1);assert.equal(opts.data.country,73);return {status:200,data:{data:[{id:1,phone:5511999999999}]}};}});
 vm.runInContext(fragment,ctx);await ctx.heroSmsV1('POST','/activations',{service:'wa',country:73,amount:1,verificationType:'sms'});assert.equal(calls,1);
});
test('REST errors retain a safe provider reason and do not retry a failed purchase',async()=>{
 let calls=0;const ctx=vm.createContext({heroProtocol:require('../hero-sms-protocol'),heroSmsChave:async()=> 'test-key',axios:async()=>{calls++;return {status:404,data:{title:'BAD_ACTION',details:'Method Not Found',api_key:'do-not-log'}};}});
 vm.runInContext(fragment,ctx);await assert.rejects(ctx.heroSmsV1('POST','/activations',{}),e=>e.httpStatus===404&&e.message.includes('BAD_ACTION')&&!e.message.includes('do-not-log'));assert.equal(calls,1);
});
