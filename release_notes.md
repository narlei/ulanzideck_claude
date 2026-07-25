## What's new?

- **Windows support.** The plugin now runs on Windows 10/11 in addition to macOS. On Windows it reads your Claude Code OAuth token from `%USERPROFILE%\.claude\.credentials.json` (macOS keeps using the Keychain), and it locates the `claude` CLI for automatic token refresh across the native installer, the npm global shim, and the bundled install.
- Multi-account support works on Windows too — point a button at a custom `CLAUDE_CONFIG_DIR` and it reads that folder's `.credentials.json`. Paths accept `~` as well as `%USERPROFILE%`-style variables.

## Installation

**Requirements:** macOS or Windows 10+, Ulanzi Studio 3.0.11+, and Claude Code CLI signed in (`claude auth login`).

1. Download `com.claude.usage.ulanziPlugin.zip` below
2. Unzip and move the folder into:
   ```
   macOS:   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/
   Windows: %APPDATA%\Ulanzi\UlanziDeck\Plugins\
   ```
3. Quit and reopen Ulanzi Studio
4. Drag **5-hour Limit** or **Weekly Limit** from the **Claude Code** category onto a key

That's it — the button updates every 5 minutes. Click it any time to force a refresh.
