# Wrangler on Windows – PATH / npx fix

On Windows, invoking `npx wrangler ...` via `execFileSync("npx", ...)` often fails because `npx` is a .cmd shim and Node's `execFile` does not run cmd shims the same way as a shell.

## Fix

Prefer spawning through `cmd.exe`:

```js
import { execFileSync } from "child_process";

const isWin = process.platform === "win32";

function wrangler(args, opts = {}) {
  if (isWin) {
    return execFileSync("cmd.exe", ["/c", "npx", "wrangler", ...args], {
      encoding: "utf8",
      ...opts,
    });
  }
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    ...opts,
  });
}
```

Equivalent in PowerShell / interactive shell:

```bat
cmd.exe /c npx wrangler --version
```

## In this repo

`scripts/media-synth-e2e.mjs` already uses the `cmd.exe /c npx wrangler` pattern on `win32`.

When adding new automation that shells out to Wrangler from Node on Windows, reuse the same approach.
