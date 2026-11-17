'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../index.js'),'utf8');
function section(a,b){const start=source.indexOf(a);assert.ok(start>=0,a);const end=source.indexOf(b,start);assert.ok(end>start,b);return source.slice(start,end);}
function fixture(){
 const context=vm.createContext({purchasePhrase:require('../purchase-short-links').purchasePhrase,getConfig:async()=>'',numeroBotServicosAnuncio:async()=> '5511999999999',all:async()=>[],premium:{products:async()=>[]},safeHtml:s=>String(s),brl:n=>'R$ '+n});
 vm.runInContext(section('function tipoCompraCampanha(','async function imagemCampanhaCentralEnvio('),context);
 vm.runInContext(section('function communityCampaignPayload(','let communityBotIdentity='),context);
 vm.runInContext(section('async function textoCampanhaPorCanal(','async function enviarTelegramCentral('),context);
 vm.runInContext(section('async function opcoesDestinoCompraCentral(','app.get(\'/admin/anuncios\''),context);
 return context;
}
test('ad parser persists Hero SMS as its own target without an eSIM/service ID or a fixed country',()=>{
 const ctx=fixture(),target=ctx.parseDestinoCompraAnuncio('herosms');assert.equal(target.compraTipo,'HERO_SMS');assert.equal(target.compraRef,null);assert.equal(target.produtoId,null);assert.equal(target.servicoId,null);
 assert.equal(ctx.parseDestinoCompraAnuncio('herosms:73').compraTipo,'');
});
test('new and edited ads expose exactly one Hero country-selector option and retain saved selection',async()=>{
 const ctx=fixture(),fresh=await ctx.opcoesDestinoCompraCentral(),saved=await ctx.opcoesDestinoCompraCentral({compra_tipo:'HERO_SMS'});
 assert.equal((fresh.match(/value="herosms"/g)||[]).length,1);assert.match(fresh,/WhatsApp SMS — Escolher país/);assert.match(saved,/value="herosms" selected/);assert.doesNotMatch(fresh,/WhatsApp SMS — Brasil/);
});
test('Telegram Buy button targets the existing enabled-country selector without charging',async()=>{
 const ctx=fixture(),options=await ctx.opcoesCompraTelegram({compra_tipo:'HERO_SMS'});const button=options.reply_markup.inline_keyboard[0][0];assert.equal(button.callback_data,'hero_sms_cat_whatsapp');assert.match(button.text,/COMPRAR/);
});
test('WhatsApp ad link opens the private services bot with the country-selection phrase and no fixed price',async()=>{
 const ctx=fixture(),text=await ctx.textoCampanhaPorCanal({compra_tipo:'HERO_SMS',mensagem:'Números para WhatsApp'},'whatsapp');const match=text.match(/https:\/\/wa\.me\/\d+\?text=\S+/);assert.ok(match);const url=new URL(match[0]);assert.equal(url.pathname,'/5511999999999');assert.equal(url.searchParams.get('text'),'Comprar SMS');assert.doesNotMatch(text,/R\$/);
});
test('WhatsApp incoming ad phrase clears old navigation and opens countries using the identified customer, without buying',async()=>{
 const branch=section('  // Anúncio WhatsApp SMS: abre seleção de países, sem comprar nem cobrar.','  // V5.0 GGSOMA');
 for(const phrase of ['Comprar numero WhatsApp','Comprar número WhatsApp','COMPRAR NÚMEROS WHATSAPP']){
  let cleared=0,opened=0;const cliente={id:7};const ctx=vm.createContext({textoOriginal:phrase,from:'wa:5511999999999',cliente,normalizarFraseComercialAnuncio:s=>s.trim().replace(/\s+/g,' '),apagarSessaoPedido:async()=>cleared++,heroSmsWaPaises:async(from,app,sort,page,customer)=>{assert.equal(from,'wa:5511999999999');assert.equal(app,'WhatsApp');assert.equal(page,0);assert.equal(customer,cliente);opened++;},heroCheckout:async()=>assert.fail('ad click must not purchase'),heroBuyPaid:async()=>assert.fail('ad click must not buy')});
  await vm.runInContext('(async()=>{'+branch+'})()',ctx);assert.equal(cleared,1);assert.equal(opened,1);
 }
});
test('existing service, eSIM and ConsultaVIP ad targets retain their behavior',async()=>{
 const ctx=fixture();assert.equal(ctx.parseDestinoCompraAnuncio('servico:3').compraTipo,'SERVICO');assert.equal(ctx.parseDestinoCompraAnuncio('produto:4').compraTipo,'ESIM');assert.equal(ctx.parseDestinoCompraAnuncio('consultavip').compraTipo,'CONSULTAVIP');
 assert.equal((await ctx.opcoesCompraTelegram({compra_tipo:'SERVICO',compra_ref:3})).reply_markup.inline_keyboard[0][0].callback_data,'servico_3');assert.equal((await ctx.opcoesCompraTelegram({produto_id:4})).reply_markup.inline_keyboard[0][0].callback_data,'esim_4');
});
