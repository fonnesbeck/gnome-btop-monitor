#!/bin/bash

# Btop Monitor Extension Installer

EXTENSION_UUID="btop-monitor@gnome.extensions"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(dirname "$(readlink -f "$0")")/$EXTENSION_UUID"

echo "Installing Btop Monitor extension..."

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Extension source directory not found at $SOURCE_DIR"
    exit 1
fi

# Create extensions directory if it doesn't exist
mkdir -p "$HOME/.local/share/gnome-shell/extensions/"

# Remove existing installation if present
if [ -d "$EXTENSION_DIR" ]; then
    echo "Removing existing installation..."
    rm -rf "$EXTENSION_DIR"
fi

# Copy extension files
echo "Copying extension files..."
cp -r "$SOURCE_DIR" "$EXTENSION_DIR"

# Compile schemas
echo "Compiling GSettings schemas..."
if [ -d "$EXTENSION_DIR/schemas" ]; then
    glib-compile-schemas "$EXTENSION_DIR/schemas/"
    if [ $? -ne 0 ]; then
        echo "Warning: Failed to compile schemas. You may need to install glib2-devel."
    fi
fi

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Restart GNOME Shell:"
echo "   - On X11: Press Alt+F2, type 'r', press Enter"
echo "   - On Wayland: Log out and log back in"
echo ""
echo "2. Enable the extension:"
echo "   gnome-extensions enable $EXTENSION_UUID"
echo ""
echo "3. Configure the extension:"
echo "   gnome-extensions prefs $EXTENSION_UUID"
echo ""
