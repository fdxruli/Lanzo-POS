import React, { useState, useEffect, useMemo } from 'react';
import './QuickVariantEntry.css';

export default function QuickVariantEntry({ basePrice, baseCost, onVariantsChange, initialData = [] }) {
  const [rows, setRows] = useState(() => {
    if (initialData && initialData.length > 0) {
      return initialData;
    }
    return [{ id: Date.now(), talla: '', color: '', sku: '', stock: '', cost: baseCost, price: basePrice }];
  });

  const [quickColor, setQuickColor] = useState('');

  // RASTREO DE LOTES ACTIVOS: { 'key-del-boton': [id1, id2, id3] }
  const [activeBatches, setActiveBatches] = useState({});

  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    if (initialData && initialData.length > 0) {
      setRows(initialData);
    }
  }, [initialData]);

  // --- ANÁLISIS EN TIEMPO REAL (DUPLICADOS) ---
  const rowAnalysis = useMemo(() => {
    const seen = new Set();
    const duplicates = new Set();

    rows.forEach(row => {
      const key = `${row.color ? row.color.trim().toLowerCase() : ''}-${row.talla ? row.talla.trim().toLowerCase() : ''}`;
      if (key !== '-' && key !== '' && row.talla && row.color) {
        if (seen.has(key)) {
          duplicates.add(key);
        } else {
          seen.add(key);
        }
      }
    });

    return { duplicates };
  }, [rows]);

  // Sincronización
  useEffect(() => {
    onVariantsChange(rows);
  }, [rows, onVariantsChange]);

  // --- CRUD ---
  const updateRow = (id, field, value) => {
    setRows(prev => prev.map(row => {
      if (row.id === id) return { ...row, [field]: value };
      return row;
    }));
  };

  const removeRow = (id) => {
    setRows(prev => {
      const newRows = prev.filter(r => r.id !== id);
      // Si borramos todo manual, dejamos una fila vacía para no romper la UI
      if (newRows.length === 0) {
        return [{ id: Date.now(), talla: '', color: '', sku: '', stock: '', cost: baseCost, price: basePrice }];
      }
      return newRows;
    });
  };

  const addEmptyRow = () => {
    const lastRow = rows[rows.length - 1];
    const defaultColor = lastRow ? lastRow.color : '';
    setRows(prev => [
      ...prev,
      { id: Date.now() + Math.random(), talla: '', color: defaultColor, sku: '', stock: '', cost: baseCost, price: basePrice }
    ]);
  };

  // --- LOGICA TOGGLE (MARCAR/DESMARCAR) ---
  const toggleSizeRun = (batchKey, sizesArray) => {
    // Si ya está activo, lo quitamos (UNDO)
    if (activeBatches[batchKey]) {
      const idsToRemove = activeBatches[batchKey];

      setRows(prev => {
        const remaining = prev.filter(row => !idsToRemove.includes(row.id));
        // Si nos quedamos sin filas, restaurar la fila vacía inicial
        if (remaining.length === 0) {
          return [{ id: Date.now(), talla: '', color: '', sku: '', stock: '', cost: baseCost, price: basePrice }];
        }
        return remaining;
      });

      // Quitamos del estado de activos
      setActiveBatches(prev => {
        const next = { ...prev };
        delete next[batchKey];
        return next;
      });

    } else {
      // Si no está activo, lo agregamos
      const newRows = sizesArray.map((size, index) => ({
        id: Date.now() + index + Math.random(),
        talla: size,
        color: quickColor || '',
        sku: '',
        stock: 1,
        cost: baseCost,
        price: basePrice
      }));

      const newIds = newRows.map(r => r.id);

      setRows(prev => {
        // Si solo hay una fila vacía (estado inicial), la reemplazamos
        if (prev.length === 1 && !prev[0].talla && !prev[0].color) {
          return newRows;
        }
        return [...prev, ...newRows];
      });

      // Marcamos como activo guardando los IDs generados
      setActiveBatches(prev => ({ ...prev, [batchKey]: newIds }));
    }
  };

  const generateSKU = (id, talla, color) => {
    if (!talla && !color) return;
    const c = color ? color.substring(0, 3).toUpperCase() : 'GEN';
    const t = talla ? talla.toUpperCase() : 'U';
    const rnd = Date.now().toString().slice(-6);
    const sku = `${c}-${t}-${rnd}`.toUpperCase().replace(/\s+/g, '');
    updateRow(id, 'sku', sku);
  };

  const syncColumn = (field, value) => {
    if (!window.confirm(`¿Aplicar $${value} a todas las variantes?`)) return;
    setRows(prev => prev.map(r => ({ ...r, [field]: value })));
  };

  // --- CALCULADORA DE MARGEN VISUAL ---
  const getMarginColor = (cost, price) => {
    if (!cost || !price || parseFloat(cost) === 0) return 'var(--text-light)';
    const m = ((parseFloat(price) - parseFloat(cost)) / parseFloat(cost)) * 100;
    if (m < 15) return 'var(--error-color)';
    if (m < 30) return 'var(--warning-color)';
    return 'var(--success-color)';
  };

  const totalStock = rows.reduce((acc, row) => acc + (parseFloat(row.stock) || 0), 0);

  // Helper para estilo de botón activo
  const getBtnStyle = (key) => activeBatches[key]
    ? { backgroundColor: '#2c3e50', color: 'white', borderColor: '#2c3e50' } // Estilo "Activo"
    : {};

  return (
    <div className="quick-variant-container">

      {/* HEADER & TOOLS */}
      <div className="qv-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h4 className="qv-title">
            👕 Variantes y Tallas
            <span className="qv-badge">
              Total Pzas: {totalStock}
            </span>
          </h4>
        </div>

        {/* TOOLBAR */}
        <div className="qv-toolbar" style={{ flexWrap: 'wrap', gap: '15px', alignItems: 'flex-start' }}>

          {/* SECCIÓN 1: CONFIGURACIÓN BÁSICA (Color) */}
          <div className="qv-input-group" style={{ minWidth: '150px' }}>
            <span className="qv-label">🎨 Color Lote:</span>
            <input
              type="text"
              className="qv-color-input"
              placeholder="Ej: Negro"
              value={quickColor}
              onChange={(e) => setQuickColor(e.target.value)}
            />
          </div>

          {/* SECCIÓN 2: BOTONERAS DE TALLAS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            <div className="btn-group">
              <small style={{ width: '100%', color: 'var(--text-light)', fontSize: '0.7rem', fontWeight: 'bold' }}>Camisas/Blusas:</small>
              <button type="button" className="btn-xs" style={getBtnStyle('top-xs')} onClick={() => toggleSizeRun('top-xs', ['XS', 'S', 'M', 'L'])}>XS - L</button>
              <button type="button" className="btn-xs" style={getBtnStyle('top-s')} onClick={() => toggleSizeRun('top-s', ['S', 'M', 'L', 'XL'])}>S - XL</button>
              <button type="button" className="btn-xs" style={getBtnStyle('top-m')} onClick={() => toggleSizeRun('top-m', ['M', 'L', 'XL', '2XL'])}>M - 2XL</button>
              <button type="button" className="btn-xs" style={getBtnStyle('top-plus')} onClick={() => toggleSizeRun('top-plus', ['XL', '2XL', '3XL', '4XL'])}>Plus</button>
            </div>

            <button
              type="button"
              className="btn-toggle-categories"
              onClick={() => setShowAllCategories(!showAllCategories)}
            >
              {showAllCategories ? '▲ Ocultar otras categorías' : '▼ Ver Pantalones, Niños y Calzado'}
            </button>

            {/* ÁREA COLAPSABLE */}
            {showAllCategories && (
              <div className="qv-collapsible-area">
                {/* BOTTOMS / JEANS HOMBRE */}
                <div className="btn-group">
                  <small style={{ width: '100%', color: 'var(--text-light)', fontSize: '0.7rem', fontWeight: 'bold' }}>Hombre:</small>
                  <button type="button" className="btn-xs" style={getBtnStyle('man-28')} onClick={() => toggleSizeRun('man-28', ['28', '30', '32', '34'])}>28-34</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('man-30')} onClick={() => toggleSizeRun('man-30', ['30', '32', '34', '36', '38'])}>30-38</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('man-32')} onClick={() => toggleSizeRun('man-32', ['32', '34', '36', '38', '40'])}>32-40</button>
                </div>

                {/* BOTTOMS / JEANS DAMA */}
                <div className="btn-group">
                  <small style={{ width: '100%', color: 'var(--text-light)', fontSize: '0.7rem', fontWeight: 'bold' }}>Dama:</small>
                  <button type="button" className="btn-xs" style={getBtnStyle('lady-3')} onClick={() => toggleSizeRun('lady-3', ['3', '5', '7', '9', '11'])}>3-11</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('lady-5')} onClick={() => toggleSizeRun('lady-5', ['5', '7', '9', '11', '13'])}>5-13</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('lady-7')} onClick={() => toggleSizeRun('lady-7', ['7', '9', '11', '13', '15'])}>7-15</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('uni')} onClick={() => toggleSizeRun('uni', ['UNITALLA'])}>Unitalla</button>
                </div>

                {/* NIÑOS */}
                <div className="btn-group">
                  <small style={{ width: '100%', color: 'var(--text-light)', fontSize: '0.7rem', fontWeight: 'bold' }}>Niños:</small>
                  <button type="button" className="btn-xs" style={getBtnStyle('kids-baby')} onClick={() => toggleSizeRun('kids-baby', ['3M', '6M', '9M', '12M', '18M', '24M'])}>Bebés</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('kids-todd')} onClick={() => toggleSizeRun('kids-todd', ['2', '4', '6', '8', '10'])}>2-10 Años</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('kids-teen')} onClick={() => toggleSizeRun('kids-teen', ['10', '12', '14', '16'])}>Junior</button>
                </div>

                {/* CALZADO */}
                <div className="btn-group">
                  <small style={{ width: '100%', color: 'var(--text-light)', fontSize: '0.7rem', fontWeight: 'bold' }}>Calzado:</small>
                  <button type="button" className="btn-xs" style={getBtnStyle('shoe-w')} onClick={() => toggleSizeRun('shoe-w', ['22', '23', '24', '25', '26'])}>👠 22-26</button>
                  <button type="button" className="btn-xs" style={getBtnStyle('shoe-m')} onClick={() => toggleSizeRun('shoe-m', ['25', '26', '27', '28', '29'])}>👞 25-29</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TABLA SCROLLEABLE */}
      <div className="qv-table-wrapper">
        <table className="qv-table">
          <thead>
            <tr>
              <th>Color *</th>
              <th>Talla *</th>
              <th style={{ width: '80px' }}>Stock</th>
              <th style={{ minWidth: '100px' }}>
                Costo
                <button type="button" className="btn-icon sync" onClick={() => syncColumn('cost', baseCost)} title="Aplicar Costo Base a todos">⬇</button>
              </th>
              <th style={{ minWidth: '100px' }}>
                Precio
                <button type="button" className="btn-icon sync" onClick={() => syncColumn('price', basePrice)} title="Aplicar Precio Base a todos">⬇</button>
              </th>
              <th>SKU / Auto</th>
              <th style={{ width: '40px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.color ? row.color.trim().toLowerCase() : ''}-${row.talla ? row.talla.trim().toLowerCase() : ''}`;
              const isDuplicate = key !== '-' && rowAnalysis.duplicates.has(key);

              return (
                <tr key={row.id} className={isDuplicate ? 'qv-row-duplicate' : ''}>
                  {/* COLOR */}
                  <td className="qv-cell">
                    <input
                      type="text"
                      className="form-input-compact"
                      placeholder="Color"
                      value={row.color}
                      onChange={(e) => updateRow(row.id, 'color', e.target.value)}
                      style={!row.color ? { borderColor: 'var(--error-color)' } : {}}
                    />
                    {isDuplicate && <div style={{ fontSize: '0.7rem', color: 'var(--warning-color)', marginTop: '2px' }}>⚠️ Duplicado</div>}
                  </td>

                  {/* TALLA */}
                  <td className="qv-cell">
                    <input
                      type="text"
                      className="form-input-compact"
                      placeholder="Talla"
                      value={row.talla}
                      onChange={(e) => updateRow(row.id, 'talla', e.target.value)}
                      style={!row.talla ? { borderColor: 'var(--error-color)' } : {}}
                    />
                  </td>

                  {/* STOCK */}
                  <td className="qv-cell">
                    <input
                      type="number"
                      className="form-input-compact"
                      placeholder="0"
                      value={row.stock}
                      min="0"
                      onChange={(e) => updateRow(row.id, 'stock', e.target.value)}
                      style={{ textAlign: 'center', fontWeight: 'bold', color: row.stock > 0 ? 'var(--success-color)' : 'var(--text-light)' }}
                    />
                  </td>

                  {/* COSTO */}
                  <td className="qv-cell">
                    <input
                      type="number"
                      className="form-input-compact"
                      value={row.cost}
                      onChange={(e) => updateRow(row.id, 'cost', e.target.value)}
                    />
                  </td>

                  {/* PRECIO CON INDICADOR DE MARGEN */}
                  <td className="qv-cell" style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="form-input-compact"
                      value={row.price}
                      onChange={(e) => updateRow(row.id, 'price', e.target.value)}
                      style={{ fontWeight: 'bold' }}
                    />
                    <div style={{
                      position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                      width: '8px', height: '8px', borderRadius: '50%',
                      backgroundColor: getMarginColor(row.cost, row.price),
                      boxShadow: '0 0 0 2px var(--card-background-color)',
                      pointerEvents: 'none'
                    }}></div>
                  </td>

                  {/* SKU */}
                  <td className="qv-cell">
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="form-input-compact"
                        placeholder="Auto"
                        value={row.sku}
                        onChange={(e) => updateRow(row.id, 'sku', e.target.value)}
                        style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}
                      />
                      {(!row.sku && row.talla && row.color) && (
                        <button type="button" className="btn-icon gen" onClick={() => generateSKU(row.id, row.talla, row.color)} title="Generar SKU">⚡</button>
                      )}
                    </div>
                  </td>

                  {/* DELETE */}
                  <td className="qv-cell" style={{ textAlign: 'center' }}>
                    <button type="button" className="btn-icon delete" onClick={() => removeRow(row.id)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="btn-add-row"
        onClick={addEmptyRow}
      >
        + Agregar Variante Manual
      </button>
    </div>
  );
}