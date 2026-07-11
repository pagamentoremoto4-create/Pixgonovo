# Correção do npm no Render

O package-lock.json anterior continha URLs internas inacessíveis pelo Render.
Ele foi removido desta versão.

No Render use:

Build Command:
npm install --no-audit --no-fund

Start Command:
npm start

Depois execute Manual Deploy > Clear build cache & deploy.

Após o primeiro npm install local ou no GitHub Actions, um novo package-lock.json pode ser gerado usando o registro público do npm.
