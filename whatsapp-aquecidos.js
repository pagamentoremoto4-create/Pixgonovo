'use strict';

const { randomBytes } = require('crypto');
const BASE = '/admin/whatsapp-aquecidos';
const STATUS = { DISPONIVEL: 'Disponível', PAUSADO: 'Pausado', VENDIDO: 'Vendido' };
const CANAIS = { AMBOS: 'SMS e WhatsApp', SMS: 'SMS', WHATSAPP: 'WhatsApp' };

module.exports = function criarModulo({ run, get, all, page, safeHtml, brl, extraNav = () => '' }) {
  const csrf = randomBytes(32).toString('hex');
  const esc = safeHtml;
  const token = () => `<input type="hidden" name="token_estoque" value="${csrf}">`;
  const inteiro = (valor, min, max, nome) => {
    const texto = String(valor ?? '').trim();
    if (!/^\d+$/.test(texto)) throw new Error(`${nome} inválido.`);
    const n = Number(texto);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${nome} inválido.`);
    return n;
  };
  function numeroBR(valor) {
    const texto = String(valor ?? '').trim();
    if (!/^[+\d\s().-]+$/.test(texto)) throw new Error('Informe um número brasileiro válido.');
    let n = texto.replace(/\D/g, '');
    if (n.length === 11) n = '55' + n;
    if (!/^55[1-9]\d9\d{8}$/.test(n)) throw new Error('Informe o celular com DDD e 9 dígitos, com ou sem +55.');
    const ddds = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
    if (!ddds.has(n.slice(2, 4))) throw new Error('DDD inválido.');
    return n;
  }
  async function validar(body) {
    const numero = numeroBR(body.numero);
    const precoTexto = String(body.preco ?? '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(precoTexto)) throw new Error('Informe um preço válido, com até duas casas decimais.');
    const preco = Number(precoTexto);
    if (!Number.isFinite(preco) || preco <= 0 || preco > 1000000) throw new Error('O preço deve ser maior que zero e até R$ 1.000.000.');
    const dias = inteiro(body.aquecimento_dias, 0, 36500, 'Tempo de aquecimento');
    const chip = inteiro(body.chip_slot || '1', 1, 2, 'Posição do chip');
    const status = String(body.status || 'DISPONIVEL');
    const canal = String(body.canal_codigo || 'AMBOS');
    if (!Object.hasOwn(STATUS, status) || !Object.hasOwn(CANAIS, canal)) throw new Error('Situação ou canal inválido.');
    const celular = String(body.celular || '').trim();
    const observacao = String(body.observacao || '').trim();
    if (celular.length > 100 || observacao.length > 1000) throw new Error('Celular: até 100 caracteres. Observações: até 1.000 caracteres.');
    let sessaoId = null;
    if (body.whatsapp_sessao_id) {
      sessaoId = inteiro(body.whatsapp_sessao_id, 1, Number.MAX_SAFE_INTEGER, 'Sessão WhatsApp');
      const sessao = await get('SELECT id,numero FROM whatsapp_sessoes WHERE id=? AND ativo=1', [sessaoId]);
      if (!sessao) throw new Error('Selecione uma sessão WhatsApp ativa.');
      if (sessao.numero && numeroBR(sessao.numero) !== numero) throw new Error('O número da sessão WhatsApp deve ser igual ao número cadastrado.');
    }
    return [numero, numero.slice(2, 4), preco, dias, status, celular, chip, canal, sessaoId, observacao];
  }
  async function init() {
    await run(`CREATE TABLE IF NOT EXISTS whatsapp_aquecidos_estoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      ddd TEXT NOT NULL,
      preco REAL NOT NULL CHECK(preco>0),
      aquecimento_dias INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DISPONIVEL' CHECK(status IN ('DISPONIVEL','PAUSADO','VENDIDO')),
      celular TEXT NOT NULL DEFAULT '',
      chip_slot INTEGER NOT NULL DEFAULT 1 CHECK(chip_slot IN (1,2)),
      canal_codigo TEXT NOT NULL DEFAULT 'AMBOS',
      whatsapp_sessao_id INTEGER,
      observacao TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_whatsapp_aquecidos_status_ddd ON whatsapp_aquecidos_estoque(status,ddd)');
  }
  function options(obj, atual) {
    return Object.entries(obj).map(([v, texto]) => `<option value="${esc(v)}" ${v === atual ? 'selected' : ''}>${esc(texto)}</option>`).join('');
  }
  async function formulario(item = {}) {
    const sessoes = await all('SELECT id,nome,numero FROM whatsapp_sessoes WHERE ativo=1 ORDER BY nome,id');
    const edicao = Boolean(item.id);
    return `<div class="card"><h2>${edicao ? 'Editar número' : 'Cadastrar número'}</h2>
      <form method="post" action="${BASE}${edicao ? '/' + item.id + '/salvar' : '/cadastrar'}">
      ${token()}<div class="waq-grid">
      <label>Número com DDD<input name="numero" required maxlength="25" value="${esc(item.numero || '')}" placeholder="+55 75 99999-9999" inputmode="tel"></label>
      <label>Preço (R$)<input name="preco" required inputmode="decimal" value="${esc(item.preco ?? '')}" placeholder="38,00"></label>
      <label>Aquecimento (dias)<input name="aquecimento_dias" type="number" min="0" max="36500" required value="${esc(item.aquecimento_dias ?? 0)}"></label>
      <label>Situação<select name="status">${options(STATUS, item.status || 'DISPONIVEL')}</select></label>
      <label>Celular Android<input name="celular" maxlength="100" value="${esc(item.celular || '')}" placeholder="Ex.: Samsung 01"></label>
      <label>Posição do chip<select name="chip_slot">${options({1: 'Chip 1', 2: 'Chip 2'}, String(item.chip_slot || 1))}</select></label>
      <label>Canal previsto para o código<select name="canal_codigo">${options(CANAIS, item.canal_codigo || 'AMBOS')}</select></label>
      <label>Sessão WhatsApp<select name="whatsapp_sessao_id"><option value="">Sem vínculo</option>${sessoes.map(s => `<option value="${s.id}" ${Number(item.whatsapp_sessao_id) === s.id ? 'selected' : ''}>${esc(s.nome)}${s.numero ? ' — +' + esc(s.numero) : ' — ainda sem número conectado'}</option>`).join('')}</select></label>
      </div><label>Observações<textarea name="observacao" maxlength="1000" rows="3">${esc(item.observacao || '')}</textarea></label>
      <p class="muted">O DDD é extraído do número. Informe os dias de aquecimento; este cadastro não verifica o aquecimento da conta.</p>
      <button class="btn green">${edicao ? 'Salvar alterações' : 'Cadastrar número'}</button> ${edicao ? `<a class="btn" href="${BASE}">Voltar</a>` : ''}
      </form></div>`;
  }
  const estilo = `<style>.waq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.waq-grid label{display:block}.waq-scroll{overflow-x:auto}.waq-summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.waq-summary .card{flex:1;min-width:130px;margin:0}.waq-summary strong{display:block;font-size:26px}.waq-notice{border-left:4px solid #f4ad36}.waq-actions{display:flex;gap:6px;flex-wrap:wrap}.waq-actions form{margin:0}.waq-scroll td{vertical-align:top}.waq-obs{max-width:260px;overflow-wrap:anywhere;white-space:pre-wrap}</style>`;
  const aviso = `<div class="card waq-notice"><b>Estoque e cadastro</b><p>Venda pelo menu WhatsApp aquecidos do Telegram. Acompanhe a ativação em Pedidos e códigos. Configure os Androids e teste a captura WhatsApp antes de usar a entrega automática. Marcar “Vendido” neste cadastro é um controle manual e não cobra saldo nem envia mensagens.</p></div>`;
  function redirect(res, tipo, mensagem) { return res.redirect(`${BASE}?${tipo}=${encodeURIComponent(mensagem)}`); }
  function guard(handler) {
    return async (req, res) => {
      if (req.method === 'POST' && req.body.token_estoque !== csrf) return res.status(403).send(page('Formulário expirado', '<h1>Formulário expirado</h1><p>Reabra a aba e tente novamente.</p>'));
      try { await handler(req, res); }
      catch (e) {
        const mensagem = /UNIQUE constraint/.test(e.message) ? 'Este número já está cadastrado.' : e.message;
        redirect(res, 'erro', mensagem);
      }
    };
  }
  function routes(app) {
    app.get(BASE, guard(async (req, res) => {
      const q = String(req.query.q || '').trim().slice(0, 100);
      const status = Object.hasOwn(STATUS, req.query.status) ? req.query.status : '';
      const ddd = /^\d{2}$/.test(String(req.query.ddd || '')) ? req.query.ddd : '';
      const where = [], params = [];
      if (q) { where.push('(e.numero LIKE ? OR e.celular LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      if (status) { where.push('e.status=?'); params.push(status); }
      if (ddd) { where.push('e.ddd=?'); params.push(ddd); }
      const rows = await all(`SELECT e.*,s.nome AS sessao_nome,s.numero AS sessao_numero FROM whatsapp_aquecidos_estoque e LEFT JOIN whatsapp_sessoes s ON s.id=e.whatsapp_sessao_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT 500`, params);
      const totais = await all('SELECT status,COUNT(*) AS qtd FROM whatsapp_aquecidos_estoque GROUP BY status');
      const ddds = await all('SELECT DISTINCT ddd FROM whatsapp_aquecidos_estoque ORDER BY ddd');
      const contagem = Object.fromEntries(totais.map(t => [t.status, t.qtd]));
      const alertas = ['ok', 'erro'].filter(k => req.query[k]).map(k => `<div class="card" role="alert">${k === 'ok' ? '✅' : '⚠️'} ${esc(String(req.query[k]).slice(0, 400))}</div>`).join('');
      const tabela = rows.length ? `<div class="waq-scroll"><table><thead><tr><th>Número / DDD</th><th>Preço</th><th>Aquecimento</th><th>Situação</th><th>Celular / Chip</th><th>Código / WhatsApp</th><th>Observações</th><th>Ações</th></tr></thead><tbody>${rows.map(r => `<tr>
        <td><b>+${esc(r.numero)}</b><br>DDD ${esc(r.ddd)} · #${r.id}</td><td>${brl(r.preco)}</td><td>${r.aquecimento_dias} dias</td><td>${esc(STATUS[r.status])}</td>
        <td>${esc(r.celular || 'Não informado')}<br>Chip ${r.chip_slot}</td><td>${esc(CANAIS[r.canal_codigo])}<br>${r.sessao_nome ? `<a href="/admin/whatsapp/${r.whatsapp_sessao_id}/editar">${esc(r.sessao_nome)}</a>${r.sessao_numero && String(r.sessao_numero).replace(/\D/g, '') !== r.numero ? '<br>⚠️ Verifique o número da sessão' : ''}` : 'Sem sessão vinculada'}</td>
        <td class="waq-obs">${esc(r.observacao || '—')}</td><td><div class="waq-actions"><a class="btn" href="${BASE}/${r.id}/editar">Editar</a>${r.status !== 'VENDIDO' ? `<form method="post" action="${BASE}/${r.id}/status">${token()}<input type="hidden" name="status" value="${r.status === 'PAUSADO' ? 'DISPONIVEL' : 'PAUSADO'}"><button class="btn gray">${r.status === 'PAUSADO' ? 'Disponibilizar' : 'Pausar'}</button></form><form method="post" action="${BASE}/${r.id}/apagar" data-confirm="Apagar este número do estoque?"><input type="hidden" name="confirmar" value="1">${token()}<button class="btn red">Apagar</button></form>` : ''}</div></td></tr>`).join('')}</tbody></table></div><p class="muted">Até 500 registros por busca. Use os filtros para localizar outros números.</p>` : '<p>Nenhum número encontrado.</p>';
      res.send(page('WhatsApp aquecidos', `${estilo}${extraNav()}<div class="topbar"><h1>📱 WhatsApp aquecidos</h1><a class="btn" href="/admin/whatsapp">Conectar WhatsApp</a></div>${alertas}${aviso}
        <div class="waq-summary">${Object.entries(STATUS).map(([s, t]) => `<div class="card"><strong>${contagem[s] || 0}</strong>${esc(t)}</div>`).join('')}</div>
        ${await formulario()}<div class="card"><h2>Estoque</h2><form method="get" class="waq-grid"><label>Buscar<input name="q" value="${esc(q)}" placeholder="Número ou celular"></label><label>DDD<select name="ddd"><option value="">Todos</option>${ddds.map(d => `<option ${d.ddd === ddd ? 'selected' : ''} value="${esc(d.ddd)}">${esc(d.ddd)}</option>`).join('')}</select></label><label>Situação<select name="status"><option value="">Todas</option>${options(STATUS, status)}</select></label><div><button class="btn">Filtrar</button> <a class="btn gray" href="${BASE}">Limpar</a></div></form>${tabela}</div>`));
    }));
    app.post(BASE + '/cadastrar', guard(async (req, res) => {
      const valores = await validar(req.body);
      await run(`INSERT INTO whatsapp_aquecidos_estoque(numero,ddd,preco,aquecimento_dias,status,celular,chip_slot,canal_codigo,whatsapp_sessao_id,observacao) VALUES(?,?,?,?,?,?,?,?,?,?)`, valores);
      redirect(res, 'ok', 'Número cadastrado.');
    }));
    app.get(BASE + '/:id/editar', guard(async (req, res) => {
      const item = await get('SELECT * FROM whatsapp_aquecidos_estoque WHERE id=?', [inteiro(req.params.id, 1, Number.MAX_SAFE_INTEGER, 'Cadastro')]);
      if (!item) return res.status(404).send(page('Não encontrado', '<h1>Número não encontrado</h1>'));
      res.send(page('Editar WhatsApp aquecido', `${estilo}${extraNav()}<h1>📱 WhatsApp aquecidos</h1>${aviso}${await formulario(item)}`));
    }));
    app.post(BASE + '/:id/salvar', guard(async (req, res) => {
      const id = inteiro(req.params.id, 1, Number.MAX_SAFE_INTEGER, 'Cadastro');
      const valores = await validar(req.body);
      const resultado = await run(`UPDATE whatsapp_aquecidos_estoque SET numero=?,ddd=?,preco=?,aquecimento_dias=?,status=?,celular=?,chip_slot=?,canal_codigo=?,whatsapp_sessao_id=?,observacao=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`, [...valores, id]);
      if (!resultado.changes) throw new Error('Número não encontrado.');
      redirect(res, 'ok', 'Cadastro atualizado.');
    }));
    app.post(BASE + '/:id/status', guard(async (req, res) => {
      const id = inteiro(req.params.id, 1, Number.MAX_SAFE_INTEGER, 'Cadastro');
      if (!['DISPONIVEL', 'PAUSADO'].includes(req.body.status)) throw new Error('Situação inválida.');
      const resultado = await run(`UPDATE whatsapp_aquecidos_estoque SET status=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status IN ('DISPONIVEL','PAUSADO')`, [req.body.status, id]);
      if (!resultado.changes) throw new Error('Número não encontrado ou marcado como vendido. Use Editar para revisar o cadastro.');
      redirect(res, 'ok', 'Situação atualizada.');
    }));
    app.post(BASE + '/:id/apagar', guard(async (req, res) => {
      if (req.body.confirmar !== '1') throw new Error('Confirme a exclusão.');
      const resultado = await run(`DELETE FROM whatsapp_aquecidos_estoque WHERE id=? AND status<>'VENDIDO'`, [inteiro(req.params.id, 1, Number.MAX_SAFE_INTEGER, 'Cadastro')]);
      if (!resultado.changes) throw new Error('Número não encontrado. Números vendidos não podem ser apagados.');
      redirect(res, 'ok', 'Número apagado.');
    }));
  }
  return { init, routes };
};
