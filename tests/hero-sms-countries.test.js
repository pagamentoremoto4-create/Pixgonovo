'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const sqlite=require('sqlite3');
const {parseSmsOffers,syncCountryOffers,heroValidCountry}=require('../hero-sms-countries');
const offer=(country,stock=20)=>({country,service:'wa',cost:1,stock});
test('documented offers parse country zero and reject partial or malformed snapshots',()=>{
 assert.deepEqual(parseSmsOffers({data:{wa:{0:{prices:{default:1},counts:{total:2}}}},meta:{hasMore:false}}),[{country:'0',service:'wa',cost:1,stock:2}]);
 assert.equal(heroValidCountry('0'),true);assert.equal(heroValidCountry('-1'),false);
 for(const response of [{data:{wa:null}},{data:{wa:{73:{}}}},{data:{wa:{}},meta:{hasMore:true}},{data:{tg:{}}}])assert.throws(()=>parseSmsOffers(response));
 assert.deepEqual(parseSmsOffers({data:{}}),[]);
});
test('sync preserves visibility, hides new countries, updates names and atomically rolls back invalid snapshots',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hero-countries-'));const filename=path.join(dir,'test.db');
 let db;
 try{
 await syncCountryOffers(filename,{offers:[offer('73'),offer('0')],names:{73:'Brazil',0:'Russia'}});
 db=new sqlite.Database(filename);
 const run=(sql,args=[])=>new Promise((res,rej)=>db.run(sql,args,e=>e?rej(e):res()));
 const get=(sql,args=[])=>new Promise((res,rej)=>db.get(sql,args,(e,r)=>e?rej(e):res(r)));
 assert.equal((await get("SELECT enabled FROM hero_sms_country_settings WHERE country='73'")).enabled,1);
 assert.equal((await get("SELECT enabled FROM hero_sms_country_settings WHERE country='0'")).enabled,0);
 await run("UPDATE hero_sms_country_settings SET enabled=0 WHERE country='73'");
 await run("UPDATE hero_sms_catalog SET active=0 WHERE country='73'");
 await run("INSERT INTO hero_sms_catalog(country,service,stock) VALUES('73','tg',42)");
 await syncCountryOffers(filename,{offers:[offer('73',30),offer('1')],names:{1:'Ukraine'}});
 assert.equal((await get("SELECT enabled FROM hero_sms_country_settings WHERE country='73'")).enabled,0);
 assert.equal((await get("SELECT active FROM hero_sms_catalog WHERE country='73' AND service='wa'")).active,0);
 assert.equal((await get("SELECT stock FROM hero_sms_catalog WHERE country='0'")).stock,0);
 assert.equal((await get("SELECT stock FROM hero_sms_catalog WHERE service='tg'")).stock,42);
 assert.equal((await get("SELECT name FROM hero_sms_country_names WHERE id='1'")).name,'Ukraine');
 await assert.rejects(syncCountryOffers(filename,{offers:[offer('73',999),offer('bad')]}));
 assert.equal((await get("SELECT stock FROM hero_sms_catalog WHERE country='73' AND service='wa'")).stock,30);
 }finally{if(db)await new Promise(r=>db.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('WhatsApp and Telegram selectors paginate enabled countries and preserve customer pricing',async()=>{
 const vm=require('node:vm');const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
 const start=source.indexOf('async function heroSmsWaPaises('),end=source.indexOf('// Hero SMS: checkout with',start);
 const rows=Array.from({length:23},(_,i)=>({country:String(i),service:'wa',pais:'Country '+i,preco:25,stock:10}));
 let session,text,keyboard;const context=vm.createContext({heroSmsVisivel:async()=>true,heroSmsVitrine:async(_,key)=>key?rows.filter(r=>r.country===key.country):rows,get:async()=>({saldo:50}),heroPrecoCliente:async id=>id===7?19:25,brl:n=>'R$ '+n,salvarSessaoPedido:async(_,s)=>session=s,enviarTexto:async(_,s)=>text=s,tgBtn:(label,callback)=>({text:label,callback_data:callback}),atualizarCardTelegram:async(_,__,s,k)=>{text=s;keyboard=k;}});
 vm.runInContext(source.slice(start,end),context);
 await context.heroSmsWaPaises('client','WhatsApp','preco_asc',2,{id:7});
 assert.equal(session.heroPaises.length,3);assert.equal(session.heroPaises[0].country,'20');assert.match(text,/R\$ 19/);
 await context.heroTelegramPaises(1,{},'client',{id:7},1);
 assert.equal(session.heroKeys.length,10);assert.equal(session.heroKeys[0].country,'10');assert.match(keyboard[0][0].text,/R\$ 19/);
 await context.heroSmsWaOferta('client',{country:'3',service:'wa'},{id:7});
 assert.equal(session.heroOferta.country,'3');assert.match(text,/Country 3/);assert.match(text,/R\$ 19/);assert.doesNotMatch(text,/DDD aleatório/);
 await context.heroSmsWaOferta('client',{country:'999',service:'wa'},{id:7});assert.match(text,/desativado ou sem estoque/);
});
