const DEFAULT_BACKEND_ORIGIN = "https://bompton.vercel.app";

const $ = (id) => document.getElementById(id);
const backendOriginInput = $("backendOrigin");
const bearerTokenInput = $("bearerToken");
const saveButton = $("save");
const clearButton = $("clear");
const syncButton = $("sync");
const testButton = $("test");
const configStatus = $("configStatus");
const connectionResult = $("connectionResult");
const lastSync = $("lastSync");
const perPlaylist = $("perPlaylist");
const errorCard = $("errorCard");
const errorText = $("errorText");
const versionLabel = $("version");
const setupLink = $("setupLink");

async function loadState() {
  const { backendOrigin, bearerToken } = await chrome.storage.local.get([
    "backendOrigin",
    "bearerToken",
  ]);
  backendOriginInput.value = backendOrigin || DEFAULT_BACKEND_ORIGIN;
  bearerTokenInput.value = bearerToken || "";
  setupLink.href = `${backendOriginInput.value.replace(/\/$/, "")}/extension-setup`;
  await refreshStatus();
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: "get-status" });
  if (!response?.ok) {
    configStatus.textContent = response?.error ?? "Couldn't read status.";
    return;
  }
  const s = response.status;
  versionLabel.textContent = `v${s.version}`;
  setupLink.href = `${(s.backendOrigin || DEFAULT_BACKEND_ORIGIN).replace(/\/$/, "")}/extension-setup`;

  if (!s.hasToken) {
    configStatus.textContent =
      "No auth token saved. Generate one at /extension-setup and paste it above.";
  } else {
    configStatus.textContent = `Token saved. Backend: ${s.backendOrigin}`;
  }

  if (s.lastSyncAt) {
    lastSync.textContent = `Last sync ${new Date(s.lastSyncAt).toLocaleString()} (${s.lastSyncResult?.trigger ?? "?"} trigger)`;
  } else {
    lastSync.textContent = s.lastRunAt
      ? `Attempted ${new Date(s.lastRunAt).toLocaleString()} · no result yet`
      : "Never synced.";
  }

  perPlaylist.innerHTML = "";
  if (s.lastSyncResult?.perPlaylist?.length) {
    for (const entry of s.lastSyncResult.perPlaylist) {
      const el = document.createElement("div");
      el.className = "row-item";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = `${entry.year} · ${entry.name ?? entry.id}`;
      el.appendChild(title);
      if (entry.error) {
        const err = document.createElement("div");
        err.className = "err";
        err.textContent = entry.error;
        el.appendChild(err);
      } else {
        const detail = document.createElement("div");
        detail.className = "detail";
        detail.textContent = entry.snapshotChanged
          ? `snapshot changed · ${entry.tracksWritten} tracks written`
          : "snapshot unchanged · skipped";
        el.appendChild(detail);
      }
      perPlaylist.appendChild(el);
    }
  }

  if (s.lastError) {
    errorCard.classList.remove("hidden");
    errorText.textContent = s.lastError;
  } else {
    errorCard.classList.add("hidden");
    errorText.textContent = "";
  }
}

async function save() {
  const origin = backendOriginInput.value.trim().replace(/\/$/, "") ||
    DEFAULT_BACKEND_ORIGIN;
  const token = bearerTokenInput.value.trim();
  await chrome.storage.local.set({
    backendOrigin: origin,
    bearerToken: token || null,
  });
  configStatus.textContent = "Saved.";
  await refreshStatus();
}

async function clearToken() {
  bearerTokenInput.value = "";
  await chrome.storage.local.set({ bearerToken: null });
  configStatus.textContent = "Token cleared.";
  await refreshStatus();
}

function setButtonsDisabled(disabled) {
  for (const button of [syncButton, testButton, saveButton, clearButton]) {
    button.disabled = disabled;
  }
}

async function syncNow() {
  setButtonsDisabled(true);
  configStatus.textContent = "Syncing… watch chrome://extensions service worker logs for detail.";
  const response = await chrome.runtime.sendMessage({ type: "sync-now" });
  setButtonsDisabled(false);
  if (!response?.ok) {
    configStatus.textContent = `Sync failed: ${response?.error ?? "unknown"}`;
  } else {
    configStatus.textContent = "Sync complete.";
  }
  await refreshStatus();
}

async function testConnection() {
  setButtonsDisabled(true);
  connectionResult.textContent = "Testing…";
  const response = await chrome.runtime.sendMessage({ type: "test-connection" });
  setButtonsDisabled(false);
  if (!response?.ok) {
    connectionResult.textContent = response?.error ?? "Connection failed.";
    return;
  }
  const { result } = response;
  connectionResult.textContent = `Connected as ${result.name ?? "(no name)"} <${result.email ?? "(no email)"}>`;
}

saveButton.addEventListener("click", save);
clearButton.addEventListener("click", clearToken);
syncButton.addEventListener("click", syncNow);
testButton.addEventListener("click", testConnection);

loadState();
