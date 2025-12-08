import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

        // Terminal Command
        const terminalRow = new Adw.EntryRow({
            title: _('Terminal Command'),
            text: settings.get_string('terminal-command'),
        });
        terminalRow.connect('changed', () => {
            settings.set_string('terminal-command', terminalRow.text);
        });

        // Add helper text
        const terminalHelperLabel = new Gtk.Label({
            label: _('Use %c as placeholder for btop command.\nExamples: gnome-terminal -- %c, kitty %c, alacritty -e %c'),
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
            margin_start: 12,
            margin_end: 12,
            margin_bottom: 6,
        });

        terminalGroup.add(terminalRow);

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
