'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const BASE = 'https://ggsoma.store/api/partner/v1';
module.exports = function createGgsoma(d) {
  const {run,get,all,getConfig,setConfig,axios,DATA_DIR}=d;
  const locks=new Set(); let timer, running=false, lastSyncTry=0, nextPost=0, postQueue=Promise.resolve();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function key(){
    const file=path.join(DATA_DIR,'ggsoma-secret.key');
    fs.mkdirSync(DATA_DIR,{recursive:true});
    try{fs.writeFileSync(file,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    const k=fs.readFileSync(file);if(k.length!==32)throw new Error('Chave local GGSOMA inválida.');return k;
  }
  function encrypt(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);return JSON.stringify([iv.toString('base64'),Buffer.concat([c.update(String(s),'utf8'),c.final()]).toString('base64'),c.getAuthTag().toString('base64')]);}
  function decrypt(s){if(!s)return '';const [iv,v,t]=JSON.parse(s),c=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));c.setAuthTag(Buffer.from(t,'base64'));return Buffer.concat([c.update(Buffer.from(v,'base64')),c.final()]).toString('utf8');}
  async function request(method,url,data){
    const token=decrypt(await getConfig('ggsoma_key',''));
    if(!token)throw Object.assign(new Error('Cadastre a chave GGSOMA no painel.'),{code:'NOT_CONFIGURED'});
    try{const r=await axios({method,url:BASE+url,headers:{Authorization:'Bearer '+token},data,timeout:25000,maxRedirects:0});
      if(r.data?.ok===false)throw Object.assign(new Error('Falha GGSOMA'),{response:{status:400,data:r.data}});return r.data;
    }catch(e){const code=e.response?.data?.error?.code|| (e.response?.status>=500?'TEMPORARY':'UNKNOWN');throw Object.assign(new Error(code),{code,httpStatus:e.response?.status,requestId:e.response?.data?.error?.requestId||''});}
  }
  async function postOrder(body){
    const task=postQueue.then(async()=>{
      const delay=Math.max(0,nextPost-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));
      nextPost=Date.now()+(d.orderIntervalMs??6500);return request('post','/orders',body);
    });postQueue=task.catch(()=>{});return task;
  }
  async function init(){
    await run(`CREATE TABLE IF NOT EXISTS ggsoma_products(slug TEXT PRIMARY KEY,catalogo_id INTEGER UNIQUE,json TEXT NOT NULL,present INTEGER DEFAULT 1)`);
    await d.addColumnIfMissing('ggsoma_products','custom_title','TEXT');
    await d.addColumnIfMissing('ggsoma_products','custom_description','TEXT');
    await d.addColumnIfMissing('ggsoma_products','image_path','TEXT');
    await d.addColumnIfMissing('ggsoma_products','stock_count','INTEGER DEFAULT 0');
    await d.addColumnIfMissing('ggsoma_products','announced_new','INTEGER DEFAULT 0');
    await d.addColumnIfMissing('ggsoma_products','last_announcement_at','TEXT');
    await d.addColumnIfMissing('ggsoma_products','blocked_auto','INTEGER DEFAULT 0');
    await d.addColumnIfMissing('ggsoma_products','custom_profit','REAL');
    await run(`CREATE TABLE IF NOT EXISTS ggsoma_announcement_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT NOT NULL,event_type TEXT NOT NULL,stock_before INTEGER DEFAULT 0,stock_after INTEGER DEFAULT 0,status TEXT DEFAULT 'PENDING',created_at TEXT DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,error TEXT)`);
    if(!await getConfig('ggsoma_profit_default',''))await setConfig('ggsoma_profit_default','25');
    if(!await getConfig('ggsoma_auto_stock',''))await setConfig('ggsoma_auto_stock','1');
    if(!await getConfig('ggsoma_ads_enabled',''))await setConfig('ggsoma_ads_enabled','1');
    if(!await getConfig('ggsoma_ads_new',''))await setConfig('ggsoma_ads_new','1');
    if(!await getConfig('ggsoma_ads_restock',''))await setConfig('ggsoma_ads_restock','1');
    if(!await getConfig('ggsoma_ads_return',''))await setConfig('ggsoma_ads_return','1');
    if(!await getConfig('ggsoma_ads_min_restock',''))await setConfig('ggsoma_ads_min_restock','10');
    if(!await getConfig('ggsoma_ads_interval_min',''))await setConfig('ggsoma_ads_interval_min','15');
    await run(`CREATE TABLE IF NOT EXISTS ggsoma_orders(pedido_id INTEGER PRIMARY KEY,external_id TEXT UNIQUE NOT NULL,request_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'NEW',order_code TEXT,delivery_enc TEXT,error TEXT,request_id TEXT,attempts INTEGER DEFAULT 0,next_try INTEGER DEFAULT 0,notified INTEGER DEFAULT 0)`);
    await run(`CREATE TABLE IF NOT EXISTS shared_ggsoma_orders(external_id TEXT PRIMARY KEY,slug TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'NEW',order_code TEXT,delivery_enc TEXT,error TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await d.addColumnIfMissing('pedidos','ggsoma_checkout_token','TEXT');
    await run('CREATE UNIQUE INDEX IF NOT EXISTS ggsoma_checkout_unique ON pedidos(ggsoma_checkout_token)');
    await run(`CREATE TRIGGER IF NOT EXISTS ggsoma_checkout_reserve AFTER INSERT ON pedidos
      WHEN NEW.cobrado=1 AND NEW.ggsoma_checkout_token IS NOT NULL AND EXISTS(SELECT 1 FROM servicos_catalogo WHERE id=NEW.servico_id AND api_provider='GGSOMA')
      BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revendas WHERE id=NEW.revenda_id AND saldo>=NEW.valor) THEN RAISE(ABORT,'GGSOMA_CUSTOMER_BALANCE') END;
      UPDATE revendas SET saldo=saldo-NEW.valor WHERE id=NEW.revenda_id; END`);
    await run(`CREATE TRIGGER IF NOT EXISTS ggsoma_reserve BEFORE UPDATE OF cobrado ON pedidos
      WHEN NEW.cobrado=1 AND COALESCE(OLD.cobrado,0)=0 AND EXISTS(SELECT 1 FROM servicos_catalogo WHERE id=NEW.servico_id AND api_provider='GGSOMA')
      BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revendas WHERE id=NEW.revenda_id AND saldo>=NEW.valor) THEN RAISE(ABORT,'GGSOMA_CUSTOMER_BALANCE') END;
      UPDATE revendas SET saldo=saldo-NEW.valor WHERE id=NEW.revenda_id; END`);
    await run(`CREATE TRIGGER IF NOT EXISTS ggsoma_refund AFTER UPDATE OF estornado ON pedidos
      WHEN NEW.estornado=1 AND COALESCE(OLD.estornado,0)=0 AND OLD.cobrado=1 AND EXISTS(SELECT 1 FROM servicos_catalogo WHERE id=NEW.servico_id AND api_provider='GGSOMA')
      BEGIN UPDATE revendas SET saldo=saldo+OLD.valor WHERE id=OLD.revenda_id; END`);
    await run(`CREATE TRIGGER IF NOT EXISTS ggsoma_status_guard BEFORE UPDATE OF status ON pedidos
      WHEN NEW.status!=OLD.status AND EXISTS(SELECT 1 FROM servicos_catalogo WHERE id=NEW.servico_id AND api_provider='GGSOMA')
      BEGIN SELECT CASE WHEN NEW.status='FINALIZADO' AND NOT EXISTS(SELECT 1 FROM ggsoma_orders WHERE pedido_id=NEW.id AND state='COMPLETED') THEN RAISE(ABORT,'GGSOMA_WAIT_DELIVERY') END;
      SELECT CASE WHEN NEW.status='CANCELADO' AND EXISTS(SELECT 1 FROM ggsoma_orders WHERE pedido_id=NEW.id AND state!='FAILED') THEN RAISE(ABORT,'GGSOMA_WAIT_RECONCILIATION') END; END`);
    if(!await getConfig('ggsoma_namespace',''))await setConfig('ggsoma_namespace',crypto.randomUUID());
    if(!timer){timer=setInterval(()=>tick().catch(()=>{}),15000);timer.unref();}
  }
  async function effectiveUsdBrl(){
    let v=Number(String(await getConfig('ggsoma_usd_brl','0')).replace(',','.'))||0;
    if(v<=0)v=Number(String(await getConfig('dhru_usd_brl','0')).replace(',','.'))||0;
    return v;
  }
  async function salePrice(product,row){
    const usd=await effectiveUsdBrl(); if(usd<=0)return 0;
    const profit=Number(row?.custom_profit ?? await getConfig('ggsoma_profit_default','25'))||25;
    return Math.ceil((Number(product.yourPrice||0)*usd+profit)*100)/100;
  }
  async function ensureCatalogProduct(row,p,enabled,price){
    let catalog=null;
    if(row?.catalogo_id)catalog=await get(`SELECT id FROM servicos_catalogo WHERE id=? AND api_provider='GGSOMA'`,[row.catalogo_id]);
    if(!catalog)catalog=await get(`SELECT id FROM servicos_catalogo WHERE api_provider='GGSOMA' AND api_service_id=? ORDER BY id DESC LIMIT 1`,[p.slug]);
    if(!catalog){
      const x=await run(`INSERT INTO servicos_catalogo(nome,preco_padrao,tipo_entrada,entrada_label,ativo,categoria,descricao,prazo,api_provider,api_service_id,api_cost,api_auto,cancelamento_permitido) VALUES(?,?,'TEXTO','Compra',?,?,?,'Entrega automática','GGSOMA',?,?,1,0)`,[p.name,price,enabled?1:0,'Produtos digitais / '+(p.provider?.name||'GGSOMA'),`Duração: ${p.durationDays||'consulte'} dias. Garantia: ${p.warranty?.enabled?p.warranty.days+' dias':'conforme produto'}.`,p.slug,Number(p.yourPrice)]); catalog={id:x.lastID};
    }else await run(`UPDATE servicos_catalogo SET nome=?,preco_padrao=?,ativo=?,api_service_id=?,api_cost=?,api_auto=1,cancelamento_permitido=0 WHERE id=?`,[p.name,price,enabled?1:0,p.slug,Number(p.yourPrice),catalog.id]);
    if(Number(row?.catalogo_id)!==Number(catalog.id))await run('UPDATE ggsoma_products SET catalogo_id=? WHERE slug=?',[catalog.id,p.slug]);
    return catalog.id;
  }
  async function queueAd(slug,type,before,after){
    const map={NEW:'ggsoma_ads_new',RETURN:'ggsoma_ads_return',RESTOCK:'ggsoma_ads_restock'};
    if(await getConfig('ggsoma_ads_enabled','1')!=='1'||await getConfig(map[type],'1')!=='1')return;
    const exists=await get(`SELECT id FROM ggsoma_announcement_queue WHERE slug=? AND event_type=? AND status IN ('PENDING','SENDING')`,[slug,type]);
    if(!exists)await run(`INSERT INTO ggsoma_announcement_queue(slug,event_type,stock_before,stock_after) VALUES(?,?,?,?)`,[slug,type,before,after]);
  }
  async function sync(){
    const payload=await request('get','/catalog/products');
    if(!Array.isArray(payload.data))throw new Error('Catálogo inválido.');
    const auto=await getConfig('ggsoma_auto_stock','1')==='1', minRestock=Math.max(1,Number(await getConfig('ggsoma_ads_min_restock','10'))||10);
    for(const p of payload.data){
      if(!p.slug||!['LINK','COUPON','READY_ACCOUNT'].includes(p.deliveryType)||!Number.isFinite(Number(p.yourPrice)))continue;
      const old=await get('SELECT * FROM ggsoma_products WHERE slug=?',[p.slug]); const before=Number(old?.stock_count||0), after=Number(p.stock?.count||0), inStock=!!p.stock?.inStock&&after>0;
      await run(`INSERT INTO ggsoma_products(slug,json,present,stock_count) VALUES(?,?,1,?) ON CONFLICT(slug) DO UPDATE SET json=excluded.json,present=1,stock_count=excluded.stock_count`,[p.slug,JSON.stringify(p),after]);
      const row=await get('SELECT * FROM ggsoma_products WHERE slug=?',[p.slug]);
      const price=await salePrice(p,row); const enabled=auto&&inStock&&!Number(row.blocked_auto)&&price>0;
      if(price>0)await ensureCatalogProduct(row,p,enabled,price); else if(row.catalogo_id)await run(`UPDATE servicos_catalogo SET api_cost=?,ativo=0 WHERE id=?`,[Number(p.yourPrice),row.catalogo_id]);
      if(!old && inStock){await queueAd(p.slug,'NEW',0,after);await run('UPDATE ggsoma_products SET announced_new=1 WHERE slug=?',[p.slug]);}
      else if(old && before===0 && after>0)await queueAd(p.slug,'RETURN',before,after);
      else if(old && before>0 && after-before>=minRestock)await queueAd(p.slug,'RESTOCK',before,after);
    }
    const slugs=new Set(payload.data.map(p=>p.slug));
    for(const p of await all('SELECT slug,catalogo_id FROM ggsoma_products'))if(!slugs.has(p.slug)){await run('UPDATE ggsoma_products SET present=0,stock_count=0 WHERE slug=?',[p.slug]);if(p.catalogo_id)await run('UPDATE servicos_catalogo SET ativo=0 WHERE id=?',[p.catalogo_id]);}
    await setConfig('ggsoma_sync',new Date().toISOString());return payload.data.length;
  }
  async function sendNextAd(){
    if(await getConfig('ggsoma_ads_enabled','1')!=='1'||!d.sendWhatsAppGroup)return;
    const group=String(await getConfig('ggsoma_ads_wa_group','')).trim(); if(!group)return;
    const last=Date.parse(await getConfig('ggsoma_ads_last_sent','')||'')||0, interval=Math.max(1,Number(await getConfig('ggsoma_ads_interval_min','15'))||15)*60000;
    if(last&&Date.now()-last<interval)return;
    const q=await get(`SELECT * FROM ggsoma_announcement_queue WHERE status='PENDING' ORDER BY id LIMIT 1`); if(!q)return;
    const row=await get(`SELECT g.*,s.preco_padrao,s.ativo FROM ggsoma_products g LEFT JOIN servicos_catalogo s ON s.id=g.catalogo_id WHERE g.slug=?`,[q.slug]); if(!row||!Number(row.ativo)){await run(`UPDATE ggsoma_announcement_queue SET status='SKIPPED',error='Produto indisponível' WHERE id=?`,[q.id]);return;}
    const p=JSON.parse(row.json||'{}'), title=q.event_type==='NEW'?'🆕 *NOVO PRODUTO DISPONÍVEL*':q.event_type==='RETURN'?'🔥 *VOLTOU AO ESTOQUE!*':'📦 *ESTOQUE REFORÇADO*';
    const name=row.custom_title||p.name||q.slug, price=Number(row.preco_padrao||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const salesNumber=d.getWhatsAppSalesNumber?String(await d.getWhatsAppSalesNumber()||'').replace(/\D/g,''):'';
    const buyText=`Comprar P${Number(row.catalogo_id||0)}`;
    const buyUrl=salesNumber&&Number(row.catalogo_id)>0?`https://wa.me/${salesNumber}?text=${encodeURIComponent(buyText)}`:'';
    let text=`${title}\n\n⭐ *${name}*\n⚡ Entrega automática\n📦 Estoque: *${Number(q.stock_after||0)}*\n💰 *${price}*`;
    if(q.event_type==='RESTOCK')text+=`\n📈 Reposição: *+${Math.max(0,Number(q.stock_after)-Number(q.stock_before))} unidades*`;
    if(buyUrl)text+=`\n\n🛒 *COMPRAR AGORA:*\n${buyUrl}`;
    try{await run(`UPDATE ggsoma_announcement_queue SET status='SENDING' WHERE id=?`,[q.id]);await d.sendWhatsAppGroup(group,text,row.image_path||'');await run(`UPDATE ggsoma_announcement_queue SET status='SENT',sent_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?`,[q.id]);await run(`UPDATE ggsoma_products SET last_announcement_at=CURRENT_TIMESTAMP WHERE slug=?`,[q.slug]);await setConfig('ggsoma_ads_last_sent',new Date().toISOString());}catch(e){await run(`UPDATE ggsoma_announcement_queue SET status='PENDING',error=? WHERE id=?`,[String(e.message||e).slice(0,300),q.id]);}
  }
  async function saveProduct(slug,price,enabled){
    price=Number(String(price).replace(',','.'));if(!Number.isFinite(price)||price<=0)throw new Error('Informe um preço de venda maior que zero.');
    const row=await get('SELECT * FROM ggsoma_products WHERE slug=?',[slug]);if(!row)throw new Error('Produto não encontrado.');
    const p=JSON.parse(row.json);if(enabled&&!row.present)throw new Error('Produto removido do catálogo. Sincronize novamente.');
    // A product may keep an old catalogo_id after previous migrations/removals. In that case
    // UPDATE would affect zero rows, making the checkbox look saved but immediately uncheck again.
    // Resolve the catalog entry by both the stored id and the stable GGSOMA slug, and recreate it
    // only when neither exists. This is especially important for long-lived products such as Gemini.
    let catalog=null;
    if(row.catalogo_id)catalog=await get(`SELECT id FROM servicos_catalogo WHERE id=? AND api_provider='GGSOMA'`,[row.catalogo_id]);
    if(!catalog)catalog=await get(`SELECT id FROM servicos_catalogo WHERE api_provider='GGSOMA' AND api_service_id=? ORDER BY id DESC LIMIT 1`,[slug]);
    if(!catalog){
      const s=await run(`INSERT INTO servicos_catalogo(nome,preco_padrao,tipo_entrada,entrada_label,ativo,categoria,descricao,prazo,api_provider,api_service_id,api_cost,api_auto,cancelamento_permitido) VALUES(?,?,'TEXTO','Compra',?,?,?,'Entrega automática','GGSOMA',?,?,1,0)`,[p.name,price,enabled?1:0,'Produtos digitais / '+(p.provider?.name||'GGSOMA'),`Duração: ${p.durationDays||'consulte'} dias. Garantia: ${p.warranty?.enabled?p.warranty.days+' dias':'conforme produto'}.`,slug,Number(p.yourPrice)]);
      catalog={id:s.lastID};
    }else{
      await run(`UPDATE servicos_catalogo SET nome=?,preco_padrao=?,ativo=?,api_service_id=?,api_cost=?,api_auto=1,cancelamento_permitido=0 WHERE id=?`,[p.name,price,enabled?1:0,slug,Number(p.yourPrice),catalog.id]);
    }
    if(Number(row.catalogo_id)!==Number(catalog.id))await run('UPDATE ggsoma_products SET catalogo_id=? WHERE slug=?',[catalog.id,slug]);
    // Verify persistence so the panel never reports success when the sale flag was not actually saved.
    const saved=await get(`SELECT ativo FROM servicos_catalogo WHERE id=? AND api_provider='GGSOMA'`,[catalog.id]);
    if(!saved||Number(saved.ativo)!==(enabled?1:0))throw new Error('Não foi possível salvar o status de venda deste produto.');
  }
  function deliveryText(response){
    const items=Array.isArray(response.lines)?response.lines:[response.delivery];
    return items.map(x=>{if(!x)return '';return [x.link||x.code||x.content,x.instructions].filter(Boolean).join('\n\n');}).filter(Boolean).join('\n\n');
  }
  async function purchase(client,service,destination,token=crypto.randomUUID()){
    if(await getConfig('ggsoma_enabled','0')!=='1')throw new Error('A venda de produtos digitais está temporariamente desativada.');
    const active=await get("SELECT id FROM servicos_catalogo WHERE id=? AND ativo=1 AND api_provider='GGSOMA'",[service.id]);
    if(!active)throw new Error('Produto indisponível.');
    const old=await get('SELECT id,revenda_id FROM pedidos WHERE ggsoma_checkout_token=?',[token]);
    if(old){if(old.revenda_id!==client.id)throw new Error('Pedido inválido.');await execute(old.id);return old.id;}
    const price=await d.precoDaRevenda(client.id,service.id);
    if(!Number.isFinite(Number(price))||price<=0)throw new Error('Preço do produto inválido.');
    await run(`INSERT OR IGNORE INTO pedidos(tipo,revenda_id,revenda_nome,revenda_jid,servico_id,servico_nome,entrada_valor,tipo_entrada,entrada_label,valor,status,cobrado,ggsoma_checkout_token) VALUES('REVENDA',?,?,?,?,?,'Compra digital','TEXTO','Compra',?,'PENDENTE',1,?)`,[client.id,client.nome,destination,service.id,service.nome,price,token]);
    const created=await get('SELECT id FROM pedidos WHERE ggsoma_checkout_token=?',[token]);
    await execute(created.id);return created.id;
  }
  async function execute(id){
    if(locks.has(id))return;locks.add(id);
    try{
      let p=await get(`SELECT p.*,s.api_provider,s.api_service_id FROM pedidos p JOIN servicos_catalogo s ON s.id=p.servico_id WHERE p.id=?`,[id]);
      if(!p||p.api_provider!=='GGSOMA'||p.status==='CANCELADO')return;
      let o=await get('SELECT * FROM ggsoma_orders WHERE pedido_id=?',[id]);
      if(o?.state==='FAILED'){await settleFailure(p,o.error||'FAILED');return;}
      if(!o){
        if(p.status==='FINALIZADO')return;
        const ext='cu-'+await getConfig('ggsoma_namespace','')+'-'+id;
        await run(`INSERT OR IGNORE INTO ggsoma_orders(pedido_id,external_id,request_json) VALUES(?,?,?)`,[id,ext,JSON.stringify({productSlug:p.api_service_id,quantity:1,externalOrderId:ext})]);
        o=await get('SELECT * FROM ggsoma_orders WHERE pedido_id=?',[id]);
      }
      if(o.state==='COMPLETED'){await complete(p,o);return;}
      if(await getConfig('ggsoma_enabled','0')!=='1'||o.next_try>Date.now())return;
      // All paths reserve payment before buying. This includes postpaid resellers.
      if(!Number(p.cobrado)){
        const balance=await get('SELECT saldo FROM revendas WHERE id=?',[p.revenda_id]);
        if(!balance||Number(balance.saldo)<Number(p.valor)){await run(`UPDATE ggsoma_orders SET error='Saldo do cliente insuficiente',next_try=? WHERE pedido_id=?`,[Date.now()+60000,id]);return;}
        await run('UPDATE pedidos SET cobrado=1 WHERE id=?',[id]);p.cobrado=1;
      }
      await run(`UPDATE pedidos SET status='EM PROCESSO',atualizado_em=CURRENT_TIMESTAMP WHERE id=?`,[id]);
      await run(`UPDATE ggsoma_orders SET state='SENDING',attempts=attempts+1 WHERE pedido_id=?`,[id]);
      try{
        // Pre-check only before the first attempt: unresolved attempts must retry the exact saved body.
        if(!o.attempts){
          const health=await axios({method:'get',url:BASE+'/health',timeout:15000,maxRedirects:0});
          if(!health.data?.ok)throw Object.assign(new Error('MAINTENANCE'),{code:'MAINTENANCE'});
          const product=await request('get','/catalog/products/'+encodeURIComponent(p.api_service_id));
          const card=product.data&&!Array.isArray(product.data)?product.data:product;
          if(!card.stock?.inStock)throw Object.assign(new Error('OUT_OF_STOCK'),{code:'OUT_OF_STOCK',httpStatus:400});
          const balance=await request('get','/balance');
          if(Number(balance.balance)<Number(card.yourPrice))throw Object.assign(new Error('INSUFFICIENT_BALANCE'),{code:'INSUFFICIENT_BALANCE',httpStatus:400});
        }
        const resp=await postOrder(JSON.parse(o.request_json));
        const text=deliveryText(resp);
        if(resp.status!=='COMPLETED'||!resp.orderCode||!text)throw Object.assign(new Error('UNRESOLVED'),{code:'UNRESOLVED'});
        await run(`UPDATE ggsoma_orders SET state='COMPLETED',order_code=?,delivery_enc=?,error=NULL,next_try=0 WHERE pedido_id=?`,[resp.orderCode,encrypt(text),id]);
      }catch(e){
        const definite=['OUT_OF_STOCK','INSUFFICIENT_BALANCE','PRODUCT_NOT_FOUND','PRODUCT_NOT_ALLOWED','PRODUCT_UNAVAILABLE','UNSUPPORTED_DELIVERY_TYPE','INVALID_QUANTITY','VALIDATION_ERROR'].includes(e.code);
        await run(`UPDATE ggsoma_orders SET state=?,error=?,request_id=?,next_try=? WHERE pedido_id=?`,[definite?'FAILED':'RETRY',e.code||'TEMPORARY',e.requestId||'',Date.now()+Math.min(900000,15000*2**Math.min(o.attempts,6)),id]);
        if(definite)await settleFailure(p,e.code);
        return;
      }
      await complete(p,await get('SELECT * FROM ggsoma_orders WHERE pedido_id=?',[id]));
    }finally{locks.delete(id);}
  }
  async function settleFailure(p,code){
    const change=await run(`UPDATE pedidos SET status='CANCELADO',estornado=CASE WHEN cobrado=1 THEN 1 ELSE estornado END,motivo_cancelamento=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status!='CANCELADO'`,['GGSOMA: '+code,p.id]);
    if(change.changes){const client=await get('SELECT * FROM revendas WHERE id=?',[p.revenda_id]);if(client)await d.enviarParaCanaisCliente(client,`⚠️ Pedido #${p.id} cancelado. O valor foi devolvido ao saldo. Motivo: ${code}`);}
  }
  async function complete(p,o){
    if(p.status!=='FINALIZADO')await d.finalizarPedido(p,{notificarCliente:false});
    if(!o.notified){
      const client=await get('SELECT * FROM revendas WHERE id=?',[p.revenda_id]);
      // Only verified private destinations; never pass a group as fallback.
      if(client){const n=await d.enviarParaCanaisCliente(client,`✅ Produto entregue\n\nPedido #${p.id}\n${p.servico_nome}\n\n${decrypt(o.delivery_enc)}`);if(n>0)await run('UPDATE ggsoma_orders SET notified=1 WHERE pedido_id=?',[p.id]);}
    }
  }
  async function tick(){
    if(running)return;running=true;
    try{if(await getConfig('ggsoma_enabled','0')==='1' && Date.now()-lastSyncTry>120000){lastSyncTry=Date.now();try{await sync();await sendNextAd();}catch(_){}}const rows=await all(`SELECT p.id FROM pedidos p JOIN servicos_catalogo s ON s.id=p.servico_id LEFT JOIN ggsoma_orders o ON o.pedido_id=p.id WHERE s.api_provider='GGSOMA' AND p.status IN ('PENDENTE','EM PROCESSO','FINALIZADO') AND (o.state IS NULL OR o.state!='COMPLETED' OR (o.state='COMPLETED' AND o.notified=0)) ORDER BY p.id LIMIT 10`);for(const r of rows)await execute(r.id);}finally{running=false;}
  }

  async function sharedCatalog(){
    if(await getConfig('ggsoma_enabled','0')!=='1')throw Object.assign(new Error('GGSOMA_DISABLED'),{code:'GGSOMA_DISABLED'});
    try{await sync();}catch(_){}
    const rows=await all(`SELECT g.slug,g.json,g.custom_title,g.custom_description,s.id catalogo_id,s.nome,s.preco_padrao,s.ativo,s.api_cost FROM ggsoma_products g LEFT JOIN servicos_catalogo s ON s.id=g.catalogo_id WHERE g.present=1 AND s.ativo=1 ORDER BY COALESCE(NULLIF(g.custom_title,''),s.nome,g.slug)`);
    return rows.map(r=>{const p=JSON.parse(r.json||'{}');return {slug:r.slug,name:r.custom_title||r.nome||p.name||r.slug,description:r.custom_description||p.description||'',cost:Number(r.api_cost??p.yourPrice??0),central_price:Number(r.preco_padrao||0),enabled:Number(r.ativo||0)===1,stock:{inStock:!!p.stock?.inStock,count:Number(p.stock?.count||0)},deliveryType:p.deliveryType||'',durationDays:p.durationDays||null,warranty:p.warranty||null};});
  }
  async function sharedOrder(slug,externalId){
    slug=String(slug||'').trim();externalId=String(externalId||'').trim().slice(0,180);
    if(!slug||!externalId)throw Object.assign(new Error('VALIDATION_ERROR'),{code:'VALIDATION_ERROR'});
    if(await getConfig('ggsoma_enabled','0')!=='1')throw Object.assign(new Error('GGSOMA_DISABLED'),{code:'GGSOMA_DISABLED'});
    let saved=await get('SELECT * FROM shared_ggsoma_orders WHERE external_id=?',[externalId]);
    if(saved?.state==='COMPLETED')return {status:'COMPLETED',orderCode:saved.order_code,delivery:decrypt(saved.delivery_enc)};
    if(saved?.state==='FAILED')throw Object.assign(new Error(saved.error||'FAILED'),{code:saved.error||'FAILED'});
    const gp=await get('SELECT * FROM ggsoma_products WHERE slug=? AND present=1',[slug]);
    if(!gp)throw Object.assign(new Error('PRODUCT_NOT_FOUND'),{code:'PRODUCT_NOT_FOUND'});
    const svc=await get(`SELECT ativo FROM servicos_catalogo WHERE api_provider='GGSOMA' AND api_service_id=? ORDER BY id DESC LIMIT 1`,[slug]);
    if(!svc||!Number(svc.ativo))throw Object.assign(new Error('PRODUCT_NOT_ALLOWED'),{code:'PRODUCT_NOT_ALLOWED'});
    if(!saved){await run(`INSERT OR IGNORE INTO shared_ggsoma_orders(external_id,slug,state) VALUES(?,?,'NEW')`,[externalId,slug]);saved=await get('SELECT * FROM shared_ggsoma_orders WHERE external_id=?',[externalId]);}
    try{
      const product=await request('get','/catalog/products/'+encodeURIComponent(slug));
      const card=product.data&&!Array.isArray(product.data)?product.data:product;
      if(!card.stock?.inStock)throw Object.assign(new Error('OUT_OF_STOCK'),{code:'OUT_OF_STOCK'});
      const balance=await request('get','/balance');
      if(Number(balance.balance)<Number(card.yourPrice))throw Object.assign(new Error('INSUFFICIENT_BALANCE'),{code:'INSUFFICIENT_BALANCE'});
      const resp=await postOrder({productSlug:slug,quantity:1,externalOrderId:externalId});
      const text=deliveryText(resp);
      if(resp.status!=='COMPLETED'||!text)throw Object.assign(new Error('UNRESOLVED'),{code:'UNRESOLVED'});
      await run(`UPDATE shared_ggsoma_orders SET state='COMPLETED',order_code=?,delivery_enc=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE external_id=?`,[resp.orderCode||'',encrypt(text),externalId]);
      return {status:'COMPLETED',orderCode:resp.orderCode||'',delivery:text};
    }catch(e){
      const definite=['OUT_OF_STOCK','INSUFFICIENT_BALANCE','PRODUCT_NOT_FOUND','PRODUCT_NOT_ALLOWED','PRODUCT_UNAVAILABLE','UNSUPPORTED_DELIVERY_TYPE','INVALID_QUANTITY','VALIDATION_ERROR'].includes(e.code);
      await run(`UPDATE shared_ggsoma_orders SET state=?,error=?,request_id=?,updated_at=CURRENT_TIMESTAMP WHERE external_id=?`,[definite?'FAILED':'RETRY',e.code||'TEMPORARY',e.requestId||'',externalId]);
      throw e;
    }
  }

  function csrf(){return crypto.createHmac('sha256',key()).update('ggsoma-admin').digest('hex');}
  const premiumImageDir=path.join(DATA_DIR,'premium-images');
  fs.mkdirSync(premiumImageDir,{recursive:true});
  const uploadPremium=multer({storage:multer.diskStorage({destination:(req,file,cb)=>cb(null,premiumImageDir),filename:(req,file,cb)=>{const ext=(path.extname(file.originalname||'')||'.jpg').toLowerCase();cb(null,'premium_'+Date.now()+'_'+crypto.randomBytes(5).toString('hex')+ext);}}),limits:{fileSize:8*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^image\//.test(file.mimetype||''))});
  function routes(app){
    const h=d.safeHtml;
    const form=(url,body)=>`<form method="post" action="${url}"><input type="hidden" name="csrf" value="${csrf()}">${body}</form>`;
    const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.redirect('/admin/ggsoma?erro='+encodeURIComponent(e.code||e.message));}};
    const protect=(req,res,next)=>{const expected=csrf(),v=String(req.body.csrf||'');if(v.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(v),Buffer.from(expected)))return res.sendStatus(403);next();};
    app.get('/admin/ggsoma',wrap(async(req,res)=>{
      res.set('Cache-Control','no-store');
      const token=decrypt(await getConfig('ggsoma_key','')), enabled=await getConfig('ggsoma_enabled','0');
      const groups=d.listWhatsAppGroups?await d.listWhatsAppGroups():[]; const selectedGroup=await getConfig('ggsoma_ads_wa_group',''); const profit=await getConfig('ggsoma_profit_default','25'); const usd=await effectiveUsdBrl(); const queue=await all(`SELECT q.*,g.custom_title,g.json FROM ggsoma_announcement_queue q LEFT JOIN ggsoma_products g ON g.slug=q.slug ORDER BY q.id DESC LIMIT 30`);
      const rows=await all(`SELECT g.*,s.preco_padrao,s.ativo FROM ggsoma_products g LEFT JOIN servicos_catalogo s ON s.id=g.catalogo_id ORDER BY slug`);
      const orders=await all('SELECT pedido_id,state,order_code,error,request_id FROM ggsoma_orders ORDER BY pedido_id DESC LIMIT 50');
      res.send(d.page('GGSOMA API',`<h1>GGSOMA API</h1><p>${h(req.query.ok||req.query.erro||'')}</p><div class="card"><h2>📢 Divulgação automática GGSOMA</h2>${form('/admin/ggsoma/automation',`<label>Lucro padrão por produto (R$)</label><input name="profit" type="number" min="0" step="0.01" value="${h(profit)}"><label>Cotação USD → BRL</label><input name="usd_brl" type="number" min="0" step="0.0001" value="${h(usd||'')}" required><label><input style="width:auto" type="checkbox" name="auto_stock" value="1" ${(await getConfig('ggsoma_auto_stock','1'))==='1'?'checked':''}> Ativar automaticamente produtos com estoque e desativar sem estoque</label><label><input style="width:auto" type="checkbox" name="ads_enabled" value="1" ${(await getConfig('ggsoma_ads_enabled','1'))==='1'?'checked':''}> Anúncios automáticos no WhatsApp</label><label>Grupo de divulgação</label><select name="wa_group"><option value="">Selecione...</option>${groups.map(g=>`<option value="${h(g.id)}" ${g.id===selectedGroup?'selected':''}>${h(g.nome)}</option>`).join('')}</select><label>Reposição mínima para anunciar (+ unidades)</label><input name="min_restock" type="number" min="1" value="${h(await getConfig('ggsoma_ads_min_restock','10'))}"><label>Intervalo mínimo entre anúncios (minutos)</label><input name="interval_min" type="number" min="1" value="${h(await getConfig('ggsoma_ads_interval_min','15'))}"><p><b>🛒 COMPRAR AGORA:</b> link do WhatsApp gerado automaticamente para cada produto.</p><label><input style="width:auto" type="checkbox" name="ads_new" value="1" ${(await getConfig('ggsoma_ads_new','1'))==='1'?'checked':''}> Anunciar produto novo</label><label><input style="width:auto" type="checkbox" name="ads_return" value="1" ${(await getConfig('ggsoma_ads_return','1'))==='1'?'checked':''}> Anunciar quando voltar ao estoque</label><label><input style="width:auto" type="checkbox" name="ads_restock" value="1" ${(await getConfig('ggsoma_ads_restock','1'))==='1'?'checked':''}> Anunciar reposição relevante</label><button>💾 Salvar automação</button>`)}${form('/admin/ggsoma/ad-test','<button>📲 Enviar anúncio de teste no grupo</button>')}<p><b>Fila:</b> ${queue.filter(x=>x.status==='PENDING').length} pendente(s) · ${queue.filter(x=>x.status==='SENT').length} enviado(s) nos últimos registros.</p></div><div class="card"><h2>Configuração</h2><p>Chave: ${token?'••••••••'+h(token.slice(-4)):'Não cadastrada'}</p>${form('/admin/ggsoma/config',`<label>Nova chave API (em branco mantém a atual)</label><input type="password" name="key" autocomplete="new-password"><label><input type="checkbox" name="enabled" value="1" ${enabled==='1'?'checked':''}> Ativar integração</label><button>Salvar</button>`)}<p>Saldo: US$ ${h(await getConfig('ggsoma_balance','—'))}</p>${form('/admin/ggsoma/test','<button>Testar conexão e consultar saldo</button>')}${form('/admin/ggsoma/sync','<button>Sincronizar catálogo</button>')}<p>Última sincronização: ${h(await getConfig('ggsoma_sync','Nunca'))}</p></div><h2>Produtos</h2>${rows.map(r=>{const p=JSON.parse(r.json);return `<div class="card"><h3>${h(p.name)}</h3><p>Custo US$ ${h(p.yourPrice)} · Estoque: ${h(p.stock?.count||0)} · ${h(p.deliveryType)} · Duração ${h(p.durationDays||'—')} dias · Garantia ${h(p.warranty?.enabled?p.warranty.days+' dias':'—')}</p><form method="post" action="/admin/ggsoma/product" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${csrf()}"><input type="hidden" name="slug" value="${h(r.slug)}"><label>Preço de venda R$ (calculado automaticamente; pode ajustar manualmente)</label><input name="price" type="number" step="0.01" min="0.01" required value="${r.preco_padrao||''}"><label>Lucro personalizado R$ (vazio = usa lucro padrão)</label><input name="custom_profit" type="number" min="0" step="0.01" value="${r.custom_profit??''}" placeholder="${h(profit)}"><label><input style="width:auto" name="blocked_auto" type="checkbox" value="1" ${r.blocked_auto?'checked':''}> ⛔ Não vender este produto (bloqueio manual)</label><label>Nome exibido ao cliente (opcional)</label><input name="custom_title" maxlength="160" value="${h(r.custom_title||'')}" placeholder="Ex.: Gemini Pro — 18 Meses"><label>Descrição personalizada (opcional)</label><textarea name="custom_description" rows="7" maxlength="5000" placeholder="Se ficar vazio, será usada a descrição da API traduzida.">${h(r.custom_description||'')}</textarea><label>Foto do produto (opcional)</label><input name="image" type="file" accept="image/*">${r.image_path?`<p>📷 Foto cadastrada. <label style="display:inline"><input style="width:auto" type="checkbox" name="remove_image" value="1"> Remover foto</label></p>`:''}<label><input name="enabled" type="checkbox" value="1" ${r.ativo?'checked':''}> Vender este produto</label><button>Salvar produto</button></form></div>`;}).join('')}<h2>Pedidos GGSOMA</h2><table><tr><th>Pedido</th><th>Status</th><th>Fornecedor</th><th>Erro / rastreio</th></tr>${orders.map(o=>`<tr><td>#${o.pedido_id}</td><td>${h(o.state)}</td><td>${h(o.order_code||'—')}</td><td>${h(o.error||'')} ${h(o.request_id||'')}</td></tr>`).join('')}</table>`));
    }));
    app.post('/admin/ggsoma/automation',protect,wrap(async(req,res)=>{await setConfig('ggsoma_profit_default',String(Math.max(0,Number(String(req.body.profit||'25').replace(',','.'))||25)));await setConfig('ggsoma_usd_brl',String(Math.max(0,Number(String(req.body.usd_brl||'0').replace(',','.'))||0)));await setConfig('ggsoma_auto_stock',req.body.auto_stock==='1'?'1':'0');await setConfig('ggsoma_ads_enabled',req.body.ads_enabled==='1'?'1':'0');await setConfig('ggsoma_ads_wa_group',String(req.body.wa_group||''));await setConfig('ggsoma_ads_min_restock',String(Math.max(1,Number(req.body.min_restock)||10)));await setConfig('ggsoma_ads_interval_min',String(Math.max(1,Number(req.body.interval_min)||15)));await setConfig('ggsoma_ads_new',req.body.ads_new==='1'?'1':'0');await setConfig('ggsoma_ads_return',req.body.ads_return==='1'?'1':'0');await setConfig('ggsoma_ads_restock',req.body.ads_restock==='1'?'1':'0');await sync();res.redirect('/admin/ggsoma?ok=Automação+salva+e+catálogo+recalculado');}));
    app.post('/admin/ggsoma/ad-test',protect,wrap(async(req,res)=>{const group=await getConfig('ggsoma_ads_wa_group','');if(!group)throw new Error('Selecione o grupo de divulgação.');if(!d.sendWhatsAppGroup)throw new Error('WhatsApp indisponível.');await d.sendWhatsAppGroup(group,'✅ *TESTE DE DIVULGAÇÃO GGSOMA*\n\nSeu grupo está conectado à automação de produtos e estoque.','');res.redirect('/admin/ggsoma?ok=Teste+enviado+ao+grupo');}));
    app.post('/admin/ggsoma/config',protect,wrap(async(req,res)=>{const token=String(req.body.key||'').trim();if(token&&!/^sk_live_[A-Za-z0-9]+$/.test(token))throw new Error('Formato de chave inválido.');if(token)await setConfig('ggsoma_key',encrypt(token));await setConfig('ggsoma_enabled',req.body.enabled==='1'?'1':'0');res.redirect('/admin/ggsoma?ok=Configuração+salva');}));
    app.post('/admin/ggsoma/test',protect,wrap(async(req,res)=>{const b=await request('get','/balance');await setConfig('ggsoma_balance',String(b.balance));res.redirect('/admin/ggsoma?ok=Conectado');}));
    app.post('/admin/ggsoma/sync',protect,wrap(async(req,res)=>{const n=await sync();res.redirect('/admin/ggsoma?ok='+n+'+produtos+sincronizados');}));
    app.post('/admin/ggsoma/product',uploadPremium.single('image'),protect,wrap(async(req,res)=>{const cp=String(req.body.custom_profit||'').trim();await run('UPDATE ggsoma_products SET custom_profit=?,blocked_auto=? WHERE slug=?',[cp===''?null:Math.max(0,Number(cp.replace(',','.'))||0),req.body.blocked_auto==='1'?1:0,req.body.slug]);await saveProduct(req.body.slug,req.body.price,req.body.blocked_auto==='1'?false:req.body.enabled==='1');const row=await get('SELECT image_path FROM ggsoma_products WHERE slug=?',[req.body.slug]);let imagePath=row?.image_path||'';if(req.body.remove_image==='1'&&imagePath){try{fs.unlinkSync(imagePath)}catch(_){}imagePath='';}if(req.file?.path){if(imagePath&&imagePath!==req.file.path){try{fs.unlinkSync(imagePath)}catch(_){}}imagePath=req.file.path;}await run('UPDATE ggsoma_products SET custom_title=?,custom_description=?,image_path=? WHERE slug=?',[String(req.body.custom_title||'').trim().slice(0,160),String(req.body.custom_description||'').trim().slice(0,5000),imagePath,req.body.slug]);res.redirect('/admin/ggsoma?ok=Produto+salvo');}));
    app.get('/cliente/ggsoma/:id',d.clienteAuth,wrap(async(req,res)=>{
      const o=await get(`SELECT g.* FROM ggsoma_orders g JOIN pedidos p ON p.id=g.pedido_id WHERE p.id=? AND p.revenda_id=? AND g.state='COMPLETED'`,[req.params.id,req.cliente.id]);if(!o)return res.sendStatus(404);
      res.set('Cache-Control','no-store');res.send(d.clientePage('Entrega',`<div class="cu-card"><h1>Entrega do pedido #${Number(o.pedido_id)}</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${h(decrypt(o.delivery_enc))}</pre></div>`,req.cliente));
    }));
  }
  return {init,routes,execute,purchase,sync,saveProduct,deliveryText,encrypt,decrypt,sharedCatalog,sharedOrder};
};
