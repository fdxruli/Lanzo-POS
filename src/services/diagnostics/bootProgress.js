// Display-only boot phases. Never store identities, tokens, license keys or database contents.
const phases = new Set(['starting','reading_license','tenant_authority','opening_database','reading_session','staff_verification','admin_verification','actor_restoration','loading_profile','device_discovery','reusing_session']);
let state = Object.freeze({ active:false, phase:'not_started', since:null });
export const getBootProgress = () => state;
export const startBootProgress = () => { state = Object.freeze({active:true,phase:'starting',since:Date.now()}); };
export const setBootProgressPhase = phase => { if (state.active && phases.has(phase)) state=Object.freeze({active:true,phase,since:Date.now()}); };
export const finishBootProgress = () => { state=Object.freeze({...state,active:false}); };
