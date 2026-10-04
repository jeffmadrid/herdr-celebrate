# Celebrate

A [herdr](https://herdr.dev) plugin that plays a confetti or fireworks animation whenever a `git push` succeeds — in any repository, from any terminal on your machine.

```
🚀  main → origin
your-repo · pushed!
```

## Requirements

- herdr >= 0.9.0, running locally
- Node.js >= 18
- git
- macOS or Linux (Windows untested)

## Install

From GitHub:

```
herdr plugin install jeffmadrid/herdr-celebrate
```

Pin a released version:

```
herdr plugin install jeffmadrid/herdr-celebrate --ref v0.1.0
```

From a local checkout (development):

```
herdr plugin link ~/Projects/herdr-celebrate
```

Then enable push detection (one-time, opt-in):

```
herdr plugin action invoke jeffmadrid.celebrate.install-hooks
```

This installs a global git `pre-push` hook and points `core.hooksPath` at it. It never touches your repositories, and it preserves any hooks that were already installed — see [How it works](#how-it-works).

Try the effect without pushing:

```
herdr plugin action invoke jeffmadrid.celebrate.test
```

Check what's installed:

```
herdr plugin action invoke jeffmadrid.celebrate.status
```

Turn it off and restore your git config:

```
herdr plugin action invoke jeffmadrid.celebrate.uninstall-hooks
```

You can also bind the test action to a key in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "jeffmadrid.celebrate.test"
description = "celebrate"
```

## Configuration

Create `config.json` in the plugin config directory (find it with `herdr plugin config-dir jeffmadrid.celebrate`). Every key is optional.

```json
{
  "enabled": true,
  "effect": "random",
  "cycle_seconds": 4,
  "sound": false,
  "cooldown_seconds": 5,
  "ignore_remotes": [],
  "width": "100%",
  "height": "100%",
  "fallback_notification": true
}
```

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch for celebrations |
| `effect` | `"random"` | `confetti`, `fireworks`, or `random` per push |
| `cycle_seconds` | `4` | seconds per celebration wave; the effect repeats until you dismiss it (1–30) |
| `sound` | `false` | play a system sound on macOS |
| `cooldown_seconds` | `5` | minimum gap between celebrations (multi-ref pushes count once) |
| `ignore_remotes` | `[]` | remote names or URL substrings to skip, e.g. `["backup", "gitlab.com"]` |
| `width`, `height` | `"100%"` | popup size (cells or percentage) |
| `fallback_notification` | `true` | show a toast instead when a popup can't open (e.g. a modal is busy) |

The popup stays up and keeps celebrating until you press any key.

## How it works

```
git push
  └─ global pre-push hook (installed by this plugin)
       ├─ chains any previously installed global hook and the repo's own .git/hooks/pre-push
       ├─ snapshots the remote-tracking refs
       └─ detaches watcher.mjs and exits 0 immediately
  └─ watcher waits for git to exit, then verifies the push actually landed
       └─ `herdr plugin pane open` → full-screen animation in a popup
```

- **Failed pushes never celebrate.** The watcher checks that the remote-tracking ref moved to the pushed SHA, falling back to `git ls-remote` for tags and custom fetch refspecs. Rejected, non-fast-forward, `--dry-run`, and "everything up-to-date" pushes stay quiet.
- **Your push is never blocked or slowed.** All hook work is best-effort, the watcher runs detached, and the hook always exits with the chained hook's status (usually 0).
- **Nothing else on your machine changes.** Only `core.hooksPath` is set, and `uninstall-hooks` restores it exactly — including a previous value and any hook that was moved aside.
- **Pushing with hooks bypassed is not detected.** Repositories that set their own `core.hooksPath` (for example husky) override the global hook; the same goes for pushes made inside a herdr *remote* session, where the hook lives on the remote machine.

If herdr isn't running when a push lands, nothing happens — no error, no delay.

## Files

| file | role |
| --- | --- |
| `herdr-plugin.toml` | manifest: actions + the `celebrate` popup entrypoint |
| `setup.mjs` | install/uninstall/status of the global git hook |
| `hooks/pre-push.tmpl` | the POSIX-sh hook that gets installed |
| `watcher.mjs` | verifies the push and triggers the popup |
| `celebrate.mjs` | the particle animation |
| `test.mjs` | opens the popup on demand |
| `lib.mjs` | config, logging, herdr binary discovery |

## Security note

herdr plugins are ordinary code running with your permissions — there is no sandbox. This plugin runs a `pre-push` hook on every push, spawns a short-lived Node watcher, and calls the herdr CLI. Irreversible actions: it writes one file under your global git config's hooks path and sets `core.hooksPath` (both reverted by `uninstall-hooks`). Skim the source before enabling.

## Development

```
herdr plugin link .
herdr plugin action invoke jeffmadrid.celebrate.test
herdr plugin log list --plugin jeffmadrid.celebrate
```

Logs (hook and watcher output) also land in `$HERDR_PLUGIN_STATE_DIR/celebrate.log`, and `.log.1` after rotation.

## License

MIT
