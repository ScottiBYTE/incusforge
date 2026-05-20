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
```

---

# 🔐 Configure Incus Trust Relationships

From the IncusForge container:

```bash
incus remote add vmsstorm https://vmsstorm:8443
```

Accept the certificate.

Enter trust password or token.

Verify:

```bash
incus remote list
```

Example:

```text
+-------------------+------------------------------------+
| NAME              | URL                                |
+-------------------+------------------------------------+
| vmsstorm          | https://vmsstorm:8443             |
| scottibyte-images | https://images.scottibyte.com     |
+-------------------+------------------------------------+
```

---

# 🔑 Configure SSH Access

Incus Forge synchronizes images to the SimpleStreams repository using SSH and rsync.

Generate SSH key if needed:

```bash
ssh-keygen -t ed25519
```

Copy key to repository server:

```bash
ssh-copy-id scott@192.168.80.88
```

Verify access:

```bash
ssh scott@192.168.80.88
```

Expected:

```text
IncusSimplestreams
scott
```

---

# 🐳 Docker Deployment

## Project Structure

```text
incusforge/
├── config.json
├── docker-compose.yml
├── Dockerfile
├── index.html
├── package.json
├── package-lock.json
├── server.js
├── public/
├── scripts/
└── docs/
    └── screenshots/
```

---

## Dockerfile

```dockerfile
FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    nodejs \
    npm \
    incus-client \
    openssh-client \
    rsync \
    jq \
    xz-utils \
    ca-certificates \
    curl \
    && apt clean

RUN groupadd -g 1001 scott \
    && useradd -m -u 1001 -g 1001 -s /bin/bash scott

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN chown -R scott:scott /app

USER scott

EXPOSE 3030

CMD ["node", "server.js"]
```

---

## docker-compose.yml

```yaml
services:
  incusforge:
    image: scottibyte/incusforge:latest
    build: .

    container_name: incusforge

    restart: unless-stopped

    ports:
      - "3030:3030"

    environment:
      NODE_ENV: production

    volumes:
      - ./config.json:/app/config.json
      - ${HOME}/.config/incus:/incus-client:ro
      - ${HOME}/.ssh:/home/scott/.ssh:ro

    networks:
      - incusforge

networks:
  incusforge:
    driver: bridge
```

---

## config.json

```json
{
  "port": 3030,

  "simplestreams": {
    "repositoryName": "scottibyte-images",
    "repositoryHost": "192.168.80.88",
    "repositoryUser": "scott",
    "repositoryPath": "/var/www/html/images"
  }
}
```

---

## Build Container

```bash
docker compose build --no-cache
```

---

## Start Application

```bash
docker compose up -d
```

---

## Verify Logs

```bash
docker logs -f incusforge
```

Expected:

```text
ScottiBYTE Incus Forge running on port 3030
```

---

# 📦 SimpleStreams Repository Setup

## Create Repository Container

```bash
incus launch images:ubuntu/26.04 IncusSimplestreams
```

---

## Install Required Packages

```bash
sudo apt update

sudo apt install -y \
    nginx \
    rsync \
    jq \
    xz-utils \
    openssh-server
```

---

## Create Repository Directory

```bash
sudo mkdir -p /var/www/html/images

sudo chown -R scott:scott /var/www/html/images
```

---

## Configure NGINX

Edit:

```bash
sudo nano /etc/nginx/sites-available/default
```

Example:

```nginx
server {
    listen 80 default_server;

    root /var/www/html;

    autoindex on;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Restart nginx:

```bash
sudo systemctl restart nginx
```

---

# 🛠 SimpleStreams Bootstrap Script

Incus Forge includes helper scripts for repository setup and maintenance.

Example structure:

```text
scripts/
├── bootstrap-simplestreams.sh
├── healthcheck.sh
└── refresh-repository.sh
```

The bootstrap script automates:

- Repository directory creation
- Permission configuration
- NGINX setup
- Required package installation
- Metadata structure preparation

---

# 🌐 Add Repository To Incus

```bash
incus remote add scottibyte-images \
https://images.scottibyte.com \
--protocol=simplestreams
```

Verify:

```bash
incus remote list
```

---

# 🛠 Publishing Workflow

## Publish Container

1. Expand container row
2. Enter image alias
3. Click Publish

---

## Publish Snapshot

1. Expand container snapshots
2. Enter snapshot image alias
3. Click Publish Snapshot

---

## Push Image To Repository

1. Locate image in Local Images
2. Click Push
3. Repository metadata updates automatically

---

## Verify Published Images

```bash
incus image list scottibyte-images:
```

---

# 📸 Dashboard Screenshots

## Main Dashboard

<p align="center">
  <img src="docs/screenshots/main-dashboard.png" width="1200">
</p>

---

## Snapshot Publishing

<p align="center">
  <img src="docs/screenshots/snapshot-publish.png" width="1200">
</p>

---

## Repository Management

<p align="center">
  <img src="docs/screenshots/repository-management.png" width="1200">
</p>

---

# 🔒 Security Model

- Incus trust relationships use native Incus certificates
- SSH synchronization uses standard user SSH keys
- No database exposure
- No direct repository write APIs
- Native Linux file permissions
- Repository synchronization isolated through SSH

---

# 🛠 Troubleshooting

## Missing xz

Error:

```text
xz: executable file not found
```

Fix:

```bash
sudo apt install xz-utils
```

---

## Verify Incus Access

```bash
docker exec -it incusforge bash

incus remote list
```

---

## Verify SSH Access

```bash
ssh scott@192.168.80.88
```

---

## View Docker Logs

```bash
docker logs -f incusforge
```

---

## Verify Published Images

```bash
incus image list scottibyte-images:
```

---

# 🧭 Future Roadmap

## Planned Features

- Multiple repository profiles
- Repository selection drop-down
- Repository authentication profiles
- Background task queue
- Remote repository synchronization
- Repository replication
- Job history
- Enhanced async progress indicators

---

# ❤️ Support The Project

If you find Incus Forge useful:

- Subscribe to the ScottiBYTE YouTube channel
- Join the community discussions
- Share feedback and ideas
- Open issues and feature requests

---

# 🌐 Community

## YouTube

https://youtube.com/@ScottiBYTE

## Discussion

https://discussion.scottibyte.com

## Chat

https://chat.scottibyte.com
