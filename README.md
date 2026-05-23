# Claude Code Usage Plugin for Ulanzi Deck

Display your Claude Code subscription usage directly on your Ulanzi Deck.

![Ulanzi Deck preview](images/deck.png)

## Features

- **5-Hour Rolling Limit** - Shows your current usage in the 5-hour window
- **Weekly Limit** - Shows your total usage across all Claude models for the week
- Real-time updates from Claude Code API

## Installation

1. Copy the `com.claude.usage.ulanziPlugin` folder to your Ulanzi Deck plugins directory:
   ```
   ~/.ulanzi/plugins/
   ```

2. Restart Ulanzi Deck

3. Add the plugin to your deck and configure your buttons

## Requirements

- Ulanzi Deck 3.0.11 or later
- macOS 10.15 or later
- Claude Code subscription (credentials stored in your macOS keychain)

## How It Works

The plugin reads your Claude Code credentials from the macOS keychain and fetches your current usage from the Anthropic API. It displays:

- **Utilization %** - How much of your limit you've used
- **Status** - Whether you're within limits or rate-limited
- **Reset Time** - When your limit resets

No API keys or credentials are stored in the plugin.

## Configuration

Open the property inspector when adding a button and select which limit you want to display (5-hour or weekly).

## Author

Narlei Moreira

## License

MIT
