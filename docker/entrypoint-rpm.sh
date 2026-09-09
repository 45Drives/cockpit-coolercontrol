#!/usr/bin/env bash

set -euo pipefail

rpmdev-setuptree

shopt -s nullglob
for spec in rpmbuild/SPECS/*.spec; do
    echo "Pulling $(basename "$spec" .spec) sources"
    spectool --get-files --sourcedir "$spec"

    echo "Installing $(basename "$spec" .spec) build dependencies"
    sudo dnf builddep "$spec" -y

    echo "Building $(basename "$spec" .spec) RPM"
    rpmbuild -ba "$spec" --without check
done

