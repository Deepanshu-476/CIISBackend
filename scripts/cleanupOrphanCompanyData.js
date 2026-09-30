require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Company = require("../models/Company");
const Plan = require("../models/Plan");
const User = require("../models/User");

const apply = process.argv.includes("--apply");

const escapeRegExp = value => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectId = value => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const buildCodeKeepConditions = companyCodes => {
  if (!companyCodes.length) return [];
  return companyCodes.map(code => ({
    $or: [
      { companyCode: code },
      { companyCode: { $regex: new RegExp(`^${escapeRegExp(code)}-`, "i") } },
      { companyIdentifier: code },
      { companyIdentifier: { $regex: new RegExp(`^${escapeRegExp(code)}-`, "i") } },
    ],
  }));
};

const main = async () => {
  await connectDB();

  const companies = await Company.find({})
    .select("_id companyCode companyName")
    .lean();

  const validCompanyIds = companies.map(company => company._id);
  const validCompanyIdStrings = new Set(validCompanyIds.map(id => String(id)));
  const validCompanyIdValues = [
    ...validCompanyIds,
    ...validCompanyIdStrings,
  ];
  const validCompanyCodes = companies
    .map(company => String(company.companyCode || "").trim().toUpperCase())
    .filter(Boolean);

  const orphanUsers = await User.find({
    $or: [
      { company: { $exists: true, $nin: validCompanyIdValues } },
      ...(validCompanyCodes.length
        ? [{ companyCode: { $exists: true, $nin: validCompanyCodes } }]
        : [{ companyCode: { $exists: true, $ne: "" } }]),
    ],
  }).select("_id").lean();

  const orphanUserIds = orphanUsers.map(user => user._id);
  const protectedCollections = new Set([
    Company.collection.name,
    Plan.collection.name,
    "superadmins",
    "system.version",
  ]);

  const userReferenceFields = [
    "user", "userId", "recipient", "sender", "requester", "requestedBy",
    "createdBy", "updatedBy", "employee", "employeeId", "assignedTo",
    "assigneeId", "approvedBy", "rejectedBy", "uploadedBy", "performedBy",
  ];

  const codeKeepConditions = buildCodeKeepConditions(validCompanyCodes);
  const collections = await mongoose.connection.db
    .listCollections({}, { nameOnly: true })
    .toArray();

  const summary = {};

  for (const { name } of collections) {
    if (protectedCollections.has(name) || name.startsWith("system.")) continue;

    const collection = mongoose.connection.db.collection(name);
    const conditions = [
      { company: { $exists: true, $nin: validCompanyIdValues } },
      { companyId: { $exists: true, $nin: validCompanyIdValues } },
    ];

    if (validCompanyCodes.length) {
      conditions.push({
        companyCode: {
          $exists: true,
          $nin: validCompanyCodes,
          $not: new RegExp(`^(?:${validCompanyCodes.map(escapeRegExp).join("|")})-`, "i"),
        },
      });
      conditions.push({
        companyIdentifier: {
          $exists: true,
          $nin: validCompanyCodes,
          $not: new RegExp(`^(?:${validCompanyCodes.map(escapeRegExp).join("|")})-`, "i"),
        },
      });
    } else {
      conditions.push({ companyCode: { $exists: true, $ne: "" } });
      conditions.push({ companyIdentifier: { $exists: true, $ne: "" } });
    }

    if (orphanUserIds.length) {
      userReferenceFields.forEach(field => {
        conditions.push({ [field]: { $in: orphanUserIds } });
      });
    }

    const filter = { $and: [{ $or: conditions }] };
    if (codeKeepConditions.length) {
      filter.$and.push({ $nor: codeKeepConditions });
    }

    const count = await collection.countDocuments(filter);
    if (!count) continue;

    summary[name] = count;
    if (apply) {
      const result = await collection.deleteMany(filter);
      summary[name] = result.deletedCount;
    }
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    activeCompanies: companies.length,
    validCompanyCodes,
    orphanUsers: orphanUserIds.length,
    records: summary,
  }, null, 2));
};

main()
  .catch(error => {
    console.error("Orphan company data cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
