## What's new?

- **Clearer reset time when a limit is reached.** When a key is stopped at 100%, it shows `Reset at HH:mm` for resets within the next 24 hours, then keeps the countdown format (`Reset in 26h`, `Reset in 2d`) for longer waits.



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
