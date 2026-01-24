name: Auto Bump Version

on:
  push:
    branches:
      - main        # Asegúrate de que tu rama principal se llame 'main' o 'master'
    paths-ignore:
      - 'package.json' # IMPORTANTE: Evita un bucle infinito. Si solo cambia el package.json, no se ejecuta de nuevo.

jobs:
  bump-version:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Necesario para poder hacer el 'git push' de vuelta
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run Bump Version Script
        # Ejecuta tu script actual. Asegúrate de que bump-version.js esté en la raíz.
        # Si está en una carpeta, usa: node carpeta/bump-version.js
        run: node bump-version.js

      - name: Commit and Push Changes
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add package.json
          # El mensaje del commit incluirá la nueva versión
          git commit -m "chore: release version $(node -p "require('./package.json').version")"
          git push