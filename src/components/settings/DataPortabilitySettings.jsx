import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, PackageOpen, Upload, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { showConfirmModal } from '../../services/utils';
import {
  BACKUP_DATA_CATEGORIES,
  BACKUP_TABLE_NAMES
} from '../../services/backup/backupScope';
import {
  PORTABLE_TRANSFER_TABLES,
  downloadPortableDataPackage,
  downloadPortableTableCsv,
  previewCatalogTransfer,
  importCatalogTransfer
} from '../../services/backup/portableDataTransfer';
import './DataPortabilitySettings.css';

const CATEGORY_LABELS = {
  catalog: 'Productos, categorías, ingredientes e imágenes',
  inventory: 'Existencias, lotes, mermas y movimientos de inventario',
  customers: 'Clientes, fiados, abonos y saldos',
  sales: 'Ventas, partidas y cancelaciones',
  layaways: 'Apartados y sus pagos',
  cash: 'Cajas, sesiones y movimientos',
  deletedRecords: 'Registros eliminados',
  sequences: 'Folio de venta'
};

const TABLE_LABELS = {
  menu: 'Productos', categories: 'Categorías', ingredients: 'Ingredientes', images: 'Imágenes',
  product_batches: 'Lotes', customers: 'Clientes', sales: 'Ventas', customer_ledger: 'Fiados y abonos',
  layaways: 'Apartados', cajas: 'Sesiones de caja', movimientos_caja: 'Movimientos de caja',
  waste_logs: 'Mermas', inventory_events: 'Movimientos de inventario', deleted_menu: 'Productos eliminados',
  deleted_customers: 'Clientes eliminados', deleted_sales: 'Ventas canceladas/eliminadas',
  deleted_categories: 'Categorías eliminadas', sequences: 'Secuencias'
};

const MAX_TRANSFER_FILE_BYTES = 64 * 1024 * 1024;

const getSelectedTables = (selectedCategories) => (
  [...new Set(selectedCategories.flatMap((category) => BACKUP_DATA_CATEGORIES[category] || []))]
);

function SummaryList({ summary }) {
  if (!summary) return null;
  const rows = [
    ['Categorías', summary.categories],
    ['Productos', summary.products],
    ['Clientes', summary.customers],
    ['Imágenes', summary.images],
    ['Ingredientes', summary.ingredients]
  ];
  return (
    <dl className="data-portability-summary">
      {rows.map(([label, group]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {group?.create || 0} nuevos
            {group?.reuse ? ` · ${group.reuse} reutilizados` : ''}
            {group?.update ? ` · ${group.update} actualizables` : ''}
            {group?.duplicates ? ` · ${group.duplicates} duplicados` : ''}
            {group?.conflicts ? ` · ${group.conflicts} conflictos` : ''}
          </dd>
        </div>
      ))}
      <div><dt>Rechazados</dt><dd>{summary.rejected || 0}</dd></div>
    </dl>
  );
}

export default function DataPortabilitySettings({ isAdmin, captureSettingsAction }) {
  const inputRef = useRef(null);
  const [selectedCategories, setSelectedCategories] = useState(Object.keys(BACKUP_DATA_CATEGORIES));
  const [csvTable, setCsvTable] = useState('menu');
  const [transferFile, setTransferFile] = useState(null);
  const [transferBundle, setTransferBundle] = useState(null);
  const [transferPreview, setTransferPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isAdmin) return null;

  const runGuarded = async (permission, action, successMessage = '') => {
    let actorHandle;
    try {
      actorHandle = captureSettingsAction(permission, { adminOnly: true });
      actorHandle.assertCurrent(permission);
      setBusy(true);
      setError('');
      const result = await action(() => actorHandle.assertCurrent(permission));
      actorHandle.assertCurrent(permission);
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (actionError) {
      try {
        actorHandle?.assertCurrent(permission);
        setError(actionError.message || 'No se pudo completar la operación.');
        toast.error(actionError.message || 'No se pudo completar la operación.');
      } catch {
        // An actor that lost authority cannot report or continue the old action.
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const exportJson = () => {
    const tableNames = getSelectedTables(selectedCategories);
    if (tableNames.length === 0) {
      setError('Selecciona al menos una categoría de información.');
      return;
    }
    runGuarded('settings_data', (assertAuthorized) => downloadPortableDataPackage({
      tableNames,
      assertAuthorized
    }), 'Exportación JSON descargada. Este archivo no está cifrado.');
  };

  const exportCsv = () => runGuarded('settings_data', (assertAuthorized) => (
    downloadPortableTableCsv(csvTable, { assertAuthorized })
  ), `${TABLE_LABELS[csvTable]} descargado en CSV.`);

  const selectTransferFile = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_TRANSFER_FILE_BYTES) {
      setError('El paquete supera 64 MiB. Divide la exportación y vuelve a intentarlo.');
      setTransferFile(null);
      setTransferBundle(null);
      setTransferPreview(null);
      return;
    }
    setTransferFile(file);
    setTransferBundle(null);
    setTransferPreview(null);
    await runGuarded('inventory', async (assertAuthorized) => {
      const text = await file.text();
      assertAuthorized();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('El archivo no contiene JSON válido.');
      }
      const preview = await previewCatalogTransfer(parsed, { assertAuthorized });
      setTransferBundle(parsed);
      setTransferPreview(preview);
      return preview;
    });
  };

  const confirmTransfer = async () => {
    if (!transferBundle || !transferPreview) return;
    const hasBlockedRows = transferPreview.conflicts.length > 0 || transferPreview.errors.length > 0;
    if (hasBlockedRows) return;
    let actorHandle;
    try {
      actorHandle = captureSettingsAction('inventory', { adminOnly: true });
    } catch {
      return;
    }
    const summary = transferPreview.summary;
    const confirmed = await showConfirmModal(
      `Se agregarán ${summary.products.create} productos, ${summary.categories.create} categorías, ${summary.customers.create} clientes y sus datos maestros compatibles. La importación no trasladará existencias, costos, ventas, cuentas, abonos ni movimientos de caja. ¿Continuar?`,
      {
        title: 'Transferir catálogo a este negocio',
        confirmButtonText: 'Transferir catálogo',
        cancelButtonText: 'Cancelar'
      }
    );
    if (!confirmed) return;
    try {
      actorHandle.assertCurrent('inventory');
    } catch {
      return;
    }
    const result = await runGuarded('inventory', (assertAuthorized) => (
      importCatalogTransfer(transferBundle, transferPreview, { assertAuthorized })
    ));
    if (result) {
      setTransferFile(null);
      setTransferBundle(null);
      setTransferPreview(null);
      toast.success(`Catálogo transferido. Productos nuevos: ${result.imported.products}; duplicados omitidos: ${result.skippedDuplicates.products}.`);
    }
  };

  const toggleCategory = (category) => {
    setSelectedCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  };

  return (
    <section className="data-portability-settings backup-settings-card">
      <div className="backup-settings-card__heading">
        <span className="backup-card-icon" aria-hidden="true"><FileSpreadsheet size={20} /></span>
        <div>
          <span className="backup-card-eyebrow">Exportar o transferir</span>
          <h4>Tu información comercial</h4>
          <p>Estos archivos sirven para consultar tus datos o reutilizar el catálogo en otro negocio LANZO. No reemplazan el respaldo cifrado.</p>
        </div>
      </div>

      <div className="data-portability-warning" role="note">
        <strong>Los archivos de exportación no están cifrados.</strong>
        <span>Incluyen datos personales y comerciales de las categorías que elijas. Guárdalos en un lugar privado.</span>
      </div>

      <fieldset className="data-portability-fieldset" disabled={busy}>
        <legend>Exportar información en JSON</legend>
        <div className="data-portability-categories">
          {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={selectedCategories.includes(category)}
                onChange={() => toggleCategory(category)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-secondary" onClick={exportJson} disabled={busy || selectedCategories.length === 0}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
          Descargar datos seleccionados
        </button>
      </fieldset>

      <div className="data-portability-csv">
        <label htmlFor="portable-csv-table">Exportar una tabla como CSV</label>
        <div>
          <select id="portable-csv-table" value={csvTable} onChange={(event) => setCsvTable(event.target.value)} disabled={busy}>
            {BACKUP_TABLE_NAMES.map((tableName) => <option key={tableName} value={tableName}>{TABLE_LABELS[tableName] || tableName}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={busy}>
            <FileSpreadsheet size={17} /> Descargar CSV
          </button>
        </div>
      </div>

      <fieldset className="data-portability-fieldset" disabled={busy}>
        <legend><PackageOpen size={17} /> Transferir a otro negocio LANZO</legend>
        <p>El paquete incluye categorías, productos, clientes básicos, imágenes e ingredientes. Los atributos de variantes compatibles se conservan con existencia cero. No incluye stock, costos, lotes, saldos, ventas ni movimientos financieros.</p>
        <button type="button" className="btn btn-secondary" onClick={() => runGuarded('settings_data', (assertAuthorized) => downloadPortableDataPackage({
          transferOnly: true,
          tableNames: PORTABLE_TRANSFER_TABLES,
          assertAuthorized
        }), 'Paquete de catálogo descargado sin existencias ni historial financiero.') } disabled={busy}>
          <Download size={17} /> Descargar paquete de catálogo
        </button>
        <div className="data-portability-import">
          <label className="btn btn-secondary" htmlFor="portable-transfer-file">
            <Upload size={17} /> Seleccionar paquete de catálogo
          </label>
          <input
            ref={inputRef}
            id="portable-transfer-file"
            type="file"
            accept=".json,.lanzo.json,application/json"
            onChange={selectTransferFile}
            disabled={busy}
          />
          {transferFile && <span>{transferFile.name}</span>}
        </div>
        {transferPreview && (
          <div className="data-portability-preview" role="status">
            <strong>Revisión previa</strong>
            <SummaryList summary={transferPreview.summary} />
            <p>Los registros duplicados se omitirán. Ningún archivo de ventas, inventario o finanzas se escribe en este negocio.</p>
            {transferPreview.conflicts.length > 0 && (
              <div className="data-portability-problems"><strong>Conflictos que debes resolver:</strong><ul>{transferPreview.conflicts.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
            )}
            {transferPreview.errors.length > 0 && (
              <div className="data-portability-problems"><strong>Datos que se rechazaron:</strong><ul>{transferPreview.errors.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
            )}
            <button type="button" className="btn btn-primary" onClick={confirmTransfer} disabled={busy || transferPreview.conflicts.length > 0 || transferPreview.errors.length > 0}>
              Transferir catálogo
            </button>
          </div>
        )}
      </fieldset>
      {error && <p className="backup-settings-error" role="alert">{error}</p>}
      <p className="data-portability-limit">Los archivos JSON se procesan en el navegador. Para evitar un uso excesivo de memoria, la importación de paquetes está limitada a 64 MiB.</p>
    </section>
  );
}
