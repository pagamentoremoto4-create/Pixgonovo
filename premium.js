'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const CATEGORY='Assinaturas Premium';
const DESCRIPTION='✅ Ativação no seu próprio Gmail\n✅ 5 TB de armazenamento + 5 usuários\n✅ Conta familiar completa, não é convite\n✅ Privado e sem necessidade de cartão\n🌎 Funciona em qualquer país, sem verificação\n\n⚠️ Sem garantia. Use o link em até 1 a 2 horas após a compra.\n\n🔗 Abra o link recebido e clique em “Activate Offer”.';
module.exports=function createPremium(d){
 const {run,get,all,DATA_DIR}=d,adminSessions=new Map(),locks=new Set();let timer;
 const dir=path.join(DATA_DIR,'premium');fs.mkdirSync(dir,{recursive:true});
 function key(){const file=path.join(dir,'secret.key');try{fs.writeFileSync(file,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}const k=fs.readFileSync(file);if(k.length!==32)throw new Error('Chave de proteção Premium inválida.');return k;}
 function encrypt(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const v=Buffer.concat([c.update(s,'utf8'),c.final()]);return JSON.stringify([iv.toString('base64'),v.toString('base64'),c.getAuthTag().toString('base64')]);}
 function decrypt(s){const [iv,v,tag]=JSON.parse(s),c=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));c.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([c.update(Buffer.from(v,'base64')),c.final()]).toString('utf8');}
 async function init(){
  await run(`CREATE TABLE IF NOT EXISTS premium_products(id INTEGER PRIMARY KEY,catalogo_id INTEGER UNIQUE NOT NULL,duration TEXT DEFAULT '18 meses',delivery_type TEXT DEFAULT 'Link',photo TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS premium_stock(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL,content_enc TEXT NOT NULL,status TEXT DEFAULT 'AVAILABLE',pedido_id INTEGER UNIQUE,source_id TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await run(`CREATE TABLE IF NOT EXISTS premium_delivery(pedido_id INTEGER PRIMARY KEY,notified INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,error TEXT)`);
  await d.addColumnIfMissing('pedidos','premium_token','TEXT');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS premium_token_unique ON pedidos(premium_token)');
  // SQLite executes this whole insert and its trigger as a single atomic statement.
  await run(`CREATE TRIGGER IF NOT EXISTS premium_reserve AFTER INSERT ON pedidos
   WHEN NEW.premium_token IS NOT NULL
   BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM servicos_catalogo WHERE id=NEW.servico_id AND api_provider='PREMIUM' AND ativo=1) THEN RAISE(ABORT,'PREMIUM_UNAVAILABLE') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM premium_stock st JOIN premium_products pr ON pr.id=st.product_id WHERE pr.catalogo_id=NEW.servico_id AND st.status='AVAILABLE') THEN RAISE(ABORT,'PREMIUM_OUT_OF_STOCK') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revendas WHERE id=NEW.revenda_id AND saldo>=NEW.valor) THEN RAISE(ABORT,'PREMIUM_INSUFFICIENT_BALANCE') END;
    UPDATE premium_stock SET status='SOLD',pedido_id=NEW.id WHERE id=(SELECT st.id FROM premium_stock st JOIN premium_products pr ON pr.id=st.product_id WHERE pr.catalogo_id=NEW.servico_id AND st.status='AVAILABLE' ORDER BY st.id LIMIT 1);
    UPDATE revendas SET saldo=saldo-NEW.valor WHERE id=NEW.revenda_id;
    INSERT INTO premium_delivery(pedido_id) VALUES(NEW.id);
   END`);
  await run(`CREATE TRIGGER IF NOT EXISTS premium_cancel_guard BEFORE UPDATE OF status ON pedidos
   WHEN OLD.premium_token IS NOT NULL AND NEW.status='CANCELADO'
   BEGIN SELECT RAISE(ABORT,'PREMIUM_DELIVERED_NO_CANCEL'); END`);
  if(!(await get('SELECT id FROM premium_products LIMIT 1')))await createProduct('Gemini Pro — 18 meses',100,DESCRIPTION,'18 meses','Link');
  if(!timer){timer=setInterval(()=>recover().catch(()=>{}),15000);timer.unref();}
 }
 async function createProduct(name,price=100,description='',duration='18 meses',delivery='Link'){
  name=String(name||'').trim();price=Number(String(price).replace(',','.'));if(!name||name.length>150||!Number.isFinite(price)||price<=0)throw new Error('Informe nome e preço válidos.');
  const s=await run(`INSERT INTO servicos_catalogo(nome,preco_padrao,tipo_entrada,entrada_label,ativo,categoria,descricao,prazo,api_provider,api_auto,cancelamento_permitido) VALUES(?,?,'TEXTO','Assinatura',1,?,?,'Entrega instantânea','PREMIUM',1,0)`,[name,price,CATEGORY,String(description||'').slice(0,2500)]);
  const p=await run('INSERT INTO premium_products(catalogo_id,duration,delivery_type) VALUES(?,?,?)',[s.lastID,String(duration).slice(0,80),String(delivery).slice(0,80)]);return p.lastID;
 }
 async function products(activeOnly=false){return all(`SELECT pr.*,s.nome,s.preco_padrao,s.descricao,s.ativo,(SELECT count(*) FROM premium_stock st WHERE st.product_id=pr.id AND st.status='AVAILABLE') stock FROM premium_products pr JOIN servicos_catalogo s ON s.id=pr.catalogo_id ${activeOnly?'WHERE s.ativo=1':''} ORDER BY pr.id`);}
 async function product(id){return get(`SELECT pr.*,s.nome,s.preco_padrao,s.descricao,s.ativo,(SELECT count(*) FROM premium_stock st WHERE st.product_id=pr.id AND st.status='AVAILABLE') stock FROM premium_products pr JOIN servicos_catalogo s ON s.id=pr.catalogo_id WHERE pr.id=?`,[id]);}
 async function addStock(id,text,source=crypto.randomUUID()){
  text=String(text||'').trim();if(!text||text.length>3500)throw new Error('Envie um texto de até 3500 caracteres. Cada mensagem vale uma unidade.');if(!await product(id))throw new Error('Produto não encontrado.');
  const r=await run('INSERT OR IGNORE INTO premium_stock(product_id,content_enc,source_id) VALUES(?,?,?)',[id,encrypt(text),source]);return r.changes>0;
 }
 async function editProduct(id,fields){
  const p=await product(id);if(!p)throw new Error('Produto não encontrado.');
  const name=String(fields.nome??p.nome).trim(),price=Number(String(fields.preco??p.preco_padrao).replace(',','.'));
  if(!name||name.length>150||!Number.isFinite(price)||price<=0)throw new Error('Informe nome e preço válidos.');
  await run('UPDATE servicos_catalogo SET nome=?,preco_padrao=?,descricao=?,ativo=?,categoria=? WHERE id=?',[name,price,String(fields.descricao??p.descricao).slice(0,2500),fields.ativo===undefined?p.ativo:Number(Boolean(fields.ativo)),CATEGORY,p.catalogo_id]);
  await run('UPDATE premium_products SET duration=?,delivery_type=? WHERE id=?',[String(fields.duration??p.duration).slice(0,80),String(fields.delivery_type??p.delivery_type).slice(0,80),id]);
 }
 function savePhoto(buffer){
  const png=buffer.length>8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=buffer.length>3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  if(buffer.length>5*1024*1024||!png&&!jpg)throw new Error('Envie uma foto PNG ou JPG de até 5 MB.');
  const name=crypto.randomUUID()+(png?'.png':'.jpg');fs.writeFileSync(path.join(dir,name),buffer,{mode:0o600});return name;
 }
 async function attachPhoto(id,buffer){if(!await product(id))throw new Error('Produto não encontrado.');const name=savePhoto(buffer);await run('UPDATE premium_products SET photo=? WHERE id=?',[name,id]);return name;}
 async function purchase(client,id,destination,token){
  if(!token||token.length>100)throw new Error('Confirmação inválida.');
  const old=await get('SELECT id,revenda_id FROM pedidos WHERE premium_token=?',[token]);if(old){if(old.revenda_id!==client.id)throw new Error('Pedido inválido.');await deliver(old.id);return old.id;}
  const p=await product(id);if(!p?.ativo)throw new Error('Produto indisponível.');
  const price=await d.precoDaRevenda(client.id,p.catalogo_id);if(!Number.isFinite(price)||price<=0)throw new Error('Preço inválido.');
  await run(`INSERT OR IGNORE INTO pedidos(tipo,revenda_id,revenda_nome,revenda_jid,servico_id,servico_nome,entrada_valor,tipo_entrada,entrada_label,valor,status,cobrado,premium_token) VALUES('REVENDA',?,?,?,?,?,'Assinatura Premium','TEXTO','Assinatura',?,'EM PROCESSO',1,?)`,[client.id,client.nome,destination,p.catalogo_id,p.nome,price,token]);
  const row=await get('SELECT id FROM pedidos WHERE premium_token=?',[token]);await deliver(row.id);return row.id;
 }
 async function deliver(id){
  if(locks.has(id))return;locks.add(id);
  try{const p=await get('SELECT * FROM pedidos WHERE id=? AND premium_token IS NOT NULL',[id]);const st=await get('SELECT content_enc FROM premium_stock WHERE pedido_id=?',[id]),delivery=await get('SELECT * FROM premium_delivery WHERE pedido_id=?',[id]);if(!p||!st||delivery?.notified)return;
   if(p.status!=='FINALIZADO')await d.finalizarPedido(p,{notificarCliente:false});
   await run('UPDATE premium_delivery SET attempts=attempts+1 WHERE pedido_id=?',[id]);
   const client=await get('SELECT * FROM revendas WHERE id=?',[p.revenda_id]);const sent=client?await d.enviarParaCanaisCliente(client,`✅ Assinatura entregue\n📦 ${p.servico_nome}\n🆔 Pedido #${id}\n\n${decrypt(st.content_enc)}`):0;
   await run('UPDATE premium_delivery SET notified=?,error=? WHERE pedido_id=?',[sent>0?1:0,sent>0?null:'Aguardando entrega privada',id]);
  }catch(_){await run("UPDATE premium_delivery SET error='Falha na entrega; tentando novamente' WHERE pedido_id=?",[id]);}finally{locks.delete(id);}
 }
 async function recover(){for(const r of await all('SELECT pedido_id FROM premium_delivery WHERE notified=0 ORDER BY pedido_id LIMIT 10'))await deliver(r.pedido_id);}
 async function card(p,client){const price=await d.precoDaRevenda(client.id,p.catalogo_id);return `📦 ${p.nome}\n\n💰 ${d.brl(price)} por unidade\n⏱ Duração: ${p.duration}\n📦 Estoque: ${p.stock} ${p.stock===1?'unidade':'unidades'}\n⚡ Entrega: Instantânea\n🎁 Você recebe: ${p.delivery_type}\n\n${p.descricao||''}`;}
 async function list(from,client,telegram=false){
  const rows=await products(true);await d.salvarSessaoPedido(from,{etapa:'premium_list',ids:rows.map(x=>x.id)});
  if(telegram){return d.bot().sendMessage(d.tgId(from),'⭐ Assinaturas Premium\n\nEscolha uma assinatura:',{reply_markup:{inline_keyboard:[...rows.map(p=>[{text:`${p.nome} · ${p.stock?'Disponível':'Esgotado'}`,callback_data:'prem_show_'+p.id}]),[{text:'⬅️ Voltar',callback_data:'menu_voltar'}]]}});}
  let text='⭐ *Assinaturas Premium*\n\n';for(let i=0;i<rows.length;i++){const p=rows[i];text+=`${i+1}️⃣ ${p.nome}\n💰 ${d.brl(await d.precoDaRevenda(client.id,p.catalogo_id))} · 📦 ${p.stock} disponíveis\n\n`;}
  await d.enviarTexto(from,text+(rows.length?'':'Nenhum produto disponível.\n\n')+'0️⃣ Voltar');
 }
 async function show(from,client,id,telegram=false){
  const p=await product(id);if(!p?.ativo){await d.enviarTexto(from,'Produto indisponível.');return;}
  const token=crypto.randomUUID();await d.salvarSessaoPedido(from,{etapa:'premium_product',productId:p.id,token});const text=await card(p,client);
  if(telegram){const buttons=[...(p.stock?[ [{text:'🛒 Comprar',callback_data:`prem_buy_${id}_${token}`}]]:[]),[{text:'⬅️ Voltar',callback_data:'menu_premium'}]],opts={reply_markup:{inline_keyboard:buttons}};
   const file=p.photo?path.join(dir,path.basename(p.photo)):null;
   if(file&&fs.existsSync(file)){if(text.length<=1024)return d.bot().sendPhoto(d.tgId(from),fs.readFileSync(file),{...opts,caption:text});await d.bot().sendPhoto(d.tgId(from),fs.readFileSync(file));}
   return d.bot().sendMessage(d.tgId(from),text,opts);
  }await d.enviarTexto(from,text+(p.stock?'\n\n1️⃣ Comprar\n0️⃣ Voltar':'\n\n⛔ Esgotado\n0️⃣ Voltar'));
 }
 async function confirm(from,client,id,token){
  await d.apagarSessaoPedido(from);
  try{await purchase(client,id,from,token);}catch(e){const error=String(e.message);if(error.includes('PREMIUM_INSUFFICIENT_BALANCE')){
   const p=await product(id),total=await d.precoDaRevenda(client.id,p.catalogo_id);
   await d.salvarSessaoPedido(from,{etapa:'saldo_insuficiente_servico',servicoId:p.catalogo_id,entradas:['Assinatura Premium'],totalPedido:total,premiumId:id,premiumToken:token});
   await d.enviarTexto(from,d.textoSaldoInsuficiente(client,total,p.nome,['Assinatura Premium']));
  }else await d.enviarTexto(from,error.includes('PREMIUM_OUT_OF_STOCK')?'⛔ Produto esgotado. Nenhuma cobrança foi realizada.':error);}
 }
 async function waMessage(from,client,sess,text){
  if(sess?.etapa==='premium_list'){if(text==='0'){await d.apagarSessaoPedido(from);await d.voltarWhatsApp(from,client);return true;}const id=sess.ids?.[Number(text)-1];if(id)await show(from,client,id);else await d.enviarTexto(from,'Escolha uma assinatura pelo número ou 0 para voltar.');return true;}
  if(sess?.etapa==='premium_product'){if(text==='0')await list(from,client);else if(text==='1')await confirm(from,client,sess.productId,sess.token);else await d.enviarTexto(from,'Digite 1 para comprar ou 0 para voltar.');return true;}return false;
 }
 async function clientCallback(from,client,data){
  if(data==='menu_premium'){await list(from,client,true);return true;}
  let m=data.match(/^prem_show_(\d+)$/);if(m){await show(from,client,Number(m[1]),true);return true;}
  m=data.match(/^prem_buy_(\d+)_([a-f0-9-]{36})$/);if(m){const sess=await d.carregarSessaoPedido(from);const old=await get('SELECT id FROM pedidos WHERE premium_token=? AND revenda_id=?',[m[2],client.id]);if(old){await d.enviarTexto(from,`✅ Compra já registrada: pedido #${old.id}.`);return true;}if(sess?.productId!==Number(m[1])||sess.token!==m[2]){await d.enviarTexto(from,'Esta confirmação expirou. Escolha o produto novamente.');return true;}await confirm(from,client,Number(m[1]),m[2]);return true;}return false;
 }
 async function adminMenu(chat,id){
  if(id){const p=await product(id);if(!p)return;return d.bot().sendMessage(chat,`⭐ ${p.nome}\n💰 ${d.brl(p.preco_padrao)}\n📦 Estoque: ${p.stock}\n⏱ ${p.duration}\n${p.ativo?'Ativo':'Inativo'}`,{reply_markup:{inline_keyboard:[[{text:'➕ Adicionar texto ao estoque',callback_data:'admpr_stock_'+id}],[{text:'🖼 Foto',callback_data:'admpr_photo_'+id},{text:'Remover foto',callback_data:'admpr_clearphoto_'+id}],[{text:'Preço',callback_data:'admpr_preco_'+id},{text:'Nome',callback_data:'admpr_nome_'+id}],[{text:'Descrição',callback_data:'admpr_descricao_'+id},{text:'Duração',callback_data:'admpr_duration_'+id}],[{text:'Tipo de entrega',callback_data:'admpr_delivery_type_'+id},{text:'Ativar/desativar',callback_data:'admpr_toggle_'+id}],[{text:'⬅️ Produtos Premium',callback_data:'admpr_menu'}]]}});}
  const rows=await products();return d.bot().sendMessage(chat,'⭐ Assinaturas Premium — Administração\n\nCadastro e estoque silenciosos. Nenhum aviso é enviado aos clientes.',{reply_markup:{inline_keyboard:[...rows.map(p=>[{text:`${p.nome} (${p.stock})`,callback_data:'admpr_view_'+p.id}]),[{text:'➕ Novo produto',callback_data:'admpr_new'}],[{text:'⬅️ Painel',callback_data:'admin_inicio'}]]}});
 }
 async function adminCallback(chat,user,data){
  if(!data.startsWith('admpr_')){adminSessions.delete(String(user));return false;}if(String(user)!==String(d.adminId())||String(chat)!==String(user))throw new Error('Acesso somente pelo administrador no privado.');
  adminSessions.delete(String(user));
  if(data==='admpr_menu'){adminSessions.delete(String(user));await adminMenu(chat);return true;}
  if(data==='admpr_new'){adminSessions.set(String(user),{action:'new'});await d.bot().sendMessage(chat,'Envie o nome do novo produto. Preço inicial: R$ 100,00 (editável).');return true;}
  const m=data.match(/^admpr_(view|stock|photo|clearphoto|nome|preco|descricao|duration|delivery_type|toggle)_(\d+)$/);if(!m)return true;const id=Number(m[2]),action=m[1],p=await product(id);if(!p)throw new Error('Produto não encontrado.');
  if(action==='view'){await adminMenu(chat,id);return true;}if(action==='toggle'){await editProduct(id,{ativo:!p.ativo});await adminMenu(chat,id);return true;}if(action==='clearphoto'){await run('UPDATE premium_products SET photo=NULL WHERE id=?',[id]);await adminMenu(chat,id);return true;}
  adminSessions.set(String(user),{action,id});await d.bot().sendMessage(chat,action==='stock'?'Envie o texto de uma unidade. Pode ter várias linhas. Envie outras mensagens para adicionar mais unidades. Digite FINALIZAR para encerrar.':action==='photo'?'Envie a foto do produto como imagem (PNG ou JPG).':'Envie o novo valor de '+({nome:'nome',preco:'preço em reais',descricao:'descrição',duration:'duração',delivery_type:'tipo de entrega'}[action])+'.');return true;
 }
 async function adminMessage(msg){
  const user=String(msg.from?.id||''),sess=adminSessions.get(user);if(user!==String(d.adminId())||!sess)return false;if(String(msg.chat?.id)!==user)return true;
  const text=String(msg.text||'').trim();if(['cancelar','finalizar','voltar','/menu','/admin'].includes(text.toLowerCase())){adminSessions.delete(user);await adminMenu(msg.chat.id);return true;}
  try{if(sess.action==='stock'){await addStock(sess.id,text,`telegram:${user}:${msg.message_id}`);await d.bot().sendMessage(msg.chat.id,`✅ Texto salvo. Estoque: ${(await product(sess.id)).stock}. Envie o próximo ou FINALIZAR.`);return true;}
   if(sess.action==='photo'){const photo=msg.photo?.at(-1);if(!photo)throw new Error('Envie uma foto como imagem.');const tmp=await d.bot().downloadFile(photo.file_id,dir);try{await attachPhoto(sess.id,fs.readFileSync(tmp));}finally{if(path.dirname(path.resolve(tmp))===path.resolve(dir))fs.unlinkSync(tmp);}}
   else if(sess.action==='new')sess.id=await createProduct(text);
   else await editProduct(sess.id,{[sess.action]:text});
   adminSessions.delete(user);await d.bot().sendMessage(msg.chat.id,'✅ Salvo. Nenhum aviso enviado aos clientes.');await adminMenu(msg.chat.id,sess.id);
  }catch(e){await d.bot().sendMessage(msg.chat.id,sess.action==='photo'?'Não foi possível salvar a foto. Envie uma imagem PNG ou JPG de até 5 MB.':e.message);}return true;
 }
 function csrf(){return crypto.createHmac('sha256',key()).update('premium-admin').digest('hex');}
 function routes(app){
  const h=d.safeHtml,guard=(req,res,next)=>{const v=String(req.body.csrf||''),expected=csrf();if(v.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(v),Buffer.from(expected)))return res.sendStatus(403);next();};
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.redirect('/admin/premium?erro='+encodeURIComponent(e.message));}};
  const form=(action,body)=>`<form method="post" action="${action}"><input type="hidden" name="csrf" value="${csrf()}">${body}</form>`;
  app.get('/admin/premium',wrap(async(req,res)=>{res.set('Cache-Control','no-store');const rows=await products();res.send(d.page('Assinaturas Premium',`<h1>⭐ Assinaturas Premium</h1><p>Estoque de texto compartilhado pelo Telegram e WhatsApp. Cadastro silencioso, sem avisos aos clientes.</p><p>${h(req.query.ok||req.query.erro||'')}</p><div class="card"><h2>Novo produto</h2>${form('/admin/premium/new','<label>Nome</label><input name="nome" required><label>Preço R$</label><input type="number" name="preco" value="100" step="0.01" min="0.01" required><label>Duração</label><input name="duration" value="18 meses"><label>Você recebe</label><input name="delivery_type" value="Link"><label>Descrição</label><textarea name="descricao" maxlength="2500"></textarea><button>Cadastrar produto</button>')}</div>${rows.map(p=>`<div class="card"><h2>${h(p.nome)}</h2><p>📦 ${p.stock} unidades disponíveis</p>${p.photo?`<img src="/admin/premium/photo/${p.id}" style="max-width:260px;max-height:180px" alt="Foto do produto">`:''}${form('/admin/premium/edit/'+p.id,`<label>Nome</label><input name="nome" value="${h(p.nome)}" required><label>Preço R$</label><input type="number" name="preco" value="${p.preco_padrao}" step="0.01" min="0.01" required><label>Duração</label><input name="duration" value="${h(p.duration)}"><label>Você recebe</label><input name="delivery_type" value="${h(p.delivery_type)}"><label>Descrição</label><textarea name="descricao" maxlength="2500">${h(p.descricao)}</textarea><label><input type="checkbox" name="ativo" value="1" ${p.ativo?'checked':''}> Ativo</label><button>Salvar produto</button>`)}<h3>Adicionar uma unidade de estoque</h3>${form('/admin/premium/stock/'+p.id,`<input type="hidden" name="source" value="${crypto.randomUUID()}"><textarea name="texto" maxlength="3500" required placeholder="Cole o texto completo. Todas as linhas pertencem à mesma unidade."></textarea><button>Adicionar texto ao estoque</button>`)}<h3>Foto opcional no Telegram</h3><form method="post" enctype="multipart/form-data" action="/admin/premium/photo/${p.id}"><input type="hidden" name="csrf" value="${csrf()}"><input type="file" name="foto" accept="image/png,image/jpeg" required><button>Salvar foto</button></form>${form('/admin/premium/photo/'+p.id+'/remove','<button>Remover foto</button>')}</div>`).join('')}`));}));
  app.post('/admin/premium/new',guard,wrap(async(req,res)=>{await createProduct(req.body.nome,req.body.preco,req.body.descricao,req.body.duration,req.body.delivery_type);res.redirect('/admin/premium?ok=Produto+salvo');}));
  app.post('/admin/premium/edit/:id',guard,wrap(async(req,res)=>{await editProduct(req.params.id,{...req.body,ativo:req.body.ativo==='1'});res.redirect('/admin/premium?ok=Produto+atualizado');}));
  app.post('/admin/premium/stock/:id',guard,wrap(async(req,res)=>{if(!/^[a-f0-9-]{36}$/.test(req.body.source||''))throw new Error('Solicitação inválida.');await addStock(req.params.id,req.body.texto,'panel:'+req.body.source);res.redirect('/admin/premium?ok=Estoque+adicionado+sem+avisos');}));
  const upload=d.multer({storage:d.multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}}).single('foto');
  app.post('/admin/premium/photo/:id',(req,res,next)=>upload(req,res,e=>e?res.status(400).send('Envie uma foto de até 5 MB.'):next()),guard,wrap(async(req,res)=>{if(!req.file)throw new Error('Selecione uma foto.');await attachPhoto(req.params.id,req.file.buffer);res.redirect('/admin/premium?ok=Foto+salva');}));
  app.post('/admin/premium/photo/:id/remove',guard,wrap(async(req,res)=>{await run('UPDATE premium_products SET photo=NULL WHERE id=?',[req.params.id]);res.redirect('/admin/premium?ok=Foto+removida');}));
  app.get('/admin/premium/photo/:id',wrap(async(req,res)=>{const p=await product(req.params.id);if(!p?.photo)return res.sendStatus(404);res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.sendFile(path.join(dir,path.basename(p.photo)));}));
  app.get('/cliente/premium/:id',d.clienteAuth,async(req,res)=>{try{const st=await get('SELECT st.content_enc,p.id FROM premium_stock st JOIN pedidos p ON p.id=st.pedido_id WHERE p.id=? AND p.revenda_id=?',[req.params.id,req.cliente.id]);if(!st)return res.sendStatus(404);res.set('Cache-Control','no-store');res.send(d.clientePage('Entrega da assinatura',`<div class="cu-card"><h1>Pedido #${Number(st.id)}</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${h(decrypt(st.content_enc))}</pre></div>`,req.cliente));}catch(_){res.sendStatus(500);}});
 }
 return {init,routes,products,product,createProduct,editProduct,addStock,attachPhoto,purchase,deliver,recover,card,list,show,confirm,waMessage,clientCallback,adminCallback,adminMessage,encrypt,decrypt};
};
