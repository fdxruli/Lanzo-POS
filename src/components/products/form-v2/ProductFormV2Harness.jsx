import { useState } from 'react';
import ProductFormV2 from './ProductFormV2';

// Harness aislado: no se importa desde ProductsPage ni de rutas productivas.
export default function ProductFormV2Harness() {
  const [lastPayload, setLastPayload] = useState(null);
  return <><ProductFormV2 activeRubroContext="abarrotes" categories={[]} onCancel={() => setLastPayload(null)} onSave={(payload) => { setLastPayload(payload); return true; }} />{lastPayload && <pre aria-label="Último payload V2">{JSON.stringify(lastPayload, null, 2)}</pre>}</>;
}
