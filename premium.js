'use strict';
const crypto=require('crypto');

// Assinaturas Premium is now only a storefront for products enabled from GGSOMA.
// There is no local/manual stock and no customer broadcast when a product is enabled.
module.exports=function createPremium(d){
 const {run,get,all}=d;
 async function init(){
  // Disable legacy PREMIUM catalog entries. Data is kept for audit/history; nothing is deleted.
  await run("UPDATE servicos_catalogo SET ativo=0 WHERE api_provider='PREMIUM'");
 }
 async function products(activeOnly=false){
  return all(`SELECT g.slug,g.catalogo_id,g.json,g.present,s.id,s.nome,s.preco_padrao,s.descricao,s.ativo,s.api_cost,s.api_service_id
              FROM ggsoma_products g JOIN servicos_catalogo s ON s.id=g.catalogo_id
              WHERE s.api_provider='GGSOMA' ${activeOnly?'AND s.ativo=1 AND g.present=1':''}
              ORDER BY s.nome COLLATE NOCASE`);
 }
 async function product(id){
  return get(`SELECT g.slug,g.catalogo_id,g.json,g.present,s.id,s.nome,s.preco_padrao,s.descricao,s.ativo,s.api_cost,s.api_service_id
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
 function customerDescription(p){
  const m=meta(p);
  const raw=String(m.description||m.descricao||m.details||m.instructions||'').trim();
  if(!raw)return '';
  return raw.replace(/GGSOMA/gi,'').replace(/\n{3,}/g,'\n\n').trim();
 }
 async function card(p,client){
  const price=await d.precoDaRevenda(client.id,p.id),qty=stock(p),duration=durationLabel(p),description=customerDescription(p);
  const title=duration && !String(p.nome).toLowerCase().includes(duration.toLowerCase()) ? `${p.nome} — ${duration}` : p.nome;
  let text=`⭐ *${title}*\n\n💰 *${d.brl(price)}* • 📦 *${qty} ${qty===1?'disponível':'disponíveis'}*\n⚡ *Entrega instantânea — ${deliveryLabel(p)}*`;
  if(description)text+=`\n\n${description}`;
  return text;
 }
 async function list(from,client,telegram=false){
  const rows=await products(true);await d.salvarSessaoPedido(from,{etapa:'premium_list',ids:rows.map(x=>x.id)});
  if(telegram)return d.bot().sendMessage(d.tgId(from),'⭐ Assinaturas Premium\n\nEscolha um produto:',{reply_markup:{inline_keyboard:[...rows.map(p=>[{text:`${p.nome} · ${stock(p)>0?'Disponível':'Esgotado'}`,callback_data:'prem_show_'+p.id}]),[{text:'⬅️ Voltar',callback_data:'menu_voltar'}]]}});
  let text='⭐ *Assinaturas Premium*\n\n';
  for(let i=0;i<rows.length;i++){const p=rows[i];text+=`${i+1}️⃣ ${p.nome}\n💰 ${d.brl(await d.precoDaRevenda(client.id,p.id))} · 📦 ${stock(p)} disponíveis\n\n`;}
  await d.enviarTexto(from,text+(rows.length?'':'Nenhum produto ativado no momento.\n\n')+'0️⃣ Voltar');
 }
 async function show(from,client,id,telegram=false){
  const p=await product(id);if(!p?.ativo||!p.present){await d.enviarTexto(from,'Produto indisponível.');return;}
  const token=crypto.randomUUID();await d.salvarSessaoPedido(from,{etapa:'premium_product',productId:p.id,token});const text=await card(p,client),available=stock(p)>0;
  if(telegram)return d.bot().sendMessage(d.tgId(from),text,{reply_markup:{inline_keyboard:[...(available?[[{text:'🛒 Comprar',callback_data:`prem_buy_${p.id}_${token}`}]]:[]),[{text:'⬅️ Voltar',callback_data:'menu_premium'}]]}});
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
