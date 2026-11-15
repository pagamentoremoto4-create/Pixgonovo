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
function parseReplacement(response, expectedId) {
  const value = parseJson(response);
  const rows = Array.isArray(value?.data) ? value.data : [value?.data?.activation || value?.data || value];
  const matches = rows.filter(row => row && String(row.id ?? row.activationId ?? row.activation_id) === String(expectedId));
  // A different activation must never be attached to this paid order.
  if (matches.length !== 1) throw new Error('Troca sem identificação inequívoca da ativação; conferir no fornecedor.');
  const row = matches[0];
  const phone = String(row.phone ?? row.phoneNumber ?? row.phone_number ?? '').trim();
  if (!/^\+?\d{6,20}$/.test(phone)) throw new Error('Troca sem número válido; conferir no fornecedor.');
  return {activationId: String(expectedId), phone};
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
module.exports = {parseReplacement, smsCode, historySmsCode, hasMore, compatibilityText, apiDate};
