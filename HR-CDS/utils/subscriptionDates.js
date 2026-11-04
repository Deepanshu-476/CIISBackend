const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Dates are entered as calendar days in India: something "ending 3 Nov" is valid through
// 3 Nov, so its deadline is 23:59:59.999 IST that day (whether stored as UTC or IST midnight).
const endOfIstDay = value => {
  const time = new Date(value ?? NaN).getTime();
  if (Number.isNaN(time)) return null;
  const ist = new Date(time + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 999) - IST_OFFSET_MS);
};

// Whole IST calendar days from `from` to `to` (0 = same day, negative = already past).
const istDaysUntil = (to, from = new Date()) => {
  const day = value => Math.floor((new Date(value).getTime() + IST_OFFSET_MS) / DAY_MS);
  return day(to) - day(from);
};

const subscriptionExpiresAt = subscription => (subscription?.endDate ? endOfIstDay(subscription.endDate) : null);

// A plan task is due `dueInDays` after the subscription starts, never after the subscription ends.
// 0, and the plan form's default of months x 30 ("the whole plan"), mean the last day of the
// subscription, so a 31-day month does not make those tasks due a day early.
const planTaskDueDate = (subscription, dueInDays = 0, planMonths = 0) => {
  const expiresAt = subscriptionExpiresAt(subscription);
  if (!expiresAt) return null;
  const days = Number(dueInDays || 0);
  const start = new Date(subscription.startDate ?? NaN).getTime();
  if (!(days > 0) || Number.isNaN(start) || (planMonths > 0 && days >= planMonths * 30)) return expiresAt;
  const due = endOfIstDay(start + days * DAY_MS);
  return due < expiresAt ? due : expiresAt;
};

const latestSubscription = (subscriptions = []) => [...subscriptions].sort((a, b) =>
  Number(b?.subscriptionNo || 0) - Number(a?.subscriptionNo || 0) || new Date(b?.endDate || 0) - new Date(a?.endDate || 0))[0] || null;

// Numbers stay unique after a removal or after subscriptions that were saved without one.
const nextSubscriptionNo = (subscriptions = []) =>
  Math.max(subscriptions.length, ...subscriptions.map(sub => Number(sub?.subscriptionNo) || 0)) + 1;

module.exports = { endOfIstDay, istDaysUntil, subscriptionExpiresAt, planTaskDueDate, latestSubscription, nextSubscriptionNo };
