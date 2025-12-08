# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GNOME Shell extension that displays system resource usage (CPU, Memory, Swap, or Load Average) in the top bar with color-coded indicators. Clicking the indicator launches btop in the user's preferred terminal.

**Extension UUID**: `btop-monitor@gnome.extensions`
**Supported GNOME Shell versions**: 45, 46, 47, 48, 49

## Development Commands

### Install extension locally
```bash
./install.sh
```

### Manual installation
```bash
cp -r btop-monitor@gnome.extensions ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/btop-monitor@gnome.extensions/schemas/
```

### Compile schemas after modifying gschema.xml
```bash
glib-compile-schemas btop-monitor@gnome.extensions/schemas/
```

### Enable/disable extension
```bash
gnome-extensions enable btop-monitor@gnome.extensions
gnome-extensions disable btop-monitor@gnome.extensions
```

### Open preferences
```bash
gnome-extensions prefs btop-monitor@gnome.extensions
```

### View extension logs
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i btop
```

### Restart GNOME Shell (required after code changes)
- X11: `Alt+F2`, type `r`, press Enter
- Wayland: Log out and log back in

## Architecture

The extension uses the GNOME Shell ES Module extension format (GNOME 45+).

### Key Files

- **extension.js**: Main extension code with `BtopMonitorExtension` (entry point), `BtopIndicator` (panel button widget), and `SystemMonitor` (reads /proc for system stats)
- **prefs.js**: Preferences window using libadwaita (`Adw`) widgets
- **schemas/org.gnome.shell.extensions.btop-monitor.gschema.xml**: GSettings schema defining all configurable settings
- **stylesheet.css**: CSS classes for color-coded thresholds (normal, warning, critical)

### System Resource Reading

The `SystemMonitor` class reads directly from `/proc`:
- CPU: `/proc/stat` (requires two samples to calculate delta)
- Memory/Swap: `/proc/meminfo`
- Load: `/proc/loadavg`

### GObject Registration

`BtopIndicator` extends `PanelMenu.Button` and must be registered with `GObject.registerClass(this)` in a static block.

### Settings Binding

Settings use GSettings with schema `org.gnome.shell.extensions.btop-monitor`. The preferences UI binds directly to settings using `Gio.SettingsBindFlags.DEFAULT`.

## GNOME Extension Conventions

- Use `_` prefix for private instance variables
- Import GI modules with `import X from 'gi://X'`
- Import shell modules from `resource:///org/gnome/shell/...`
- Extension must export default class with `enable()` and `disable()` methods
- Clean up all signal handlers and timers in `destroy()`
