'use strict';
const crypto = require('crypto');
const BASE = '/admin/whatsapp-aquecidos';
const PLANOS = require('./whatsapp-aquecidos-planos');
module.exports = function({run,get,all,page,safeHtml:esc,brl,getBot,cadastrarClienteTelegram,avisarAdmin,notificarPainel,getSessions=()=>[]}) {
  const csrf=crypto.randomBytes(32).toString('hex');
  const token=()=>`<input type="hidden" name="waq_token" value="${csrf}">`;
  const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
  let timer=null, working=false;
  const labels={NUMERO_ENTREGUE:'Número entregue',AGUARDANDO_CODIGO:'Aguardando código',CODIGO_RECEBIDO:'Código recebido',CODIGO_ENTREGUE:'Código entregue',CONCLUIDO:'Concluído',CANCELADO:'Cancelado'};
  const id=v=>{if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)<1)throw Error('Identificador inválido.');return Number(v)};
  const number=require('./whatsapp-aquecidos-numero');
  const buttons=rows=>({reply_markup:{inline_keyboard:rows}});
  const back={text:'⬅️ Menu principal',callback_data:'menu_voltar'};
  const send=async(chat,text,rows=[])=>{const bot=getBot();if(!bot)throw Error('Telegram não conectado.');return bot.sendMessage(String(chat),text,buttons(rows))};
  function code(text) {
    if(!/whats\s*app/i.test(text))return null;
    const matches=[...String(text).matchAll(/(?<!\d)(\d{3})[ -]?(\d{3})(?!\d)/g)];
    if(matches.length!==1)return null;
    return matches[0][1]+matches[0][2];
  }
  async function init(){
    await run(`CREATE TABLE IF NOT EXISTS waq_checkout(token TEXT PRIMARY KEY,cliente_id INTEGER NOT NULL,estoque_id INTEGER NOT NULL,preco REAL NOT NULL,expira INTEGER NOT NULL)`);
    await run(`CREATE TABLE IF NOT EXISTS waq_pedidos(id INTEGER PRIMARY KEY AUTOINCREMENT,checkout_token TEXT NOT NULL UNIQUE,estoque_id INTEGER NOT NULL UNIQUE,cliente_id INTEGER NOT NULL,telegram_id TEXT NOT NULL,numero TEXT NOT NULL,valor REAL NOT NULL,status TEXT NOT NULL DEFAULT 'NUMERO_ENTREGUE',aguardando_em INTEGER,expira INTEGER,codigo TEXT,origem TEXT,codigo_em INTEGER,criado_em TEXT DEFAULT CURRENT_TIMESTAMP,atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP)`);
    await run(`CREATE TABLE IF NOT EXISTS waq_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,pedido_id INTEGER NOT NULL,tipo TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDENTE',tentativas INTEGER NOT NULL DEFAULT 0,ultima_tentativa INTEGER NOT NULL DEFAULT 0,erro TEXT,UNIQUE(pedido_id,tipo))`);
    await run(`CREATE TABLE IF NOT EXISTS waq_recepcao(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,pedido_id INTEGER NOT NULL,origem TEXT NOT NULL,remetente TEXT NOT NULL,codigo TEXT,confiavel INTEGER NOT NULL,recebido_em INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'REVISAO')`);
    await run(`CREATE TABLE IF NOT EXISTS waq_config(chave TEXT PRIMARY KEY,valor TEXT NOT NULL)`);
    await run('DROP TRIGGER IF EXISTS waq_comprar_validar');
    await run(`CREATE TRIGGER IF NOT EXISTS waq_comprar_validar BEFORE INSERT ON waq_pedidos BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM waq_checkout c WHERE c.token=NEW.checkout_token AND c.cliente_id=NEW.cliente_id AND c.estoque_id=NEW.estoque_id AND c.preco=NEW.valor AND c.expira>CAST(strftime('%s','now') AS INTEGER)*1000) THEN RAISE(ABORT,'Confirmação expirada. Escolha novamente.') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM whatsapp_aquecidos_estoque e WHERE e.id=NEW.estoque_id AND e.status='DISPONIVEL' AND e.numero=NEW.numero AND e.preco=NEW.valor AND ((e.aquecimento_dias=30 AND e.preco=40) OR (e.aquecimento_dias=120 AND e.preco=90)) AND EXISTS(SELECT 1 FROM whatsapp_sessoes s WHERE s.id=e.whatsapp_sessao_id AND s.ativo=1 AND s.funcao_codigos=1)) THEN RAISE(ABORT,'Número indisponível ou preço alterado. Escolha novamente.') END;
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revendas r WHERE r.id=NEW.cliente_id AND r.status='ATIVA' AND r.telegram_id=NEW.telegram_id AND r.saldo>=NEW.valor) THEN RAISE(ABORT,'Saldo insuficiente ou cadastro inativo. Adicione saldo no menu.') END;
    END`);
    await run(`CREATE TRIGGER IF NOT EXISTS waq_comprar_finalizar AFTER INSERT ON waq_pedidos BEGIN
      UPDATE whatsapp_aquecidos_estoque SET status='VENDIDO',atualizado_em=CURRENT_TIMESTAMP WHERE id=NEW.estoque_id;
      UPDATE revendas SET saldo=ROUND(saldo-NEW.valor,2),atualizado_em=CURRENT_TIMESTAMP WHERE id=NEW.cliente_id;
      INSERT INTO waq_outbox(pedido_id,tipo) VALUES(NEW.id,'NUMERO');
    END`);
    await run(`CREATE TRIGGER IF NOT EXISTS waq_proteger_estoque BEFORE UPDATE OF numero,preco,status ON whatsapp_aquecidos_estoque WHEN EXISTS(SELECT 1 FROM waq_pedidos p WHERE p.estoque_id=OLD.id) AND (NEW.numero<>OLD.numero OR NEW.preco<>OLD.preco OR (NEW.status<>OLD.status AND NOT (OLD.status='DISPONIVEL' AND NEW.status='VENDIDO'))) BEGIN SELECT RAISE(ABORT,'Este número possui uma venda. Gerencie o pedido na aba Pedidos.'); END`);
    await run(`CREATE TRIGGER IF NOT EXISTS waq_proteger_exclusao BEFORE DELETE ON whatsapp_aquecidos_estoque WHEN EXISTS(SELECT 1 FROM waq_pedidos p WHERE p.estoque_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Este número possui histórico de venda e não pode ser apagado.'); END`);
    await run(`CREATE TRIGGER IF NOT EXISTS waq_estorno AFTER UPDATE OF status ON waq_pedidos WHEN NEW.status='CANCELADO' AND OLD.status<>'CANCELADO' BEGIN
      UPDATE revendas SET saldo=ROUND(saldo+OLD.valor,2),atualizado_em=CURRENT_TIMESTAMP WHERE id=OLD.cliente_id;
      UPDATE waq_outbox SET status='CANCELADO' WHERE pedido_id=OLD.id AND status<>'ENVIADO';
    END`);
    if(await get("SELECT name FROM sqlite_master WHERE type='table' AND name='waq_android'"))await run('UPDATE waq_android SET ativo=0');
    await run("UPDATE waq_recepcao SET status='IGNORADO',codigo=NULL WHERE origem NOT IN ('WHATSAPP','ANDROID_CAPTURA') AND status='REVISAO'");
    await android.init();
    // A venda fica no histórico e o número não volta automaticamente ao estoque após estorno.
  }
  function availableWhere(){
    const pairs=[];
    for(const s of getSessions())if(s.conectado&&s.funcaoCodigos&&Number.isSafeInteger(Number(s.id))&&Number(s.id)>0){try{pairs.push(`(whatsapp_sessao_id=${Number(s.id)} AND numero='${number(s.numero)}')`)}catch(_) {}}
    return `status='DISPONIVEL' AND ((aquecimento_dias=30 AND preco=40) OR (aquecimento_dias=120 AND preco=90)) AND (${pairs.length?pairs.join(' OR '):'0'}) AND EXISTS(SELECT 1 FROM whatsapp_sessoes s WHERE s.id=whatsapp_sessao_id AND s.ativo=1 AND s.funcao_codigos=1)`;
  }
  async function menu(chat,cliente){
    return send(chat,`📱 WHATSAPP AQUECIDOS\n\nOlá, ${cliente.nome || 'cliente'}!\n30 dias aquecidos: ${brl(PLANOS[30].preco)}\n120 dias aquecidos: ${brl(PLANOS[120].preco)}\n💰 Saldo: ${brl(cliente.saldo)}\n\nEscolha uma opção:`,[[{text:'📍 Comprar por DDD',callback_data:'waq_ddds'}],[{text:'🎲 Comprar aleatório',callback_data:'waq_random'}],[{text:'📦 Meus pedidos',callback_data:'waq_orders'}],[{text:'💳 Adicionar saldo',callback_data:'menu_pagar'},{text:'🆘 Suporte',callback_data:'menu_suporte'}],[back]]);
  }
  async function orders(chat,cliente){
    const rows=await all('SELECT * FROM waq_pedidos WHERE cliente_id=? ORDER BY id DESC LIMIT 30',[cliente.id]);
    return send(chat,'📦 MEUS PEDIDOS\n\n'+(rows.length?'Escolha para ver o número e acompanhar a ativação.':'Você ainda não comprou um número.'),[...rows.map(p=>[{text:`#${p.id} · ${labels[p.status]} · ${brl(p.valor)}`,callback_data:`waq_order_${p.id}`}]),[{text:'⬅️ WhatsApp aquecidos',callback_data:'waq_home'}]]);
  }
  async function order(chat,cliente,pid){
    const p=await get('SELECT * FROM waq_pedidos WHERE id=? AND cliente_id=?',[pid,cliente.id]);if(!p)throw Error('Pedido não encontrado.');
    const rows=[];
    if(['NUMERO_ENTREGUE','AGUARDANDO_CODIGO'].includes(p.status))rows.push([{text:p.status==='AGUARDANDO_CODIGO'&&p.expira>Date.now()?'⏳ Verificar código':'🔑 Solicitar código',callback_data:`waq_request_${p.id}`}]);
    if(p.status==='CODIGO_RECEBIDO'||p.status==='CODIGO_ENTREGUE')rows.push([{text:'🔄 Reenviar código',callback_data:`waq_resend_${p.id}`}],[{text:'✅ Ativação concluída',callback_data:`waq_done_${p.id}`}]);
    rows.push([{text:'🆘 Preciso de ajuda',callback_data:'menu_suporte'}],[{text:'⬅️ Meus pedidos',callback_data:'waq_orders'}]);
    return send(chat,`📱 Pedido #${p.id}\nNúmero: +${p.numero}\nValor: ${brl(p.valor)}\nSituação: ${labels[p.status]}\n\n${p.status==='CANCELADO'?'Valor estornado para o saldo.':'Informe este número no WhatsApp do seu celular para solicitar a ativação. O botão abaixo acompanha o recebimento; ele não solicita o código ao WhatsApp.'}`,rows);
  }
  async function callback(q){
    let data=String(q.data||'');if(!data.startsWith('waq_'))return false;
    const bot=getBot(),chat=q.message?.chat?.id;
    if(String(chat)!==String(q.from.id)){await bot.answerCallbackQuery(q.id,{text:'Use este menu no privado do bot.',show_alert:true});return true}
    await bot.answerCallbackQuery(q.id);
    try{
      const {cliente}=await cadastrarClienteTelegram(q.from);
      if(cliente.status!=='ATIVA')throw Error('Seu cadastro precisa estar ativo para comprar.');
      if(data==='waq_random'){const e=await get(`SELECT id FROM whatsapp_aquecidos_estoque WHERE ${availableWhere()} ORDER BY RANDOM() LIMIT 1`);if(!e)throw Error('Estoque indisponível no momento.');data='waq_offer_'+e.id;}
      if(data==='waq_home')await menu(chat,cliente);
      else if(data==='waq_orders')await orders(chat,cliente);
      else if(data==='waq_ddds'){
        const rows=await all(`SELECT ddd,COUNT(*) qtd FROM whatsapp_aquecidos_estoque WHERE ${availableWhere()} GROUP BY ddd ORDER BY ddd`);
        await send(chat,rows.length?'📍 Escolha o DDD:':'Estoque indisponível no momento.',[...rows.map(r=>[{text:`DDD ${r.ddd} · ${r.qtd} disponíveis`,callback_data:`waq_list_${r.ddd}_0`}]),[{text:'⬅️ Voltar',callback_data:'waq_home'}]]);
      }else{
        let m;
        if((m=data.match(/^waq_list_(all|\d{2})_(\d+)$/))){
          const offset=Math.min(Number(m[2]),100000);const params=m[1]==='all'?[]:[m[1]];
          const rows=await all(`SELECT ddd,preco,aquecimento_dias,MIN(id) id,COUNT(*) qtd FROM whatsapp_aquecidos_estoque WHERE ${availableWhere()} ${params.length?'AND ddd=?':''} GROUP BY ddd,preco,aquecimento_dias ORDER BY ddd,preco,aquecimento_dias LIMIT 16 OFFSET ?`,[...params,offset]);
          const kb=rows.slice(0,15).map(r=>[{text:`DDD ${r.ddd} · ${r.aquecimento_dias} dias · ${brl(r.preco)} · ${r.qtd} un.`,callback_data:`waq_offer_${r.id}`}]);
          if(rows.length>15)kb.push([{text:'Próxima página',callback_data:`waq_list_${m[1]}_${offset+15}`}]);
          if(offset)kb.push([{text:'Anterior',callback_data:`waq_list_${m[1]}_${Math.max(0,offset-15)}`}]);
          kb.push([{text:'⬅️ Voltar',callback_data:'waq_home'}]);await send(chat,'📱 Escolha uma oferta. O número completo é liberado após a compra.',kb);
        }else if((m=data.match(/^waq_offer_(\d+)$/))){
          const e=await get(`SELECT * FROM whatsapp_aquecidos_estoque WHERE id=? AND ${availableWhere()}`,[id(m[1])]);if(!e)throw Error('Esta oferta acabou. Escolha novamente.');
          const t=crypto.randomBytes(12).toString('hex');
          await run('INSERT INTO waq_checkout(token,cliente_id,estoque_id,preco,expira) VALUES(?,?,?,?,?)',[t,cliente.id,e.id,e.preco,Date.now()+300000]);
          await send(chat,`📱 Detalhes\nDDD: ${e.ddd}\nAquecimento informado: ${e.aquecimento_dias} dias\nPreço: ${brl(e.preco)}\nSeu saldo: ${brl(cliente.saldo)}\n\nAo confirmar, o valor será descontado do saldo. Disponibilidade conferida na confirmação.`,[[{text:'✅ Confirmar compra',callback_data:'waq_buy_'+t}],[{text:'❌ Cancelar',callback_data:'waq_home'}]]);
        }else if((m=data.match(/^waq_buy_([a-f0-9]{24})$/))){
          let p=await get('SELECT * FROM waq_pedidos WHERE checkout_token=? AND cliente_id=?',[m[1],cliente.id]);
          if(!p){
            const c=await get('SELECT c.*,e.numero FROM waq_checkout c JOIN whatsapp_aquecidos_estoque e ON e.id=c.estoque_id WHERE c.token=? AND c.cliente_id=?',[m[1],cliente.id]);if(!c)throw Error('Confirmação não encontrada. Escolha novamente.');
            if(!await get(`SELECT id FROM whatsapp_aquecidos_estoque WHERE id=? AND ${availableWhere()}`,[c.estoque_id]))throw Error('Número indisponível ou WhatsApp desconectado. Escolha novamente.');
            try{await run('INSERT INTO waq_pedidos(checkout_token,estoque_id,cliente_id,telegram_id,numero,valor) VALUES(?,?,?,?,?,?)',[c.token,c.estoque_id,cliente.id,String(q.from.id),c.numero,c.preco])}catch(e){p=await get('SELECT * FROM waq_pedidos WHERE checkout_token=? AND cliente_id=?',[m[1],cliente.id]);if(!p)throw e}
            p=p||await get('SELECT * FROM waq_pedidos WHERE checkout_token=?',[m[1]]);
            try{notificarPainel('whatsapp-aquecidos','📱 Número vendido',`Pedido #${p.id}`)}catch(_){}
          }
          await order(chat,cliente,p.id);await flush();
        }else if((m=data.match(/^waq_order_(\d+)$/)))await order(chat,cliente,id(m[1]));
        else if((m=data.match(/^waq_request_(\d+)$/))){
          const pid=id(m[1]), now=Date.now();
          const p=await get('SELECT * FROM waq_pedidos WHERE id=? AND cliente_id=?',[pid,cliente.id]);if(!p)throw Error('Pedido não encontrado.');
          if(!['NUMERO_ENTREGUE','AGUARDANDO_CODIGO'].includes(p.status)){await order(chat,cliente,pid);return true}
          const r=await run(`UPDATE waq_pedidos SET status='AGUARDANDO_CODIGO',aguardando_em=?,expira=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=? AND status IN ('NUMERO_ENTREGUE','AGUARDANDO_CODIGO') AND (expira IS NULL OR expira<=?)`,[now,now+600000,pid,cliente.id,now]);
          await send(chat,'⏳ Aguardando código por até 10 minutos. Solicite a ativação no WhatsApp do seu celular. Se o prazo terminar, você pode abrir uma nova espera.',[[{text:'📦 Ver pedido',callback_data:`waq_order_${pid}`}]]);
          if(r.changes)await avisarAdmin(`🔑 Pedido #${pid} aguarda código para +${p.numero}.`).catch(()=>{});
        }else if((m=data.match(/^waq_resend_(\d+)$/))){
          const p=await get('SELECT * FROM waq_pedidos WHERE id=? AND cliente_id=?',[id(m[1]),cliente.id]);
          if(!p||!['CODIGO_RECEBIDO','CODIGO_ENTREGUE'].includes(p.status)||!p.codigo||p.codigo_em+600000<Date.now())throw Error('Código indisponível ou expirado. Procure o suporte.');
          await send(chat,`🔑 Código do pedido #${p.id}\nNúmero: +${p.numero}\nCódigo: ${p.codigo}`);
        }else if((m=data.match(/^waq_done_(\d+)$/))){
          const r=await run(`UPDATE waq_pedidos SET status='CONCLUIDO',codigo=NULL,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=? AND status='CODIGO_ENTREGUE'`,[id(m[1]),cliente.id]);if(!r.changes)throw Error('Aguarde a entrega do código antes de concluir.');await order(chat,cliente,id(m[1]));
        }
      }
    }catch(e){await send(chat,'⚠️ '+e.message,[[{text:'💳 Adicionar saldo',callback_data:'menu_pagar'}],[{text:'⬅️ WhatsApp aquecidos',callback_data:'waq_home'}]])}
    return true;
  }
  async function accept(pid,codigo,origem){
    if(!['WHATSAPP','ANDROID_CAPTURA'].includes(origem))throw Error('A captura é somente pela conta WhatsApp conectada.');
    if(!/^\d{6}$/.test(codigo))throw Error('Informe os seis dígitos do código.');
    const now=Date.now();
    const r=await run(`UPDATE waq_pedidos SET codigo=?,origem=?,codigo_em=?,status='CODIGO_RECEBIDO',atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status='AGUARDANDO_CODIGO' AND expira>?`,[codigo,origem,now,pid,now]);
    if(!r.changes)throw Error('O pedido não está aguardando código, já recebeu um código ou a espera expirou.');
    // O worker recria a saída faltante se o processo parar entre as duas gravações.
    await run(`INSERT OR IGNORE INTO waq_outbox(pedido_id,tipo) VALUES(?,'CODIGO')`,[pid]);
    await flush();
  }
  async function receive({numero,texto,origem,remetente,eventKey,receivedAt,trusted}){
    if(origem!=='WHATSAPP')return {ignored:true};
    const now=Date.now(),at=Number(receivedAt);
    if(!Number.isFinite(at)||at>now+30000||at<now-600000)return {ignored:true};
    const c=code(String(texto).slice(0,2000));if(!c)return {ignored:true};
    const p=await get(`SELECT * FROM waq_pedidos WHERE numero=? AND status='AGUARDANDO_CODIGO' AND aguardando_em<=? AND expira>?`,[numero,at+1000,now]);if(!p)return {ignored:true};
    const key=hash(origem+'|'+numero+'|'+eventKey);
    const r=await run(`INSERT OR IGNORE INTO waq_recepcao(event_key,pedido_id,origem,remetente,codigo,confiavel,recebido_em) VALUES(?,?,?,?,?,?,?)`,[key,p.id,origem,String(remetente).slice(0,150),c,trusted?1:0,now]);
    if(!r.changes)return {duplicate:true};
    if(trusted){try{await accept(p.id,c,origem);await run("UPDATE waq_recepcao SET status='ACEITO',codigo=NULL WHERE event_key=?",[key])}catch(e){await run("UPDATE waq_recepcao SET status='IGNORADO',codigo=NULL WHERE event_key=?",[key]);throw e}}
    else await avisarAdmin(`⚠️ Código recebido para pedido #${p.id}. Revise o remetente no painel antes de enviar.`).catch(()=>{});
    return {ok:true,review:!trusted};
  }
  async function whatsapp(sessao,msg){
    if(msg?.key?.fromMe||!sessao?.numero||!sessao.funcaoCodigos||!sessao.conectado)return false;
    const jid=String(msg?.key?.remoteJid||'');if(!jid||jid.endsWith('@g.us')||jid==='status@broadcast')return false;
    const e=await get('SELECT numero FROM whatsapp_aquecidos_estoque WHERE whatsapp_sessao_id=? AND numero=?',[sessao.id,number(sessao.numero)]);if(!e)return false;
    const message=msg.message?.ephemeralMessage?.message||msg.message;
    const texto=message?.conversation||message?.extendedTextMessage?.text||'';if(!code(texto))return false;
    const cfg=await get("SELECT valor FROM waq_config WHERE chave='wa_remetentes'");
    const allowed=String(cfg?.valor||'').split(/[\s,;]+/).filter(Boolean);
    await receive({numero:e.numero,texto,origem:'WHATSAPP',remetente:jid,eventKey:String(msg.key.id),receivedAt:Number(msg.messageTimestamp)*1000,trusted:allowed.includes(jid)});
    return true;
  }
  async function flush(){
    if(working||!getBot())return;working=true;
    try{
      const now=Date.now();
      await run("UPDATE waq_outbox SET status='PENDENTE' WHERE status='ENVIANDO' AND ultima_tentativa<?",[now-120000]);
      await run("INSERT OR IGNORE INTO waq_outbox(pedido_id,tipo) SELECT id,'CODIGO' FROM waq_pedidos WHERE status='CODIGO_RECEBIDO'");
      await run('DELETE FROM waq_checkout WHERE expira<? AND token NOT IN (SELECT checkout_token FROM waq_pedidos)',[now]);
      await run("UPDATE waq_pedidos SET codigo=NULL WHERE codigo_em<?",[now-600000]);
      await run("UPDATE waq_recepcao SET codigo=NULL,status='EXPIRADO' WHERE codigo IS NOT NULL AND recebido_em<?",[now-600000]);
      const rows=await all(`SELECT o.id outbox_id,o.tipo,o.tentativas,p.* FROM waq_outbox o JOIN waq_pedidos p ON p.id=o.pedido_id WHERE o.status='PENDENTE' AND o.tentativas<5 AND o.ultima_tentativa<? AND p.status<>'CANCELADO' ORDER BY o.id LIMIT 20`,[now-15000]);
      for(const p of rows){
        if(p.tipo==='CODIGO'&&(!p.codigo||p.codigo_em+600000<now)){await run("UPDATE waq_outbox SET status='EXPIRADO' WHERE id=?",[p.outbox_id]);continue}
        const claim=await run("UPDATE waq_outbox SET status='ENVIANDO',tentativas=tentativas+1,ultima_tentativa=? WHERE id=? AND status='PENDENTE'",[now,p.outbox_id]);if(!claim.changes)continue;
        try{
          const text=p.tipo==='NUMERO'?`✅ Compra concluída!\nPedido #${p.id}\n📱 Número: +${p.numero}\n💰 Valor: ${brl(p.valor)}\n\nSolicite a ativação no WhatsApp do seu celular e toque em Solicitar código.`:`✅ Código recebido!\nPedido #${p.id}\n📱 Número: +${p.numero}\n🔑 Código: ${p.codigo}\n\nInforme no WhatsApp para concluir a ativação.`;
          await send(p.telegram_id,text,[[{text:'📦 Ver pedido',callback_data:`waq_order_${p.id}`}]]);
          await run("UPDATE waq_outbox SET status='ENVIADO',erro=NULL WHERE id=?",[p.outbox_id]);
          if(p.tipo==='CODIGO')await run("UPDATE waq_pedidos SET status='CODIGO_ENTREGUE',atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status='CODIGO_RECEBIDO'",[p.id]);
        }catch(e){await run("UPDATE waq_outbox SET status='PENDENTE',erro=? WHERE id=?",[String(e.message).slice(0,300),p.outbox_id])}
      }
      // Reconcilia confirmação já registrada se houve reinício antes de atualizar o pedido.
      await run("UPDATE waq_pedidos SET status='CODIGO_ENTREGUE' WHERE status='CODIGO_RECEBIDO' AND EXISTS(SELECT 1 FROM waq_outbox o WHERE o.pedido_id=waq_pedidos.id AND o.tipo='CODIGO' AND o.status='ENVIADO')");
    }finally{working=false}
  }
  function start(){if(!timer){timer=setInterval(()=>flush().catch(e=>console.log('⚠️ Entrega WhatsApp aquecidos:',e.message)),10000);timer.unref();flush().catch(()=>{})}}
  const nav=()=>`<div class="card"><a class="btn" href="${BASE}">Estoque</a> <a class="btn" href="${BASE}/pedidos">Pedidos e códigos</a> <a class="btn" href="${BASE}/integracao">Recebimento WhatsApp</a> <a class="btn" href="${BASE}/android">Captura Android</a></div>`;
  function route(handler){return async(req,res)=>{try{if(req.method==='POST'&&req.body.waq_token!==csrf)return res.status(403).send('Reabra a página para atualizar o formulário.');await handler(req,res)}catch(e){res.status(400).send(page('Verifique os dados',`${nav()}<div class="card">⚠️ ${esc(e.message)}</div>`))}}}
  const android=require('./whatsapp-aquecidos-android')({run,get,all,page,esc,token,guard:route,nav,getSessions,accept});
  function routes(app){
    android.routes(app);
    app.get(BASE+'/pedidos',route(async(req,res)=>{
      const status=Object.hasOwn(labels,req.query.status)?req.query.status:'';
      const ps=await all(`SELECT p.*,r.nome FROM waq_pedidos p LEFT JOIN revendas r ON r.id=p.cliente_id ${status?'WHERE p.status=?':''} ORDER BY p.id DESC LIMIT 200`,status?[status]:[]);
      let html=`${nav()}<h1>📦 Pedidos WhatsApp aquecidos</h1><form method="get"><select name="status"><option value="">Todas as situações</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${status===k?'selected':''}>${v}</option>`).join('')}</select><button class="btn">Filtrar</button></form>`;
      for(const p of ps){
        const inputs=await all("SELECT * FROM waq_recepcao WHERE pedido_id=? AND status='REVISAO' AND codigo IS NOT NULL ORDER BY id DESC LIMIT 10",[p.id]);
        const out=await all('SELECT tipo,status,tentativas,erro FROM waq_outbox WHERE pedido_id=?',[p.id]);
        html+=`<div class="card"><h2>#${p.id} · +${esc(p.numero)}</h2><p>${esc(p.nome||'Cliente')} · ${brl(p.valor)} · <b>${esc(labels[p.status])}</b></p><p>Origem: ${esc(p.origem||'—')} · ${p.expira?`Espera: ${p.expira>Date.now()?'aberta':'expirada'}`:'Sem solicitação'}</p>`;
        for(const e of inputs)html+=`<div class="card">Código <b>${esc(e.codigo)}</b> pendente de revisão · ${esc(e.origem)} · Remetente: <b>${esc(e.remetente)}</b><form method="post" action="${BASE}/recepcao/${e.id}/aprovar">${token()}<button class="btn">Aprovar e entregar</button></form><form method="post" action="${BASE}/recepcao/${e.id}/ignorar">${token()}<button class="btn gray">Ignorar</button></form></div>`;
        html+=`<p>${out.map(o=>`${esc(o.tipo)}: ${esc(o.status)} · tentativas ${o.tentativas}${o.erro?' · '+esc(o.erro):''}`).join('<br>')}</p>`;
        if(!['CONCLUIDO','CANCELADO'].includes(p.status))html+=`<form method="post" action="${BASE}/pedidos/${p.id}/reenviar">${token()}<button class="btn">Tentar entrega novamente</button></form>`;
        if(['NUMERO_ENTREGUE','AGUARDANDO_CODIGO'].includes(p.status))html+=`<form method="post" action="${BASE}/pedidos/${p.id}/cancelar" data-confirm="Cancelar e estornar o valor ao saldo do cliente?">${token()}<button class="btn red">Cancelar e estornar</button></form>`;
        html+='</div>';
      }
      res.send(page('Pedidos WhatsApp aquecidos',html+(ps.length?'':'<p>Nenhum pedido.</p>')));
    }));
    app.post(BASE+'/pedidos/:id/reenviar',route(async(req,res)=>{
      const pid=id(req.params.id),p=await get('SELECT * FROM waq_pedidos WHERE id=?',[pid]);if(!p||['CANCELADO','CONCLUIDO'].includes(p.status))throw Error('Pedido indisponível.');
      await run("UPDATE waq_outbox SET status='PENDENTE',tentativas=0,ultima_tentativa=0 WHERE pedido_id=? AND tipo='NUMERO' AND status<>'ENVIADO'",[pid]);
      if(p.codigo&&p.codigo_em+600000>Date.now())await run("UPDATE waq_outbox SET status='PENDENTE',tentativas=0,ultima_tentativa=0 WHERE pedido_id=? AND tipo='CODIGO'",[pid]);
      await flush();res.redirect(BASE+'/pedidos');
    }));
    app.post(BASE+'/pedidos/:id/cancelar',route(async(req,res)=>{
      const r=await run("UPDATE waq_pedidos SET status='CANCELADO',codigo=NULL,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status IN ('NUMERO_ENTREGUE','AGUARDANDO_CODIGO')",[id(req.params.id)]);if(!r.changes)throw Error('Pedido já cancelado ou com código recebido.');res.redirect(BASE+'/pedidos');
    }));
    app.post(BASE+'/recepcao/:id/aprovar',route(async(req,res)=>{
      const e=await get("SELECT e.* FROM waq_recepcao e JOIN waq_pedidos p ON p.id=e.pedido_id WHERE e.id=? AND e.status='REVISAO' AND e.recebido_em>? AND e.recebido_em>=p.aguardando_em",[id(req.params.id),Date.now()-600000]);if(!e?.codigo)throw Error('Código expirado ou já revisado.');await accept(e.pedido_id,e.codigo,e.origem);await run("UPDATE waq_recepcao SET status='ACEITO',codigo=NULL WHERE id=?",[e.id]);res.redirect(BASE+'/pedidos');
    }));
    app.post(BASE+'/recepcao/:id/ignorar',route(async(req,res)=>{await run("UPDATE waq_recepcao SET status='IGNORADO',codigo=NULL WHERE id=?",[id(req.params.id)]);res.redirect(BASE+'/pedidos')}));
    app.get(BASE+'/integracao',route(async(req,res)=>{
      const cfg=await get("SELECT valor FROM waq_config WHERE chave='wa_remetentes'");res.send(page('Recebimento WhatsApp',`${nav()}<h1>🔑 Recebimento WhatsApp</h1><div class="card"><p>Conecte a conta, marque Receber códigos e escolha o celular no estoque. O número é vinculado automaticamente. O sistema acompanha mensagens apenas para pedidos com espera aberta. A mensagem precisa conter WhatsApp e um único código de seis dígitos.</p><form method="post" action="${BASE}/integracao">${token()}<label>Remetentes WhatsApp confiáveis (JIDs exatos)<textarea name="remetentes" maxlength="2000" rows="4">${esc(cfg?.valor||'')}</textarea></label><p>Comece em branco. No teste real, uma mensagem acessível ficará para revisão em Pedidos e códigos. Após verificar sua origem, cadastre o remetente para entrega automática. Não há garantia de que mensagens internas de ativação apareçam na conexão.</p><button class="btn green">Salvar remetentes</button></form></div>`));
    }));
    app.post(BASE+'/integracao',route(async(req,res)=>{const v=String(req.body.remetentes||'').trim();if(v.length>2000)throw Error('Lista muito longa.');await run("INSERT INTO waq_config(chave,valor) VALUES('wa_remetentes',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",[v]);res.redirect(BASE+'/integracao')}));
  }
  return {init,routes,callback,whatsapp,start,nav,accept,receive,flush,code};
};
