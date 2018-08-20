# Native libraries for JPhyloRef

Several JPhyloRef reasoners need native libraries. The Clade Ontology test
suite scripts expect them to be located into this folder, but you will need to
download them yourself.

## FaCT++ 1.5.2 native libraries

JPhyloRef includes [FaCT++] 1.5.2. To use it, you will need to download libraries
from [its Google Code repository] under the [LGPL] license agreement. Note that
the native library file (with a `.dll`, `.jnilib` or `.so` extension) needs to
be placed in this folder, not in a subfolder.

[FaCT++]: https://bitbucket.org/dtsarkov/factplusplus
[its Google Code repository]: https://code.google.com/archive/p/factplusplus/downloads
[LGPL]: ./licensing/lgpl-2.1.txt
