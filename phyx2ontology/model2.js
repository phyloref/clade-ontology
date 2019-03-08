/*
 * This temporary file is used to store methods that are used to convert
 * the OWL restriction expressions from the model 1.0 implementation in
 * phyx.js to the model 2.0 implemention currently produced by phyx2ontology.js.
 * They will eventually be moved to phyx.js in https://github.com/phyloref/phyx.js/issues/4
 */

// We need to access some features from phyx.js.
const phyx = require('@phyloref/phyx');

// We need a few methods from lodash.
const { has } = require('lodash');

/*
  * convertTUtoRestriction(tunit)
  *  - tunit: A taxonomic unit (or a specifier containing at least one taxonomic unit)
  *
  * Converts a taxonomic unit to a list of OWL restrictions, in the form of:
  *  tc:hasName some (ICZN_Name and dwc:scientificName value "scientific name")
  * or:
  *  tc:circumscribedBy some (dwc:organismID value "occurrence ID")
  *
 * This method will be moved back into phyx.js as part of https://github.com/phyloref/phyx.js/issues/4
  */
function convertTUtoRestriction(tunit) {
  // If we're called with a specifier, use the first TU in that specifier (for now).
  if (has(tunit, 'referencesTaxonomicUnits')) {
    return convertTUtoRestriction(tunit.referencesTaxonomicUnits[0] || {});
  }

  // Build up a series of taxonomic units from scientific names and specimens.
  const results = [];
  if (has(tunit, 'scientificNames')) {
    tunit.scientificNames.forEach((sciname) => {
      const wrappedSciname = new phyx.ScientificNameWrapper(sciname);

      results.push({
        '@type': 'owl:Restriction',
        onProperty: 'http://rs.tdwg.org/ontology/voc/TaxonConcept#hasName',
        someValuesFrom: {
          '@type': 'owl:Class',
          intersectionOf: [
            {
              // TODO: replace with a check once we close https://github.com/phyloref/phyx.js/issues/5.
              // For now, we pretend that all names are ICZN names.
              '@id': 'obo:NOMEN_0000107',
            },
            {
              '@type': 'owl:Restriction',
              onProperty: 'dwc:scientificName',
              // TODO: We really want the "canonical name" here: binomial or
              // trinomial, but without any additional authority information.
              // See https://github.com/phyloref/phyx.js/issues/8
              hasValue: wrappedSciname.binomialName,
            },
          ],
        },
      });
    });
  } else if (has(tunit, 'includesSpecimens')) {
    // This is a quick-and-dirty implementation. Discussion about it should be
    // carried out in https://github.com/phyloref/clade-ontology/issues/61
    tunit.includesSpecimens.forEach((specimen) => {
      const wrappedSpecimen = new phyx.SpecimenWrapper(specimen);

      results.push({
        '@type': 'owl:Restriction',
        onProperty: 'dwc:organismID',
        hasValue: wrappedSpecimen.occurrenceID,
      });
    });
  } else {
    // Ignore it for now (but warn the user).
    process.stderr.write(`WARNING: taxonomic unit could not be converted into restriction: ${JSON.stringify(tunit)}\n`);
    results.push({});
  }

  return results;
}

let additionalClassCount = 0;
const additionalClassesByLabel = {};
function createAdditionalClass(jsonld, internalSpecifiers, externalSpecifiers, equivClassFunc) {
  // This function creates an additional class for the set of internal and external
  // specifiers provided for the equivalentClass expression provided. If one already
  // exists for this set of internal and external specifiers, we just return that
  // instead of creating a new one.
  //
  // TODO For some reason this acts strange if equivalentClass is a string, so instead
  // I've made it into a function here. To be fixed.

  if (internalSpecifiers.length === 0) throw new Error('Cannot create additional class without any internal specifiers');
  if (internalSpecifiers.length === 1 && externalSpecifiers.length === 0) throw new Error('Cannot create additional class with a single internal specifiers and no external specifiers');

  /* Come up with a label that represents this additional class. */

  // Start with the internal specifiers, concatenated with '&'.
  const internalSpecifierLabel = internalSpecifiers
    .map(i => convertTUtoRestriction(i)[0].someValuesFrom.intersectionOf[1].hasValue || '(error)')
    .sort()
    .join(' & ');
  let additionalClassLabel = `(${internalSpecifierLabel}`;

  if (externalSpecifiers.length === 0) {
    additionalClassLabel += ')';
  } else {
    // Add the external specifiers, concatenated with 'V'.
    const externalSpecifierLabel = externalSpecifiers
      .map(i => convertTUtoRestriction(i)[0].someValuesFrom.intersectionOf[1].hasValue || '(error)')
      .sort()
      .join(' V ');
    additionalClassLabel += ` ~ ${externalSpecifierLabel})`;
  }

  // process.stderr.write(`Additional class label: ${additionalClassLabel}\n`);

  // TODO We need to replace this with an actual object-based comparison,
  // rather than trusting the labels to tell us everything.
  if (has(additionalClassesByLabel, additionalClassLabel)) {
    // If we see the same label again, return the previously defined additional class.
    return { '@id': additionalClassesByLabel[additionalClassLabel]['@id'] };
  }

  // Create a new additional class for this set of internal and external specifiers.
  additionalClassCount += 1;
  const additionalClass = {};
  additionalClass['@id'] = `${jsonld['@id']}_additional${additionalClassCount}`;
  // process.stderr.write(`Creating new additionalClass with id: ${additionalClass['@id']}`);

  additionalClass['@type'] = 'owl:Class';
  additionalClass.subClassOf = (
    externalSpecifiers.length > 0 ? 'phyloref:PhyloreferenceUsingMinimumClade' : 'phyloref:PhyloreferenceUsingMaximumClade'
  );
  additionalClass.equivalentClass = equivClassFunc();
  additionalClass.label = additionalClassLabel;
  jsonld.hasAdditionalClass.push(additionalClass);

  additionalClassesByLabel[additionalClassLabel] = additionalClass;

  return { '@id': additionalClass['@id'] };
}

/* Return an OWL restriction for inclusion of a single taxonomic unit. */
function getIncludesRestrictionForTU(tu) {
  return {
    '@type': 'owl:Restriction',
    onProperty: 'phyloref:includes_TU',
    someValuesFrom: convertTUtoRestriction(tu)[0],
  };
}

/*
 * Return an OWL restriction for the most recent common ancestor (MRCA)
 * of two taxonomic units.
 */
function getMRCARestrictionOfTwoTUs(tu1, tu2) {
  return {
    '@type': 'owl:Restriction',
    onProperty: 'obo:CDAO_0000149', // cdao:has_Child
    someValuesFrom: {
      '@type': 'owl:Class',
      intersectionOf: [
        {
          '@type': 'owl:Restriction',
          onProperty: 'phyloref:excludes_TU',
          someValuesFrom: convertTUtoRestriction(tu1)[0],
        },
        getIncludesRestrictionForTU(tu2),
      ],
    },
  };
}

/*
 * Create an OWL restriction for a phyloreference made up entirely of internal
 * specifiers.
 *  - jsonld: the JSON-LD representation of this phyloreference in model 1.0.
 *    We mainly use this to access the '@id' and internal and external specifiers.
 *  - remainingInternals: all internal specifiers that have not yet been selected.
 *  - selected: internal specifiers have been seen selected. This should initially
 *    be [], and will be filled in when this method calls itself recursively.
 *
 * This method works like this:
 *  1. We have several special cases: we fail if 0 or 1 specifiers are
 *     provided, and we have a special representation for 2 specifiers.
 *  2. Create an expression for the currently selected specifiers. This expression
 *     is in the form:
 *       has_Child some (excludes_lineage_to some [remaining specifiers] and [selected specifiers])
 *     We generate the expressions for remaining specifiers and selected specifiers by calling
 *     this method recursively.
 *  3. Finally, we select another internal from the remainingInternals and generate an
 *     expression for that selection by calling this method recursively. We stop doing
 *     this once we've selected as many internals as are remaining, since at that point
 *     we will have tried every possible combination of internals.
 *
 * This ensures that every sequence of internal specifiers are tested.
 */
function createClassExpressionsForInternals(jsonld, remainingInternals, selected) {
  // process.stderr.write(`@id [${jsonld['@id']}] Remaining internals:
  // ${remainingInternals.length}, selected: ${selected.length}\n`);

  // Quick special case: if we have two 'remainingInternals' and zero selecteds,
  // we can just return the MRCA for two internal specifiers.
  if (selected.length === 0) {
    if (remainingInternals.length === 2) {
      return [getMRCARestrictionOfTwoTUs(remainingInternals[0], remainingInternals[1])];
    } if (remainingInternals.length === 1) {
      throw new Error('Cannot determine class expression for a single specifier');
    } else if (remainingInternals.length === 0) {
      throw new Error('Cannot determine class expression for zero specifiers');
    }
  }

  // Step 1. If we've already selected something, create an expression for it.
  const classExprs = [];
  if (selected.length > 0) {
    let remainingInternalsExpr = [];
    if (remainingInternals.length === 1) {
      remainingInternalsExpr = getIncludesRestrictionForTU(remainingInternals[0]);
    } else if (remainingInternals.length === 2) {
      remainingInternalsExpr = getMRCARestrictionOfTwoTUs(
        remainingInternals[0],
        remainingInternals[1]
      );
    } else {
      remainingInternalsExpr = createAdditionalClass(
        jsonld,
        remainingInternals,
        [],
        () => createClassExpressionsForInternals(jsonld, remainingInternals, [])
      );
    }

    let selectedExpr = [];
    if (selected.length === 1) {
      selectedExpr = getIncludesRestrictionForTU(selected[0]);
    } else if (selected.length === 2) {
      selectedExpr = getMRCARestrictionOfTwoTUs(selected[0], selected[1]);
    } else {
      selectedExpr = createAdditionalClass(
        jsonld,
        selected,
        [],
        () => createClassExpressionsForInternals(jsonld, selected, [])
      );
    }

    classExprs.push({
      '@type': 'owl:Restriction',
      onProperty: 'obo:CDAO_0000149', // cdao:has_Child
      someValuesFrom: {
        '@type': 'owl:Class',
        intersectionOf: [{
          '@type': 'owl:Restriction',
          onProperty: 'phyloref:excludes_lineage_to',
          someValuesFrom: remainingInternalsExpr,
        }, selectedExpr],
      },
    });
  }

  // Step 2. Now select everything from remaining once, and start recursing through
  // every possibility.
  // Note that we only process cases where there are more remainingInternals than
  // selected internals -- when there are fewer, we'll just end up with the inverses
  // of the previous comparisons, which we'll already have covered.
  // TODO: the other way around that would be to wrap *everything* into additional
  // classes, which might be a useful thing to do anyway.
  if (remainingInternals.length > 1 && selected.length <= remainingInternals.length) {
    remainingInternals.map((newlySelected) => {
      process.stderr.write(`Selecting new object, remaining now at: ${remainingInternals.filter(i => i !== newlySelected).length}, selected: ${selected.concat([newlySelected]).length}\n`);
      return createClassExpressionsForInternals(
        jsonld,
        // The new remaining is the old remaining minus the selected TU.
        remainingInternals.filter(i => i !== newlySelected),
        // The new selected is the old selected plus the selected TU.
        selected.concat([newlySelected])
      );
    })
      .reduce((acc, val) => acc.concat(val), [])
      .forEach(expr => classExprs.push(expr));
  }

  return classExprs;
}

/*
 * Given an expression that evaluates to an included node and a taxonomic unit,
 * return an expression for including it and excluding the TU. Note that this
 * always returns an array.
 *
 * When the included expression includes a single taxonomic unit (i.e. is in the
 * form `includes_TU some [TU]`), then the simple form is adequate. However, when
 * it's a more complex expression, it's possible that the excluded TU isn't just
 * sister to this clade but outside of it entirely. In that case, we add another
 * class expression:
 *  [includesExpr] and (has_Ancestor some (excludes_TU some [TU]))
 */
function getClassExpressionsForExprAndTU(includedExpr, tu) {
  if (!includedExpr) throw new Error('Exclusions require an included expression');

  const exprs = [{
    '@type': 'owl:Class',
    intersectionOf: [
      includedExpr,
      {
        '@type': 'owl:Restriction',
        onProperty: 'phyloref:excludes_TU',
        someValuesFrom: convertTUtoRestriction(tu)[0],
      },
    ],
  }];

  if (!Array.isArray(includedExpr) && has(includedExpr, 'onProperty') && includedExpr.onProperty === 'phyloref:includes_TU') {
    // In this specific set of circumstances, we do NOT need to add the has_Ancestor check.
  } else {
    // Add the has_Ancestor check!
    exprs.push({
      '@type': 'owl:Class',
      intersectionOf: [
        includedExpr,
        {
          '@type': 'owl:Restriction',
          onProperty: 'obo:CDAO_0000144', // has_Ancestor
          someValuesFrom: {
            '@type': 'owl:Restriction',
            onProperty: 'phyloref:excludes_TU',
            someValuesFrom: convertTUtoRestriction(tu)[0],
          },
        },
      ],
    });
  }

  return exprs;
}

/*
 * Returns a list of class expressions for a phyloreference that has an expression
 * for the MRCA of its internal specifiers, but also has one or more external specifiers.
 *  - jsonld: The JSON-LD form of the Phyloreference from Model 1.0. Mainly used
 *    for retrieving the '@id' and the specifiers.
 *  - accumulatedExpr: Initially, an expression that evaluates to the MRCA of all
 *    internal specifiers, calculated using createClassExpressionsForInternals().
 *    When we call this method recusively, this expression will incorporate
 *    representations of external references.
 *  - remainingExternals: External specifiers that are yet to be incorporated into the
 *    expressions we are building.
 *  - selected: External specifiers that have already been selected.
 *
 * Our overall algorithm here is:
 *  1. If we need to add a single remaining external to the accumulated expression,
 *     we can do that by adding an `excludes_TU` to the expression (and possibly a
 *     `has_Ancestor` check, see getClassExpressionsForExprAndTU()).
 *  2. If we need to add more than one remaining external, we select each external
 *     specifier one at a time. We add the selected specifier to the accumulated
 *     expression using getClassExpressionsForExprAndTU(), and then call ourselves
 *     recursively to add the remaining specifiers.
 *
 * The goal here is to create expressions for every possible sequence of external
 * specifiers, so we can account for cases where some external specifiers are closer
 * to the initial internal-specifier-only expression than others.
 */
function createClassExpressionsForExternals(jsonld, accumulatedExpr, remainingExternals, selected) {
  // process.stderr.write(`@id [${jsonld['@id']}] Remaining externals:
  // ${remainingExternals.length}, selected: ${selected.length}\n`);

  // Step 1. If we only have one external remaining, we can provide our two-case example
  // to detect it.
  const classExprs = [];
  if (remainingExternals.length === 0) {
    throw new Error('Cannot create class expression when no externals remain');
  } else if (remainingExternals.length === 1) {
    const remainingExternalsExprs = getClassExpressionsForExprAndTU(
      accumulatedExpr,
      remainingExternals[0],
      selected.length > 0
    );
    remainingExternalsExprs.forEach(expr => classExprs.push(expr));
  } else { // if(remainingExternals.length > 1)
    // Recurse into remaining externals. Every time we select a single entry,
    // we create a class expression for that.
    remainingExternals.map((newlySelected) => {
      // process.stderr.write(`Selecting new object, remaining now at:
      // ${remainingExternals.filter(i => i !== newlySelected).length},
      // selected: ${selected.concat([newlySelected]).length}\n`);

      // Create a new additional class for the accumulated expression plus the
      // newly selected external specifier.
      const newlyAccumulatedExpr = createAdditionalClass(
        jsonld,
        jsonld.internalSpecifiers,
        selected.concat([newlySelected]),
        () => getClassExpressionsForExprAndTU(accumulatedExpr, newlySelected, selected.length > 0)
      );

      // Call ourselves recursively to add the remaining externals.
      return createClassExpressionsForExternals(
        jsonld,
        newlyAccumulatedExpr,
        // The new remaining is the old remaining minus the selected TU.
        remainingExternals.filter(i => i !== newlySelected),
        // The new selected is the old selected plus the selected TU.
        selected.concat([newlySelected])
      );
    })
      .reduce((acc, val) => acc.concat(val), [])
      .forEach(expr => classExprs.push(expr));
  }

  return classExprs;
}

module.exports = {
  convertTUtoRestriction,
  getIncludesRestrictionForTU,
  createClassExpressionsForInternals,
  createClassExpressionsForExternals,
};
