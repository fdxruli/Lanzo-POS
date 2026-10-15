// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      updateAvailable: false,
      isUpdating: false,
      runUpdate: vi.fn()
    }))
  }
}));

vi.mock('../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

vi.mock('lucide-react', () => {
  const Icon = ({ size: _size, ...props }) => React.createElement('svg', props);
  return {
    Mail: Icon,
    RefreshCw: Icon,
    AlertTriangle: Icon,
    ShieldCheck: Icon,
    ShieldAlert: Icon,
    Info: Icon,
    Store: Icon,
    ArrowRightCircle: Icon,
    Copy: Icon,
    CheckCheck: Icon,
    Check: Icon,
    Send: Icon,
    Wifi: Icon,
    WifiOff: Icon
  };
});

import ErrorBoundary from '../components/common/ErrorBoundary';
import Logger from '../services/Logger';
import { useAppStore } from '../store/useAppStore';

function Bomb({ error }) {
  throw error;
}

function ConditionalBomb({ error, shouldThrow }) {
  if (shouldThrow) throw error;
  return <p data-testid="safe-child">SecciÃ³n recuperada</p>;
}

const renderWithError = (error, props = {}, path = '/') => {
  window.history.replaceState({}, '', `${path}?access_token=query-secret`);
  const boundaryRef = React.createRef();
  const result = render(
    <ErrorBoundary {...props} ref={boundaryRef}>
      <Bomb error={error} />
    </ErrorBoundary>
  );
  return { ...result, boundaryRef };
};

let originalCacheDescriptor;
let originalServiceWorkerDescriptor;
let originalOnlineDescriptor;
let originalClipboardDescriptor;
let originalUserAgentDescriptor;

beforeEach(() => {
  originalCacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Logger.error.mockClear();
  useAppStore.getState.mockReturnValue({
    updateAvailable: false,
    isUpdating: false,
    runUpdate: vi.fn()
  });
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  const restoreDescriptor = (object, key, descriptor) => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else delete object[key];
  };
  restoreDescriptor(globalThis, 'caches', originalCacheDescriptor);
  restoreDescriptor(navigator, 'serviceWorker', originalServiceWorkerDescriptor);
  restoreDescriptor(navigator, 'onLine', originalOnlineDescriptor);
  restoreDescriptor(navigator, 'clipboard', originalClipboardDescriptor);
  restoreDescriptor(navigator, 'userAgent', originalUserAgentDescriptor);
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its child when there is no error', () => {
    render(<ErrorBoundary><p>POS disponible</p></ErrorBoundary>);
    expect(screen.getByText('POS disponible')).toBeInTheDocument();
  });

  it('catches React render errors and shows a safe incident classification', () => {
    renderWithError(Object.assign(new TypeError('Cannot read properties of null'), { code: 'DB_OPEN_TIMEOUT' }));

    const details = document.querySelector('.incident-recovery__details-content');
    expect(details).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: /Detalles del problema/i }));
    expect(screen.getByText('DB_OPEN_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText(/Almacenamiento local/)).toBeInTheDocument();
    expect(document.querySelector('.incident-recovery--section')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Cannot read properties of null');
  });

  it('does not render sensitive error, cause, URL, business, license, or device details', () => {
    localStorage.setItem('lanzo_device_id', 'device-identifier-123456');
    const error = new Error('license_key=LNZ-FULL-SECRET customer=Ana Lopez total=9876.50');
    error.cause = new Error('token=jwt-secret');
    error.stack = 'Error: https://lanzo.test/caja?access_token=stack-secret';

    renderWithError(error, {}, '/clientes/Ana-Lopez');
    const renderedText = document.body.textContent;

    expect(renderedText).not.toContain('LNZ-FULL-SECRET');
    expect(renderedText).not.toContain('device-identifier-123456');
    expect(renderedText).not.toContain('Ana Lopez');
    expect(renderedText).not.toContain('Ana-Lopez');
    expect(renderedText).not.toContain('9876.50');
    expect(renderedText).not.toContain('jwt-secret');
    expect(renderedText).not.toContain('access_token');
    expect(renderedText).not.toContain('stack-secret');
  });

  it('logs only an allowlisted incident summary', () => {
    const error = new Error('token=jwt-secret');
    error.stack = 'at /private/route?key=secret';
    renderWithError(error);

    expect(Logger.error).toHaveBeenCalledWith('Error de interfaz capturado.', expect.objectContaining({
      code: 'INCIDENT_REACT_RENDER',
      category: 'react_render',
      severity: 'section_failure',
      errorType: 'Error'
    }));
    const logged = JSON.stringify(Logger.error.mock.calls);
    expect(logged).not.toContain('jwt-secret');
    expect(logged).not.toContain('/private/route');
  });

  it('copies a safe diagnostic without including the raw message or query parameters', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderWithError(Object.assign(new Error('license_key=LNZ-FULL-SECRET'), { code: 'DB_OPEN_TIMEOUT' }));

    fireEvent.click(screen.getByRole('button', { name: /Copiar diagnÃ³stico/i }));
    await act(async () => Promise.resolve());

    expect(writeText).toHaveBeenCalledOnce();
    const report = writeText.mock.calls[0][0];
    expect(report).toContain('DB_OPEN_TIMEOUT');
    expect(report).toContain('Almacenamiento local');
    expect(report).not.toContain('LNZ-FULL-SECRET');
    expect(report).not.toContain('access_token');
  });

  it('preserves browser storage when a local render retry fails and stops repeated retries', () => {
    window.sessionStorage.setItem('lanzo:authorized-session', 'keep-session');
    window.localStorage.setItem('lanzo:active-orders-storage', 'keep-orders');
    const error = new Error('same render failure');
    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /Reintentar secciÃ³n/i }));
    rerender(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    expect(window.sessionStorage.getItem('lanzo:authorized-session')).toBe('keep-session');
    expect(window.localStorage.getItem('lanzo:active-orders-storage')).toBe('keep-orders');
    expect(screen.getByRole('button', { name: /Reintento utilizado/i })).toBeDisabled();
  });

  it('allows a successful section retry without clearing saved state', () => {
    window.sessionStorage.setItem('lanzo:flow-state', 'preserve');
    const error = new Error('temporary section failure');
    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    rerender(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /Reintentar secciÃ³n/i }));

    expect(screen.getByTestId('safe-child')).toHaveTextContent('SecciÃ³n recuperada');
    expect(window.sessionStorage.getItem('lanzo:flow-state')).toBe('preserve');
  });

  it('blocks render recovery when the actor or tenant context became stale', () => {
    const createRecoveryContextGuard = vi.fn(() => () => false);
    renderWithError(new Error('stale section failure'), { createRecoveryContextGuard });

    expect(createRecoveryContextGuard).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Reabrir secciÃ³n desde el contexto actual/i })).toBeDisabled();
    expect(screen.getByText(/contexto de sesiÃ³n o negocio cambiÃ³/i)).toBeInTheDocument();
    expect(document.body.textContent).toContain('No pudimos mostrar esta secciÃ³n');
  });

  it('does not expose a generic reload action or clear cache after a section error', () => {
    const cacheDelete = vi.fn();
    const workerUpdate = vi.fn();
    globalThis.caches = { keys: vi.fn(), delete: cacheDelete };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => [{ update: workerUpdate }]) }
    });

    renderWithError(new Error('render failure'));

    expect(screen.queryByRole('button', { namgßm¢G§²ÚîÆ­yÖWGW&åfÇVR‡²WFFTf–Æ&ÆS¢fÇ6RÂ—5WFF–æs¢fÇ6RÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w&VæFW"f–ÇW&Rr’“° ¢W‡V7B‡67&VVâçVW'”'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’’ææ÷BçFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡'VåWFFR’ææ÷BçFô†fT&VVä6ÆÆVB‚“°¢Ò“° ¢—B‚vFVGWÆ–6FW2âW‡Æ–6—BtWFFRæBFöW2æ÷BfÆÂ&6²Fò66†RFVÆWF–öârÂ7–æ2‚’Óâ°¢ÆWB&W6öÇfUWFFS°¢6öç7B'VåWFFRÒf’æfâ‚‚’ÓâæWr&öÖ—6R‚‡&W6öÇfR’Óâ²&W6öÇfUWFFRÒ&W6öÇfS²Ò’“°¢6öç7B66†TFVÆWFRÒf’æfâ‚“°¢vÆö&ÅF†—2æ66†W2Ò²¶W—3¢f’æfâ‚’ÂFVÆWFS¢66†TFVÆWFRÓ°¢W6T7F÷&RævWE7FFRæÖö6µ&WGW&åfÇVR‡²WFFTf–Æ&ÆS¢G'VRÂ—5WFF–æs¢fÇ6RÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w&VæFW"f–ÇW&Rr’“° ¢6öç7BWFFT'WGFöâÒ67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò“°¢f—&TWfVçBæ6Æ–6²‡WFFT'WGFöâ“°¢f—&TWfVçBæ6Æ–6²‡WFFT'WGFöâ“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“° ¢W‡V7B‡'VåWFFR’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢&W6öÇfUWFFR‚“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“°¢W‡V7B†66†TFVÆWFR’ææ÷BçFô†fT&VVä6ÆÆVB‚“°¢Ò“° ¢—B‚w&÷WFW2Fòõ2v—F†÷WB6ÆV&–ær6W76–öâ÷"FVæçB7F÷&vRrÂ‚’Óâ°¢6öç7Bæf–vFUFõ÷2Òf’æfâ‚“°¢v–æF÷rç6W76–öå7F÷&vRç6WD—FVÒ‚vÆç¦ó¦WF†÷&—¦VB×6W76–öârÂv¶VWr“°¢v–æF÷ræÆö6Å7F÷&vRç6WD—FVÒ‚vÆç¦ó¦7F—fRÖ÷&FW'2×7F÷&vRrÂv¶VWr“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w6V7F–öâf–ÇW&Rr’Â²æf–vFUFõ÷2ÒÂr÷fVçF2r“° ¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢õföÇfW"Â–æ–6–òö’Ò’“° ¢W‡V7B†æf–vFUFõ÷2’çFô†fT&VVä6ÆÆVEv—F‚‚ròr“°¢W‡V7B‡v–æF÷rç6W76–öå7F÷&vRævWD—FVÒ‚vÆç¦ó¦WF†÷&—¦VB×6W76–öâr’’çFô&R‚v¶VWr“°¢W‡V7B‡v–æF÷ræÆö6Å7F÷&vRævWD—FVÒ‚vÆç¦ó¦7F—fRÖ÷&FW'2×7F÷&vRr’’çFô&R‚v¶VWr“°¢Ò“° ¢—B‚vFöW2æ÷B&VæFW"&rW'&÷"FWF–Ç2v†VâöffÆ–æRrÂ‚’Óâ°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"ÂvöäÆ–æRrÂ²6öæf–wW&&ÆS¢G'VRÂfÇVS¢fÇ6RÒ“°¢6öç7BW'&÷"ÒæWrW'&÷"‚tf–ÆVBFòfWF6‚&—fFR7W7FöÖW"FWF–Ç2r“°¢&VæFW%v—F„W'&÷"†W'&÷"“° ¢W‡V7B‡67&VVâævWD'•FW‡B‚õ6–â6öæW†œ;6âò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚w&—fFR7W7FöÖW"FWF–Ç2r“°¢Ò“° ¢—B‚v¶VW2FV6†æ–6Â7VÖÖ&–W2&÷VæFVBFòÆÆ÷vÆ—7FVB&W÷'Bf–VÆG2rÂ‚’Óâ°¢6öç7BW'&÷"ÒæWrW'&÷"‚v7W7FöÖW#ÔæÆ÷W¢F÷FÃÓ“ƒsbãSÆ–6Vç6Uö¶W“ÔÄå¢Õ$•dDRÓ#2Fö¶VãÖ§wB×6V7&WBr“°¢W'&÷"æ6öFRÒtD%ôõTåõD”ÔTõUBs°¢W'&÷"æ6W6RÒæWrW'&÷"‚w†öæSÓSSS#3CScrVÖ–ÃÖæW†×ÆRæ6öÒr“°¢W'&÷"ç7F6²ÒtW'&÷#¢‡GG3¢òöÆç¦òçFW7B÷fVçF2÷&—fFSö66W75÷Fö¶Vã×7F6²×6V7&WBs°¢6öç7B²&÷VæF'•&VbÒÒ&VæFW%v—F„W'&÷"†W'&÷"Â·ÒÂr÷fVçF2÷&—fFRÖ7W7FöÖW"Ö–Br“°¢6öç7B&W÷'BÒ&÷VæF'•&Vbæ7W'&VçBåö'V–ÆE&W÷'DÖW76vR‚“° ¢W‡V7B‡&W÷'B’çFô6öçF–â‚u$Uõ%DRL8”4ä”4òDR”ä4”DTä4”ÒÄå¤òõ2r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t<;6F–vòFR–æ6–FVæ6–¢D%ôõTåõD”ÔTõUBr“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t6Æ6–f–66œ;6ã¢ÆÖ6VæÖ–VçFòÆö6Âr“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚tw&fVFC¢6V7F–öåöf–ÇW&Rr“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚uF—òL:–6æ–6ó¢W'&÷"r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚u6V66œ;6ã¢÷fVçF2r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t6öæV7F—f–FC¢öæÆ–æRr“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚tfV6†’†÷&¢r“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚tæÆ÷W¢r“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚w&—fFRÖ7W7FöÖW"Ö–Br“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚s“ƒsbãSr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚tÄå¢Õ$•dDRÓ#2r“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚v§wB×6V7&WBr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚sSSS#3CScrr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚væW†×ÆRæ6öÒr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚w7F6²×6V7&WBr“°¢Ò“° ¢—B‚vFöW2æ÷B6W&–Æ—¦RVæ¶æ÷vâ6öFW2ÂU$Â&ÖWFW'2Â6W6W2Â÷"7F6²g&ÖW2rÂ‚’Óâ°¢6öç7BW'&÷"ÒæWrW'&÷"‚uVæW‡V7FVB7W7FöÖW#×&—fFRÖæÖRr“°¢W'&÷"æ6öFRÒw6V7&WB×Fö¶Vâ×fÇVRÓ#3CSbs°¢W'&÷"æ6W6RÒæWrW'&÷"‚vÆ–6Vç6Uö¶W“ÖgVÆÂÖÆ–6Vç6R×fÇVRr“°¢W'&÷"ç7F6²ÒtW'&÷"B‡GG3¢òöÆç¦òçFW7Bö6¦ö¶W“Ö7W7FöÖW"×6V7&WBs°¢6öç7B²&÷VæF'•&VbÒÒ&VæFW%v—F„W'&÷"†W'&÷"Â·ÒÂr÷'WFÖ6öâÖ–FVçF–f–6F÷"Ó#2r“°¢6öç7B&W÷'BÒ&÷VæF'•&Vbæ7W'&VçBåö'V–ÆE&W÷'DÖW76vR‚“° ¢W‡V7B‡&W÷'B’çFô6öçF–â‚t<;6F–vòFR–æ6–FVæ6–¢”ä4”DTåEõ$T5Eõ$TäDU"r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t6Æ6–f–66œ;6ã¢&VæFW"FR–çFW&f¢r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚tw&fVFC¢6V7F–öåöf–ÇW&Rr“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚u6V66œ;6ã¢÷G&6V66œ;6âr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚w6V7&WB×Fö¶Vâ×fÇVRr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚vgVÆÂÖÆ–6Vç6R×fÇVRr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚v7W7FöÖW"×6V7&WBr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚w&—fFRÖæÖRr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚w'WFÖ6öâÖ–FVçF–f–6F÷"r“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚v‡GG3¢òòr“°¢Ò“° ¢—B‚vÆöw2F–ÖW7F×æB66Æ"–æ6–FVçBf–VÆG2v—F†÷WBGF6†–ærW'&÷"ö&¦V7G2rÂ‚’Óâ°¢6öç7BW'&÷"Òö&¦V7Bæ76–vâ†æWrG—TW'&÷"‚w&—fFRFWF–Âr’Â²6öFS¢tD%ô$Äô4´TBrÒ“°¢&VæFW%v—F„W'&÷"†W'&÷"“° ¢6öç7BÆövvVBÒÆövvW"æW'&÷"æÖö6²æ6ÆÇ5³Õ³Ó°¢W‡V7B„ÆövvW"æW'&÷"’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢W‡V7B†ÆövvVBæ6öFR’çFô&R‚tD%ô$Äô4´TBr“°¢W‡V7B†ÆövvVBæ6FVv÷'’’çFô&R‚v–æFW†VFF"r“°¢W‡V7B†ÆövvVBç6WfW&—G’’çFô&R‚w6V7F–öåöf–ÇW&Rr“°¢W‡V7B†ÆövvVBæW'&÷%G—R’çFô&R‚uG—TW'&÷"r“°¢W‡V7B†ÆövvVBæ6ö×öæVçE7F6´f–Æ&ÆR’çFô&R‡G'VR“°¢W‡V7B„çVÖ&W"æ—4æâ†æWrFFR†ÆövvVBçF–ÖW7F×’ævWEF–ÖR‚’’’çFô&R†fÇ6R“°¢W‡V7B„ö&¦V7BçfÇVW2†ÆövvVB’æ¦ö–â‚rr’’ææ÷BçFô6öçF–â‚w&—fFRFWF–Âr“°¢W‡V7B„ö&¦V7Bæ¶W—2†ÆövvVB’’çFôWVÂ…°¢wF–ÖW7F×rÂv6öFRrÂv6FVv÷'’rÂw6WfW&—G’rÂvW'&÷%G—RrÂv6ö×öæVçE7F6´f–Æ&ÆRp¢Ò“°¢Ò“° ¢—B‚wW6W26fRfÆÆ&6²ÖWFFFv†VââW'&÷"†2æòW6VgVÂÖW76vR÷"7W7FöÒæÖRrÂ‚’Óâ°¢6öç7BW'&÷"ÒæWrW'&÷"‚“°¢W'&÷"ææÖRÒt7W7FöÖW%Fö¶VäW'&÷"s°¢6öç7B²&÷VæF'•&VbÒÒ&VæFW%v—F„W'&÷"†W'&÷"“°¢6öç7B&W÷'BÒ&÷VæF'•&Vbæ7W'&VçBåö'V–ÆE&W÷'DÖW76vR‚“° ¢W‡V7B‡67&VVâævWD'•&öÆR‚v†VF–ærrÂ²æÖS¢tæòVF–Ö÷2Ö÷7G&"W7F6V66œ;6ârÒ’’çFô&T–åF†TFö7VÖVçB‚“°¢6öç7BFWF–Ç2ÒFö7VÖVçBçVW'•6VÆV7F÷"‚ræ–æ6–FVçB×&V6÷fW'•õöFWF–Ç2Ö6öçFVçBr“°¢W‡V7B†FWF–Ç2’çFô†fTGG&–'WFR‚v†–FFVâr“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚t7W7FöÖW%Fö¶VäW'&÷"r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚uF—òL:–6æ–6ó¢W'&÷"r“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t6Æ6–f–66œ;6ã¢&VæFW"FR–çFW&f¢r“°¢W‡V7B‡&W÷'BæÆVæwF‚’çFô&TÆW75F†âƒóS“°¢Ò“° ¢—B‚v¶VW2fW'’Æöær7F6²G&6W2÷WBöbF†RW6W"–çFW&f6RæB6÷–VB&W÷'BrÂ7–æ2‚’Óâ°¢6öç7BW'&÷"ÒæWrW'&÷"‚vFVW&V7W'6–öâ7W7FöÖW"&—fFRÖFFr“°¢W'&÷"ç7F6²ÒW'&÷#¢G¶W'&÷"æÖW76vWÕÆâG²rB–çFW&æÂ÷&—fFR÷F…Æârç&WVBƒ#S—Ö°¢6öç7Bw&—FUFW‡BÒf’æfâ‚’æÖö6µ&W6öÇfVEfÇVR‡VæFVf–æVB“°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Âv6Æ—&ö&BrÂ²6öæf–wW&&ÆS¢G'VRÂfÇVS¢²w&—FUFW‡BÒÒ“°¢&VæFW%v—F„W'&÷"†W'&÷"“° ¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“° ¢6öç7B&W÷'BÒw&—FUFW‡BæÖö6²æ6ÆÇ5³Õ³Ó°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚vB–çFW&æÂ÷&—fFR÷F‚r“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚vFVW&V7W'6–öâ7W7FöÖW"×&—fFRÖFFr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚v–çFW&æÂ÷&—fFR÷F‚r“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚vFVW&V7W'6–öâ7W7FöÖW"r“°¢W‡V7B‡&W÷'BæÆVæwF‚’çFô&TÆW75F†âƒóS“°¢Ò“° ¢—B‚v6÷–W2F†R6fR&W÷'BæB6†÷w2FV×÷&'’6÷–VB7FFRrÂ7–æ2‚’Óâ°¢6öç7Bw&—FUFW‡BÒf’æfâ‚’æÖö6µ&W6öÇfVEfÇVR‡VæFVf–æVB“°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Âv6Æ—&ö&BrÂ²6öæf–wW&&ÆS¢G'VRÂfÇVS¢²w&—FUFW‡BÒÒ“°¢6öç7B²&÷VæF'•&VbÒÒ&VæFW%v—F„W'&÷"„ö&¦V7Bæ76–vâ†æWrW'&÷"‚w&—fFRr’Â²6öFS¢u5”ä5õU4…ôd”ÄTBrÒ’“° ¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“° ¢W‡V7B‡w&—FUFW‡B’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢W‡V7B‡w&—FUFW‡BæÖö6²æ6ÆÇ5³Õ³Ò’çFô6öçF–â‚t<;6F–vòFR–æ6–FVæ6–¢5”ä5õU4…ôd”ÄTBr“°¢W‡V7B‡w&—FUFW‡BæÖö6²æ6ÆÇ5³Õ³Ò’çFô6öçF–â‚t6Æ6–f–66œ;6ã¢6–æ7&öæ—¦6œ;6âr“°¢W‡V7B‡w&—FUFW‡BæÖö6²æ6ÆÇ5³Õ³Ò’ææ÷BçFô6öçF–â‚w&—fFRr“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ôF–vì;77F–6ò6÷–Fòö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B†&÷VæF'•&Vbæ7W'&VçBç7FFRæ6÷–VB’çFô&R‡G'VR“°¢Ò“° ¢—B‚w&W7F÷&W2F†R6÷’'WGFöâÆ&VÂgFW"—G2F–ÖV÷WBrÂ7–æ2‚’Óâ°¢f’çW6Tf¶UF–ÖW'2‚“°¢G'’°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Âv6Æ—&ö&BrÂ°¢6öæf–wW&&ÆS¢G'VRÀ¢fÇVS¢²w&—FUFW‡C¢f’æfâ‚’æÖö6µ&W6öÇfVEfÇVR‡VæFVf–æVB’Ğ¢Ò“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚v6÷’F–ÖW"r’“°¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“° ¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ôF–vì;77F–6ò6÷–Fòö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢7B‚‚’Óâf’æGfæ6UF–ÖW'4'•F–ÖRƒ5ó’“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚w7F6²r“°¢Òf–æÆÇ’°¢f’çW6U&VÅF–ÖW'2‚“°¢Ğ¢Ò“° ¢—B‚v¶VW2F†RæVÂW6&ÆRv†Vâ6Æ—&ö&B66W72—2FVæ–VBrÂ7–æ2‚’Óâ°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"Âv6Æ—&ö&BrÂ°¢6öæf–wW&&ÆS¢G'VRÀ¢fÇVS¢²w&—FUFW‡C¢f’æfâ‚’æÖö6µ&V¦V7FVEfÇVR†æWrW'&÷"‚wW&Ö—76–öâFVæ–VBr’’Ğ¢Ò“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚v6Æ—&ö&B—77VRr’“° ¢v—B7B†7–æ2‚’Óâ°¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’“°¢Ò“° ¢W‡V7B‡67&VVâævWD'•FW‡B‚ôæò6RVFò6÷–"VÂF–vì;77F–6òò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô6÷–"F–vì;77F–6òö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚wW&Ö—76–öâFVæ–VBr“°¢Ò“° ¢—B‚vöffW'2&÷WFR&6²Fòõ2öæÇ’v’g&öÒF†Rõ2&ö÷BrÂ‚’Óâ°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w6V7F–öâf–ÇW&Rr’Â·ÒÂr÷&W÷'FW2÷6V7&WCö66W75÷Fö¶Vã×VW'’×6V7&WBr“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢õföÇfW"Â–æ–6–òö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚wVW'’×6V7&WBr“°¢Ò“° ¢—B‚vFöW2æ÷BöffW"&÷WFR6†ævRv†VâF†Rõ2&ö÷B—G6VÆbf–Ç2rÂ‚’Óâ°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w÷2f–ÇW&Rr’Â·ÒÂròr“°¢W‡V7B‡67&VVâçVW'”'•&öÆR‚v'WGFöârÂ²æÖS¢õföÇfW"Â–æ–6–òö’Ò’’ææ÷BçFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡67&VVâçVW'”'•&öÆR‚v'WGFöârÂ²æÖS¢õ&V6&v'Å&V–æ–6–"ö’Ò’’ææ÷BçFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢õ&V–çFVçF"6V66œ;6âö’Ò’’çFô&T–åF†TFö7VÖVçB‚“°¢Ò“° ¢—B‚vFöW2æ÷B6Æ–ÒF†B&V6÷&G2÷"VæF–ærf–ææ6–Â÷WF6öÖW2&R6öæf—&ÖVB6fRrÂ‚’Óâ°¢&VæFW%v—F„W'&÷"„ö&¦V7Bæ76–vâ†æWrW'&÷"‚w–ÖVçB&W7VÇBÖ&–wV÷W2r’Â²6öFS¢td”ää4”Åõ$U5TÅEõTä´äõtârÒ’“°¢6öç7Bf—6–&ÆRÒFö7VÖVçBæ&öG’çFW‡D6öçFVçC° ¢W‡V7B‡f—6–&ÆR’çFô6öçF–â‚t6öç7VÇFVÂ&V6–&òòÆVFvW"6ì;6æ–6ò6öâ6÷÷'FRr“°¢W‡V7B‡f—6–&ÆR’ææ÷BçFôÖF6‚‚÷GW2FF÷2FRfVçF2’6¦W7L:â6VwW&÷2ö’“°¢W‡V7B‡f—6–&ÆR’ææ÷BçFôÖF6‚‚öVÂ6ö'&ò6R6ö×ÆWL;26÷'&V7FÖVçFRö’“°¢W‡V7B‡67&VVâævWD'•&öÆR‚vÆW'FF–ÆörrÂ²æÖS¢tæV6W6—FÖ÷2fW&–f–6"W7F÷W&6œ;6ârÒ’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡f—6–&ÆR’ææ÷BçFô6öçF–â‚w–ÖVçB&W7VÇBÖ&–wV÷W2r“°¢Ò“° ¢—B‚vFöW2æ÷B6†÷râWFFR7F–öâv†–ÆRöffÆ–æR÷"v†VâæòWFFRgVæ7F–öâW†—7G2rÂ‚’Óâ°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"ÂvöäÆ–æRrÂ²6öæf–wW&&ÆS¢G'VRÂfÇVS¢fÇ6RÒ“°¢6öç7B'VåWFFRÒf’æfâ‚“°¢W6T7F÷&RævWE7FFRæÖö6µ&WGW&åfÇVR‡²WFFTf–Æ&ÆS¢G'VRÂ—5WFF–æs¢fÇ6RÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚vöffÆ–æR6V7F–öâf–ÇW&Rr’“° ¢W‡V7B‡67&VVâævWD'•FW‡B‚õ6–â6öæW†œ;6âò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡67&VVâçVW'”'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’’ææ÷BçFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡'VåWFFR’ææ÷BçFô†fT&VVä6ÆÆVB‚“°¢W‡V7B‡67&VVâçVW'”'•&öÆR‚v'WGFöârÂ²æÖS¢õ&V6&v'Å&V–æ–6–"ö’Ò’’ææ÷BçFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡v–æF÷rç6W76–öå7F÷&vRæÆVæwF‚’çFô&Rƒ“°¢Ò“° ¢—B‚w&W÷'G2f–ÆVBtWFFRöæ6RæB&WfVçG2GWÆ–6FRWFFRGFV×G2rÂ7–æ2‚’Óâ°¢6öç7B'VåWFFRÒf’æfâ‚’æÖö6µ&V¦V7FVEfÇVR†æWrW'&÷"‚wv÷&¶W"7F—fF–öâf–ÆVBr’“°¢W6T7F÷&RævWE7FFRæÖö6µ&WGW&åfÇVR‡²WFFTf–Æ&ÆS¢G'VRÂ—5WFF–æs¢fÇ6RÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w&VæFW"f–ÇW&Rr’Â²7&VFU&V6÷fW'”6öçFW‡DwV&C¢‚’Óâ‚’ÓâG'VRÒ“° ¢6öç7BWFFT'WGFöâÒ67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò“°¢f—&TWfVçBæ6Æ–6²‡WFFT'WGFöâ“°¢v—B7B†7–æ2‚’Óâ&öÖ—6Rç&W6öÇfR‚’“° ¢W‡V7B‡'VåWFFR’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢W‡V7B‡67&VVâævWD'•FW‡B‚ôæò6RVFò6öæf—&Ö"Æ7GVÆ—¦6œ;6âò’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’’çFô&TF—6&ÆVB‚“°¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’“°¢W‡V7B‡'VåWFFR’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚wv÷&¶W"7F—fF–öâf–ÆVBr“°¢W‡V7B‡v–æF÷ræÆö6Å7F÷&vRæÆVæwF‚’çFô&Rƒ“°¢Ò“° ¢—B‚w&W÷'G2âWFFR7F–öâF†B&W6öÇfW2v—F†÷WBÇ––ærF†RæWrv÷&¶W"rÂ7–æ2‚’Óâ°¢6öç7B'VåWFFRÒf’æfâ‚’æÖö6µ&W6öÇfVEfÇVR‡VæFVf–æVB“°¢W6T7F÷&RævWE7FFRæÖö6µ&WGW&åfÇVR‡²WFFTf–Æ&ÆS¢G'VRÂ—5WFF–æs¢fÇ6RÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w&VæFW"f–ÇW&Rr’Â²7&VFU&V6÷fW'”6öçFW‡DwV&C¢‚’Óâ‚’ÓâG'VRÒ“° ¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’“°¢v—Bv—Df÷"‚‚’Óâ°¢W‡V7B‡67&VVâævWD'•FW‡B‚ôæò6RVFò6öæf—&Ö"Æ7GVÆ—¦6œ;6âò’’çFô&T–åF†TFö7VÖVçB‚“°¢Ò“° ¢W‡V7B‡'VåWFFR’çFô†fT&VVä6ÆÆVDöæ6R‚“°¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦"Æ–66œ;6âö’Ò’’çFô&TF—6&ÆVB‚“°¢W‡V7B†Fö7VÖVçBæ&öG’çFW‡D6öçFVçB’ææ÷BçFô6öçF–â‚utõUDDUôäõEôÄ”TBr“°¢Ò“° ¢—B‚vF—6&ÆW2WFFW2Ç&VG’'Vææ–ær–âF†R7F÷&RrÂ‚’Óâ°¢6öç7B'VåWFFRÒf’æfâ‚“°¢W6T7F÷&RævWE7FFRæÖö6µ&WGW&åfÇVR‡²WFFTf–Æ&ÆS¢G'VRÂ—5WFF–æs¢G'VRÂ'VåWFFRÒ“°¢&VæFW%v—F„W'&÷"†æWrW'&÷"‚w&VæFW"f–ÇW&Rr’Â²7&VFU&V6÷fW'”6öçFW‡DwV&C¢‚’Óâ‚’ÓâG'VRÒ“° ¢W‡V7B‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ô7GVÆ—¦æFòÆ–66œ;6âö’Ò’’çFô&TF—6&ÆVB‚“°¢W‡V7B‡'VåWFFR’ææ÷BçFô†fT&VVä6ÆÆVB‚“°¢W‡V7B‡67&VVâævWD'•FW‡B‚ôÆ7GVÆ—¦6œ;6â–W7L:Vâ7W'6òò’’çFô&T–åF†TFö7VÖVçB‚“°¢Ò“° ¢—B‚wW6W2&÷VæFVB'&÷w6W"7VÖÖ'’æB6öææV7F–öâÆ&VÂ–â—G2fö÷FW"æB&W÷'BrÂ‚’Óâ°¢ö&¦V7BæFVf–æU&÷W'G’†æf–vF÷"ÂwW6W$vVçBrÂ°¢6öæf–wW&&ÆS¢G'VRÀ¢fÇVS¢tÖ÷¦–ÆÆóRã…v–æF÷w2åBã’6‡&öÖRó#bããã6f&’óS3rã3bp¢Ò“°¢6öç7B²&÷VæF'•&VbÒÒ&VæFW%v—F„W'&÷"†æWrW'&÷"‚v'&÷w6W"F–væ÷7F–2r’“°¢6öç7B&W÷'BÒ&÷VæF'•&Vbæ7W'&VçBåö'V–ÆE&W÷'DÖW76vR‚“° ¢f—&TWfVçBæ6Æ–6²‡67&VVâævWD'•&öÆR‚v'WGFöârÂ²æÖS¢ôFWFÆÆW2FVÂ&ö&ÆVÖö’Ò’“°¢W‡V7B‡67&VVâævWD'•FW‡B‚sBããr’’çFô&T–åF†TFö7VÖVçB‚“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚tæfVvF÷#¢6‡&öÖR#br“°¢W‡V7B‡&W÷'B’çFô6öçF–â‚t6öæV7F—f–FC¢öæÆ–æRr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚uv–æF÷w2åBr“°¢W‡V7B‡&W÷'B’ææ÷BçFô6öçF–â‚u6f&’óS3rr“°¢Ò“°§Ò“° 