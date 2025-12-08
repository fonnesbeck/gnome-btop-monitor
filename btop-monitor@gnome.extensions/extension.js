import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// Monitor types
const MonitorType = {
    CPU: 'cpu',
    MEMORY: 'memory',
    SWAP: 'swap',
    LOAD: 'load',
};

// Labels for monitor types
const TEXT_LABELS = {
    cpu: 'CPU',
    memory: 'MEM',
    swap: 'SWAP',
    load: 'LOAD',
};

const EMOJI_LABELS = {
    cpu: '\u{1F5A5}',      // 🖥️ Desktop Computer
    memory: '\u{1F9E0}',   // 🧠 Brain
    swap: '\u{1F4BE}',     // 💾 Floppy Disk
    load: '\u{26A1}',      // ⚡ High Voltage
};

// Terminal detection order (first found wins)
const TERMINAL_COMMANDS = [
    ['ptyxis', 'ptyxis -e %c'],
    ['ghostty', 'ghostty -e %c'],
    ['kgx', 'kgx -e %c'],
    ['gnome-terminal', 'gnome-terminal -- %c'],
    ['kitty', 'kitty %c'],
    ['alacritty', 'alacritty -e %c'],
    ['konsole', 'konsole -e %c'],
    ['terminator', 'terminator -e %c'],
    ['xterm', 'xterm -e %c'],
];

class SystemMonitor {
    constructor() {
        this._lastCpuData = null;
    }

    // Read CPU usage from /proc/stat
    getCpuUsage() {
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/stat');
            if (!ok) return null;

            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');
            const cpuLine = lines.find(line => line.startsWith('cpu '));

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
            const [ok, contents] = GLib.file_get_contents('/proc/meminfo');
            if (!ok) return null;

            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');

            const getValue = (name) => {
                const line = lines.find(l => l.startsWith(name));
                if (!line) return 0;
                const match = line.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };

            const total = getValue('MemTotal:');
            const available = getValue('MemAvailable:');

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
            const [ok, contents] = GLib.file_get_contents('/proc/meminfo');
            if (!ok) return null;

            const decoder = new TextDecoder('utf-8');
            const lines = decoder.decode(contents).split('\n');

            const getValue = (name) => {
                const line = lines.find(l => l.startsWith(name));
                if (!line) return 0;
                const match = line.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };

            const total = getValue('SwapTotal:');
            const free = getValue('SwapFree:');

            if (total === 0) return 0; // No swap configured

            const used = total - free;
            return Math.round((used / total) * 100);
        } catch (e) {
            console.error(`[Btop Monitor] Error reading swap: ${e}`);
            return null;
        }
    }

    // Read system load average from /proc/loadavg
    getLoadAverage() {
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/loadavg');
            if (!ok) return null;

            const decoder = new TextDecoder('utf-8');
            const text = decoder.decode(contents);
            const parts = text.split(' ');

            // Return 1-minute load average
            return parseFloat(parts[0]).toFixed(2);
        } catch (e) {
            console.error(`[Btop Monitor] Error reading load: ${e}`);
            return null;
        }
    }

    destroy() {
        this._lastCpuData = null;
    }
}

class BtopIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(extension) {
        super(0.0, _('Btop Monitor'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._monitor = new SystemMonitor();
        this._updateTimer = null;

        // Create the label for the top bar
        this._label = new St.Label({
            text: 'CPU --%',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'btop-monitor-label',
        });

        this.add_child(this._label);

        // Connect click handler
        this.connect('button-press-event', this._onClick.bind(this));

        // Connect settings changes
        this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));

        // Start monitoring
        this._startMonitoring();
    }

    _startMonitoring() {
        // Get initial reading (CPU needs two samples)
        this._updateDisplay();

        // Start periodic updates
        const refreshRate = this._settings.get_int('refresh-rate');
        this._updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, refreshRate, () => {
            this._updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopMonitoring() {
        if (this._updateTimer) {
            GLib.source_remove(this._updateTimer);
            this._updateTimer = null;
        }
    }

    _updateDisplay() {
        const monitorType = this._settings.get_string('monitor-type');
        const useEmoji = this._settings.get_boolean('use-emoji');
        let value = null;
        let isPercentage = true;

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
            case MonitorType.LOAD:
                value = this._monitor.getLoadAverage();
                isPercentage = false;
                break;
            default:
                value = this._monitor.getCpuUsage();
        }

        // Get the appropriate label
        const labelType = monitorType || 'cpu';
        const label = useEmoji ? EMOJI_LABELS[labelType] : TEXT_LABELS[labelType];

        // Update text
        if (value !== null) {
            if (isPercentage) {
                this._label.text = `${label} ${value}%`;
                this._updateColor(value);
            } else {
                this._label.text = `${label} ${value}`;
                // For load average, compare against number of CPUs
                this._updateColorForLoad(parseFloat(value));
            }
        } else {
            this._label.text = `${label} --%`;
            this._label.style_class = 'btop-monitor-label';
        }
    }

    _updateColor(percentage) {
        const yellowThreshold = this._settings.get_int('yellow-threshold');
        const redThreshold = this._settings.get_int('red-threshold');

        this._label.remove_style_class_name('btop-monitor-normal');
        this._label.remove_style_class_name('btop-monitor-warning');
        this._label.remove_style_class_name('btop-monitor-critical');

        if (percentage >= redThreshold) {
            this._label.add_style_class_name('btop-monitor-critical');
        } else if (percentage >= yellowThreshold) {
            this._label.add_style_class_name('btop-monitor-warning');
        } else {
            this._label.add_style_class_name('btop-monitor-normal');
        }
    }

    _updateColorForLoad(loadValue) {
        // Get number of CPU cores for load comparison
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/cpuinfo');
            if (ok) {
                const decoder = new TextDecoder('utf-8');
                const text = decoder.decode(contents);
                const cpuCount = (text.match(/^processor/gm) || []).length || 1;

                // Convert load to percentage relative to CPU count
                const loadPercentage = (loadValue / cpuCount) * 100;
                this._updateColor(loadPercentage);
                return;
            }
        } catch (e) {
            console.error(`[Btop Monitor] Error getting CPU count: ${e}`);
        }

        // Fallback: assume 4 cores
        this._updateColor((loadValue / 4) * 100);
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

        let terminal = this._settings.get_string('terminal-command');
        const btopCommand = this._settings.get_string('btop-command');

        // Handle auto-detection
        if (terminal === 'auto') {
            terminal = this._detectTerminal();
            if (!terminal) {
                Main.notifyError(_('Btop Monitor'), _('No terminal emulator found. Please install one or select manually in settings.'));
                return Clutter.EVENT_STOP;
            }
        }

        try {
            // Try to spawn the terminal with btop
            const fullCommand = terminal.replace('%c', btopCommand);
            GLib.spawn_command_line_async(fullCommand);
        } catch (e) {
            console.error(`[Btop Monitor] Error launching btop: ${e}`);
            Main.notifyError(_('Btop Monitor'), _('Failed to launch terminal. Check your settings.'));
        }

        return Clutter.EVENT_STOP;
    }

    _onSettingsChanged(settings, key) {
        if (key === 'refresh-rate') {
            this._stopMonitoring();
            this._startMonitoring();
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

        this._monitor.destroy();
        this._monitor = null;

        super.destroy();
    }
}

// Required import for registerClass
import GObject from 'gi://GObject';

export default class BtopMonitorExtension extends Extension {
    enable() {
        this._indicator = new BtopIndicator(this);

        // Add to panel (right side by default)
        const position = this.getSettings().get_string('panel-position');
        const index = this.getSettings().get_int('panel-index');

        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator, index, position);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
