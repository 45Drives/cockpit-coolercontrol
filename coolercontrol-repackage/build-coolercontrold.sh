#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")

cd "$SCRIPT_DIR" || exit $?

IMAGE_PREFIX="cockpit-coolercontrol-builder-"

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

TARGETS=()
for dockerfile in ./docker/*.dockerfile; do
    TARGET="${dockerfile#./docker/}"
    TARGET="${TARGET%.dockerfile}"
    if [[ -z "$*" ]] || { printf '%s\0' "$@" | grep -F -x -z -q -- "$TARGET"; }; then
        TARGETS+=("$TARGET")
    fi
done

echo Building for targets: "${TARGETS[@]}"

cat <<EOF
################################
# BUILDING IMAGES
################################
EOF

build_pids=()

for target in "${TARGETS[@]}"; do
    (
    echo "building $IMAGE_PREFIX$target..."
    docker build --pull -t "$IMAGE_PREFIX$target" --file "./docker/$target.dockerfile" ./docker > "log/$IMAGE_PREFIX$target.log" 2>&1 
    result=$?
    echo "$IMAGE_PREFIX$target done ($result)"
    exit $result
    ) &
    build_pids+=($!)
done

for pid in "${build_pids[@]}"; do
    if wait "$pid"; then
        continue
    else
        result=$?
        echo "Build failed with PID $pid" >&2
        cat "log/$IMAGE_PREFIX$target.log" >&2
        exit $result
    fi
done

mkdir -p sources out log

shopt -s nullglob
for spec in *.spec; do
    echo "Pulling $(basename "$spec" .spec) sources"
    docker run --rm "${CONTAINER_RUN_OPTIONS[@]}" --volume "./$spec:/$spec:ro,z" --volume "./sources:/out:rw,z" "$IMAGE_PREFIX"rocky-el9 spectool --get-files --directory /out "/$spec"
done
shopt -u nullglob

RESULT=0

JOBS=()

kill_jobs() {
    for job in "${JOBS[@]}"; do
        pid="${job%%:*}"
        if kill "$pid" 2>/dev/null; then
            wait "$pid"
        fi
    done
}

trap 'kill_jobs' EXIT

for target in "${TARGETS[@]}"; do
    echo "starting build for $target"
    (
        mkdir -p "out/$target"
        docker run "${CONTAINER_RUN_OPTIONS[@]}" \
            --volume "$SCRIPT_DIR/sources:/sources:ro,z" \
            --volume "$SCRIPT_DIR/patches:/patches:ro,z" \
            --volume "$SCRIPT_DIR/coolercontrold.spec:/home/rpmbuilder/rpmbuild/SPECS/coolercontrold.spec:ro,z" \
            --volume "$SCRIPT_DIR/debian:/debian:ro,z" \
            --volume "$SCRIPT_DIR/out/$target:/out:rw,Z" \
            "$IMAGE_PREFIX$target" > "log/$target.log" 2>&1 
        result=$?
        echo "$target exited $result"
        exit $result
    ) &
    JOBS+=("$!:$target")
done

for job in "${JOBS[@]}"; do
    pid="${job%%:*}"
    target="${job#*:}"
    if wait "$pid"; then
        echo "Build succeeded for $target"
    else
        RESULT=$?
        echo "Build failed for $target" >&2
        cat log/"$target.log" >&2
    fi
    JOBS=( "${JOBS[@]/$job}" )
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

