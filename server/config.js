'use strict';
const path = require('node:path');

// Bloques horarios de cada dia habil (uno por examinador).
const HORAS = [
  '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
  '11:30', '12:00', '12:30', '13:00', '13:30',
];

// Unico bloque donde se admiten las clases D y A5 (vehiculos pesados).
// El resto de los bloques: PROHIBIDO D y A5.
const HORA_D_A5 = '12:30';
const CLASES_PESADAS = ['D', 'A5'];

// Semillas iniciales (se pueden editar luego desde la pestana Datos).
const EXAMINADORES = ['DANIEL LAGOS', 'DOMINGO NAVARRO', 'LUIS FERNANDEZ'];
const FUNCIONARIOS = ['CAROLINA CUADRA', 'JARED LOPEZ', 'SUSANA CAMPANA', 'MATIAS BOZZO'];

const CATALOGOS = {
  clase:        ['B', 'C', 'D', 'A1', 'A2', 'A3', 'A4', 'A5', 'E'],
  tipo_cita:    ['NORMAL', 'REAGENDADO', 'TRASLADO EN TERRENO'],
  resultado:    ['APROBADO', 'REPROBADO', 'REPROBADO INASISTENCIA', 'NO ASISTIO'],
  intento:      ['1° VEZ', '2° VEZ'],
  lista_espera: ['SI', 'NO'],
};

const RAIZ = path.join(__dirname, '..');
const DB_PATH = process.env.AGENDA_DB || path.join(RAIZ, 'data', 'agenda.db');
// 4900: puerto propio de la agenda. Se evita 4173/5173 (los usa la app de estetica / Vite).
const PUERTO = Number(process.env.PORT) || 4900;

module.exports = {
  HORAS, HORA_D_A5, CLASES_PESADAS,
  EXAMINADORES, FUNCIONARIOS, CATALOGOS,
  RAIZ, DB_PATH, PUERTO,
};
