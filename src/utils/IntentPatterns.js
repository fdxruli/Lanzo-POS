// Specific queries only. Operational questions are resolved from the guide catalog.
export const INTENT_PATTERNS = {
  customer_debt: [/quien.*(?:debe|adeuda)/, /cuanto.*(?:deben|adeudan)/, /clientes.*(?:deud|saldo pendiente)/, /^cuentas por cobrar$/],
  profit_report: [/cuanto.*(?:gane|ganado|ganancia|utilidad)/, /cual.*(?:ganancia|utilidad)/, /(?:ganancia|utilidad).*(?:hoy|ayer|semana|mes)/],
  top_products: [/que.*(?:vende|vendido).*mas/, /productos mas vendidos/, /top.*productos/],
  sales_report: [/cuanto.*(?:vendi|vendido|factur)/, /ventas.*(?:hoy|ayer|semana|mes|ultimos)/, /(?:total|reporte|resumen).*ventas/],
  low_stock: [/(?:que|cuales).*productos.*(?:agot|bajo|poco)/, /que.*(?:agotando|acabando)/, /productos.*stock bajo/, /^stock bajo$/],
  expiration_alert: [/(?:que|cuales).*productos.*(?:caduc|vence|vencer)/, /productos.*(?:por caducar|por vencer|vencidos)/]
};
