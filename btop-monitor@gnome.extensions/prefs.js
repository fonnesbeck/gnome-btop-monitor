import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Terminal configurations: [name, command-template]
const TERMINALS = [
    ['Auto-detect', 'auto'],
    ['GNOME Console (ptyxis)', 'ptyxis -e %c'],
    ['GNOME Console (kgx)', 'kgx -e %c'],
    ['GNOME Terminal', 'gnome-terminal -- %c'],
    ['Ghostty', 'ghostty -e %c'],
    ['Kitty', 'kitty %c'],
    ['Alacritty', 'alacritty -e %c'],
    ['Konsole', 'konsole -e %c'],
    ['Terminator', 'terminator -e %c'],
    ['xterm', 'xterm -e %c'],
    ['Custom...', 'custom'],
];

export default class BtopMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(page);

        // Monitor Settings Group
        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Monitor Settings'),
            description: _('Configure what to display in the top bar'),
        });
        page.add(monitorGroup);

        // Monitor Type
        const monitorTypeRow = new Adw.ComboRow({
            title: _('Monitor Type'),
            subtitle: _('Select which system resource to monitor'),
        });

        const monitorTypes = new Gtk.StringList();
        monitorTypes.append('CPU Usage');
        monitorTypes.append('Memory Usage');
        monitorTypes.append('Swap Usage');
        monitorTypes.append('Load Average');
        monitorTypeRow.model = monitorTypes;

        // Map settings value to combo index
        const typeMap = { 'cpu': 0, 'memory': 1, 'swap': 2, 'load': 3 };
        const reverseTypeMap = ['cpu', 'memory', 'swap', 'load'];
        monitorTypeRow.selected = typeMap[settings.get_string('monitor-type')] || 0;

        monitorTypeRow.connect('notify::selected', () => {
            settings.set_string('monitor-type', reverseTypeMap[monitorTypeRow.selected]);
        });
        monitorGroup.add(monitorTypeRow);

        // Refresh Rate
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Rate'),
            subtitle: _('Update interval in milliseconds'),
            adjustment: new Gtk.Adjustment({
                lower: 500,
                upper: 10000,
                step_increment: 100,
                page_increment: 1000,
                value: settings.get_int('refresh-rate'),
            }),
        });
        settings.bind('refresh-rate', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(refreshRow);

        // Use Emoji Toggle
        const emojiRow = new Adw.SwitchRow({
            title: _('Use Emoji Labels'),
            subtitle: _('Show emoji instead of text (e.g. 🖥️ instead of CPU)'),
        });
        settings.bind('use-emoji', emojiRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(emojiRow);

        // Thresholds Group
        const thresholdsGroup = new Adw.PreferencesGroup({
            title: _('Color Thresholds'),
            description: _('Configure when the indicator changes color'),
        });
        page.add(thresholdsGroup);

        // Yellow Threshold
        const yellowRow = new Adw.SpinRow({
            title: _('Yellow Threshold'),
            subtitle: _('Percentage for moderate usage warning'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int('yellow-threshold'),
            }),
        });
        settings.bind('yellow-threshold', yellowRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholdsGroup.add(yellowRow);

        // Red Threshold
        const redRow = new Adw.SpinRow({
            title: _('Red Threshold'),
            subtitle: _('Percentage for heavy usage warning'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int('red-threshold'),
            }),
        });
        settings.bind('red-threshold', redRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholdsGroup.add(redRow);

        // Terminal Settings Group
        const terminalGroup = new Adw.PreferencesGroup({
            title: _('Terminal Settings'),
            description: _('Configure how btop is launched'),
        });
        page.add(terminalGroup);

        // Terminal Selector
        const terminalRow = new Adw.ComboRow({
            title: _('Terminal'),
            subtitle: _('Select your preferred terminal emulator'),
        });

        const terminalList = new Gtk.StringList();
        TERMINALS.forEach(([name, _cmd]) => terminalList.append(name));
        terminalRow.model = terminalList;

        // Custom command entry (shown when "Custom..." is selected)
        const customCommandRow = new Adw.EntryRow({
            title: _('Custom Command'),
            text: settings.get_string('terminal-command'),
        });

        // Find current terminal in list or set to custom
        const currentCommand = settings.get_string('terminal-command');
        let selectedIndex = TERMINALS.findIndex(([_name, cmd]) => cmd === currentCommand);
        if (selectedIndex === -1) {
            // Current command is custom
            selectedIndex = TERMINALS.length - 1; // "Custom..." option
        }
        terminalRow.selected = selectedIndex;

        // Show/hide custom entry based on selection
        const updateCustomVisibility = () => {
            const isCustom = terminalRow.selected === TERMINALS.length - 1;
            customCommandRow.visible = isCustom;
        };
        updateCustomVisibility();

        terminalRow.connect('notify::selected', () => {
            const [_name, cmd] = TERMINALS[terminalRow.selected];
            if (cmd !== 'custom') {
                settings.set_string('terminal-command', cmd);
            }
            updateCustomVisibility();
        });

        customCommandRow.connect('changed', () => {
            if (terminalRow.selected === TERMINALS.length - 1) {
                settings.set_string('terminal-command', customCommandRow.text);
            }
        });

        terminalGroup.add(terminalRow);
        terminalGroup.add(customCommandRow);

        // Help text for custom command
        const helpLabel = new Gtk.Label({
            label: _('Use %c as placeholder for the btop command'),
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
            margin_start: 12,
            margin_top: 6,
        });
        terminalGroup.add(helpLabel);

        // Btop Command
        const btopRow = new Adw.EntryRow({
            title: _('Btop Command'),
            text: settings.get_string('btop-command'),
        });
        btopRow.connect('changed', () => {
            settings.set_string('btop-command', btopRow.text);
        });
        terminalGroup.add(btopRow);

        // Panel Position Group
        const positionGroup = new Adw.PreferencesGroup({
            title: _('Panel Position'),
            description: _('Configure where the indicator appears'),
        });
        page.add(positionGroup);

        // Panel Position
        const positionRow = new Adw.ComboRow({
            title: _('Panel Section'),
            subtitle: _('Which section of the top bar'),
        });

        const positions = new Gtk.StringList();
        positions.append('Left');
        positions.append('Center');
        positions.append('Right');
        positionRow.model = positions;

        const posMap = { 'left': 0, 'center': 1, 'right': 2 };
        const reversePosMap = ['left', 'center', 'right'];
        positionRow.selected = posMap[settings.get_string('panel-position')] || 2;

        positionRow.connect('notify::selected', () => {
            settings.set_string('panel-position', reversePosMap[positionRow.selected]);
        });
        positionGroup.add(positionRow);

        // Panel Index
        const indexRow = new Adw.SpinRow({
            title: _('Position Index'),
            subtitle: _('Order within the panel section (0 = leftmost)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('panel-index'),
            }),
        });
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        positionGroup.add(indexRow);

        // Note about restart
        const noteGroup = new Adw.PreferencesGroup();
        page.add(noteGroup);

        const noteLabel = new Gtk.Label({
            label: _('Note: Panel position changes require disabling and re-enabling the extension.'),
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
        });
        noteGroup.add(noteLabel);
    }
}
