'use strict';
const sqlite3=require('sqlite3');
function heroValidCountry(value){return /^\d{1,3}$/.test(String(value))&&Number(value)>=0&&Number(value)<=999;}
function heroCountryLabel(id,name){return String(id)==='73'?'Brasil':String(name||'').trim()||'País #'+String(id);}
function parseSmsOffers(response){
 if(!response||typeof response!=='object'||!response.data||typeof response.data!=='object'||Array.isArray(response.data))throw new Error('Resposta de ofertas Hero SMS inválida; catálogo preservado.');
 if(response.meta?.hasMore===true)throw new Error('Resposta parcial de ofertas; catálogo preservado.');
 const data=response.data;
 if(Object.keys(data).length&&!Object.prototype.hasOwnProperty.call(data,'wa'))throw new Error('Resposta sem ofertas WhatsApp; catálogo preservado.');
 if(Object.prototype.hasOwnProperty.call(data,'wa')&&data.wa===null)throw new Error('Ofertas WhatsApp inválidas; catálogo preservado.');
 const countries=data.wa||{};
 if(typeof countries!=='object'||Array.isArray(countries))throw new Error('Países da oferta em formato inválido.');
 const result=[];
 for(const [id,offer] of Object.entries(countries)){
  const rawCost=offer?.prices?.default??offer?.prices?.retail??offer?.prices?.min;
  const rawStock=offer?.counts?.total;
  if(!heroValidCountry(id)||rawCost==null||rawCost===''||rawStock==null||rawStock==='')throw new Error('Oferta incompleta; catálogo anterior preservado.');
  const cost=Number(rawCost),stock=Number(rawStock);
  if(!Number.isFinite(cost)||cost<0||!Number.isSafeInteger(stock)||stock<0)throw new Error('Preço ou estoque da oferta inválido.');
  result.push({country:String(Number(id)),service:'wa',cost,stock});
 }
 return result;
}
async function syncCountryOffers(filename,{offers,names={}}){
 if(!Array.isArray(offers))throw new TypeError('Ofertas ausentes.');
 const db=new sqlite3.Database(filename);db.configure('busyTimeout',10000);
 const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
 let transaction=false;
 try{
  await run('BEGIN IMMEDIATE');transaction=true;
  await run(`CREATE TABLE IF NOT EXISTS hero_sms_catalog(country TEXT NOT NULL,service TEXT NOT NULL,service_name TEXT,cost REAL NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(country,service))`);
  await run('CREATE TABLE IF NOT EXISTS hero_sms_country_names(id TEXT PRIMARY KEY,name TEXT NOT NULL)');
  await run('CREATE TABLE IF NOT EXISTS hero_sms_country_settings(country TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await run('CREATE TABLE IF NOT EXISTS hero_sms_country_sync(id INTEGER PRIMARY KEY,last_success_at TEXT NOT NULL,offers INTEGER NOT NULL)');
  await run("INSERT OR IGNORE INTO hero_sms_country_settings(country,enabled) VALUES('73',1)");
  for(const [id,name] of Object.entries(names))if(heroValidCountry(id)&&String(name).trim())await run('INSERT INTO hero_sms_country_names(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',[String(Number(id)),String(name).trim().slice(0,120)]);
  // This is a complete snapshot only for SMS/WhatsApp. Other service catalogs and
  // every administrator visibility choice are left intact.
  await run("UPDATE hero_sms_catalog SET stock=0,updated_at=CURRENT_TIMESTAMP WHERE LOWER(service)='wa'");
  for(const offer of offers){
   if(!heroValidCountry(offer.country)||offer.service!=='wa'||!Number.isFinite(offer.cost)||offer.cost<0||!Number.isSafeInteger(offer.stock)||offer.stock<0)throw new Error('Oferta inválida durante sincronização.');
   const id=String(Number(offer.country));
   await run('INSERT OR IGNORE INTO hero_sms_country_settings(country,enabled) VALUES(?,0)',[id]);
   await run(`INSERT INTO hero_sms_catalog(country,service,service_name,cost,stock,active) VALUES(?,'wa','WhatsApp',?,?,1) ON CONFLICT(country,service) DO UPDATE SET service_name='WhatsApp',cost=excluded.cost,stock=excluded.stock,updated_at=CURRENT_TIMESTAMP`,[id,offer.cost,offer.stock]);
  }
  await run('INSERT INTO hero_sms_country_sync(id,last_success_at,offers) VALUES(1,CURRENT_TIMESTAMP,?) ON CONFLICT(id) DO UPDATE SET last_success_at=CURRENT_TIMESTAMP,offers=excluded.offers',[offers.length]);
  await run('COMMIT');transaction=false;return {offers:offers.length,withStock:offers.filter(o=>o.stock>0).length};
 }catch(e){if(transaction)await run('ROLLBACK').catch(()=>{});throw e;}
 finally{await new Promise(resolve=>db.close(()=>resolve()));}
}
module.exports={heroValidCountry,heroCountryLabel,parseSmsOffers,syncCountryOffers};
