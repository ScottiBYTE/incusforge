<p align="center">
  <h1 align="center">ScottiBYTE Incus Forge</h1>
  <p align="center">
    Build • Publish • Distribute Incus Custom Images
  </p>
</p>

---

<p align="center">
  <img src="docs/screenshots/main-dashboard.png" width="1200">
</p>

---

# 🚀 Overview

ScottiBYTE Incus Forge is a lightweight Home Lab focused web application for publishing, managing, and distributing custom Incus images through SimpleStreams repositories.

Incus Forge allows Home Labbers and administrators to:

- Publish running Incus containers as reusable images
- Publish snapshots directly from the UI
- Push images into SimpleStreams repositories
- Manage local Incus images
- Maintain centralized image repositories
- Distribute reusable Incus images across multiple environments

The platform is intentionally designed to remain:

- Lightweight
- Docker deployable
- Home Lab friendly
- Native Incus focused
- Understandable
- Minimal dependency
- Database free

---

# ✨ Features

## Image Publishing

- Publish running containers
- Publish snapshots
- Snapshot expansion rows
- Custom image aliases

## Repository Management

- Push images to SimpleStreams repositories
- Delete repository images
- Refresh repository metadata
- Repository health validation
- Repository bootstrap support

## Dashboard Features

- Live statistics cards
- Container and VM badges
- Responsive layout
- Async publishing operations
- Lightweight interface design

## Docker Support

- Full Docker deployment
- Portable configuration
- Native Incus client integration
- SSH based repository synchronization

---

# 🏗 Recommended Architecture

<p align="center">
  <img src="docs/screenshots/architecture-diagram.png" width="1000">
</p>

Recommended deployment model:

| System | Purpose |
|---|---|
| IncusForge | Web UI and image management |
| IncusSimplestreams | SimpleStreams repository |
| Existing Incus Hosts | Source containers and VMs |

---

# 📦 Recommended Deployment Model

Separate containers are strongly recommended.

| Container | Purpose |
|---|---|
| IncusForge | Runs web application |
| IncusSimplestreams | Hosts image repository |
| Production Incus Hosts | Existing infrastructure |

Benefits:

- Cleaner separation
- Easier upgrades
- Improved security
- Easier troubleshooting
- Better disaster recovery
- Simpler scaling

---

# 🚀 Quick Start

## Create IncusForge Container

```bash
incus launch images:ubuntu/26.04 IncusForge
