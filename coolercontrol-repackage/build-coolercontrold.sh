#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")

cd "$SCRIPT_DIR" || exit $?

if command -v podman >/dev/null 2>&1; then
    CONTAINER_ENGINE=podman
    CONTAINER_RUN_OPTIONS=(--userns=keep-id)
elif command -v docker >/dev/null 2>&1; then
    CONTAINER_ENGINE=docker
    CONTAINER_RUN_OPTIONS=()
else
    echo "podman or docker required!" >&2
    exit 1
fi
docker() {
    "$CONTAINER_ENGINE" "$@"
}

IMAGES=()

cat <<EOF
################################
# BUILDING IMAGES
################################
EOF

build_pids=()

for dockerfile in ./docker/*.dockerfile; do
    IMAGE="${dockerfile#./docker/}"
    IMAGE="${IMAGE%.dockerfile}"
    IMAGE="cockpit-coolercontrol-builder-$IMAGE"
    (
    echo "building $IMAGE..."
    docker build --pull -t "$IMAGE" --file "$dockerfile" ./docker # >/dev/null 2>&1
    result=$?
    echo "$IMAGE done ($result)"
    exit $result
    ) &
    build_pids+=($!)

    IMAGES+=("$IMAGE")
done

for pid in "${build_pids[@]}"; do
    if ! wait "$pid"; then
        result=$?
        echo "Build failed with PID $pid" >&2
        exit $result
    fi
done

mkdir -p sources out log

shopt -s nullglob
for spec in rpmbuild/SPECS/*.spec; do
    echo "Pulling $(basename "$spec" .spec) sources"
    docker run --rm "${CONTAINER_RUN_OPTIONS[@]}" --volume "./$spec:/$spec:ro,z" --volume "./sources:/out:rw,z" cockpit-coolercontrol-builder-rockylinux-9 spectool --get-files --directory /out "/$spec"
done
shopt -u nullglob

RESULT=0

JOBS=()

for image in "${IMAGES[@]}"; do
    OS_NAME=${image#cockpit-coolercontrol-builder-}
    echo "starting build for $OS_NAME"
    (
        mkdir -p "out/$OS_NAME"
        docker run --rm "${CONTAINER_RUN_OPTIONS[@]}" \
            --volume "$SCRIPT_DIR/sources:/sources:ro,z" \
            --volume "$SCRIPT_DIR/coolercontrold.spec:/home/rpmbuilder/rpmbuild/SPECS/coolercontrold.spec:ro,z" \
            --volume "$SCRIPT_DIR/debian:/debian:ro,z" \
            --volume "$SCRIPT_DIR/out/$OS_NAME:/out:rw,Z" \
            "$image" > "log/$OS_NAME.log" 2>&1 
        result=$?
        echo "$OS_NAME exited $result"
        exit $result
    ) &
    JOBS+=("$!:$OS_NAME")
done

for job in "${JOBS[@]}"; do
    pid="${job%%:*}"
    OS_NAME="${job#*:}"
    if ! wait "$pid"; then
        RESULT=$?
        echo "Build failed for $OS_NAME" >&2
        cat log/"$OS_NAME.log" >&2
    else
        echo "Build succeeded for $OS_NAME"
    fi
done

exit $RESULT

# RESULT=0
# for dep in mock rpmbuild spectool; do
#     command -v $dep >/dev/null 2>&1 || { echo "$dep required" >&2; RESULT=1; }
# done
# if [[ $RESULT -ne 0 ]]; then
#     exit $RESULT
# fi

# echo "Building RPMs"

# mkdir -p "$SCRIPT_DIR/rpmbuild/"{SOURCES,SRPMS,RPMS,SPECS}

# shopt -s nullglob
# for spec in rpmbuild/SPECS/*.spec; do
#     spectool --define "_topdir $SCRIPT_DIR/rpmbuild" --get-files --sourcedir "$spec"

#     echo "Building $(basename "$spec") SRPM"
#     rpmbuild --define "_topdir $SCRIPT_DIR/rpmbuild" -bs "$spec"

#     for dist in "${MOCK_DISTS[@]}"; do
#         echo "Building $(basename "$spec") RPM for $dist"
#         mock -r "$dist" --rebuild "$SCRIPT_DIR/rpmbuild/SRPMS/$(basename "$spec" .spec)"-*.src.rpm --resultdir "$SCRIPT_DIR/rpmbuild/RPMS"
#     done
# done

# touch "$SCRIPT_DIR/rpmbuild/RPMS" # update mtime of RPMS dir for Makefile

