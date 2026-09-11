FROM rockylinux/rockylinux:9

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
    sudo \
    epel-release \
    && dnf clean all

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
