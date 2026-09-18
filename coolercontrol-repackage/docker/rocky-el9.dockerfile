FROM rockylinux/rockylinux:9

ARG RUST_VERSION=1.95.0

ENV CARGO_HOME=/opt/cargo
ENV RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH

# Enable CRB for packages required by build dependencies
RUN dnf install -y dnf-plugins-core \
    && dnf config-manager --set-enabled crb \
    && dnf clean all

# Install core build environments and package tools
RUN dnf install -y \
    rpm-build \
    rpmdevtools \
    make \
    gcc \
    ca-certificates \
    curl-minimal \
    sudo \
    epel-release \
    && dnf clean all

RUN dnf module reset nodejs -y && dnf module enable nodejs:22 -y && dnf install nodejs -y

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "$RUST_VERSION" \
    && test -x "$CARGO_HOME/bin/cargo" \
    && test -x "$CARGO_HOME/bin/rustc"

RUN mkdir -p /tmp/rpmbuild/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS} \
    && printf '%s\n' \
    'Name: rustup-toolchain-compat' \
    "Version: $RUST_VERSION" \
    'Release: 1%{?dist}' \
    'Summary: RPM compatibility metadata for the rustup toolchain' \
    'License: MIT' \
    'BuildArch: noarch' \
    'Provides: cargo = %{version}' \
    'Provides: rust = %{version}' \
    '%description' \
    'Satisfies RPM dependencies for the Rust toolchain installed by rustup.' \
    '%install' \
    'mkdir -p %{buildroot}%{_datadir}/rustup-toolchain-compat' \
    '%files' \
    '%dir %{_datadir}/rustup-toolchain-compat' \
    > /tmp/rpmbuild/SPECS/rustup-toolchain-compat.spec \
    && rpmbuild --define '_topdir /tmp/rpmbuild' -bb /tmp/rpmbuild/SPECS/rustup-toolchain-compat.spec \
    && dnf install -y /tmp/rpmbuild/RPMS/noarch/rustup-toolchain-compat-"$RUST_VERSION"-1*.noarch.rpm \
    && rm -rf /tmp/rpmbuild \
    && dnf clean all

RUN for i in /opt/cargo/bin/*; do ln -snf $i /usr/bin/$(basename $i); done

# Create a non-privileged user for building
RUN useradd -u 1000 -m rpmbuilder
RUN usermod -aG wheel rpmbuilder
RUN echo '%wheel ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

USER rpmbuilder
WORKDIR /home/rpmbuilder

# Set up the standard RPM directory layout structure
RUN rpmdev-setuptree

COPY package-rpm.sh /package.sh

CMD [ "/package.sh" ]
