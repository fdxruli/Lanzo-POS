// Compatibilidad hacia atras: este modulo legacy ahora apunta al coordinador inteligente.
// Evita que imports antiguos arranquen posSyncOrchestrator directamente y salten el deferral de snapshots.
export {
  startPosSyncAutoBootstrap,
  stopPosSyncAutoBootstrap
} from './posSyncBootstrapAutoCoordinator';

export { default } from './posSyncBootstrapAutoCoordinator';
