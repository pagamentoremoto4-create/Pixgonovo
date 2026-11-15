'use strict';
// Response formats from the supplied Hero SMS OpenAPI document.
function parseJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value.trim(); }
}
function apiDate(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Data inválida para consulta Hero SMS.');
  return date.toISOString().replace(/\.\d{3}Z$/,'Z');
}
function compatibilityText(value) {
  const parsed=parseJson(value);
  if(parsed==null)return '';
  return typeof parsed==='string'?parsed.trim():JSON.stringify(parsed);
}
function parsePurchasedActivation(response) {
  const result=parseJson(response);
  if(!Array.isArray(result?.data)||result.data.length!==1)throw new Error('Hero SMS: resposta de compra não identifica uma única ativação.');
  const row=result.data[0];
  const activationId=String(row?.id??'');
  if(!/^\d{1,30}$/.test(activationId))throw new Error('Hero SMS: resposta de compra sem ID válido.');
  const phone=row?.phone==null?'':String(row.phone);
  return {activationId,phoneNumber:/^\+?\d{6,20}$/.test(phone)?phone:null};
}
function providerErrorSummary(body) {
  const parsed=parseJson(body);
  if(typeof parsed==='string')return parsed.slice(0,350).replace(/https?:\/\/\S+/gi,'[URL omitida]');
  if(!parsed||typeof parsed!=='object')return '';
  const fields={};
  for(const key of ['title','details','message','code'])if(typeof parsed[key]==='string')fields[key]=parsed[key].slice(0,200);
  return JSON.stringify(fields).slice(0,600);
}
function parseReplacement(response, expectedId, {allowMissingPhone=false}={}) {
  const value = parseJson(response);
  const rows = Array.isArray(value?.data) ? value.data : [value?.data?.activation || value?.data || value];
  // This is the authenticated response to replacing the exact requested order.
  // A single returned replacement may have a new activation ID.
  if(rows.length!==1||!rows[0])throw new Error('Troca sem identificação inequívoca da ativação; conferir no fornecedor.');
  const row=rows[0];
  const activationId=String(row.id??row.activationId??row.activation_id??'');
  if(!/^\d{1,30}$/.test(activationId))throw new Error('Troca sem ID de ativação válido.');
  const phone=String(row.phone??row.phoneNumber??row.phone_number??'').trim();
  if(!/^\+?\d{6,20}$/.test(phone)){
    if(allowMissingPhone)return {activationId,phone:null};
    throw new Error('Troca sem número válido; conferir no fornecedor.');
  }
  return {activationId,phone};
}
function smsCode(value) {
  const result = parseJson(value);
  if (typeof result === 'string') {
    return result.startsWith('STATUS_OK:') ? result.slice('STATUS_OK:'.length).trim() : null;
  }
  // REST otpLast and getStatusV2 use different field names.
  const otp = result?.otpLast ?? result?.data ?? result;
  if (!otp || (otp.type && otp.type !== 'sms') || (result?.verificationType && result.verificationType !== 'sms')) return null;
  const code = otp.smsCode ?? otp.code;
  return code == null || !String(code).trim() ? null : String(code).trim();
}
function historySmsCode(text) {
  const match = String(text || '').match(/(?:^|\D)(\d{4,8})(?!\d)/);
  return match ? match[1] : null;
}
function hasMore(response, page, size, count) {
  const meta = response?.meta;
  if (typeof meta?.hasMore === 'boolean') return meta.hasMore;
  if (meta?.total != null && Number.isFinite(Number(meta.total))) return page * size < Number(meta.total);
  return count === size;
}
module.exports = {parseReplacement, smsCode, historySmsCode, hasMore, compatibilityText, apiDate, parsePurchasedActivation, providerErrorSummary};
