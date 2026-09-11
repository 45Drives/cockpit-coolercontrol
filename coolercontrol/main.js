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
  } catch {
    return false;
  }
}

async function waitForDaemonResponse() {
  pushError(_("Waiting for daemon response"));
  let seconds = 0;
  await new Promise((resolve) => {
    const interval = window.setInterval(async () => {
      displayError(_("Waiting for service") + ".".repeat((seconds++ % 20) + 1));
      if (await daemonResponsive()) {
        window.clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
  popError();
}

let resolvedAfterServiceStart = undefined;
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
  resolvedAfterServiceStart?.();
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
  startButton.onclick = () => startService();
  enableButton.onclick = () => startService(true);
  enableButton.hidden = enabled;
  await new Promise((resolve) => (resolvedAfterServiceStart = resolve));
  popError();
}

async function loadIframe() {
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
  if (theme === "light" || theme === "dark") {
    iframe.style.colorScheme = theme;
  } else {
    iframe.style.removeProperty("color-scheme");
  }
}

cockpit.addEventListener("themechanged", updateColorScheme);
updateColorScheme();

await loadIframe();
