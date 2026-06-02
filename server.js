const express = require("express");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3030;
const HOME_DIR = process.env.HOME || "/home/scott";
const CONFIG_PATH = path.join(__dirname, "config.json");

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function newJob(type, target, data) {
  const id = crypto.randomBytes(8).toString("hex");
  const job = {
    id,
    type,
    target,
    state: "QUEUED",
    message: "Queued",
    progress: 0,
    data,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: nowIso() });
  jobs.set(job.id, job);
}

function finishJob(job, patch = {}) {
  Object.assign(job, patch, {
    state: patch.state || "COMPLETE",
    progress: patch.progress ?? 100,
    updatedAt: nowIso(),
    finishedAt: nowIso()
  });
  jobs.set(job.id, job);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { simplestreams: null };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function runFile(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      maxBuffer: 1024 * 1024 * 500,
      env: { ...process.env, HOME: HOME_DIR },
      ...opts
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: error ? error.message : null,
        cmd,
        args
      });
    });
  });
}

function runFileWithProgress(cmd, args, opts = {}, onTick = null) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, HOME: HOME_DIR, ...(opts.env || {}) }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());

    const started = Date.now();
    const maxSyntheticMs = opts.maxSyntheticMs || 10 * 60 * 1000;
    const minProgress = opts.minProgress ?? 20;
    const maxProgress = opts.maxProgress ?? 85;
    let timer = null;

    if (typeof onTick === "function") {
      timer = setInterval(() => {
        const elapsed = Date.now() - started;
        const ratio = Math.min(1, elapsed / maxSyntheticMs);
        const progress = Math.min(
          maxProgress,
          Math.floor(minProgress + ratio * (maxProgress - minProgress))
        );

        onTick({
          elapsed,
          progress,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      }, opts.tickMs || 2000);
    }

    child.on("close", code => {
      if (timer) clearInterval(timer);

      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code === 0 ? null : `Exited with code ${code}`,
        cmd,
        args
      });
    });

    child.on("error", err => {
      if (timer) clearInterval(timer);

      resolve({
        ok: false,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: err.message,
        cmd,
        args
      });
    });
  });
}

function runWithInput(cmd, args, input) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, HOME: HOME_DIR } });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());

    child.stdin.write(input);
    child.stdin.end();

    child.on("close", code => {
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code === 0 ? null : `Exited with code ${code}`,
        cmd,
        args
      });
    });
  });
}

function incus(args, opts = {}) {
  return runFile("incus", args, opts);
}

function quote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function getRepoConfig() {
  const cfg = loadConfig();

  if (!cfg.simplestreams) {
    throw new Error("simplestreams is missing from config.json");
  }

  return {
    name: cfg.simplestreams.name || "scottibyte-images",
    publicUrl: cfg.simplestreams.publicUrl || "https://images.scottibyte.com",
    sshHost: cfg.simplestreams.sshHost || "192.168.80.88",
    sshUser: cfg.simplestreams.sshUser || "scott",
    webRoot: cfg.simplestreams.webRoot || "/var/www/html",
    imageDir: cfg.simplestreams.imageDir || "/var/www/html/images",
    streamsDir: cfg.simplestreams.streamsDir || "/var/www/html/streams"
  };
}

function sshTarget() {
  const cfg = getRepoConfig();
  return `${cfg.sshUser}@${cfg.sshHost}`;
}

function ssh(cmd) {
  return runFile("ssh", [sshTarget(), cmd]);
}

function scp(localFile, remotePath) {
  return runFile("scp", [localFile, `${sshTarget()}:${remotePath}`]);
}

async function getRemotes() {
  const result = await incus(["remote", "list", "--format", "json"]);
  if (!result.ok) throw new Error(result.stderr || result.error);

  const data = JSON.parse(result.stdout || "{}");

  return Object.entries(data)
    .map(([name, info]) => ({ name, ...info }))
    .filter(r => r.Protocol === "incus" && r.Public === false && r.Static === false);
}

async function getInstancesForRemote(remoteName) {
  const result = await incus(["list", `${remoteName}:`, "--format", "json"]);
  if (!result.ok) return [];
  return JSON.parse(result.stdout || "[]");
}

async function getInstanceStatus(remoteName, instanceName) {
  const instances = await getInstancesForRemote(remoteName);
  const instance = instances.find(i => i.name === instanceName);
  return instance ? instance.status : null;
}

function normalizeImage(img, remote) {
  return {
    remote,
    fingerprint: img.fingerprint || "",
    aliases: (img.aliases || []).map(a => a.name),
    alias: ((img.aliases || [])[0] || {}).name || "",
    description: img.properties?.description || "",
    architecture: img.architecture || "",
    type: img.type || "",
    size: img.size || 0,
    public: img.public || false
  };
}














function deriveExportMetadata(alias, description) {
  const text = `${alias || ""} ${description || ""}`.toLowerCase();

  let osName = "ubuntu";
  let release = "custom";
  let variant = "default";

  const releaseMap = [
    ["22.04", "jammy"],
    ["24.04", "noble"],
    ["26.04", "resolute"],
    ["jammy", "jammy"],
    ["noble", "noble"],
    ["resolute", "resolute"],
    ["focal", "focal"],
    ["bionic", "bionic"]
  ];

  for (const [needle, value] of releaseMap) {
    if (text.includes(needle)) {
      release = value;
      break;
    }
  }

  return { os: osName, release, variant };
}

function walkFiles(dir) {
  let out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out = out.concat(walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }

  return out;
}

function ensureMetadataYamlProperties(yaml, props) {
  let out = String(yaml || "").replace(/\r\n/g, "\n");

  const add = [];

  if (!/^\s{2}os:/m.test(out)) add.push(`  os: ${JSON.stringify(props.os)}`);
  if (!/^\s{2}release:/m.test(out)) add.push(`  release: ${JSON.stringify(props.release)}`);
  if (!/^\s{2}variant:/m.test(out)) add.push(`  variant: ${JSON.stringify(props.variant)}`);

  if (!add.length) return out;

  if (/^properties:\s*\{\}\s*$/m.test(out)) {
    return out.replace(/^properties:\s*\{\}\s*$/m, `properties:\n${add.join("\n")}`);
  }

  if (/^properties:\s*$/m.test(out)) {
    return out.replace(/^properties:\s*$/m, `properties:\n${add.join("\n")}`);
  }

  return out.replace(/\s*$/, `\nproperties:\n${add.join("\n")}\n`);
}

async function repackDirectoryToArchive(sourceDir, archivePath) {
  let args;

  if (archivePath.endsWith(".tar.xz")) {
    args = ["-cJf", archivePath, "-C", sourceDir, "."];
  } else if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    args = ["-czf", archivePath, "-C", sourceDir, "."];
  } else if (archivePath.endsWith(".tar")) {
    args = ["-cf", archivePath, "-C", sourceDir, "."];
  } else {
    args = ["-czf", archivePath, "-C", sourceDir, "."];
  }

  const packed = await runFile("tar", args);
  if (!packed.ok) {
    throw new Error(packed.stderr || packed.error || `Failed to repack ${archivePath}`);
  }
}

async function repairMetadataYamlInDirectory(dir, alias, description) {
  const props = deriveExportMetadata(alias, description);
  const files = walkFiles(dir);
  const metadataYaml = files.find(f => path.basename(f) === "metadata.yaml");

  if (!metadataYaml) return false;

  const original = fs.readFileSync(metadataYaml, "utf8");
  const repaired = ensureMetadataYamlProperties(original, props);

  if (repaired !== original) {
    fs.writeFileSync(metadataYaml, repaired);
  }

  return true;
}

async function repairExportArchive(archivePath, alias, description) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "incusforge-export-repair-"));

  try {
    const extracted = await runFile("tar", ["-xf", archivePath, "-C", work]);
    if (!extracted.ok) {
      return false;
    }

    // Case 1: metadata.yaml is directly inside this archive.
    let repaired = await repairMetadataYamlInDirectory(work, alias, description);

    // Case 2: combined Incus archive contains metadata.tar.* inside it.
    if (!repaired) {
      const files = walkFiles(work);
      const metadataArchive = files.find(f =>
        /^metadata\.tar(\.xz|\.gz)?$/.test(path.basename(f))
      );

      if (metadataArchive) {
        const metaWork = fs.mkdtempSync(path.join(os.tmpdir(), "incusforge-meta-repair-"));

        try {
          const metaExtract = await runFile("tar", ["-xf", metadataArchive, "-C", metaWork]);
          if (metaExtract.ok) {
            repaired = await repairMetadataYamlInDirectory(metaWork, alias, description);

            if (repaired) {
              await repackDirectoryToArchive(metaWork, metadataArchive);
            }
          }
        } finally {
          fs.rmSync(metaWork, { recursive: true, force: true });
        }
      }
    }

    if (repaired) {
      await repackDirectoryToArchive(work, archivePath);
    }

    return repaired;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function repairExportedImageMetadataArchives(files, alias, description) {
  let repairedAny = false;

  for (const file of files) {
    try {
      const repaired = await repairExportArchive(file, alias, description);
      repairedAny = repairedAny || repaired;
    } catch (err) {
      console.warn(`Export metadata repair failed for ${file}: ${err.message}`);
    }
  }

  if (!repairedAny) {
    throw new Error("Could not find metadata.yaml in exported image archive");
  }
}


function normalizeRepoProduct(productName, product, cfg) {
  const versions = product.versions || {};
  const versionKeys = Object.keys(versions);
  const latestVersion = versionKeys.sort().reverse()[0] || "";
  const items = latestVersion ? versions[latestVersion].items || {} : {};

  let fingerprint = "";
  let size = 0;

  for (const item of Object.values(items)) {
    if (item.sha256) fingerprint = item.sha256;
    if (item.size) size = item.size;
  }

  const aliases = String(product.aliases || "")
    .replaceAll(",", " ")
    .split(/\s+/)
    .filter(Boolean);

  const preferredAlias =
    aliases.find(a => !a.startsWith("ubuntu/")) ||
    aliases.find(a => !a.includes("/")) ||
    aliases[0] ||
    productName;

  return {
    remote: cfg.name,
    fingerprint,
    aliases,
    alias: preferredAlias,
    description: product.description || product.properties?.description || productName,
    architecture: product.architecture || product.arch || "",
    type: "container",
    size,
    public: true
  };
}

async function readRepoProducts() {
  const cfg = getRepoConfig();
  const result = await ssh(`cat ${quote(cfg.webRoot + "/streams/v1/images.json")}`);
  if (!result.ok) throw new Error(result.stderr || result.error);
  return JSON.parse(result.stdout || "{}").products || {};
}

async function updateRepoMetadataByFingerprint(fingerprintPrefix, alias, description) {
  const cfg = getRepoConfig();

  const script = `
import json, shutil

p = ${JSON.stringify(`${cfg.webRoot}/streams/v1/images.json`)}
fingerprint_prefix = ${JSON.stringify(fingerprintPrefix)}
alias = ${JSON.stringify(alias)}
description = ${JSON.stringify(description || "")}

with open(p, "r") as f:
    data = json.load(f)

changed = False

for product_name, product in data.get("products", {}).items():
    blob = json.dumps(product)

    if fingerprint_prefix in blob:
        parts = [x for x in product.get("aliases", "").replace(",", " ").split() if x]
        os_aliases = [x for x in parts if "/" in x]
        product["aliases"] = ",".join(os_aliases + [alias])

        if description:
            product["description"] = description
            product.setdefault("properties", {})["description"] = description

        changed = True

if not changed:
    raise SystemExit("Fingerprint not found after add: " + fingerprint_prefix)

shutil.copy2(p, p + ".bak")

with open(p, "w") as f:
    json.dump(data, f, separators=(",", ":"))
`;

  return ssh(`python3 - <<'PY'\n${script}\nPY`);
}


function deriveSimpleStreamsProduct(alias, description, architecture) {
  const text = `${alias || ""} ${description || ""}`.toLowerCase();

  let osName = "ubuntu";
  let release = "custom";
  let releaseTitle = "custom";
  let version = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

  const releases = [
    ["22.04", "jammy"],
    ["24.04", "noble"],
    ["26.04", "resolute"],
    ["jammy", "jammy"],
    ["noble", "noble"],
    ["resolute", "resolute"],
    ["focal", "focal"],
    ["bionic", "bionic"]
  ];

  for (const [needle, value] of releases) {
    if (text.includes(needle)) {
      release = value;
      releaseTitle = value;
      break;
    }
  }

  const arch = architecture === "x86_64" ? "amd64" : (architecture || "amd64");
  const safeAlias = String(alias || "custom-image").replace(/[^A-Za-z0-9._-]/g, "-");
  const productName = `${safeAlias}:${arch}`;

  return {
    productName,
    os: osName,
    release,
    releaseTitle,
    variant: "default",
    arch,
    version
  };
}

async function getLocalImageInfo(remote, fingerprint) {
  const list = await incus(["image", "list", `${remote}:`, "--format", "json"]);

  if (!list.ok) {
    return { architecture: "amd64", description: "" };
  }

  const images = JSON.parse(list.stdout || "[]");
  const image = images.find(img => String(img.fingerprint || "").startsWith(fingerprint));

  if (!image) {
    return { architecture: "amd64", description: "" };
  }

  return {
    architecture: image.architecture || "amd64",
    description: image.properties?.description || ""
  };
}

async function sha256File(filePath) {
  const result = await runFile("sha256sum", [filePath]);

  if (!result.ok) {
    throw new Error(result.stderr || result.error || `sha256sum failed for ${filePath}`);
  }

  return result.stdout.split(/\s+/)[0];
}

async function manualSimpleStreamsAdd(remoteFiles, alias, description, architecture) {
  const cfg = getRepoConfig();
  const product = deriveSimpleStreamsProduct(alias, description, architecture);

  const filesPayload = remoteFiles.map(f => ({
    source: f.path,
    name: f.name,
    size: f.size,
    sha256: f.sha256
  }));

  const script = `
import json, os, shutil

web_root = ${JSON.stringify(cfg.webRoot)}
image_dir = ${JSON.stringify(cfg.imageDir)}
streams_dir = ${JSON.stringify(cfg.webRoot + "/streams/v1")}
images_json = os.path.join(streams_dir, "images.json")
index_json = os.path.join(streams_dir, "index.json")
alias = ${JSON.stringify(alias)}
description = ${JSON.stringify(description || "")}
product_name = ${JSON.stringify(product.productName)}
os_name = ${JSON.stringify(product.os)}
release = ${JSON.stringify(product.release)}
release_title = ${JSON.stringify(product.releaseTitle)}
variant = ${JSON.stringify(product.variant)}
arch = ${JSON.stringify(product.arch)}
version = ${JSON.stringify(product.version)}
files = ${JSON.stringify(filesPayload)}

os.makedirs(image_dir, exist_ok=True)
os.makedirs(streams_dir, exist_ok=True)

if not os.path.exists(index_json):
    with open(index_json, "w") as f:
        json.dump({
            "index": {
                "images": {
                    "datatype": "image-downloads",
                    "path": "streams/v1/images.json",
                    "products": [],
                    "format": "products:1.0"
                }
            },
            "format": "index:1.0"
        }, f, separators=(",", ":"))

if os.path.exists(images_json):
    with open(images_json, "r") as f:
        data = json.load(f)
else:
    data = {
        "content_id": "images",
        "datatype": "image-downloads",
        "format": "products:1.0",
        "products": {}
    }

items = {}

for entry in files:
    src = entry["source"]
    sha = entry["sha256"]
    size = int(entry["size"])
    lower_name = entry["name"].lower()

    if len(files) == 1:
        ftype = "incus_combined.tar.gz"
        dest_name = sha + ".incus_combined.tar.gz"
    elif "metadata" in lower_name:
        ftype = "incus_metadata.tar.gz"
        dest_name = sha + ".incus_metadata.tar.gz"
    else:
        ftype = "root.tar.gz"
        dest_name = sha + ".root.tar.gz"

    dest = os.path.join(image_dir, dest_name)
    shutil.move(src, dest)

    items[ftype] = {
        "ftype": ftype,
        "path": "images/" + dest_name,
        "sha256": sha,
        "size": size
    }

data.setdefault("products", {})
data["products"][product_name] = {
    "aliases": alias,
    "arch": arch,
    "architecture": arch,
    "os": os_name,
    "release": release,
    "release_title": release_title,
    "variant": variant,
    "description": description or product_name,
    "properties": {
        "description": description or product_name
    },
    "versions": {
        version: {
            "items": items
        }
    }
}

if os.path.exists(images_json):
    shutil.copy2(images_json, images_json + ".bak")

with open(images_json, "w") as f:
    json.dump(data, f, separators=(",", ":"))

print(product_name)
`;

  return ssh(`python3 - <<'PYREMOTE'\n${script}\nPYREMOTE`);
}


function bootstrapCommands() {
  const cfg = getRepoConfig();

  return [
    "sudo apt update",
    "sudo apt install -y nginx xz-utils python3 python3-yaml incus-extra openssh-server",
    `sudo mkdir -p ${cfg.imageDir} ${cfg.streamsDir}/v1`,
    `sudo chown -R ${cfg.sshUser}:${cfg.sshUser} ${cfg.webRoot}`,
    `sudo chmod -R 775 ${cfg.imageDir} ${cfg.streamsDir}`,
    `cd ${cfg.webRoot}`,
    `test -f ${cfg.streamsDir}/v1/index.json || cat > ${cfg.streamsDir}/v1/index.json <<'JSON'\n{"index":{"images":{"datatype":"image-downloads","path":"streams/v1/images.json","products":[],"format":"products:1.0"}},"format":"index:1.0"}\nJSON`,
    `test -f ${cfg.streamsDir}/v1/images.json || cat > ${cfg.streamsDir}/v1/images.json <<'JSON'\n{"content_id":"images","datatype":"image-downloads","format":"products:1.0","products":{}}\nJSON`,
    "sudo systemctl enable --now nginx",
    `touch ${cfg.imageDir}/.incusforge-write-test && rm ${cfg.imageDir}/.incusforge-write-test`
  ];
}

async function healthCheck() {
  const cfg = getRepoConfig();

  const checks = [
    { name: "SSH reachable", cmd: "hostname && whoami" },
    { name: "incus-simplestreams installed", cmd: "command -v incus-simplestreams" },
    { name: "xz installed", cmd: "command -v xz" },
    { name: "python3 installed", cmd: "command -v python3" },
    { name: "images directory exists", cmd: `test -d ${quote(cfg.imageDir)}` },
    { name: "streams directory exists", cmd: `test -d ${quote(cfg.streamsDir)}` },
    { name: "images directory writable", cmd: `touch ${quote(cfg.imageDir + "/.incusforge-test")} && rm ${quote(cfg.imageDir + "/.incusforge-test")}` },
    { name: "streams directory writable", cmd: `touch ${quote(cfg.streamsDir + "/.incusforge-test")} && rm ${quote(cfg.streamsDir + "/.incusforge-test")}` },
    { name: "index.json readable", cmd: `test -r ${quote(cfg.webRoot + "/streams/v1/index.json")}` },
    { name: "images.json readable", cmd: `test -r ${quote(cfg.webRoot + "/streams/v1/images.json")}` },
    { name: "images.json valid JSON", cmd: `python3 -m json.tool ${quote(cfg.webRoot + "/streams/v1/images.json")} >/dev/null` }
  ];

  const results = [];

  for (const check of checks) {
    const result = await ssh(check.cmd);
    results.push({
      name: check.name,
      ok: result.ok,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error
    });
  }

  return {
    repo: cfg,
    ok: results.every(r => r.ok),
    checks: results,
    bootstrapCommands: bootstrapCommands()
  };
}

async function runPushJob(job) {
  const { remote, fingerprint, alias, description } = job.data;
  const cfg = getRepoConfig();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "incusforge-"));

  try {
    updateJob(job, {
      state: "EXPORTING",
      progress: 10,
      message: `Preparing metadata and exporting ${fingerprint.substring(0, 12)} from ${remote}...`
    });

    const exportResult = await incus(["image", "export", `${remote}:${fingerprint}`, "export"], { cwd: tmp });

    if (!exportResult.ok) {
      throw new Error(exportResult.stderr || exportResult.error || "Image export failed");
    }

    const localFiles = fs.readdirSync(tmp)
      .map(f => path.join(tmp, f))
      .filter(f => fs.statSync(f).isFile());

    if (!localFiles.length) {
      throw new Error("No exported image files found.");
    }

    updateJob(job, {
      state: "REPAIRING_METADATA",
      progress: 25,
      message: `Repairing exported metadata for ${alias}...`
    });

    updateJob(job, {
      state: "COPYING",
      progress: 35,
      message: `Copying ${localFiles.length} exported file(s) to SimpleStreams server...`
    });

    const staging = `/tmp/incusforge-${Date.now()}`;
    const prep = await ssh(`mkdir -p ${quote(cfg.imageDir)} ${quote(staging)}`);
    if (!prep.ok) throw new Error(prep.stderr || prep.error || "Remote staging preparation failed");

    for (const file of localFiles) {
      const copy = await scp(file, `${staging}/${path.basename(file)}`);
      if (!copy.ok) throw new Error(copy.stderr || copy.error || "File copy failed");
    }

    const remoteFiles = localFiles.map(file => {
      const base = path.basename(file);
      return { path: `${staging}/${base}`, name: base, size: fs.statSync(file).size };
    });

    remoteFiles.sort((a, b) => a.size - b.size);

    for (const rf of remoteFiles) {
      const local = localFiles.find(file => path.basename(file) === rf.name);
      rf.sha256 = await sha256File(local);
    }

    updateJob(job, {
      state: "INDEXING",
      progress: 60,
      message: `Adding ${alias} to SimpleStreams metadata...`
    });

    const localInfo = await getLocalImageInfo(remote, fingerprint);
    const add = await manualSimpleStreamsAdd(
      remoteFiles,
      alias,
      description || localInfo.description || "",
      localInfo.architecture || "amd64"
    );

    if (!add.ok) {
      throw new Error(add.stderr || add.error || "Manual SimpleStreams metadata add failed");
    }

    updateJob(job, {
      state: "UPDATING_METADATA",
      progress: 75,
      message: `Updating alias and description metadata for ${alias}...`
    });

    const fingerprintPrefix = fingerprint.substring(0, 12);

    updateJob(job, {
      state: "VERIFYING",
      progress: 85,
      message: `Waiting for ${alias} to appear in repository listing...`
    });

    let verified = false;

    for (let i = 0; i < 45; i++) {
      const products = await readRepoProducts();
      const blob = JSON.stringify(products);

      if (blob.includes(alias) || blob.includes(fingerprintPrefix)) {
        verified = true;
        break;
      }

      updateJob(job, {
        state: "VERIFYING",
        progress: Math.min(98, 85 + i),
        message: `Verifying repository listing for ${alias}... ${i + 1}/45`
      });

      await sleep(1000);
    }

    if (!verified) {
      throw new Error(`Push completed, but ${alias} was not visible in repository metadata before timeout`);
    }

    await ssh(`rm -rf ${quote(staging)}`);

    finishJob(job, {
      state: "COMPLETE",
      progress: 100,
      message: `Image pushed to SimpleStreams as ${alias}.`
    });
  } catch (err) {
    finishJob(job, {
      state: "FAILED",
      progress: job.progress || 0,
      message: `Push failed: ${err.message}`,
      error: err.message
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}


async function runPublishJob(job) {
  const { remote, container, alias, snapshot } = job.data;
  const source = snapshot ? `${remote}:${container}/${snapshot}` : `${remote}:${container}`;

  try {
    let wasRunning = false;

    if (!snapshot) {
      const status = await getInstanceStatus(remote, container);
      wasRunning = String(status || "").toLowerCase() === "running";

      if (wasRunning) {
        updateJob(job, {
          state: "STOPPING",
          progress: 0,
          message: `Stopping ${remote}:${container} before publishing...`
        });

        const stop = await incus(["stop", `${remote}:${container}`, "--timeout", "120"]);
        if (!stop.ok) throw new Error(stop.stderr || stop.error || "Failed to stop instance");
      }
    }

    updateJob(job, {
      state: "PUBLISHING",
      progress: 0,
      message: `Publishing local image ${alias}...`
    });

    const publish = await incus(["publish", source, `${remote}:`, "--alias", alias]);

    if (!publish.ok) {
      throw new Error(publish.stderr || publish.error || "Publish failed");
    }

    updateJob(job, {
      state: "VERIFYING",
      progress: 0,
      message: `Verifying local image ${alias}...`
    });

    let verified = false;

    for (let i = 0; i < 180; i++) {
      const list = await incus(["image", "list", `${remote}:`, "--format", "json"]);

      if (list.ok) {
        const images = JSON.parse(list.stdout || "[]");
        verified = images.some(img =>
          (img.aliases || []).some(a => a.name === alias)
        );
        if (verified) break;
      }

      await sleep(1000);
    }

    if (!verified) {
      throw new Error(`Publish finished, but alias '${alias}' did not appear in local images before timeout`);
    }

    if (wasRunning) {
      updateJob(job, {
        state: "STARTING",
        progress: 0,
        message: `Restarting ${remote}:${container}...`
      });

      const start = await incus(["start", `${remote}:${container}`]);
      if (!start.ok) throw new Error("Image was created, but restart failed: " + (start.stderr || start.error));
    }

    finishJob(job, {
      state: "COMPLETE",
      progress: 100,
      message: `Local image ${alias} created successfully.`
    });
  } catch (err) {
    finishJob(job, {
      state: "FAILED",
      progress: 0,
      message: `Publish failed: ${err.message}`,
      error: err.message
    });
  }
}


async function localImageAliasExists(remote, alias) {
  const list = await incus(["image", "list", `${remote}:`, "--format", "json"]);

  if (!list.ok) {
    return false;
  }

  const images = JSON.parse(list.stdout || "[]");

  return images.some(img =>
    (img.aliases || []).some(a => a.name === alias)
  );
}

async function reconcileLocalPublishJobs() {
  const active = Array.from(jobs.values()).filter(job =>
    job.type === "local-publish" &&
    !["COMPLETE", "FAILED"].includes(job.state) &&
    job.data?.remote &&
    job.data?.alias
  );

  for (const job of active) {
    try {
      const exists = await localImageAliasExists(job.data.remote, job.data.alias);

      if (exists) {
        finishJob(job, {
          state: "COMPLETE",
          progress: 100,
          message: `Local image ${job.data.alias} created successfully.`
        });
      }
    } catch (err) {
      // Do not fail the jobs endpoint because reconciliation is best-effort.
      console.warn(`Local publish reconciliation skipped for ${job.id}: ${err.message}`);
    }
  }
}


app.get("/api/jobs", async (req, res) => {
  await reconcileLocalPublishJobs();

  const list = Array.from(jobs.values())
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);

  res.json(list);
});

app.get("/api/config", async (req, res) => {
  try {
    const cfg = loadConfig();

    res.json({
      ok: true,
      app: {
        appName: cfg.app?.appName || "ScottiBYTE Incus Forge",
        version: cfg.app?.version || "unknown",
        githubReleasesUrl: cfg.app?.githubReleasesUrl || "https://github.com/ScottiBYTE/incusforge/releases",
        donateUrl: cfg.app?.donateUrl || "https://www.paypal.com/paypalme/ScottiBYTE"
      },
      simplestreams: cfg.simplestreams || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/repo/health", async (req, res) => {
  try {
    res.json(await healthCheck());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/repo/bootstrap", async (req, res) => {
  try {
    res.json({ ok: true, commands: bootstrapCommands() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/containers", async (req, res) => {
  try {
    const remotes = await getRemotes();
    const all = [];

    for (const remote of remotes) {
      const containers = await getInstancesForRemote(remote.name);

      for (const c of containers) {
        all.push({
          remote: remote.name,
          name: c.name,
          status: c.status,
          type: c.type,
          project: c.project || "default",
          snapshots: (c.snapshots || []).map(s => ({
            name: s.name,
            created_at: s.created_at || "",
            expires_at: s.expires_at || "",
            stateful: s.stateful || false
          }))
        });
      }
    }

    res.json(all);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/images", async (req, res) => {
  try {
    const remotes = await getRemotes();
    const all = [];

    for (const remote of remotes) {
      const result = await incus(["image", "list", `${remote.name}:`, "--format", "json"]);
      if (!result.ok) continue;

      JSON.parse(result.stdout || "[]").forEach(img => {
        all.push(normalizeImage(img, remote.name));
      });
    }

    res.json(all);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/repo/images", async (req, res) => {
  try {
    const cfg = getRepoConfig();
    const result = await ssh(`cat ${quote(cfg.webRoot + "/streams/v1/images.json")}`);
    if (!result.ok) return res.json(result);

    const data = JSON.parse(result.stdout || "{}");
    const products = data.products || {};

    res.json(Object.entries(products).map(([name, product]) => {
      return normalizeRepoProduct(name, product, cfg);
    }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/publish", async (req, res) => {
  const { remote, container, alias, snapshot } = req.body;

  if (!remote || !container || !alias) {
    return res.status(400).json({ ok: false, error: "remote, container, and alias are required" });
  }

  const existing = Array.from(jobs.values()).find(j =>
    j.type === "local-publish" &&
    j.data?.remote === remote &&
    j.data?.container === container &&
    j.data?.alias === alias &&
    j.data?.snapshot === (snapshot || "") &&
    !["COMPLETE", "FAILED"].includes(j.state)
  );

  if (existing) {
    return res.json({ ok: true, queued: true, jobId: existing.id });
  }

  const job = newJob(
    "local-publish",
    snapshot ? `${remote}:${container}/${snapshot}` : `${remote}:${container}`,
    {
      remote,
      container,
      alias,
      snapshot: snapshot || ""
    }
  );

  runPublishJob(job);

  res.json({ ok: true, queued: true, jobId: job.id });
});
app.post("/api/image/alias/rename", async (req, res) => {
  const { remote, oldAlias, newAlias, fingerprint } = req.body;

  if (!remote || !newAlias) {
    return res.status(400).json({ ok: false, error: "remote and newAlias are required" });
  }

  if (oldAlias) {
    return res.json(await incus(["image", "alias", "rename", `${remote}:${oldAlias}`, newAlias]));
  }

  if (!fingerprint) {
    return res.status(400).json({
      ok: false,
      error: "fingerprint is required when creating a new alias"
    });
  }

  res.json(await incus(["image", "alias", "create", `${remote}:${newAlias}`, `${remote}:${fingerprint}`]));
});

app.post("/api/image/description", async (req, res) => {
  const { remote, fingerprint, description } = req.body;

  if (!remote || !fingerprint) {
    return res.status(400).json({ ok: false, error: "remote and fingerprint are required" });
  }

  const show = await incus(["image", "show", `${remote}:${fingerprint}`]);
  if (!show.ok) return res.json(show);

  let yaml = show.stdout;

  if (/properties:\n/.test(yaml)) {
    if (/  description:.*$/m.test(yaml)) {
      yaml = yaml.replace(/  description:.*$/m, `  description: ${JSON.stringify(description)}`);
    } else {
      yaml = yaml.replace(/properties:\n/, `properties:\n  description: ${JSON.stringify(description)}\n`);
    }
  } else {
    yaml += `\nproperties:\n  description: ${JSON.stringify(description)}\n`;
  }

  res.json(await runWithInput("incus", ["image", "edit", `${remote}:${fingerprint}`], yaml));
});

app.post("/api/image/delete", async (req, res) => {
  const { remote, fingerprint } = req.body;

  if (!remote || !fingerprint) {
    return res.status(400).json({ ok: false, error: "remote and fingerprint are required" });
  }

  res.json(await incus(["image", "delete", `${remote}:${fingerprint}`]));
});

app.post("/api/repo/push", async (req, res) => {
  const { remote, fingerprint, alias, description } = req.body;

  if (!remote || !fingerprint || !alias) {
    return res.status(400).json({
      ok: false,
      error: "remote, fingerprint, and alias are required"
    });
  }

  const existing = Array.from(jobs.values()).find(j =>
    j.type === "repo-push" &&
    j.data?.fingerprint === fingerprint &&
    !["COMPLETE", "FAILED"].includes(j.state)
  );

  if (existing) {
    return res.json({ ok: true, queued: true, jobId: existing.id });
  }

  const job = newJob("repo-push", `${remote}:${fingerprint.substring(0, 12)}`, {
    remote,
    fingerprint,
    alias,
    description: description || ""
  });

  runPushJob(job);

  res.json({ ok: true, queued: true, jobId: job.id });
});

app.post("/api/repo/delete", async (req, res) => {
  const { fingerprint, alias } = req.body;

  if (!fingerprint && !alias) {
    return res.status(400).json({ ok: false, error: "fingerprint or alias is required" });
  }

  const cfg = getRepoConfig();

  if (fingerprint) {
    const normalRemove = await ssh(`cd ${quote(cfg.webRoot)} && incus-simplestreams remove ${quote(fingerprint)}`);
    if (normalRemove.ok) return res.json(normalRemove);
  }

  const script = `
import json, shutil

p = ${JSON.stringify(`${cfg.webRoot}/streams/v1/images.json`)}
fingerprint = ${JSON.stringify(fingerprint || "")}
alias = ${JSON.stringify(alias || "")}

with open(p, "r") as f:
    data = json.load(f)

products = data.get("products", {})
remove_keys = []

for product_name, product in products.items():
    blob = json.dumps(product)
    aliases = product.get("aliases", "")

    if (
        (fingerprint and fingerprint in blob) or
        (fingerprint and fingerprint[:12] in blob) or
        (alias and alias in aliases) or
        (alias and alias == product_name)
    ):
        remove_keys.append(product_name)

if not remove_keys:
    raise SystemExit("No matching SimpleStreams product found for delete")

shutil.copy2(p, p + ".bak")

for k in remove_keys:
    products.pop(k, None)

with open(p, "w") as f:
    json.dump(data, f, separators=(",", ":"))

print("Removed:", ",".join(remove_keys))
`;

  const fallback = await ssh(`python3 - <<'PYREMOTE'\n${script}\nPYREMOTE`);

  res.json(fallback);
});
app.post("/api/repo/metadata", async (req, res) => {
  const { fingerprint, oldAlias, newAlias, description } = req.body;

  if (!fingerprint) {
    return res.status(400).json({ ok: false, error: "fingerprint is required" });
  }

  const cfg = getRepoConfig();

  const script = `
import json, shutil

p = ${JSON.stringify(`${cfg.webRoot}/streams/v1/images.json`)}
fingerprint = ${JSON.stringify(fingerprint)}
old_alias = ${JSON.stringify(oldAlias || "")}
new_alias = ${JSON.stringify(newAlias || "")}
description = ${JSON.stringify(description || "")}

with open(p, "r") as f:
    data = json.load(f)

changed = False

for product_name, product in data.get("products", {}).items():
    blob = json.dumps(product)
    aliases = product.get("aliases", "")

    if fingerprint in blob or fingerprint[:12] in blob or old_alias in aliases:
        if new_alias:
            parts = [x for x in aliases.replace(",", " ").split() if x]
            os_aliases = [x for x in parts if "/" in x]
            product["aliases"] = ",".join(os_aliases + [new_alias])

        product["description"] = description
        product.setdefault("properties", {})["description"] = description
        changed = True

if not changed:
    raise SystemExit("No matching product found")

shutil.copy2(p, p + ".bak")

with open(p, "w") as f:
    json.dump(data, f, separators=(",", ":"))
`;

  res.json(await ssh(`python3 - <<'PY'\n${script}\nPY`));
});

app.listen(PORT, () => {
  console.log(`ScottiBYTE Incus Forge running on port ${PORT}`);
});
