// src/components/products/VariantInventoryView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { loadData, STORES } from '../../services/database';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';

export default function VariantInventoryView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const features = useFeatureConfig();

  useEffect(() => {
    loadInventory();
  }, []);

  const loadInventory = async () => {
    setLoading(true);
    try {
      // Cargar productos y lotes en paralelo
      const [products, batches] = await Promise.all([
        loadData(STORES.MENU),
        loadData(STORES.PRODUCT_BATCHES)
      ]);

      // Crear mapa de productos para acceso rápido por ID
      const productMap = new Map(products.map(p => [p.id, p]));

      // Aplanar la estructura: Un array donde cada fila es una variante
      const flatList = batches
        .filter(b => b.isActive) // Solo activos
        .map(batch => {
          const parent = productMap.get(batch.productId);
          if (!parent) return null;

          return {
            id: batch.id,
            productName: parent.name,
            sku: batch.sku || '---',
            talla: batch.attributes?.talla || '-',
            color: batch.attributes?.color || '-',
            stock: batch.stock,
            cost: batch.cost,
            price: batch.price,
            updatedAt: batch.createdAt
          };
        })
        .filter(Boolean); // Eliminar nulos

      // Ordenar por nombre y luego talla
      flatList.sort((a, b) => a.productName.localeCompare(b.productName));
      
      setItems(flatList);
    } catch (error) {
      console.error("Error cargando vista de variantes:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter(i => 
      i.productName.toLowerCase().includes(lower) || 
      i.sku.toLowerCase().includes(lower) ||
      i.color.toLowerCase().includes(lower)
    );
  }, [items, filter]);

  if (loading) return <div style={{padding: 20}}>Cargando inventario detallado...</div>;

  return (
    <div className="product-list-container" style={{animation: 'fadeIn 0.3s'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20}}>
        <h3 className="subtitle" style={{margin:0}}>Inventario por Talla y Color</h3>
        <button className="btn btn-secondary" onClick={loadInventory}>🔄 Actualizar</button>
      </div>

      <div className="search-container">
        <input 
          type="text" 
          className="form-input" 
          placeholder="Buscar por Nombre, SKU o Color..." 
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div style={{overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8}}>
        <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem'}}>
          <thead>
            <tr style={{backgroundColor: 'var(--light-background)', textAlign: 'left'}}>
              <th style={{padding: 10}}>Producto</th>
              <th style={{padding: 10}}>SKU</th>
              <th style={{padding: 10}}>Talla</th>
              <th style={{padding: 10}}>Color</th>
              <th style={{padding: 10, textAlign:'center'}}>Stock</th>
              <th style={{padding: 10, textAlign:'right'}}>Precio</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map(item => (
              <tr key={item.id} style={{borderBottom: '1px solid #eee'}}>
                <td style={{padding: 10, fontWeight: 600}}>{item.productName}</td>
                <td style={{padding: 10, fontFamily:'monospace', color:'#666'}}>{item.sku}</td>
                <td style={{padding: 10}}>{item.talla}</td>
                <td style={{padding: 10}}>{item.color}</td>
                <td style={{padding: 10, textAlign:'center'}}>
                  <span className={`status-badge ${item.stock < 3 ? 'error' : 'success'}`}>
                    {item.stock}
                  </span>
                </td>
                <td style={{padding: 10, textAlign:'right'}}>${item.price.toFixed(2)}</td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
                <tr>
                    <td colSpan={6} style={{padding: 30, textAlign:'center', color:'#999'}}>
                        No se encontraron variantes. Asegúrate de registrar lotes con atributos.
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}