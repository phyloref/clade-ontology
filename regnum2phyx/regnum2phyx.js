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

// Load phyx.js classes for building phyloreferences and specifiers.
// We import each class directly from its source file rather than from the package
// index, because the index pulls in PhyxWrapper → jsonld, which is incompatible
// with Node.js v14+ (ESM/apply issue).
const { TaxonConceptWrapper } = require('@phyloref/phyx/src/wrappers/TaxonConceptWrapper');
const { TaxonNameWrapper } = require('@phyloref/phyx/src/wrappers/TaxonNameWrapper');
const { CitationWrapper } = require('@phyloref/phyx/src/wrappers/CitationWrapper');
const { PhylorefWrapper } = require('@phyloref/phyx/src/wrappers/PhylorefWrapper');

// Nomenclatural codes from the NOMEN ontology. These differ from the
// TaxonName-ontology IRIs in phyx.js (owlterms.ICZN_CODE etc.); we keep the
// NOMEN IRIs here so that output stays consistent with existing phyx/ files.
// See https://github.com/phyloref/phyx.js/issues/44 for the planned unification.
const NAME_IN_UNKNOWN_CODE = 'http://purl.obolibrary.org/obo/NOMEN_0000036';
const ICZN_NAME = 'http://purl.obolibrary.org/obo/NOMEN_0000107';
const ICN_NAME = 'http://purl.obolibrary.org/obo/NOMEN_0000109';
// const ICNP_NAME = 'http://purl.obolibrary.org/obo/NOMEN_0000110';
// const ICTV_NAME = 'http://purl.obolibrary.org/obo/NOMEN_0000111';

// Load necessary modules.
const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');
const {
  has, pickBy, isEmpty,
} = require('lodash');

// Helper functions.
function convertAuthorsIntoStrings(authors, lastNameStatus = 'first') {
  // Given a list of authors with first_name, middle_name and last_name properties,
  // return a list of author names with a single name.
  //
  // We combine author names in three possible ways:
  //  If lastNameStatus is 'first': $last_name $first_name $middle_name
  //  If lastNameStatus is 'only': $last_name
  //  Any other value: $first_name $middle_name $last_name
  // The middle name will be ignored if it is blank or not present.

  if (lastNameStatus === 'first') {
    // Use "last first middle".
    return authors.map(author => (
      `${author.last_name || ''}, ${author.first_name || ''}${
        ((has(author, 'middle_name') && author.middle_name.trim() !== '') ? ` ${author.middle_name}` : '')
      }`.trim()
    )).filter(name => name !== '');
  }

  if (lastNameStatus === 'only') {
    // Use "last".
    return authors.map(author => `${author.last_name || ''}`.trim()).filter(name => name !== '');
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
    .map(author => CitationWrapper.normalize({ // removes empty fields
      // We store the author name as first_name middle_name last_name
      name: convertAuthorsIntoStrings([author], 'last').join(' and '),
      alternate: [
        // We store an alternate author name as last_name, first_name middle_name.
        convertAuthorsIntoStrings([author], 'first').join(' and '),
      ],
      firstname: (author.first_name || '').trim(),
      lastname: (author.last_name || '').trim(),
      middlename: (author.middle_name || '').trim(),
    }));
}

function convertCitationsToBibJSON(citation, issues = []) {
  // Convert a citation from its Regnum representation into the
  // BibJSON format (http://okfnlabs.org/bibjson/). We use this rather than
  // CSL-JSON (https://github.com/citation-style-language/schema) because it's
  // easier to set up. We might want to switch over to CSL-JSON
  // eventually (https://github.com/phyloref/clade-ontology/issues/69).

  if (!citation) return [];
  if (Array.isArray(citation)) {
    // If given an array of citation objects, convert each one separately.
    return citation.map(c => convertCitationsToBibJSON(c, issues))
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

  // CitationWrapper.normalize() removes empty/falsy keys, equivalent to lodash.pickBy().
  const entry = CitationWrapper.normalize({
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
    entry.journal = CitationWrapper.normalize({
      name: (citation.journal || '').trim(),
      volume: (citation.volume || '').trim(),
      number: (citation.number || '').trim(),
      identifier: journalIdentifiers,
    });

    // Pages belong in the journal object for articles, not the outer entry.
    entry.pages = undefined;
  } else {
    issues.push(`Unknown citation type: '${type}', using anyway.`);
  }

  return [entry];
}

// Command line application starts here.

// Read command-line arguments.
const argv = yargs(process.argv.slice(2))
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
  .option('digits', {
    describe: 'Number of digits to put into CLADO name',
    type: 'number',
    default: 7,
  })
  .option('filename-prefix', {
    describe: 'Choose the prefix for the filename being generated',
    string: true,
  })
  .option('report', {
    describe: 'Path to write a CSV report of all processed phyloreferences',
    string: true,
  })
  .help('h')
  .alias('h', 'help')
  .argv;

// Read the database dump.
const dump = JSON.parse(fs.readFileSync(argv._[0], 'utf8'));

// This dump consists of multiple named phylogenetic clade definitions,
// each of which should be written out to a separate file.
const phyxProduced = {};  // keeps phylorefLabel → entry for O(1) duplicate detection
const results = [];

// Helper to escape a value for CSV output.
function escapeCSV(field) {
  const str = String(field == null ? '' : field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Create the output directory if it doesn't exist.
if (fs.existsSync(argv.outputDir)) {
  throw new Error(`Output directory ${argv.outputDir} already exists!`);
}
fs.mkdirSync(argv.outputDir);

// Loop through all phylorefs in the database dump.
dump.forEach((entry, index) => {
  const phylorefLabel = entry.name.trim();
  const entryIssues = [];
  const result = {
    regnumId: entry.id,
    label: phylorefLabel,
    status: 'success',
    outputFile: null,
    internalSpecifiers: [],
    externalSpecifiers: [],
    issues: entryIssues,
  };

  // Make sure we don't have multiple phyloreferences with the same label, since
  // we name the file after the phyloreference being produced.
  if (has(phyxProduced, phylorefLabel)) {
    entryIssues.push(`Duplicate phyloreference label '${phylorefLabel}', skipping.`);
    result.status = 'skipped';
    results.push(result);
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
    const descriptionCitations = convertCitationsToBibJSON(entry.citations.description, entryIssues);

    if (descriptionCitations.length > 0) {
      throw new Error(`Citation of type 'description' found in entry: ${
        JSON.stringify(convertCitationsToBibJSON(entry.citations.definitional, entryIssues), null, 4)
      }`);
    }
  }

  // Create an object describing this phyloreference, then wrap it with
  // PhylorefWrapper so that specifiers can be managed via the library API.
  const phylorefWrapper = new PhylorefWrapper(pickBy({
    curatorNotes: `Regnum ID: '${entry.id}'`,
    label: phylorefLabel,
    scientificNameAuthorship: (convertAuthorsIntoStrings(entry.authors)).join(' and '),
    namePublishedIn: convertCitationsToBibJSON(entry.citations.preexisting, entryIssues),
    definitionSource: convertCitationsToBibJSON(entry.citations.definitional, entryIssues),
    definition: (entry.definition || '').trim(),
    internalSpecifiers: [],
    externalSpecifiers: [],
  }));

  // Do we have any phylogenies to save?
  const primaryPhylogenyCitation = convertCitationsToBibJSON(entry.citations.primary_phylogeny, entryIssues).map(
    phylogeny => pickBy({ primaryPhylogenyCitation: phylogeny })
  );
  const phylogenyCitation = convertCitationsToBibJSON(entry.citations.phylogeny, entryIssues).map(
    phylogeny => pickBy({ phylogenyCitation: phylogeny })
  );
  const phylogenies = primaryPhylogenyCitation.concat(phylogenyCitation).filter(
    phylogeny => !isEmpty(phylogeny)
  );

  // Convert each specifier into one
  for (const specifier of (entry.specifiers || [])) {
    const kind = specifier.specifier_kind || '(empty)';
    let addTo = [];
    if (kind.startsWith('internal')) addTo = phylorefWrapper.internalSpecifiers;
    else if (kind.startsWith('external')) addTo = phylorefWrapper.externalSpecifiers;
    else if (specifier.specifier_type === 'apomorphy') {
      entryIssues.push('Apomorphy specifiers are not currently supported.');
      if (result.status === 'success') result.status = 'warning';
    } else {
      if (specifier.specifier_type === 'crown') {
        entryIssues.push('Crown specifiers are not supported.');
      } else {
        entryIssues.push(`Odd specifier: ${JSON.stringify(specifier, null, 2)}`);
        entryIssues.push(`Unknown specifier type: '${kind}' for phyloreference '${phylorefLabel}'.`);
      }
      result.status = 'warning';
    }

    // Set up specifier name, authorship and nomenclatural code.
    const specifierName = (specifier.specifier_name || '').trim();
    const specifierAuthors = convertAuthorsIntoStrings(specifier.authors, 'only').join(' and ');
    const specifierCode = (specifier.specifier_code || '').trim();

    let nomenCode = NAME_IN_UNKNOWN_CODE;
    // As of the May 14, 2020 Regnum dump, only ICZN and ICBN
    // are used as pre-existing codes. I'll add ICNP and ICTV
    // as well once we need them.
    switch (specifierCode) {
      case 'ICZN':
        nomenCode = ICZN_NAME;
        break;
      case 'ICBN':
        nomenCode = ICN_NAME;
        break;
      case '':
        nomenCode = NAME_IN_UNKNOWN_CODE;
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

    // Use TaxonConceptWrapper.wrapTaxonName() to construct the specifier object,
    // using TaxonNameWrapper.TYPE_TAXON_NAME for the taxon name @type.
    const specifierTemplate = TaxonConceptWrapper.wrapTaxonName({
      '@type': TaxonNameWrapper.TYPE_TAXON_NAME,
      nomenclaturalCode: nomenCode,
      label: scname,
      nameComplete: specifierName,
    });

    addTo.push(specifierTemplate);
  }

  // Prepare a simple Phyx file template.
  // TODO: use owlterms.PHYX_CONTEXT_JSON for the context URL once
  // https://github.com/phyloref/phyx.js/pull/171 has been released (re-add owlterms import then).
  const phyxTemplate = pickBy({
    '@context': 'http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json',
    phylogenies,
    phylorefs: [phylorefWrapper.phyloref],
  });

  // Write out Phyx file for this phyloreference.
  const fileIndex = `${index + 1}`.padStart(argv.digits, '0');
  const filePrefix = argv.filenamePrefix || '';
  let phyxFilename;
  if (argv.filenames === 'label') {
    // Use the phyloref label.
    phyxFilename = path.join(argv.outputDir, `${phylorefLabel}.json`);
  } else if (argv.filenames === 'regnum-id') {
    // Use the regnum id.
    if (entry.id) phyxFilename = path.join(argv.outputDir, `CLADO_${(`${entry.id}`).padStart(argv.digits, '0')}.json`);
    else phyxFilename = path.join(argv.outputDir, `${filePrefix}${fileIndex}.json`);
  } else {
    // Default to just the number of the sequence.
    phyxFilename = path.join(argv.outputDir, `${filePrefix}${fileIndex}.json`);
  }
  fs.writeFileSync(phyxFilename, JSON.stringify(phyxTemplate, null, 4));

  // Record output file and specifier labels for the report.
  result.outputFile = phyxFilename;
  result.internalSpecifiers = phylorefWrapper.internalSpecifiers.map(s => s.hasName.label);
  result.externalSpecifiers = phylorefWrapper.externalSpecifiers.map(s => s.hasName.label);

  // Save for later use if needed.
  phyxProduced[phylorefLabel] = entry;
  results.push(result);
});

// Print attributed issues to stderr (only entries with problems).
for (const r of results) {
  if (r.issues.length === 0) continue;
  const id = r.regnumId != null ? ` (regnum ID ${r.regnumId})` : '';
  process.stderr.write(`${r.status === 'skipped' ? 'Skipped' : 'Warning in'} '${r.label}'${id}:\n`);
  for (const issue of r.issues) {
    process.stderr.write(`  - ${issue}\n`);
  }
}

// Write CSV report if --report was given.
if (argv.report) {
  const maxInternal = results.reduce((m, r) => Math.max(m, r.internalSpecifiers.length), 0);
  const maxExternal = results.reduce((m, r) => Math.max(m, r.externalSpecifiers.length), 0);

  const internalCols = Array.from({ length: maxInternal }, (_, i) => `internal_specifier_${i + 1}`);
  const externalCols = Array.from({ length: maxExternal }, (_, i) => `external_specifier_${i + 1}`);

  const header = [
    'regnum_id', 'label', 'status', 'output_file',
    'num_internal_specifiers', 'num_external_specifiers',
    ...internalCols, ...externalCols,
    'issues',
  ];

  const rows = results.map(r => {
    const internalFields = Array.from({ length: maxInternal }, (_, i) => r.internalSpecifiers[i] || '');
    const externalFields = Array.from({ length: maxExternal }, (_, i) => r.externalSpecifiers[i] || '');
    return [
      r.regnumId, r.label, r.status, r.outputFile || '',
      r.internalSpecifiers.length, r.externalSpecifiers.length,
      ...internalFields, ...externalFields,
      r.issues.join('; '),
    ].map(escapeCSV).join(',');
  });

  fs.writeFileSync(argv.report, `${[header.join(','), ...rows].join('\n')}\n`);
}

// Final summary and exit.
const successCount = results.filter(r => r.status === 'success').length;
const warningCount = results.filter(r => r.status === 'warning').length;
const skippedCount = results.filter(r => r.status === 'skipped').length;

if (warningCount > 0 || skippedCount > 0) {
  process.stderr.write(
    `Processed ${results.length} entries: ${successCount} written successfully, ${skippedCount} skipped, ${warningCount} written with issues.\n`,
  );
}

// Only exit non-zero for hard errors (skipped = duplicate/unresolvable entries where no
// file was written). Warnings mean the file was written but with unsupported specifiers.
if (skippedCount > 0) {
  process.stderr.write(`${skippedCount} entries were skipped due to errors.\n`);
  process.exit(1);
} else {
  process.stdout.write(`${successCount + warningCount} Phyx files produced successfully.\n`);
}
