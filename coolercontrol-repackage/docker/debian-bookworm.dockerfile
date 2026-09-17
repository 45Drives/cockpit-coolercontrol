FROM debian:bookworm

ARG RUST_VERSION=1.95.0

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Glace_Bay
ENV CARGO_HOME=/opt/cargo
ENV RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gpg sudo \
    git make cmake build-essential fakeroot \
    devscripts debhelper equivs pkg-config \
    autoconf gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN rm -f /var/lib/man-db/auto-update

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -

RUN apt-get update && apt-get install -y --no-install-recommends nodejs

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "$RUST_VERSION" \
    && chmod -R a+rX "$CARGO_HOME" "$RUSTUP_HOME"

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
    && apt-get install -y "./cargo-${rust_series}_${RUST_VERSION}_all.deb" \
    && rm -f "cargo-$rust_series-control" "cargo-${rust_series}_${RUST_VERSION}_all.deb"

RUN useradd -u 1000 -m debbuilder
RUN usermod -aG sudo debbuilder
RUN echo '%sudo ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

USER debbuilder
WORKDIR /home/debbuilder

RUN mkdir -p /home/debbuilder/build

COPY package-deb.sh /package.sh

CMD [ "/package.sh" ]
