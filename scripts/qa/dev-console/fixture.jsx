import {createRoot} from 'react-dom/client';
import {DevConsolePanel} from '../../../src/components/debug/DevConsole';
import {installDevConsoleCapture} from '../../../src/services/devConsoleCapture';
import {emitDiagnosticConsoleEvent} from '../../../src/services/diagnostics/consoleEventBus';
installDevConsoleCapture();
window.seedDiagnostic = () => {
  emitDiagnosticConsoleEvent('info', [{diagnosticOperation:'sync.status',diagnosticState:'online',token:'private-token'}]);
  for(let i=0;i<3;i++) emitDiagnosticConsoleEvent('warn',[{diagnosticOperation:'sync.pull'},{code:'NETWORK_TIMEOUT',message:'private-message'}]);
  emitDiagnosticConsoleEvent('error',[{diagnosticOperation:'sync.pull'},new Error('private-unclassified')]);
};
window.seedDiagnostic();
let count=0; document.querySelector('#operation').onclick=()=>{document.querySelector('#counter').textContent=String(++count);};
createRoot(document.getElementById('root')).render(<DevConsolePanel canCopy={()=>true}/>);
