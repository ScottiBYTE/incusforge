window.__incusForgeLocalImageAliases = new Set();

let publishBusy = false;
let editing = false;

let containersData = [];
let imagesData = [];
let repoData = [];
let expanded = new Set();
let jobsData = [];
let activePushByFingerprint = new Map();
let activePublishByTarget = new Map();
let lastJobStates = new Map();

let sortState = {
  containers: { key: "name", direction: "asc" },
  images: { key: "description", direction: "asc" },
  repo: { key: "description", direction: "asc" }
};

function isBusy() {
  return publishBusy;
}

function setStatus(msg, mode = "working") {
  // Suppress local publish progress/state from global banner.
  if (/^(Creating local image|Publishing local image|Verifying local image|Starting local image|Stopping local image)/i.test(String(msg || ""))) {
    return;
  }

  // Local publish progress belongs in the row, not the global banner.
  if (/^(Publishing|Stopping|Starting|Verifying) local image /i.test(String(msg || ""))) {
    return;
  }

  // Creating local image progress is row-only. Do not show it in the global status banner.
  if (String(msg || "").startsWith("Creating local image ")) {
    return;
  }

  const bar = document.getElementById("statusbar");
  bar.textContent = msg;
  bar.className = "statusbar " + mode;
}

function sizeMiB(bytes) {
  if (!bytes) return "";
  return (bytes / 1024 / 1024).toFixed(2) + " MiB";
}

function updateStats() {
  const repoSize = repoData.reduce((sum, img) => sum + Number(img.size || 0), 0);
  document.getElementById("statContainers").textContent = containersData.length;
  document.getElementById("statImages").textContent = imagesData.length;
  document.getElementById("statRepo").textContent = repoData.length;
  document.getElementById("statRepoSize").textContent = sizeMiB(repoSize) || "0 MiB";
}

function norm(v) {
  return String(v ?? "").toLowerCase();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function apiPost(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

function statusBadge(status) {
  if (status === "Running") return `<span class="badge badge-running">Running</span>`;
  if (status === "Stopped") return `<span class="badge badge-stopped">Stopped</span>`;
  if (["Stopping", "Publishing", "Started"].includes(status)) return `<span class="badge badge-working">${esc(status)}</span>`;
  return `<span class="badge badge-stopped">${esc(status || "Unknown")}</span>`;
}

function typeBadge(type) {
  if (type === "virtual-machine") return `<span class="badge badge-vm">VM</span>`;
  if (type === "container") return `<span class="badge badge-container">Container</span>`;
  if (type === "snapshot") return `<span class="badge badge-working">Snapshot</span>`;
  return `<span class="badge badge-container">${esc(type || "")}</span>`;
}


function localPublishStateBadge(job) {
  const state = String(job?.state || "PUBLISHING").replaceAll("_", " ");
  return `<span class="job-badge"><span class="spinner"></span> ${esc(state)}…</span>`;
}

function jobBadge(job) {
  const state = String(job?.state || "WORKING").replaceAll("_", " ");

  if (job?.type === "local-publish") {
    if (job.state === "FAILED") return `<span class="job-badge error">FAILED</span>`;
    return `<span class="job-badge"><span class="spinner"></span> ${esc(state)}…</span>`;
  }

  const pct = Number.isFinite(job?.progress) ? ` ${job.progress}%` : "";
  return `<span class="job-badge"><span class="spinner"></span> ${esc(state)}${pct}</span>`;
}

function sortBy(table, key) {
  if (sortState[table].key === key) {
    sortState[table].direction = sortState[table].direction === "asc" ? "desc" : "asc";
  } else {
    sortState[table].key = key;
    sortState[table].direction = "asc";
  }
  renderAll();
}

function sortRows(rows, table) {
  const { key, direction } = sortState[table];
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];

    if (typeof av === "number" && typeof bv === "number") {
      return direction === "asc" ? av - bv : bv - av;
    }

    av = norm(av);
    bv = norm(bv);

    if (av < bv) return direction === "asc" ? -1 : 1;
    if (av > bv) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

function toggleSnapshots(remote, name) {
  const key = `${remote}:${name}`;
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  renderContainers();
}

function renderContainers() {
  const tbody = document.getElementById("containers");
  const search = norm(document.getElementById("containerSearch").value);
  tbody.innerHTML = "";

  const rows = sortRows(containersData.filter(c => JSON.stringify(c).toLowerCase().includes(search)), "containers");

  for (const c of rows) {
    const key = `${c.remote}:${c.name}`;
    const aliasId = `alias-${c.remote}-${c.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const snapshotCount = (c.snapshots || []).length;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="remote">${esc(c.remote)}</td>
      <td>
        <span class="toggle" onclick="toggleSnapshots('${esc(c.remote)}','${esc(c.name)}')">${expanded.has(key) ? "▾" : "▸"}</span>
        ${esc(c.name)}
        <span class="${snapshotCount ? "small" : "no-snapshots"}">${snapshotCount ? `(${snapshotCount})` : ""}</span>
      </td>
      <td>${statusBadge(c.status)}</td>
      <td>${typeBadge(c.type)}</td>
      <td><input class="alias-input" id="${aliasId}" value="${esc(c.alias)}" onfocus="editing=true" onblur="editing=false" oninput="updateContainerAlias('${esc(c.remote)}','${esc(c.name)}',this.value)"></td>
      <td>
        ${
          activePublishByTarget.get(`${c.remote}:${c.name}`)
          ? jobBadge(activePublishByTarget.get(`${c.remote}:${c.name}`))
          : `<button onclick="publishImage('${esc(c.remote)}','${esc(c.name)}','${aliasId}','')">Publish</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);

    if (expanded.has(key)) {
      for (const snap of c.snapshots || []) {
        const snapAliasId = `alias-${c.remote}-${c.name}-${snap.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        const defaultSnapAlias = `${c.name.toLowerCase()}-${snap.name.toLowerCase()}-image`;

        const sr = document.createElement("tr");
        sr.className = "snapshot-row";
        sr.innerHTML = `
          <td></td>
          <td class="snapshot-name">↳ ${esc(snap.name)}</td>
          <td class="small">${snap.created_at ? new Date(snap.created_at).toLocaleString() : ""}</td>
          <td>${typeBadge("snapshot")}</td>
          <td><input class="alias-input" id="${snapAliasId}" value="${esc(defaultSnapAlias)}" onfocus="editing=true" onblur="editing=false"></td>
          <td>
            ${
              activePublishByTarget.get(`${c.remote}:${c.name}/${snap.name}`)
              ? jobBadge(activePublishByTarget.get(`${c.remote}:${c.name}/${snap.name}`))
              : `<button class="smallbtn" onclick="publishImage('${esc(c.remote)}','${esc(c.name)}','${snapAliasId}','${esc(snap.name)}')">Publish Snapshot</button>`
            }
          </td>
        `;
        tbody.appendChild(sr);
      }
    }
  }
  updateStats();
}

function renderImages() {
  const tbody = document.getElementById("images");
  const search = norm(document.getElementById("imageSearch").value);
  tbody.innerHTML = "";

  const rows = sortRows(imagesData.filter(i => JSON.stringify(i).toLowerCase().includes(search)), "images");

  for (const img of rows) {
    const aliasId = `imgalias-${img.fingerprint}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const descId = `imgdesc-${img.fingerprint}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const activeJob = activePushByFingerprint.get(img.fingerprint);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="remote">${esc(img.remote)}</td>
      <td><input class="image-alias-input" id="${aliasId}" value="${esc(img.alias || "")}" placeholder="alias" onfocus="editing=true" onblur="editing=false" oninput="updateImageAliasDraft('${img.fingerprint}', this.value)" onkeydown="if(event.key==='Enter') renameLocalAlias('${esc(img.remote)}','${esc(img.alias)}','${aliasId}','${img.fingerprint}')"></td>
      <td class="small" title="${esc(img.fingerprint)}">${esc(img.fingerprint.substring(0, 12))}</td>
      <td><input class="description-input" id="${descId}" value="${esc(img.description || "")}" onfocus="editing=true" onblur="editing=false" oninput="updateImageDescriptionDraft('${img.fingerprint}', this.value)" onkeydown="if(event.key==='Enter') updateLocalDescription('${esc(img.remote)}','${img.fingerprint}','${descId}')"></td>
      <td>${esc(img.architecture)}</td>
      <td>${sizeMiB(img.size)}</td>
      <td>${typeBadge(img.type)}</td>
      <td>
        ${
          activeJob
          ? jobBadge(activeJob)
          : `
            <button class="repo" onclick="pushRepo('${esc(img.remote)}','${img.fingerprint}','${aliasId}','${descId}')">Push</button>
            <button class="danger" onclick="deleteLocalImage('${esc(img.remote)}','${img.fingerprint}')">Delete</button>
          `
        }
      </td>
    `;
    tbody.appendChild(tr);
  }
  updateStats();
}

function renderRepo() {
  const tbody = document.getElementById("repoImages");
  const search = norm(document.getElementById("repoSearch").value);
  tbody.innerHTML = "";

  const rows = sortRows(repoData.filter(i => JSON.stringify(i).toLowerCase().includes(search)), "repo");

  for (const img of rows) {
    const aliasId = `repoalias-${img.fingerprint}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const descId = `repodesc-${img.fingerprint}`.replace(/[^a-zA-Z0-9_-]/g, "_");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="remote">${esc(img.remote)}</td>
      <td><input class="image-alias-input" id="${aliasId}" value="${esc(img.alias || "")}" onfocus="editing=true" onblur="editing=false" oninput="updateRepoAliasDraft('${img.fingerprint}', this.value)" onkeydown="if(event.key==='Enter') updateRepoMetadata('${img.fingerprint}','${esc(img.alias)}','${aliasId}','${descId}')"></td>
      <td class="small" title="${esc(img.fingerprint)}">${esc(img.fingerprint.substring(0, 12))}</td>
      <td><input class="description-input" id="${descId}" value="${esc(img.description || "")}" onfocus="editing=true" onblur="editing=false" oninput="updateRepoDescriptionDraft('${img.fingerprint}', this.value)" onkeydown="if(event.key==='Enter') updateRepoMetadata('${img.fingerprint}','${esc(img.alias)}','${aliasId}','${descId}')"></td>
      <td>${esc(img.architecture)}</td>
      <td>${sizeMiB(img.size)}</td>
      <td>${typeBadge(img.type)}</td>
      <td><button class="danger" onclick="deleteRepoImage('${img.fingerprint}')">Delete</button></td>
    `;
    tbody.appendChild(tr);
  }
  updateStats();
}

function renderAll() {
  renderContainers();
  renderImages();
  renderRepo();
  updateStats();
}

function updateContainerAlias(remote, name, value) {
  const item = containersData.find(c => c.remote === remote && c.name === name);
  if (item) item.alias = value;
}

function updateImageAliasDraft(fingerprint, value) {
  const item = imagesData.find(i => i.fingerprint === fingerprint);
  if (item) item.alias = value;
}

function updateImageDescriptionDraft(fingerprint, value) {
  const item = imagesData.find(i => i.fingerprint === fingerprint);
  if (item) item.description = value;
}

function updateRepoAliasDraft(fingerprint, value) {
  const item = repoData.find(i => i.fingerprint === fingerprint);
  if (item) item.alias = value;
}

function updateRepoDescriptionDraft(fingerprint, value) {
  const item = repoData.find(i => i.fingerprint === fingerprint);
  if (item) item.description = value;
}

async function loadContainers() {
  const res = await fetch("/api/containers");
  const data = await res.json();
  if (!Array.isArray(data)) return;

  containersData = data.map(c => {
    const existing = containersData.find(x => x.remote === c.remote && x.name === c.name);
    return { ...c, alias: existing?.alias || `${c.name.toLowerCase()}-image` };
  });

  renderContainers();
}

async function loadImages() {
  const res = await fetch("/api/images");
  const data = await res.json();
  if (!Array.isArray(data)) return;

  imagesData = data.map(img => {
    const existing = imagesData.find(x => x.fingerprint === img.fingerprint);
    return {
      ...img,
      alias: existing?.alias ?? ((img.aliases || [])[0] || ""),
      description: existing?.description ?? (img.description || "")
    };
  });

  renderImages();
}

async function loadRepo(options = {}) {
  if (!options.silent) setStatus("Refreshing simplestreams repository...", "working");

  const res = await fetch("/api/repo/images");
  const data = await res.json();

  if (!Array.isArray(data)) {
    setStatus("Repo load failed: " + (data.stderr || data.error || "Unknown error"), "error");
    return false;
  }

  repoData = data.map(img => ({
    ...img,
    alias: img.alias || ((img.aliases || [])[0] || ""),
    description: img.description || ""
  }));

  renderRepo();

  if (!options.silent && !isBusy()) setStatus("Ready.", "ready");
  return true;
}


function forceInlineLocalPublishJobs(jobs) {
  const activeLocalPublishes = (jobs || []).filter(job =>
    job &&
    job.type === "local-publish" &&
    !["COMPLETE", "FAILED"].includes(job.state)
  );

  for (const job of activeLocalPublishes) {
    const alias = job.data?.alias;
    const remote = job.data?.remote || "";
    const container = job.data?.container || "";
    const snapshot = job.data?.snapshot || "";

    if (!alias || !remote || !container) continue;

    const inputs = Array.from(document.querySelectorAll("input"));
    const matchingInputs = inputs.filter(el => el.value === alias);

    const localImageExists = matchingInputs.some(el => {
      const row = el.closest("tr");
      return row && row.closest("#localImagesBody, #imagesBody, tbody") && !row.innerText.includes("Publish Snapshot");
    }) && matchingInputs.length >= 2;

    const publishInput = matchingInputs.find(el => {
      const row = el.closest("tr");
      return row && row.innerText.includes(container);
    }) || matchingInputs[0];

    if (!publishInput) continue;

    const row = publishInput.closest("tr");
    if (!row) continue;

    const cells = row.querySelectorAll("td");
    const actionCell = cells[cells.length - 1];
    if (!actionCell) continue;

    if (localImageExists) {
      const aliasId = publishInput.id;

      if (snapshot) {
        actionCell.innerHTML =
          `<button class="smallbtn" onclick="publishImage('${remote}','${container}','${aliasId}','${snapshot}')">Publish Snapshot</button>`;
      } else {
        actionCell.innerHTML =
          `<button onclick="publishImage('${remote}','${container}','${aliasId}','')">Publish</button>`;
      }

      continue;
    }

    actionCell.innerHTML = localPublishStateBadge(job);
  }
}

async function loadJobs() {
  const __beforeLocalPublishStatusPatch = true;
  const res = await fetch("/api/jobs");
  const data = await res.json();
  if (!Array.isArray(data)) return;

  jobsData = data;
  activePushByFingerprint = new Map();

  let newlyCompleted = null;
  let newlyFailed = null;

  for (const job of jobsData) {
    const oldState = lastJobStates.get(job.id);
    lastJobStates.set(job.id, job.state);

    if (oldState && oldState !== job.state && job.state === "COMPLETE") {
      newlyCompleted = job;
    }

    if (oldState && oldState !== job.state && job.state === "FAILED") {
      newlyFailed = job;
    }

    if (job.type === "repo-push" && job.data?.fingerprint) {
      if (!["COMPLETE", "FAILED"].includes(job.state)) {
        activePushByFingerprint.set(job.data.fingerprint, job);
      }
    }

    if (job.type === "local-publish" && job.data?.remote && job.data?.container) {
      if (!["COMPLETE", "FAILED"].includes(job.state)) {
        const key = job.data.snapshot
          ? `${job.data.remote}:${job.data.container}/${job.data.snapshot}`
          : `${job.data.remote}:${job.data.container}`;
        activePublishByTarget.set(key, job);
      }
    }
  }

  const active = jobsData.filter(j => !["COMPLETE", "FAILED"].includes(j.state));

  if (newlyCompleted) {
    if (newlyCompleted.type === "repo-push") {
      setStatus(newlyCompleted.message || "Push job completed.", "ready");
    }

    if (newlyCompleted.type === "repo-push") {
      await loadRepo({ silent: true });
      await loadImages();
    } else if (newlyCompleted.type === "local-publish") {
      await loadImages();
      await loadContainers();
    } else {
      await loadImages();
    }
  } else if (newlyFailed) {
    setStatus(newlyFailed.message || "Push job failed.", "error");
  } else if (active.length) {
    const j = active[0];
    setStatus(j.message || `${j.state}...`, "working");
  } else {
    const bar = document.getElementById("statusbar");
    if (!bar.classList.contains("error")) {
      setStatus("Ready.", "ready");
    }
  }

  renderImages();
}

async function showHealth() {
  setStatus("Checking SimpleStreams server health...", "working");
  const res = await fetch("/api/repo/health");
  const data = await res.json();

  const panel = document.getElementById("repoPanel");
  const title = document.getElementById("repoPanelTitle");
  const content = document.getElementById("repoPanelContent");

  title.textContent = "SimpleStreams Health Check";
  panel.classList.remove("hidden");

  if (!data.checks) {
    content.innerHTML = `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    setStatus("Health check failed.", "error");
    return;
  }

  content.innerHTML = `
    <div class="health-grid">
      ${data.checks.map(c => `
        <div class="health-item">
          <span>${esc(c.name)}</span>
          <span class="badge ${c.ok ? "badge-ok" : "badge-bad"}">${c.ok ? "OK" : "FAIL"}</span>
        </div>
      `).join("")}
    </div>
  `;

  setStatus(data.ok ? "SimpleStreams health check passed." : "SimpleStreams health check found issues.", data.ok ? "ready" : "error");
}

async function showBootstrap() {
  setStatus("Loading SimpleStreams bootstrap commands...", "working");
  const res = await fetch("/api/repo/bootstrap");
  const data = await res.json();

  const panel = document.getElementById("repoPanel");
  const title = document.getElementById("repoPanelTitle");
  const content = document.getElementById("repoPanelContent");

  title.textContent = "SimpleStreams Bootstrap Commands";
  panel.classList.remove("hidden");

  content.innerHTML = `<pre>${esc((data.commands || []).join("\n"))}</pre>`;
  setStatus("Bootstrap commands loaded.", "ready");
}

async function publishImage(remote, container, aliasId, snapshot) {
  const alias = document.getElementById(aliasId).value.trim();
  if (!alias) return setStatus("Alias is required.", "error");

  setStatus(
    snapshot
      ? `Queueing snapshot publish job for ${remote}:${container}/${snapshot}...`
      : `Queueing publish job for ${remote}:${container}...`,
    "working"
  );

  const result = await apiPost("/api/publish", { remote, container, alias, snapshot });

  if (!result.ok) {
    setStatus(`Publish queue failed: ${result.error || result.stderr || "Unknown error"}`, "error");
    return;
  }

  setStatus(`Publish job queued for ${alias}. Watch the row state indicator.`, "working");

  if (typeof loadJobs === "function") {
    await loadJobs();
  }
}

async function renameLocalAlias(remote, oldAlias, aliasId, fingerprint) {
  const newAlias = document.getElementById(aliasId).value.trim();
  if (!newAlias) return setStatus("Alias cannot be blank.", "error");

  setStatus(oldAlias ? `Renaming alias ${oldAlias} to ${newAlias}...` : `Creating alias ${newAlias}...`, "working");

  const result = await apiPost("/api/image/alias/rename", { remote, oldAlias, newAlias, fingerprint });

  if (result.ok) {
    setStatus(oldAlias ? `Alias updated to ${newAlias}.` : `Alias created as ${newAlias}.`, "ready");
    await loadImages();
  } else {
    setStatus(`Alias update failed: ${result.stderr || result.error || "Unknown error"}`, "error");
  }
}

async function updateLocalDescription(remote, fingerprint, descId) {
  const description = document.getElementById(descId).value;
  setStatus("Updating image description...", "working");

  const result = await apiPost("/api/image/description", { remote, fingerprint, description });

  if (result.ok) {
    setStatus("Description updated.", "ready");
    await loadImages();
  } else {
    setStatus(`Description update failed: ${result.stderr || result.error || "Unknown error"}`, "error");
  }
}

async function deleteLocalImage(remote, fingerprint) {
  if (!confirm(`Delete local image ${fingerprint.substring(0, 12)}?`)) return;

  setStatus(`Deleting local image ${fingerprint.substring(0, 12)}...`, "working");
  const result = await apiPost("/api/image/delete", { remote, fingerprint });

  if (result.ok) {
    setStatus("Local image deleted.", "ready");
    await loadImages();
  } else {
    setStatus(`Delete failed: ${result.stderr || result.error || "Unknown error"}`, "error");
  }
}

async function pushRepo(remote, fingerprint, aliasId, descId) {
  const currentAlias = document.getElementById(aliasId).value.trim() || fingerprint.substring(0, 12);
  const description = document.getElementById(descId).value;
  const finalAlias = prompt("Simplestreams alias:", currentAlias);

  if (!finalAlias) return;

  setStatus(`Queueing push job for ${finalAlias}...`, "working");

  const result = await apiPost("/api/repo/push", {
    remote,
    fingerprint,
    alias: finalAlias,
    description
  });

  if (!result.ok) {
    setStatus(`Push queue failed: ${result.stderr || result.error || "Unknown error"}`, "error");
    return;
  }

  setStatus(`Push job queued for ${finalAlias}.`, "working");
  await loadJobs();
}

async function updateRepoMetadata(fingerprint, oldAlias, aliasId, descId) {
  const newAlias = document.getElementById(aliasId).value.trim();
  const description = document.getElementById(descId).value;

  setStatus("Updating simplestreams metadata...", "working");

  const result = await apiPost("/api/repo/metadata", { fingerprint, oldAlias, newAlias, description });

  if (result.ok) {
    setStatus("Repository metadata updated.", "ready");
    await loadRepo();
  } else {
    setStatus(`Repository metadata update failed: ${result.stderr || result.error || "Unknown error"}`, "error");
  }
}

async function deleteRepoImage(fingerprint) {
  if (!confirm(`Delete repository image ${fingerprint.substring(0, 12)}?`)) return;

  setStatus(`Deleting repository image ${fingerprint.substring(0, 12)}...`, "working");
  const img = repoData.find(i => i.fingerprint === fingerprint);
  const result = await apiPost("/api/repo/delete", {
    fingerprint,
    alias: img?.alias || ""
  });

  if (result.ok) {
    setStatus("Repository image deleted.", "ready");
    await loadRepo();
  } else {
    setStatus(`Repository delete failed: ${result.stderr || result.error || "Unknown error"}`, "error");
  }
}

async function refresh() {
  if (isBusy() || editing) return;

  await loadContainers();
  await loadImages();
  await loadRepo({ silent: true });
  await loadJobs();

  const active = jobsData.filter(j => !["COMPLETE", "FAILED"].includes(j.state));
  if (!active.length) {
    const bar = document.getElementById("statusbar");
    if (!bar.classList.contains("error")) {
      setStatus("Ready.", "ready");
    }
  }
}

document.querySelectorAll("[data-sort-table]").forEach(th => {
  th.addEventListener("click", () => sortBy(th.dataset.sortTable, th.dataset.sortKey));
});

document.getElementById("containerSearch").addEventListener("input", renderContainers);
document.getElementById("imageSearch").addEventListener("input", renderImages);
document.getElementById("repoSearch").addEventListener("input", renderRepo);
document.getElementById("repoRefresh").addEventListener("click", () => loadRepo());
document.getElementById("repoHealth").addEventListener("click", showHealth);
document.getElementById("repoBootstrap").addEventListener("click", showBootstrap);
document.getElementById("repoPanelClose").addEventListener("click", () => document.getElementById("repoPanel").classList.add("hidden"));

refresh();
setInterval(refresh, 30000);
setInterval(loadJobs, 2000);

// Final local-publish UI cleanup.
// Local image publish has no real percentage, so never show one.
// If the image alias appears in Local Images, clear stale publish badges automatically.
setInterval(() => {
  const inputs = Array.from(document.querySelectorAll("input"));
  const localAliases = new Set();

  for (const input of inputs) {
    const row = input.closest("tr");
    if (!row) continue;

    if (row.innerText.includes("Push") && row.innerText.includes("Delete")) {
      localAliases.add(input.value);
    }
  }

  for (const input of inputs) {
    const row = input.closest("tr");
    if (!row) continue;

    const text = row.innerText || "";
    if (!text.includes("PUBLISHING") && !text.includes("VERIFYING") && !text.includes("STOPPING") && !text.includes("STARTING")) continue;

    const alias = input.value;
    if (!localAliases.has(alias)) {
      const actionCell = row.querySelector("td:last-child");
      if (actionCell) {
        actionCell.innerHTML = '<span class="job-badge"><span class="spinner"></span> PUBLISHING…</span>';
      }
      continue;
    }

    const actionCell = row.querySelector("td:last-child");
    if (!actionCell) continue;

    actionCell.innerHTML = `<button onclick="publishImage('${row.children[0].innerText.trim()}','${row.children[1].innerText.replace("▸","").replace("▾","").trim().split(" ")[0]}','${input.id}','')">Publish</button>`;
  }
}, 1000);
