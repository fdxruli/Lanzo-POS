// config.js
// Imports (fuera de DOMContentLoaded)
import { loadData, saveData, STORES, showMessageModal, compressImage } from './app.js'; // Ajusta según tu setup

// Exporta funciones/variables necesarias (fuera de DOMContentLoaded)
export let isAppUnlocked = false; // Exportar para uso en app.js
export { initConfig, renderCompanyData, applyTheme }; // Exportar funciones específicas

// Todo el código dentro de DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // --- Variables Globales ---
    const defaultTheme = {
        id: 'theme',
        primaryColor: '#374151',
        secondaryColor: '#3b82f6',
        backgroundColor: '#f3f4f6',
        cardBackgroundColor: '#ffffff',
        textColor: '#374151',
        cardTextColor: '#374151',
        fontSize: 'medium',
        layoutDensity: 'spacious'
    };

    // Elementos DOM
    const companyForm = document.getElementById('company-form');
    const companyNameInput = document.getElementById('company-name');
    const companyPhoneInput = document.getElementById('company-phone');
    const companyAddressInput = document.getElementById('company-address');
    const companyLogoPreview = document.getElementById('company-logo-preview');
    const companyLogoFileInput = document.getElementById('company-logo-file');
    const themeForm = document.getElementById('theme-form');
    const primaryColorInput = document.getElementById('primary-color');
    const secondaryColorInput = document.getElementById('secondary-color');
    const backgroundColorInput = document.getElementById('background-color');
    const cardBackgroundColorInput = document.getElementById('card-background-color');
    const textColorInput = document.getElementById('text-color');
    const cardTextColorInput = document.getElementById('card-text-color');
    const fontSizeSelect = document.getElementById('font-size');
    const layoutDensitySelect = document.getElementById('layout-density');
    const resetThemeBtn = document.getElementById('reset-theme-btn');
    const welcomeModal = document.getElementById('welcome-modal');
    const licenseForm = document.getElementById('license-form');
    const licenseKeyInput = document.getElementById('license-key');
    const licenseMessage = document.getElementById('license-message');
    const licenseInfoContainer = document.getElementById('license-info-container');
    const rememberDeviceCheckbox = document.getElementById('remember-device');

    // --- Funciones ---
    function getContrastColor(hexColor) {
        const r = parseInt(hexColor.slice(1, 3), 16) / 255;
        const g = parseInt(hexColor.slice(3, 5), 16) / 255;
        const b = parseInt(hexColor.slice(5, 7), 16) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    }

    function isLocalStorageEnabled() {
        try {
            const testKey = 'lanzo-test';
            const testValue = 'test-value-' + Date.now();
            localStorage.setItem(testKey, testValue);
            const value = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);
            return value === testValue;
        } catch (e) {
            console.error('LocalStorage error:', e);
            return false;
        }
    }

    function saveLicenseToCookie(licenseData) {
        const cookieValue = JSON.stringify(licenseData);
        const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        document.cookie = `lanzo_license=${encodeURIComponent(cookieValue)}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict; Secure`;
        console.log('License saved to cookie as fallback');
    }

    function getLicenseFromCookie() {
        const match = document.cookie.match(/lanzo_license=([^;]+)/);
        if (match) {
            try {
                return JSON.parse(decodeURIComponent(match[1]));
            } catch (e) {
                console.error('Error parsing license from cookie:', e);
            }
        }
        return null;
    }

    async function saveLicenseToIndexedDB(licenseData) {
        try {
            await saveData(STORES.COMPANY, {
                id: 'license_backup',
                data: licenseData,
                timestamp: new Date().toISOString()
            });
            saveLicenseToCookie(licenseData);
            console.log('License backed up to IndexedDB and cookie');
        } catch (error) {
            console.error('Error saving license to IndexedDB:', error);
        }
    }

    async function getLicenseFromIndexedDB() {
        try {
            const backup = await loadData(STORES.COMPANY, 'license_backup');
            if (backup && backup.data) {
                const now = new Date();
                const expiryDate = new Date(backup.data.expires_at);
                if (expiryDate > now) {
                    console.log('License found in IndexedDB backup');
                    return backup.data;
                }
            }
        } catch (error) {
            console.error('Error retrieving license from IndexedDB:', error);
        }
        const cookieLicense = getLicenseFromCookie();
        if (cookieLicense) {
            console.log('License restored from cookie');
            return cookieLicense;
        }
        return null;
    }

    function normalizeDate(dateString) {
        const date = new Date(dateString);
        return new Date(date.getTime() + date.getTimezoneOffset() * 60000);
    }

    function isEdgeBrowser() {
        return /Edg/.test(navigator.userAgent);
    }

    async function renewLicenseAutomatically() {
        try {
            const savedLicenseJSON = localStorage.getItem('lanzo_license');
            if (savedLicenseJSON) {
                const savedLicense = JSON.parse(savedLicenseJSON);
                const expiryDate = normalizeDate(savedLicense.expires_at);
                const now = new Date();
                const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
                if (daysUntilExpiry < 7 && daysUntilExpiry > 0) {
                    console.log('License expiring soon, attempting renewal');
                    const renewalResult = await renewLicense(savedLicense.license_key);
                    if (renewalResult.valid) {
                        localStorage.setItem('lanzo_license', JSON.stringify(renewalResult.details));
                        await saveLicenseToIndexedDB(renewalResult.details);
                        renderLicenseInfo(renewalResult.details);
                        console.log('License renewed successfully');
                    }
                }
            }
        } catch (error) {
            console.error('Error in automatic license renewal:', error);
        }
    }

    async function revalidateLicenseInBackground(savedLicense) {
        try {
            const validationResult = await Promise.race([
                window.revalidateLicense(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
            ]);
            if (validationResult.valid) {
                localStorage.setItem('lanzo_license', JSON.stringify(validationResult));
                await saveLicenseToIndexedDB(validationResult);
                renderLicenseInfo(validationResult);
            }
        } catch (error) {
            console.warn('Background revalidation failed:', error.message);
            setTimeout(() => revalidateLicenseInBackground(savedLicense), 5 * 60 * 1000);
        }
    }

    async function initializeLicense() {
        console.log('Starting license initialization...');
        const localStorageAvailable = isLocalStorageEnabled();
        console.log('LocalStorage available:', localStorageAvailable);
        if (!localStorageAvailable) {
            console.error("LocalStorage is not available.");
            if (welcomeModal) {
                welcomeModal.style.display = 'flex';
                showLicenseMessage('Error: El almacenamiento local está desactivado. La licencia no se puede guardar.', 'error');
                const submitBtn = licenseForm ? licenseForm.querySelector('button[type="submit"]') : null;
                if (submitBtn) {
                    submitBtn.disabled = true;
                }
            }
            isAppUnlocked = false;
            return { unlocked: false };
        }
        if (isEdgeBrowser()) {
            console.log('Edge browser detected, using enhanced storage');
        }
        let savedLicenseJSON = localStorage.getItem('lanzo_license');
        let savedLicense = null;
        if (savedLicenseJSON) {
            try {
                savedLicense = JSON.parse(savedLicenseJSON);
                console.log('License found in localStorage:', savedLicense);
            } catch (parseError) {
                console.error('Error parsing localStorage license:', parseError);
            }
        }
        if (!savedLicense) {
            savedLicense = await getLicenseFromIndexedDB();
            if (savedLicense) {
                localStorage.setItem('lanzo_license', JSON.stringify(savedLicense));
                console.log('License restored from IndexedDB or cookie to localStorage');
            }
        }
        if (savedLicense && savedLicense.localExpiry) {
            const localExpiryDate = normalizeDate(savedLicense.localExpiry);
            const now = new Date();
            if (localExpiryDate > now) {
                console.log('Using local expiry for valid license');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            }
        }
        if (!savedLicense) {
            console.log('No license found in any storage');
            renderLicenseInfo({ valid: false });
            isAppUnlocked = false;
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return { unlocked: false };
        }
        if (savedLicense.remembered && savedLicense.localExpiry) {
            const localExpiryDate = normalizeDate(savedLicense.localExpiry);
            const now = new Date();
            if (localExpiryDate > now) {
                console.log('Using remembered license (local expiry valid)');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            }
        }
        if (savedLicense.expires_at) {
            const expiryDate = normalizeDate(savedLicense.expires_at);
            const now = new Date();
            if (expiryDate > now) {
                console.log('License is valid, unlocking app');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            } else {
                console.log('License expired');
                localStorage.removeItem('lanzo_license');
                renderLicenseInfo({ valid: false });
                isAppUnlocked = false;
                if (welcomeModal) welcomeModal.style.display = 'flex';
                return { unlocked: false };
            }
        } else {
            console.log('Perpetual license detected');
            isAppUnlocked = true;
            if (welcomeModal) welcomeModal.style.display = 'none';
            renderLicenseInfo(savedLicense);
            return { unlocked: true };
        }
    }

    function showLicenseMessage(message, type) {
        if (!licenseMessage) return;
        licenseMessage.textContent = message;
        licenseMessage.style.display = 'block';
        licenseMessage.style.color = type === 'error' ? '#dc3545' : '#198754';
        setTimeout(() => {
            if (licenseMessage) licenseMessage.style.display = 'none';
        }, 5000);
    }

    function renderLicenseInfo(licenseData) {
        if (!licenseInfoContainer) return;
        if (!licenseData || !licenseData.valid) {
            licenseInfoContainer.innerHTML = `<p>No hay una licencia activa. <a href="#" id="show-license-modal">Ingresar licencia</a></p>`;
            const link = document.getElementById('show-license-modal');
            if (link) link.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('lanzo_license');
                if (welcomeModal) welcomeModal.style.display = 'flex';
            });
            return;
        }
        const { license_key, product_name, expires_at } = licenseData;
        const statusText = 'Activa y Verificada';
        licenseInfoContainer.innerHTML = `
            <div class="license-detail"><span>Clave:</span><span>${license_key || 'N/A'}</span></div>
            <div class="license-detail"><span>Producto:</span><span>${product_name || 'N/A'}</span></div>
            <div class="license-detail"><span>Expira:</span><span>${expires_at ? new Date(expires_at).toLocaleDateString() : 'Nunca'}</span></div>
            <div class="license-detail"><span>Estado:</span><span class="license-status-active">${statusText}</span></div>
            <div class="license-buttons" style="margin-top: 15px;">
                <button id="delete-license-btn" class="btn btn-cancel">Desactivar en este dispositivo</button>
            </div>
        `;
        const deleteLicenseBtn = document.getElementById('delete-license-btn');
        if (deleteLicenseBtn) deleteLicenseBtn.addEventListener('click', async () => {
            showMessageModal('¿Seguro que quieres desactivar la licencia en este dispositivo?', async () => {
                try {
                    const result = await window.deactivateCurrentDevice(license_key);
                    if (result.success) {
                        showMessageModal('Dispositivo desactivado. La aplicación se recargará.', () => {
                            localStorage.removeItem('lanzo_license');
                            window.location.reload();
                        });
                    } else {
                        showMessageModal(`Error: ${result.message}. ¿Eliminar licencia localmente?`, () => {
                            localStorage.removeItem('lanzo_license');
                            window.location.reload();
                        });
                    }
                } catch (error) {
                    showMessageModal(`Error: ${error.message}. ¿Eliminar licencia localmente?`, () => {
                        localStorage.removeItem('lanzo_license');
                        window.location.reload();
                    });
                }
            });
        });
    }

    async function renderCompanyData() {
        try {
            let companyData = await loadData(STORES.COMPANY, 'company');
            if (!companyData) {
                console.log('No company data found, initializing with default');
                companyData = { id: 'company', name: 'Lanzo Negocio', phone: '', address: '', logo: '' };
                await saveData(STORES.COMPANY, companyData);
            }
            if (companyNameInput) companyNameInput.value = companyData.name;
            if (companyPhoneInput) companyPhoneInput.value = companyData.phone;
            if (companyAddressInput) companyAddressInput.value = companyData.address;
            const logoSrc = companyData.logo || 'https://placehold.co/100x100/FFFFFF/4A5568?text=LN';
            if (companyLogoPreview) companyLogoPreview.src = logoSrc;
            await renderThemeSettings();
        } catch (error) {
            console.error('Error loading company data:', error.message);
            showMessageModal(`Error al cargar datos de la empresa: ${error.message}`);
        }
    }

    async function saveCompanyData(e) {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return;
        }
        e.preventDefault();
        try {
            const companyData = {
                id: 'company',
                name: companyNameInput ? companyNameInput.value.trim() : '',
                phone: companyPhoneInput ? companyPhoneInput.value.trim() : '',
                address: companyAddressInput ? companyAddressInput.value.trim() : '',
                logo: companyLogoPreview ? companyLogoPreview.src : ''
            };
            await saveData(STORES.COMPANY, companyData);
            renderCompanyData();
            showMessageModal('Datos de la empresa guardados exitosamente.');
        } catch (error) {
            console.error('Error saving company data:', error.message);
            showMessageModal(`Error al guardar datos de la empresa: ${error.message}`);
        }
    }

    function applyTheme(theme) {
        document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
        document.documentElement.style.setProperty('--secondary-color', theme.secondaryColor);
        document.documentElement.style.setProperty('--background-color', theme.backgroundColor);
        document.documentElement.style.setProperty('--card-background-color', theme.cardBackgroundColor);
        document.documentElement.style.setProperty('--text-color', theme.textColor);
        document.documentElement.style.setProperty('--card-text-color', theme.cardTextColor);
        document.body.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
        document.body.classList.add(`font-size-${theme.fontSize}`);
        document.body.classList.remove('layout-compact', 'layout-spacious');
        document.body.classList.add(`layout-${theme.layoutDensity}`);
    }

    async function renderThemeSettings() {
        try {
            let theme = await loadData(STORES.THEME, 'theme');
            if (!theme) {
                console.log('No theme data found, initializing with default');
                theme = { ...defaultTheme };
                await saveData(STORES.THEME, theme);
            }
            if (primaryColorInput) primaryColorInput.value = theme.primaryColor;
            if (secondaryColorInput) secondaryColorInput.value = theme.secondaryColor;
            if (backgroundColorInput) backgroundColorInput.value = theme.backgroundColor;
            if (cardBackgroundColorInput) cardBackgroundColorInput.value = theme.cardBackgroundColor;
            if (textColorInput) textColorInput.value = theme.textColor;
            if (cardTextColorInput) cardTextColorInput.value = theme.cardTextColor;
            if (fontSizeSelect) fontSizeSelect.value = theme.fontSize;
            if (layoutDensitySelect) layoutDensitySelect.value = theme.layoutDensity;
            applyTheme(theme);
        } catch (error) {
            console.error('Error loading theme settings:', error.message);
            showMessageModal(`Error al cargar configuración de tema: ${error.message}`);
        }
    }

    async function saveThemeSettings(e) {
        e.preventDefault();
        try {
            const themeData = {
                id: 'theme',
                primaryColor: primaryColorInput ? primaryColorInput.value : defaultTheme.primaryColor,
                secondaryColor: secondaryColorInput ? secondaryColorInput.value : defaultTheme.secondaryColor,
                backgroundColor: backgroundColorInput ? backgroundColorInput.value : defaultTheme.backgroundColor,
                cardBackgroundColor: cardBackgroundColorInput ? cardBackgroundColorInput.value : defaultTheme.cardBackgroundColor,
                textColor: textColorInput ? textColorInput.value : defaultTheme.textColor,
                cardTextColor: cardTextColorInput ? cardTextColorInput.value : defaultTheme.cardTextColor,
                fontSize: fontSizeSelect ? fontSizeSelect.value : defaultTheme.fontSize,
                layoutDensity: layoutDensitySelect ? layoutDensitySelect.value : defaultTheme.layoutDensity
            };
            await saveData(STORES.THEME, themeData);
            applyTheme(themeData);
            showMessageModal('Configuración de tema guardada.');
        } catch (error) {
            console.error('Error saving theme settings:', error.message);
            showMessageModal(`Error al guardar configuración de tema: ${error.message}`);
        }
    }

    async function resetTheme() {
        try {
            await saveData(STORES.THEME, defaultTheme);
            if (primaryColorInput) primaryColorInput.value = defaultTheme.primaryColor;
            if (secondaryColorInput) secondaryColorInput.value = defaultTheme.secondaryColor;
            if (backgroundColorInput) backgroundColorInput.value = defaultTheme.backgroundColor;
            if (cardBackgroundColorInput) cardBackgroundColorInput.value = defaultTheme.cardBackgroundColor;
            if (textColorInput) textColorInput.value = defaultTheme.textColor;
            if (cardTextColorInput) cardTextColorInput.value = defaultTheme.cardTextColor;
            if (fontSizeSelect) fontSizeSelect.value = defaultTheme.fontSize;
            if (layoutDensitySelect) layoutDensitySelect.value = defaultTheme.layoutDensity;
            applyTheme(defaultTheme);
            showMessageModal('Tema restablecido a valores predeterminados.');
        } catch (error) {
            console.error('Error resetting theme:', error.message);
            showMessageModal(`Error al restablecer tema: ${error.message}`);
        }
    }

    // --- Inicialización ---
    function initConfig() {
        // Event Listeners
        if (companyForm) companyForm.addEventListener('submit', saveCompanyData);
        if (companyLogoFileInput) companyLogoFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const compressedImage = await compressImage(file);
                if (companyLogoPreview) companyLogoPreview.src = compressedImage;
            }
        });
        if (themeForm) themeForm.addEventListener('submit', saveThemeSettings);
        if (resetThemeBtn) resetThemeBtn.addEventListener('click', resetTheme);
        if (licenseForm) licenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const licenseKey = licenseKeyInput ? licenseKeyInput.value.trim() : '';
            const rememberDevice = rememberDeviceCheckbox ? rememberDeviceCheckbox.checked : false;
            if (!licenseKey) return showLicenseMessage('Por favor ingrese una clave de licencia válida', 'error');
            try {
                const activationResult = await activateLicense(licenseKey);
                if (activationResult.valid) {
                    const licenseDataToStore = activationResult.details;
                    licenseDataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                    localStorage.setItem('lanzo_license', JSON.stringify(licenseDataToStore));
                    await saveLicenseToIndexedDB(licenseDataToStore);
                    if (rememberDevice) {
                        licenseDataToStore.remembered = true;
                        licenseDataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                    }
                    localStorage.setItem('lanzo_license', JSON.stringify(licenseDataToStore));
                    await saveLicenseToIndexedDB(licenseDataToStore);
                    isAppUnlocked = true;
                    if (welcomeModal) welcomeModal.style.display = 'none';
                    renderLicenseInfo(licenseDataToStore);
                    renderCompanyData();
                } else {
                    showLicenseMessage(activationResult.message || 'Licencia no válida o no se pudo activar.', 'error');
                }
            } catch (error) {
                showLicenseMessage(`Error al conectar con el servidor: ${error.message}`, 'error');
            }
        });

        // Iniciar renovación automática
        setInterval(renewLicenseAutomatically, 24 * 60 * 60 * 1000);

        // Inicializar licencia
        initializeLicense();
    }

    // Ejecutar inicialización
    initConfig();
});