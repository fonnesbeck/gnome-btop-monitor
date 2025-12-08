import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Terminal configurations: [name, command-template]
const TERMINALS = [
  ["Auto-detect", "auto"],
  ["GNOME Console (ptyxis)", "ptyxis -e %c"],
  ["GNOME Console (kgx)", "kgx -e %c"],
  ["GNOME Terminal", "gnome-terminal -- %c"],
  ["Ghostty", "ghostty -e %c"],
  ["Kitty", "kitty %c"],
  ["Alacritty", "alacritty -e %c"],
  ["Konsole", "konsole -e %c"],
  ["Terminator", "terminator -e %c"],
  ["xterm", "xterm -e %c"],
  ["Custom...", "custom"],
];

// Monitor type configurations
const MONITOR_TYPES = [
  { id: "cpu", name: "CPU Usage", icon: "org.gnome.SystemMonitor-symbolic" },
  {
    id: "memory",
    name: "Memory Usage",
    icon: "drive-harddisk-solidstate-symbolic",
  },
  { id: "swap", name: "Swap Usage", icon: "drive-harddisk-system-symbolic" },
  { id: "net", name: "Network Up/Down", icon: "network-wired-symbolic" },
];

export default class BtopMonitorPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    // Create a preferences page
    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "utilities-system-monitor-symbolic",
    });
    window.add(page);

    // Monitor Settings Group
    const monitorGroup = new Adw.PreferencesGroup({
      title: _("Monitor Settings"),
      description: _("Select which system resources to display in the top bar"),
    });
    page.add(monitorGroup);

    // Get current monitor types
    const getMonitorTypes = () => {
      try {
        const types = settings.get_strv("monitor-types");
        if (types && types.length > 0) {
          return types;
        }
      } catch (e) {
        // Fall back to legacy
      }
      return [settings.get_string("monitor-type") || "cpu"];
    };

    const setMonitorTypes = (types) => {
      settings.set_strv("monitor-types", types);
    };

    // Create toggle rows for each monitor type
    const monitorToggles = new Map();

    MONITOR_TYPES.forEach((monitorType) => {
      const toggle = new Gtk.Switch({
        active: getMonitorTypes().includes(monitorType.id),
        valign: Gtk.Align.CENTER,
      });

      const row = new Adw.ActionRow({
        title: _(monitorType.name),
        icon_name: monitorType.icon,
      });
      row.add_suffix(toggle);
      row.activatable_widget = toggle;

      toggle.connect("notify::active", () => {
        const currentTypes = getMonitorTypes();
        if (toggle.active) {
          if (!currentTypes.includes(monitorType.id)) {
            // Add in preferred order
            const orderedTypes = MONITOR_TYPES.filter(
              (mt) => currentTypes.includes(mt.id) || mt.id === monitorType.id,
            ).map((mt) => mt.id);
            setMonitorTypes(orderedTypes);
          }
        } else {
          const newTypes = currentTypes.filter((t) => t !== monitorType.id);
          // Ensure at least one monitor is selected
          if (newTypes.length === 0) {
            toggle.active = true;
            return;
          }
          setMonitorTypes(newTypes);
        }
      });

      monitorToggles.set(monitorType.id, toggle);
      monitorGroup.add(row);
    });

    // Refresh Rate
    const refreshRow = new Adw.SpinRow({
      title: _("Refresh Rate"),
      subtitle: _("Update interval in milliseconds"),
      adjustment: new Gtk.Adjustment({
        lower: 500,
        upper: 10000,
        step_increment: 100,
        page_increment: 1000,
        value: settings.get_int("refresh-rate"),
      }),
    });
    settings.bind(
      "refresh-rate",
      refreshRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    monitorGroup.add(refreshRow);

    // Use Icon Toggle
    const iconSwitch = new Gtk.Switch({
      active: settings.get_boolean("use-icon"),
      valign: Gtk.Align.CENTER,
    });
    const iconRow = new Adw.ActionRow({
      title: _("Use Icons"),
      subtitle: _("Show symbolic icons instead of text labels"),
    });
    iconRow.add_suffix(iconSwitch);
    iconRow.activatable_widget = iconSwitch;
    settings.bind(
      "use-icon",
      iconSwitch,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
    monitorGroup.add(iconRow);

    // Thresholds Group
    const thresholdsGroup = new Adw.PreferencesGroup({
      title: _("Color Thresholds"),
      description: _("Configure when the indicator changes color"),
    });
    page.add(thresholdsGroup);

    // Yellow Threshold
    const yellowRow = new Adw.SpinRow({
      title: _("Yellow Threshold"),
      subtitle: _("Percentage for moderate usage warning"),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int("yellow-threshold"),
      }),
    });
    settings.bind(
      "yellow-threshold",
      yellowRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    thresholdsGroup.add(yellowRow);

    // Red Threshold
    const redRow = new Adw.SpinRow({
      title: _("Red Threshold"),
      subtitle: _("Percentage for heavy usage warning"),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 5,
        page_increment: 10,
        value: settings.get_int("red-threshold"),
      }),
    });
    settings.bind(
      "red-threshold",
      redRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    thresholdsGroup.add(redRow);

    // Terminal Settings Group
    const terminalGroup = new Adw.PreferencesGroup({
      title: _("Terminal Settings"),
      description: _("Configure how btop is launched"),
    });
    page.add(terminalGroup);

    // Terminal Selector
    const terminalRow = new Adw.ComboRow({
      title: _("Terminal"),
      subtitle: _("Select your preferred terminal emulator"),
    });

    const terminalList = new Gtk.StringList();
    TERMINALS.forEach(([name, _cmd]) => terminalList.append(name));
    terminalRow.model = terminalList;

    // Find current terminal in list or set to custom
    const currentCommand = settings.get_string("terminal-command");
    let selectedIndex = TERMINALS.findIndex(
      ([_name, cmd]) => cmd === currentCommand,
    );
    const isCustomCommand = selectedIndex === -1;
    if (isCustomCommand) {
      // Current command is custom
      selectedIndex = TERMINALS.length - 1; // "Custom..." option
    }
    terminalRow.selected = selectedIndex;

    // Custom command entry (shown when "Custom..." is selected)
    // Only pre-fill with current command if it's actually a custom command
    const customCommandRow = new Adw.EntryRow({
      title: _("Custom Command"),
      text: isCustomCommand ? currentCommand : "",
    });

    // Show/hide custom entry based on selection
    const updateCustomVisibility = () => {
      const isCustom = terminalRow.selected === TERMINALS.length - 1;
      customCommandRow.visible = isCustom;
    };
    updateCustomVisibility();

    terminalRow.connect("notify::selected", () => {
      const [_name, cmd] = TERMINALS[terminalRow.selected];
      if (cmd !== "custom") {
        settings.set_string("terminal-command", cmd);
      }
      updateCustomVisibility();
    });

    customCommandRow.connect("changed", () => {
      if (terminalRow.selected === TERMINALS.length - 1) {
        settings.set_string("terminal-command", customCommandRow.text);
      }
    });

    terminalGroup.add(terminalRow);
    terminalGroup.add(customCommandRow);

    // Help text for custom command
    const helpLabel = new Gtk.Label({
      label: _("Use %c as placeholder for the btop command"),
      wrap: true,
      xalign: 0,
      css_classes: ["dim-label"],
      margin_start: 12,
      margin_top: 6,
    });
    terminalGroup.add(helpLabel);

    // Btop Command
    const btopRow = new Adw.EntryRow({
      title: _("Btop Command"),
    });
    settings.bind(
      "btop-command",
      btopRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT,
    );
    terminalGroup.add(btopRow);

    // Panel Position Group
    const positionGroup = new Adw.PreferencesGroup({
      title: _("Panel Position"),
      description: _("Configure where the indicator appears"),
    });
    page.add(positionGroup);

    // Panel Position
    const positionRow = new Adw.ComboRow({
      title: _("Panel Section"),
      subtitle: _("Which section of the top bar"),
    });

    const positions = new Gtk.StringList();
    positions.append("Left");
    positions.append("Center");
    positions.append("Right");
    positionRow.model = positions;

    const posMap = { left: 0, center: 1, right: 2 };
    const reversePosMap = ["left", "center", "right"];
    positionRow.selected = posMap[settings.get_string("panel-position")] || 2;

    positionRow.connect("notify::selected", () => {
      settings.set_string(
        "panel-position",
        reversePosMap[positionRow.selected],
      );
    });
    positionGroup.add(positionRow);

    // Panel Index
    const indexRow = new Adw.SpinRow({
      title: _("Position Index"),
      subtitle: _("Order within the panel section (0 = leftmost)"),
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 20,
        step_increment: 1,
        page_increment: 5,
        value: settings.get_int("panel-index"),
      }),
    });
    settings.bind(
      "panel-index",
      indexRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
    positionGroup.add(indexRow);

    // Note about restart
    const noteGroup = new Adw.PreferencesGroup();
    page.add(noteGroup);

    const noteRow = new Adw.ActionRow({
      subtitle: _(
        "Note: Panel position changes require disabling and re-enabling the extension.",
      ),
    });
    noteGroup.add(noteRow);
  }
}
