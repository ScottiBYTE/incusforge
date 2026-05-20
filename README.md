# ScottiBYTE Incus Forge

Build • Publish • Distribute Incus Custom Images

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

Enter shell:

```bash
incus shell IncusForge
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
ssh scott@192.168.80.88 "hostname && whoami"
```

Expected:

```text
IncusSimplestreams
scott
```

---

# 📦 Create IncusForge Project Directory

```bash
mkdir -p ~/incusforge

cd ~/incusforge
```

---

# 📦 Create config.json

```bash
nano config.json
```

Paste:

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

Save file.

---

# 🐳 Create docker-compose.yml

```bash
nano docker-compose.yml
```

Paste:

```yaml
services:
  incusforge:
    image: scottibyte/incusforge:latest

    container_name: incusforge

    restart: unless-stopped

    ports:
      - "3030:3030"

    environment:
      PORT: "3030"
      HOME: /home/scott
      INCUS_CONF: /incus-client
      CONFIG_PATH: /app/config.json

    volumes:
      - ./config.json:/app/config.json:ro
      - ${HOME}/.config/incus:/incus-client:ro
      - ${HOME}/.ssh:/home/scott/.ssh:ro
```

Save file.

---

# 🚀 Start Incus Forge

```bash
docker compose up -d
```

Verify logs:

```bash
docker logs -f incusforge
```

Expected:

```text
ScottiBYTE Incus Forge running on port 3030
```

Open browser:

```text
http://YOUR-IP:3030
```

---

# 📦 Create SimpleStreams Repository Server

Create repository container:

```bash
incus launch images:ubuntu/26.04 IncusSimplestreams
```

Enter shell:

```bash
incus shell IncusSimplestreams
```

---

# 🛠 Create Bootstrap Script

```bash
nano bootstrap-simplestreams.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/html}"
IMAGE_DIR="${IMAGE_DIR:-$WEB_ROOT/images}"
STREAMS_DIR="${STREAMS_DIR:-$WEB_ROOT/streams}"
REPO_USER="${REPO_USER:-$USER}"

echo "=== ScottiBYTE Incus Forge SimpleStreams Bootstrap ==="

echo "[1/8] Installing required packages..."
sudo apt update
sudo apt install -y nginx xz-utils python3 python3-yaml incus-extra openssh-server curl ca-certificates rsync jq

echo "[2/8] Enabling SSH..."
sudo systemctl enable --now ssh || sudo systemctl enable --now sshd

echo "[3/8] Enabling nginx..."
sudo systemctl enable --now nginx

echo "[4/8] Creating repository directories..."
sudo mkdir -p "$IMAGE_DIR"
sudo mkdir -p "$STREAMS_DIR/v1"

echo "[5/8] Setting ownership and permissions..."
sudo chown -R "$REPO_USER:$REPO_USER" "$WEB_ROOT"
sudo chmod -R 775 "$WEB_ROOT"

echo "[6/8] Creating metadata files..."

if [ ! -f "$STREAMS_DIR/v1/index.json" ]; then
cat > "$STREAMS_DIR/v1/index.json" <<'JSON'
{"index":{"images":{"datatype":"image-downloads","path":"streams/v1/images.json","products":[],"format":"products:1.0"}},"format":"index:1.0"}
JSON
fi

if [ ! -f "$STREAMS_DIR/v1/images.json" ]; then
cat > "$STREAMS_DIR/v1/images.json" <<'JSON'
{"content_id":"images","datatype":"image-downloads","format":"products:1.0","products":{}}
JSON
fi

echo "[7/8] Validating repository..."
command -v incus-simplestreams >/dev/null
command -v xz >/dev/null
command -v nginx >/dev/null

echo "[8/8] Bootstrap complete."

echo
echo "Repository ready."
echo
echo "Next step:"
echo "ssh-copy-id $REPO_USER@<repository-ip>"
```

Save file.

---

# 🚀 Run Bootstrap Script

```bash
chmod +x bootstrap-simplestreams.sh

REPO_USER=scott WEB_ROOT=/var/www/html ./bootstrap-simplestreams.sh
```

---

# 🌐 Verify Repository Access

Open browser:

```text
http://YOUR-REPOSITORY-IP/images
```

Verify metadata:

```bash
curl http://YOUR-REPOSITORY-IP/streams/v1/index.json
```

---

# 🌐 Add SimpleStreams Repository To Incus

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
