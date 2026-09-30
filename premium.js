'use strict';
const crypto=require('crypto');

// Assinaturas Premium is now only a storefront for products enabled from GGSOMA.
// There is no local/manual stock and no customer broadcast when a product is enabled.
module.exports=function createPremium(d){
 const {run,get,all}=d;
 async function init(){
  // Disable legacy PREMIUM catalog entries. Data is kept for audit/history; nothing is deleted.
  await run("UPDATE servicos_catalogo SET ativo=0 WHERE api_provider='PREMIUM'");
  await run(`CREATE TABLE IF NOT EXISTS premium_translation_cache(source TEXT PRIMARY KEY, translated TEXT NOT NULL, updated_at TEXT NOT NULL)`);
 }
 async function products(activeOnly=false){
  return all(`SELECT g.slug,g.catalogo_id,g.json,g.present,g.custom_title,g.custom_description,g.image_path,s.id,s.nome,s.preco_padrao,s.descricao,s.ativo,s.api_cost,s.api_service_id
              FROM ggsoma_products g JOIN servicos_catalogo s ON s.id=g.catalogo_id
              WHERE s.api_provider='GGSOMA' ${activeOnly?'AND s.ativo=1 AND g.present=1':''}
              ORDER BY s.nome COLLATE NOCASE`);
 }
 async function product(id){
  return get(`SELECT g.slug,g.catalogo_id,g.json,g.present,g.custom_title,g.custom_description,g.image_path,s.id,s.nome,s.preco_padrao,s.descricao,s.ativo,s.api_cost,s.api_service_id
              FROM ggsoma_products g JOIN servicos_catalogo s ON s.id=g.catalogo_id
              WHERE s.api_provider='GGSOMA' AND s.id=?`,[id]);
 }
 function meta(p){try{return JSON.parse(p.json||'{}')}catch(_){return {}}}
 function stock(p){const m=meta(p);return Number(m.stock?.count||0)}
 function deliveryLabel(p){const t=String(meta(p).deliveryType||'').toUpperCase();return t==='LINK'?'Link automático':t==='COUPON'?'Código automático':t==='READY_ACCOUNT'?'Conta automática':'Entrega digital'}
 function durationLabel(p){
  const days=Number(meta(p).durationDays||0);
  if(!days)return '';
  if(days%30===0)return `${days/30} ${days/30===1?'mês':'meses'}`;
  return `${days} ${days===1?'dia':'dias'}`;
 }
 function cleanCustomerText(value){
  return String(value||'').replace(/GGSOMA/gi,'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();
 }
 function apiText(m){
  // GGSOMA can place the commercial copy in different/nested fields depending on the product/provider.
  // Search only description-like fields; never expose the raw JSON or internal supplier metadata.
  const preferred=['description','descricao','details','detail','instructions','instruction','productDescription','product_description','longDescription','long_description','notes','note','features','benefits'];
  const found=[]; const seen=new Set();
  function add(v){
   if(Array.isArray(v)){for(const x of v)add(x);return;}
   if(v&&typeof v==='object'){
    for(const k of preferred)if(Object.prototype.hasOwnProperty.call(v,k))add(v[k]);
    for(const [k,x] of Object.entries(v))if(!preferred.includes(k)&&x&&typeof x==='object')add(x);
    return;
   }
   if(typeof v==='string'){const x=cleanCustomerText(v);if(x.length>=8&&!seen.has(x)){seen.add(x);found.push(x);}}
  }
  add(m);return found.sort((a,b)=>b.length-a.length)[0]||'';
 }
 function customerTitle(p){
  const m=meta(p);let name=String(p.custom_title||m.name||p.nome||'Produto').trim();
  if(p.custom_title)return cleanCustomerText(name);
  name=name.replace(/^\s*(?:link\s+to\s+receive|receive|get)\s+/i,'').trim();
  name=name.replace(/\b(\d+)\s*months?\b/ig,(_,n)=>`${n} ${Number(n)===1?'Mês':'Meses'}`);
  name=name.replace(/\b(\d+)\s*days?\b/ig,(_,n)=>`${n} ${Number(n)===1?'Dia':'Dias'}`);
  const duration=durationLabel(p);
  if(duration&&!name.toLowerCase().includes(duration.toLowerCase()))name+=` — ${duration}`;
  return name;
 }
 function looksEnglish(text){
  const t=String(text||'').toLowerCase();
  if(!t)return false;
  const en=(t.match(/\b(the|and|with|you|your|can|add|storage|cloud|months?|days?|no|card|required|works?|country|warranty|link|account|family|private|shared|receive|important|after|purchase|within|hours?)\b/g)||[]).length;
  const pt=(t.match(/\b(o|a|e|com|você|seu|sua|pode|armazenamento|nuvem|meses?|dias?|cartão|funciona|país|garantia|link|conta|família|privado|compartilhado|recebe|importante|após|compra|horas?)\b/g)||[]).length;
  return en>=2 && en>pt;
 }
 async function translateToPortuguese(raw){
  raw=cleanCustomerText(raw);if(!raw||!looksEnglish(raw))return raw;
  const cached=await get('SELECT translated FROM premium_translation_cache WHERE source=?',[raw]);if(cached?.translated)return cached.translated;
  try{
   // Translation is presentation-only. If the service is unavailable, the original API text is kept.
   const r=await d.axios.get('https://translate.googleapis.com/translate_a/single',{params:{client:'gtx',sl:'auto',tl:'pt',dt:'t',q:raw},timeout:7000});
   const translated=cleanCustomerText((r.data?.[0]||[]).map(x=>Array.isArray(x)?x[0]:'').join(''));
   if(translated){await run(`INSERT INTO premium_translation_cache(source,translated,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(source) DO UPDATE SET translated=excluded.translated,updated_at=excluded.updated_at`,[raw,translated]);return translated;}
  }catch(_){ }
  return raw;
 }
 async function customerDescription(p){
  if(String(p.custom_description||'').trim())return cleanCustomerText(p.custom_description);
  const m=meta(p);
  return translateToPortuguese(apiText(m));
 }
 async function card(p,client){
  const price=await d.precoDaRevenda(client.id,p.id),qty=stock(p),description=await customerDescription(p);
  const title=customerTitle(p);
  let text=`⭐ *${title}*\n\n💰 *${d.brl(price)}* • 📦 *${qty} ${qty===1?'disponível':'disponíveis'}*\n⚡ *Entrega instantânea — ${deliveryLabel(p)}*`;
  if(description)text+=`\n\n📝 *Descrição*\n${description}`;
  return text;
 }
 async function list(from,client,telegram=false){
  const rows=await products(true);await d.salvarSessaoPedido(from,{etapa:'premium_list',ids:rows.map(x=>x.id)});
  if(telegram)return d.bot().sendMessage(d.tgId(from),'⭐ Assinaturas Premium\n\nEscolha um produto:',{reply_markup:{inline_keyboard:[...rows.map(p=>[{text:`${customerTitle(p)} · ${stock(p)>0?'Disponível':'Esgotado'}`,callback_data:'prem_show_'+p.id}]),[{text:'⬅️ Voltar',callback_data:'menu_voltar'}]]}});
  let text='⭐ *Assinaturas Premium*\n\n';
  for(let i=0;i<rows.length;i++){const p=rows[i];text+=`${i+1}️⃣ ${customerTitle(p)}\n💰 ${d.brl(await d.precoDaRevenda(client.id,p.id))} · 📦 ${stock(p)} disponíveis\n\n`;}
  await d.enviarTexto(from,text+(rows.length?'':'Nenhum produto ativado no momento.\n\n')+'0️⃣ Voltar');
 }
 async function show(from,client,id,telegram=false){
  const p=await product(id);if(!p?.ativo||!p.present){await d.enviarTexto(from,'Produto indisponível.');return;}
  const token=crypto.randomUUID();await d.salvarSessaoPedido(from,{etapa:'premium_product',productId:p.id,token});const text=await card(p,client),available=stock(p)>0;
  if(telegram){if(p.image_path)await d.enviarImagem(from,p.image_path,'');return d.bot().sendMessage(d.tgId(from),text,{reply_markup:{inline_keyboard:[...(available?[[{text:'🛒 Comprar',callback_data:`prem_buy_${p.id}_${token}`}]]:[]),[{text:'⬅️ Voltar',callback_data:'menu_premium'}]]}});}
  if(p.image_path)await d.enviarImagem(from,p.image_path,'');
  await d.enviarTexto(from,text+(available?'\n\n1️⃣ Comprar\n0️⃣ Voltar':'\n\n⛔ Esgotado\n0️⃣ Voltar'));
 }
 async function confirm(from,client,id,token){
  await d.apagarSessaoPedido(from);const p=await product(id);if(!p?.ativo||!p.present)return d.enviarTexto(from,'Produto indisponível.');
  try{await d.ggsoma.purchase(client,p,from,token);}catch(e){
   const error=String(e.message||e);if(error.includes('GGSOMA_CUSTOMER_BALANCE')){
    const total=await d.precoDaRevenda(client.id,p.id);await d.salvarSessaoPedido(from,{etapa:'saldo_insuficiente_servico',servicoId:p.id,entradas:['Assinatura Premium'],totalPedido:total,ggsomaToken:token});
    await d.enviarTexto(from,d.textoSaldoInsuficiente(client,total,p.nome,['Assinatura Premium']));
   }else await d.enviarTexto(from,error);
  }
 }
 async function waMessage(from,client,sess,text){
  if(sess?.etapa==='premium_list'){if(text==='0'){await d.apagarSessaoPedido(from);await d.voltarWhatsApp(from,client);return true;}const id=sess.ids?.[Number(text)-1];if(id)await show(from,client,id);else await d.enviarTexto(from,'Escolha um produto pelo número ou 0 para voltar.');return true;}
  if(sess?.etapa==='premium_product'){if(text==='0')await list(from,client);else if(text==='1')await confirm(from,client,sess.productId,sess.token);else await d.enviarTexto(from,'Digite 1 para comprar ou 0 para voltar.');return true;}return false;
 }
 async function clientCallback(from,client,data){
  if(data==='menu_premium'){await list(from,client,true);return true;}
  let m=data.match(/^prem_show_(\d+)$/);if(m){await show(from,client,Number(m[1]),true);return true;}
  m=data.match(/^prem_buy_(\d+)_([a-f0-9-]{36})$/);if(m){const sess=await d.carregarSessaoPedido(from);if(sess?.productId!==Number(m[1])||sess.token!==m[2]){await d.enviarTexto(from,'Esta confirmação expirou. Escolha o produto novamente.');return true;}await confirm(from,client,Number(m[1]),m[2]);return true;}return false;
 }
 async function adminMenu(chat){return d.bot().sendMessage(chat,'⭐ Assinaturas Premium\n\nAgora esta área usa somente os produtos da API GGSOMA. Ative/desative os produtos e edite o preço em reais no painel GGSOMA. O estoque vem da API e nenhuma ativação gera aviso aos clientes.',{reply_markup:{inline_keyboard:[[{text:'⬅️ Painel',callback_data:'admin_inicio'}]]}});}
 async function adminCallback(chat,user,data){if(!data.startsWith('admpr_'))return false;if(String(user)!==String(d.adminId())||String(chat)!==String(user))throw new Error('Acesso somente pelo administrador no privado.');await adminMenu(chat);return true;}
 async function adminMessage(){return false;}
 function routes(app){
  app.get('/admin/premium',(req,res)=>res.redirect('/admin/ggsoma'));
 }
 return {init,routes,products,product,card,list,show,confirm,waMessage,clientCallback,adminCallback,adminMessage};
};
