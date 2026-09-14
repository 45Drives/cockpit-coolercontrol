#!/usr/bin/env bash

set -euo pipefail

DEBIAN_VERSION=$(cd / && dpkg-parsechangelog --show-field Version)
UPSTREAM_VERSION=${DEBIAN_VERSION#*:}
UPSTREAM_VERSION=${UPSTREAM_VERSION%-*}
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "Version: $DEBIAN_VERSION (upstream: $UPSTREAM_VERSION)"

rm -rf build
mkdir -p build
ln -sf "/sources/coolercontrol-$UPSTREAM_VERSION.tar.gz" \
    "coolercontrol_$UPSTREAM_VERSION.orig.tar.gz"
tar -xf /sources/coolercontrol-"$UPSTREAM_VERSION".tar.gz --strip-components=1 --directory build

ln -sf "/sources/coolercontrold-vendor-$UPSTREAM_VERSION.tar.gz" \
        "build/coolercontrold-vendor-$UPSTREAM_VERSION.tar.gz"

rm -rf build/debian
cp -a /debian build/debian
cp -a /patches build/debian/patches

while read -r patch _; do
    [[ -z "$patch" || "$patch" == \#* ]] && continue
    [[ -f "build/debian/patches/$patch" ]] || {
        echo "Missing patch listed in series: $patch" >&2
        exit 1
    }
done < build/debian/patches/series

echo Installing build dependencies
echo "####################################################"
sudo mk-build-deps \
    --install \
    --remove \
    --tool 'apt-get --yes --no-install-recommends' \
    build/debian/control || echo "WARNING: mk-build-deps exited with code $?"

sed -i "s/UNRELEASED/$CODENAME/g" build/debian/changelog

echo
echo Building package
echo "####################################################"
(cd build && dpkg-buildpackage --no-sign --build=full)
echo Done
echo "####################################################"

shopt -s nullglob
packages=(./*.deb)
if (( ${#packages[@]} == 0 )); then
    echo "No Debian packages were produced" >&2
    find . -type f -name '*.deb'
    exit 1
fi
artifacts=(
    ./*.deb
    ./*.dsc
    ./*.changes
    ./*.buildinfo
    ./*.debian.tar.*
    ./*.orig.tar.*
)
cp -aL "${artifacts[@]}" /out/
