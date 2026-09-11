FROM ubuntu:20.04

ENV TZ=America/Glace_Bay
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt update && apt upgrade -y

RUN apt install -y \
    git make cmake build-essential fakeroot \
    devscripts debhelper pkg-config \
    autoconf gcc g++ libgio3.0-cil-dev libsystemd-dev \
    python3.9 libssh-dev gettext libxslt1-dev \
    libappstream-glib-dev appstream sudo
    
RUN apt install -y equivs

RUN rm /var/lib/man-db/auto-update

RUN useradd -u 1000 -m debbuilder
RUN usermod -aG sudo debbuilder
RUN echo '%sudo ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

USER debbuilder
WORKDIR /home/debbuilder

RUN mkdir -p /home/debbuilder/build

COPY package-deb.sh /package.sh

CMD [ "/package.sh" ]
