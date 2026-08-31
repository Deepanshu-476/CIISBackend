const Department = require("../models/Department");
const Branch = require("../models/Branch");
const JobRole = require("../models/JobRole");
const User = require("../models/User");
const Holiday = require("../HR-CDS/models/Holiday");
const Service = require("../HR-CDS/models/Service");
const Client = require("../HR-CDS/models/Client");
const ClientPlan = require("../HR-CDS/models/ClientPlan");
const Task = require("../HR-CDS/models/Task");

const tenantModels = [
  { model: Department, legacyFields: ["name"] },
  { model: Branch, legacyFields: ["name", "branchCode"] },
  { model: JobRole, legacyFields: ["name"] },
  { model: User, legacyFields: ["email"] },
  { model: Holiday, legacyFields: ["title", "date"] },
  { model: Service, legacyFields: ["servicename"] },
  { model: Client, legacyFields: ["client"] },
  { model: ClientPlan, legacyFields: ["name"] },
];

const isLegacyGlobalUniqueIndex = (index, fields) => {
  const keys = Object.keys(index.key || {});
  return index.unique === true && keys.length === 1 && fields.includes(keys[0]);
};

const migrateTenantIndexes = async () => {
  try {
    await Task.repairRecurrenceUniqueIndex();
  } catch (error) {
    if (error?.code !== 26 && error?.codeName !== "NamespaceNotFound") {
      console.error("Failed to migrate Task recurrence index:", error.message);
    }
  }

  for (const { model, legacyFields } of tenantModels) {
    try {
      const indexes = await model.collection.indexes();
      const legacyIndexes = indexes.filter(index =>
        isLegacyGlobalUniqueIndex(index, legacyFields)
      );

      for (const index of legacyIndexes) {
        await model.collection.dropIndex(index.name);
        console.log(`Removed legacy global ${model.modelName} index: ${index.name}`);
      }

      // Re-assert the company-scoped indexes declared by each schema.
      await model.createIndexes();
    } catch (error) {
      // An unused model may not have a collection yet.
      if (error?.code !== 26 && error?.codeName !== "NamespaceNotFound") {
        console.error(`Failed to migrate ${model.modelName} indexes:`, error.message);
      }
    }
  }
};

module.exports = migrateTenantIndexes;
