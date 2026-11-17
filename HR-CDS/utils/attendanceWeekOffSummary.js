const { isOffDayFor } = require('./weekOff');

// All inputs have already been scoped to the requesting company's visible employees.
const weeklyOffUserIdsForDate = (users, departments, swaps, date) => {
  const byId = new Map(departments.map(dept => [String(dept._id), dept]));
  const byName = new Map(departments.map(dept => [String(dept.name || '').trim().toLowerCase(), dept]));
  const swapsByUser = new Map();
  for (const swap of swaps) {
    const id = String(swap.user);
    if (!swapsByUser.has(id)) swapsByUser.set(id, []);
    swapsByUser.get(id).push(swap);
  }
  return users.filter(user => {
    const raw = user.department;
    const id = String(raw?._id || raw || '');
    const name = String(raw?.name || raw || user.departmentName || '').trim().toLowerCase();
    const department = byId.get(id) || byName.get(name) || byName.get(String(user.departmentName || '').trim().toLowerCase()) || null;
    return isOffDayFor({department, weekOffDays: user.weekOffDays || [], swaps: swapsByUser.get(String(user._id)) || []}, date);
  }).map(user => String(user._id));
};

module.exports = { weeklyOffUserIdsForDate };
