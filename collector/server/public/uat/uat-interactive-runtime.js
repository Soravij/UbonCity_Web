(() => {
  const config = window.__UAT_FORM_CONFIG__;
  if (!config || !config.role) {
    return;
  }

  const profileRegistryKey = `uat-interactive:${config.role}:profiles`;
  const legacyStorageKey = `uat-interactive:${config.role}`;
  const defaultProfile = "default";
  const saveState = document.querySelector("[data-save-state]");
  const printButton = document.querySelector("[data-print-button]");
  const resetButton = document.querySelector("[data-reset-button]");
  const sessionSelect = document.querySelector("[data-session-select]");
  const sessionInput = document.querySelector("[data-session-input]");
  const sessionCreateButton = document.querySelector("[data-session-create]");
  const sessionDeleteButton = document.querySelector("[data-session-delete]");
  const inputs = Array.from(document.querySelectorAll("[data-storage-key]"));
  let activeProfile = defaultProfile;

  function profileStorageKey(profileName) {
    return `uat-interactive:${config.role}:profile:${profileName}`;
  }

  function normalizeProfileName(raw) {
    const value = String(raw || "").trim().replace(/\s+/g, "-").toLowerCase();
    return value || "";
  }

  function readProfiles() {
    try {
      const raw = window.localStorage.getItem(profileRegistryKey);
      if (!raw) {
        return [defaultProfile];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [defaultProfile];
      }
      const normalized = parsed
        .map((item) => normalizeProfileName(item))
        .filter((item) => item.length > 0);
      if (!normalized.includes(defaultProfile)) {
        normalized.unshift(defaultProfile);
      }
      return Array.from(new Set(normalized));
    } catch {
      return [defaultProfile];
    }
  }

  function writeProfiles(nextProfiles) {
    window.localStorage.setItem(profileRegistryKey, JSON.stringify(nextProfiles));
  }

  function ensureLegacyMigration() {
    const legacy = window.localStorage.getItem(legacyStorageKey);
    if (!legacy) {
      return;
    }
    const currentDefault = window.localStorage.getItem(profileStorageKey(defaultProfile));
    if (!currentDefault) {
      window.localStorage.setItem(profileStorageKey(defaultProfile), legacy);
    }
    window.localStorage.removeItem(legacyStorageKey);
  }

  function renderProfileOptions(nextProfiles) {
    if (!sessionSelect) {
      return;
    }
    const current = sessionSelect.value || activeProfile;
    sessionSelect.innerHTML = "";
    for (const profile of nextProfiles) {
      const option = document.createElement("option");
      option.value = profile;
      option.textContent = profile;
      sessionSelect.appendChild(option);
    }
    sessionSelect.value = nextProfiles.includes(current) ? current : defaultProfile;
    activeProfile = sessionSelect.value;
  }

  function readState() {
    try {
      const raw = window.localStorage.getItem(profileStorageKey(activeProfile));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeState(nextState, message) {
    window.localStorage.setItem(profileStorageKey(activeProfile), JSON.stringify(nextState));
    if (saveState) {
      const timestamp = new Date().toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const profileLabel = `[${activeProfile}]`;
      saveState.textContent = message
        ? `${profileLabel} ${message} • ${timestamp}`
        : `${profileLabel} บันทึกอัตโนมัติ • ${timestamp}`;
    }
  }

  function applyState(state) {
    for (const input of inputs) {
      const key = input.dataset.storageKey;
      const value = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
      if (input.type === "radio") {
        input.checked = value === input.value;
      } else if (value !== null) {
        input.value = value;
      }
    }
    if (saveState && !window.localStorage.getItem(profileStorageKey(activeProfile))) {
      saveState.textContent = `[${activeProfile}] ยังไม่มีข้อมูลที่บันทึก`;
    }
  }

  function collectState() {
    const nextState = {};
    for (const input of inputs) {
      const key = input.dataset.storageKey;
      if (!key) {
        continue;
      }
      if (input.type === "radio") {
        if (input.checked) {
          nextState[key] = input.value;
        }
        continue;
      }
      if (input.value && input.value.length > 0) {
        nextState[key] = input.value;
      }
    }
    return nextState;
  }

  function saveNow(message) {
    writeState(collectState(), message);
  }

  for (const input of inputs) {
    const eventName = input.type === "radio" ? "change" : "input";
    input.addEventListener(eventName, () => saveNow(""));
  }

  if (printButton) {
    printButton.addEventListener("click", () => window.print());
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      const shouldReset = window.confirm(`ล้างข้อมูล checklist ของชุด [${activeProfile}] ใน role นี้ใช่หรือไม่`);
      if (!shouldReset) {
        return;
      }
      window.localStorage.removeItem(profileStorageKey(activeProfile));
      for (const input of inputs) {
        if (input.type === "radio") {
          input.checked = false;
        } else {
          input.value = "";
        }
      }
      if (saveState) {
        saveState.textContent = `[${activeProfile}] ล้างข้อมูลแล้ว`;
      }
    });
  }

  function switchProfile(profileName) {
    activeProfile = profileName;
    applyState(readState());
  }

  if (sessionSelect) {
    sessionSelect.addEventListener("change", () => {
      switchProfile(sessionSelect.value || defaultProfile);
    });
  }

  if (sessionCreateButton) {
    sessionCreateButton.addEventListener("click", () => {
      const rawName = sessionInput ? sessionInput.value : "";
      const profileName = normalizeProfileName(rawName);
      if (!profileName) {
        window.alert("กรุณาตั้งชื่อชุดใหม่");
        return;
      }
      const profiles = readProfiles();
      if (profiles.includes(profileName)) {
        window.alert("ชื่อชุดนี้มีอยู่แล้ว");
        return;
      }
      const nextProfiles = [...profiles, profileName];
      writeProfiles(nextProfiles);
      renderProfileOptions(nextProfiles);
      if (sessionInput) {
        sessionInput.value = "";
      }
      switchProfile(profileName);
    });
  }

  if (sessionDeleteButton) {
    sessionDeleteButton.addEventListener("click", () => {
      if (activeProfile === defaultProfile) {
        window.alert("ลบชุด default ไม่ได้");
        return;
      }
      const shouldDelete = window.confirm(`ลบชุด [${activeProfile}] ใช่หรือไม่`);
      if (!shouldDelete) {
        return;
      }
      window.localStorage.removeItem(profileStorageKey(activeProfile));
      const profiles = readProfiles().filter((item) => item !== activeProfile);
      writeProfiles(profiles);
      renderProfileOptions(profiles);
      switchProfile(sessionSelect ? sessionSelect.value : defaultProfile);
    });
  }

  ensureLegacyMigration();
  const profiles = readProfiles();
  writeProfiles(profiles);
  renderProfileOptions(profiles);
  switchProfile(activeProfile);
})();