require("dotenv").config();
const mongoose = require("mongoose");

// Drops indexes that the schemas no longer declare because a longer index with the same leading keys
// already serves the same queries (e.g. { company: 1 } next to { company: 1, createdAt: -1 }). They only
// slow every insert/update and use RAM. Mongoose's autoIndex never removes old indexes, so this does.
// Only the exact keys listed in redundantIndexes.json are touched, never unique/partial/TTL indexes.
// Run it after every instance runs the new code (older code would recreate them on restart).
// Dry run by default; pass --apply to drop.
const APPLY = process.argv.includes("--apply");
const targets = require("./redundantIndexes.json");

const sameKey = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in environment");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  let found = 0;
  for (const { collection, key } of targets) {
    const indexes = await db.collection(collection).indexes().catch(() => []);
    const match = indexes.find(index => sameKey(index.key, key) && !index.unique && !index.partialFilterExpression && index.expireAfterSeconds === undefined);
    if (!match) continue;
    found += 1;
    console.log(`${APPLY ? "Dropping" : "Would drop"} ${collection}.${match.name}`);
    if (APPLY) await db.collection(collection).dropIndex(match.name);
  }
  console.log(`${found} redundant indexes ${APPLY ? "dropped" : "found"} (of ${targets.length} listed).`);
  if (!APPLY && found) console.log("Run again with --apply to drop them.");
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
