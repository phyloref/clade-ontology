/*
 * regnum2phyx.js: A tool for converting PhyloRegnum database dumps to Phyx files.
 *
 * Synopsis:
 *  regnum2phyx.js [JSON file to process] -o [directory to write files to]
 *
 * Note that existing files in the output directory will be silently overwritten,
 * so this script should usually be run on a new, empty output directory.
 *
 * PhyloRegnum can be accessed at http://app.phyloregnum.org
 */

// We currently produce Phyx files in v1.0.0 format. If this changes, please
// update this here.
// TODO: why isn't this in @phyloref/phyx?
const PHYX_CONTEXT_URL = 'http://www.phyloref.org/phyx.js/context/v1.0.0/phyx.json';

// Load necessary modules.
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const {
  has, keys, pickBy, isEmpty,
} = require('lodash');

// Import the Phyx library.
const phyx = require('@phyloref/phyx');

// Helper functions.
function convertAuthorsIntoStrings(authors, lastNameFirst = true) {
  // Given a list of authors with first_name, middle_name and last_name properties,
  // return a list of author names with a single name.
  //
  // We combine author names in two possible ways:
  //  If lastNameFirst is true: $last_name $first_name $middle_name
  //  If lastNameFirst is false: $first_name $middle_name $last_name
  // The middle name will be ignored if it is blank or not present.

  if (lastNameFirst) {
    // Use "last first middle".
    return authors.map(author => (
      `${author.last_name || ''}, ${author.first_name || ''}${
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

function convertAuthorsIntoBibJSON(authors) {
  // Convert a list of authors in the Regnum dump format into a list of authors
  // in the BibJSON format (http://okfnlabs.org/bibjson/). Names without a
  // last name will be ignored.
  return authors
    .filter(author => author.last_name)
    .map(author => pickBy({ // lodash.pickBy will remove empty keys from the object.
      // We store the author name as first_name middle_name last_name
      name: convertAuthorsIntoStrings([author], false).join(),
      alternate: [
        // We store an alternate author name as last_name, first_name middle_name.
        convertAuthorsIntoStrings([author], true).join(),
      ],
      firstname: (author.first_name || '').trim(),
      lastname: (author.last_name || '').trim(),
      middlename: (author.middle_name || '').trim(),
    }));
}

function convertCitationsToBibJSON(citation) {
  // Convert a citation from its Regnum representation into the
  // BibJSON format (http://okfnlabs.org/bibjson/). We use this rather than
  // CSL-JSON (https://github.com/citation-style-language/schema) because it's
  // easier to set up. We might want to switch over to CSL-JSON
  // eventually (https://github.com/phyloref/clade-ontology/issues/69).

  if (!citation) return [];
  if (Array.isArray(citation)) {
    // If given an array of citation objects, convert each one separately.
    return citation.map(c => convertCitationsToBibJSON(c))
      .reduce((acc, val) => acc.concat(val), []);
  }

  // Do we have a title and a year? If not, skip this entry.
  if (
    citation.title === undefined || citation.title.trim() === ''
    || citation.year === undefined || citation.year.trim() === ''
  ) {
    return [];
  }

  // Assume a default type of 'article' if none was provided.
  let type = citation.citation_type || 'article';

  // Regnum uses 'journal' where BibJSON uses 'article'.
  if (type === 'journal') type = 'article';

  // In BibJSON, identifiers are kept separate from URLs.
  const identifiers = [];
  if (citation.doi) identifiers.push({ type: 'doi', id: citation.doi });

  const urls = [];
  if (citation.url) urls.push({ url: citation.url });

  // lodash.pickBy will remove empty keys from the object.
  const entry = pickBy({
    type,
    title: (citation.title || '').trim(),
    section_title: (citation.section_title || '').trim(),
    year: Number((citation.year || '')),
    edition: (citation.edition || '').trim(),
    authors: convertAuthorsIntoBibJSON(citation.authors),
    editors: convertAuthorsIntoBibJSON(citation.editors || []),
    series_editors: convertAuthorsIntoBibJSON(citation.series_editors || []),
    publisher: (citation.publisher || '').trim(),
    city: (citation.city || '').trim(),
    pages: (citation.pages || '').trim(),
    figure: (citation.figure || '').trim(),
    // keywords: (citation.keyword || '').trim(), -- We really don't need this.
    identifier: identifiers,
    link: urls,
  });

  if (type === 'book' || type === 'book_section') {
    // Add the ISBN to the entry itself.
    if (citation.isbn) {
      identifiers.push({ type: 'isbn', id: citation.isbn });
    }
  } else if (type === 'article') {
    // Identify journal identifiers, such as the
    const journalIdentifiers = [];
    if (citation.isbn) {
      journalIdentifiers.push({ type: 'isbn', id: citation.isbn });
    }
    if (citation.issn) {
      journalIdentifiers.push({ type: 'issn', id: citation.issn });
    }

    // In BibJSON (http://okfnlabs.org/bibjson/), the journal name, volume, number
    // and pages should go into the 'journal' object.
    entry.journal = pickBy({
      name: (citation.journal || '').trim(),
      volume: (citation.volume || '').trim(),
      number: (citation.number || '').trim(),
      identifier: journalIdentifiers,
    });

    // Since we've moved pages and ISBN into journal, we don't also need it in the main entry.
    if (has(entry, 'pages')) delete entry.pages;
  } else {
    process.stderr.write(`Unknown citation type: '${type}', using anyway.`);
  }

  return [entry];
}

// Command line application starts here.

// Read command-line arguments.
const argv = yargs
  .usage('Usage: $0 <JSON file to process> -o <directory to write files to>')
  .demandCommand(1, 1) // Make sure there's one and only one file to convert.
  .option('output-dir', {
    alias: 'o',
    describe: 'Directory to write Phyx files to',
  })
  .demandOption(['o'])
  .option('filenames', {
    describe: 'Choose the type of filenames to generate',
    default: 'label',
    choices: [
      'label',
      'number',
      'regnum-id',
    ],
  })
  .option('filename-prefix', {
    describe: 'Choose the prefix for the filename being generated',
    string: true,
  })
  .help('h')
  .alias('h', 'help')
  .argv;

// Read the database dump.
const dump = JSON.parse(fs.readFileSync(argv._[0], 'utf8'));

// This dump consists of multiple named phylogenetic clade definitions,
// each of which should be written out to a separate file.
const phyxProduced = {};
let countErrors = 0;

// Loop through all phylorefs in the database dump.
dump.forEach((entry, index) => {
  const phylorefLabel = entry.name.trim();

  // Come up with the identifier for this file.
  const fileIndex =  entry.id.padStart(6, '0') || `${index + 1}`.padStart(6, '0');
  const filePrefix = argv.filenamePrefix || 'CLADO_';
  const identifier = `${fileIndex}${filePrefix}`;

  // Make sure we don't have multiple phyloreferences with the same label, since
  // we name the file after the phyloreference being produced.
  if (has(phyxProduced, phylorefLabel)) {
    process.stderr.write(`Duplicate phyloreference label '${phylorefLabel}', skipping.`);
    countErrors += 1;
    return;
  }

  // We should never have an actual value for entry.citations.description; if we do,
  // we might be misinterpreting the input and should exit with an error.
  if (has(entry.citations, 'description')) {
    // The Regnum dumps contains citations marked "description" that are empty.
    // Since convertCitationsToBibJSON() removes citations that don't have a title and a
    // year, we can use it to check whether the "description" citation(s) are
    // empty or contain an actual citation. In the latter case, we throw an Error
    // so we fail with an error.
    const descriptionCitations = convertCitationsToBibJSON(entry.citations.description);

    if (descriptionCitations.length > 0) {
      throw new Error(`Citation of type 'description' found in entry: ${
        JSON.stringify(convertCitationsToBibJSON(entry.citations.definitional), null, 4)
      }`);
    }
  }

  // Create an object describing this phyloreference.
  const phylorefTemplate = pickBy({
    '@id': identifier, // TODO: add IRI stem
    label: phylorefLabel,
    scientificNameAuthorship: (convertAuthorsIntoStrings(entry.authors)).join(', '),
    namePublishedIn: convertCitationsToBibJSON(entry.citations.preexisting),
    definitionSource: // IAO:definition source (http://purl.obolibrary.org/obo/IAO_0000119)
      convertCitationsToBibJSON(entry.citations.definitional),
    definition: (entry.definition || '').trim(),
    internalSpecifiers: [],
    externalSpecifiers: [],
  });

  // Do we have any phylogenies to save?
  const primaryPhylogenyCitation = convertCitationsToBibJSON(entry.citations.primary_phylogeny).map(
    phylogeny => pickBy({ primaryPhylogenyCitation: phylogeny })
  );
  const phylogenyCitation = convertCitationsToBibJSON(entry.citations.phylogeny).map(
    phylogeny => pickBy({ phylogenyCitation: phylogeny })
  );
  const phylogenies = primaryPhylogenyCitation.concat(phylogenyCitation).filter(
    phylogeny => !isEmpty(phylogeny)
  );

  // Convert each specifier into one
  (entry.specifiers || []).forEach((specifier) => {
    const kind = specifier.specifier_kind || '';
    let addTo = [];
    if (kind.startsWith('internal')) addTo = phylorefTemplate.internalSpecifiers;
    else if (kind.startsWith('external')) addTo = phylorefTemplate.externalSpecifiers;
    else {
      process.stderr.write(`Unknown specifier type: '${kind}' for phyloreference '${phylorefLabel}'.\n`);
      countErrors += 1;
    }

    // Set up specifier name, authorship and nomenclatural code.
    const specifierName = (specifier.specifier_name || '').trim();
    const specifierAuthors = (specifier.displayAuths || '').trim();
    const specifierCode = (specifier.specifier_code || '').trim();

    let nomenCode = phyx.TaxonNameWrapper.NAME_IN_UNKNOWN_CODE;
    // As of the May 14, 2020 Regnum dump, only ICZN and ICBN
    // are used as pre-existing codes. I'll add ICNP and ICTV
    // as well once we need them.
    switch (specifierCode) {
      case 'ICZN':
        nomenCode = phyx.TaxonNameWrapper.ICZN_CODE;
        break;
      case 'ICBN':
        nomenCode = phyx.TaxonNameWrapper.ICN_CODE;
        break;
      case '':
        nomenCode = phyx.TaxonNameWrapper.NAME_IN_UNKNOWN_CODE;
        break;
      default:
        throw new Error(`Unknown specifier_code: '${specifierCode}'`);
    }

    // Do we have authors? If so, incorporate them into the specifier authors.
    // Otherwise, just use the year.
    let specifierAuthority = (specifier.specifier_year || '').trim();
    if (specifierAuthors.length > 0) {
      specifierAuthority = `${specifierAuthors}, ${(specifier.specifier_year || '').trim()}`;
    }

    // TODO: split name into genus/specifier.

    // Write out a scientificName that includes the specifier name as well as its
    // nomenclatural authority, if present.
    const scname = `${specifierName} ${specifierAuthority}`.trim();
    const specifierTemplate = {
      '@type': 'http://rs.tdwg.org/ontology/voc/TaxonConcept#TaxonConcept',
      hasName: {
        '@type': 'http://rs.tdwg.org/ontology/voc/TaxonName#TaxonName',
        nomenclaturalCode: nomenCode,
        label: scname,
        nameComplete: specifierName,
      },
    };

    addTo.push(specifierTemplate);
  });

  // Prepare a simple Phyx file template.
  const phyxTemplate = pickBy({
    '@context': PHYX_CONTEXT_URL,
    phylogenies,
    phylorefs: [phylorefTemplate],
  });

  // Write out Phyx file for this phyloreference.
  let phyxFilename;
  if (argv.filenames === 'label') {
    // Use the phyloref label.
    phyxFilename = path.join(argv.outputDir, `${phylorefLabel}.json`);
  } else if (argv.filenames === 'regnum-id') {
    // Use the regnum id.
    if (entry.id) phyxFilename = path.join(argv.outputDir, `REGNUM_${(`${entry.id}`).padStart(6, '0')}.json`);
    else phyxFilename = path.join(argv.outputDir, `${filePrefix}${fileIndex}.json`);
  } else {
    // Default to just the number of the sequence.
    phyxFilename = path.join(argv.outputDir, `${filePrefix}${fileIndex}.json`);
  }
  fs.writeFileSync(phyxFilename, JSON.stringify(phyxTemplate, null, 4));

  // Save for later use if needed.
  phyxProduced[phylorefLabel] = entry;
});

// If there were any errors, report this and exit with a failure code.
if (countErrors > 0) {
  process.stderr.write(`${countErrors} errors occurred while processing database dump.\n`);
  process.exit(1);
} else {
  process.stdout.write(`${keys(phyxProduced).length} Phyx files produced successfully.\n`);
}
