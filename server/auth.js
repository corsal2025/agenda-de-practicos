'use strict';
// La aplicacion no tiene login: la autenticacion la resuelve la aplicacion padre.
// Este modulo solo entrega el nombre que queda en la bitacora (se mantiene el mismo
// texto para que los registros nuevos sean coherentes con los existentes).
const ACTOR = 'MODO SIN LOGIN';

const actor = () => ACTOR;

module.exports = { actor };
