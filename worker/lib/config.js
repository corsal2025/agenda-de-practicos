// Version recortada de server/config.js para Cloudflare Workers: sin RAIZ/DB_PATH
// (no hay filesystem local), sin PUERTO (no hay servidor HTTP propio) y sin SMTP
// (correo.js usa la API HTTP de Resend, configurada via env.RESEND_API_KEY).
// EXAMINADORES/FUNCIONARIOS/CATALOGOS de semilla ya no viven aqui: se sembraron
// una sola vez en migrations/0001_init.sql.

// Bloques horarios de cada dia habil (uno por examinador).
export const HORAS = [
  '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
  '11:30', '12:00', '12:30', '13:00', '13:30',
];

// Unico bloque donde se admiten las clases D y A5 (vehiculos pesados).
// El resto de los bloques: PROHIBIDO D y A5.
export const HORA_D_A5 = '12:30';
export const CLASES_PESADAS = ['D', 'A5'];

export const CATALOGOS = {
  clase:        ['B', 'C', 'D', 'A1', 'A2', 'A3', 'A4', 'A5', 'E'],
  tipo_cita:    ['NORMAL', 'REAGENDADO', 'TRASLADO EN TERRENO'],
  resultado:    ['APROBADO', 'REPROBADO', 'REPROBADO INASISTENCIA', 'NO ASISTIO'],
  intento:      ['1° VEZ', '2° VEZ'],
  lista_espera: ['SI', 'NO'],
};
