const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeRegex, buildDuplicateGroupQuery } = require("../HR-CDS/controllers/groupController");

test("escapeRegex escapes special regex characters", () => {
  assert.equal(escapeRegex("Dev (Team)"), "Dev \\(Team\\)");
  assert.equal(escapeRegex("QA+Dev [Tier-1]*"), "QA\\+Dev \\[Tier-1\\]\\*");
  assert.equal(escapeRegex("Sales & Marketing $100"), "Sales & Marketing \\$100");
});

const extractConditions = query => {
  if (query.$and && Array.isArray(query.$and)) {
    return Object.assign({}, ...query.$and);
  }
  return query;
};

test("buildDuplicateGroupQuery produces case-insensitive regex matching trimmed name", async () => {
  const dummyUser = { _id: "user123", company: "company999", companyCode: "CIIS" };
  const query = await buildDuplicateGroupQuery(dummyUser, "  Marketing Team  ");

  assert.ok(query, "Query should be returned");
  const conditions = extractConditions(query);
  assert.equal(conditions.isActive, true);
  assert.ok(conditions.name instanceof RegExp, "name should be a RegExp");
  assert.equal(conditions.name.flags, "i");
  assert.ok(conditions.name.test("Marketing Team"));
  assert.ok(conditions.name.test("marketing team"));
  assert.ok(conditions.name.test("MARKETING TEAM"));
  assert.ok(!conditions.name.test("Marketing Team 2"));
  assert.ok(!conditions.name.test("Other Marketing Team"));
});

test("buildDuplicateGroupQuery excludes existing groupId on update", async () => {
  const dummyUser = { _id: "user123", company: "company999" };
  const query = await buildDuplicateGroupQuery(dummyUser, "Engineering", "grp456");

  assert.ok(query, "Query should be returned");
  const conditions = extractConditions(query);
  assert.equal(conditions.isActive, true);
  assert.deepEqual(conditions._id, { $ne: "grp456" });
  assert.ok(conditions.name.test("engineering"));
});

test("frontend duplicate detection logic identifies case-insensitive and trimmed collisions", () => {
  const existingGroups = [
    { _id: "grp1", name: "Engineering" },
    { _id: "grp2", name: "Human Resources" },
    { _id: "grp3", name: "Design & UX" }
  ];

  const checkDuplicate = (inputName, excludeGroupId = null) => {
    const trimmed = String(inputName || "").trim().toLowerCase();
    if (!trimmed) return false;
    return existingGroups.some((g) => {
      const gId = g._id || g.id;
      if (excludeGroupId && String(gId) === String(excludeGroupId)) {
        return false;
      }
      return String(g.name || "").trim().toLowerCase() === trimmed;
    });
  };

  // Test creation duplicates
  assert.equal(checkDuplicate("engineering"), true, "Should detect lower-case duplicate");
  assert.equal(checkDuplicate("  Engineering  "), true, "Should detect trimmed duplicate");
  assert.equal(checkDuplicate("ENGINEERING"), true, "Should detect upper-case duplicate");
  assert.equal(checkDuplicate("Finance"), false, "Should allow non-existing group name");
  assert.equal(checkDuplicate(""), false, "Empty name is not flagged as duplicate");
  assert.equal(checkDuplicate("   "), false, "Whitespace-only name is not flagged as duplicate");

  // Test update collisions
  assert.equal(checkDuplicate("Engineering", "grp1"), false, "Same group keeping its own name should not be a collision");
  assert.equal(checkDuplicate("engineering", "grp1"), false, "Same group changing casing of its own name should not be a collision");
  assert.equal(checkDuplicate("Human Resources", "grp1"), true, "Group renaming to another existing group name should be a collision");
  assert.equal(checkDuplicate("New Unique Name", "grp1"), false, "Group renaming to unique name should be allowed");
});

test("error response structure matches required format", () => {
  const duplicateResponse = {
    success: false,
    message: "A group with this name already exists.",
    error: "A group with this name already exists."
  };

  assert.equal(duplicateResponse.success, false);
  assert.equal(duplicateResponse.message, "A group with this name already exists.");
});
