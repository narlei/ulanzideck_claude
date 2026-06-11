## Whats new?

- **Fixed the Weekly Limit display during rate limiting.** When Claude returns a 429, only the metric that was actually rejected now shows the "stopped" state — the other key keeps showing its real utilization and reset countdown instead of going blank.

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