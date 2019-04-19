/*
 * regnum2phyx.js: A tool for converting PhyloRegnum database dumps to Phyx files.
 *
 * Synopsis: regnum2phyx.js [JSON file to process] -o [directory to write files to]
 *
 * PhyloRegnum can be accessed at http://app.phyloregnum.org
 */

// Load necessary modules.
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { has, keys } = require('lodash');

// Helper functions.
function convertAuthorsIntoStrings(authors, lastNameFirst = true) {
  // We combine authors as $first_name $middle_name $last_name.
  // We could instead use foaf:firstName and foaf:lastName, but that's probably
  // unnecessary (http://xmlns.com/foaf/spec/#term_firstName).

  if (lastNameFirst) {
    // Use "last first middle".
    return authors.map(author => (
      `${author.last_name || ''} ${author.first_name || ''}${
        ((has(author, 'middle_name') && author.middle_name.trim() !== '') ? ` ${author.middle_name}` : '')
      }`.trim()
    )).filter(name => name !== '');
  }

  // Use "first middle last".
  return authors.map(author => (
    `${author.first_name || ''} ${
      ((has(author, 'middle_name') && author.middle_name.trim() !== '') ? `${author.middle_name} ` : '')
    }${author.last_name || ''}`.trim()
  )).filter(name => name !== '');
}

function convertAuthorsIntoObjects(authors) {
  return authors.map(author => ({
    name: `${author.last_name || ''}, ${author.first_name || ''}${
      ((has(author, 'middle_name') && author.middle_name.trim() !== '') ? ` ${author.middle_name}` : '')
    }`.trim(),
    alternate: [
      `${author.first_name || ''} ${
        ((has(author, 'middle_name') && author.middle_name.trim() !== '') ? `${author.middle_name} ` : '')
      }${author.last_name || ''}`.trim(),
    ],
    firstname: author.first_name || '',
    lastname: author.last_name || '',
  }));
}

function convertCitation(citation) {
  // Convert a citation from its Regnum format into an ontologized form.
  // We rely on BIBO (https://github.com/structureddynamics/Bibliographic-Ontology-BIBO)
  // quite extensively for this.

  if (!citation) return [];
  if (Array.isArray(citation)) {
    return citation.map(c => convertCitation(c)).reduce((acc, val) => acc.concat(val), []);
  }

  // Figure out the citation type.
  const citationTypes = {
    journal: 'bibo:Article',
    book: 'bibo:Book',
    book_section: 'bibo:BookSection',
  };
  const citationType = citationTypes[citation.citation_type || 'journal'];
  if (!citationType) {
    throw new Error(`Unknown citation type: '${citation.citation_type}'`);
  }

  // Do we have a title and a year? If not, skip this entry.
  if (citation.title === undefined || citation.title.trim() === '' || citation.year === undefined || citation.year.trim() === '') {
    return [];
  }

  // No authors, title or year? Ignore.
  if (!citation.authors || !citation.title || !citation.year) return [];

  const entry = {
    type: citation.citation_type || 'journal',
    title: (citation.title || '').trim(),
    year: (citation.year || '').trim(),
    authors: convertAuthorsIntoObjects(citation.authors),
    journal: {
      name: (citation.journal || '').trim(),
      volume: (citation.volume || '').trim(),
      pages: (citation.pages || '').trim(),
      identifier: [
        {
          type: 'isbn',
          id: (citation.isbn || '').trim(),
        },
        {
          type: 'issn',
          id: (citation.isbn || '').trim(),
        },
      ],
    },
    identifier: {
      type: 'doi',
      id: (citation.doi || '').trim(),
    },
  };

  return [entry];
}

// Read command-line arguments.
const argv = yargs
  .usage('Usage: $0 <JSON file to process> -o <directory to write files to>')
  .demandCommand(1, 1) // Make sure there's one and only one file to convert.
  .option('output-dir', {
    alias: 'o',
    describe: 'Directory to write Phyx files to',
  })
  .demandOption(['o'])
  .help('h')
  .alias('h', 'help')
  .argv;

// Read the database dump.
const dump = JSON.parse(fs.readFileSync(argv._[0], 'utf8'));

// This dump consists of multiple named phyloreferences, each of which should be
// written out to a separate file.
const phyxProduced = {};
let countErrors = 0;

dump.forEach((entry) => {
  const phylorefLabel = entry.name.trim();

  if (has(phyxProduced, phylorefLabel)) {
    process.stderr.write(`Duplicate phyloreference label '${phylorefLabel}', skipping.`);
    countErrors += 1;
    return;
  }

  // We should never have an actual value for entry.citations.description; if we do,
  // we might be misinterpreting the input and should exit with an error.
  if (has(entry.citations, 'description')) {
    // The Regnum dumps contains citations marked "description" that are empty.
    // Since convertCitation() removes citations that don't have a title and a
    // year, we can use it to check whether the "description" citation(s) are
    // empty or contain an actual citation. In the latter case, we throw an Error
    // so we fail with an error.
    const descriptionCitations = convertCitation(entry.citations.description);

    if (descriptionCitations.length > 0) {
      throw new Error(`Citation of type 'description' found in entry: ${
        JSON.stringify(convertCitation(entry.citations.definitional), null, 4)
      }`);
    }
  }

  // Prepare and fill a simple Phyx file template.
  const phylorefTemplate = {
    regnumId: entry.id,
    label: phylorefLabel,
    'dwc:scientificNameAuthorship': (convertAuthorsIntoStrings(entry.authors)).join(', '),
    'dwc:namePublishedIn': convertCitation(entry.citations.preexisting),
    'obo:IAO_0000119': // IAO:definition source (http://purl.obolibrary.org/obo/IAO_0000119)
      convertCitation(entry.citations.definitional),
    primaryPhylogenyCitation: convertCitation(entry.citations.primary_phylogeny),
    phylogenyCitation: convertCitation(entry.citations.phylogeny),
    cladeDefinition: (entry.definition || '').trim(),
    internalSpecifiers: [],
    externalSpecifiers: [],
  };

  (entry.specifiers || []).forEach((specifier) => {
    const kind = specifier.specifier_kind || '';
    let addTo = [];
    if (kind.startsWith('internal')) addTo = phylorefTemplate.internalSpecifiers;
    else if (kind.startsWith('external')) addTo = phylorefTemplate.externalSpecifiers;
    else {
      process.stderr.write(`Unknown specifier type: '${kind}' for phyloreference '${phylorefLabel}'.\n`);
      countErrors += 1;
    }

    const specifierName = (specifier.specifier_name || '').trim();
    const specifierAuthors = (specifier.displayAuths || '').trim();
    const specifierAuthority = (specifierAuthors.length > 0) ?
      `${specifierAuthors}, ${(specifier.specifier_year || '').trim()}` :
      (specifier.specifier_year || '').trim();
    const specifierCode = (specifier.specifier_code || '').trim();

    // TODO: parse out genus and binomial name?

    const scname = `${specifierName} ${specifierAuthority}`.trim();
    const specifierTemplate = {
      verbatimSpecifier: scname,
      scientificName: scname,
      canonicalName: specifierName,
      nomenclaturalCode: specifierCode,
    };

    addTo.push(specifierTemplate);
  });

  // Prepare a simple Phyx file template.
  const phyxTemplate = {
    '@context': 'http://www.phyloref.org/phyx.js/context/v0.1.0/phyx.json',
    phylogenies: [],
    phylorefs: [phylorefTemplate],
    debug: entry, // To help with debugging, dump the entire entry into the Phyx file.
  };

  // Write out Phyx file.
  const phyxFilename = path.join(argv.outputDir, `${phylorefLabel}.json`);
  fs.writeFileSync(phyxFilename, JSON.stringify(phyxTemplate, null, 4));

  // Save for later use if needed.
  phyxProduced[phylorefLabel] = entry;
});

if (countErrors > 0) {
  process.stderr.write(`${countErrors} errors occurred while processing database dump.\n`);
  process.exit(1);
} else {
  process.stdout.write(`${keys(phyxProduced).length} Phyx files produced successfully.\n`);
}
