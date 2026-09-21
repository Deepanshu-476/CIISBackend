const monthEndUtc = month => {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0, 23, 59, 59, 999));
};

// Monthly payroll uses the salary revision effective on the last day of the
// selected month, so later revisions cannot change an earlier month's salary.
const salarySnapshotForMonth = (assignment = {}, month) => {
  const target = monthEndUtc(month);
  if (!target) return null;
  // History is appended oldest first. For equal effective dates the current
  // assignment wins, followed by the most recently archived revision.
  const revisions = [assignment, ...(Array.isArray(assignment.history) ? [...assignment.history].reverse() : [])]
    .filter(item => item?.effectiveFrom && new Date(item.effectiveFrom).getTime() <= target.getTime());
  if (!revisions.length) return null;
  const selected = revisions.sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0];
  if (selected === assignment) return assignment;
  return {
    ...assignment,
    ...selected,
    user: assignment.user,
    company: assignment.company,
    department: assignment.department,
    designation: assignment.designation,
    dateOfJoining: assignment.dateOfJoining,
    status: assignment.status,
    history: assignment.history,
    salaryStructure: selected.salaryStructure
      ? { _id: selected.salaryStructure?._id || selected.salaryStructure, name: selected.salaryStructureName || "", code: "" }
      : assignment.salaryStructure,
    salaryStructureName: selected.salaryStructureName || assignment.salaryStructureName || ""
  };
};

module.exports = { monthEndUtc, salarySnapshotForMonth };
