#!/bin/bash
#########################################################
# Fork installer for this Mail-in-a-Box fork.
#
# Run on a fresh Ubuntu 22.04 machine like this:
#
#   curl -sL https://raw.githubusercontent.com/aguycalled/mailinabox/main/setup.sh | sudo bash
#
# This clones the fork and launches the normal Mail-in-a-Box setup. Override
# the source repo or branch with environment variables, e.g.:
#
#   curl -sL .../setup.sh | sudo SOURCE=https://github.com/you/mailinabox BRANCH=mybranch bash
#########################################################

# Which repository and branch to install from.
if [ -z "$SOURCE" ]; then
	SOURCE=https://github.com/aguycalled/mailinabox
fi
if [ -z "$BRANCH" ]; then
	BRANCH=main
fi

# Must run as root.
if [[ $EUID -ne 0 ]]; then
	echo "This script must be run as root. Did you leave out sudo?"
	exit 1
fi

# Only Ubuntu 22.04 is supported (same as upstream Mail-in-a-Box on this branch).
UBUNTU_VERSION=$( lsb_release -d 2>/dev/null | sed 's/.*:\s*//' | sed 's/\([0-9]*\.[0-9]*\)\.[0-9]/\1/' )
if [ "$UBUNTU_VERSION" != "Ubuntu 22.04 LTS" ]; then
	echo "This installer requires a machine running Ubuntu 22.04 LTS."
	echo "Detected: ${UBUNTU_VERSION:-unknown}"
	exit 1
fi

# Clone the fork if we don't already have it.
if [ ! -d "$HOME/mailinabox" ]; then
	if [ ! -f /usr/bin/git ]; then
		echo "Installing git . . ."
		apt-get -q -q update --allow-releaseinfo-change
		DEBIAN_FRONTEND=noninteractive apt-get -q -q install -y git < /dev/null
		echo
	fi

	echo "Downloading Mail-in-a-Box ($SOURCE, branch $BRANCH) . . ."
	git clone -b "$BRANCH" --depth 1 "$SOURCE" "$HOME/mailinabox" < /dev/null
	echo
fi

cd "$HOME/mailinabox" || exit 1

# Make sure we're on the requested branch and up to date.
git fetch --depth 1 --force origin "$BRANCH" < /dev/null 2> /dev/null
git checkout -q "$BRANCH" 2> /dev/null
git reset --hard -q "origin/$BRANCH" 2> /dev/null

# Launch the normal setup.
setup/start.sh
