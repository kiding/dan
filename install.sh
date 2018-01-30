#!/bin/bash

# Exit on error
set -e

# macOS or Ubuntu
if [[ `uname` == 'Darwin' ]]; then
  ARCH="macos-64"
  DOWNLOADER='curl -O'
elif [[ `lsb_release -is` == 'Ubuntu' ]]; then
  if [[ `uname -m` == 'x86_64' ]]; then
    ARCH="ubuntu-64";
  else
    ARCH="ubuntu-32";
  fi
  DOWNLOADER='wget'
fi

# Variables
TIZEN_STUDIO=`pwd`/tizen-studio
BIN=web-cli_Tizen_Studio_2.2_${ARCH}.bin
URL=http://download.tizen.org/sdk/Installer/tizen-studio_2.2/${BIN}

PKG=./tizen-studio/package-manager/package-manager-cli.bin
IDE=./tizen-studio/ide/TizenStudio.sh

# Check if Tizen Studio is installed
if [ ! -d ${TIZEN_STUDIO} ]; then
  # Download Tizen Studio CLI
  ${DOWNLOADER} ${URL}
  chmod +x ${BIN}

  # Start the installer
  ./${BIN} --accept-license ${TIZEN_STUDIO}
  rm ${BIN}
fi

# Install the essential packages
${PKG} install --accept-license WEARABLE-3.0-NativeAppDevelopment,cert-add-on,tizen-wearable-extension

# Show further instructions
R=`tput setaf 1`
B=`tput bold`
U=`tput smul`
RST=`tput sgr0`
echo ""; \
echo "${B}++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++${RST}"; \
echo ""; \
echo "❗️ To continue, follow the instructions below ${B}${U}in Tizen Studio IDE.${RST}"; \
echo ""; \
echo "1️⃣  Connect to the target device using ${B}Tools > Device Manager.${RST}"; \
echo "   Make sure debugging mode is enabled on the device."; \
echo "   → See how-to at ${U}http://developer.samsung.com/gear/develop/testing-your-app-on-gear${RST}"; \
echo "     and ${U}https://developer.tizen.org/development/tizen-studio/native-tools/managing-projects/device-manager${RST}"; \
echo ""; \
echo "2️⃣  Create a Samsung certificate profile using ${B}Tools > Certificate Manager.${RST}"; \
echo "   ${U}Perform 1️⃣ first${RST} to make sure your target device is included in the DUID list. "; \
echo "   → See how-to at ${U}http://developer.samsung.com/gear/develop/getting-certificates/create${RST}"; \
echo ""; \
echo "❗️ Now launching ${B}Tizen Studio IDE${RST}..."; \
echo ""; \
echo "${B}++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++${RST} "; \

# Try launching IDE
${IDE} 1>/dev/null 2>/dev/null &
