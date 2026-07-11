# Correção Render V14.2

Esta versão remove o package-lock.json que continha URLs internas inacessíveis pelo Render.
Também adiciona .npmrc apontando para o registro público do npm e ativa log detalhado no build.

No Render use:
- Build Command: npm install --no-audit --no-fund --verbose
- Start Command: npm start
- Health Check Path: /health

Antes de publicar, escolha Manual Deploy > Clear build cache & deploy.
