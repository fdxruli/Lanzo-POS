import React, { useState, useEffect, useMemo } from 'react';

export default function QuickVariantEntry({ basePrice, baseCost, onVariantsChange }) {
  const [rows, setRows] = useState([
    { id: Date.now(), talla: '', color: '', sku: '', stock: '', cost: baseCost, price: basePrice }
  ]);
  const [quickColor, setQuickColor] = useState('');

  // --- ANÁLISIS EN TIEMPO REAL (DUPLICADOS Y ERRORES) ---
  // Memorizamos esto para no recalcular en cada render innecesario
  const rowAnalysis = useMemo(() => {
    const seen = new Set();
    const duplicates = new Set();
    
    rows.forEach(row => {
      // Clave compuesta normalizada para detectar duplicados
      const key = `${row.color.trim().toLowerCase()}-${row.talla.trim().toLowerCase()}`;
      if (key !== '-' && key !== '') { // Ignorar filas vacías
        if (seen.has(key)) {
          duplicates.add(key);
        } else {
          seen.add(key);
        }
      }
    });

    return { duplicates };
  }, [rows]);

  // Sincronización con el padre
  useEffect(() => {
    onVariantsChange(rows);
  }, [rows, onVariantsChange]);

  // --- LÓGICA CRUD ---
  const updateRow = (id, field, value) => {
    setRows(prev => prev.map(row => {
      if (row.id === id) return { ...row, [field]: value };
      return row;
    }));
  };

  const removeRow = (id) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const addEmptyRow = () => {
    const lastRow = rows[rows.length - 1];
    const defaultColor = lastRow ? lastRow.color : '';
    setRows(prev => [
      ...prev,
      { id: Date.now() + Math.random(), talla: '', color: defaultColor, sku: '', stock: '', cost: baseCost, price: basePrice }
    ]);
  };

  // --- GENERADORES Y HERRAMIENTAS ---
  const addSizeRun = (sizesArray) => {
    const newRows = sizesArray.map((size, index) => ({
      id: Date.now() + index + Math.random(),
      talla: size,
      color: quickColor || '', 
      sku: '',
      stock: 1, 
      cost: baseCost,
      price: basePrice
    }));

    if (rows.length === 1 && !rows[0].talla && !rows[0].color) {
      setRows(newRows);
    } else {
      setRows(prev => [...prev, ...newRows]);
    }
  };

  const generateSKU = (id, talla, color) => {
    if (!talla && !color) return;
    const c = color ? color.substring(0, 3).toUpperCase() : 'GEN';
    const t = talla ? talla.toUpperCase() : 'U';
    const rnd = Math.floor(Math.random() * 10000); // 4 dígitos para menos colisiones
    const sku = `${c}-${t}-${rnd}`.replace(/\s+/g, '');
    updateRow(id, 'sku', sku);
  };

  // Aplica el precio/costo base a TODAS las filas
  const syncColumn = (field, value) => {
    if (!window.confirm(`¿Aplicar $${value} a todas las variantes?`)) return;
    setRows(prev => prev.map(r => ({ ...r, [field]: value })));
  };

  // --- CALCULADORA DE MARGEN VISUAL ---
  const getMarginColor = (cost, price) => {
    if (!cost || !price || parseFloat(cost) === 0) return '#cbd5e1'; // Gris
    const m = ((parseFloat(price) - parseFloat(cost)) / parseFloat(cost)) * 100;
    if (m < 15) return '#ef4444'; // Rojo
    if (m < 30) return '#eab308'; // Amarillo
    return '#22c55e'; // Verde
  };

  const totalStock = rows.reduce((acc, row) => acc + (parseFloat(row.stock) || 0), 0);

  return (
    <div className="quick-variant-container" style={{ marginTop: '15px', border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#fff', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
      
      {/* HEADER & TOOLS */}
      <div style={{ padding: '15px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h4 style={{ margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            👕 Variantes y Tallas
            <span style={{ fontSize: '0.8rem', backgroundColor: '#e0e7ff', color: '#4338ca', padding: '2px 8px', borderRadius: '10px' }}>
              Total Pzas: {totalStock}
            </span>
          </h4>
        </div>

        {/* SPEED BAR */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: 'white', padding: '5px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <span style={{ fontSize: '0.9rem', color: '#64748b' }}>🎨 Color Lote:</span>
            <input 
              type="text" 
              placeholder="Ej: Negro" 
              value={quickColor}
              onChange={(e) => setQuickColor(e.target.value)}
              style={{ border: 'none', outline: 'none', width: '90px', fontWeight: 'bold', color: '#0f172a' }}
            />
          </div>
          
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Agregar Curva:</span>
          
          <div className="btn-group" style={{ display: 'flex', gap: '5px' }}>
            <button type="button" className="btn-xs" style={btnStyle} onClick={() => addSizeRun(['CH', 'M', 'G'])}>CH-M-G</button>
            <button type="button" className="btn-xs" style={btnStyle} onClick={() => addSizeRun(['CH', 'M', 'G', 'XL'])}>+ XL</button>
            <button type="button" className="btn-xs" style={btnStyle} onClick={() => addSizeRun(['23', '24', '25', '26'])}>👠 23-26</button>
            <button type="button" className="btn-xs" style={btnStyle} onClick={() => addSizeRun(['27', '28', '29', '30'])}>👞 27-30</button>
          </div>
        </div>
      </div>
      
      {/* TABLA INTELIGENTE */}
      <div style={{ overflowX: 'auto', maxHeight: '350px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th style={thStyle}>Color *</th>
              <th style={thStyle}>Talla *</th>
              <th style={thStyle}>Stock</th>
              <th style={thStyle}>
                Costo 
                <button type="button" onClick={() => syncColumn('cost', baseCost)} title="Aplicar Costo Base a todos" style={miniBtnStyle}>⬇</button>
              </th>
              <th style={thStyle}>
                Precio
                <button type="button" onClick={() => syncColumn('price', basePrice)} title="Aplicar Precio Base a todos" style={miniBtnStyle}>⬇</button>
              </th>
              <th style={thStyle}>SKU / Auto</th>
              <th style={{...thStyle, width: '30px'}}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
                // Lógica de Validación Visual por fila
                const key = `${row.color.trim().toLowerCase()}-${row.talla.trim().toLowerCase()}`;
                const isDuplicate = key !== '-' && rowAnalysis.duplicates.has(key);
                const isMissingData = !row.color || !row.talla;
                
                return (
                  <tr key={row.id} style={{ 
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isDuplicate ? '#fef3c7' : 'transparent' // Amarillo si es duplicado
                  }}>
                    {/* COLOR */}
                    <td style={{padding: '8px'}}>
                      <input 
                        type="text" 
                        className="form-input-compact" 
                        placeholder="Color"
                        value={row.color}
                        onChange={(e) => updateRow(row.id, 'color', e.target.value)}
                        style={!row.color ? { borderColor: '#fca5a5' } : {}}
                      />
                      {isDuplicate && <div style={{fontSize: '0.7rem', color: '#b45309'}}>⚠️ Duplicado</div>}
                    </td>

                    {/* TALLA */}
                    <td style={{padding: '8px'}}>
                      <input 
                        type="text" 
                        className="form-input-compact" 
                        placeholder="Talla"
                        value={row.talla}
                        onChange={(e) => updateRow(row.id, 'talla', e.target.value)}
                        style={!row.talla ? { borderColor: '#fca5a5' } : {}}
                      />
                    </td>

                    {/* STOCK */}
                    <td style={{padding: '8px'}}>
                      <input 
                        type="number" 
                        className="form-input-compact" 
                        placeholder="0"
                        value={row.stock}
                        min="0"
                        onChange={(e) => updateRow(row.id, 'stock', e.target.value)}
                        style={{ textAlign: 'center', fontWeight: 'bold', color: row.stock > 0 ? '#166534' : '#cbd5e1' }}
                      />
                    </td>

                    {/* COSTO */}
                    <td style={{padding: '8px', width: '80px'}}>
                         <input 
                            type="number" 
                            className="form-input-compact" 
                            value={row.cost}
                            onChange={(e) => updateRow(row.id, 'cost', e.target.value)}
                         />
                    </td>

                    {/* PRECIO CON INDICADOR DE MARGEN */}
                    <td style={{padding: '8px', width: '90px', position: 'relative'}}>
                        <input 
                            type="number" 
                            className="form-input-compact" 
                            value={row.price}
                            onChange={(e) => updateRow(row.id, 'price', e.target.value)}
                            style={{ fontWeight: 'bold' }}
                         />
                         <div style={{
                             position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                             width: '6px', height: '6px', borderRadius: '50%',
                             backgroundColor: getMarginColor(row.cost, row.price),
                             pointerEvents: 'none'
                         }}></div>
                    </td>

                    {/* SKU */}
                    <td style={{padding: '8px'}}>
                      <div style={{display:'flex', gap:'5px', alignItems:'center'}}>
                        <input 
                          type="text" 
                          className="form-input-compact" 
                          placeholder="Auto"
                          value={row.sku}
                          onChange={(e) => updateRow(row.id, 'sku', e.target.value)}
                          style={{ fontSize:'0.75rem', color: '#475569' }}
                        />
                         {(!row.sku && row.talla && row.color) && (
                            <button type="button" onClick={() => generateSKU(row.id, row.talla, row.color)} style={{border:'none', background:'none', cursor:'pointer', fontSize:'1rem', padding:'0'}} title="Generar SKU">⚡</button>
                        )}
                      </div>
                    </td>

                    {/* DELETE */}
                    <td style={{padding: '8px', textAlign:'center'}}>
                      <button type="button" onClick={() => removeRow(row.id)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight:'bold', fontSize: '1.2rem' }}>×</button>
                    </td>
                  </tr>
                );
            })}
          </tbody>
        </table>
      </div>

      <button 
        type="button" 
        onClick={addEmptyRow} 
        style={{ 
            width: '100%', padding: '12px', fontSize: '0.9rem', 
            background: '#f8fafc', color: '#3b82f6', border: 'none', borderTop:'1px solid #e2e8f0',
            cursor: 'pointer', fontWeight: '600', transition: 'background 0.2s'
        }}
        onMouseOver={(e) => e.target.style.background = '#f1f5f9'}
        onMouseOut={(e) => e.target.style.background = '#f8fafc'}
      >
        + Agregar Variante Manual
      </button>
    </div>
  );
}

// Estilos auxiliares
const btnStyle = {
    padding: '4px 8px', fontSize: '0.75rem', borderRadius: '4px',
    border: '1px solid #cbd5e1', backgroundColor: 'white', cursor: 'pointer', color: '#334155'
};
const miniBtnStyle = {
    marginLeft: '5px', border: 'none', background: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: '0.9rem'
};
const thStyle = {
    padding: '10px 8px', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', color: '#64748b'
};

// Inyección de estilos CSS
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  .form-input-compact {
    width: 100%; padding: 6px 8px; border: 1px solid #e2e8f0; borderRadius: 6px; fontSize: 0.9rem; transition: all 0.2s;
  }
  .form-input-compact:focus {
    border-color: #3b82f6; outline: none; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }
`;
document.head.appendChild(styleSheet);