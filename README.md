# Clade Ontology

The Clade Ontology is an ontology of exemplar phyloreferences curated from peer-reviewed publications. Phyloreferences in this ontology include their verbatim clade definition and the phylogeny upon which they were initially defined. The ontology therefore acts as both a catalogue of computable clade definitions as well as a test suite of phyloreferences that can be tested to determine if each phyloreference resolves as expected. This ontology is expressed in the [Web Ontology Language (OWL)]. The executable software code in this repository is available for reuse under the terms of the [MIT license].

[![Build Status](https://travis-ci.org/phyloref/clade-ontology.svg?branch=master)](https://travis-ci.org/phyloref/clade-ontology)

## Executing phyloreferences as a test suite

To test all phyloreferences, you will need [Node.js] and [Java] installed. You can configure testing by setting one or more of the following environmental variables:

 * `JVM_ARGS` contains arguments that are passed to the Java Virtual Machine (i.e. `java $JVM_ARGS -jar ...`). You can use this to set available memory (e.g. `-Xmx12G`) or a directory containing native libraries (e.g. `-Djava.library.path=jphyloref/lib/`).
 * `JPHYLOREF_ARGS` contains arguments that are passed to JPhyloRef (i.e. `java -jar jphyloref.jar test file.owl $JPHYLOREF_ARGS`). You can use this to set the reasoner (e.g. `--reasoner fact++`).

Once pytest and all other required libraries are installed, you can execute all tests by running `npm test` in the root directory of this project.

## Data workflow

Curated phyloreferences produced by [Klados] (a phyloreference authoring tool) as Phyloreference eXchange ([Phyx]) files are currently stored in the [`phyx`] directory (see [Brochu 2003] as an example). When executed as a test suite, these files are converted into the Web Ontology Language (OWL) in the following steps:

1. Phyx files are converted to JSON-LD files using the [`phyx.js`] library. This tool translates phylogenies stored in [the Newick format] into a series of statements describing individual nodes and their relationships, and translates phyloreferences into OWL class restrictions that describes the nodes they resolve to.
2. You may need to convert the produced JSON-LD files into RDF/XML using any standards-compliant converter, such as [`rdfpipe`], a part of the [`rdflib`] library.
3. Any compliant [OWL 2 DL reasoner] should be able to reason over this OWL file, whether represented in JSON-LD or RDF/XML. Phyloreference classes will include all the nodes that they resolve to. In the test suite for the Clade Ontology, we use [`jphyloref`], a Java application that uses the [JFact++ OWL reasoner] to reason over input OWL or JSON-LD files. `jphyloref` can also read the annotations that indicate where each phyloreference was expected to resolve on any of the included phylogenies, and test whether phyloreferences resolved to the expected nodes.

We are currently working on a complete workflow that would allow us to [merge separate Phyx files into a single Clade Ontology] available as a single OWL file available for individual download.

## Previous iterations of this code

We initially developed the Clade Ontology in Python before replacing it with a Node.js-based library. That earlier iteration is available as a release tagged [v0.1] in this repository.

[Web Ontology Language (OWL)]: https://en.wikipedia.org/wiki/Web_Ontology_Language
[MIT license]: ./LICENSE
[Node.js]: http://nodejs.org/
[Java]: https://java.com/
[Klados]: https://github.com/phyloref/klados
[`phyx`]: ./phyx/
[`phyx.js`]: https://github.com/phyloref/phyx.js
[Phyx]: https://doi.org/10.7717/peerj.12618
[Brochu 2003]: ./phyx/from_papers/Brochu%202003/paper.json
[the Newick format]: https://en.wikipedia.org/wiki/Newick_format
[`rdfpipe`]: http://rdflib.readthedocs.io/en/stable/apidocs/rdflib.tools.html#module-rdflib.tools.rdfpipe
[`rdflib`]: http://rdflib.readthedocs.io/
[OWL 2 DL reasoner]: https://www.w3.org/TR/2012/REC-owl2-direct-semantics-20121211/
[`jphyloref`]: https://github.com/phyloref/jphyloref
[JFact++ 1.2.4 OWL reasoner]: http://jfact.sourceforge.net/
[merge separate Phyx files into a single Clade Ontology]: https://github.com/phyloref/clade-ontology/projects/3
[v0.1]: https://github.com/phyloref/clade-ontology/releases/tag/v0.1
