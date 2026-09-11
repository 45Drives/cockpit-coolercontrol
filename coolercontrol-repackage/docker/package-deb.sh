#!/usr/bin/env bash

set -euo pipefail

DEBIAN_VERSION=$(cd / && dpkg-parsechangelog --show-field Version)
UPSTREAM_VERSION=${DEBIAN_VERSION#*:}
UPSTREAM_VERSION=${UPSTREAM_VERSION%-*}
echo "Version: $DEBIAN_VERSION (upstream: $UPSTREAM_VERSION)"

rm -rf build
mkdir -p build
ln -sf "/sources/coolercontrol-$UPSTREAM_VERSION.tar.gz" \
    "coolercontrol_$UPSTREAM_VERSION.orig.tar.gz"
ln -sf "/sources/coolercontrold-vendor-$UPSTREAM_VERSION.tar.gz" \
    "coolercontrol_$UPSTREAM_VERSION.orig-cargo-vendor.tar.gz"
tar -xf /sources/coolercontrol-"$UPSTREAM_VERSION".tar.gz --strip-components=1 --directory build
mkdir -p build/cargo-vendor
tar -xf /sources/coolercontrold-vendor-"$UPSTREAM_VERSION".tar.gz --directory build/cargo-vendor
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

CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")

if [[ "$CODENAME" == "focal" ]]; then
    sed -i "s/debhelper-compat (= 13)/debhelper-compat (= 12)/g" build/debian/control
    sed -i "s/cargo (>= 1.88) \| cargo-1.91 \| cargo-1.88/cargo-1.80/g" build/debian/control
fi

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
