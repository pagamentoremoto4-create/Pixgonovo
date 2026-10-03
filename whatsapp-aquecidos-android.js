 'use strict';
const crypto=require('crypto');
const BASE='/admin/whatsapp-aquecidos/android',API='/api/whatsapp-aquecidos/android';
module.exports=({run,get,all,page,esc,token,guard,nav,getSessions,accept})=>{
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 async function init(){await run(`CREATE TABLE IF NOT EXISTS waq_android_testes(id INTEGER PRIMARY KEY AUTOINCREMENT,aparelho_id INTEGER NOT NULL,inicio INTEGER NOT NULL,expira INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'AGUARDANDO',recebido_em INTEGER)`);await run(`CREATE TABLE IF NOT EXISTS waq_captura_android(id INTEGER PRIMARY KEY AUTOINCREMENT,sessao_id INTEGER NOT NULL,numero TEXT NOT NULL,nome TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,ativo INTEGER DEFAULT 1,automatico INTEGER DEFAULT 0,ultimo_contato INTEGER,criado_em INTEGER NOT NULL)`);}
 async function authenticate(req){
  const raw=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(raw))throw Error('UNAUTHORIZED');
  const d=await get('SELECT * FROM waq_captura_android WHERE token_hash=? AND ativo=1',[digest(raw)]);if(!d)throw Error('UNAUTHORIZED');
  const s=getSessions().find(s=>Number(s.id)===d.sessao_id&&s.conectado&&s.funcaoCodigos);
  const number=require('./whatsapp-aquecidos-numero');
  if(!s||number(s.numero)!==d.numero)throw Error('Conta desconectada ou vínculo alterado.');
  await run('UPDATE waq_captura_android SET ultimo_contato=? WHERE id=?',[Date.now(),d.id]);return d;
 }
 const api=f=>async(req,res)=>{res.setHeader?.('Cache-Control','no-store');try{await f(req,res)}catch(e){res.status(e.message==='UNAUTHORIZED'?401:409).json({error:e.message==='UNAUTHORIZED'?'Aparelho não autorizado.':e.message})}};
 function routes(app){
  app.get(BASE,guard(async(req,res)=>{
   const ds=await all('SELECT * FROM waq_captura_android ORDER BY id DESC');
   for(const d of ds)d.teste=await get('SELECT * FROM waq_android_testes WHERE aparelho_id=? ORDER BY id DESC LIMIT 1',[d.id]);
   const sessions=getSessions().filter(s=>s.conectado&&s.funcaoCodigos);
   res.send(page('Captura Android',`${nav()}<h1>Captura Android — versão para teste</h1><div class="card"><p>Uma conta WhatsApp por aparelho. Selecione somente o WhatsApp dessa conta na autorização de captura. O Android pode ocultar a janela de verificação. Não é necessário SMS ou acessibilidade.</p><form method="post" action="${BASE}/vincular">${token()}<label>WhatsApp conectado<select name="sessao_id">${sessions.map(s=>`<option value="${Number(s.id)}">${esc(s.nome||s.id)} · ${esc(s.numero)}</option>`).join('')}</select></label><button class="btn">Gerar chave do aparelho</button></form></div>${ds.map(d=>`<div class="card"><b>${esc(d.nome)} · +${esc(d.numero)}</b><p>${d.ativo?'Ativo':'Revogado'} · ${d.automatico?'Entrega automática':'Revisão no painel'} · Último contato: ${d.ultimo_contato?esc(new Date(d.ultimo_contato).toLocaleString('pt-BR')):'Ainda não conectado'}</p>${d.teste?`<p>Último teste sem compra: ${d.teste.status==='OK'?'Leitura confirmada pelo aplicativo':d.teste.expira<Date.now()?'Prazo encerrado':'Aguardando leitura'} · nenhum código armazenado</p>`:''}${d.ativo?`<form method="post" action="${BASE}/${d.id}/modo">${token()}<input type="hidden" name="automatico" value="${d.automatico?0:1}"><button class="btn">${d.automatico?'Exigir revisão':'Ativar entrega automática após validar o teste'}</button></form><form method="post" action="${BASE}/${d.id}/revogar">${token()}<button class="btn red">Revogar aparelho</button></form>`:''}</div>`).join('')}`));
  }));
  app.post(BASE+'/vincular',guard(async(req,res)=>{
   const s=getSessions().find(s=>Number(s.id)===Number(req.body.sessao_id)&&s.conectado&&s.funcaoCodigos);if(!s)throw Error('Escolha uma conta conectada com Receber códigos.');
   const n=require('./whatsapp-aquecidos-numero')(s.numero),raw=crypto.randomBytes(32).toString('hex');
   await run('UPDATE waq_captura_android SET ativo=0 WHERE sessao_id=?',[s.id]);
   await run('INSERT INTO waq_captura_android(sessao_id,numero,nome,token_hash,criado_em) VALUES(?,?,?,?,?)',[s.id,n,s.nome||'Android',digest(raw),Date.now()]);
   res.setHeader?.('Cache-Control','no-store');res.send(page('Chave do aparelho',`${nav()}<div class="card"><h2>Configure no aplicativo</h2><p>URL: endereço HTTPS do seu painel, sem /admin.</p><p>Chave exibida uma única vez:</p><code>${raw}</code><p>Conta vinculada: +${esc(n)}. Não use outra conta nesta sessão de captura. Começa em revisão; valide um teste antes de ativar a entrega automática.</p><a class="btn" href="${BASE}">Voltar</a></div>`));
  }));
  app.post(BASE+'/:id/modo',guard(async(req,res)=>{await run('UPDATE waq_captura_android SET automatico=? WHERE id=? AND ativo=1',[req.body.automatico==='1'?1:0,Number(req.params.id)]);res.redirect(BASE)}));
  app.post(BASE+'/:id/revogar',guard(async(req,res)=>{await run('UPDATE waq_captura_android SET ativo=0 WHERE id=?',[Number(req.params.id)]);res.redirect(BASE)}));
  app.get(API+'/pendente',api(async(req,res)=>{
   const d=await authenticate(req),p=await get(`SELECT p.id,p.numero,p.aguardando_em,p.expira FROM waq_pedidos p JOIN whatsapp_aquecidos_estoque e ON e.id=p.estoque_id WHERE e.whatsapp_sessao_id=? AND p.numero=? AND p.status='AGUARDANDO_CODIGO' AND p.expira>?`,[d.sessao_id,d.numero,Date.now()]);
   const teste=p?null:await get("SELECT id,inicio,expira FROM waq_android_testes WHERE aparelho_id=? AND status='AGUARDANDO' AND expira>? ORDER BY id DESC LIMIT 1",[d.id,Date.now()]);
   res.json({numero:d.numero,pedido:p||null,teste:teste||null,automatico:!!d.automatico});
  }));
  app.post(API+'/teste/iniciar',api(async(req,res)=>{
   const d=await authenticate(req),now=Date.now();
   const active=await get("SELECT p.id FROM waq_pedidos p JOIN whatsapp_aquecidos_estoque e ON e.id=p.estoque_id WHERE e.whatsapp_sessao_id=? AND p.status='AGUARDANDO_CODIGO' AND p.expira>?",[d.sessao_id,now]);
   if(active)throw Error('Há um pedido aguardando: encerre a espera antes do teste.');
   await run("UPDATE waq_android_testes SET status='ENCERRADO' WHERE aparelho_id=? AND status='AGUARDANDO'",[d.id]);
   const r=await run('INSERT INTO waq_android_testes(aparelho_id,inicio,expira) VALUES(?,?,?)',[d.id,now,now+600000]);
   res.json({ok:true,teste_id:r.lastID,expira:now+600000});
  }));
  app.post(API+'/teste/resultado',api(async(req,res)=>{
   const d=await authenticate(req),b=req.body||{},now=Date.now();
   if(!Number.isSafeInteger(b.teste_id)||b.detectado!==true||!Number.isFinite(b.capturado_em)||Math.abs(now-b.capturado_em)>30000||Object.hasOwn(b,'codigo'))throw Error('Resultado de teste inválido.');
   const t=await get('SELECT * FROM waq_android_testes WHERE id=? AND aparelho_id=?',[b.teste_id,d.id]);
   if(!t||t.expira<=now||!['AGUARDANDO','OK'].includes(t.status)||b.capturado_em<t.inicio)throw Error('Teste inexistente ou expirado.');
   await run("UPDATE waq_android_testes SET status='OK',recebido_em=? WHERE id=? AND status='AGUARDANDO'",[now,t.id]);
   res.json({ok:true,teste:true});
  }));
  app.post(API+'/captura',api(async(req,res)=>{
   const d=await authenticate(req),b=req.body||{},now=Date.now();
   if(!Number.isSafeInteger(b.pedido_id)||!Number.isFinite(b.capturado_em)||Math.abs(now-b.capturado_em)>30000||!/^\d{6}$/.test(b.codigo||'')||!/^\d{6}$/.test(b.codigo_confirmado||'')||b.codigo!==b.codigo_confirmado)throw Error('Captura inválida ou antiga.');
   const p=await get(`SELECT p.* FROM waq_pedidos p JOIN whatsapp_aquecidos_estoque e ON e.id=p.estoque_id WHERE p.id=? AND e.whatsapp_sessao_id=? AND p.numero=?`,[b.pedido_id,d.sessao_id,d.numero]);
   if(!p||p.aguardando_em!==b.aguardando_em)throw Error('Captura não pertence à espera atual.');
   if(['CODIGO_RECEBIDO','CODIGO_ENTREGUE'].includes(p.status))return res.json({ok:true,duplicate:true});
   if(p.status!=='AGUARDANDO_CODIGO'||p.expira<=now||b.capturado_em<p.aguardando_em)throw Error('Pedido não está aguardando.');
   const key=digest(`ANDROID|${d.id}|${p.id}|${p.aguardando_em}|${b.codigo}`);
   const r=await run(`INSERT OR IGNORE INTO waq_recepcao(event_key,pedido_id,origem,remetente,codigo,confiavel,recebido_em) VALUES(?,?,'ANDROID_CAPTURA',?,?,?,?)`,[key,p.id,`Android ${d.id}: ${d.nome}`,b.codigo,d.automatico?1:0,now]);
   // Repetição também recupera uma falha ocorrida após gravar a entrada.
   const e=await get('SELECT * FROM waq_recepcao WHERE event_key=?',[key]);
   if(d.automatico&&e.status==='REVISAO'){await accept(p.id,b.codigo,'ANDROID_CAPTURA');await run("UPDATE waq_recepcao SET status='ACEITO',codigo=NULL WHERE id=?",[e.id]);}
   res.json({ok:true,review:!d.automatico,duplicate:!r.changes});
  }));
 }
 return {init,routes};
};
