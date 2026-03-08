<div align="center">
  <br/>
  <img src="./public/favicon.svg" alt="Enso" width="200"/>
  <br/>
  <br/>

  <h1>Enso</h1>

  <p align="center">
    <strong>React UI and V2 API extension for SD.Next</strong>
    <br/>
    <em>Infinite canvas interface with async job queue, real-time WebSocket progress, and full model management</em>
  </p>

  <p align="center">
    <a href="#-features"><img src="https://img.shields.io/badge/Features-In_development-brightgreen?style=for-the-badge" alt="Features"/></a>
    <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick_Start-Ready-blue?style=for-the-badge" alt="Quick Start"/></a>
    <a href="#-development"><img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Development"/></a>
    <a href="https://github.com/CalamitousFelicitousness/enso/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-yellow?style=for-the-badge" alt="License"/></a>
  </p>

  <p align="center">
    <a href="https://konvajs.org/"><img src="https://img.shields.io/badge/Canvas-Konva.js-FF6B6B?style=flat-square&logo=javascript" alt="Konva.js"/></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/Framework-React_19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"/></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/></a>
    <a href="https://zustand-demo.pmnd.rs/"><img src="https://img.shields.io/badge/State-Zustand-orange?style=flat-square" alt="Zustand"/></a>
    <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/API-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI"/></a>
  </p>

  <br/>
</div>

---

## Overview

**Enso** is a React-based frontend and V2 API for [SD.Next](https://github.com/vladmandic/sdnext), packaged as an extension. It replaces the default Gradio UI with an infinite canvas workspace, an async job queue API, and real-time WebSocket progress - while keeping full compatibility with all SD.Next backends and models.

It runs as a standard SD.Next extension: drop it into `extensions-builtin/` and it registers its API routes and mounts the frontend automatically.

### What's Included

- **React frontend** - Infinite canvas, generation controls, gallery browser, model management, system dashboard
- **V2 API** (`enso_api/`) - Async job queue with SQLite persistence, file upload staging, WebSocket progress push
- **Extension entry point** (`scripts/enso.py`) - Hooks into SD.Next via `script_callbacks.on_app_started`

---

## Features

### Infinite Canvas

- **Konva.js-powered** - Smooth pan, zoom, and transform at any scale
- **Multi-frame workspace** - Place input images, masks, and results side by side
- **Smart viewport** - Efficient culling and lazy loading for large workspaces
- **Transform controls** - Resize, rotate, flip with visual handles
- **Context menus** - Right-click actions contextual to selection

### Generation

<table>
<tr>
<td width="33%" valign="top">

#### Text-to-Image

- Full parameter control
- Batch generation
- Real-time preview via WebSocket
- Model/sampler/scheduler selection
- Seed management

</td>
<td width="33%" valign="top">

#### Image-to-Image

- Drag-and-drop upload
- Denoising strength control
- Resolution matching
- Batch transformations
- Upload staging with TTL

</td>
<td width="33%" valign="top">

#### Inpainting

- Canvas-based mask painting
- Multiple fill modes
- Mask blur control
- Upload/download masks
- Undo/redo support

</td>
</tr>
</table>

### V2 API

- **Async job queue** - Submit jobs, poll status, or stream via WebSocket
- **SQLite persistence** - Jobs survive server restarts
- **File upload staging** - Upload images once, reference by ID across requests
- **Global WebSocket** - Real-time progress push, interrupt/skip commands
- **Per-job WebSocket** - Stream individual job progress and results

### Model Management

- Browse, search, and switch models
- Model metadata and analysis
- LoRA extraction and merge operations
- HuggingFace integration (token auth, model browser)
- CivitAI model search
- Loaded models inventory

### System

- Server info, memory, and GPU status
- Benchmark runner
- Update management
- Storage analysis
- Log viewer

### Gallery Browser

- Browse generated images with metadata
- Folder navigation
- Image info extraction (PNG metadata)
- Batch operations

---

## Quick Start

### As an SD.Next Extension - manual installation

It's currently a manual clone only, pending integration into SDNext

```bash
# Clone into SD.Next extensions directory
cd /path/to/sdnext/extensions-builtin
git clone https://github.com/CalamitousFelicitousness/enso.git sdnext-enso

# Build the frontend
cd sdnext-enso
npm install
npm run build

# Start SD.Next - Enso registers automatically
cd /path/to/sdnext
./webui.sh
```

The UI will be available at `http://localhost:7860/enso/`

### Development

```bash
cd /path/to/sdnext/extensions-builtin/sdnext-enso

# Install dependencies
npm install

# Start dev server (HMR, proxies API to SD.Next backend)
npm run dev
```

Dev server runs at `http://localhost:5173/enso/` with hot reload. API requests proxy to the SD.Next backend.

---

## Development

### Project Structure

```text
enso/
├── src/                      # React frontend source
│   ├── api/                  # API client, hooks, types
│   ├── canvas/               # Infinite canvas (Konva.js)
│   ├── components/           # UI components
│   ├── data/                 # Static data (parameter help, etc.)
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utility functions
│   └── stores/               # Zustand state stores
├── enso_api/                 # V2 API (Python, FastAPI)
│   ├── __init__.py           # register_api(app) entry point
│   ├── routes.py             # Job queue REST routes
│   ├── models.py             # Pydantic request/response models
│   ├── job_queue.py          # Async job queue + worker
│   ├── job_store.py          # SQLite job persistence
│   ├── executors.py          # Job dispatch to SD.Next processing
│   ├── upload.py             # File upload staging
│   ├── ws.py                 # Per-job WebSocket
│   ├── global_ws.py          # Global WebSocket (progress, interrupt)
│   ├── gallery.py            # Gallery browser endpoints
│   ├── system_ops.py         # Server, update, benchmark, storage
│   ├── models_ops.py         # Model analysis, merge, replace, LoRA
│   ├── loaded_models.py      # Loaded models inventory
│   ├── endpoints.py          # Enumerator/config endpoints
│   ├── server.py             # Server info, memory, GPU
│   ├── caption.py            # Caption endpoints
│   ├── prompt_enhance.py     # Prompt enhancement
│   ├── xyz_grid.py           # XYZ grid
│   └── misc_routes.py        # HuggingFace, extra-networks, WS ticket
├── scripts/
│   └── enso.py               # SD.Next extension entry point
├── public/                   # Static assets, PWA icons, fonts
├── index.html                # SPA entry
├── package.json
├── vite.config.ts
├── tsconfig*.json
└── eslint.config.js
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | Lint with ESLint |
| `npm run preview` | Preview production build |

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend Framework | React 19 |
| Language | TypeScript 5.9 (strict) |
| Canvas Engine | Konva.js + react-konva |
| State Management | Zustand 5 |
| Server State | TanStack Query 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Build Tool | Vite 7 |
| API Backend | FastAPI (runs inside SD.Next process) |
| Job Persistence | SQLite |
| Real-time | WebSocket |

### How It Works

Enso runs as an SD.Next extension. When SD.Next starts:

1. `scripts/enso.py` fires on the `on_app_started` callback
2. It adds the extension root to `sys.path` so `enso_api` is importable
3. `enso_api.register_api(app)` mounts all V2 routes and WebSocket endpoints on the FastAPI app
4. The built frontend (`dist/`) is mounted as static files at `/enso/`

The Python API code imports from `modules.*` (shared, devices, processing, etc.) since it runs in the same process as SD.Next. No IPC or separate server needed.

---

## Acknowledgments

- [SD.Next](https://github.com/vladmandic/sdnext) - The backend that powers everything
- [Konva.js](https://konvajs.org/) - 2D canvas framework
- [React](https://react.dev/) - UI library
- [Zustand](https://zustand-demo.pmnd.rs/) - State management
- [TanStack Query](https://tanstack.com/query) - Server state management
- [shadcn/ui](https://ui.shadcn.com/) - UI components

---

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
