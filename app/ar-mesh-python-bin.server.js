import { execFileSync } from "node:child_process";

/**
 * @param {string} bin
 * @param {string[]} [prefixArgs]
 * @returns {boolean}
 */
function pythonLaunchWorks(bin, prefixArgs = []) {
  try {
    execFileSync(bin, [...prefixArgs, "-c", "import sys; sys.exit(0)"], {
      stdio: "ignore",
      timeout: 8000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Binário + args prefixo para `spawn` (ex.: `py -3` no Windows).
 * @returns {{ bin: string, prefixArgs: string[] }}
 */
export function resolvePythonLaunch() {
  const override = String(process.env.AR_MESH_PYTHON || "").trim();
  if (override) {
    if (/^py(\s|$|-)/i.test(override) || override === "py") {
      const parts = override.split(/\s+/).filter(Boolean);
      const bin = parts[0] || "py";
      const prefixArgs = parts.slice(1);
      if (!prefixArgs.includes("-3") && !prefixArgs.some((p) => /^-3/.test(p))) {
        prefixArgs.unshift("-3");
      }
      return { bin, prefixArgs };
    }
    return { bin: override, prefixArgs: [] };
  }

  const candidates =
    process.platform === "win32"
      ? [
          { bin: "python", prefixArgs: [] },
          { bin: "py", prefixArgs: ["-3"] },
          { bin: "python3", prefixArgs: [] },
        ]
      : [
          { bin: "python3", prefixArgs: [] },
          { bin: "python", prefixArgs: [] },
        ];

  for (const c of candidates) {
    if (pythonLaunchWorks(c.bin, c.prefixArgs)) return c;
  }

  return process.platform === "win32"
    ? { bin: "python", prefixArgs: [] }
    : { bin: "python3", prefixArgs: [] };
}

/** @returns {string} */
export function resolvePythonBin() {
  return resolvePythonLaunch().bin;
}
