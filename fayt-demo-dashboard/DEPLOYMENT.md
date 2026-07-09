# Fayt Demo Dashboard Deployment

This folder is the safe static dashboard unit for GitHub and Cloudflare Pages.
Do not publish the parent `D:\FAYT` trading workspace, live `.env`, databases, logs,
or broker credential files.

## GitHub

Repository:

```text
https://github.com/FaytSystems/fayt-demo.git
```

Local staging setup:

```powershell
cd C:\Users\UrsaMajor\OneDrive\Desktop\PROJECT
git clone https://github.com/FaytSystems/fayt-demo.git fayt-demo-remote
cd fayt-demo-remote
# Copy only dashboard files from D:\FAYT\fayt-demo-dashboard into .\fayt-demo-dashboard.
git branch -M main
git add .
git commit -m "Upgrade Fayt demo command deck"
git push origin main
```

## Cloudflare Pages

Create or select the `fayt-demo` Pages project and connect it to:

```text
FaytSystems/fayt-demo
```

Use these settings:

```text
Framework preset: None / Vite
Build command: npm run build
Build output directory: dist
Root directory: fayt-demo-dashboard
Node version: 20
```

Public build variables:

```text
VITE_DEMO_API_BASE=https://demo-api.faytsystems.com
VITE_DEMO_WS_BASE=wss://demo-api.faytsystems.com
```

Local preview:

```powershell
cd D:\FAYT\fayt-demo-dashboard
npm run build
npm run preview
```
