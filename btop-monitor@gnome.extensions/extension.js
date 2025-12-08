import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

// Monitor types
const MonitorType = {
  CPU: "cpu",
  MEMORY: "memory",
  SWAP: "swap",
  NET: "net",
};

// Labels for monitor types
const TEXT_LABELS = {
  cpu: "CPU",
  memory: "MEM",
  swap: "SWP",
  net: "NET",
};

// Symbolic icon names for monitor types
const ICON_NAMES = {
  cpu: "org.gnome.SystemMonitor-symbolic",
  memory: "drive-harddisk-solidstate-symbolic",
  swap: "drive-harddisk-system-symbolic",
  net: "network-wired-symbolic",
};

// Format bytes per second to human readable
function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) {
    return `${Math.round(bytesPerSec)}B`;
  } else if (bytesPerSec < 1024 * 1024) {
    return `${(bytesPerSec / 1024).toFixed(1)}K`;
  } else if (bytesPerSec < 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
  } else {
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(1)}G`;
  }
}

// Terminal detection order (first found wins)
const TERMINAL_COMMANDS = [
  ["ptyxis", "ptyxis -e %c"],
  ["ghostty", "ghostty -e %c"],
  ["kgx", "kgx -e %c"],
  ["gnome-terminal", "gnome-terminal -- %c"],
  ["kitty", "kitty %c"],
  ["alacritty", "alacritty -e %c"],
  ["konsole", "konsole -e %c"],
  ["terminator", "terminator -e %c"],
  ["xterm", "xterm -e %c"],
];

class SystemMonitor {
  constructor() {
    this._lastCpuData = null;
    this._lastNetData = null;
    this._lastNetTime = null;
  }

  // Read CPU usage from /proc/stat
  getCpuUsage() {
    try {
      const [ok, contents] = GLib.file_get_contents("/proc/stat");
      if (!ok) return null;

      const decoder = new TextDecoder("utf-8");
      const lines = decoder.decode(contents).split("\n");
      const cpuLine = lines.find((line) => line.startsWith("cpu "));

      if (!cpuLine) return null;

      const parts = cpuLine.split(/\s+/).slice(1).map(Number);
      const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;

      const totalIdle = idle + iowait;
      const totalActive = user + nice + system + irq + softirq + steal;
      const total = totalIdle + totalActive;

      if (this._lastCpuData) {
        const idleDelta = totalIdle - this._lastCpuData.idle;
        const totalDelta = total - this._lastCpuData.total;

        this._lastCpuData = { idle: totalIdle, total: total };

        if (totalDelta === 0) return 0;
        return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
      }

      this._lastCpuData = { idle: totalIdle, total: total };
      return null; // Need two samples to calculate
    } catch (e) {
      console.error(`[Btop Monitor] Error reading CPU: ${e}`);
      return null;
    }
  }

  // Read memory usage from /proc/meminfo
  getMemoryUsage() {
    try {
      const [ok, contents] = GLib.file_get_contents("/proc/meminfo");
      if (!ok) return null;

      const decoder = new TextDecoder("utf-8");
      const lines = decoder.decode(contents).split("\n");

      const getValue = (name) => {
        const line = lines.find((l) => l.startsWith(name));
        if (!line) return 0;
        const match = line.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const total = getValue("MemTotal:");
      const available = getValue("MemAvailable:");

      if (total === 0) return null;

      const used = total - available;
      return Math.round((used / total) * 100);
    } catch (e) {
      console.error(`[Btop Monitor] Error reading memory: ${e}`);
      return null;
    }
  }

  // Read swap usage from /proc/meminfo
  getSwapUsage() {
    try {
      const [ok, contents] = GLib.file_get_contents("/proc/meminfo");
      if (!ok) return null;

      const decoder = new TextDecoder("utf-8");
      const lines = decoder.decode(contents).split("\n");

      const getValue = (name) => {
        const line = lines.find((l) => l.startsWith(name));
        if (!line) return 0;
        const match = line.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const total = getValue("SwapTotal:");
      const free = getValue("SwapFree:");

      if (total === 0) return 0; // No swap configured

      const used = total - free;
      return Math.round((used / total) * 100);
    } catch (e) {
      console.error(`[Btop Monitor] Error reading swap: ${e}`);
      return null;
    }
  }

  // Read network usage from /proc/net/dev
  getNetworkUsage() {
    try {
      const [ok, contents] = GLib.file_get_contents("/proc/net/dev");
      if (!ok) return null;

      const decoder = new TextDecoder("utf-8");
      const lines = decoder.decode(contents).split("\n");

      let totalRx = 0;
      let totalTx = 0;

      // Skip header lines (first two lines)
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Skip loopback interface
        if (line.startsWith("lo:")) continue;

        // Parse: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
        const match = line.match(
          /^\S+:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/,
        );
        if (match) {
          totalRx += parseInt(match[1], 10);
          totalTx += parseInt(match[2], 10);
        }
      }

      const now = GLib.get_monotonic_time();

      if (this._lastNetData !== null && this._lastNetTime !== null) {
        const timeDelta = (now - this._lastNetTime) / 1000000; // Convert to seconds
        if (timeDelta > 0) {
          const rxDelta = totalRx - this._lastNetData.rx;
          const txDelta = totalTx - this._lastNetData.tx;

          // Calculate bytes per second
          const rxPerSec = rxDelta / timeDelta;
          const txPerSec = txDelta / timeDelta;

          this._lastNetData = { rx: totalRx, tx: totalTx };
          this._lastNetTime = now;

          return { rx: rxPerSec, tx: txPerSec };
        }
      }

      this._lastNetData = { rx: totalRx, tx: totalTx };
      this._lastNetTime = now;
      return null; // Need two samples to calculate
    } catch (e) {
      console.error(`[Btop Monitor] Error reading network: ${e}`);
      return null;
    }
  }

  destroy() {
    this._lastCpuData = null;
    this._lastNetData = null;
    this._lastNetTime = null;
  }
}

class BtopIndicator extends PanelMenu.Button {
  static {
    GObject.registerClass(this);
  }

  constructor(extension) {
    super(0.0, _("Btop Monitor"));

    this._extension = extension;
    this._settings = extension.getSettings();
    this._monitor = new SystemMonitor();
    this._updateTimer = null;
    this._monitorWidgets = new Map(); // Maps monitor type to {box, icon, label}

    // Create a box to hold all monitor items
    this._box = new St.BoxLayout({
      style_class: "panel-status-menu-box",
    });
    this.add_child(this._box);

    // Connect click handler
    this.connect("button-press-event", this._onClick.bind(this));

    // Connect settings changes
    this._settingsChangedId = this._settings.connect(
      "changed",
      this._onSettingsChanged.bind(this),
    );

    // Build initial display
    this._rebuildMonitors();

    // Start monitoring
    this._startMonitoring();
  }

  _getMonitorTypes() {
    // Try new setting first, fall back to legacy
    try {
      const types = this._settings.get_strv("monitor-types");
      if (types && types.length > 0) {
        return types;
      }
    } catch (e) {
      // Setting doesn't exist yet, use legacy
    }
    // Fall back to legacy single monitor-type
    return [this._settings.get_string("monitor-type") || "cpu"];
  }

  _rebuildMonitors() {
    // Clear existing widgets
    this._box.destroy_all_children();
    this._monitorWidgets.clear();

    const monitorTypes = this._getMonitorTypes();
    const useIcon = this._settings.get_boolean("use-icon");

    monitorTypes.forEach((monitorType, index) => {
      // Add separator between monitors
      if (index > 0) {
        const separator = new St.Label({
          text: " ",
          y_align: Clutter.ActorAlign.CENTER,
          style_class: "btop-monitor-separator",
        });
        this._box.add_child(separator);
      }

      // Create container for this monitor (icon + value tightly packed)
      const monitorBox = new St.BoxLayout({
        style_class: "btop-monitor-item",
      });

      // Create icon
      const icon = new St.Icon({
        icon_name: ICON_NAMES[monitorType] || ICON_NAMES.cpu,
        style_class: "btop-monitor-icon",
      });
      icon.visible = useIcon;

      // Create label for value
      const label = new St.Label({
        text: this._getInitialText(monitorType, useIcon),
        y_align: Clutter.ActorAlign.CENTER,
        style_class: "btop-monitor-label",
      });

      monitorBox.add_child(icon);
      monitorBox.add_child(label);
      this._box.add_child(monitorBox);

      this._monitorWidgets.set(monitorType, { box: monitorBox, icon, label });
    });
  }

  _getInitialText(monitorType, useIcon) {
    const prefix = useIcon ? "" : `${TEXT_LABELS[monitorType] || "CPU"} `;
    if (monitorType === MonitorType.NET) {
      return `${prefix}↑-- ↓--`;
    }
    return `${prefix}--%`;
  }

  _startMonitoring() {
    // Get initial reading (CPU needs two samples)
    this._updateDisplay();

    // Start periodic updates
    const refreshRate = this._settings.get_int("refresh-rate");
    this._updateTimer = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      refreshRate,
      () => {
        this._updateDisplay();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _stopMonitoring() {
    if (this._updateTimer) {
      GLib.source_remove(this._updateTimer);
      this._updateTimer = null;
    }
  }

  _updateDisplay() {
    const useIcon = this._settings.get_boolean("use-icon");

    for (const [monitorType, widgets] of this._monitorWidgets) {
      let value = null;
      let isNetwork = false;

      switch (monitorType) {
        case MonitorType.CPU:
          value = this._monitor.getCpuUsage();
          break;
        case MonitorType.MEMORY:
          value = this._monitor.getMemoryUsage();
          break;
        case MonitorType.SWAP:
          value = this._monitor.getSwapUsage();
          break;
        case MonitorType.NET:
          value = this._monitor.getNetworkUsage();
          isNetwork = true;
          break;
        default:
          value = this._monitor.getCpuUsage();
      }

      // Update icon visibility
      widgets.icon.visible = useIcon;

      // Update the value text
      const prefix = useIcon ? "" : `${TEXT_LABELS[monitorType]} `;
      if (value !== null) {
        if (isNetwork) {
          const upStr = formatSpeed(value.tx);
          const downStr = formatSpeed(value.rx);
          widgets.label.text = `${prefix}↑${upStr} ↓${downStr}`;
          // Use combined rate for color (arbitrary threshold in MB/s)
          const combinedMbps = (value.rx + value.tx) / (1024 * 1024);
          this._updateColorForNetwork(widgets.label, combinedMbps);
        } else {
          widgets.label.text = `${prefix}${value}%`;
          this._updateColor(widgets.label, value);
        }
      } else {
        if (isNetwork) {
          widgets.label.text = `${prefix}↑-- ↓--`;
        } else {
          widgets.label.text = `${prefix}--%`;
        }
        widgets.label.style_class = "btop-monitor-label";
      }
    }
  }

  _updateColor(label, percentage) {
    const yellowThreshold = this._settings.get_int("yellow-threshold");
    const redThreshold = this._settings.get_int("red-threshold");

    label.remove_style_class_name("btop-monitor-normal");
    label.remove_style_class_name("btop-monitor-warning");
    label.remove_style_class_name("btop-monitor-critical");

    if (percentage >= redThreshold) {
      label.add_style_class_name("btop-monitor-critical");
    } else if (percentage >= yellowThreshold) {
      label.add_style_class_name("btop-monitor-warning");
    } else {
      label.add_style_class_name("btop-monitor-normal");
    }
  }

  _updateColorForNetwork(label, mbps) {
    // Color based on combined network speed in MB/s
    // Yellow at 10 MB/s, Red at 100 MB/s (can be quite high for local transfers)
    label.remove_style_class_name("btop-monitor-normal");
    label.remove_style_class_name("btop-monitor-warning");
    label.remove_style_class_name("btop-monitor-critical");

    if (mbps >= 100) {
      label.add_style_class_name("btop-monitor-critical");
    } else if (mbps >= 10) {
      label.add_style_class_name("btop-monitor-warning");
    } else {
      label.add_style_class_name("btop-monitor-normal");
    }
  }

  _detectTerminal() {
    // Try to find an available terminal
    for (const [binary, command] of TERMINAL_COMMANDS) {
      const path = GLib.find_program_in_path(binary);
      if (path) {
        return command;
      }
    }
    return null;
  }

  _onClick(actor, event) {
    // Only respond to left click
    if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

    let terminal = this._settings.get_string("terminal-command");
    const btopCommand = this._settings.get_string("btop-command");

    // Handle auto-detection
    if (terminal === "auto") {
      terminal = this._detectTerminal();
      if (!terminal) {
        Main.notifyError(
          _("Btop Monitor"),
          _(
            "No terminal emulator found. Please install one or select manually in settings.",
          ),
        );
        return Clutter.EVENT_STOP;
      }
    }

    try {
      // Try to spawn the terminal with btop
      const fullCommand = terminal.replace("%c", btopCommand);
      GLib.spawn_command_line_async(fullCommand);
    } catch (e) {
      console.error(`[Btop Monitor] Error launching btop: ${e}`);
      Main.notifyError(
        _("Btop Monitor"),
        _("Failed to launch terminal. Check your settings."),
      );
    }

    return Clutter.EVENT_STOP;
  }

  _onSettingsChanged(settings, key) {
    if (key === "refresh-rate") {
      this._stopMonitoring();
      this._startMonitoring();
    } else if (
      key === "monitor-types" ||
      key === "monitor-type" ||
      key === "use-icon"
    ) {
      this._rebuildMonitors();
      this._updateDisplay();
    } else {
      this._updateDisplay();
    }
  }

  destroy() {
    this._stopMonitoring();

    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }

    this._monitorWidgets.clear();
    this._monitor.destroy();
    this._monitor = null;

    super.destroy();
  }
}

export default class BtopMonitorExtension extends Extension {
  enable() {
    this._indicator = new BtopIndicator(this);

    // Add to panel (right side by default)
    const position = this.getSettings().get_string("panel-position");
    const index = this.getSettings().get_int("panel-index");

    Main.panel.addToStatusArea(
      this.metadata.uuid,
      this._indicator,
      index,
      position,
    );
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }
}
