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

// async function ensureCorsConfig() {
//   /**
//    *
//    * @param {string} config full config text
//    * @param {string} section desired section name
//    */
//   const tomlGetSectionBounds = (config, section) => {
//     const headerMatch = new RegExp(`^\\[${section}\\].*$`, "m").exec(config);
//     if (headerMatch === null) {
//       return null;
//     }
//     const sectionStart = headerMatch.index + headerMatch[0].length;
//     const sectionEnd = config.indexOf("\n[", sectionStart);
//     if (sectionEnd === -1) {
//       return [sectionStart, config.length];
//     }
//     return [sectionStart, sectionEnd];
//   };
//   /**
//    *
//    * @param {string} config full config text
//    * @param {string} section desired section name
//    */
//   const tomlGetSection = (config, section) => {
//     const result = tomlGetSectionBounds(config, section);
//     if (result === null) {
//       return null;
//     }
//     const [start, end] = result;
//     return config.slice(start, end);
//   };
//   /**
//    *
//    * @param {string} config full config text
//    * @param {string} section desired section name
//    * @param {string} newContent replacement text for section
//    */
//   const tomlSetSection = (config, section, newContent) => {
//     const result = tomlGetSectionBounds(config, section);
//     const [start, end] =
//       result === null ? [config.length, config.length] : result;
//     return (
//       config.slice(0, start) +
//       (result === null ? `[${section}]\n` : "") +
//       newContent +
//       config.slice(end)
//     );
//   };
//   /**
//    *
//    * @param {string} config full config text
//    * @param {string} section desired section name
//    * @param {(content: string) => string} replacer callback
//    */
//   const tomlModifySection = (config, section, replacer) => {
//     return tomlSetSection(
//       config,
//       section,
//       replacer(tomlGetSection(config, section) ?? ""),
//     );
//   };
//   const containsCorsOrigin = (config) => {
//     const settingsText = tomlGetSection(config, "settings");
//     if (!settingsText) {
//       return false;
//     }
//     const originsLine = /^origins\s*=\s*(?<array>\[[^\]]+\])/m.exec(
//       settingsText,
//     );
//     if (!originsLine) {
//       return false;
//     }
//     /**
//      * @type {Array<string>}
//      */
//     const origins = JSON.parse(originsLine.groups["array"]);
//     console.log("origins:", origins);
//     return origins.includes(cockpit.transport.origin);
//   };
//   const file = cockpit.file("/etc/coolercontrol/config.toml", {
//     superuser: "try",
//   });
//   const containsOrigin = await file
//     .read()
//     .then(async (content) => {
//       if (content === null) {
//         // config DNE, create it
//         await requireAdministrativeAccess();
//         pushError(_("First time config setup..."));
//         const proc = cockpit.script(
//           `
// coproc DAEMON { exec coolercontrold 2>&1; }
// daemon_pid=$DAEMON_PID
// (
//   sleep 20
//   echo Force killing coolercontrold after timeout
//   kill "$daemon_pid" 2>/dev/null
// ) &
// timeout_pid=$!

// while IFS= read -r line; do
//   printf '%s\n' "$line"

//   if [[ $line == *"Configuration file check successful"* ]]; then
//     echo Killing daemon
//     kill "$daemon_pid" 2>/dev/null
//   fi
// done <&"\${DAEMON[0]}"

// kill "$timeout_pid" 2>/dev/null || true
// wait "$daemon_pid" 2>/dev/null || true
// wait "$timeout_pid" 2>/dev/null || true
//           `,
//           [],
//           {
//             superuser: "require",
//           },
//         );
//         proc.stream((output) => console.log(output));
//         await proc;
//         popError();
//         return await file.read();
//       }
//       return content;
//     })
//     .then((content) => containsCorsOrigin(content))
//     .catch((error) => {
//       console.error(error);
//       return false;
//     });
//   if (containsOrigin) {
//     console.log("CORS configured properly");
//     return;
//   }
//   await requireAdministrativeAccess();
//   console.log("Configuring CORS");
//   pushError(_("Configuring CORS..."));
//   const serviceWasActive = await serviceIsActive();
//   if (serviceWasActive) {
//     await stopService();
//   }
//   await file.modify((config) => {
//     return tomlModifySection(config, "settings", (settingsText) => {
//       let originsLine = /^origins\s*=\s*(?<array>\[[^\]]+\]).*$/m.exec(
//         settingsText,
//       );
//       if (!originsLine) {
//         const newOriginsLineText = `
// origins = [${JSON.stringify(cockpit.transport.origin)}]
// `;
//         const originsLineCommentRe = /^#\s*origins\s*=\s*\[.*$/m;
//         if (originsLineCommentRe.test(settingsText)) {
//           return settingsText.replace(originsLineCommentRe, newOriginsLineText);
//         }
//         return settingsText + newOriginsLineText;
//       }
//       /**
//        * @type {Array<string>}
//        */
//       const origins = JSON.parse(originsLine.groups["array"]);
//       origins.push(cockpit.transport.origin);
//       return settingsText.replace(
//         originsLine[0],
//         `origins = ${JSON.stringify(origins)}`,
//       );
//     });
//   });
//   if (serviceWasActive) {
//     await startService();
//   }
//   popError();
// }

async function checkCert() {
  try {
    console.log("checking cert...");
    await fetch(CoolercontrolUrl.origin, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    });
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

async function promptToAcceptCert() {
  pushError(
    `
      <p>${_("The CoolerControl certificate has not been accepted.")}
        <a href="${CoolercontrolUrl.origin}"
          target="_blank"
          rel="noopener noreferrer">
          ${_("Open a new tab to accept the certificate")}
        </a>
      </p>
    `,
    true,
  );
  await new Promise((resolve) => {
    const interval = window.setInterval(async () => {
      if (await checkCert()) {
        window.clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
  popError();
}

function loadCoolerControlFrame(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      // reject(new Error("CoolerControl iframe was blocked or failed to load"));
    }, timeoutMs);

    /**
     *
     * @param {MessageEvent} message
     */
    function handleMessage(message) {
      if (message.data === "loadstart") {
        window.removeEventListener("message", handleMessage);
        window.clearTimeout(timeout);
        resolve();
      }
    }

    window.addEventListener("message", handleMessage);

    iframe.src = CoolercontrolUrl.href;
  });
}

async function loadIframe() {
  if (!(await daemonResponsive()) && !(await serviceIsActive())) {
    await promptToStartService();
  }
  if (!(await checkCert())) {
    await promptToAcceptCert();
  }
  if (!(await daemonResponsive())) {
    await waitForDaemonResponse();
  }
  try {
    await loadCoolerControlFrame();
  } catch (error) {
    pushError(
      _(
        "CoolerControl could not be embedded. Check the configured frame_ancestors setting.",
      ),
    );
  }
}

function nudgePaletteColours(palette) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const channels = (hex) => [
    channel(Number.parseInt(hex.slice(1, 3), 16)),
    channel(Number.parseInt(hex.slice(3, 5), 16)),
    channel(Number.parseInt(hex.slice(5, 7), 16)),
  ];
  const luminanceFactors = [0.2126, 0.7152, 0.0722];
  const luminance = (rgb) =>
    rgb.reduce(
      (total, value, index) => total + value * luminanceFactors[index],
      0,
    );
  const encodeChannel = (value) =>
    255 *
    (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
  const atLuminance = (rgb, current, target) => {
    const scale = target / current;
    if (current > 0 && Math.max(...rgb) * scale <= 1) {
      return rgb.map((value) => value * scale);
    }
    const amount = (target - current) / (1 - current);
    return rgb.map((value) => value + (1 - value) * amount);
  };

  const MIN_CONTRAST = 3.0;
  const BACKGROUND_KEYS = ["bgOne", "bgTwo"];
  const FOREGROUND_KEYS = [
    "success",
    "warning",
    "error",
    "info",
    "accent",
    "accentGradientTo",
    "textColor",
    "textColorSecondary",
  ];

  const backgroundLuminances = BACKGROUND_KEYS.map((key) =>
    luminance(channels(palette[key])),
  );
  for (const key of FOREGROUND_KEYS) {
    if (!palette[key]) {
      continue;
    }
    const originalHex = palette[key];
    const original = channels(originalHex);
    const originalLuminance = luminance(original);
    let lower = 0;
    let upper = 1;
    for (const background of backgroundLuminances) {
      const brighten = originalLuminance > background ||
        (originalLuminance === background && background < 0.5);
      if (brighten) {
        lower = Math.max(lower, MIN_CONTRAST * (background + 0.05) - 0.05);
      } else {
        upper = Math.min(upper, (background + 0.05) / MIN_CONTRAST - 0.05);
      }
    }
    if (lower > upper) {
      continue;
    }
    const target = Math.max(lower, Math.min(upper, originalLuminance));
    if (target === originalLuminance) {
      continue;
    }
    const round = target > originalLuminance ? Math.ceil : Math.floor;
    const adjusted = atLuminance(original, originalLuminance, target);
    palette[key] = `#${adjusted.map((value) =>
      round(Math.max(0, Math.min(255, encodeChannel(value))))
        .toString(16).padStart(2, "0"),
    ).join("")}`;
    console.log(
      "nudging palette key",
      `'${key}'`,
      "from",
      originalHex,
      "to",
      palette[key],
    );
  }
}

function getPalette() {
  const parentStyles = window.getComputedStyle(
    window.parent.document.documentElement,
  );
  const palette = {
    variant: window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark",
    tokens: {
      accent: parentStyles
        .getPropertyValue("--pf-t--global--text--color--brand--default")
        .trim(),
      accentGradientTo: parentStyles
        .getPropertyValue("--pf-t--global--text--color--brand--default")
        .trim(),
      bgOne: parentStyles
        .getPropertyValue("--pf-t--global--background--color--primary--default")
        .trim(),
      bgTwo: parentStyles
        .getPropertyValue(
          "--pf-t--global--background--color--secondary--default",
        )
        .trim(),
      borderOne: parentStyles
        .getPropertyValue("--pf-t--global--border--color--default")
        .trim(),
      textColor: parentStyles
        .getPropertyValue("--pf-t--global--text--color--regular")
        .trim(),
      textColorSecondary: parentStyles
        .getPropertyValue("--pf-t--global--text--color--subtle")
        .trim(),
      success: parentStyles
        .getPropertyValue(
          "--pf-t--global--text--color--status--success--default",
        )
        .trim(),
      warning: parentStyles
        .getPropertyValue(
          "--pf-t--global--text--color--status--warning--default",
        )
        .trim(),
      error: parentStyles
        .getPropertyValue(
          "--pf-t--global--text--color--status--danger--default",
        )
        .trim(),
      info: parentStyles
        .getPropertyValue("--pf-t--global--text--color--status--info--default")
        .trim(),
    },
  };
  nudgePaletteColours(palette.tokens);
  return palette;
}

function sendPalette() {
  iframe.contentWindow.postMessage(
    {
      type: "coolercontrol:palette",
      palette: getPalette(),
    },
    CoolercontrolUrl.href,
  );
}

const prefersLightQuery = window.matchMedia("(prefers-color-scheme: light)");
const prefersContrastQuery = window.matchMedia("(prefers-contrast: more)");

window.addEventListener("message", (message) => {
  const messageOrigin = new URL(message.origin);
  if (
    messageOrigin.protocol !== CoolercontrolUrl.protocol ||
    messageOrigin.host !== CoolercontrolUrl.host ||
    messageOrigin.port !== CoolercontrolUrl.port
  ) {
    return;
  }
  if (message.data.type === "coolercontrol:palette-request") {
    sendPalette();
    prefersLightQuery.removeEventListener("change", sendPalette);
    prefersLightQuery.addEventListener("change", sendPalette);
    prefersContrastQuery.removeEventListener("change", sendPalette);
    prefersContrastQuery.addEventListener("change", sendPalette);
  }
});

await loadIframe();
