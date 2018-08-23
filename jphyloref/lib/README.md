# Native libraries for JPhyloRef

Several JPhyloRef reasoners need native libraries. This folder contains
instructions and scripts to help you install some of them.

If these native libraries are installed into your system library path, Java
should be able to find them. If not, you may need to set the `java.library.path`
using `JVM_ARGS`. See the [README] for details and an example.

## FaCT++ 1.5.2 native libraries

JPhyloRef includes [FaCT++] 1.5.2. To use it, you will need to download libraries
from [its Google Code repository] under the [LGPL] license agreement. You will
also need to include `-Djava.library.path=/path/to/factpp-library` in 
`JVM_ARGS` (see [README] for details).

[FaCT++]: https://bitbucket.org/dtsarkov/factplusplus
[its Google Code repository]: https://code.google.com/archive/p/factplusplus/downloads
[LGPL]: ./licensing/lgpl-2.1.txt
[README]: ../../README.md
