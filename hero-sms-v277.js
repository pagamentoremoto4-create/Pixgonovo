'use strict';
// V277: funções isoladas de integração. Não habilitar vendas até conectar checkout,
// confirmação idempotente de PIX/saldo, conciliação e reembolso ao banco principal.
const axios = require('axios');
const BASE = 'https://hero-sms.com/stubs/handler_api.php';
function asText(v) { return typeof v === 'string' ? v.trim() : JSON.stringify(v); }
function parseResult(raw) {
  const txt = asText(raw);
  if (!txt) throw new Error('Hero SMS: resposta vazia');
  if (/^(BAD_KEY|NO_API_KEY|BAD_ACTION|ERROR_SQL|NO_NUMBERS|NO_BALANCE|BAD_SERVICE|BAD_STATUS|BAD_ID|WRONG_SERVICE)/i.test(txt)) {
    const err = new Error(`Hero SMS: ${txt.split(':')[0]}`); err.code = txt.split(':')[0]; throw err;
  }
  if (txt.startsWith('{') || txt.startsWith('[')) { try { return JSON.parse(txt); } catch { throw new Error('Hero SMS: JSON inválido'); } }
  return txt;
}
function createHeroClient(getApiKey) {
  if (typeof getApiKey !== 'function') throw new TypeError('getApiKey deve ser função');
  async function call(action, params = {}) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('Hero SMS: chave não configurada');
    const response = await axios.get(BASE, {params: {api_key: apiKey, action, ...params}, timeout: 18000, responseType:'text'});
    return parseResult(response.data);
  }
  return {
    call,
    async getNumber(service, country, maxPrice) {
      if (!service || !/^\d+$/.test(String(country))) throw new Error('Serviço ou país inválido');
      const params = {service, country};
      if (maxPrice != null) {
        if (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) <= 0) throw new Error('Preço máximo inválido');
        params.maxPrice = Number(maxPrice);
      }
      const result = await call('getNumberV2', params);
      if (!result || typeof result !== 'object' || !result.activationId || !result.phoneNumber) {
        throw new Error('Hero SMS: formato de ativação inesperado; conciliação manual necessária antes de repetir');
      }
      return result;
    },
    getStatus(activationId) { if (!activationId) throw new Error('Ativação ausente'); return call('getStatusV2',{id:activationId}); },
    cancel(activationId) { if (!activationId) throw new Error('Ativação ausente'); return call('setStatus',{id:activationId,status:8}); },
    finish(activationId) { if (!activationId) throw new Error('Ativação ausente'); return call('setStatus',{id:activationId,status:6}); }
  };
}
module.exports = {createHeroClient, parseResult};
