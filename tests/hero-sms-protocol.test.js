'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const protocol=require('../hero-sms-protocol');
test('replace: parses documented REST data array for the exact activation',()=>{
  assert.deepEqual(protocol.parseReplacement({data:[{id:123,phone:'5511999999999'}]},'123'),{activationId:'123',phone:'5511999999999'});
  assert.throws(()=>protocol.parseReplacement({data:[{id:999,phone:'5511999999999'}]},'123'));
  assert.throws(()=>protocol.parseReplacement({data:[]},'123'));
  assert.throws(()=>protocol.parseReplacement({data:[{id:123,phone:null}]},'123'));
  assert.throws(()=>protocol.parseReplacement({data:[{id:123,phone:'5511999999999'},{id:123,phone:'5511888888888'}]},'123'));
});
test('SMS: documented REST otpLast, V2 and compatibility text retain leading zeros',()=>{
  assert.equal(protocol.smsCode({otpLast:{smsCode:'012345',type:'sms'}}),'012345');
  assert.equal(protocol.smsCode({verificationType:'sms',data:{code:'012345',type:'sms'}}),'012345');
  assert.equal(protocol.smsCode('STATUS_OK:012345'),'012345');
  assert.equal(protocol.smsCode('STATUS_WAIT_CODE'),null);
  assert.equal(protocol.smsCode({otpLast:null}),null);
  assert.equal(protocol.smsCode({otpLast:{smsCode:'12345',type:'voice'}}),null);
});
test('history: extracts an OTP embedded in text without truncating long numbers',()=>{
  assert.equal(protocol.historySmsCode('WhatsApp: 012345 is your verification code'),'012345');
  assert.equal(protocol.historySmsCode('123456'),'123456');
  assert.equal(protocol.historySmsCode('Phone 5511999999999'),null);
  assert.equal(protocol.historySmsCode(null),null);
});
test('pagination: uses hasMore or total, and tolerates absent metadata',()=>{
  assert.equal(protocol.hasMore({meta:{hasMore:false,total:100}},1,25,25),false);
  assert.equal(protocol.hasMore({meta:{total:26}},1,25,25),true);
  assert.equal(protocol.hasMore({meta:{total:26}},2,25,1),false);
  assert.equal(protocol.hasMore({},1,25,25),true);
  assert.equal(protocol.hasMore({},1,25,3),false);
});

test('API dates use the documented UTC second precision, without milliseconds',()=>{
  assert.equal(protocol.apiDate('2026-11-15T00:54:22.336Z'),'2026-11-15T00:54:22Z');
  assert.throws(()=>protocol.apiDate('not a date'));
});
