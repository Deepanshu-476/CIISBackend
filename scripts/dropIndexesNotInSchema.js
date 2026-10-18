require("dotenv").config();
const mongoose = require("mongoose");

// Drops indexes that exist in MongoDB but are no longer declared in the model schema. Mongoose's
// autoIndex creates new indexes but never removes old ones, so redundant indexes removed from the CRM
// models (single-field company / name / phone / status indexes already covered by company-prefixed
// compound indexes) keep slowing every insert until they are dropped here.
// Dry run by default; pass --apply to drop.
const APPLY = process.argv.includes("--apply");
const models = [
  require("../models/CallLog"),
  require("../models/Followup"),
  require("../models/Lead"),
];

const keyOf = keys => JSON.stringify(Object.entries(keys));

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in environment");
  await mongoose.connect(process.env.MONGO_URI);

  for (const model of models) {
    const declared = new Set(model.schema.indexes().map(([keys]) => keyOf(keys)));
    declared.add(keyOf({ _id: 1 }));
    const existing = await model.collection.indexes();
    const extra = existing.filter(index => !declared.has(keyOf(index.key)));
    for (const index of extra) {
      console.log(`${APPLY ? "Dropping" : "Would drop"} ${model.collection.collectionName}.${index.name}`);
      if (APPLY) await model.collection.dropIndex(index.name);
    }
    if (!extra.length) console.log(`${model.collection.collectionName}: nothing to drop`);
  }
  if (!APPLY) console.log("Run again with --apply to drop them.");
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
