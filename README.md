# Public Domain Media Search

A minimal, modern React app for searching public domain and Creative Commons Zero (CC0) / open-licensed images and media across multiple public archives.

## Supported Sources

- **Wikimedia Commons**: High-res images and video files with CC0 / Public Domain filtering.
- **Openverse**: Open-access image index filtered for CC0 and Public Domain Mark (PDM).
- **NASA Images API**: NASA's official public image and video archive.
- **Library of Congress**: Historical photo archive (requires a working direct connection; see notes in `src/sources.js`).

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

This is a static Vite + React app — just import the repo into [Vercel](https://vercel.com/new) and deploy with the defaults (framework preset: Vite). No environment variables or backend required.

## License

MIT / Open Source
