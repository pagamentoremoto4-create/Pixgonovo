'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sqlite3=require('sqlite3');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
function section(a,b){const i=source.indexOf(a);return source.slice(i,source.indexOf(b,i));}
async function fixture(t){
 const db=new sqlite3.Database(':memory:');t.after(()=>new Promise(resolve=>db.close(()=>resolve())));
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
 const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
 const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r)));
 await run('CREATE TABLE hero_sms_catalog(country TEXT,service TEXT,service_name TEXT,cost REAL,stock INTEGER,active INTEGER,PRIMARY KEY(country,service))');
 await run('CREATE TABLE hero_sms_country_names(id TEXT PRIMARY KEY,name TEXT)');
 await run("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<14999) INSERT INTO hero_sms_catalog SELECT CAST(x%200 AS TEXT),'s'||CAST(x/200 AS INTEGER),'App'||CAST(x/200 AS INTEGER),1,1,1 FROM n");
 await run("INSERT INTO hero_sms_country_names VALUES('73','Brazil')");
 let handler;
 const escape=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
 const ctx=vm.createContext({app:{get:(path,fn)=>handler=fn},all,get,run,heroCatalogInit:async()=>{},heroSmsBuscaTermo:t=>[t.toLowerCase()],getConfig:async(k,d)=>d,heroSmsVisivel:async()=>true,safeHtml:escape,brl:v=>'R$ '+Number(v).toFixed(2),page:(title,html)=>html,URLSearchParams});
 vm.runInContext(section('function heroSmsCategoria(',"app.get('/admin/herosms/catalogo',"),ctx);
 vm.runInContext(section("app.get('/admin/herosms/catalogo',","app.post('/admin/herosms/visibilidade',"),ctx);
 async function render(query={}){let html,status=200;await handler({query},{send:v=>html=v,status:v=>{status=v;return {send:v=>html=v};}});assert.equal(status,200,html);return html;}
 return {render};
}
test('large catalog renders only 100 offers while retaining totals from all 15000 records',async t=>{
 const f=await fixture(t),html=await f.render();
 assert.equal((html.match(/name="service"/g)||[]).length,100);assert.match(html,/15\.000<\/b> ofertas importadas/);assert.match(html,/Página 1 de 150/);assert.ok(html.length<200000);
});
test('server search finds offers after the first ten thousand and paginates their countries',async t=>{
 const f=await fixture(t),first=await f.render({q:'App74'}),second=await f.render({q:'App74',p:'2'});
 assert.match(first,/App74/);assert.match(first,/Página 1 de 2/);assert.match(second,/Página 2 de 2/);
 assert.equal((second.match(/name="service"/g)||[]).length,100);
});
test('country aliases work and malicious search text is escaped without changing the query',async t=>{
 const f=await fixture(t),country=await f.render({q:'Brasil'});assert.match(country,/75 ofertas encontradas/);
 const html=await f.render({q:'<script>alert(1)</script>'});assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('&lt;script&gt;'));assert.match(html,/0 ofertas encontradas/);
});
