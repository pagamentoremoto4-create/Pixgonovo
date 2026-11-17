'use strict';
function purchasePhrase(payload){if(payload==='hero')return 'Comprar SMS';if(payload==='consulta')return 'Assinar ConsultaVIP';const m=String(payload||'').match(/^(servico|esim|premium)_([1-9]\d*)$/);return m?'Comprar '+({servico:'S',esim:'E',premium:'P'}[m[1]])+m[2]:'menu';}
function parsePurchasePhrase(text){const m=String(text||'').trim().match(/^comprar\s+(SMS|[SEP][1-9]\d*)$/i);if(!m)return null;const code=m[1].toUpperCase();if(code==='SMS')return {type:'hero'};const id=Number(code.slice(1));return Number.isSafeInteger(id)?{type:{S:'servico',E:'esim',P:'premium'}[code[0]],id}:null;}
const planKey=v=>String(v||'').trim().toLocaleLowerCase('pt-BR');
function availableEsimPlan(plans,target){return plans.find(p=>planKey(p.nome_plano)===planKey(target?.nome_plano))||null;}
module.exports={purchasePhrase,parsePurchasePhrase,availableEsimPlan};
