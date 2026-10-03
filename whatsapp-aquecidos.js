'use strict';
const {randomBytes}=require('crypto');
const numeroBR=require('./whatsapp-aquecidos-numero');
const PLANOS=require('./whatsapp-aquecidos-planos');
const BASE='/admin/whatsapp-aquecidos';
const STATUS={DISPONIVEL:'Disponível',PAUSADO:'Pausado',VENDIDO:'Vendido'};
module.exports=function({run,get,all,page,safeHtml:esc,brl,getSessions=()=>[],extraNav=()=>''}){
  const csrf=randomBytes(32).toString('hex');
  const token=()=>`<input type="hidden" name="token_estoque" value="${csrf}">`;
  const inteiro=v=>{if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)<1)throw Error('Selecione um celular conectado.');return Number(v)};
  async function sessoes(){
    const rows=await all('SELECT id,nome,numero,funcao_codigos FROM whatsapp_sessoes WHERE ativo=1 AND funcao_codigos=1 ORDER BY nome,id');
    const runtime=new Map(getSessions().map(s=>[Number(s.id),s]));
    return rows.map(r=>{const live=runtime.get(r.id);return {...r,conectado:Boolean(live?.conectado&&live?.funcaoCodigos),numero:live?.numero||r.numero||''}});
  }
  async function validar(body){
    const sid=inteiro(body.whatsapp_sessao_id);
    const sessao=(await sessoes()).find(s=>s.id===sid);
    if(!sessao?.conectado)throw Error('Conecte o WhatsApp e marque Receber códigos antes de cadastrar o estoque.');
    const numero=numeroBR(sessao.numero);
    const dias=Number(body.plano_dias);
    if(!Object.hasOwn(PLANOS,dias))throw Error('Escolha 30 dias aquecidos ou 120 dias aquecidos.');
    const status=String(body.status||'DISPONIVEL');
    if(!Object.hasOwn(STATUS,status))throw Error('Situação inválida.');
    const observacao=String(body.observacao||'').trim();if(observacao.length>1000)throw Error('Observações: até 1.000 caracteres.');
    // Número, preço e celular são determinados pelo servidor, nunca pelo campo de prévia.
    return [numero,numero.slice(2,4),PLANOS[dias].preco,dias,status,sessao.nome,1,'WHATSAPP',sid,observacao];
  }
  async function init(){
    await run(`CREATE TABLE IF NOT EXISTS whatsapp_aquecidos_estoque(id INTEGER PRIMARY KEY AUTOINCREMENT,numero TEXT NOT NULL UNIQUE,ddd TEXT NOT NULL,preco REAL NOT NULL CHECK(preco>0),aquecimento_dias INTEGER NOT NULL DEFAULT 30,status TEXT NOT NULL DEFAULT 'DISPONIVEL' CHECK(status IN ('DISPONIVEL','PAUSADO','VENDIDO')),celular TEXT NOT NULL DEFAULT '',chip_slot INTEGER NOT NULL DEFAULT 1,canal_codigo TEXT NOT NULL DEFAULT 'WHATSAPP',whatsapp_sessao_id INTEGER,observacao TEXT NOT NULL DEFAULT '',criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await run('CREATE INDEX IF NOT EXISTS idx_whatsapp_aquecidos_status_ddd ON whatsapp_aquecidos_estoque(status,ddd)');
    const pedidos=await get("SELECT name FROM sqlite_master WHERE type='table' AND name='waq_pedidos'");
    const semVenda=pedidos?'AND NOT EXISTS(SELECT 1 FROM waq_pedidos p WHERE p.estoque_id=whatsapp_aquecidos_estoque.id)':'';
    for(const [dias,p] of Object.entries(PLANOS))await run(`UPDATE whatsapp_aquecidos_estoque SET preco=?,canal_codigo='WHATSAPP' WHERE aquecimento_dias=? AND status<>'VENDIDO' ${semVenda}`,[p.preco,Number(dias)]);
    await run(`UPDATE whatsapp_aquecidos_estoque SET status='PAUSADO',canal_codigo='WHATSAPP' WHERE status='DISPONIVEL' AND (aquecimento_dias NOT IN (30,120) OR whatsapp_sessao_id IS NULL OR NOT EXISTS(SELECT 1 FROM whatsapp_sessoes s WHERE s.id=whatsapp_aquecidos_estoque.whatsapp_sessao_id AND s.ativo=1 AND s.funcao_codigos=1)) ${semVenda}`);
  }
  const style=`<style>.waq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.waq-grid label{display:block}.waq-scroll{overflow-x:auto}.waq-summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.waq-summary .card{flex:1;min-width:130px;margin:0}.waq-summary strong{display:block;font-size:26px}.waq-obs{max-width:240px;white-space:pre-wrap;overflow-wrap:anywhere}.waq-actions{display:flex;gap:6px;flex-wrap:wrap}.waq-actions form{margin:0}.waq-grid input[readonly]{opacity:.85}</style>`;
  const notice=`<div class="card"><b>Cadastro pelo WhatsApp conectado</b><p>Conecte a conta em Conectar WhatsApp e marque Receber códigos. Escolha o celular abaixo: o número e o vínculo serão preenchidos automaticamente. Planos: 30 dias por ${brl(40)} e 120 dias por ${brl(90)}. A captura acompanha a conversa da conta conectada.</p></div>`;
  const options=(obj,current)=>Object.entries(obj).map(([k,v])=>`<option value="${esc(k)}" ${k===String(current)?'selected':''}>${esc(v)}</option>`).join('');
  async function formulario(item={}){
    const rows=await sessoes();const used=await all('SELECT id,whatsapp_sessao_id FROM whatsapp_aquecidos_estoque WHERE whatsapp_sessao_id IS NOT NULL');
    const eligible=rows.filter(s=>s.conectado);
    const dias=Object.hasOwn(PLANOS,Number(item.plano_dias||item.aquecimento_dias))?Number(item.plano_dias||item.aquecimento_dias):30;
    const selected=eligible.find(s=>s.id===Number(item.whatsapp_sessao_id));
    const any=eligible.some(s=>!used.some(e=>e.whatsapp_sessao_id===s.id&&e.id!==item.id));
    let html=`<div class="card"><h2>${item.id?'Editar estoque':'Cadastrar estoque'}</h2><form method="post" action="${BASE}${item.id?'/'+item.id+'/salvar':'/cadastrar'}">${token()}<div class="waq-grid">
      <label>Celular / WhatsApp conectado<select id="waq-celular" name="whatsapp_sessao_id" required><option value="">Escolha um celular conectado</option>${eligible.map(s=>{const occupied=used.some(e=>e.whatsapp_sessao_id===s.id&&e.id!==item.id);return `<option value="${s.id}" data-numero="${esc(s.numero)}" ${s.id===Number(item.whatsapp_sessao_id)?'selected':''} ${occupied?'disabled':''}>${esc(s.nome)} · +${esc(s.numero)}${occupied?' · já cadastrado':''}</option>`}).join('')}</select></label>
      <label>Número automático<input id="waq-numero" readonly value="${selected?'+'+esc(selected.numero):''}" placeholder="Preenchido ao escolher o celular" aria-label="Número da conta conectada"></label>
      <label>Plano<select id="waq-plano" name="plano_dias" required>${Object.entries(PLANOS).map(([d,p])=>`<option value="${d}" data-preco="${esc(brl(p.preco))}" ${Number(d)===dias?'selected':''}>${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Preço do plano<input id="waq-preco" readonly value="${esc(brl(PLANOS[dias].preco))}"></label>
      <label>Situação<select name="status">${options(STATUS,item.status||'DISPONIVEL')}</select></label>
      </div><label>Observações<textarea name="observacao" maxlength="1000" rows="3">${esc(item.observacao||'')}</textarea></label>
      <p class="muted">${any?'O número vem da sessão conectada. Os dias de aquecimento são informados pelo plano escolhido.':'Nenhum celular livre e conectado com Receber códigos. Conecte ou habilite uma conta em Conectar WhatsApp.'}</p>
      <button class="btn green" ${any?'':'disabled'}>${item.id?'Salvar alterações':'Cadastrar estoque'}</button> <a class="btn" href="/admin/whatsapp">Conectar WhatsApp</a></form></div>
      <script>(()=>{const c=document.getElementById('waq-celular'),n=document.getElementById('waq-numero'),p=document.getElementById('waq-plano'),v=document.getElementById('waq-preco');function update(){const o=c.options[c.selectedIndex];n.value=o&&o.dataset.numero?'+'+o.dataset.numero:'';v.value=p.options[p.selectedIndex].dataset.preco;}c.addEventListener('change',update);p.addEventListener('change',update);update();})();</script>`;
    return html;
  }
  function redirect(res,key,message){res.redirect(`${BASE}?${key}=${encodeURIComponent(message)}`)}
  const guard=handler=>async(req,res)=>{
    if(req.method==='POST'&&req.body.token_estoque!==csrf)return res.status(403).send(page('Formulário expirado','Reabra a aba e tente novamente.'));
    try{await handler(req,res)}catch(e){const message=/UNIQUE constraint/.test(e.message)?'Este número já está cadastrado.':e.message;
      if(req.method==='POST'&&req.body.plano_dias!==undefined){const item={...req.body};if(req.params?.id&&/^\d+$/.test(req.params.id))item.id=Number(req.params.id);return res.status(400).send(page('Confira o cadastro',`${style}${extraNav()}<h1>📱 WhatsApp aquecidos</h1><div class="card" role="alert">⚠️ ${esc(message)}</div>${await formulario(item)}`))}
      redirect(res,'erro',message);
    }
  };
  function routes(app){
    app.get(BASE,guard(async(req,res)=>{
      const q=String(req.query.q||'').trim().slice(0,100),status=Object.hasOwn(STATUS,req.query.status)?req.query.status:'',ddd=/^\d{2}$/.test(String(req.query.ddd||''))?req.query.ddd:'';
      const where=[],params=[];
      if(q){where.push('(e.numero LIKE ? OR e.celular LIKE ?)');params.push('%'+q+'%','%'+q+'%')}
      if(status){where.push('e.status=?');params.push(status)}if(ddd){where.push('e.ddd=?');params.push(ddd)}
      const rows=await all(`SELECT e.*,s.nome sessao_nome FROM whatsapp_aquecidos_estoque e LEFT JOIN whatsapp_sessoes s ON s.id=e.whatsapp_sessao_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY e.id DESC LIMIT 500`,params);
      const live=new Map((await sessoes()).map(s=>[s.id,s]));
      const counts=Object.fromEntries((await all('SELECT status,COUNT(*) qtd FROM whatsapp_aquecidos_estoque GROUP BY status')).map(s=>[s.status,s.qtd]));
      const ddds=await all('SELECT DISTINCT ddd FROM whatsapp_aquecidos_estoque ORDER BY ddd');
      const alerts=['ok','erro'].filter(k=>req.query[k]).map(k=>`<div class="card" role="alert">${k==='ok'?'✅':'⚠️'} ${esc(String(req.query[k]).slice(0,400))}</div>`).join('');
      const table=rows.length?`<div class="waq-scroll"><table><thead><tr><th>Número / DDD</th><th>Plano</th><th>Preço</th><th>Situação</th><th>Celular vinculado</th><th>Observações</th><th>Ações</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>+${esc(r.numero)}</b><br>DDD ${esc(r.ddd)} · #${r.id}</td><td>${esc(PLANOS[r.aquecimento_dias]?.nome||'Cadastro anterior: '+r.aquecimento_dias+' dias')}</td><td>${brl(r.preco)}</td><td>${esc(STATUS[r.status])}</td><td>${r.whatsapp_sessao_id?`<a href="/admin/whatsapp/${r.whatsapp_sessao_id}/editar">${esc(r.sessao_nome||r.celular||'Sessão removida')}</a><br>${live.get(r.whatsapp_sessao_id)?.conectado?'🟢 Conectado':'🔴 Desconectado / função desativada'}`:'Sem vínculo'}</td><td class="waq-obs">${esc(r.observacao||'—')}</td><td><div class="waq-actions">${r.status!=='VENDIDO'?`<a class="btn" href="${BASE}/${r.id}/editar">Editar</a><form method="post" action="${BASE}/${r.id}/status">${token()}<input type="hidden" name="status" value="${r.status==='PAUSADO'?'DISPONIVEL':'PAUSADO'}"><button class="btn gray">${r.status==='PAUSADO'?'Disponibilizar':'Pausar'}</button></form><form method="post" action="${BASE}/${r.id}/apagar" data-confirm="Apagar este número do estoque?">${token()}<button class="btn red">Apagar</button></form>`:'Histórico preservado'}</div></td></tr>`).join('')}</tbody></table></div>`:'<p>Nenhum número cadastrado.</p>';
      res.send(page('WhatsApp aquecidos',`${style}${extraNav()}<div class="topbar"><h1>📱 WhatsApp aquecidos</h1><a class="btn" href="/admin/whatsapp">Conectar WhatsApp</a></div>${alerts}${notice}<div class="waq-summary">${Object.entries(STATUS).map(([s,t])=>`<div class="card"><strong>${counts[s]||0}</strong>${t}</div>`).join('')}</div>${await formulario()}<div class="card"><h2>Estoque</h2><form method="get" class="waq-grid"><label>Buscar<input name="q" value="${esc(q)}" placeholder="Número ou celular"></label><label>DDD<select name="ddd"><option value="">Todos</option>${ddds.map(d=>`<option value="${d.ddd}" ${d.ddd===ddd?'selected':''}>${d.ddd}</option>`).join('')}</select></label><label>Situação<select name="status"><option value="">Todas</option>${options(STATUS,status)}</select></label><div><button class="btn">Filtrar</button><a class="btn" href="${BASE}">Limpar</a></div></form>${table}<p class="muted">Até 500 registros por busca.</p></div>`));
    }));
    app.post(BASE+'/cadastrar',guard(async(req,res)=>{await run('INSERT INTO whatsapp_aquecidos_estoque(numero,ddd,preco,aquecimento_dias,status,celular,chip_slot,canal_codigo,whatsapp_sessao_id,observacao) VALUES(?,?,?,?,?,?,?,?,?,?)',await validar(req.body));redirect(res,'ok','Estoque cadastrado e vinculado ao WhatsApp.')}));
    app.get(BASE+'/:id/editar',guard(async(req,res)=>{const item=await get('SELECT * FROM whatsapp_aquecidos_estoque WHERE id=?',[inteiro(req.params.id)]);if(!item)return res.status(404).send('Cadastro não encontrado.');if(item.status==='VENDIDO')throw Error('A venda fica preservada no histórico.');res.send(page('Editar estoque',`${style}${extraNav()}<h1>📱 WhatsApp aquecidos</h1>${await formulario(item)}`))}));
    app.post(BASE+'/:id/salvar',guard(async(req,res)=>{const values=await validar(req.body);const r=await run(`UPDATE whatsapp_aquecidos_estoque SET numero=?,ddd=?,preco=?,aquecimento_dias=?,status=?,celular=?,chip_slot=?,canal_codigo=?,whatsapp_sessao_id=?,observacao=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status<>'VENDIDO'`,[...values,inteiro(req.params.id)]);if(!r.changes)throw Error('Cadastro inexistente ou já vendido.');redirect(res,'ok','Estoque atualizado.')}));
    app.post(BASE+'/:id/status',guard(async(req,res)=>{const status=String(req.body.status);if(!['DISPONIVEL','PAUSADO'].includes(status))throw Error('Situação inválida.');const item=await get('SELECT * FROM whatsapp_aquecidos_estoque WHERE id=?',[inteiro(req.params.id)]);if(!item||item.status==='VENDIDO')throw Error('Cadastro inexistente ou vendido.');if(status==='DISPONIVEL')await validar({...item,plano_dias:item.aquecimento_dias,status});const r=await run("UPDATE whatsapp_aquecidos_estoque SET status=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status<>'VENDIDO'",[status,item.id]);if(!r.changes)throw Error('Cadastro indisponível.');redirect(res,'ok','Situação atualizada.')}));
    app.post(BASE+'/:id/apagar',guard(async(req,res)=>{const r=await run("DELETE FROM whatsapp_aquecidos_estoque WHERE id=? AND status<>'VENDIDO'",[inteiro(req.params.id)]);if(!r.changes)throw Error('Cadastro inexistente ou vendido.');redirect(res,'ok','Número removido.')}));
  }
  return {init,routes};
};
