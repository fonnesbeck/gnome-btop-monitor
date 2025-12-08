# Btop Monitor - GNOME Shell Extension

A GNOME Shell extension that displays system resource usage (CPU, Memory, Swap, or Load Average) in the top bar with color-coded indicators. Click on the indicator to launch btop in your preferred terminal.

## Features

- **System Monitoring**: Display CPU usage, Memory usage, Swap usage, or Load Average in the top bar
- **Color-Coded Indicators**:
  - White: Normal usage
  - Yellow: Moderate usage (default: 50%+)
  - Red: Heavy usage (default: 80%+)
- **Btop Integration**: Click the indicator to open btop in a terminal
- **Fully Customizable**:
  - Choose which resource to monitor
  - Adjust refresh rate
  - Configure color thresholds
  - Customize terminal and btop commands
  - Set panel position

## Requirements

- GNOME Shell 45, 46, or 47
- [btop](https://github.com/aristocratos/btop) (or any other terminal-based system monitor)
- A terminal emulator (gnome-terminal, kitty, alacritty, etc.)

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/fonnesbeck/gnome-btop-monitor.git
   cd gnome-btop-monitor
   ```

2. Install the extension:
   ```bash
   # Create the extensions directory if it doesn't exist
   mkdir -p ~/.local/share/gnome-shell/extensions/

   # Copy the extension
   cp -r btop-monitor@gnome.extensions ~/.local/share/gnome-shell/extensions/

   # Compile the schemas
   cd ~/.local/share/gnome-shell/extensions/btop-monitor@gnome.extensions/schemas
   glib-compile-schemas .
   ```

3. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, and press Enter
   - On Wayland: Log out and log back in

4. Enable the extension:
   ```bash
   gnome-extensions enable btop-monitor@gnome.extensions
   ```

### Using the Install Script

```bash
./install.sh
```

## Configuration

Open the extension preferences using one of these methods:

1. GNOME Extensions app → Btop Monitor → Settings (gear icon)
2. Command line: `gnome-extensions prefs btop-monitor@gnome.extensions`

### Available Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Monitor Type | CPU, Memory, Swap, or Load Average | CPU |
| Refresh Rate | Update interval in milliseconds | 2000 |
| Yellow Threshold | Percentage for moderate usage warning | 50% |
| Red Threshold | Percentage for heavy usage warning | 80% |
| Terminal Command | Command to launch terminal (`%c` = btop command) | `gnome-terminal -- %c` |
| Btop Command | Path or command for btop | `btop` |
| Panel Section | Left, Center, or Right | Right |
| Position Index | Order within the panel section | 0 |

### Terminal Command Examples

| Terminal | Command |
|----------|---------|
| GNOME Terminal | `gnome-terminal -- %c` |
| Kitty | `kitty %c` |
| Alacritty | `alacritty -e %c` |
| Konsole | `konsole -e %c` |
| Terminator | `terminator -e %c` |
| xterm | `xterm -e %c` |

## Screenshots

```
[CPU 23%]  - Normal (white)
[CPU 54%]  - Moderate (yellow)
[CPU 87%]  - Heavy (red)
```

## Development

### File Structure

```
btop-monitor@gnome.extensions/
├── extension.js      # Main extension code
├── prefs.js          # Preferences UI
├── metadata.json     # Extension metadata
├── stylesheet.css    # Styling
└── schemas/
    └── org.gnome.shell.extensions.btop-monitor.gschema.xml
```

### Building and Testing

1. Make changes to the extension files
2. Compile schemas after modifying the gschema.xml:
   ```bash
   glib-compile-schemas schemas/
   ```
3. Restart GNOME Shell to test changes

### Debugging

View extension logs:
```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Or for extension-specific output:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i btop
```

## License

This project is licensed under the GPL-3.0 License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- [btop](https://github.com/aristocratos/btop) - The excellent terminal-based resource monitor
- GNOME Shell Extension documentation and community
