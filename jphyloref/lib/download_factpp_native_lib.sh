#!/bin/bash

# This is a helper script to help Travis CI download the native libraries for
# the FaCT++ reasoner. It is not intended to be used directly by users.

cd /tmp
wget "https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/factplusplus/FaCTpp-linux-v1.5.2.tgz"
tar zxvf FaCTpp-linux-v1.5.2.tgz
cd -
mv /tmp/FaCT++-linux-v1.5.2/64bit/libFaCTPlusPlusJNI.so jphyloref/lib
