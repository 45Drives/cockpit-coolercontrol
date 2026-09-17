const _ = cockpit.gettext;

const COOLERCONTROL_PORT = 11987;

const CoolercontrolUrl = new URL(cockpit.transport.origin);
CoolercontrolUrl.port = COOLERCONTROL_PORT;

/**
 * @type {HTMLIFrameElement}
 */
const iframe = document.getElementById("coolercontrol-iframe");
if (!iframe) {
  throw new Error("Failed to get iframe");
}

const errorMessageDiv = document.getElementById("error-message");
if (!errorMessageDiv) {
  throw new Error("Failed to get errorMessageDiv");
}

function displayError(text, html = false) {
  if (html) {
    errorMessageDiv.innerHTML = text;
  } else {
    errorMessageDiv.innerText = text;
  }
  iframe.hidden = true;
  errorMessageDiv.hidden = false;
}

function hideError() {
  errorMessageDiv.hidden = true;
  iframe.hidden = false;
  errorMessageDiv.innerText = undefined;
}

const errorStack = [];
function pushError(text, html = false) {
  errorStack.push({ text, html });
  displayError(text, html);
}

function popError() {
  errorStack.pop();
  if (errorStack.length) {
    const { text, html } = errorStack[errorStack.length - 1];
    displayError(text, html);
  } else {
    hideError();
  }
}

// window.onerror = (error) => {
//   displayError(error.message ?? error);
//   return error;
// };

async function requestAdministrativeAccess() {
  pushError(
    _(
      "Administrative access required. Please click '\uD83D\uDD12Limited access' in the above banner to enable.",
    ),
  );
  await new Promise((resolve) => {
    const permission = cockpit.permission({ admin: true });
    permission.addEventListener("changed", () => {
      if (permission.allowed) {
        resolve();
        permission.close();
      }
    });
  });
  popError();
}

async function hasAdministrativeAccess() {
  const allowed = await new Promise((resolve) => {
    const permission = cockpit.permission({ admin: true });
    permission.addEventListener("changed", () => {
      resolve(permission.allowed);
      permission.close();
    });
  });
  return allowed;
}

async function requireAdministrativeAccess() {
  if (!(await hasAdministrativeAccess())) {
    await requestAdministrativeAccess();
  }
}

async function verifySession() {
  const response = await fetch(`${CoolercontrolUrl.origin}/verify-session`, {
    method: "POST",
    credentials: "include",
  });
  return response.ok;
}

async function login(password) {
  const response = await fetch(`${CoolercontrolUrl.origin}/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${window.btoa(`CCAdmin:${password}`)}`,
    },
    credentials: "include",
  });
  return response.ok;
}

async function resetPassword(newPassword) {
  const defaultPassword = "coolAdmin";

  await requireAdministrativeAccess();

  try {
    await cockpit.spawn(["coolercontrold", "--reset-password"], {
      superuser: "require",
    });
  } catch (error) {
    throw new Error(
      `${_("Failed to set temporary password")}: ${error.message}`,
    );
  }

  // get cookie
  if (!(await login(defaultPassword))) {
    throw new Error("Failed to authorize with default password");
  }

  const response = await fetch(`${CoolercontrolUrl.origin}/set-passwd`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${window.btoa(`CCAdmin:${newPassword}`)}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      current_password: defaultPassword,
    }),
  });

  if (!response.ok) {
    throw new Error(
      _("Failed to set new password") + `: ${await response.text()}`,
    );
  }
}

async function generateSecurePassword(length = 128) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function serviceIsEnabled() {
  try {
    await cockpit.spawn(["systemctl", "is-enabled", "coolercontrold"], {
      superuser: "try",
    });
    return true;
  } catch {
    return false;
  }
}

async function serviceIsActive() {
  try {
    await cockpit.spawn(["systemctl", "is-active", "coolercontrold"], {
      superuser: "try",
    });
    return true;
  } catch {
    return false;
  }
}

async function daemonResponsive() {
  try {
    const response = await fetch(`${CoolercontrolUrl.origin}/handshake`, {
      method: "GET",
    });
    return response.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function waitForDaemonResponse() {
  pushError(_("Waiting for daemon response"));
  document.body.style.cursor = "wait";
  let seconds = 0;
  await new Promise((resolve) => {
    const interval = window.setInterval(async () => {
      displayError(
        _("Waiting for daemon response") + ".".repeat((seconds++ % 20) + 1),
      );
      if (await daemonResponsive()) {
        window.clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
  document.body.style.cursor = undefined;
  popError();
}

async function startService(enable) {
  await requireAdministrativeAccess();
  await cockpit.spawn(
    [
      "systemctl",
      ...(enable ? ["enable", "--now"] : ["start"]),
      "coolercontrold",
    ],
    {
      superuser: "require",
    },
  );
}

async function stopService() {
  await requireAdministrativeAccess();
  await cockpit.spawn(["systemctl", "stop", "coolercontrold"], {
    superuser: "require",
  });
}

async function promptToStartService() {
  const enabled = await serviceIsEnabled();
  pushError(
    `
    <div class="flex flex-row items-baseline gap-1">
    <span class="grow">
    ${enabled ? _("coolercontrold.service is not running.") : _("coolercontrold.service is not enabled.")}
    </span>
    <button id="startServiceButton">${_("Start")}</button>
    <button id="enableServiceButton">${_("Start at every boot")}</button>
    </div>
    `,
    true,
  );
  const startButton = document.getElementById("startServiceButton");
  const enableButton = document.getElementById("enableServiceButton");
  enableButton.hidden = enabled;
  await new Promise((resolve) => {
    startButton.onclick = () => {
      resolve();
      startService();
    };
    enableButton.onclick = () => {
      resolve();
      startService(true);
    };
  });
  popError();
}

async function ensureCorsConfig() {
  /**
   *
   * @param {string} config full config text
   * @param {string} section desired section name
   */
  const tomlGetSectionBounds = (config, section) => {
    const headerMatch = new RegExp(`^\\[${section}\\].*$`, "m").exec(config);
    if (headerMatch === null) {
      return null;
    }
    const sectionStart = headerMatch.index + headerMatch[0].length;
    const sectionEnd = config.indexOf("\n[", sectionStart);
    if (sectionEnd === -1) {
      return [sectionStart, config.length];
    }
    return [sectionStart, sectionEnd];
  };
  /**
   *
   * @param {string} config full config text
   * @param {string} section desired section name
   */
  const tomlGetSection = (config, section) => {
    const result = tomlGetSectionBounds(config, section);
    if (result === null) {
      return null;
    }
    const [start, end] = result;
    return config.slice(start, end);
  };
  /**
   *
   * @param {string} config full config text
   * @param {string} section desired section name
   * @param {string} newContent replacement text for section
   */
  const tomlSetSection = (config, section, newContent) => {
    const result = tomlGetSectionBounds(config, section);
    const [start, end] =
      result === null ? [config.length, config.length] : result;
    return (
      config.slice(0, start) +
      (result === null ? `[${section}]\n` : "") +
      newContent +
      config.slice(end)
    );
  };
  /**
   *
   * @param {string} config full config text
   * @param {string} section desired section name
   * @param {(content: string) => string} replacer callback
   */
  const tomlModifySection = (config, section, replacer) => {
    return tomlSetSection(
      config,
      section,
      replacer(tomlGetSection(config, section) ?? ""),
    );
  };
  const containsCorsOrigin = (config) => {
    const settingsText = tomlGetSection(config, "settings");
    if (!settingsText) {
      return false;
    }
    const originsLine = /^origins\s*=\s*(?<array>\[[^\]]+\])/m.exec(
      settingsText,
    );
    if (!originsLine) {
      return false;
    }
    /**
     * @type {Array<string>}
     */
    const origins = JSON.parse(originsLine.groups["array"]);
    console.log("origins:", origins);
    return origins.includes(cockpit.transport.origin);
  };
  const file = cockpit.file("/etc/coolercontrol/config.toml", {
    superuser: "try",
  });
  const containsOrigin = await file
    .read()
    .then(async (content) => {
      if (content === null) {
        // config DNE, create it
        await requireAdministrativeAccess();
        pushError(_("First time config setup..."));
        const proc = cockpit.script(
          `
coproc DAEMON { exec coolercontrold 2>&1; }
daemon_pid=$DAEMON_PID
(
  sleep 20
  echo Force killing coolercontrold after timeout
  kill "$daemon_pid" 2>/dev/null
) &
timeout_pid=$!

while IFS= read -r line; do
  printf '%s\n' "$line"

  if [[ $line == *"Configuration file check successful"* ]]; then
    echo Killing daemon
    kill "$daemon_pid" 2>/dev/null
  fi
done <&"\${DAEMON[0]}"

kill "$timeout_pid" 2>/dev/null || true
wait "$daemon_pid" 2>/dev/null || true
wait "$timeout_pid" 2>/dev/null || true
          `,
          [],
          {
            superuser: "require",
          },
        );
        proc.stream((output) => console.log(output));
        await proc;
        popError();
        return await file.read();
      }
      return content;
    })
    .then((content) => containsCorsOrigin(content))
    .catch((error) => {
      console.error(error);
      return false;
    });
  if (containsOrigin) {
    console.log("CORS configured properly");
    return;
  }
  await requireAdministrativeAccess();
  console.log("Configuring CORS");
  pushError(_("Configuring CORS..."));
  const serviceWasActive = await serviceIsActive();
  if (serviceWasActive) {
    await stopService();
  }
  await file.modify((config) => {
    return tomlModifySection(config, "settings", (settingsText) => {
      let originsLine = /^origins\s*=\s*(?<array>\[[^\]]+\]).*$/m.exec(
        settingsText,
      );
      if (!originsLine) {
        const newOriginsLineText = `
origins = [${JSON.stringify(cockpit.transport.origin)}]
`;
        const originsLineCommentRe = /^#\s*origins\s*=\s*\[.*$/m;
        if (originsLineCommentRe.test(settingsText)) {
          return settingsText.replace(originsLineCommentRe, newOriginsLineText);
        }
        return settingsText + newOriginsLineText;
      }
      /**
       * @type {Array<string>}
       */
      const origins = JSON.parse(originsLine.groups["array"]);
      origins.push(cockpit.transport.origin);
      return settingsText.replace(
        originsLine[0],
        `origins = ${JSON.stringify(origins)}`,
      );
    });
  });
  if (serviceWasActive) {
    await startService();
  }
  popError();
}

async function loadIframe() {
  await ensureCorsConfig();
  if (!(await daemonResponsive())) {
    if (!(await serviceIsActive())) {
      await promptToStartService();
    }
    await waitForDaemonResponse();
  }
  if (!(await verifySession())) {
    console.log("Resetting password");
    const password = await generateSecurePassword();
    await resetPassword(password);
    await login(password);
  }
  iframe.src = CoolercontrolUrl.href;
}

function updateColorScheme() {
  const theme = cockpit.theme;
  console.log("updating theme to", theme);
  if (theme === "light" || theme === "dark") {
    iframe.style.colorScheme = theme;
  } else {
    iframe.style.removeProperty("color-scheme");
  }
}

cockpit.addEventListener("themechanged", updateColorScheme);
updateColorScheme();

await loadIframe();
