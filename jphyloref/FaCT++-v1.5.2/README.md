# FaCT++ 1.5.2 native libraries

This directory contains native libraries for [FaCT++] 1.5.2 downloaded from
[its Google Code repository]. The 64-bit libraries for Windows, Linux and macOS
were released under the [LGPL] license and are distributed here under that license.

Including the native libraries allows us to archive the exact libraries used in
testing these libraries in case the originals become unavailable at some point.
As FaCT++ is not under active development, it is unlikely that we will need to
upgrade these libraries often, and taking this approach reduces the complexity 
of the test suite which would otherwise need to download the correct libraries 
when being run. The cost of this approach is a larger repository (by 3.7MB for
all three libraries) and the presence of opaque, binary-only changes in the Git
log of this repository.

[FaCT++]: https://bitbucket.org/dtsarkov/factplusplus
[its Google Code repository]: https://code.google.com/archive/p/factplusplus/downloads
[LGPL]: ./licensing/lgpl-2.1.txt
