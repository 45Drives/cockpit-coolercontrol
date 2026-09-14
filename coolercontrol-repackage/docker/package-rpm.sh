#!/usr/bin/env bash

set -euo pipefail

shopt -s nullglob

cp -a /sources/* /patches/* rpmbuild/SOURCES/

for spec in rpmbuild/SPECS/*.spec; do
    echo "Installing $(basename "$spec" .spec) build dependencies"
    echo "####################################################"
    sudo dnf builddep "$spec" -y

    echo "Building $(basename "$spec" .spec) RPM"
    echo "####################################################"
    rpmbuild -ba "$spec" --without check
done

echo Done
echo "####################################################"

shopt -u nullglob
mkdir -p /out/rpms /out/srpms
cp -a rpmbuild/RPMS/* /out/rpms/
cp -a rpmbuild/SRPMS/* /out/srpms/
