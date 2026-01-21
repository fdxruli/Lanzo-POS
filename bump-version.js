// bump-version.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener rutas para ESM (EcmaScript Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.resolve(__dirname, 'package.json');

// Leer package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Separar la versión actual (ej: "1.0.5")
const versionParts = packageJson.version.split('.').map(Number);

// Incrementar el último número (Patch)
// Esto cumple tu deseo de que "incrementar" automáticamente
versionParts[2] += 1;

// Si quisieras reiniciar el patch y subir el minor cada 100 cambios, podrías agregar lógica aquí.
// Ejemplo simple: 1.0.0 -> 1.0.1

const newVersion = versionParts.join('.');
packageJson.version = newVersion;

// Guardar el archivo actualizado
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`🚀 Versión actualizada automáticamente a: v${newVersion}`);