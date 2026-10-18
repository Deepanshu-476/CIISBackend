// Many controllers build "match any of these legacy field names" filters such as
//   { $or: [{ company: id }, { companyId: id }] }
// but some of those names (companyId, branchId, departmentId on User) are not in the schema, so no
// document can ever have them. MongoDB still has to honour the $or, and a branch on an unindexed field
// forces a full collection scan.
//
// This plugin removes $or / $nor branches whose top-level field is not part of the schema, before read
// queries run. It never touches the top level of a filter and never empties an $or, so results are
// unchanged: removed branches could not match anything.
const isUnknownField = (schema, key) => {
  if (!key || key.startsWith('$')) return false;
  return schema.pathType(key.split('.')[0]) === 'adhocOrUndefined';
};

const branchIsUnknown = (schema, branch) => {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return false;
  const keys = Object.keys(branch);
  return keys.length > 0 && keys.every(key => isUnknownField(schema, key));
};

const clean = (schema, filter) => {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return filter;
  for (const op of ['$or', '$nor']) {
    if (Array.isArray(filter[op])) {
      const kept = filter[op].filter(branch => !branchIsUnknown(schema, branch));
      if (kept.length > 0) filter[op] = kept;
      filter[op].forEach(branch => clean(schema, branch));
    }
  }
  if (Array.isArray(filter.$and)) filter.$and.forEach(branch => clean(schema, branch));
  return filter;
};

module.exports = function dropUnknownOrBranches(schema) {
  const hook = function () {
    const filter = this.getFilter();
    if (filter && (filter.$or || filter.$and || filter.$nor)) clean(schema, filter);
  };
  for (const op of ['find', 'findOne', 'countDocuments', 'distinct']) schema.pre(op, hook);
};
