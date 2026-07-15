## What's new?

- **Multiple Claude Code accounts.** Point each button at a different Claude Code config dir (`CLAUDE_CONFIG_DIR`) from the Property Inspector, and it reads that account's usage — and keychain token — independently.
- **Accent color stripe.** Give any button a custom color so you can tell instances apart at a glance; set it under the new **Accent color** option in the Property Inspector.
- Fixed the caption field losing keystrokes while typing, and swapped the plain-text caption for the accent color stripe described above.



## Installation

**Requirements:** macOS, Ulanzi Studio 3.0.11+, and Claude Code CLI signed in (`claude auth login`).

1. Download `com.claude.usage.ulanziPlugin.zip` below
2. Unzip and move the folder into:
   ```
   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/
   ```
3. Quit and reopen Ulanzi Studio
4. Drag **5-hour Limit** or **Weekly Limit** from the **Claude Code** category onto a key

That's it — the button updates every 5 minutes. Click it any time to force a refresh.
