#!/usr/bin/env bash

set -euo pipefail

VERSION=$(cd / && dpkg-parsechangelog --show-field Version)
echo "Version: $VERSION"
tar -xf /sources/coolercontrol-"$VERSION".tar.gz --strip-components=1 --directory build
tar -xf /sources/coolercontrold-vendor-"$VERSION".tar.gz --directory build
rm build/debian
cp -a /debian build/debian

CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")

if [[ "$CODENAME" == "focal" ]]; then
    sed -i "s/debhelper-compat (= 13)/debhelper-compat (= 12)/g" build/debian/control
    sed -i "s/cargo (>= 1.88) \| cargo-1.91 \| cargo-1.88/cargo-1.80/g" build/debian/control
fi

echo Installing build dependencies
echo "####################################################"
yes | sudo mk-build-deps -i build/debian/control -r || echo "WARNING: mk-build-deps exited with code $?"

sed -i "s/UNRELEASED/$CODENAME/g" build/debian/changelog

echo
echo Building package
echo "####################################################"
(cd build && dpkg-buildpackage --no-sign --build=full)
echo Done
echo "####################################################"

cp -a build/*.deb build/**/*.deb /out/
