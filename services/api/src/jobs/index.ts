/**
 * `services/api/src/jobs` — cola genérica de trabajos sobre PostgreSQL (`SELECT … FOR UPDATE SKIP
 * LOCKED`), observable y que sobrevive a que el proceso que la procesa se caiga.
 *
 * Este fichero es un barrel local, NO el punto de entrada del paquete: `services/api/src/index.ts`
 * es propiedad exclusiva de quien integra, y sigue sin reexportar nada de aquí hasta que lo haga. Se
 * importa por ruta relativa (`../jobs/index.js` o directo a cada fichero) mientras tanto.
 */

export {
  asegurarEsquemaDeTrabajos,
  ESQUEMA_DE_TRABAJOS_SQL,
  otorgarPrivilegiosDeTrabajos,
} from './esquema.js';

export {
  colaDeTrabajosEnPostgres,
  type ColaDeTrabajos,
  type ConteoPorEstado,
  type EstadoDeTrabajo,
  type NuevoTrabajo,
  type OpcionesDeReclamo,
  type ResultadoDeFallo,
  type TrabajoEncolado,
  type TrabajoReclamado,
} from './cola.js';

export {
  crearTrabajadorDeTrabajos,
  DIARIO_A_STDERR,
  REINTENTO_EXPONENCIAL_TOPE_5MIN,
  type DiarioDeTrabajos,
  type ManejadorDeTrabajo,
  type OpcionesDelTrabajador,
  type PoliticaDeReintento,
  type ResultadoDeCiclo,
  type TrabajadorDeTrabajos,
} from './trabajador.js';
