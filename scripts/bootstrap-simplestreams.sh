#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/html}"
IMAGE_DIR="${IMAGE_DIR:-$WEB_ROOT/images}"
STREAMS_DIR="${STREAMS_DIR:-$WEB_ROOT/streams}"
REPO_USER="${REPO_USER:-$USER}"

echo "=== ScottiBYTE Incus Forge SimpleStreams Bootstrap ==="

echo "[1/8] Installing required packages..."
sudo apt update
sudo apt install -y nginx xz-utils python3 python3-yaml incus-extra openssh-server curl ca-certificates

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
sudo find "$WEB_ROOT" -type d -exec chmod 775 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 664 {} \;

echo "[6/8] Creating SimpleStreams metadata if missing..."

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
command -v python3 >/dev/null
command -v nginx >/dev/null

python3 -m json.tool "$STREAMS_DIR/v1/index.json" >/dev/null
python3 -m json.tool "$STREAMS_DIR/v1/images.json" >/dev/null

touch "$IMAGE_DIR/.incusforge-write-test"
rm "$IMAGE_DIR/.incusforge-write-test"

touch "$STREAMS_DIR/.incusforge-write-test"
rm "$STREAMS_DIR/.incusforge-write-test"

echo "[8/8] Checking local web access..."
curl -fsS "http://127.0.0.1/streams/v1/index.json" >/dev/null || {
  echo "WARNING: nginx is running, but /streams/v1/index.json was not reachable locally."
  echo "Check nginx web root. Expected WEB_ROOT=$WEB_ROOT"
}

echo
echo "=== Bootstrap Complete ==="
echo "Repository user: $REPO_USER"
echo "Web root:        $WEB_ROOT"
echo "Images dir:      $IMAGE_DIR"
echo "Streams dir:     $STREAMS_DIR"
echo
echo "Next step from the Incus Forge container:"
echo "ssh-copy-id $REPO_USER@<simplestreams-ip>"
echo
echo "Then verify:"
echo "ssh $REPO_USER@<simplestreams-ip> 'hostname && whoami && command -v incus-simplestreams && xz --version'"
