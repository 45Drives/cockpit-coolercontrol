FROM ubuntu:22.04

ARG RUST_VERSION=1.95.0

ENV TZ=America/Glace_Bay
ENV CARGO_HOME=/opt/cargo
ENV RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt update && apt upgrade -y

RUN apt install -y \
    git make cmake build-essential fakeroot \
    devscripts debhelper pkg-config \
    autoconf gcc g++ libgio3.0-cil-dev libsystemd-dev \
    python3 libssh-dev gettext libxslt1-dev \
    libappstream-glib-dev appstream sudo equivs curl gpg \
    liquidctl \
    dh-python \
    pybuild-plugin-pyproject \
    python3-all \
    python3-setuptools \
    python3-build \
    python3-setproctitle \
    python3-fastapi \
    python3-uvicorn \
    build-essential \
    cmake \
    qt6-base-dev \
    qt6-webengine-dev \
    qt6-webengine-dev-tools \
    libdrm-dev

RUN rm /var/lib/man-db/auto-update

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -

RUN apt install -y nodejs

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "$RUST_VERSION" \
    && test -x "$CARGO_HOME/bin/cargo" \
    && test -x "$CARGO_HOME/bin/rustc"

RUN rust_series="${RUST_VERSION%.*}" \
    && printf '%s\n' \
    'Section: devel' \
    'Priority: optional' \
    "Package: cargo-$rust_series" \
    "Version: $RUST_VERSION" \
    'Architecture: all' \
    'Description: Rust package manager supplied by rustup' \
    ' Compatibility package for the rustup-managed Cargo toolchain.' \
    > "/tmp/cargo-$rust_series-control" \
    && cd /tmp \
    && equivs-build "cargo-$rust_series-control" \
    && apt install -y "./cargo-${rust_series}_${RUST_VERSION}_all.deb" \
    && rm -f "cargo-$rust_series-control" "cargo-${rust_series}_${RUST_VERSION}_all.deb"

RUN useradd -u 1000 -m debbuilder
RUN usermod -aG sudo debbuilder
RUN echo '%sudo ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

USER debbuilder
WORKDIR /home/debbuilder

RUN mkdir -p /home/debbuilder/build

COPY package-deb.sh /package.sh

CMD [ "/package.sh" ]
