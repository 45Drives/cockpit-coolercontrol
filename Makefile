

all: default

default: rpms

rpms: rpmbuild/RPMS

rpmbuild/RPMS: rpmbuild/SPECS/*.spec
	./build-coolercontrold.sh
