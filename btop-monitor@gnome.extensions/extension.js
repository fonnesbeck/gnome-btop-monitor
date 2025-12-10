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

// Format bytes per second to human readable with fixed width
function formatSpeed(bytesPerSec) {
    if (
        bytesPerSec === null ||
        bytesPerSec === undefined ||
        isNaN(bytesPerSec)
    ) {
        return "    0B";
    }
    bytesPerSec = Number(bytesPerSec);

    let num;
    let unit;

    if (bytesPerSec < 1024) {
        num = Math.round(bytesPerSec).toString();
        unit = "B";
    } else if (bytesPerSec < 1024 * 1024) {
        num = (bytesPerSec / 1024).toFixed(1);
        unit = "K";
    } else if (bytesPerSec < 1024 * 1024 * 1024) {
        num = (bytesPerSec / (1024 * 1024)).toFixed(1);
        unit = "M";
    } else {
        num = (bytesPerSec / (1024 * 1024 * 1024)).toFixed(1);
        unit = "G";
    }

    // Pad to fixed width: 5 chars for number + 1 for unit = 6 total
    // Examples: "  0.0B", "123.4K", "999.9M"
    return num.padStart(5) + unit;
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

// Format bytes to human readable (KB, MB, GB, TB)
function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return "0 B";
    bytes = Number(bytes);
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes < 1024 * 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
}

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
            const [user, nice, system, idle, iowait, irq, softirq, steal] =
                parts;

            const totalIdle = idle + iowait;
            const totalActive = user + nice + system + irq + softirq + steal;
            const total = totalIdle + totalActive;

            if (this._lastCpuData) {
                const idleDelta = totalIdle - this._lastCpuData.idle;
                const totalDelta = total - this._lastCpuData.total;

                this._lastCpuData = { idle: totalIdle, total: total };

                if (totalDelta === 0) return 0;
                return Math.round(
                    ((totalDelta - idleDelta) / totalDelta) * 100,
                );
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

    // Get detailed system stats for tooltip
    getDetailedStats() {
        const stats = {};

        // CPU details
        stats.cpu = this.getCpuUsage();
        stats.cpuCores = this._getCpuCoreCount();
        stats.loadAvg = this._getLoadAverage();

        // Memory details
        const memInfo = this._getMemoryDetails();
        if (memInfo) {
            stats.memTotal = memInfo.total;
            stats.memUsed = memInfo.used;
            stats.memAvailable = memInfo.available;
            stats.memBuffers = memInfo.buffers;
            stats.memCached = memInfo.cached;
            stats.memPercent = memInfo.percent;
        }

        // Swap details
        const swapInfo = this._getSwapDetails();
        if (swapInfo) {
            stats.swapTotal = swapInfo.total;
            stats.swapUsed = swapInfo.used;
            stats.swapFree = swapInfo.free;
            stats.swapPercent = swapInfo.percent;
        }

        // Network details
        const netInfo = this._getNetworkDetails();
        if (netInfo) {
            stats.netRxTotal = netInfo.rxTotal;
            stats.netTxTotal = netInfo.txTotal;
            stats.netInterfaces = netInfo.interfaces;
        }
        const netSpeed = this.getNetworkUsage();
        if (netSpeed) {
            stats.netRxSpeed = netSpeed.rx;
            stats.netTxSpeed = netSpeed.tx;
        }

        // Uptime
        stats.uptime = this._getUptime();

        return stats;
    }

    _getCpuCoreCount() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/cpuinfo");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const text = decoder.decode(contents);
            const matches = text.match(/^processor\s*:/gm);
            return matches ? matches.length : null;
        } catch (e) {
            return null;
        }
    }

    _getLoadAverage() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/loadavg");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const parts = decoder.decode(contents).trim().split(/\s+/);
            return {
                load1: parseFloat(parts[0]),
                load5: parseFloat(parts[1]),
                load15: parseFloat(parts[2]),
            };
        } catch (e) {
            return null;
        }
    }

    _getMemoryDetails() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/meminfo");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const lines = decoder.decode(contents).split("\n");

            const getValue = (name) => {
                const line = lines.find((l) => l.startsWith(name));
                if (!line) return 0;
                const match = line.match(/(\d+)/);
                return match ? parseInt(match[1], 10) * 1024 : 0; // Convert KB to bytes
            };

            const total = getValue("MemTotal:");
            const free = getValue("MemFree:");
            const available = getValue("MemAvailable:");
            const buffers = getValue("Buffers:");
            const cached = getValue("Cached:");
            const used = total - available;

            return {
                total,
                used,
                free,
                available,
                buffers,
                cached,
                percent: total > 0 ? Math.round((used / total) * 100) : 0,
            };
        } catch (e) {
            return null;
        }
    }

    _getSwapDetails() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/meminfo");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const lines = decoder.decode(contents).split("\n");

            const getValue = (name) => {
                const line = lines.find((l) => l.startsWith(name));
                if (!line) return 0;
                const match = line.match(/(\d+)/);
                return match ? parseInt(match[1], 10) * 1024 : 0; // Convert KB to bytes
            };

            const total = getValue("SwapTotal:");
            const free = getValue("SwapFree:");
            const used = total - free;

            return {
                total,
                used,
                free,
                percent: total > 0 ? Math.round((used / total) * 100) : 0,
            };
        } catch (e) {
            return null;
        }
    }

    _getNetworkDetails() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/net/dev");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const lines = decoder.decode(contents).split("\n");

            let totalRx = 0;
            let totalTx = 0;
            const interfaces = [];

            for (let i = 2; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const match = line.match(
                    /^(\S+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/,
                );
                if (match) {
                    const name = match[1];
                    const rx = parseInt(match[2], 10);
                    const tx = parseInt(match[3], 10);

                    if (name !== "lo") {
                        totalRx += rx;
                        totalTx += tx;
                        if (rx > 0 || tx > 0) {
                            interfaces.push({ name, rx, tx });
                        }
                    }
                }
            }

            return { rxTotal: totalRx, txTotal: totalTx, interfaces };
        } catch (e) {
            return null;
        }
    }

    _getUptime() {
        try {
            const [ok, contents] = GLib.file_get_contents("/proc/uptime");
            if (!ok) return null;

            const decoder = new TextDecoder("utf-8");
            const seconds = parseFloat(decoder.decode(contents).split(" ")[0]);

            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else {
                return `${minutes}m`;
            }
        } catch (e) {
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
        this._tooltip = null;
        this._tooltipShowTimeout = null;
        this._tooltipHideTimeout = null;
        this._tooltipUpdateTimer = null;
        this._tooltipValueWidgets = {}; // Store references for live updates

        // Create a box to hold all monitor items
        this._box = new St.BoxLayout({
            style_class: "panel-status-menu-box btop-monitor-box",
        });
        this.add_child(this._box);

        // Connect click handler
        this.connect("button-press-event", this._onClick.bind(this));

        // Connect hover handlers for tooltip
        this.connect("enter-event", this._onHoverEnter.bind(this));
        this.connect("leave-event", this._onHoverLeave.bind(this));

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

        monitorTypes.forEach((monitorType) => {
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

            // Create label for value with FIXED width to prevent panel shifting
            const isNetwork = monitorType === MonitorType.NET;
            // Fixed pixel widths based on monitor type and icon mode
            // These must be wide enough for max content: "100%" or "NET 100%" / network speeds
            let fixedWidth;
            if (isNetwork) {
                fixedWidth = useIcon ? 140 : 180;
            } else {
                fixedWidth = useIcon ? 50 : 80;
            }
            const label = new St.Label({
                text: this._getInitialText(monitorType, useIcon),
                y_align: Clutter.ActorAlign.CENTER,
                style_class: "btop-monitor-label",
                // Enforce exact width via inline style - this CANNOT be overridden
                style: `width: ${fixedWidth}px; min-width: ${fixedWidth}px; max-width: ${fixedWidth}px; text-align: left;`,
            });

            monitorBox.add_child(icon);
            monitorBox.add_child(label);
            this._box.add_child(monitorBox);

            this._monitorWidgets.set(monitorType, {
                box: monitorBox,
                icon,
                label,
            });
        });
    }

    _getInitialText(monitorType, useIcon) {
        const prefix = useIcon ? "" : `${TEXT_LABELS[monitorType] || "CPU"} `;
        if (monitorType === MonitorType.NET) {
            return `${prefix}--↑ --↓`;
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
            const isNetwork = monitorType === MonitorType.NET;

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
                    break;
                default:
                    value = this._monitor.getCpuUsage();
            }

            // Update icon visibility
            widgets.icon.visible = useIcon;

            // Update the value text - width is fixed via inline style
            const prefix = useIcon ? "" : `${TEXT_LABELS[monitorType]} `;
            if (value !== null) {
                if (isNetwork) {
                    const upStr = formatSpeed(value.tx);
                    const downStr = formatSpeed(value.rx);
                    widgets.label.text = `${prefix}${upStr}↑ ${downStr}↓`;
                    // Use combined rate for color (arbitrary threshold in MB/s)
                    const combinedMbps = (value.rx + value.tx) / (1024 * 1024);
                    this._updateColorForNetwork(widgets.label, combinedMbps);
                } else {
                    widgets.label.text = `${prefix}${value}%`;
                    this._updateColor(widgets.label, value);
                }
            } else {
                if (isNetwork) {
                    widgets.label.text = `${prefix}--↑ --↓`;
                } else {
                    widgets.label.text = `${prefix}--%`;
                }
                // Remove color classes when no data
                widgets.label.remove_style_class_name("btop-monitor-normal");
                widgets.label.remove_style_class_name("btop-monitor-warning");
                widgets.label.remove_style_class_name("btop-monitor-critical");
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

    _onHoverEnter() {
        // Cancel any pending hide timeout
        if (this._tooltipHideTimeout) {
            GLib.source_remove(this._tooltipHideTimeout);
            this._tooltipHideTimeout = null;
        }

        // Show tooltip after a short delay
        if (!this._tooltipShowTimeout) {
            this._tooltipShowTimeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                300,
                () => {
                    this._showTooltip();
                    this._tooltipShowTimeout = null;
                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onHoverLeave() {
        // Cancel any pending show timeout
        if (this._tooltipShowTimeout) {
            GLib.source_remove(this._tooltipShowTimeout);
            this._tooltipShowTimeout = null;
        }

        // Hide tooltip after a short delay
        if (!this._tooltipHideTimeout) {
            this._tooltipHideTimeout = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                100,
                () => {
                    this._hideTooltip();
                    this._tooltipHideTimeout = null;
                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _showTooltip() {
        if (this._tooltip) {
            this._tooltip.destroy();
        }

        // Reset value widget references
        this._tooltipValueWidgets = {};

        const stats = this._monitor.getDetailedStats();

        // Create tooltip container
        this._tooltip = new St.BoxLayout({
            style_class: "btop-tooltip",
            vertical: true,
        });

        // Add title
        const title = new St.Label({
            text: _("System Monitor"),
            style_class: "btop-tooltip-title",
        });
        this._tooltip.add_child(title);

        // Add separator
        const separator = new St.Widget({
            style_class: "btop-tooltip-separator",
        });
        this._tooltip.add_child(separator);

        // CPU Section
        const cpuSection = this._createTooltipSection(_("CPU"));
        if (stats.cpu !== null && stats.cpu !== undefined) {
            this._addTooltipRow(
                cpuSection,
                _("Usage"),
                `${stats.cpu}%`,
                "cpuUsage",
            );
        }
        if (stats.cpuCores) {
            this._addTooltipRow(cpuSection, _("Cores"), `${stats.cpuCores}`);
        }
        if (stats.loadAvg) {
            this._addTooltipRow(
                cpuSection,
                _("Load Average"),
                `${stats.loadAvg.load1.toFixed(1)} / ${stats.loadAvg.load5.toFixed(1)} / ${stats.loadAvg.load15.toFixed(1)}`,
                "loadAvg",
            );
        }
        this._tooltip.add_child(cpuSection);

        // Memory Section
        const memSection = this._createTooltipSection(_("Memory"));
        if (stats.memPercent !== undefined) {
            this._addTooltipRow(
                memSection,
                _("Usage"),
                `${stats.memPercent}%`,
                "memUsage",
            );
            this._addTooltipRow(
                memSection,
                _("Used / Total"),
                `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}`,
                "memUsedTotal",
            );
            this._addTooltipRow(
                memSection,
                _("Available"),
                formatBytes(stats.memAvailable),
                "memAvailable",
            );
            this._addTooltipRow(
                memSection,
                _("Buffers / Cached"),
                `${formatBytes(stats.memBuffers)} / ${formatBytes(stats.memCached)}`,
                "memBuffersCached",
            );
        }
        this._tooltip.add_child(memSection);

        // Swap Section
        if (stats.swapTotal && stats.swapTotal > 0) {
            const swapSection = this._createTooltipSection(_("Swap"));
            this._addTooltipRow(
                swapSection,
                _("Usage"),
                `${stats.swapPercent}%`,
                "swapUsage",
            );
            this._addTooltipRow(
                swapSection,
                _("Used / Total"),
                `${formatBytes(stats.swapUsed)} / ${formatBytes(stats.swapTotal)}`,
                "swapUsedTotal",
            );
            this._tooltip.add_child(swapSection);
        }

        // Network Section
        const netSection = this._createTooltipSection(_("Network"));
        if (stats.netRxSpeed !== undefined) {
            this._addTooltipRow(
                netSection,
                _("Download"),
                `${formatBytes(stats.netRxSpeed)}/s`,
                "netDownload",
            );
            this._addTooltipRow(
                netSection,
                _("Upload"),
                `${formatBytes(stats.netTxSpeed)}/s`,
                "netUpload",
            );
        }
        if (stats.netRxTotal !== undefined) {
            this._addTooltipRow(
                netSection,
                _("Total Received"),
                formatBytes(stats.netRxTotal),
                "netRxTotal",
            );
            this._addTooltipRow(
                netSection,
                _("Total Sent"),
                formatBytes(stats.netTxTotal),
                "netTxTotal",
            );
        }
        if (stats.netInterfaces && stats.netInterfaces.length > 0) {
            // Show up to 3 active interfaces
            const activeInterfaces = stats.netInterfaces.slice(0, 3);
            for (const iface of activeInterfaces) {
                this._addTooltipRow(
                    netSection,
                    iface.name,
                    `↓${formatBytes(iface.rx)} ↑${formatBytes(iface.tx)}`,
                );
            }
        }
        this._tooltip.add_child(netSection);

        // Uptime Section
        if (stats.uptime) {
            const uptimeSection = this._createTooltipSection(_("System"));
            this._addTooltipRow(
                uptimeSection,
                _("Uptime"),
                stats.uptime,
                "uptime",
            );
            this._tooltip.add_child(uptimeSection);
        }

        // Position tooltip below the panel button
        Main.layoutManager.addTopChrome(this._tooltip);

        const [x, y] = this.get_transformed_position();
        const [width, height] = this.get_size();
        const tooltipWidth = this._tooltip.get_preferred_width(-1)[1];
        const panelHeight = Main.panel.height;

        // Center tooltip under the indicator, but keep it on screen
        let tooltipX = x + width / 2 - tooltipWidth / 2;
        const monitorGeometry =
            Main.layoutManager.primaryMonitor || Main.layoutManager.monitors[0];
        if (tooltipX + tooltipWidth > monitorGeometry.width) {
            tooltipX = monitorGeometry.width - tooltipWidth - 5;
        }
        if (tooltipX < 5) {
            tooltipX = 5;
        }

        this._tooltip.set_position(Math.round(tooltipX), panelHeight + 5);

        // Start live update timer for tooltip
        this._startTooltipUpdates();
    }

    _startTooltipUpdates() {
        // Stop any existing timer
        this._stopTooltipUpdates();

        // Update tooltip at the same rate as the main display
        const refreshRate = this._settings.get_int("refresh-rate");
        this._tooltipUpdateTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            refreshRate,
            () => {
                this._updateTooltipValues();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _stopTooltipUpdates() {
        if (this._tooltipUpdateTimer) {
            GLib.source_remove(this._tooltipUpdateTimer);
            this._tooltipUpdateTimer = null;
        }
    }

    _updateTooltipValues() {
        // Check if tooltip is still visible
        if (!this._tooltip) {
            this._stopTooltipUpdates();
            return;
        }

        const stats = this._monitor.getDetailedStats();
        const w = this._tooltipValueWidgets;

        // Update CPU values
        if (w.cpuUsage && stats.cpu !== null && stats.cpu !== undefined) {
            w.cpuUsage.text = `${stats.cpu}%`;
        }
        if (w.loadAvg && stats.loadAvg) {
            w.loadAvg.text = `${stats.loadAvg.load1.toFixed(1)} / ${stats.loadAvg.load5.toFixed(1)} / ${stats.loadAvg.load15.toFixed(1)}`;
        }

        // Update Memory values
        if (w.memUsage && stats.memPercent !== undefined) {
            w.memUsage.text = `${stats.memPercent}%`;
        }
        if (w.memUsedTotal && stats.memUsed !== undefined) {
            w.memUsedTotal.text = `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}`;
        }
        if (w.memAvailable && stats.memAvailable !== undefined) {
            w.memAvailable.text = formatBytes(stats.memAvailable);
        }
        if (w.memBuffersCached && stats.memBuffers !== undefined) {
            w.memBuffersCached.text = `${formatBytes(stats.memBuffers)} / ${formatBytes(stats.memCached)}`;
        }

        // Update Swap values
        if (w.swapUsage && stats.swapPercent !== undefined) {
            w.swapUsage.text = `${stats.swapPercent}%`;
        }
        if (w.swapUsedTotal && stats.swapUsed !== undefined) {
            w.swapUsedTotal.text = `${formatBytes(stats.swapUsed)} / ${formatBytes(stats.swapTotal)}`;
        }

        // Update Network values
        if (w.netDownload && stats.netRxSpeed !== undefined) {
            w.netDownload.text = `${formatBytes(stats.netRxSpeed)}/s`;
        }
        if (w.netUpload && stats.netTxSpeed !== undefined) {
            w.netUpload.text = `${formatBytes(stats.netTxSpeed)}/s`;
        }
        if (w.netRxTotal && stats.netRxTotal !== undefined) {
            w.netRxTotal.text = formatBytes(stats.netRxTotal);
        }
        if (w.netTxTotal && stats.netTxTotal !== undefined) {
            w.netTxTotal.text = formatBytes(stats.netTxTotal);
        }

        // Update Uptime
        if (w.uptime && stats.uptime) {
            w.uptime.text = stats.uptime;
        }
    }

    _createTooltipSection(title) {
        const section = new St.BoxLayout({
            style_class: "btop-tooltip-section",
            vertical: true,
        });

        const header = new St.Label({
            text: title,
            style_class: "btop-tooltip-section-header",
        });
        section.add_child(header);

        return section;
    }

    _addTooltipRow(section, label, value, key = null) {
        const row = new St.BoxLayout({
            style_class: "btop-tooltip-row",
        });

        const labelWidget = new St.Label({
            text: label,
            style_class: "btop-tooltip-label",
            x_expand: true,
        });
        row.add_child(labelWidget);

        const valueWidget = new St.Label({
            text: value,
            style_class: "btop-tooltip-value",
        });
        row.add_child(valueWidget);

        // Store reference for live updates if key provided
        if (key) {
            this._tooltipValueWidgets[key] = valueWidget;
        }

        section.add_child(row);
    }

    _hideTooltip() {
        this._stopTooltipUpdates();
        this._tooltipValueWidgets = {};

        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
    }

    destroy() {
        this._stopMonitoring();

        // Clean up tooltip timeouts
        if (this._tooltipShowTimeout) {
            GLib.source_remove(this._tooltipShowTimeout);
            this._tooltipShowTimeout = null;
        }
        if (this._tooltipHideTimeout) {
            GLib.source_remove(this._tooltipHideTimeout);
            this._tooltipHideTimeout = null;
        }
        this._hideTooltip();

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
