'use strict';
const DDDS = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));

// Preserva os dígitos informados: não inventa nem remove o nono dígito.
module.exports = function normalizarNumeroBR(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error('Digite o número real no campo Número com DDD. O exemplo cinza é apenas uma orientação.');
  if (!/^[+\d\s().-]+$/.test(texto)) throw new Error('Use somente os dígitos do número, com DDD. Espaços, parênteses, + e hífen são permitidos.');
  let numero = texto.replace(/\D/g, '');
  if (numero.startsWith('0055')) numero = numero.slice(2);
  if (numero.length === 10 || numero.length === 11) numero = '55' + numero;
  if (!/^55[1-9]\d\d{8,9}$/.test(numero)) throw new Error('Número incompleto: informe o DDD + número de 8 ou 9 dígitos, com ou sem +55.');
  if (!DDDS.has(numero.slice(2, 4))) throw new Error('DDD inválido. Confira os dois dígitos do DDD.');
  return numero;
};
