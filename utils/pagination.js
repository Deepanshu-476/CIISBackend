const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePositiveInt = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const getPaginationOptions = (query = {}, defaults = {}) => {
  const maxLimit = defaults.maxLimit || MAX_LIMIT;
  const page = parsePositiveInt(query.page, defaults.page || 1);
  const limit = parsePositiveInt(query.limit, defaults.limit || DEFAULT_LIMIT, maxLimit);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const buildPaginationMeta = ({ page, limit, total }) => {
  const pages = Math.max(Math.ceil(total / limit), 1);

  return {
    page,
    limit,
    total,
    pages,
    currentPage: page,
    totalPages: pages,
    totalItems: total,
    itemsPerPage: limit,
    hasNext: page < pages,
    hasPrev: page > 1
  };
};

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  getPaginationOptions,
  buildPaginationMeta
};
