#!/usr/bin/env bash

set -euo pipefail

cp -a /sources/* rpmbuild/SOURCES/

shopt -s nullglob
for spec in rpmbuild/SPECS/*.spec; do
    echo "Installing $(basename "$spec" .spec) build dependencies"
    echo "####################################################"
    sudo dnf builddep "$spec" -y

    echo "Building $(basename "$spec" .spec) RPM"
    echo "####################################################"
    rpmbuild -ba "$spec" --without check
done
shopt -u nullglob

echo Done
echo "####################################################"


cp -a rpmbuild/RPMS/* /out/
