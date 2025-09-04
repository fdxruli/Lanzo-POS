document.addEventListener('DOMContentLoaded', () => {
    const productCostInput = document.getElementById('product-cost');
    const productPriceInput = document.getElementById('product-price');
    const profitMarginMessage = document.getElementById('unit-profit-margin-message');

    function updateProfitMargin() {
        const cost = parseFloat(productCostInput.value);
        const price = parseFloat(productPriceInput.value);

        if (cost > 0 && price >= cost) {
            const profitMargin = ((price - cost) / cost) * 100;
            profitMarginMessage.textContent = `Margen de ganancia: ${profitMargin.toFixed(2)}%`;
            profitMarginMessage.style.display = 'block';
        } else {
            profitMarginMessage.style.display = 'none';
        }
    }

    productCostInput.addEventListener('input', updateProfitMargin);
    productPriceInput.addEventListener('input', updateProfitMargin);
});
