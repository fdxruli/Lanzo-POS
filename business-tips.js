// business-tips.js - Lógica de consejos de negocio
function createBusinessTipsModule(dependencies) {
    const {
        loadData,
        showMessageModal,
        STORES
    } = dependencies;
// Función para renderizar consejos de negocio
async function renderBusinessTips() {
    const tipsList = document.getElementById('business-tips');
    const sales = await loadData(STORES.SALES);
    const menu = await loadData(STORES.MENU);
    const tips = [];
    // Si no hay ventas, mostrar mensaje de inicio
    if (sales.length === 0) {
        tips.push(`
                <li class="tip-intro">
                    <strong>🚀 ¡Hola emprendedor!</strong><br>
                    Soy tu asistente de negocios(limitado). Aún no tienes ventas registradas, 
                    pero eso está a punto de cambiar. Comienza registrando tus primeras ventas 
                    y te daré consejos personalizados que pueden incrementar tus ganancias hasta 
                    en un 30% desde la primera semana.
                </li>
            `);
        tipsList.innerHTML = tips.join('');
        return;
    }
    // Análisis de datos
    const now = new Date();
    const last30Days = sales.filter(sale => {
        const saleDate = new Date(sale.timestamp);
        return (now - saleDate) / (1000 * 60 * 60 * 24) <= 30;
    });
    const last7Days = sales.filter(sale => {
        const saleDate = new Date(sale.timestamp);
        return (now - saleDate) / (1000 * 60 * 60 * 24) <= 7;
    });
    // Análisis de productos
    const productStats = {};
    const productMargins = {};
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalItemsSold = 0;
    sales.forEach(sale => {
        totalRevenue += sale.total;
        sale.items.forEach(item => {
            const product = menu.find(p => p.id === item.id) || { cost: item.price * 0.6 };
            const itemProfit = (item.price - product.cost) * item.quantity;
            const itemRevenue = item.price * item.quantity;
            totalProfit += itemProfit;
            totalItemsSold += item.quantity;
            if (!productStats[item.id]) {
                productStats[item.id] = {
                    name: item.name,
                    quantity: 0,
                    revenue: 0,
                    profit: 0,
                    avgPrice: item.price,
                    cost: product.cost || item.price * 0.6
                };
            }
            productStats[item.id].quantity += item.quantity;
            productStats[item.id].revenue += itemRevenue;
            productStats[item.id].profit += itemProfit;
            // Calcular margen de ganancia
            const marginPercent = ((item.price - product.cost) / item.price * 100);
            productMargins[item.id] = {
                name: item.name,
                margin: marginPercent,
                price: item.price,
                cost: product.cost
            };
        });
    });
    // Análisis de patrones temporales
    const salesByHour = {};
    const salesByDay = {};
    const salesByDayOfWeek = {};
    sales.forEach(sale => {
        const date = new Date(sale.timestamp);
        const hour = date.getHours();
        const dayOfWeek = date.toLocaleDateString('es-ES', { weekday: 'long' });
        const dayKey = date.toLocaleDateString();
        salesByHour[hour] = (salesByHour[hour] || 0) + sale.total;
        salesByDay[dayKey] = (salesByDay[dayKey] || 0) + sale.total;
        salesByDayOfWeek[dayOfWeek] = (salesByDayOfWeek[dayOfWeek] || 0) + sale.total;
    });
    // Productos ordenados por diferentes métricas
    const topSellingProducts = Object.values(productStats).sort((a, b) => b.quantity - a.quantity);
    const topRevenueProducts = Object.values(productStats).sort((a, b) => b.revenue - a.revenue);
    const topProfitProducts = Object.values(productStats).sort((a, b) => b.profit - a.profit);
    const topMarginProducts = Object.values(productMargins).sort((a, b) => b.margin - a.margin);
    // Horas más productivas
    const bestHours = Object.entries(salesByHour)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    // Días más productivos
    const bestDays = Object.entries(salesByDayOfWeek)
        .sort((a, b) => b[1] - a[1]);
    // CONSEJOS PERSONALIZADOS CON ENFOQUE DE IA
    // 1. SALUDO PERSONALIZADO CON DATOS CLAVE
    const avgSaleValue = totalRevenue / sales.length;
    const profitMargin = (totalProfit / totalRevenue * 100);
    const daysInBusiness = Math.max(1, Math.ceil((new Date() - new Date(sales[0].timestamp)) / (1000 * 60 * 60 * 24)));
    const dailyAvgRevenue = totalRevenue / daysInBusiness;
    tips.push(`
            <li class="tip-intro">
                <strong>🤖 HOLA, SOY TU ASESOR DE NEGOCIOS(LIMITADO)</strong><br>
                He analizado tus ${sales.length} ventas de los últimos ${daysInBusiness} días y detecté 
                <span class="highlight">$${totalRevenue.toFixed(2)} en ingresos</span> con un 
                <span class="highlight">${profitMargin.toFixed(1)}% de margen neto</span>. 
                Tu ticket promedio es de <span class="highlight">$${avgSaleValue.toFixed(2)}</span>.<br><br>
                
                <strong>ESTOS SON MIS 5 CONSEJOS ESTRATÉGICOS PARA TI:</strong>
            </li>
        `);
    // 2. PRODUCTO ESTRELLA CON RECOMENDACIÓN ESPECÍFICA
    if (topProfitProducts.length > 0) {
        const starProduct = topProfitProducts[0];
        const revenuePercent = (starProduct.revenue / totalRevenue * 100).toFixed(1);
        const validPrice = !isNaN(starProduct.price) && starProduct.price > 0;
        const potentialUpsell = validPrice ? (starProduct.price * 1.15).toFixed(2) : 'N/A';
        tips.push(`
            <li class="tip-star-product">
                <strong>🎯 ESTRATEGIA #1: CAPITALIZA TU PRODUCTO ESTRELLA</strong><br>
                "<span class="highlight">${starProduct.name}</span>" genera el ${revenuePercent}% de tus ganancias ($${starProduct.profit.toFixed(2)}).<br>
                <strong>ACCIÓN INMEDIATA:</strong> 
                <ul>
                    <li>${validPrice ? `Crea una versión premium a $${potentialUpsell} (añadiendo un ingrediente especial)` : 'Revisa el precio del producto para crear una versión premium'}</li>
                    <li>Entrena a tu equipo para sugerirlo sistemáticamente</li>
                    <li>Colócalo como primer elemento en tu menú/mostrador</li>
                </ul>
                <em>Impacto estimado: +${(starProduct.profit * 0.3).toFixed(2)} en ganancias semanales</em>
            </li>
        `);
    }
    // 3. ANÁLISIS DE MARGENES CON RECOMENDACIONES PRECISAS
    const lowMarginProducts = Object.values(productMargins)
        .filter(p => p.margin < 35)
        .sort((a, b) => a.margin - b.margin);
    if (lowMarginProducts.length > 0) {
        const worstMargin = lowMarginProducts[0];
        const recommendedPrice = (worstMargin.cost * 1.7).toFixed(2);
        const potentialIncrease = (recommendedPrice - worstMargin.price).toFixed(2);
        tips.push(`
                <li class="tip-warning">
                    <strong>⚠️ ESTRATEGIA #2: CORRIGE MARGENES PELIGROSOS</strong><br>
                    "<span class="highlight">${worstMargin.name}</span>" tiene solo ${worstMargin.margin.toFixed(1)}% de margen 
                    (precio: $${worstMargin.price}, costo: $${worstMargin.cost.toFixed(2)}).<br>
                    <strong>ACCIÓN INMEDIATA:</strong> 
                    <ul>
                        <li>Aumenta el precio a $${recommendedPrice} (+$${potentialIncrease})</li>
                        <li>Si no puedes subir el precio, reduce porciones en un 15%</li>
                        <li>Busca proveedores alternativos para bajar costos</li>
                    </ul>
                    <em>Impacto estimado: +${((worstMargin.price * 0.3) * (productStats[worstMargin.name]?.quantity || 1)).toFixed(2)} por semana</em>
                </li>
            `);
    }
    // 4. OPTIMIZACIÓN DE HORARIOS BASADA EN DATOS
    if (bestHours.length > 0) {
        const peakHour = bestHours[0][0];
        const peakRevenue = bestHours[0][1];
        const hourlyAvg = totalRevenue / Object.keys(salesByHour).length;
        const slowestHour = Object.entries(salesByHour)
            .sort((a, b) => a[1] - b[1])[0][0];
        if (peakRevenue > hourlyAvg * 1.5) {
            tips.push(`
                    <li class="tip-timing">
                        <strong>⏰ ESTRATEGIA #3: OPTIMIZA TUS HORARIOS INTELIGENTEMENTE</strong><br>
                        Entre las <span class="highlight">${peakHour}:00-${parseInt(peakHour) + 1}:00</span> generas 
                        $${peakRevenue.toFixed(2)} (${((peakRevenue / totalRevenue) * 100).toFixed(1)}% de tus ventas).<br>
                        <strong>ACCIÓN INMEDIATA:</strong> 
                        <ul>
                            <li>Programa promociones exclusivas para esta franja horaria</li>
                            <li>Asegura el doble de inventario preparado</li>
                            <li>Ofrece servicio express con 15% de recargo</li>
                            <li>Reduce personal en la hora más lenta (${slowestHour}:00)</li>
                        </ul>
                        <em>Impacto estimado: +${(peakRevenue * 0.25).toFixed(2)} semanales</em>
                    </li>
                `);
        }
    }
    // 5. ESTRATEGIA DE UPSELL Y COMBOS
    const avgTicketTarget = avgSaleValue * 1.3;
    // Verificar que tengamos al menos 2 productos para hacer combos
    let comboExamples = "Producto + Complemento";
    let comboPrice = avgSaleValue.toFixed(2);
    if (topSellingProducts.length >= 2) {
        comboExamples = topSellingProducts.slice(0, 2).map(p => p.name).join(" + ");
        comboPrice = (topSellingProducts[0].avgPrice + (topSellingProducts[1].avgPrice || topSellingProducts[0].avgPrice) * 0.7).toFixed(2);
    } else if (topSellingProducts.length === 1) {
        comboExamples = topSellingProducts[0].name + " + Bebida/Postre";
        comboPrice = (topSellingProducts[0].avgPrice * 1.5).toFixed(2);
    }
    tips.push(`
        <li class="tip-upsell">
            <strong>📈 ESTRATEGIA #4: IMPLEMENTA VENTAS CRUZADAS ESTRATÉGICAS</strong><br>
            Tu ticket promedio actual es $${avgSaleValue.toFixed(2)}. Puedes llevarlo a $${avgTicketTarget.toFixed(2)}.<br>
            <strong>ACCIÓN INMEDIATA:</strong> 
            <ul>
                <li>Crea el combo "${comboExamples}" por $${comboPrice} (ahorro de 15%)</li>
                <li>Entrena equipo en la técnica "¿Desea agregar...?"</li>
                <li>Implementa menú digital con sugerencias automáticas</li>
                <li>Ofrece postre/bebida con 20% de descuento al comprar plato principal</li>
            </ul>
            <em>Impacto estimado: +${(avgTicketTarget - avgSaleValue).toFixed(2)} por transacción</em>
        </li>
    `);
    // 6. TENDENCIAS Y PROYECCIONES
    if (last30Days.length > 0 && last7Days.length > 0) {
        const last30Revenue = last30Days.reduce((sum, sale) => sum + sale.total, 0);
        const last7Revenue = last7Days.reduce((sum, sale) => sum + sale.total, 0);
        const weeklyRate = last7Revenue / 7;
        const monthlyRate = last30Revenue / 30;
        const growthRate = ((weeklyRate - monthlyRate) / monthlyRate * 100).toFixed(1);
        if (weeklyRate > monthlyRate * 1.15) {
            tips.push(`
                    <li class="tip-growth">
                        <strong>🚀 ESTRATEGIA #5: CAPITALIZA TU CRECIMIENTO ACELERADO</strong><br>
                        ¡Estás creciendo a un ritmo del ${growthRate}% semanal!<br>
                        <strong>ACCIÓN INMEDIATA:</strong> 
                        <ul>
                            <li>Incrementa inventario en un 25% para evitar desabastecimiento</li>
                            <li>Contrata personal adicional para las horas pico</li>
                            <li>Invierte en publicidad local dirigida (Facebook)</li>
                            <li>Considera expandir horario de atención</li>
                        </ul>
                        <em>Oportunidad: Puedes duplicar tus ingresos en ${(70 / growthRate).toFixed(1)} semanas</em>
                    </li>
                `);
        } else if (weeklyRate < monthlyRate * 0.85) {
            tips.push(`
                    <li class="tip-decline">
                        <strong>📉 ESTRATEGIA #5: REACCIÓN ANÁLITICA ANTE CAÍDA DE VENTAS</strong><br>
                        Tus ventas han caído ${Math.abs(growthRate)}% esta semana.<br>
                        <strong>ACCIÓN INMEDIATA:</strong> 
                        <ul>
                            <li>Contacta a 10 clientes anteriores para conocer causas</li>
                            <li>Lanza promoción flash de 48 horas con 25% de descuento</li>
                            <li>Revisa precios de 3 competidores directos</li>
                        </ul>
                        <em>Urgencia: Cada día de caída te cuesta $${(monthlyRate - weeklyRate).toFixed(2)}</em>
                    </li>
                `);
        }
    }
    // 7. PROYECCIÓN FINANCIERA
    const projectedMonthly = 8364; // Salario mínimo mensual
    const optimizedProjection = projectedMonthly * 1.2; // 20% de mejora con las estrategias
    tips.push(`
            <li class="tip-motivation">
                <strong>🎯 VISIÓN ESTRATÉGICA: TU PRÓXIMO MES</strong><br>
                Tu meta es alcanzar un ingreso mensual de <span class="highlight">$${projectedMonthly.toFixed(2)}</span>, equivalente al salario mínimo mensual. 
                Aplicando estas 5 estrategias, puedes alcanzar 
                <span class="highlight">$${optimizedProjection.toFixed(2)}</span> el próximo mes.<br><br>
                
                <strong>TU PLAN DE ACCIÓN PRIORITARIO:</strong>
                <ol>
                    <li>Revisar márgenes y ajustar precios hoy mismo</li>
                    <li>Crear 2 combos estratégicos antes de mañana</li>
                    <li>Optimizar horarios de personal esta semana</li>
                    <li>Implementar técnicas de upsell con el equipo</li>
                    <li>Programar evaluación para dentro de 7 días</li>
                </ol>
                
                <em>Recuerda: Yo reanalizaré tus datos cada vez que ingreses para darte consejos actualizados. 
                ¡Tu éxito está en la ejecución consistente! si te preguntas por que 8364... me baso en el salario minimo mensual de tu region(chiapas)</em>
            </li>
        `);
    // Agregar estilos CSS para las clases de tips
    if (!document.getElementById('business-tips-styles')) {
        const style = document.createElement('style');
        style.id = 'business-tips-styles';
        style.textContent = `
                .tip-intro { 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                    color: white; 
                    padding: 20px; 
                    border-radius: 10px; 
                    margin-bottom: 15px; 
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-star-product { 
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
                    color: white; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-warning { 
                    background: linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%); 
                    color: #2d3748; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px; 
                    border-left: 5px solid #e53e3e;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-timing { 
                    background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); 
                    color: #2d3748; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-upsell { 
                    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); 
                    color: white; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-growth { 
                    background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); 
                    color: #2d3748; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-decline { 
                    background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); 
                    color: #2d3748; 
                    padding: 18px; 
                    border-radius: 10px; 
                    margin-bottom: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .tip-motivation { 
                    background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); 
                    color: #2d3748; 
                    padding: 20px; 
                    border-radius: 10px; 
                    margin-bottom: 12px; 
                    border: 2px solid #f6ad55;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                #business-tips li { 
                    list-style: none; 
                    margin-bottom: 15px; 
                    transition: transform 0.3s ease;
                }
                #business-tips li:hover {
                    transform: translateY(-2px);
                }
                #business-tips strong { 
                    display: block; 
                    margin-bottom: 8px; 
                    font-size: 1.1em;
                }
                #business-tips .highlight {
                    background: rgba(255,255,255,0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: bold;
                }
                #business-tips ul, #business-tips ol {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                #business-tips li ul li, #business-tips li ol li {
                    margin-bottom: 5px;
                }
                #business-tips em {
                    display: block;
                    margin-top: 10px;
                    font-style: italic;
                    font-size: 0.9em;
                    opacity: 0.9;
                }
            `;
        document.head.appendChild(style);
    }
    tipsList.innerHTML = tips.join('');
}
    return {
        renderBusinessTips
    };
}

export { createBusinessTipsModule };