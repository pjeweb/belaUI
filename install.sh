#!/bin/bash

# Install script to install the belaUI fork on a BELABOX

# Variables
USE_CERAUI=${USE_CERAUI:-false}
RELEASE_TARBALL="belaUI.tar.xz"
RELEASE_URL="https://github.com/pjeweb/belaUI/releases/latest/download/$RELEASE_TARBALL"
CERAUI_RELEASE_TARBALL="ceraui-extended.tar.xz"
CERAUI_RELEASE_URL="https://github.com/CERALIVE/CeraUI/releases/latest/download/$CERAUI_RELEASE_TARBALL"
TEMP_DIR="$HOME/.tmp/belaui"
TARGET_DIR="/opt/belaUI"

# Check if dependencies are installed
RSYNC_INSTALLED=$(rsync --version 2>/dev/null) || false

# stop on error
set -e

if [ -z "$RSYNC_INSTALLED" ]; then
  echo "Installing missing dependencies"

  sudo apt-get update
  sudo apt-get install -y rsync
fi

# Clone the repository branch into a temporary directory
if [ -d "$TEMP_DIR" ]; then
  rm -rf "$TEMP_DIR"
fi

# Install latest release from tarball to temporary directory
echo "Downloading and extracting latest release"
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR" || exit
wget -q --show-progress $RELEASE_URL
tar xf $RELEASE_TARBALL

# Ensure target directory exists
mkdir -p $TARGET_DIR

# Copy files from dist to target directory while excluding specified files
echo "Installing belaUI"
sudo rsync -rltz --delete --chown=root:root \
  --exclude auth_tokens.json \
  --exclude config.json \
  --exclude dns_cache.json \
  --exclude gsm_operator_cache.json \
  --exclude relays_cache.json \
  --exclude revision \
  --exclude setup.json \
  "$TEMP_DIR/" $TARGET_DIR

# Cleanup
rm -rf "$TEMP_DIR"

# Set ownership to root:root and preserve permissions
sudo chown -R root:root $TARGET_DIR

# Run the override script
cd $TARGET_DIR || exit
sudo bash ./override-belaui.sh

echo "BelaUI installed and override script executed successfully."

# Check if CeraUI should be installed
if [ "$USE_CERAUI" = "true" ]; then
  echo "Downloading and installing CeraUI content"
  # Create a temporary directory for CeraUI
  CERAUI_TEMP_DIR="$HOME/.tmp/ceraui"
  mkdir -p "$CERAUI_TEMP_DIR"
  cd "$CERAUI_TEMP_DIR" || exit

  # Download and extract CeraUI
  wget -q --show-progress $CERAUI_RELEASE_URL
  tar xf $CERAUI_RELEASE_TARBALL

  # Replace the content of the public folder
  sudo rsync -rltz --delete --chown=root:root "$CERAUI_TEMP_DIR/" "$TARGET_DIR/public/"

  # Cleanup
  rm -rf "$CERAUI_TEMP_DIR"

  echo "CeraUI installed successfully."
fi

echo "You can reset to default by running: sudo $TARGET_DIR/reset-to-default.sh"
