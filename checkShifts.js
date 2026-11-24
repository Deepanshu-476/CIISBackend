const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const shifts = await mongoose.connection.collection('shifts').find({}).toArray();
  console.log("All Shifts:", JSON.stringify(shifts, null, 2));

  const jobRoles = await mongoose.connection.collection('jobroles').find({}).toArray();
  console.log("Job Roles count:", jobRoles.length);

  // Check today's attendance records
  const todayRecords = await mongoose.connection.collection('attendances').find({
    date: {
      $gte: new Date("2026-11-22T18:30:00.000Z"),
      $lte: new Date("2026-11-23T18:29:59.999Z")
    }
  }).toArray();
  console.log("Today attendance records count:", todayRecords.length);
  for (const r of todayRecords) {
    console.log(`User: ${r.user}, inTime: ${r.inTime}, lateBy: ${r.lateBy}, status: ${r.status}, shiftSnapshot:`, r.shiftSnapshot || r.shiftSettings);
  }

  process.exit(0);
}

run().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
